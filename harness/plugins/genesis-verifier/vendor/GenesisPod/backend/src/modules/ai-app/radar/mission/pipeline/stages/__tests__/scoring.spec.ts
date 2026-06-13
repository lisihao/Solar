import {
  computeAuthority,
  computeEngagement,
  computeFreshness,
  computeStageAScore,
  selectCandidatePool,
  STAGE_A_WEIGHTS,
} from "../scoring";

describe("scoring (B1 Stage A)", () => {
  describe("computeAuthority", () => {
    it("maps 5★ to 1.0", () => {
      expect(computeAuthority(5)).toBe(1);
    });
    it("maps 3★ to 0.6", () => {
      expect(computeAuthority(3)).toBeCloseTo(0.6, 5);
    });
    it("falls back to 0.2 for null/undefined/out-of-range", () => {
      expect(computeAuthority(null)).toBeCloseTo(0.2, 5);
      expect(computeAuthority(undefined)).toBeCloseTo(0.2, 5);
      expect(computeAuthority(0)).toBeCloseTo(0.2, 5);
      expect(computeAuthority(99)).toBeCloseTo(0.2, 5);
    });
  });

  describe("computeFreshness", () => {
    it("returns 1.0 for now", () => {
      expect(computeFreshness(new Date())).toBeCloseTo(1, 1);
    });
    it("decays to 0.5 at 24h", () => {
      const t = new Date(Date.now() - 24 * 3_600_000);
      expect(computeFreshness(t)).toBeCloseTo(0.5, 1);
    });
    it("decays to 0.25 at 48h", () => {
      const t = new Date(Date.now() - 48 * 3_600_000);
      expect(computeFreshness(t)).toBeCloseTo(0.25, 1);
    });
    it("returns 1 for future timestamp (NTP skew tolerant)", () => {
      const future = new Date(Date.now() + 3_600_000);
      expect(computeFreshness(future)).toBe(1);
    });
    it("returns 0 for invalid date", () => {
      expect(computeFreshness("not-a-date")).toBe(0);
    });
  });

  describe("computeEngagement", () => {
    it("returns 0 when metrics null/empty", () => {
      expect(computeEngagement(null)).toBe(0);
      expect(computeEngagement({})).toBe(0);
      expect(computeEngagement({ views: 0 })).toBe(0);
    });
    it("scales log10: 100 → ~0.1, 1k → ~0.3, 1M → ~1.0", () => {
      expect(computeEngagement({ views: 100 })).toBeCloseTo(0.34, 1);
      expect(computeEngagement({ views: 1000 })).toBeCloseTo(0.5, 1);
      expect(computeEngagement({ views: 1_000_000 })).toBeCloseTo(1, 1);
    });
    it("handles string views (defensive against JSONB parsing)", () => {
      expect(computeEngagement({ views: "1000" })).toBeCloseTo(0.5, 1);
    });
  });

  describe("computeStageAScore", () => {
    const baseItem = {
      id: "item-1",
      publishedAt: new Date(),
      metrics: { views: 1000 },
    };
    const baseSource = { id: "source-1", authorityWeight: 5 };

    it("combines 5 components with documented weights", () => {
      const result = computeStageAScore({
        item: baseItem,
        source: baseSource,
        relevanceScore: 100,
        qualityScore: 100,
      });
      // all 5 max → 1.0; partial freshness/engagement reduce slightly
      expect(result.score).toBeGreaterThan(0.85);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.components.relevance).toBe(1);
      expect(result.components.quality).toBe(1);
      expect(result.components.authority).toBe(1);
    });

    it("low-quality content gets low score (mostly relevance/quality)", () => {
      const result = computeStageAScore({
        item: baseItem,
        source: { id: "source-1", authorityWeight: 1 },
        relevanceScore: 10,
        qualityScore: 10,
      });
      // 0.35*0.1 + 0.25*0.1 + 0.15*0.2 + freshness + engagement ≈ 0.06 + 0.03 + 0.5*0.15 + 0.5*0.1
      expect(result.score).toBeLessThan(0.3);
    });

    it("normalizes 0-100 LLM scores into 0-1 components", () => {
      const result = computeStageAScore({
        item: baseItem,
        source: baseSource,
        relevanceScore: 80,
        qualityScore: 90,
      });
      expect(result.components.relevance).toBeCloseTo(0.8, 5);
      expect(result.components.quality).toBeCloseTo(0.9, 5);
    });

    it("treats missing LLM scores as 0 (defensive)", () => {
      const result = computeStageAScore({
        item: baseItem,
        source: baseSource,
      });
      expect(result.components.relevance).toBe(0);
      expect(result.components.quality).toBe(0);
    });
  });

  describe("selectCandidatePool", () => {
    it("filters by threshold + sorts desc + caps at max", () => {
      const inputs = Array.from({ length: 30 }, (_, i) => ({
        item: {
          id: `i-${i}`,
          publishedAt: new Date(),
          metrics: { views: i * 100 },
        },
        source: { id: `s-${i}`, authorityWeight: 5 },
        relevanceScore: 50 + i,
        qualityScore: 50 + i,
      }));
      const pool = selectCandidatePool(inputs, { threshold: 0.5, max: 5 });
      expect(pool).toHaveLength(5);
      // descending order check
      for (let i = 1; i < pool.length; i++) {
        expect(pool[i - 1].score).toBeGreaterThanOrEqual(pool[i].score);
      }
    });

    it("returns empty when no item crosses threshold (宁缺勿滥)", () => {
      const inputs = [
        {
          item: { id: "i-1", publishedAt: new Date(), metrics: null },
          source: { id: "s-1", authorityWeight: 1 },
          relevanceScore: 5,
          qualityScore: 5,
        },
      ];
      const pool = selectCandidatePool(inputs);
      expect(pool).toHaveLength(0);
    });

    it("weights sum to 1.0 (sanity)", () => {
      const sum =
        STAGE_A_WEIGHTS.relevance +
        STAGE_A_WEIGHTS.quality +
        STAGE_A_WEIGHTS.authority +
        STAGE_A_WEIGHTS.freshness +
        STAGE_A_WEIGHTS.engagement;
      expect(sum).toBeCloseTo(1, 5);
    });
  });
});
