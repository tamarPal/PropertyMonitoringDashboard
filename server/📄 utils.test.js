const {
  parseDate,
  computeCaseStatus,
  normalizeText,
  buildDetailUrl,
} = require("./utils");

describe("Utility Functions Tests", () => {
  describe("parseDate", () => {
    test("should parse valid date", () => {
      const result = parseDate("12/25/2024");
      expect(result).not.toBeNull();
    });

    test("should return null for invalid date", () => {
      const result = parseDate("-");
      expect(result).toBeNull();
    });
  });

  describe("normalizeText", () => {
    test("should remove extra spaces", () => {
      const result = normalizeText("   hello    world   ");
      expect(result).toBe("hello world");
    });
  });

  describe("computeCaseStatus", () => {
    test("should return CLOSED when closedDate exists", () => {
      const result = computeCaseStatus(null, null, new Date().toISOString());
      expect(result.status).toBe("CLOSED");
    });

    test("should return OVERDUE when compliance date is in the past", () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const result = computeCaseStatus(null, pastDate, null);
      expect(result.status).toBe("OVERDUE");
    });

    test("should return URGENT when compliance date is soon", () => {
      const soonDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      const result = computeCaseStatus(null, soonDate, null);
      expect(result.status).toBe("URGENT");
    });

    test("should return NEW when recently created and no compliance", () => {
      const recent = new Date().toISOString();
      const result = computeCaseStatus(recent, null, null);
      expect(result.status).toBe("NEW");
    });

    test("should return IN_PROGRESS otherwise", () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const result = computeCaseStatus(oldDate, null, null);
      expect(result.status).toBe("IN_PROGRESS");
    });
  });

  describe("buildDetailUrl", () => {
    test("should build valid URL", () => {
      const url = buildDetailUrl("123", "Complaint", "456");
      expect(url).toContain("APN=123");
      expect(url).toContain("CaseNo=456");
    });

    test("should return empty string if invalid input", () => {
      const url = buildDetailUrl("123", "Unknown", "456");
      expect(url).toBe("");
    });
  });
});