import { HealthCheckRunner } from "../resources/health-check-runner";

describe("HealthCheckRunner", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should start and run check immediately by default", async () => {
    const checkFn = jest.fn().mockResolvedValue(undefined);
    const runner = new HealthCheckRunner({
      name: "test",
      intervalMs: 5000,
    });

    runner.start(checkFn);

    // Allow microtask to complete
    await Promise.resolve();

    expect(runner.isStarted()).toBe(true);
    expect(checkFn).toHaveBeenCalledTimes(1);

    runner.stop();
  });

  it("should not run immediately when runImmediately=false", () => {
    const checkFn = jest.fn().mockResolvedValue(undefined);
    const runner = new HealthCheckRunner({
      name: "test",
      intervalMs: 5000,
      runImmediately: false,
    });

    runner.start(checkFn);

    expect(runner.isStarted()).toBe(true);
    expect(checkFn).not.toHaveBeenCalled();

    runner.stop();
  });

  it("should run check on interval", async () => {
    const checkFn = jest.fn().mockResolvedValue(undefined);
    const runner = new HealthCheckRunner({
      name: "test",
      intervalMs: 5000,
      runImmediately: false,
    });

    runner.start(checkFn);

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(checkFn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(checkFn).toHaveBeenCalledTimes(2);

    runner.stop();
  });

  it("should stop the interval", () => {
    const checkFn = jest.fn().mockResolvedValue(undefined);
    const runner = new HealthCheckRunner({
      name: "test",
      intervalMs: 5000,
      runImmediately: false,
    });

    runner.start(checkFn);
    expect(runner.isStarted()).toBe(true);

    runner.stop();
    expect(runner.isStarted()).toBe(false);
  });

  it("should not double-start", async () => {
    const checkFn = jest.fn().mockResolvedValue(undefined);
    const runner = new HealthCheckRunner({
      name: "test",
      intervalMs: 5000,
    });

    runner.start(checkFn);
    runner.start(checkFn); // second call should be no-op

    await Promise.resolve();
    expect(checkFn).toHaveBeenCalledTimes(1);

    runner.stop();
  });

  it("should skip overlapping checks", async () => {
    let resolveCheck: () => void;
    const checkFn = jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCheck = resolve;
        }),
    );

    const runner = new HealthCheckRunner({
      name: "test",
      intervalMs: 1000,
    });

    runner.start(checkFn);
    await Promise.resolve();
    expect(checkFn).toHaveBeenCalledTimes(1);
    expect(runner.isRunning()).toBe(true);

    // Trigger interval while still running
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    // Should skip the second call
    expect(checkFn).toHaveBeenCalledTimes(1);

    // Complete the first check
    resolveCheck!();
    await Promise.resolve();
    expect(runner.isRunning()).toBe(false);

    runner.stop();
  });

  it("should handle check errors gracefully", async () => {
    const checkFn = jest.fn().mockRejectedValue(new Error("boom"));
    const runner = new HealthCheckRunner({
      name: "test",
      intervalMs: 5000,
    });

    runner.start(checkFn);
    await Promise.resolve();

    // Should not throw, should recover
    expect(runner.isRunning()).toBe(false);
    expect(runner.isStarted()).toBe(true);

    runner.stop();
  });

  it("should support runOnce outside the interval", async () => {
    const checkFn = jest.fn().mockResolvedValue(undefined);
    const runner = new HealthCheckRunner({
      name: "test",
      intervalMs: 5000,
      runImmediately: false,
    });

    await runner.runOnce(checkFn);
    expect(checkFn).toHaveBeenCalledTimes(1);
    expect(runner.isRunning()).toBe(false);
  });

  it("runOnce should skip if already running", async () => {
    let resolveCheck: () => void;
    const checkFn = jest.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCheck = resolve;
        }),
    );

    const runner = new HealthCheckRunner({
      name: "test",
      intervalMs: 5000,
    });

    runner.start(checkFn);
    await Promise.resolve();

    const onceFn = jest.fn().mockResolvedValue(undefined);
    await runner.runOnce(onceFn);
    expect(onceFn).not.toHaveBeenCalled();

    resolveCheck!();
    await Promise.resolve();
    runner.stop();
  });
});
