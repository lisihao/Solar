import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  performanceMonitor,
  debounce,
  throttle,
  checkMemoryUsage,
  lazyLoadImages,
  batchProcess,
  scheduleIdleTask,
  memoize,
  PerformanceMetric,
} from '@/lib/utils/performance';

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    performanceMonitor.clear();
    vi.clearAllMocks();
  });

  describe('start / end', () => {
    it('measures duration and returns it', () => {
      performanceMonitor.start('test-op');
      const duration = performanceMonitor.end('test-op');
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('stores metric after end', () => {
      performanceMonitor.start('op1');
      performanceMonitor.end('op1');
      const metrics = performanceMonitor.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].name).toBe('op1');
    });

    it('returns 0 for unknown mark', () => {
      const duration = performanceMonitor.end('nonexistent');
      expect(duration).toBe(0);
    });

    it('stores metadata when provided with start', () => {
      performanceMonitor.start('op-meta', { source: 'test', count: 5 });
      performanceMonitor.end('op-meta');
      const metrics = performanceMonitor.getMetrics();
      expect(metrics[0].metadata).toEqual({ source: 'test', count: 5 });
    });

    it('cleans up marks after end', () => {
      performanceMonitor.start('op-cleanup');
      performanceMonitor.end('op-cleanup');
      // Calling end again should return 0 (mark cleared)
      const second = performanceMonitor.end('op-cleanup');
      expect(second).toBe(0);
    });
  });

  describe('getAverageDuration', () => {
    it('returns 0 for operations with no metrics', () => {
      expect(performanceMonitor.getAverageDuration('unknown')).toBe(0);
    });

    it('calculates average across multiple runs', () => {
      // Inject metrics directly via multiple starts/ends
      performanceMonitor.start('avg-op');
      performanceMonitor.end('avg-op');
      performanceMonitor.start('avg-op');
      performanceMonitor.end('avg-op');
      const avg = performanceMonitor.getAverageDuration('avg-op');
      expect(avg).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clear', () => {
    it('clears all collected metrics', () => {
      performanceMonitor.start('op');
      performanceMonitor.end('op');
      performanceMonitor.clear();
      expect(performanceMonitor.getMetrics()).toHaveLength(0);
    });
  });

  describe('generateReport', () => {
    it('returns a "No data" message when empty', () => {
      const report = performanceMonitor.generateReport();
      expect(report).toBe('No performance data collected.');
    });

    it('generates a report with operation names', () => {
      performanceMonitor.start('render');
      performanceMonitor.end('render');
      const report = performanceMonitor.generateReport();
      expect(report).toContain('render');
      expect(report).toContain('Count:');
      expect(report).toContain('Average:');
    });

    it('includes min, max, total statistics', () => {
      performanceMonitor.start('fetch');
      performanceMonitor.end('fetch');
      const report = performanceMonitor.generateReport();
      expect(report).toContain('Min:');
      expect(report).toContain('Max:');
      expect(report).toContain('Total:');
    });
  });
});

// ---------------------------------------------------------------------------
// debounce
// ---------------------------------------------------------------------------

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays execution until wait time passes', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced('a');
    debounced('b');
    debounced('c');

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('resets timer on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 300);

    debounced();
    vi.advanceTimersByTime(200);
    debounced();
    vi.advanceTimersByTime(200);

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('eventually fires after the wait period', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('x');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('x');
  });
});

// ---------------------------------------------------------------------------
// throttle
// ---------------------------------------------------------------------------

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes the function immediately on first call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 500);
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ignores calls within the throttle window', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 500);

    throttled();
    throttled();
    throttled();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('allows a second call after the throttle window', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 200);

    throttled();
    vi.advanceTimersByTime(200);
    throttled();

    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// checkMemoryUsage
// ---------------------------------------------------------------------------

describe('checkMemoryUsage', () => {
  it('returns null when performance.memory is unavailable (jsdom)', () => {
    // In jsdom, performance.memory is undefined — checkMemoryUsage returns null
    const result = checkMemoryUsage();
    expect(result).toBeNull();
  });

  it('returns null when performance.memory is unavailable', () => {
    // In jsdom performance.memory is not defined
    const result = checkMemoryUsage();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// batchProcess
// ---------------------------------------------------------------------------

describe('batchProcess', () => {
  it('processes all items and returns results', async () => {
    const items = [1, 2, 3, 4, 5];
    const processor = async (n: number) => n * 2;

    const results = await batchProcess(items, processor, 3, 0);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('handles empty array', async () => {
    const results = await batchProcess([], async (x: number) => x, 10, 0);
    expect(results).toEqual([]);
  });

  it('processes in batches when batchSize is 1', async () => {
    const processor = vi.fn(async (x: number) => x + 100);
    const results = await batchProcess([1, 2, 3], processor, 1, 0);
    expect(results).toEqual([101, 102, 103]);
    expect(processor).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// scheduleIdleTask
// ---------------------------------------------------------------------------

describe('scheduleIdleTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to setTimeout when requestIdleCallback unavailable', () => {
    const task = vi.fn();
    // Ensure requestIdleCallback is not available
    const original = (window as never as { requestIdleCallback?: unknown })
      .requestIdleCallback;
    delete (window as never as { requestIdleCallback?: unknown })
      .requestIdleCallback;

    scheduleIdleTask(task, 1000);
    expect(task).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledTimes(1);

    (window as never as { requestIdleCallback?: unknown }).requestIdleCallback =
      original;
  });

  it('runs the task via setTimeout fallback when requestIdleCallback unavailable', () => {
    const task = vi.fn();
    const original = (window as never as { requestIdleCallback?: unknown })
      .requestIdleCallback;
    delete (window as never as { requestIdleCallback?: unknown })
      .requestIdleCallback;

    scheduleIdleTask(task, 1000);
    vi.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledTimes(1);

    (window as never as { requestIdleCallback?: unknown }).requestIdleCallback =
      original;
  });
});

// ---------------------------------------------------------------------------
// memoize
// ---------------------------------------------------------------------------

describe('memoize', () => {
  it('returns cached result on subsequent calls with same args', () => {
    const fn = vi.fn((x: unknown) => ({ value: x }));
    const memoized = memoize(fn);

    const r1 = memoized('hello');
    const r2 = memoized('hello');

    expect(r1).toBe(r2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls fn again with different args', () => {
    const fn = vi.fn((x: unknown) => x);
    const memoized = memoize(fn);

    memoized(1);
    memoized(2);
    memoized(1);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('uses custom cache key function', () => {
    const fn = vi.fn((x: unknown, y: unknown) => String(x) + String(y));
    const memoized = memoize(fn, (x, y) => `${x}-${y}`);

    memoized('a', 'b');
    memoized('a', 'b');

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
