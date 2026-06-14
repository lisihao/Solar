import { clampScore, scaleScore } from "../quality-score.utils";

describe("quality-score.utils", () => {
  describe("clampScore", () => {
    it("returns valid 0-100 number unchanged (rounded)", () => {
      expect(clampScore(50)).toBe(50);
      expect(clampScore(0)).toBe(0);
      expect(clampScore(100)).toBe(100);
    });

    it("rounds floats", () => {
      expect(clampScore(72.4)).toBe(72);
      expect(clampScore(72.6)).toBe(73);
      expect(clampScore(99.9)).toBe(100);
    });

    it("clamps negative to 0", () => {
      expect(clampScore(-1)).toBe(0);
      expect(clampScore(-999)).toBe(0);
    });

    it("clamps > 100 to 100", () => {
      expect(clampScore(101)).toBe(100);
      expect(clampScore(9999)).toBe(100);
    });

    it("returns 0 for NaN / Infinity / -Infinity", () => {
      expect(clampScore(NaN)).toBe(0);
      expect(clampScore(Infinity)).toBe(0);
      expect(clampScore(-Infinity)).toBe(0);
    });

    it("returns 0 for non-number inputs (string / null / undefined / object)", () => {
      expect(clampScore("80" as unknown)).toBe(0);
      expect(clampScore(null as unknown)).toBe(0);
      expect(clampScore(undefined as unknown)).toBe(0);
      expect(clampScore({ score: 80 } as unknown)).toBe(0);
      expect(clampScore([80] as unknown)).toBe(0);
    });
  });

  describe("scaleScore", () => {
    it("multiplies and clamps to 0-100 integer", () => {
      expect(scaleScore(80, 0.5)).toBe(40);
      expect(scaleScore(80, 0.7)).toBe(56);
      expect(scaleScore(50, 1.5)).toBe(75);
    });

    it("clamps result > 100", () => {
      expect(scaleScore(80, 2)).toBe(100);
      expect(scaleScore(100, 10)).toBe(100);
    });

    it("clamps result < 0 (negative factor)", () => {
      expect(scaleScore(80, -0.5)).toBe(0);
    });

    it("treats non-number current as 0", () => {
      expect(scaleScore(undefined as unknown, 0.7)).toBe(0);
      expect(scaleScore(null as unknown, 0.7)).toBe(0);
      expect(scaleScore("80" as unknown, 0.7)).toBe(0);
      expect(scaleScore(NaN, 0.7)).toBe(0);
    });

    it("rounds final value", () => {
      // 85 * 0.7 = 59.499999... (JS 浮点) → Math.round → 59
      expect(scaleScore(85, 0.7)).toBe(59);
      // 85 * 0.6 = 51 (精确) → 51
      expect(scaleScore(85, 0.6)).toBe(51);
      // 50 * 0.5 = 25 (精确) → 25
      expect(scaleScore(50, 0.5)).toBe(25);
    });
  });
});
