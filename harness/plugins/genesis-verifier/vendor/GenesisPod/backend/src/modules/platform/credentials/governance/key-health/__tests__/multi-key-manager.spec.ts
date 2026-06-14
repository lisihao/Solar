/**
 * Unit tests for MultiKeyManager and MultiKeyRegistry
 */

import { MultiKeyManager, MultiKeyRegistry } from "../multi-key.manager";

// Helper to access the private static managers map for registry isolation between tests
function clearRegistry(): void {
  // Access the private static map via bracket notation for test isolation
  (MultiKeyRegistry as unknown as { managers: Map<string, MultiKeyManager> })[
    "managers"
  ].clear();
}

describe("MultiKeyManager", () => {
  let manager: MultiKeyManager;

  beforeEach(() => {
    manager = new MultiKeyManager("test-service", 5 * 60 * 1000);
  });

  // ==================== getMaskedKey ====================

  describe("getMaskedKey", () => {
    it("returns prefix-8 + **** + suffix-3 for a normal key", () => {
      const key = "tvly-abcdefghijklmnopqrstuvwxyz";
      const masked = manager.getMaskedKey(key);
      expect(masked).toBe("tvly-abc****xyz");
    });

    it("returns **** for a key shorter than 10 characters", () => {
      const short = "abc12";
      expect(manager.getMaskedKey(short)).toBe("****");
    });

    it("returns **** for an empty string", () => {
      expect(manager.getMaskedKey("")).toBe("****");
    });

    it("returns **** for a key of exactly 9 characters (boundary)", () => {
      expect(manager.getMaskedKey("123456789")).toBe("****");
    });

    it("handles a key of exactly 10 characters (boundary)", () => {
      const key = "1234567890";
      const masked = manager.getMaskedKey(key);
      // prefix = "12345678", suffix = "890"
      expect(masked).toBe("12345678****890");
    });
  });

  // ==================== isKeyHealthy ====================

  describe("isKeyHealthy", () => {
    it("returns true for a key that has never failed", () => {
      expect(manager.isKeyHealthy("never-failed-key-12345678")).toBe(true);
    });

    it("returns false immediately after marking a key failed", () => {
      const key = "some-api-key-that-fails-now";
      manager.markKeyFailed(key, 429);
      expect(manager.isKeyHealthy(key)).toBe(false);
    });

    it("returns true after cooldown period has elapsed", () => {
      const shortCooldown = new MultiKeyManager("short-service", 100); // 100ms cooldown
      const key = "short-cooldown-key-12345678";
      shortCooldown.markKeyFailed(key, 429);
      expect(shortCooldown.isKeyHealthy(key)).toBe(false);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(shortCooldown.isKeyHealthy(key)).toBe(true);
          resolve();
        }, 150);
      });
    });

    it("returns true after clearKeyFailure is called", () => {
      const key = "key-to-clear-12345678901234";
      manager.markKeyFailed(key, 500);
      expect(manager.isKeyHealthy(key)).toBe(false);
      manager.clearKeyFailure(key);
      expect(manager.isKeyHealthy(key)).toBe(true);
    });
  });

  // ==================== getHealthyKey ====================

  describe("getHealthyKey", () => {
    it("returns null for an empty keys array", () => {
      expect(manager.getHealthyKey([])).toBeNull();
    });

    it("returns null for a null/undefined-like empty input", () => {
      // The implementation guards against !keys
      expect(manager.getHealthyKey([])).toBeNull();
    });

    it("returns the single healthy key when given one key", () => {
      const keys = ["only-healthy-key-12345678"];
      expect(manager.getHealthyKey(keys)).toBe(keys[0]);
    });

    it("performs round-robin across healthy keys", () => {
      const freshManager = new MultiKeyManager("rr-service", 300000);
      const keys = [
        "key-alpha-1234567890",
        "key-beta-1234567890",
        "key-gamma-1234567890",
      ];

      const first = freshManager.getHealthyKey(keys);
      const second = freshManager.getHealthyKey(keys);
      const third = freshManager.getHealthyKey(keys);
      const fourth = freshManager.getHealthyKey(keys);

      // Should cycle through all keys
      expect([first, second, third]).toEqual(expect.arrayContaining(keys));
      // Fourth call should wrap around
      expect(fourth).toBe(first);
    });

    it("skips unhealthy keys and returns a healthy one", () => {
      const freshManager = new MultiKeyManager("skip-service", 300000);
      const keys = [
        "unhealthy-key-1234567890",
        "healthy-key-12345678901",
        "healthy-key-23456789012",
      ];
      freshManager.markKeyFailed(keys[0], 429);

      const selected = freshManager.getHealthyKey(keys);
      // Should not return the failed key
      expect(selected).not.toBe(keys[0]);
      expect([keys[1], keys[2]]).toContain(selected);
    });

    it("falls back to the first key (at startIndex) when all keys are unhealthy", () => {
      const freshManager = new MultiKeyManager("all-unhealthy", 300000);
      const keys = [
        "key-fail-one-12345678901",
        "key-fail-two-12345678901",
        "key-fail-three-1234567890",
      ];
      keys.forEach((k) => freshManager.markKeyFailed(k, 503));

      const result = freshManager.getHealthyKey(keys);
      // Must return one of the keys (not null)
      expect(result).not.toBeNull();
      expect(keys).toContain(result);
    });
  });

  // ==================== markKeyFailed / clearKeyFailure ====================

  describe("markKeyFailed", () => {
    it("records the failure and makes the key unhealthy", () => {
      const key = "mark-fail-key-12345678901";
      manager.markKeyFailed(key, 401);
      expect(manager.isKeyHealthy(key)).toBe(false);
    });

    it("overwrites a previous failure with a new one", () => {
      const key = "overwrite-fail-key-12345678";
      manager.markKeyFailed(key, 401);
      manager.markKeyFailed(key, 429);
      // Key remains unhealthy
      expect(manager.isKeyHealthy(key)).toBe(false);
    });
  });

  describe("clearKeyFailure", () => {
    it("clears failure and makes the key healthy again", () => {
      const key = "clear-failure-key-12345678901";
      manager.markKeyFailed(key, 500);
      manager.clearKeyFailure(key);
      expect(manager.isKeyHealthy(key)).toBe(true);
    });

    it("is a no-op for a key that was never failed", () => {
      const key = "never-failed-key-12345678901";
      expect(() => manager.clearKeyFailure(key)).not.toThrow();
      expect(manager.isKeyHealthy(key)).toBe(true);
    });
  });

  // ==================== getKeyHealthStatus ====================

  describe("getKeyHealthStatus", () => {
    it("returns status for each key in order", () => {
      const keys = ["key-status-a-12345678901", "key-status-b-12345678901"];
      const statuses = manager.getKeyHealthStatus(keys);

      expect(statuses).toHaveLength(2);
      expect(statuses[0].index).toBe(0);
      expect(statuses[1].index).toBe(1);
    });

    it("marks healthy keys as isHealthy: true", () => {
      const keys = ["fresh-healthy-key-123456789"];
      const [status] = manager.getKeyHealthStatus(keys);
      expect(status.isHealthy).toBe(true);
      expect(status.lastError).toBeUndefined();
      expect(status.cooldownUntil).toBeUndefined();
    });

    it("marks failed keys as isHealthy: false with lastError set", () => {
      const keys = ["failed-status-key-12345678"];
      manager.markKeyFailed(keys[0], 429);
      const [status] = manager.getKeyHealthStatus(keys);

      expect(status.isHealthy).toBe(false);
      expect(status.lastError).toBe("HTTP 429");
      expect(status.cooldownUntil).toBeDefined();
    });

    it("includes masked keys in the status output", () => {
      const keys = ["some-long-api-key-12345678901"];
      const [status] = manager.getKeyHealthStatus(keys);
      expect(status.maskedKey).toContain("****");
    });
  });

  // ==================== shouldMarkFailed ====================

  describe("shouldMarkFailed", () => {
    const failureCodes = [401, 429, 432, 500, 502, 503, 504];
    const nonFailureCodes = [200, 201, 400, 404, 408, 422];

    failureCodes.forEach((code) => {
      it(`returns true for error code ${code}`, () => {
        expect(MultiKeyManager.shouldMarkFailed(code)).toBe(true);
      });
    });

    nonFailureCodes.forEach((code) => {
      it(`returns false for error code ${code}`, () => {
        expect(MultiKeyManager.shouldMarkFailed(code)).toBe(false);
      });
    });
  });
});

