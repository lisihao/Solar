import { normalizeTargetWords } from "../../artifacts/word-count-normalizer.util";

describe("normalizeTargetWords (Phase 1, TI port)", () => {
  it("returns empty result when input is empty", () => {
    const r = normalizeTargetWords({});
    expect(r.targetWords).toEqual({});
    expect(r.normalized).toBe(false);
  });

  it("does not modify already-balanced input", () => {
    const r = normalizeTargetWords({ s1: 1000, s2: 1100, s3: 900 });
    expect(r.normalized).toBe(false);
    expect(r.targetWords).toEqual({ s1: 1000, s2: 1100, s3: 900 });
  });

  it("clamps extremely small values up to median (>= 800)", () => {
    const r = normalizeTargetWords({
      s1: 100,
      s2: 1000,
      s3: 1000,
      s4: 1100,
    });
    expect(r.normalized).toBe(true);
    expect(r.targetWords.s1).toBeGreaterThanOrEqual(800);
    expect(r.stats.countClampedDown).toBe(1);
  });

  it("clamps extremely large values down to maxAllowed", () => {
    const r = normalizeTargetWords({
      s1: 1000,
      s2: 1100,
      s3: 1200,
      s4: 50000, // 远超合理范围
    });
    expect(r.normalized).toBe(true);
    expect(r.targetWords.s4).toBeLessThanOrEqual(8000);
    expect(r.stats.countClampedUp).toBe(1);
  });

  it("rescues 0 / undefined with median", () => {
    const r = normalizeTargetWords({
      s1: 1000,
      s2: 1000,
      s3: 0,
      s4: undefined as unknown as number,
    });
    expect(r.targetWords.s3).toBeGreaterThanOrEqual(800);
    expect(r.targetWords.s4).toBeGreaterThanOrEqual(800);
  });

  it("respects ABSOLUTE_MAX = 12000 even when median is huge", () => {
    const r = normalizeTargetWords({
      s1: 10000,
      s2: 10000,
      s3: 10000,
      s4: 99999,
    });
    expect(r.targetWords.s4).toBeLessThanOrEqual(12000);
  });

  it("median of 4 values picks the upper-middle (sort[len/2])", () => {
    const r = normalizeTargetWords({
      s1: 100,
      s2: 200,
      s3: 1000,
      s4: 2000,
    });
    expect(r.stats.median).toBe(1000); // sorted=[100,200,1000,2000], idx=2 → 1000
  });

  it("epic mega scenario — 8 chapters of 12K cap", () => {
    const r = normalizeTargetWords({
      s1: 25000, // 超 cap
      s2: 25000,
      s3: 25000,
      s4: 25000,
      s5: 25000,
      s6: 25000,
      s7: 25000,
      s8: 25000,
    });
    expect(r.normalized).toBe(true);
    // 全都被 clamp 到 12000 以内
    for (const v of Object.values(r.targetWords)) {
      expect(v).toBeLessThanOrEqual(12000);
    }
  });
});
