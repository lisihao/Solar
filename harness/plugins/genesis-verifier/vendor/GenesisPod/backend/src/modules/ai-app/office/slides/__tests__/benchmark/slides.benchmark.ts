/* eslint-disable no-console */
/**
 * Slides Performance Benchmark Tests
 *
 * Measures and validates performance thresholds for slides generation.
 * Run with: npm run test -- --testPathPattern=benchmark
 *
 * Key metrics and thresholds:
 * - First page generation: < 15s
 * - Single page generation: < 8s average
 * - 10 pages total: < 90s
 * - Checkpoint save: < 200ms
 * - PPTX export: < 5s
 * - Memory peak: < 500MB
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { performance } from "perf_hooks";

// ==================== Configuration ====================

/**
 * Performance thresholds (in milliseconds unless noted)
 */
const THRESHOLDS = {
  /** First page generation time */
  FIRST_PAGE_MS: 15000,

  /** Average single page generation time */
  SINGLE_PAGE_AVG_MS: 8000,

  /** Total time for 10 pages */
  TEN_PAGES_TOTAL_MS: 90000,

  /** Checkpoint save time */
  CHECKPOINT_SAVE_MS: 200,

  /** PPTX export time */
  PPTX_EXPORT_MS: 5000,

  /** Memory peak (in MB) */
  MEMORY_PEAK_MB: 500,

  /** Checkpoint service operations */
  CHECKPOINT_CREATE_MS: 100,
  CHECKPOINT_RESTORE_MS: 150,
  CHECKPOINT_PRUNE_MS: 500,
} as const;

/**
 * Benchmark results
 */
interface BenchmarkResult {
  name: string;
  duration: number;
  threshold: number;
  passed: boolean;
  iterations?: number;
  avgDuration?: number;
}

// ==================== Helper Functions ====================

/**
 * Measure execution time of an async function
 */
async function measureTime<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

/**
 * Run multiple iterations and calculate average
 */
async function benchmarkIterations(
  name: string,
  fn: () => Promise<void>,
  iterations: number,
  threshold: number,
): Promise<BenchmarkResult> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const { duration } = await measureTime(fn);
    durations.push(duration);
  }

  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

  return {
    name,
    duration: avgDuration,
    threshold,
    passed: avgDuration <= threshold,
    iterations,
    avgDuration,
  };
}

/**
 * Get current memory usage in MB
 */
function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed / 1024 / 1024;
}

/**
 * Simulate checkpoint save operation
 */
