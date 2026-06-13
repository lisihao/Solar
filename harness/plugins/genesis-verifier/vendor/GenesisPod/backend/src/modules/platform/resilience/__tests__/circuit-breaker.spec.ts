import { CircuitBreaker, isCooldownFailure } from "../circuit-breaker";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const makeBreaker = (
    overrides: Partial<{
      thresholdCount: number;
      cooldownMs: number;
      windowMs: number;
    }> = {},
  ) =>
    new CircuitBreaker({
      name: "test",
      thresholdCount: 3,
      cooldownMs: 5_000,
      windowMs: 1_000,
      ...overrides,
    });

  describe("initial state", () => {
    it("starts closed (not open)", () => {
      expect(makeBreaker().isOpen()).toBe(false);
    });

    it("exposes name from options", () => {
      expect(makeBreaker().name).toBe("test");
    });

    it("openUntil is 0 before any trip", () => {
      expect(makeBreaker().openUntil).toBe(0);
    });

    it("currentFailures is 0 initially", () => {
      expect(makeBreaker().currentFailures).toBe(0);
    });
  });

  describe("threshold tripping", () => {
    it("does not open before reaching threshold", () => {
      const b = makeBreaker({ thresholdCount: 3 });
      b.recordFailure();
      b.recordFailure();
      expect(b.isOpen()).toBe(false);
      expect(b.currentFailures).toBe(2);
    });

    it("opens exactly at threshold", () => {
      const b = makeBreaker({ thresholdCount: 3 });
      b.recordFailure();
      b.recordFailure();
      b.recordFailure();
      expect(b.isOpen()).toBe(true);
      expect(b.openUntil).toBe(5_000);
    });

    it("thresholdCount=1 trips on first failure (e.g. 401 non-retryable)", () => {
      const b = makeBreaker({ thresholdCount: 1 });
      b.recordFailure();
      expect(b.isOpen()).toBe(true);
    });

    it("clears failure timestamps after tripping (no repeated re-trip)", () => {
      const b = makeBreaker({ thresholdCount: 3 });
      b.recordFailure();
      b.recordFailure();
      b.recordFailure();
      // after trip the internal window was cleared
      expect(b.currentFailures).toBe(0);
    });
  });

  describe("sliding window", () => {
    it("drops failures older than windowMs so threshold is not reached", () => {
      const b = makeBreaker({ thresholdCount: 3, windowMs: 1_000 });
      b.recordFailure(); // t=0
      jest.setSystemTime(600);
      b.recordFailure(); // t=600
      jest.setSystemTime(1_200); // first failure (t=0) now outside 1s window
      b.recordFailure(); // t=1200 -> window holds [600, 1200] = 2 < 3
      expect(b.isOpen()).toBe(false);
      expect(b.currentFailures).toBe(2);
    });

    it("trips when 3 failures land within the window", () => {
      const b = makeBreaker({ thresholdCount: 3, windowMs: 1_000 });
      b.recordFailure();
      jest.setSystemTime(300);
      b.recordFailure();
      jest.setSystemTime(600);
      b.recordFailure();
      expect(b.isOpen()).toBe(true);
    });

    it("currentFailures reflects only in-window timestamps", () => {
      const b = makeBreaker({ thresholdCount: 5, windowMs: 1_000 });
      b.recordFailure(); // t=0
      jest.setSystemTime(2_000);
      // t=0 is now far outside window
      expect(b.currentFailures).toBe(0);
    });
  });

  describe("cooldown expiry", () => {
    it("stays open during cooldown then closes after it elapses", () => {
      const b = makeBreaker({ thresholdCount: 1, cooldownMs: 5_000 });
      b.recordFailure(); // opens until t=5000
      expect(b.isOpen()).toBe(true);
      jest.setSystemTime(4_999);
      expect(b.isOpen()).toBe(true);
      jest.setSystemTime(5_000);
      // Date.now() < openUntilMs is false at exactly openUntil
      expect(b.isOpen()).toBe(false);
    });

    it("isOpen lazily GCs stale failures once cooldown passed", () => {
      const b = makeBreaker({ thresholdCount: 5, windowMs: 1_000 });
      b.recordFailure();
      b.recordFailure();
      jest.setSystemTime(2_000);
      // calling isOpen triggers the lazy filter
      expect(b.isOpen()).toBe(false);
      expect(b.currentFailures).toBe(0);
    });
  });

  describe("reset", () => {
    it("clears an open breaker immediately", () => {
      const b = makeBreaker({ thresholdCount: 1 });
      b.recordFailure();
      expect(b.isOpen()).toBe(true);
      b.reset();
      expect(b.isOpen()).toBe(false);
      expect(b.openUntil).toBe(0);
      expect(b.currentFailures).toBe(0);
    });

    it("clears accumulated sub-threshold failures", () => {
      const b = makeBreaker({ thresholdCount: 3 });
      b.recordFailure();
      b.recordFailure();
      b.reset();
      expect(b.currentFailures).toBe(0);
    });
  });
});

describe("isCooldownFailure", () => {
  it.each([
    "circuit-open until 12345",
    "circuit open now",
    "request blocked, in 429 backoff",
    "host in cooldown",
    "cooldown until tomorrow",
  ])("returns true for cooldown-style message: %s", (msg) => {
    expect(isCooldownFailure(new Error(msg))).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isCooldownFailure(new Error("CIRCUIT-OPEN until X"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isCooldownFailure(new Error("connection refused"))).toBe(false);
    expect(isCooldownFailure(new Error("500 internal server error"))).toBe(
      false,
    );
  });

  it("handles non-Error values by stringifying", () => {
    expect(isCooldownFailure("circuit-open until x")).toBe(true);
    expect(isCooldownFailure(42)).toBe(false);
    expect(isCooldownFailure(null)).toBe(false);
    expect(isCooldownFailure(undefined)).toBe(false);
  });
});
