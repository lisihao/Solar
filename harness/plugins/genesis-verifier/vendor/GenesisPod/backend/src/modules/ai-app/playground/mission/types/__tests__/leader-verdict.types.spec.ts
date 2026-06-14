/**
 * leader-verdict.types.ts spec — R2 共识 P1 (tester R2, 2026-05-07)
 *
 * 反向证据：
 *   1. LEADER_VERDICT_AUTO_RERUN_RECOVERED 字面量 = 'auto-rerun-recovered'
 *   2. isAutoRerunRecovered("auto-rerun-recovered") → true
 *   3. isAutoRerunRecovered("signed-pass") → false
 *   4. isAutoRerunRecovered("acceptable") → false（向后兼容旧值）
 *   5. isAutoRerunRecovered(null) → false
 *   6. isAutoRerunRecovered(undefined) → false
 *   7. isAutoRerunRecovered("") → false
 */

import {
  LEADER_VERDICT_AUTO_RERUN_RECOVERED,
  LEADER_VERDICT_SIGNED_PASS,
  LEADER_VERDICT_SIGNED_FAIL,
  isAutoRerunRecovered,
} from "../leader-verdict.types";

describe("leader-verdict.types", () => {
  describe("常量字面量值", () => {
    it("LEADER_VERDICT_AUTO_RERUN_RECOVERED = 'auto-rerun-recovered'", () => {
      expect(LEADER_VERDICT_AUTO_RERUN_RECOVERED).toBe("auto-rerun-recovered");
    });

    it("LEADER_VERDICT_SIGNED_PASS = 'signed-pass'", () => {
      expect(LEADER_VERDICT_SIGNED_PASS).toBe("signed-pass");
    });

    it("LEADER_VERDICT_SIGNED_FAIL = 'signed-fail'", () => {
      expect(LEADER_VERDICT_SIGNED_FAIL).toBe("signed-fail");
    });
  });

  describe("isAutoRerunRecovered helper", () => {
    it("'auto-rerun-recovered' → true", () => {
      expect(isAutoRerunRecovered(LEADER_VERDICT_AUTO_RERUN_RECOVERED)).toBe(
        true,
      );
    });

    it("'signed-pass' → false", () => {
      expect(isAutoRerunRecovered(LEADER_VERDICT_SIGNED_PASS)).toBe(false);
    });

    it("旧值 'acceptable' → false（向后兼容）", () => {
      expect(isAutoRerunRecovered("acceptable")).toBe(false);
    });

    it("null → false", () => {
      expect(isAutoRerunRecovered(null)).toBe(false);
    });

    it("undefined → false", () => {
      expect(isAutoRerunRecovered(undefined)).toBe(false);
    });

    it("'' 空字符串 → false", () => {
      expect(isAutoRerunRecovered("")).toBe(false);
    });
  });
});
