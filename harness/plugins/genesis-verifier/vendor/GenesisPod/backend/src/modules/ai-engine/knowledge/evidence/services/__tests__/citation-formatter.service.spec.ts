/**
 * CitationFormatterService Tests
 *
 * Covers all five citation styles:
 * apa, mla, chicago, harvard, ieee
 * and the bibliography formatter.
 */

import { CitationFormatterService } from "../citation-formatter.service";
import { Evidence } from "../../abstractions/evidence.interface";

const baseEvidence: Evidence = {
  id: "ev-001",
  type: "CITATION",
  source: {
    title: "Deep Learning Fundamentals",
    author: "John Smith",
    publishedAt: new Date("2022-06-15"),
    url: "https://example.com/dl",
    publisher: "Academic Press",
    domain: "example.com",
  },
  content: {
    original: "Neural networks are universal function approximators.",
    snippet: "Neural networks",
    usedPortion: "introduction",
  },
  associations: {
    entityType: "report",
    entityId: "report-001",
  },
  metadata: {
    relevanceScore: 0.9,
    credibilityScore: 0.85,
    citationCount: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

const minimalEvidence: Evidence = {
  id: "ev-002",
  type: "REFERENCE",
  source: {
    title: "Basic Guide",
  },
  content: {
    original: "Some content",
  },
  associations: {
    entityType: "chapter",
    entityId: "ch-001",
  },
  metadata: {
    relevanceScore: 0.5,
    citationCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

describe("CitationFormatterService", () => {
  let service: CitationFormatterService;

  beforeEach(() => {
    service = new CitationFormatterService();
  });

  // ============================================================
  // APA
  // ============================================================

  describe("format - APA", () => {
    it("should include last name first in APA author format", () => {
      const citation = service.format(baseEvidence, "apa");
      // "John Smith" -> "Smith, J."
      expect(citation).toContain("Smith, J.");
    });

    it("should include year in parentheses", () => {
      const citation = service.format(baseEvidence, "apa");
      expect(citation).toContain("(2022)");
    });

    it("should include title", () => {
      const citation = service.format(baseEvidence, "apa");
      expect(citation).toContain("Deep Learning Fundamentals");
    });

    it("should include publisher", () => {
      const citation = service.format(baseEvidence, "apa");
      expect(citation).toContain("Academic Press");
    });

    it("should include URL", () => {
      const citation = service.format(baseEvidence, "apa");
      expect(citation).toContain("https://example.com/dl");
    });

    it("should handle minimal evidence without author or date", () => {
      const citation = service.format(minimalEvidence, "apa");
      expect(citation).toContain("Basic Guide");
    });

    it("should fall back to APA for unknown style", () => {
      const citation = service.format(baseEvidence, "unknown" as any);
      // Default is APA behavior
      expect(citation).toContain("Smith, J.");
    });
  });

  // ============================================================
  // MLA
  // ============================================================

  describe("format - MLA", () => {
    it("should include author name", () => {
      const citation = service.format(baseEvidence, "mla");
      expect(citation).toContain("John Smith");
    });

    it("should put title in quotes", () => {
      const citation = service.format(baseEvidence, "mla");
      expect(citation).toContain('"Deep Learning Fundamentals."');
    });

    it("should include publisher with comma", () => {
      const citation = service.format(baseEvidence, "mla");
      expect(citation).toContain("Academic Press,");
    });

    it("should format date in MLA format (day Mon. year)", () => {
      const citation = service.format(baseEvidence, "mla");
      // June 15, 2022 → "15 Jun. 2022"
      expect(citation).toContain("Jun.");
      expect(citation).toContain("2022");
    });

    it("should include URL when provided", () => {
      const citation = service.format(baseEvidence, "mla");
      expect(citation).toContain("https://example.com/dl");
    });

    it("should work for minimal evidence", () => {
      const citation = service.format(minimalEvidence, "mla");
      expect(citation).toContain('"Basic Guide."');
    });
  });

  // ============================================================
  // Chicago
  // ============================================================

  describe("format - Chicago", () => {
    it("should include author name", () => {
      const citation = service.format(baseEvidence, "chicago");
      expect(citation).toContain("John Smith");
    });

    it("should put title in quotes", () => {
      const citation = service.format(baseEvidence, "chicago");
      expect(citation).toContain('"Deep Learning Fundamentals."');
    });

    it("should format date as 'Month day, year'", () => {
      const citation = service.format(baseEvidence, "chicago");
      // The exact day number may vary by timezone (ISO date strings are parsed as UTC,
      // so local rendering depends on the host offset). Verify month and year are correct.
      expect(citation).toContain("June");
      expect(citation).toContain("2022");
      // Day should be either 14 (UTC-N) or 15 (UTC or UTC+N)
      expect(citation).toMatch(/June\s+1[45],\s+2022/);
    });

    it("should include URL", () => {
      const citation = service.format(baseEvidence, "chicago");
      expect(citation).toContain("https://example.com/dl");
    });
  });

  // ============================================================
  // Harvard
  // ============================================================

  describe("format - Harvard", () => {
    it("should include author name", () => {
      const citation = service.format(baseEvidence, "harvard");
      expect(citation).toContain("John Smith");
    });

    it("should include year in parentheses", () => {
      const citation = service.format(baseEvidence, "harvard");
      expect(citation).toContain("(2022)");
    });

    it("should include 'Available at:' prefix for URL", () => {
      const citation = service.format(baseEvidence, "harvard");
      expect(citation).toContain("Available at: https://example.com/dl");
    });

    it("should include 'Accessed:' date when URL present", () => {
      const citation = service.format(baseEvidence, "harvard");
      expect(citation).toContain("Accessed:");
    });

    it("should handle evidence without URL gracefully", () => {
      const noUrl: Evidence = {
        ...baseEvidence,
        source: { ...baseEvidence.source, url: undefined },
      };
      const citation = service.format(noUrl, "harvard");
      expect(citation).toContain("Deep Learning Fundamentals");
      expect(citation).not.toContain("Available at:");
    });
  });

  // ============================================================
  // IEEE
  // ============================================================

  describe("format - IEEE", () => {
    it("should use initials-first author format for IEEE", () => {
      const citation = service.format(baseEvidence, "ieee");
      // "John Smith" -> "J. Smith"
      expect(citation).toContain("J. Smith");
    });

    it("should put title in quotes", () => {
      const citation = service.format(baseEvidence, "ieee");
      expect(citation).toContain('"Deep Learning Fundamentals,"');
    });

    it("should include publisher", () => {
      const citation = service.format(baseEvidence, "ieee");
      expect(citation).toContain("Academic Press,");
    });

    it("should format date as 'Mon. year'", () => {
      const citation = service.format(baseEvidence, "ieee");
      expect(citation).toContain("Jun.");
      expect(citation).toContain("2022");
    });

    it("should include '[Online]. Available:' prefix for URL", () => {
      const citation = service.format(baseEvidence, "ieee");
      expect(citation).toContain("[Online]. Available: https://example.com/dl");
    });
  });

  // ============================================================
  // formatBibliography
  // ============================================================

  describe("formatBibliography", () => {
    it("should include 'References' header for APA", () => {
      const bib = service.formatBibliography(
        ["Citation A", "Citation B"],
        "apa",
      );
      expect(bib).toContain("References");
    });

    it("should include 'Works Cited' header for MLA", () => {
      const bib = service.formatBibliography(["Citation A"], "mla");
      expect(bib).toContain("Works Cited");
    });

    it("should include 'Bibliography' header for Chicago", () => {
      const bib = service.formatBibliography(["Citation A"], "chicago");
      expect(bib).toContain("Bibliography");
    });

    it("should include 'Reference List' header for Harvard", () => {
      const bib = service.formatBibliography(["Citation A"], "harvard");
      expect(bib).toContain("Reference List");
    });

    it("should include 'References' header for IEEE", () => {
      const bib = service.formatBibliography(["Citation A"], "ieee");
      expect(bib).toContain("References");
    });

    it("should sort citations alphabetically", () => {
      const bib = service.formatBibliography(
        ["Zebra paper", "Apple paper"],
        "apa",
      );
      const zebraIdx = bib.indexOf("Zebra paper");
      const appleIdx = bib.indexOf("Apple paper");
      expect(appleIdx).toBeLessThan(zebraIdx);
    });

    it("should separate citations with double newline", () => {
      const bib = service.formatBibliography(
        ["Citation A", "Citation B"],
        "apa",
      );
      expect(bib).toContain("\n\nCitation");
    });

    it("should handle empty citations list", () => {
      const bib = service.formatBibliography([], "apa");
      expect(bib).toContain("References");
      expect(typeof bib).toBe("string");
    });
  });

  // ============================================================
  // Date string handling (toDate)
  // ============================================================

  describe("date string handling", () => {
    it("should handle publishedAt as ISO string", () => {
      const evidenceWithStringDate: Evidence = {
        ...baseEvidence,
        source: {
          ...baseEvidence.source,
          publishedAt: "2021-03-20" as unknown as Date,
        },
      };
      // Should not throw
      expect(() => service.format(evidenceWithStringDate, "apa")).not.toThrow();
      const citation = service.format(evidenceWithStringDate, "apa");
      expect(citation).toContain("2021");
    });

    it("should handle invalid date string gracefully", () => {
      const evidenceWithBadDate: Evidence = {
        ...baseEvidence,
        source: {
          ...baseEvidence.source,
          publishedAt: "not-a-date" as unknown as Date,
        },
      };
      // Should not throw - bad date is treated as undefined
      expect(() => service.format(evidenceWithBadDate, "apa")).not.toThrow();
    });
  });
});


