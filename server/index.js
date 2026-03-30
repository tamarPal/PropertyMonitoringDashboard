
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");
const { chromium } = require("playwright");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, "property_cases.db");

const CASE_TYPE_CODE_MAP = {
  Complaint: 1,
  "Systematic Code Enforcement Program": 2,
  "Case Management": 3,
  Hearing: 5,
  "Property Management Training Program": 10,
};

const OPEN_CASES_REFRESH_HOURS = 6;
const CLOSED_ONLY_REFRESH_HOURS = 24;

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS properties (
      apn TEXT PRIMARY KEY,
      address TEXT,
      total_units TEXT,
      council_district TEXT,
      census_tract TEXT,
      year_built TEXT,
      last_fetched_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS cases (
      record_id TEXT PRIMARY KEY,
      apn TEXT NOT NULL,
      case_id TEXT NOT NULL,
      case_type TEXT NOT NULL,
      created_date TEXT,
      compliance_date TEXT,
      closed_date TEXT,
      is_open INTEGER NOT NULL,
      is_closed INTEGER NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (apn) REFERENCES properties(apn)
    )
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_cases_apn
    ON cases(apn)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_cases_apn_status
    ON cases(apn, status)
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_cases_apn_open
    ON cases(apn, is_open)
  `);
}

function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function parseDate(value) {
  if (!value) return null;

  const cleaned = normalizeText(value);
  if (!cleaned || cleaned === "-") return null;

  const match = cleaned.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );

  if (match) {
    let [, mm, dd, yyyy, hh = "0", min = "0", ss = "0", ampm = ""] = match;

    mm = Number(mm);
    dd = Number(dd);
    yyyy = Number(yyyy);
    hh = Number(hh);
    min = Number(min);
    ss = Number(ss);

    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === "AM" && hh === 12) hh = 0;
      if (upper === "PM" && hh !== 12) hh += 12;
    }

    const dt = new Date(yyyy, mm - 1, dd, hh, min, ss);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }

  const fallback = new Date(cleaned);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();

  return null;
}

function toDisplayDate(isoString) {
  if (!isoString) return "-";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function buildDetailUrl(apn, caseTypeText, caseNo) {
  const caseTypeCode = CASE_TYPE_CODE_MAP[caseTypeText];
  if (!caseTypeCode || !caseNo) return "";

  return `https://housingapp.lacity.org/reportviolation/Pages/PublicPropertyActivityReport?APN=${encodeURIComponent(
    apn
  )}&CaseType=${encodeURIComponent(caseTypeCode)}&CaseNo=${encodeURIComponent(caseNo)}`;
}

function computeCaseStatus(createdDate, complianceDate, closedDate) {
  if (closedDate) {
    return {
      isOpen: 0,
      isClosed: 1,
      status: "CLOSED",
    };
  }

  const now = new Date();
  const created = createdDate ? new Date(createdDate) : null;
  const compliance = complianceDate ? new Date(complianceDate) : null;

  if (compliance && compliance < now) {
    return {
      isOpen: 1,
      isClosed: 0,
      status: "OVERDUE",
    };
  }

  if (
    compliance &&
    compliance >= now &&
    compliance <= new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  ) {
    return {
      isOpen: 1,
      isClosed: 0,
      status: "URGENT",
    };
  }

  if (
    !compliance &&
    created &&
    created >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  ) {
    return {
      isOpen: 1,
      isClosed: 0,
      status: "NEW",
    };
  }

  return {
    isOpen: 1,
    isClosed: 0,
    status: "IN_PROGRESS",
  };
}

function shouldRefresh(lastFetchedAt, cases) {
  if (!lastFetchedAt) return true;

  const fetchedAt = new Date(lastFetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return true;

  const now = new Date();
  const hoursPassed = (now.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60);
  const hasOpenCases = cases.some((c) => Number(c.isOpen) === 1);

  if (hasOpenCases) {
    return hoursPassed >= OPEN_CASES_REFRESH_HOURS;
  }

  return hoursPassed >= CLOSED_ONLY_REFRESH_HOURS;
}

async function safeTextAfterLabel(page, label) {
  const bodyText = normalizeText(await page.locator("body").innerText());
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const patterns = [
    new RegExp(`${escaped}\\s*:?\\s*(.+?)(?=\\s+[A-Z][A-Za-z /()]+\\s*:?|$)`, "i"),
    new RegExp(`${escaped}\\s+(.+?)(?=\\s+[A-Z][A-Za-z /()]+\\s*:?|$)`, "i"),
  ];

  for (const regex of patterns) {
    const match = bodyText.match(regex);
    if (match) return normalizeText(match[1]);
  }

  return "";
}

async function extractPropertyDetails(page, fallbackApn) {
  return {
    apn:
      (await safeTextAfterLabel(page, "Assessor Parcel Number")) || fallbackApn,
    address: await safeTextAfterLabel(page, "Official Address"),
    totalUnits: await safeTextAfterLabel(page, "Total Units"),
    councilDistrict: await safeTextAfterLabel(page, "Council District"),
    censusTract: await safeTextAfterLabel(page, "Census Tract"),
    yearBuilt: await safeTextAfterLabel(page, "Year Built"),
  };
}

async function waitForCasesTable(page) {
  await page.waitForSelector("table", { timeout: 20000 });
  await page.waitForTimeout(500);
}

async function setRowsPerPageMax(page) {
  const changed = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll("select"));

    for (const select of selects) {
      const options = Array.from(select.options).map((o) => ({
        value: o.value,
        text: (o.textContent || "").trim(),
      }));

      const preferred =
        options.find((o) => o.text === "All") ||
        options.find((o) => o.value === "-1") ||
        options.find((o) => o.text === "100") ||
        options.find((o) => o.value === "100") ||
        null;

      if (!preferred) continue;

      select.value = preferred.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return false;
  });

  if (changed) {
    await page.waitForTimeout(1200);
  }
}

function extractCaseRowsFromHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => normalizeText($(td).text()))
      .get();

    if (cells.length < 4) return;
    if (!/select/i.test(cells[0])) return;

    rows.push({
      caseType: cells[1] || "",
      caseId: cells[2] || "",
      dateClosedRaw: cells[3] || "",
    });
  });

  return rows;
}

function extractNatureFromText(fullText) {
  const text = normalizeText(fullText);

  const match = text.match(
    /Nature of Complaint\s*:?\s*(.+?)(?=\s+Showing\s+\d+\s+to\s+\d+\s+of\s+\d+\s+entries|\s+Property Activity Report|\s+Date\s+Status|$)/i
  );

  return match ? normalizeText(match[1]) : "";
}

function extractEventsFromHtml(html) {
  const $ = cheerio.load(html);
  const events = [];

  $("table tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => normalizeText($(td).text()))
      .get();

    if (cells.length !== 2) return;

    const maybeDate = cells[0];
    const maybeStatus = cells[1];

    if (!/\d{1,2}\/\d{1,2}\/\d{4}/.test(maybeDate)) return;
    if (!maybeStatus) return;

    events.push({
      dateRaw: maybeDate,
      date: parseDate(maybeDate),
      status: maybeStatus,
    });
  });

  events.sort((a, b) => {
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    return aTime - bTime;
  });

  return events;
}

async function fetchCaseDetailFast(client, item) {
  if (!item.detailUrl) {
    return {
      ...item,
      createdDate: null,
      complianceDate: null,
      closedDate: item.closedDate || null,
      detailFetched: false,
    };
  }

  try {
    const response = await client.get(item.detailUrl);
    const html = response.data || "";
    const $ = cheerio.load(html);
    const text = $.text();

    const events = extractEventsFromHtml(html);

    const createdEvent =
      events.find((e) => /complaint received|site visit\/initial inspection/i.test(e.status)) ||
      events[0] ||
      null;

    const complianceEvent =
      events.find((e) => /compliance date|deadline|comply by/i.test(e.status)) ||
      null;

    const closedEvent =
      events.find((e) => /complaint closed|all violations resolved date/i.test(e.status)) ||
      null;

    return {
      ...item,
      createdDate: createdEvent?.date || null,
      complianceDate: complianceEvent?.date || null,
      closedDate: item.closedDate || closedEvent?.date || null,
      natureOfComplaint: extractNatureFromText(text),
      detailFetched: events.length > 0 || /Nature of Complaint/i.test(text),
    };
  } catch (error) {
    console.error(`Failed detail fetch for case ${item.caseId}: ${error?.message || "Unknown error"}`);

    return {
      ...item,
      createdDate: null,
      complianceDate: null,
      closedDate: item.closedDate || null,
      natureOfComplaint: "",
      detailFetched: false,
    };
  }
}

async function mapWithConcurrency(items, worker, concurrency = 8) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (true) {
      const current = index;
      index += 1;

      if (current >= items.length) break;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runner()
  );

  await Promise.all(runners);
  return results;
}

async function fetchRawPropertyCases(apn) {
  const sourceUrl = `https://housingapp.lacity.org/reportviolation/Pages/PropAtivityCases?APN=${apn}&Source=ActivityReport#divPropDetails`;
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await waitForCasesTable(page);
    await setRowsPerPageMax(page);
    await waitForCasesTable(page);

    const property = await extractPropertyDetails(page, apn);
    const html = await page.content();
    const rawRows = extractCaseRowsFromHtml(html);

    const baseCases = rawRows.map((row) => {
      const closedDate = parseDate(row.dateClosedRaw);

      return {
        recordId: `${row.caseType}__${row.caseId}`,
        caseId: row.caseId,
        caseType: row.caseType,
        createdDate: null,
        complianceDate: null,
        closedDate,
        detailUrl: buildDetailUrl(apn, row.caseType, row.caseId),
      };
    });

    const client = axios.create({
      timeout: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const rawCases = await mapWithConcurrency(
      baseCases,
      (item) => fetchCaseDetailFast(client, item),
      8
    );

    return { property, rawCases };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function enrichCasesWithStatus(rawCases) {
  return rawCases.map((item) => {
    const statusInfo = computeCaseStatus(
      item.createdDate,
      item.complianceDate,
      item.closedDate
    );

    return {
      recordId: item.recordId,
      caseId: item.caseId,
      caseType: item.caseType,
      createdDate: item.createdDate,
      complianceDate: item.complianceDate,
      closedDate: item.closedDate,
      isOpen: statusInfo.isOpen,
      isClosed: statusInfo.isClosed,
      status: statusInfo.status,
    };
  });
}

async function savePropertyToSqlite(apn, property, cases) {
  const nowIso = new Date().toISOString();

  await run("BEGIN TRANSACTION");

  try {
    await run(
      `
      INSERT INTO properties (
        apn, address, total_units, council_district, census_tract, year_built, last_fetched_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(apn) DO UPDATE SET
        address = excluded.address,
        total_units = excluded.total_units,
        council_district = excluded.council_district,
        census_tract = excluded.census_tract,
        year_built = excluded.year_built,
        last_fetched_at = excluded.last_fetched_at
      `,
      [
        apn,
        property.address || "",
        property.totalUnits || "",
        property.councilDistrict || "",
        property.censusTract || "",
        property.yearBuilt || "",
        nowIso,
      ]
    );

    await run(`DELETE FROM cases WHERE apn = ?`, [apn]);

    for (const item of cases) {
      await run(
        `
        INSERT INTO cases (
          record_id,
          apn,
          case_id,
          case_type,
          created_date,
          compliance_date,
          closed_date,
          is_open,
          is_closed,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          item.recordId,
          apn,
          item.caseId,
          item.caseType,
          item.createdDate,
          item.complianceDate,
          item.closedDate,
          item.isOpen,
          item.isClosed,
          item.status,
        ]
      );
    }

    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

async function getPropertyFromSqlite(apn) {
  const propertyRow = await get(`SELECT * FROM properties WHERE apn = ?`, [apn]);
  if (!propertyRow) return null;

  const cases = await all(
    `
    SELECT
      record_id as recordId,
      case_id as caseId,
      case_type as caseType,
      created_date as createdDate,
      compliance_date as complianceDate,
      closed_date as closedDate,
      is_open as isOpen,
      is_closed as isClosed,
      status
    FROM cases
    WHERE apn = ?
    ORDER BY case_type, case_id
    `,
    [apn]
  );

  return {
    property: {
      apn: propertyRow.apn,
      address: propertyRow.address,
      totalUnits: propertyRow.total_units,
      councilDistrict: propertyRow.council_district,
      censusTract: propertyRow.census_tract,
      yearBuilt: propertyRow.year_built,
      lastFetchedAt: propertyRow.last_fetched_at,
    },
    cases,
  };
}

function buildSummary(cases) {
  return {
    totalCases: cases.length,
    openCases: cases.filter((c) => Number(c.isOpen) === 1).length,
    closedCases: cases.filter((c) => Number(c.isClosed) === 1).length,
    urgentCases: cases.filter((c) => c.status === "URGENT").length,
    overdueCases: cases.filter((c) => c.status === "OVERDUE").length,
    newCases: cases.filter((c) => c.status === "NEW").length,
    inProgressCases: cases.filter((c) => c.status === "IN_PROGRESS").length,
  };
}

function toFrontendShape(payload) {
  return {
    property: payload.property,
    summary: buildSummary(payload.cases),
    cases: payload.cases.map((c) => ({
      recordId: c.recordId,
      caseId: c.caseId,
      caseType: c.caseType,
      createdDate: c.createdDate,
      complianceDate: c.complianceDate,
      closedDate: c.closedDate,
      createdDateDisplay: toDisplayDate(c.createdDate),
      complianceDateDisplay: toDisplayDate(c.complianceDate),
      closedDateDisplay: toDisplayDate(c.closedDate),
      isOpen: Number(c.isOpen) === 1,
      isClosed: Number(c.isClosed) === 1,
      status: c.status,
    })),
  };
}

async function refreshPropertyData(apn) {
  const { property, rawCases } = await fetchRawPropertyCases(apn);
  const casesForDb = enrichCasesWithStatus(rawCases);
  await savePropertyToSqlite(apn, property, casesForDb);
  const fromDb = await getPropertyFromSqlite(apn);
  return toFrontendShape(fromDb);
}

app.get("/api/health", (req, res) => {
  res.json({ message: "Server is running 🚀" });
});

app.post("/api/search", async (req, res) => {
  const { apn } = req.body;

  if (!apn || !String(apn).trim()) {
    return res.status(400).json({ error: "APN is required" });
  }

  const cleanApn = String(apn).replace(/[^0-9]/g, "");

  try {
    const fromDb = await getPropertyFromSqlite(cleanApn);

    if (!fromDb) {
      console.log(`APN ${cleanApn} not found in SQLite, fetching from website`);
      const fresh = await refreshPropertyData(cleanApn);

      return res.json({
        source: "website_first_fetch",
        ...fresh,
      });
    }

    if (!shouldRefresh(fromDb.property.lastFetchedAt, fromDb.cases)) {
      console.log(`Serving APN ${cleanApn} from SQLite (still fresh)`);
      return res.json({
        source: "sqlite_fresh",
        ...toFrontendShape(fromDb),
      });
    }

    console.log(`APN ${cleanApn} found in SQLite but stale, refreshing from website`);
    const refreshed = await refreshPropertyData(cleanApn);

    return res.json({
      source: "website_refresh_due_to_stale_cache",
      ...refreshed,
    });
  } catch (error) {
    console.error("Search failed:", error);

    res.status(500).json({
      error: "Failed to process property data",
      details: error.message,
    });
  }
});

app.post("/api/property/:apn/refresh", async (req, res) => {
  const cleanApn = String(req.params.apn || "").replace(/[^0-9]/g, "");

  if (!cleanApn) {
    return res.status(400).json({ error: "Valid APN is required" });
  }

  try {
    const fresh = await refreshPropertyData(cleanApn);

    res.json({
      source: "website_manual_refresh",
      ...fresh,
    });
  } catch (error) {
    console.error("Refresh failed:", error);

    res.status(500).json({
      error: "Failed to refresh property data",
      details: error.message,
    });
  }
});

app.get("/api/property/:apn/cases", async (req, res) => {
  const cleanApn = String(req.params.apn || "").replace(/[^0-9]/g, "");

  if (!cleanApn) {
    return res.status(400).json({ error: "Valid APN is required" });
  }

  try {
    const fromDb = await getPropertyFromSqlite(cleanApn);

    if (!fromDb) {
      return res.status(404).json({ error: "Property not found in SQLite" });
    }

    res.json(toFrontendShape(fromDb));
  } catch (error) {
    console.error("Read from SQLite failed:", error);

    res.status(500).json({
      error: "Failed to read property data",
      details: error.message,
    });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
      console.log(`SQLite DB path: ${DB_PATH}`);
      console.log(`Refresh policy: open cases -> ${OPEN_CASES_REFRESH_HOURS}h, closed only -> ${CLOSED_ONLY_REFRESH_HOURS}h`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize SQLite:", error);
    process.exit(1);
  });
  