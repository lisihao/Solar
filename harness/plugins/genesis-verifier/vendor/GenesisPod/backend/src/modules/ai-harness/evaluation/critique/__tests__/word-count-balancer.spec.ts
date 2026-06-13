import { balanceTargetWords } from "../word-count-balancer";

describe("balanceTargetWords (harness 沉淀)", () => {
  it("returns empty result when input is empty", () => {
    const r = balanceTargetWords({});
    expect(r.targetWords).toEqual({});
    expect(r.normalized).toBe(false);
  });

  it("does not modify already-balanced input", () => {
    const r = balanceTargetWords({ s1: 1000, s2: 1100, s3: 900 });
    expect(r.normalized).toBe(false);
  });

  it("clamps tiny values up to fallbackTarget(median)", () => {
    const r = balanceTargetWords({
      s1: 100,
      s2: 1000,
      s3: 1000,
      s4: 1100,
    });
    expect(r.normalized).toBe(true);
    expect(r.targetWords.s1).toBeGreaterThanOrEqual(800);
    expect(r.stats.countClampedDown).toBe(1);
  });

  it("clamps huge values down to maxAllowed", () => {
    const r = balanceTargetWords({
      s1: 1000,
      s2: 1100,
      s3: 1200,
      s4: 50000,
    });
    expect(r.normalized).toBe(true);
    expect(r.targetWords.s4).toBeLessThanOrEqual(12000);
    expect(r.stats.countClampedUp).toBe(1);
  });

  it("respects custom absoluteMax option", () => {
    const r = balanceTargetWords({ s1: 5000, s2: 5000, s3: 99999 }, 1000, {
      absoluteMax: 6000,
    });
    expect(r.targetWords.s3).toBeLessThanOrEqual(6000);
  });

  it("respects custom fallbackTarget option", () => {
    const r = balanceTargetWords({ s1: 100, s2: 1000, s3: 1000 }, 1000, {
      fallbackTarget: () => 1500,
    });
    expect(r.targetWords.s1).toBe(1500);
  });

  it("handles 0 / undefined values via fallback", () => {
    const r = balanceTargetWords({
      s1: 1000,
      s2: 1000,
      s3: 0,
      s4: undefined as unknown as number,
    });
    expect(r.targetWords.s3).toBeGreaterThanOrEqual(800);
    expect(r.targetWords.s4).toBeGreaterThanOrEqual(800);
  });

  it("median picks upper-middle on even-length", () => {
    const r = balanceTargetWords({ s1: 100, s2: 200, s3: 1000, s4: 2000 });
    expect(r.stats.median).toBe(1000);
  });
});
