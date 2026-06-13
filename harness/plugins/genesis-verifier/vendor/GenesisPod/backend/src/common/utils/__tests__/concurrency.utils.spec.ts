/**
 * Concurrency Utilities Unit Tests
 *
 * Tests for concurrency control utilities that prevent resource exhaustion
 * by limiting parallel async operations.
 */

import {
  createConcurrencyLimiter,
  mapWithConcurrency,
  mapWithConcurrencySettled,
  batchProcess,
  ConcurrencyLimits,
} from "../concurrency.utils";

describe("Concurrency Utilities", () => {
  describe("createConcurrencyLimiter", () => {
    it("should create a limiter function", () => {
      // Act
      const limiter = createConcurrencyLimiter(2);

      // Assert
      expect(typeof limiter).toBe("function");
    });

    it("should limit concurrent executions", async () => {
      // Arrange
      const limiter = createConcurrencyLimiter(2);
      let activeCount = 0;
      let maxActiveCount = 0;

      const task = async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeCount--;
      };

      // Act
      await Promise.all([
        limiter(task),
        limiter(task),
        limiter(task),
        limiter(task),
        limiter(task),
      ]);

      // Assert
      expect(maxActiveCount).toBe(2);
    });

    it("should execute tasks in order when concurrency is 1", async () => {
      // Arrange
      const limiter = createConcurrencyLimiter(1);
      const executionOrder: number[] = [];

      const createTask = (id: number) => async () => {
        executionOrder.push(id);
        await new Promise((resolve) => setTimeout(resolve, 5));
      };

      // Act
      await Promise.all([
        limiter(createTask(1)),
        limiter(createTask(2)),
        limiter(createTask(3)),
      ]);

      // Assert
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it("should return task results", async () => {
      // Arrange
      const limiter = createConcurrencyLimiter(2);

      // Act
      const results = await Promise.all([
        limiter(async () => 1),
        limiter(async () => 2),
        limiter(async () => 3),
      ]);

      // Assert
      expect(results).toEqual([1, 2, 3]);
    });

    it("should propagate task errors", async () => {
      // Arrange
      const limiter = createConcurrencyLimiter(2);
      const error = new Error("Task failed");

      // Act & Assert
      await expect(
        limiter(async () => {
          throw error;
        }),
      ).rejects.toThrow("Task failed");
    });

    it("should continue processing other tasks after error", async () => {
      // Arrange
      const limiter = createConcurrencyLimiter(2);
      const results: Array<string | Error> = [];

      const tasks = [
        limiter(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "success1";
        }).then(
          (r) => results.push(r),
          (e) => results.push(e),
        ),
        limiter(async () => {
          throw new Error("failed");
        }).then(
          (r) => results.push(r),
          (e) => results.push(e),
        ),
        limiter(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "success2";
        }).then(
          (r) => results.push(r),
          (e) => results.push(e),
        ),
      ];

      // Act
      await Promise.all(tasks);

      // Assert
      expect(results).toHaveLength(3);
      expect(results.filter((r) => typeof r === "string")).toHaveLength(2);
      expect(results.filter((r) => r instanceof Error)).toHaveLength(1);
    });

    it("should handle high concurrency limits correctly", async () => {
      // Arrange
      const limiter = createConcurrencyLimiter(100);
      let activeCount = 0;
      let maxActiveCount = 0;

      const task = async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeCount--;
      };

      // Act
      await Promise.all(Array.from({ length: 50 }, () => limiter(task)));

      // Assert
      expect(maxActiveCount).toBeLessThanOrEqual(50);
    });
  });

  describe("mapWithConcurrency", () => {
    it("should process all items with concurrency limit", async () => {
      // Arrange
      const items = [1, 2, 3, 4, 5];
      const processFn = jest.fn(async (n: number) => n * 2);

      // Act
      const results = await mapWithConcurrency(items, processFn, 2);

      // Assert
      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(processFn).toHaveBeenCalledTimes(5);
    });

    it("should limit concurrent executions", async () => {
      // Arrange
      const items = Array.from({ length: 10 }, (_, i) => i);
      let activeCount = 0;
      let maxActiveCount = 0;

      const processFn = async (n: number) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeCount--;
        return n;
      };

      // Act
      await mapWithConcurrency(items, processFn, 3);

      // Assert
      expect(maxActiveCount).toBe(3);
    });

    it("should pass item and index to process function", async () => {
      // Arrange
      const items = ["a", "b", "c"];
      const processFn = jest.fn(async (item: string, index: number) => ({
        item,
        index,
      }));

      // Act
      const results = await mapWithConcurrency(items, processFn, 2);

      // Assert
      expect(results).toEqual([
        { item: "a", index: 0 },
        { item: "b", index: 1 },
        { item: "c", index: 2 },
      ]);
    });

    it("should use default concurrency limit", async () => {
      // Arrange
      const items = [1, 2, 3];
      const processFn = jest.fn(async (n: number) => n);

      // Act
      await mapWithConcurrency(items, processFn);

      // Assert
      expect(processFn).toHaveBeenCalledTimes(3);
    });

    it("should handle empty array", async () => {
      // Arrange
      const items: number[] = [];
      const processFn = jest.fn(async (n: number) => n);

      // Act
      const results = await mapWithConcurrency(items, processFn, 2);

      // Assert
      expect(results).toEqual([]);
      expect(processFn).not.toHaveBeenCalled();
    });

    it("should propagate errors", async () => {
      // Arrange
      const items = [1, 2, 3];
      const processFn = async (n: number) => {
        if (n === 2) throw new Error("Failed at 2");
        return n;
      };

      // Act & Assert
      await expect(mapWithConcurrency(items, processFn, 2)).rejects.toThrow(
        "Failed at 2",
      );
    });
  });

  describe("mapWithConcurrencySettled", () => {
    it("should process all items and return settled results", async () => {
      // Arrange
      const items = [1, 2, 3, 4, 5];
      const processFn = async (n: number) => {
        if (n === 3) throw new Error("Failed");
        return n * 2;
      };

      // Act
      const results = await mapWithConcurrencySettled(items, processFn, 2);

      // Assert
      expect(results).toHaveLength(5);
      expect(results[0]).toEqual({ status: "fulfilled", value: 2 });
      expect(results[1]).toEqual({ status: "fulfilled", value: 4 });
      expect(results[2]).toEqual({
        status: "rejected",
        reason: expect.any(Error),
      });
      expect(results[3]).toEqual({ status: "fulfilled", value: 8 });
      expect(results[4]).toEqual({ status: "fulfilled", value: 10 });
    });

    it("should limit concurrent executions", async () => {
      // Arrange
      const items = Array.from({ length: 10 }, (_, i) => i);
      let activeCount = 0;
      let maxActiveCount = 0;

      const processFn = async (n: number) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeCount--;
        return n;
      };

      // Act
      await mapWithConcurrencySettled(items, processFn, 3);

      // Assert
      expect(maxActiveCount).toBe(3);
    });

    it("should continue processing after errors", async () => {
      // Arrange
      const items = [1, 2, 3, 4, 5];
      const processFn = jest.fn(async (n: number) => {
        if (n % 2 === 0) throw new Error(`Failed at ${n}`);
        return n;
      });

      // Act
      const results = await mapWithConcurrencySettled(items, processFn, 2);

      // Assert
      expect(processFn).toHaveBeenCalledTimes(5);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
    });

    it("should handle empty array", async () => {
      // Arrange
      const items: number[] = [];
      const processFn = jest.fn(async (n: number) => n);

      // Act
      const results = await mapWithConcurrencySettled(items, processFn, 2);

      // Assert
      expect(results).toEqual([]);
      expect(processFn).not.toHaveBeenCalled();
    });
  });

  describe("batchProcess", () => {
    it("should process items in batches", async () => {
      // Arrange
      const items = Array.from({ length: 25 }, (_, i) => i);
      const processFn = jest.fn(async (n: number) => n * 2);

      // Act
      const results = await batchProcess(items, processFn, 10, 2);

      // Assert
      expect(results).toHaveLength(25);
      expect(processFn).toHaveBeenCalledTimes(25);
      expect(results[0]).toBe(0);
      expect(results[24]).toBe(48);
    });

    it("should process batches sequentially", async () => {
      // Arrange
      const items = Array.from({ length: 30 }, (_, i) => i);
      const batchStartTimes: number[] = [];

      const processFn = async (n: number, index: number) => {
        // Record when each batch starts (first item in batch)
        if (index % 10 === 0) {
          batchStartTimes.push(Date.now());
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        return n;
      };

      // Act
      await batchProcess(items, processFn, 10, 2);

      // Assert
      // Should have 3 batches
      expect(batchStartTimes).toHaveLength(3);
      // Second batch should start after first batch completes
      expect(batchStartTimes[1]).toBeGreaterThan(batchStartTimes[0]);
      expect(batchStartTimes[2]).toBeGreaterThan(batchStartTimes[1]);
    });

    it("should limit concurrency within each batch", async () => {
      // Arrange
      const items = Array.from({ length: 20 }, (_, i) => i);
      let activeCount = 0;
      let maxActiveCount = 0;

      const processFn = async (n: number) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeCount--;
        return n;
      };

      // Act
      await batchProcess(items, processFn, 10, 3);

      // Assert
      expect(maxActiveCount).toBe(3);
    });

    it("should pass correct index to process function", async () => {
      // Arrange
      const items = ["a", "b", "c", "d", "e"];
      const processFn = jest.fn(async (item: string, index: number) => ({
        item,
        index,
      }));

      // Act
      const results = await batchProcess(items, processFn, 2, 1);

      // Assert
      expect(results).toEqual([
        { item: "a", index: 0 },
        { item: "b", index: 1 },
        { item: "c", index: 2 },
        { item: "d", index: 3 },
        { item: "e", index: 4 },
      ]);
    });

    it("should handle batch size larger than array", async () => {
      // Arrange
      const items = [1, 2, 3];
      const processFn = jest.fn(async (n: number) => n * 2);

      // Act
      const results = await batchProcess(items, processFn, 10, 2);

      // Assert
      expect(results).toEqual([2, 4, 6]);
      expect(processFn).toHaveBeenCalledTimes(3);
    });

    it("should handle empty array", async () => {
      // Arrange
      const items: number[] = [];
      const processFn = jest.fn(async (n: number) => n);

      // Act
      const results = await batchProcess(items, processFn, 10, 2);

      // Assert
      expect(results).toEqual([]);
      expect(processFn).not.toHaveBeenCalled();
    });

    it("should propagate errors from any batch", async () => {
      // Arrange
      const items = Array.from({ length: 25 }, (_, i) => i);
      const processFn = async (n: number) => {
        if (n === 15) throw new Error("Failed at 15");
        return n;
      };

      // Act & Assert
      await expect(batchProcess(items, processFn, 10, 2)).rejects.toThrow(
        "Failed at 15",
      );
    });
  });

  describe("ConcurrencyLimits", () => {
    it("should export constant limits", () => {
      expect(ConcurrencyLimits.API).toBe(5);
      expect(ConcurrencyLimits.DB).toBe(10);
      expect(ConcurrencyLimits.FILE).toBe(3);
      expect(ConcurrencyLimits.AI).toBe(3);
    });
  });

  describe("performance scenarios", () => {
    it("should complete faster with higher concurrency", async () => {
      // Arrange
      const items = Array.from({ length: 20 }, (_, i) => i);
      const processFn = async (n: number) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return n;
      };

      // Act
      const start1 = Date.now();
      await mapWithConcurrency(items, processFn, 1);
      const duration1 = Date.now() - start1;

      const start2 = Date.now();
      await mapWithConcurrency(items, processFn, 5);
      const duration2 = Date.now() - start2;

      // Assert
      expect(duration2).toBeLessThan(duration1);
    });

    it("should handle large number of tasks efficiently", async () => {
      // Arrange
      const items = Array.from({ length: 1000 }, (_, i) => i);
      const processFn = async (n: number) => n * 2;

      // Act
      const start = Date.now();
      const results = await mapWithConcurrency(items, processFn, 10);
      const duration = Date.now() - start;

      // Assert
      expect(results).toHaveLength(1000);
      expect(duration).toBeLessThan(5000); // Should complete reasonably fast
    });
  });

  describe("edge cases", () => {
    it("should handle synchronous functions wrapped in async", async () => {
      // Arrange
      const items = [1, 2, 3];
      const processFn = async (n: number) => n * 2; // No actual async work

      // Act
      const results = await mapWithConcurrency(items, processFn, 2);

      // Assert
      expect(results).toEqual([2, 4, 6]);
    });

    it("should handle mixed fast and slow tasks", async () => {
      // Arrange
      const items = [1, 2, 3, 4, 5];
      const processFn = async (n: number) => {
        if (n % 2 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return n;
      };

      // Act
      const results = await mapWithConcurrency(items, processFn, 2);

      // Assert
      expect(results).toEqual([1, 2, 3, 4, 5]);
    });

    it("should handle tasks that return undefined", async () => {
      // Arrange
      const items = [1, 2, 3];
      const processFn = async (_n: number) => {
        return undefined;
      };

      // Act
      const results = await mapWithConcurrency(items, processFn, 2);

      // Assert
      expect(results).toEqual([undefined, undefined, undefined]);
    });
  });
});
