function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function parseDate(value) {
  if (!value) return null;

  const cleaned = normalizeText(value);
  if (!cleaned || cleaned === "-") return null;

  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);

  if (match) {
    const [, mm, dd, yyyy] = match;
    const dt = new Date(yyyy, mm - 1, dd);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }

  return null;
}

function computeCaseStatus(createdDate, complianceDate, closedDate) {
  if (closedDate) {
    return { status: "CLOSED" };
  }

  const now = new Date();

  if (complianceDate) {
    const comp = new Date(complianceDate);

    if (comp < now) return { status: "OVERDUE" };

    if (comp <= new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)) {
      return { status: "URGENT" };
    }
  }

  if (createdDate) {
    const created = new Date(createdDate);

    if (created >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)) {
      return { status: "NEW" };
    }
  }

  return { status: "IN_PROGRESS" };
}

const CASE_TYPE_CODE_MAP = {
  Complaint: 1,
  "Systematic Code Enforcement Program": 2,
  "Case Management": 3,
  Hearing: 5,
  "Property Management Training Program": 10,
};

function buildDetailUrl(apn, caseTypeText, caseNo) {
  const caseTypeCode = CASE_TYPE_CODE_MAP[caseTypeText];
  if (!caseTypeCode || !caseNo) return "";

  return `https://housingapp.lacity.org/reportviolation/Pages/PublicPropertyActivityReport?APN=${apn}&CaseType=${caseTypeCode}&CaseNo=${caseNo}`;
}

module.exports = {
  parseDate,
  computeCaseStatus,
  normalizeText,
  buildDetailUrl,
};