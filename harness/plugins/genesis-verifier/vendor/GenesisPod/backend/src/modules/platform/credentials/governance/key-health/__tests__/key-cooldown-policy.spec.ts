import {
  KEY_COOLDOWN_MS,
  cooldownMsForCode,
  isPermanentCooldown,
} from "../key-cooldown-policy";

describe("key-cooldown-policy (W1 共享熔断策略)", () => {
  describe("cooldownMsForCode", () => {
    it("AUTH_FAILED / 配额耗尽 / 解密失败 → 永久熔断", () => {
      for (const code of [
        "AUTH_FAILED",
        "QUOTA_EXCEEDED",
        "QUOTA_EXHAUSTED",
        "DECRYPTION_FAILED",
      ]) {
        expect(cooldownMsForCode(code)).toBe(KEY_COOLDOWN_MS.INFINITE);
        expect(isPermanentCooldown(cooldownMsForCode(code))).toBe(true);
      }
    });

    it("限流类 → 60s", () => {
      for (const code of [
        "RATE_LIMIT_KEY",
        "RATE_LIMIT",
        "RATE_LIMIT_PROVIDER",
      ]) {
        expect(cooldownMsForCode(code)).toBe(KEY_COOLDOWN_MS.RATE_LIMIT);
      }
    });

    it("超时 → 30s 短冷却", () => {
      expect(cooldownMsForCode("TIMEOUT")).toBe(KEY_COOLDOWN_MS.SHORT);
    });

    it("provider 故障 / 网络错误 → 5min", () => {
      for (const code of ["PROVIDER_DOWN", "PROVIDER_5XX", "NETWORK_ERROR"]) {
        expect(cooldownMsForCode(code)).toBe(
          KEY_COOLDOWN_MS.PROVIDER_OR_UNKNOWN,
        );
      }
    });

    it("大小写不敏感", () => {
      expect(cooldownMsForCode("auth_failed")).toBe(KEY_COOLDOWN_MS.INFINITE);
    });

    it("null / 空 / 未知码 → 保守 5min（保持 secret_keys 旧默认，不至永久熔断）", () => {
      for (const code of [null, undefined, "", "WHATEVER"]) {
        expect(cooldownMsForCode(code)).toBe(
          KEY_COOLDOWN_MS.PROVIDER_OR_UNKNOWN,
        );
        expect(isPermanentCooldown(cooldownMsForCode(code))).toBe(false);
      }
    });
  });

  describe("isPermanentCooldown", () => {
    it("仅 INFINITE 为永久", () => {
      expect(isPermanentCooldown(KEY_COOLDOWN_MS.INFINITE)).toBe(true);
      expect(isPermanentCooldown(KEY_COOLDOWN_MS.RATE_LIMIT)).toBe(false);
      expect(isPermanentCooldown(0)).toBe(false);
    });
  });
});