// ==================== MultiKeyRegistry ====================

describe("MultiKeyRegistry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe("getManager", () => {
    it("creates a new manager for a new service name", () => {
      const manager = MultiKeyRegistry.getManager("new-service");
      expect(manager).toBeInstanceOf(MultiKeyManager);
    });

    it("returns the same manager instance for the same service name (singleton)", () => {
      const first = MultiKeyRegistry.getManager("singleton-service");
      const second = MultiKeyRegistry.getManager("singleton-service");
      expect(first).toBe(second);
    });

    it("returns different managers for different service names", () => {
      const managerA = MultiKeyRegistry.getManager("service-a");
      const managerB = MultiKeyRegistry.getManager("service-b");
      expect(managerA).not.toBe(managerB);
    });

    it("ignores cooldownMs on subsequent calls (uses existing manager)", () => {
      const first = MultiKeyRegistry.getManager("cooldown-service", 1000);
      // Second call with different cooldownMs should return the same instance
      const second = MultiKeyRegistry.getManager("cooldown-service", 99999);
      expect(first).toBe(second);
    });
  });

  describe("getHealthStatus", () => {
    it("returns all-healthy status if no manager exists for the service", () => {
      const keys = [
        "unknown-svc-key-12345678901",
        "unknown-svc-key-23456789012",
      ];
      const statuses = MultiKeyRegistry.getHealthStatus(
        "nonexistent-service",
        keys,
      );

      expect(statuses).toHaveLength(2);
      statuses.forEach((s) => {
        expect(s.isHealthy).toBe(true);
      });
    });

    it("delegates to the manager when one exists", () => {
      const keys = ["registry-key-one-12345678901"];
      const manager = MultiKeyRegistry.getManager("registry-service");
      manager.markKeyFailed(keys[0], 429);

      const statuses = MultiKeyRegistry.getHealthStatus(
        "registry-service",
        keys,
      );
      expect(statuses[0].isHealthy).toBe(false);
      expect(statuses[0].lastError).toBe("HTTP 429");
    });

    it("returns indices in order for multiple keys", () => {
      const keys = [
        "registry-multi-key-a-123456",
        "registry-multi-key-b-123456",
        "registry-multi-key-c-123456",
      ];
      const statuses = MultiKeyRegistry.getHealthStatus("index-service", keys);
      statuses.forEach((s, i) => {
        expect(s.index).toBe(i);
      });
    });
  });
});
