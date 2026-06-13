import {
  withTimeout,
  withTimeoutFallback,
  TimeoutError,
} from "../timeout.utils";

describe("timeout.utils", () => {
  describe("withTimeout", () => {
    it("should resolve when promise completes before timeout", async () => {
      const result = await withTimeout(Promise.resolve(42), 1000);
      expect(result).toBe(42);
    });

    it("should throw TimeoutError when promise exceeds timeout", async () => {
      const slow = new Promise<number>((resolve) =>
        setTimeout(() => resolve(42), 5000),
      );
      await expect(withTimeout(slow, 50)).rejects.toThrow(TimeoutError);
    });

    it("should include custom message in TimeoutError", async () => {
      const slow = new Promise<void>((resolve) =>
        setTimeout(() => resolve(), 5000),
      );
      await expect(withTimeout(slow, 50, "Planning timeout")).rejects.toThrow(
        "Planning timeout",
      );
    });

    it("should include default message with ms in TimeoutError", async () => {
      const slow = new Promise<void>((resolve) =>
        setTimeout(() => resolve(), 5000),
      );
      await expect(withTimeout(slow, 50)).rejects.toThrow(
        "Operation timed out after 50ms",
      );
    });

    it("should propagate original error if promise rejects before timeout", async () => {
      const failing = Promise.reject(new Error("original error"));
      await expect(withTimeout(failing, 1000)).rejects.toThrow(
        "original error",
      );
    });

    it("should clean up timeout handle on success", async () => {
      const clearSpy = jest.spyOn(global, "clearTimeout");
      await withTimeout(Promise.resolve("ok"), 1000);
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it("should clean up timeout handle on timeout", async () => {
      const clearSpy = jest.spyOn(global, "clearTimeout");
      const slow = new Promise<void>((resolve) =>
        setTimeout(() => resolve(), 5000),
      );
      await withTimeout(slow, 10).catch(() => {});
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  describe("withTimeoutFallback", () => {
    it("should resolve with promise value when it completes before timeout", async () => {
      const result = await withTimeoutFallback(Promise.resolve(42), 1000, -1);
      expect(result).toBe(42);
    });

    it("should resolve with fallback when promise exceeds timeout", async () => {
      const slow = new Promise<number>((resolve) =>
        setTimeout(() => resolve(42), 5000),
      );
      const result = await withTimeoutFallback(slow, 50, -1);
      expect(result).toBe(-1);
    });

    it("should resolve with empty array fallback", async () => {
      const slow = new Promise<string[]>((resolve) =>
        setTimeout(() => resolve(["data"]), 5000),
      );
      const result = await withTimeoutFallback(slow, 50, []);
      expect(result).toEqual([]);
    });

    it("should propagate error if promise rejects before timeout", async () => {
      const failing = Promise.reject(new Error("boom"));
      await expect(
        withTimeoutFallback(failing, 1000, "default"),
      ).rejects.toThrow("boom");
    });

    it("should clean up timeout handle", async () => {
      const clearSpy = jest.spyOn(global, "clearTimeout");
      await withTimeoutFallback(Promise.resolve("ok"), 1000, "default");
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  describe("TimeoutError", () => {
    it("should have correct name", () => {
      const error = new TimeoutError("test");
      expect(error.name).toBe("TimeoutError");
    });

    it("should be instanceof Error", () => {
      const error = new TimeoutError("test");
      expect(error).toBeInstanceOf(Error);
    });

    it("should be instanceof TimeoutError", () => {
      const error = new TimeoutError("test");
      expect(error).toBeInstanceOf(TimeoutError);
    });
  });
});
