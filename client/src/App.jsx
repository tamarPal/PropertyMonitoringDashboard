import { useMemo, useState } from "react";
import "./App.css";

function App() {
  const [apn, setApn] = useState("2654002037");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("ALL");

  const handleSearch = async () => {
    const cleanApn = apn.trim();

    if (!cleanApn) {
      setError("Please enter APN");
      return;
    }

    setLoading(true);
    setError("");
    setData(null);
    setSelectedStatus("ALL");

    try {
      const res = await fetch("http://localhost:5000/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ apn: cleanApn }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Something went wrong");
      }

      setData(result);
    } catch (err) {
      setError(err.message || "Failed to fetch property");
    } finally {
      setLoading(false);
    }
  };

  const filteredCases = useMemo(() => {
    const cases = Array.isArray(data?.cases) ? [...data.cases] : [];

    if (selectedStatus === "ALL") {
      return cases;
    }

    let filtered;

    if (selectedStatus === "OPEN") {
      filtered = cases.filter((item) => item.isOpen);
    } else {
      filtered = cases.filter((item) => (item.status || "") === selectedStatus);
    }

    filtered.sort((a, b) => {
      const aTime = getComplianceSortValue(a);
      const bTime = getComplianceSortValue(b);

      if (aTime === bTime) return 0;
      if (aTime === Number.MIN_SAFE_INTEGER) return 1;
      if (bTime === Number.MIN_SAFE_INTEGER) return -1;

      return bTime - aTime;
    });

    return filtered;
  }, [data?.cases, selectedStatus]);

  return (
    <div className="app-shell">
      <div className="app-container">
        <h1 className="page-title">Property Monitoring Dashboard</h1>

        <div className="search-bar">
          <input
            value={apn}
            onChange={(e) => setApn(e.target.value)}
            placeholder="Search by APN..."
            className="search-input"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch();
              }
            }}
          />

          <button
            type="button"
            onClick={handleSearch}
            disabled={loading}
            className="search-button"
          >
            {loading ? "Loading..." : "Search"}
          </button>
        </div>

        {error && <div className="error-box">{error}</div>}

        {data && (
          <>
            <div className="summary-top">
              <SummaryCard
                title="Total Cases"
                value={data.summary?.totalCases ?? 0}
                tone="default"
                active={selectedStatus === "ALL"}
                onClick={() => setSelectedStatus("ALL")}
              />
            </div>

            <div className="summary-grid">
              <SummaryCard
                title="Urgent"
                value={data.summary?.urgentCases ?? 0}
                tone="URGENT"
                active={selectedStatus === "URGENT"}
                onClick={() => setSelectedStatus("URGENT")}
              />

              <SummaryCard
                title="Overdue"
                value={data.summary?.overdueCases ?? 0}
                tone="OVERDUE"
                active={selectedStatus === "OVERDUE"}
                onClick={() => setSelectedStatus("OVERDUE")}
              />

              <SummaryCard
                title="New"
                value={data.summary?.newCases ?? 0}
                tone="NEW"
                active={selectedStatus === "NEW"}
                onClick={() => setSelectedStatus("NEW")}
              />

              <SummaryCard
                title="In Progress"
                value={data.summary?.inProgressCases ?? 0}
                tone="IN_PROGRESS"
                active={selectedStatus === "IN_PROGRESS"}
                onClick={() => setSelectedStatus("IN_PROGRESS")}
              />

              <SummaryCard
                title="Closed"
                value={data.summary?.closedCases ?? 0}
                tone="CLOSED"
                active={selectedStatus === "CLOSED"}
                onClick={() => setSelectedStatus("CLOSED")}
              />

              <SummaryCard
                title="Open"
                value={data.summary?.openCases ?? 0}
                tone="default"
                active={selectedStatus === "OPEN"}
                onClick={() => setSelectedStatus("OPEN")}
              />
            </div>

            <div className="filter-panel">
              <div className="filter-left">
                <div className="filter-label">Filter:</div>

                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="filter-select"
                >
                  <option value="ALL">All statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="NEW">New</option>
                  <option value="URGENT">Urgent</option>
                  <option value="OVERDUE">Overdue</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </div>

              <div className="filter-count">
                Showing {filteredCases.length} case
                {filteredCases.length === 1 ? "" : "s"}
                {selectedStatus !== "ALL" && (
                  <span className="sort-note"> • sorted by nearest compliance date</span>
                )}
              </div>
            </div>

            <div className="cases-panel">
              <h2 className="cases-title">Cases</h2>

              <div className="cases-content">
                {filteredCases.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-title">No cases found</div>
                    <div className="empty-state-text">
                      There are no cases matching the selected filter.
                    </div>
                  </div>
                ) : (
                  <div className="table-wrapper">
                    <table className="cases-table">
                      <thead>
                        <tr>
                          <th>Case ID</th>
                          <th>Type</th>
                          <th>Created</th>
                          <th>
                            <span className="column-title-with-icon">
                              Compliance Date
                              {selectedStatus !== "ALL" && (
                                <span className="sort-arrow">↓</span>
                              )}
                            </span>
                          </th>
                          <th>Closed</th>
                          <th>Open?</th>
                          <th>Closed?</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCases.map((item, index) => (
                          <TableRow
                            key={item.recordId || `${item.caseId}-${index}`}
                            item={item}
                            index={index}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TableRow({ item, index }) {
  const rowClassName = index % 2 === 0 ? "case-row even" : "case-row odd";

  return (
    <tr className={rowClassName}>
      <td>{item.caseId || "-"}</td>
      <td>{item.caseType || "-"}</td>
      <td>{item.createdDateDisplay || formatDate(item.createdDate)}</td>
      <td>{item.complianceDateDisplay || formatDate(item.complianceDate)}</td>
      <td>{item.closedDateDisplay || formatDate(item.closedDate)}</td>
      <td>{item.isOpen ? "Yes" : "No"}</td>
      <td>{item.isClosed ? "Yes" : "No"}</td>
      <td>
        <StatusBadge status={item.status} />
      </td>
    </tr>
  );
}

function SummaryCard({ title, value, tone = "default", active = false, onClick }) {
  const toneClass = `summary-card tone-${tone.toLowerCase()}${active ? " active" : ""}`;

  return (
    <button type="button" onClick={onClick} className={toneClass}>
      <div className="summary-title">{title}</div>
      <div className="summary-value">{value}</div>
    </button>
  );
}

function StatusBadge({ status }) {
  const className = `status-badge ${getStatusClassName(status)}`;
  return <span className={className}>{formatStatusLabel(status)}</span>;
}

function getStatusClassName(status) {
  switch (status) {
    case "URGENT":
      return "status-urgent";
    case "OVERDUE":
      return "status-overdue";
    case "IN_PROGRESS":
      return "status-in-progress";
    case "NEW":
      return "status-new";
    case "CLOSED":
      return "status-closed";
    default:
      return "status-default";
  }
}

function formatStatusLabel(status) {
  if (!status) return "-";
  if (status === "IN_PROGRESS") return "IN PROGRESS";
  return status;
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
  }

  if (typeof value === "string") {
    const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (match) {
      return value;
    }
  }

  return "-";
}

function getComplianceSortValue(item) {
  const rawValue =
    item?.complianceDate ||
    item?.complianceDateDisplay ||
    item?.deadline ||
    null;

  if (!rawValue) return Number.MIN_SAFE_INTEGER;

  const parsed = new Date(rawValue);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getTime();
  }

  if (typeof rawValue === "string") {
    const match = rawValue.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
    }

    const matchWithTime = rawValue.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
    );

    if (matchWithTime) {
      const [, day, month, year, hour, minute, second] = matchWithTime;
      return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second || 0)
      ).getTime();
    }
  }

  return Number.MIN_SAFE_INTEGER;
}

export default App;