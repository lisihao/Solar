/**
 * Performance Collector - gathers Web Vitals metrics via Performance API
 */

import type { Page } from "playwright-core";

export interface PerfMetrics {
  /** First Contentful Paint (ms) */
  fcp: number | null;
  /** Largest Contentful Paint (ms) */
  lcp: number | null;
  /** Cumulative Layout Shift */
  cls: number | null;
  /** Time to Interactive approximation (ms) */
  tti: number | null;
}

export interface PerfThresholds {
  fcp: number;
  lcp: number;
  cls: number;
  tti: number;
}

export const DEFAULT_PERF_THRESHOLDS: PerfThresholds = {
  fcp: 2500,
  lcp: 4000,
  cls: 0.25,
  tti: 5000,
};

/**
 * Collect performance metrics from a page via the Performance API
 */
export async function collectPerfMetrics(page: Page): Promise<PerfMetrics> {
  try {
    return await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;

      // FCP
      const fcpEntry = performance.getEntriesByName(
        "first-contentful-paint",
      )[0];
      const fcp = fcpEntry ? fcpEntry.startTime : null;

      // LCP - get from existing entries (observer already fired)
      let lcp: number | null = null;
      const lcpEntries = performance.getEntriesByType(
        "largest-contentful-paint",
      ) as PerformanceEntry[];
      if (lcpEntries.length > 0) {
        lcp = lcpEntries[lcpEntries.length - 1].startTime;
      }

      // CLS - sum layout shift entries
      let cls: number | null = null;
      const layoutShifts = performance.getEntriesByType(
        "layout-shift",
      ) as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>;
      if (layoutShifts.length > 0) {
        cls = layoutShifts
          .filter((e) => !e.hadRecentInput)
          .reduce((sum, e) => sum + e.value, 0);
      }

      // TTI approximation from domInteractive
      const tti = nav ? nav.domInteractive - nav.startTime : null;

      return { fcp, lcp, cls, tti };
    });
  } catch {
    return { fcp: null, lcp: null, cls: null, tti: null };
  }
}

/**
 * Evaluate perf metrics against thresholds, return violation descriptions
 */
export function evaluatePerfMetrics(
  metrics: PerfMetrics,
  thresholds: PerfThresholds = DEFAULT_PERF_THRESHOLDS,
): string[] {
  const violations: string[] = [];

  if (metrics.fcp !== null && metrics.fcp > thresholds.fcp) {
    violations.push(
      `FCP ${metrics.fcp.toFixed(0)}ms exceeds ${thresholds.fcp}ms threshold`,
    );
  }
  if (metrics.lcp !== null && metrics.lcp > thresholds.lcp) {
    violations.push(
      `LCP ${metrics.lcp.toFixed(0)}ms exceeds ${thresholds.lcp}ms threshold`,
    );
  }
  if (metrics.cls !== null && metrics.cls > thresholds.cls) {
    violations.push(
      `CLS ${metrics.cls.toFixed(3)} exceeds ${thresholds.cls} threshold`,
    );
  }
  if (metrics.tti !== null && metrics.tti > thresholds.tti) {
    violations.push(
      `TTI ${metrics.tti.toFixed(0)}ms exceeds ${thresholds.tti}ms threshold`,
    );
  }

  return violations;
}
