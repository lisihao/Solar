/**
 * Unit tests for tool-timeout utility
 */

import {
  withToolTimeout,
  TOOL_TIMEOUT_MS,
  MULTI_STEP_TIMEOUT_MS,
} from "../tool-timeout";

describe("tool-timeout", () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("constants", () => {
    it("should export TOOL_TIMEOUT_MS as 60000", () => {
      expect(TOOL_TIMEOUT_MS).toBe(60_000);
    });

    it("should export MULTI_STEP_TIMEOUT_MS as 180000", () => {
      expect(MULTI_STEP_TIMEOUT_MS).toBe(180_000);
    });
  });

  describe("withToolTimeout", () => {
    it("should resolve with the promise result when it completes before timeout", async () => {
      const promise = Promise.resolve("success");
      const result = await withToolTimeout(promise, 5000, "Test operation");
      expect(result).toBe("success");
    });

    it("should reject with timeout error when the promise exceeds timeout", async () => {
      const neverResolves = new Promise<string>(() => {
        // never resolves
      });

      const racePromise = withToolTimeout(
        neverResolves,
        1000,
        "Slow operation",
      );

      jest.advanceTimersByTime(1001);

      await expect(racePromise).rejects.toThrow(
        "Slow operation exceeded timeout of 1s",
      );
    });

    it("should include operation name and timeout seconds in error message", async () => {
      const neverResolves = new Promise<string>(() => {});

      const racePromise = withToolTimeout(neverResolves, 30_000, "Custom Op");

      jest.advanceTimersByTime(30_001);

      await expect(racePromise).rejects.toThrow(
        "Custom Op exceeded timeout of 30s",
      );
    });

    it("should reject with the original error when the promise rejects", async () => {
      const failingPromise = Promise.reject(new Error("original error"));
      await expect(withToolTimeout(failingPromise, 5000, "Op")).rejects.toThrow(
        "original error",
      );
    });

    it("should clear the timer after a successful resolution (no memory leak)", async () => {
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const promise = Promise.resolve(42);

      await withToolTimeout(promise, 5000, "Op");

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it("should clear the timer after rejection (no memory leak)", async () => {
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const failingPromise = Promise.reject(new Error("fail"));

      await expect(
        withToolTimeout(failingPromise, 5000, "Op"),
      ).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it("should propagate non-Error rejection values", async () => {
      const failingPromise = Promise.reject("string error");
      await expect(withToolTimeout(failingPromise, 5000, "Op")).rejects.toBe(
        "string error",
      );
    });

    it("should work with typed promises", async () => {
      interface MyResult {
        data: string;
        count: number;
      }
      const promise: Promise<MyResult> = Promise.resolve({
        data: "test",
        count: 5,
      });
      const result = await withToolTimeout(promise, 5000, "Op");
      expect(result.data).toBe("test");
      expect(result.count).toBe(5);
    });
  });
});
