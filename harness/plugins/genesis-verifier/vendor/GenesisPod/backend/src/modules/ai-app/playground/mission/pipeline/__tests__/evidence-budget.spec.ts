import {
  computeEvidenceBudget,
  deriveMaxChapters,
  deriveCitationFloor,
  extractDomain,
} from "../../artifacts/evidence-budget";

describe("evidence-budget", () => {
  describe("extractDomain", () => {
    it("extracts hostname from a URL and strips www.", () => {
      expect(extractDomain("https://www.nytimes.com/2025/11/x.html")).toBe(
        "nytimes.com",
      );
      expect(extractDomain("http://research.gatech.edu/foo")).toBe(
        "research.gatech.edu",
      );
    });

    it("treats a bare domain as a domain", () => {
      expect(extractDomain("aip.org")).toBe("aip.org");
    });

    it("falls back to the source string for non-URL text", () => {
      expect(extractDomain("DOE announcement 2025")).toBe(
        "doe announcement 2025",
      );
    });

    it("returns empty for empty input", () => {
      expect(extractDomain("")).toBe("");
      expect(extractDomain("   ")).toBe("");
    });
  });

  describe("computeEvidenceBudget", () => {
    it("counts unique sources and domains", () => {
      const budget = computeEvidenceBudget([
        { source: "https://aip.org/a" },
        { source: "https://aip.org/b" }, // same domain, diff source
        { source: "https://research.gatech.edu/x" },
      ]);
      expect(budget.totalFindings).toBe(3);
      expect(budget.uniqueSources).toBe(3);
      expect(budget.uniqueDomains).toBe(2); // aip.org + research.gatech.edu
    });

    it("reproduces the failing trace: 5 findings, ~1 domain", () => {
      const budget = computeEvidenceBudget([
        { source: "https://timesfreepress.com/a" },
        { source: "https://timesfreepress.com/b" },
        { source: "https://timesfreepress.com/c" },
        { source: "https://timesfreepress.com/d" },
        { source: "https://timesfreepress.com/e" },
      ]);
      expect(budget.uniqueSources).toBe(5);
      expect(budget.uniqueDomains).toBe(1);
    });

    it("ignores blank sources", () => {
      const budget = computeEvidenceBudget([
        { source: "https://a.com/x" },
        { source: "" },
        { source: "   " },
      ]);
      expect(budget.uniqueSources).toBe(1);
    });
  });

  describe("deriveMaxChapters", () => {
    it("caps thin supply: 5 unique sources → ≤2 chapters (not 7)", () => {
      const budget = computeEvidenceBudget(
        Array.from({ length: 5 }, (_, i) => ({ source: `https://x.com/${i}` })),
      );
      expect(deriveMaxChapters(budget, 7)).toBe(2);
    });

    it("never returns 0 even with <2 sources", () => {
      expect(
        deriveMaxChapters(
          { uniqueSources: 1, uniqueDomains: 1, totalFindings: 1 },
          7,
        ),
      ).toBe(1);
      expect(
        deriveMaxChapters(
          { uniqueSources: 0, uniqueDomains: 0, totalFindings: 0 },
          7,
        ),
      ).toBe(1);
    });

    it("does not inflate beyond ideal when supply is rich", () => {
      const budget = {
        uniqueSources: 40,
        uniqueDomains: 20,
        totalFindings: 50,
      };
      expect(deriveMaxChapters(budget, 7)).toBe(7);
    });

    it("minChapters defaults to 1 (backward compatible)", () => {
      const budget = computeEvidenceBudget(
        Array.from({ length: 5 }, (_, i) => ({ source: `https://x.com/${i}` })),
      );
      expect(deriveMaxChapters(budget, 7)).toBe(2);
    });

    it("honors a quality floor when supply allows: 4 sources, min 4 → 4 (not 2)", () => {
      const budget = computeEvidenceBudget(
        Array.from({ length: 4 }, (_, i) => ({ source: `https://x.com/${i}` })),
      );
      expect(deriveMaxChapters(budget, 7, 4)).toBe(4);
    });

    it("never lets the floor create 0-source chapters: 2 sources, min 4 → 2", () => {
      const budget = { uniqueSources: 2, uniqueDomains: 2, totalFindings: 2 };
      expect(deriveMaxChapters(budget, 7, 4)).toBe(2);
    });

    it("floor never exceeds ideal: ideal 2, min 4, rich supply → 2", () => {
      const budget = {
        uniqueSources: 40,
        uniqueDomains: 20,
        totalFindings: 50,
      };
      expect(deriveMaxChapters(budget, 2, 4)).toBe(2);
    });

    it("still returns 1 with zero supply even when a floor is set", () => {
      const budget = { uniqueSources: 0, uniqueDomains: 0, totalFindings: 0 };
      expect(deriveMaxChapters(budget, 7, 4)).toBe(1);
    });
  });

  describe("deriveCitationFloor", () => {
    it("standard floor is 2 when chapter has ≥2 sources", () => {
      expect(deriveCitationFloor(2)).toBe(2);
      expect(deriveCitationFloor(5)).toBe(2);
    });

    it("drops to 1 when chapter has only 1 source (the inversion fix)", () => {
      expect(deriveCitationFloor(1)).toBe(1);
    });

    it("requires no citation when chapter has 0 sources", () => {
      expect(deriveCitationFloor(0)).toBe(0);
    });
  });
});
