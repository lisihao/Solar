import {
  computeSupplyBudget,
  deriveMaxDemandSlots,
  deriveMinPerSlot,
  extractGroupFromUrlOrText,
} from "../business-team-supply-budget.helper";

describe("business-team-supply-budget", () => {
  describe("extractGroupFromUrlOrText", () => {
    it("extracts hostname from URL and strips www.", () => {
      expect(
        extractGroupFromUrlOrText("https://www.nytimes.com/2025/11/x.html"),
      ).toBe("nytimes.com");
      expect(extractGroupFromUrlOrText("http://research.gatech.edu/foo")).toBe(
        "research.gatech.edu",
      );
    });

    it("treats a bare domain as a domain", () => {
      expect(extractGroupFromUrlOrText("aip.org")).toBe("aip.org");
    });

    it("falls back to lowercased text for non-URL input", () => {
      expect(extractGroupFromUrlOrText("DOE announcement 2025")).toBe(
        "doe announcement 2025",
      );
    });

    it("returns empty string for empty / whitespace input", () => {
      expect(extractGroupFromUrlOrText("")).toBe("");
      expect(extractGroupFromUrlOrText("   ")).toBe("");
    });
  });

  describe("computeSupplyBudget (generic, with source-string adapter)", () => {
    const keyOf = (f: { source: string }) => f.source;
    const groupOf = (f: { source: string }) =>
      extractGroupFromUrlOrText(f.source);

    it("counts unique keys and groups (3 sources / 2 domains)", () => {
      const b = computeSupplyBudget(
        [
          { source: "https://aip.org/a" },
          { source: "https://aip.org/b" },
          { source: "https://research.gatech.edu/x" },
        ],
        keyOf,
        groupOf,
      );
      expect(b.totalItems).toBe(3);
      expect(b.uniqueKeys).toBe(3);
      expect(b.uniqueGroups).toBe(2);
    });

    it("reproduces 5-findings-1-domain trace (the bug that triggered the redesign)", () => {
      const b = computeSupplyBudget(
        Array.from({ length: 5 }, (_, i) => ({
          source: `https://timesfreepress.com/${i}`,
        })),
        keyOf,
        groupOf,
      );
      expect(b.uniqueKeys).toBe(5);
      expect(b.uniqueGroups).toBe(1);
    });

    it("ignores blank / whitespace keys", () => {
      const b = computeSupplyBudget(
        [{ source: "https://a.com/x" }, { source: "" }, { source: "   " }],
        keyOf,
        groupOf,
      );
      expect(b.uniqueKeys).toBe(1);
    });

    it("works with any TItem shape (e.g. radar source token / social platform id)", () => {
      const items = [
        { sourceId: "rss-1", platform: "wechat" },
        { sourceId: "rss-2", platform: "wechat" },
        { sourceId: "rss-3", platform: "douyin" },
      ];
      const b = computeSupplyBudget(
        items,
        (it) => it.sourceId,
        (it) => it.platform,
      );
      expect(b.uniqueKeys).toBe(3);
      expect(b.uniqueGroups).toBe(2);
    });
  });

  describe("deriveMaxDemandSlots", () => {
    it("caps thin supply: 5 unique keys → ≤2 slots (not 7)", () => {
      const b = { uniqueKeys: 5, uniqueGroups: 1, totalItems: 5 };
      expect(deriveMaxDemandSlots(b, 7)).toBe(2);
    });

    it("never returns 0 even with <2 unique keys", () => {
      expect(
        deriveMaxDemandSlots(
          { uniqueKeys: 1, uniqueGroups: 1, totalItems: 1 },
          7,
        ),
      ).toBe(1);
      expect(
        deriveMaxDemandSlots(
          { uniqueKeys: 0, uniqueGroups: 0, totalItems: 0 },
          7,
        ),
      ).toBe(1);
    });

    it("does not inflate beyond idealSlots when supply is rich", () => {
      const b = { uniqueKeys: 40, uniqueGroups: 20, totalItems: 50 };
      expect(deriveMaxDemandSlots(b, 7)).toBe(7);
    });

    it("honours quality floor when supply allows: 4 keys, min 4 → 4 (not 2)", () => {
      const b = { uniqueKeys: 4, uniqueGroups: 4, totalItems: 4 };
      expect(deriveMaxDemandSlots(b, 7, 4)).toBe(4);
    });

    it("floor never creates 0-supply slots: 2 keys, min 4 → 2", () => {
      const b = { uniqueKeys: 2, uniqueGroups: 2, totalItems: 2 };
      expect(deriveMaxDemandSlots(b, 7, 4)).toBe(2);
    });

    it("floor never exceeds idealSlots: ideal 2, min 4, rich supply → 2", () => {
      const b = { uniqueKeys: 40, uniqueGroups: 20, totalItems: 50 };
      expect(deriveMaxDemandSlots(b, 2, 4)).toBe(2);
    });

    it("zero supply with floor set still returns 1", () => {
      const b = { uniqueKeys: 0, uniqueGroups: 0, totalItems: 0 };
      expect(deriveMaxDemandSlots(b, 7, 4)).toBe(1);
    });
  });

  describe("deriveMinPerSlot", () => {
    it("standard 2 when slot has ≥2 items", () => {
      expect(deriveMinPerSlot(2)).toBe(2);
      expect(deriveMinPerSlot(5)).toBe(2);
    });

    it("drops to 1 when slot has exactly 1 item (inversion-fix)", () => {
      expect(deriveMinPerSlot(1)).toBe(1);
    });

    it("returns 0 when slot has 0 items (no source = no citation required)", () => {
      expect(deriveMinPerSlot(0)).toBe(0);
    });

    it("negative / fractional inputs are clamped via Math.floor + max-0", () => {
      expect(deriveMinPerSlot(-3)).toBe(0);
      expect(deriveMinPerSlot(1.7)).toBe(1);
    });
  });
});