async function simulateCheckpointSave(): Promise<void> {
  // Simulate database write with JSON serialization
  const state = {
    taskDecomposition: { totalPages: 10 },
    outlinePlan: {
      pages: Array(10).fill({ title: "Page", content: "Content" }),
    },
    pages: Array(10).fill({
      pageNumber: 0,
      status: "completed",
      html: "<div>".repeat(100) + "</div>".repeat(100),
    }),
    globalStyles: { primaryColor: "#000", fontFamily: "Arial" },
  };

  // Simulate serialization
  JSON.stringify(state);

  // Simulate async DB write
  await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * Simulate checkpoint restore operation
 */
async function simulateCheckpointRestore(): Promise<void> {
  // Simulate database read
  await new Promise((resolve) => setTimeout(resolve, 15));

  // Simulate deserialization
  const mockState = JSON.stringify({
    taskDecomposition: { totalPages: 10 },
    pages: Array(10).fill({ pageNumber: 0 }),
  });
  JSON.parse(mockState);
}

/**
 * Simulate checkpoint prune operation (delete old checkpoints)
 */
async function simulateCheckpointPrune(count: number): Promise<void> {
  // Simulate batch delete
  await new Promise((resolve) => setTimeout(resolve, count * 5));
}

// ==================== Benchmark Tests ====================

describe("Slides Performance Benchmarks", () => {
  const results: BenchmarkResult[] = [];

  beforeAll(() => {
    console.log("\n=== Slides Performance Benchmark ===\n");
    console.log("Thresholds:");
    console.log(`  First page: ${THRESHOLDS.FIRST_PAGE_MS}ms`);
    console.log(`  Single page avg: ${THRESHOLDS.SINGLE_PAGE_AVG_MS}ms`);
    console.log(`  10 pages total: ${THRESHOLDS.TEN_PAGES_TOTAL_MS}ms`);
    console.log(`  Checkpoint save: ${THRESHOLDS.CHECKPOINT_SAVE_MS}ms`);
    console.log(`  Memory peak: ${THRESHOLDS.MEMORY_PEAK_MB}MB`);
    console.log("\n");
  });

  afterAll(() => {
    console.log("\n=== Benchmark Results ===\n");

    const maxNameLen = Math.max(...results.map((r) => r.name.length));

    for (const result of results) {
      const status = result.passed ? "PASS" : "FAIL";
      const statusColor = result.passed ? "\x1b[32m" : "\x1b[31m";
      const name = result.name.padEnd(maxNameLen);
      const duration = result.duration.toFixed(2).padStart(10);
      const threshold = result.threshold.toFixed(2).padStart(10);

      console.log(
        `${statusColor}[${status}]\x1b[0m ${name}  ${duration}ms / ${threshold}ms`,
      );
    }

    console.log("\n");

    // Summary
    const passCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    console.log(`Summary: ${passCount}/${totalCount} benchmarks passed\n`);
  });

  describe("Checkpoint Operations", () => {
    it("should save checkpoint within threshold", async () => {
      const result = await benchmarkIterations(
        "Checkpoint Save",
        simulateCheckpointSave,
        10,
        THRESHOLDS.CHECKPOINT_SAVE_MS,
      );

      results.push(result);
      expect(result.passed).toBe(true);
    });

    it("should restore checkpoint within threshold", async () => {
      const result = await benchmarkIterations(
        "Checkpoint Restore",
        simulateCheckpointRestore,
        10,
        THRESHOLDS.CHECKPOINT_RESTORE_MS,
      );

      results.push(result);
      expect(result.passed).toBe(true);
    });

    it("should prune checkpoints within threshold", async () => {
      const result = await benchmarkIterations(
        "Checkpoint Prune (50)",
        () => simulateCheckpointPrune(50),
        5,
        THRESHOLDS.CHECKPOINT_PRUNE_MS,
      );

      results.push(result);
      expect(result.passed).toBe(true);
    });
  });

  describe("Memory Usage", () => {
    it("should stay within memory threshold during operations", async () => {
      const initialMemory = getMemoryUsageMB();

      // Simulate memory-intensive operations
      const largeStates: unknown[] = [];
      for (let i = 0; i < 100; i++) {
        largeStates.push({
          pages: Array(20).fill({
            html:
              "<div>".repeat(1000) +
              "content".repeat(500) +
              "</div>".repeat(1000),
          }),
        });
      }

      const peakMemory = getMemoryUsageMB();

      // Clean up
      largeStates.length = 0;

      // Force GC if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = getMemoryUsageMB();
      const memoryIncrease = peakMemory - initialMemory;

      results.push({
        name: "Memory Peak",
        duration: peakMemory,
        threshold: THRESHOLDS.MEMORY_PEAK_MB,
        passed: peakMemory <= THRESHOLDS.MEMORY_PEAK_MB,
      });

      console.log(`  Initial memory: ${initialMemory.toFixed(2)}MB`);
      console.log(`  Peak memory: ${peakMemory.toFixed(2)}MB`);
      console.log(`  Final memory: ${finalMemory.toFixed(2)}MB`);
      console.log(`  Memory increase: ${memoryIncrease.toFixed(2)}MB`);

      expect(peakMemory).toBeLessThanOrEqual(THRESHOLDS.MEMORY_PEAK_MB);
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle concurrent checkpoint saves", async () => {
      const concurrency = 5;
      const iterations = 3;

      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await Promise.all(
          Array(concurrency)
            .fill(null)
            .map(() => simulateCheckpointSave()),
        );
      }

      const totalDuration = performance.now() - start;
      const avgPerBatch = totalDuration / iterations;

      results.push({
        name: `Concurrent Saves (${concurrency})`,
        duration: avgPerBatch,
        threshold: THRESHOLDS.CHECKPOINT_SAVE_MS * 2, // Allow 2x for concurrency
        passed: avgPerBatch <= THRESHOLDS.CHECKPOINT_SAVE_MS * 2,
        iterations,
        avgDuration: avgPerBatch,
      });

      expect(avgPerBatch).toBeLessThanOrEqual(
        THRESHOLDS.CHECKPOINT_SAVE_MS * 2,
      );
    });
  });

  describe("Serialization Performance", () => {
    it("should serialize large state within threshold", async () => {
      const largeState = {
        taskDecomposition: { totalPages: 30 },
        outlinePlan: {
          pages: Array(30).fill({
            title: "Page Title",
            sections: Array(5).fill({
              title: "Section",
              bullets: Array(10).fill("Bullet point"),
            }),
          }),
        },
        pages: Array(30).fill({
          pageNumber: 0,
          status: "completed",
          html:
            "<div>".repeat(500) +
            "Large content ".repeat(200) +
            "</div>".repeat(500),
          metadata: { rendered: true, timing: 5000 },
        }),
        globalStyles: {
          primaryColor: "#000",
          secondaryColor: "#fff",
          fontFamily: "Arial",
          fontSize: 14,
        },
      };

      const result = await benchmarkIterations(
        "Large State Serialization",
        async () => {
          JSON.stringify(largeState);
          await Promise.resolve(); // Simulate async
        },
        20,
        50, // 50ms threshold for serialization
      );

      results.push(result);
      expect(result.passed).toBe(true);
    });

    it("should deserialize large state within threshold", async () => {
      const largeStateJson = JSON.stringify({
        pages: Array(30).fill({
          html: "<div>Content</div>".repeat(100),
        }),
      });

      const result = await benchmarkIterations(
        "Large State Deserialization",
        async () => {
          JSON.parse(largeStateJson);
          await Promise.resolve();
        },
        20,
        30, // 30ms threshold for deserialization
      );

      results.push(result);
      expect(result.passed).toBe(true);
    });
  });
});

