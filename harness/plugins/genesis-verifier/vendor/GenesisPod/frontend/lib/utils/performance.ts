/**
 * 性能监控和优化工具
 * 用于监控AI Office的性能指标并提供优化建议
 */

import { logger } from '@/lib/utils/logger';

// 性能指标元数据类型
export type MetricMetadata = Record<string, string | number | boolean>;

// 性能指标接口
export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: MetricMetadata;
}

// 性能监控器类
class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private marks: Map<string, number | string> = new Map();

  /**
   * 开始性能测量
   */
  start(name: string, metadata?: MetricMetadata): void {
    this.marks.set(name, performance.now());
    if (metadata) {
      this.marks.set(`${name}_metadata`, JSON.stringify(metadata));
    }
  }

  /**
   * 结束性能测量
   */
  end(name: string): number {
    const startTime = this.marks.get(name);
    if (startTime === undefined || typeof startTime !== 'number') {
      logger.warn(`Performance mark "${name}" not found`);
      return 0;
    }

    const duration = performance.now() - startTime;
    const metadataStr = this.marks.get(`${name}_metadata`);
    const metadata: MetricMetadata | undefined =
      typeof metadataStr === 'string' ? JSON.parse(metadataStr) : undefined;

    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
      metadata,
    };

    this.metrics.push(metric);
    this.marks.delete(name);
    this.marks.delete(`${name}_metadata`);

    // 如果性能较差，记录警告
    if (duration > 1000) {
      logger.warn(
        `Slow operation detected: ${name} took ${duration.toFixed(2)}ms`
      );
    }

    return duration;
  }

  /**
   * 获取所有性能指标
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * 获取特定操作的平均性能
   */
  getAverageDuration(name: string): number {
    const filtered = this.metrics.filter((m) => m.name === name);
    if (filtered.length === 0) return 0;

    const total = filtered.reduce((sum, m) => sum + m.duration, 0);
    return total / filtered.length;
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics = [];
    this.marks.clear();
  }

  /**
   * 生成性能报告
   */
  generateReport(): string {
    if (this.metrics.length === 0) {
      return 'No performance data collected.';
    }

    const summary = this.metrics.reduce(
      (acc, metric) => {
        if (!acc[metric.name]) {
          acc[metric.name] = {
            count: 0,
            totalDuration: 0,
            maxDuration: 0,
            minDuration: Infinity,
          };
        }
        acc[metric.name].count++;
        acc[metric.name].totalDuration += metric.duration;
        acc[metric.name].maxDuration = Math.max(
          acc[metric.name].maxDuration,
          metric.duration
        );
        acc[metric.name].minDuration = Math.min(
          acc[metric.name].minDuration,
          metric.duration
        );
        return acc;
      },
      {} as Record<
        string,
        {
          count: number;
          totalDuration: number;
          maxDuration: number;
          minDuration: number;
        }
      >
    );

    let report = 'Performance Report:\n';
    report += '='.repeat(80) + '\n';

    Object.entries(summary).forEach(([name, stats]) => {
      const avg = stats.totalDuration / stats.count;
      report += `${name}:\n`;
      report += `  Count: ${stats.count}\n`;
      report += `  Average: ${avg.toFixed(2)}ms\n`;
      report += `  Min: ${stats.minDuration.toFixed(2)}ms\n`;
      report += `  Max: ${stats.maxDuration.toFixed(2)}ms\n`;
      report += `  Total: ${stats.totalDuration.toFixed(2)}ms\n`;
      report += '-'.repeat(80) + '\n';
    });

    return report;
  }
}

// 单例导出
export const performanceMonitor = new PerformanceMonitor();

/**
 * 防抖函数
 * 用于优化高频事件处理（如输入、滚动）
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * 节流函数
 * 确保函数在指定时间内最多执行一次
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Chrome-specific memory API type
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

/**
 * 内存使用情况检查
 */
export function checkMemoryUsage(): {
  used: number;
  total: number;
  percentage: number;
  warning: boolean;
} | null {
  if (typeof window === 'undefined' || !('performance' in window)) {
    return null;
  }

  const perf = performance as PerformanceWithMemory;
  const memory = perf.memory;
  if (!memory) {
    return null;
  }

  const used = memory.usedJSHeapSize;
  const total = memory.jsHeapSizeLimit;
  const percentage = (used / total) * 100;

  return {
    used: Math.round(used / 1024 / 1024), // MB
    total: Math.round(total / 1024 / 1024), // MB
    percentage: Math.round(percentage),
    warning: percentage > 80, // 警告阈值：80%
  };
}

/**
 * 延迟加载图片
 * 使用Intersection Observer API优化图片加载
 */
export function lazyLoadImages(selector: string = 'img[data-src]'): void {
  if (typeof window === 'undefined') return;

  const images = document.querySelectorAll(selector);

  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          const src = img.getAttribute('data-src');
          if (src) {
            img.src = src;
            img.removeAttribute('data-src');
            observer.unobserve(img);
          }
        }
      });
    });

    images.forEach((img) => imageObserver.observe(img));
  } else {
    // Fallback for browsers without IntersectionObserver
    images.forEach((img) => {
      const src = (img as HTMLImageElement).getAttribute('data-src');
      if (src) {
        (img as HTMLImageElement).src = src;
      }
    });
  }
}

/**
 * 批量处理任务
 * 将大量任务分批执行以避免阻塞主线程
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 10,
  delayBetweenBatches: number = 50
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    // 在批次之间添加延迟，让浏览器有时间处理其他任务
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return results;
}

// requestIdleCallback type definitions
interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleRequestCallback = (deadline: IdleDeadline) => void;

interface WindowWithIdleCallback {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: { timeout: number }
  ) => number;
}

/**
 * 长任务分片执行
 * 使用requestIdleCallback优化长时间运行的任务
 */
export function scheduleIdleTask(
  task: () => void,
  timeout: number = 1000
): void {
  if (typeof window === 'undefined') return;

  const win = window as WindowWithIdleCallback;
  if (win.requestIdleCallback) {
    win.requestIdleCallback(() => task(), { timeout });
  } else {
    // Fallback to setTimeout
    setTimeout(task, 0);
  }
}

/**
 * 缓存装饰器工厂
 * 为函数添加结果缓存
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function memoize<T extends (...args: unknown[]) => unknown>(
  fn: T,
  getCacheKey?: (...args: Parameters<T>) => string
): T {
  const cache = new Map<string, unknown>();

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = getCacheKey ? getCacheKey(...args) : JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key) as ReturnType<T>;
    }

    const result = fn(...args) as ReturnType<T>;
    cache.set(key, result);
    return result;
  }) as T;
}