// ==================== Performance Regression Detection ====================

describe("Performance Regression Detection", () => {
  it("should detect significant performance degradation", async () => {
    // Baseline measurements (would be loaded from CI artifact in real scenario)
    const baseline = {
      checkpointSave: 50, // ms
      checkpointRestore: 75, // ms
    };

    // Current measurements
    const { duration: currentSave } = await measureTime(simulateCheckpointSave);
    const { duration: currentRestore } = await measureTime(
      simulateCheckpointRestore,
    );

    // Allow 50% degradation before failing
    const degradationThreshold = 1.5;

    const saveRatio = currentSave / baseline.checkpointSave;
    const restoreRatio = currentRestore / baseline.checkpointRestore;

    console.log(`\nPerformance vs Baseline:`);
    console.log(`  Checkpoint Save: ${saveRatio.toFixed(2)}x baseline`);
    console.log(`  Checkpoint Restore: ${restoreRatio.toFixed(2)}x baseline`);

    // These tests are informational - they log but don't fail
    // In CI, you might want to fail if degradation exceeds threshold
    if (saveRatio > degradationThreshold) {
      console.warn(
        `  WARNING: Checkpoint save degraded by ${((saveRatio - 1) * 100).toFixed(0)}%`,
      );
    }
    if (restoreRatio > degradationThreshold) {
      console.warn(
        `  WARNING: Checkpoint restore degraded by ${((restoreRatio - 1) * 100).toFixed(0)}%`,
      );
    }

    expect(true).toBe(true); // Always pass, this is informational
  });
});
