/**
 * Slides Metrics Service
 *
 * Service for collecting and exposing metrics for slides generation.
 * Provides operational visibility into the slides generation pipeline.
 *
 * Collected metrics:
 * - Generation counts (started, completed, failed)
 * - Page render counts
 * - Checkpoint save counts
 * - Timing distributions
 * - Active generation counts
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";

// ==================== Types ====================

/**
 * Metric types
 */
export enum MetricType {
  COUNTER = "counter",
  GAUGE = "gauge",
  HISTOGRAM = "histogram",
}

/**
 * Single metric definition
 */
export interface MetricDefinition {
  name: string;
  type: MetricType;
  description: string;
  labels?: string[];
}

/**
 * Counter metric value
 */
interface CounterValue {
  value: number;
  labels?: Record<string, string>;
}

/**
 * Gauge metric value
 */
interface GaugeValue {
  value: number;
  labels?: Record<string, string>;
}

/**
 * Histogram metric value
 */
interface HistogramValue {
  count: number;
  sum: number;
  buckets: Map<number, number>;
  labels?: Record<string, string>;
}

/**
 * Metrics snapshot
 */
export interface MetricsSnapshot {
  timestamp: Date;
  metrics: {
    name: string;
    type: MetricType;
    description: string;
    value: number | Record<string, number>;
    labels?: Record<string, string>;
  }[];
}

/**
 * Alert rule definition
 */
export interface AlertRule {
  name: string;
  metric: string;
  condition: "gt" | "lt" | "eq" | "gte" | "lte";
  threshold: number;
  severity: "critical" | "warning" | "info";
  message: string;
  windowSeconds: number;
}

/**
 * Alert status
 */
export interface AlertStatus {
  name: string;
  firing: boolean;
  value: number;
  threshold: number;
  severity: "critical" | "warning" | "info";
  message: string;
  lastChecked: Date;
  firingStartedAt?: Date;
}

// ==================== Configuration ====================

/**
 * Default histogram buckets for timing (in ms)
 */
const DEFAULT_TIMING_BUCKETS = [
  1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000,
];

/**
 * Default alert rules
 */
const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    name: "high_failure_rate",
    metric: "slides_generation_failure_rate",
    condition: "gt",
    threshold: 0.1, // 10%
    severity: "critical",
    message: "PPT 生成失败率过高 (>10%)",
    windowSeconds: 300, // 5 minutes
  },
  {
    name: "high_latency",
    metric: "slides_generation_avg_duration_ms",
    condition: "gt",
    threshold: 120000, // 2 minutes
    severity: "warning",
    message: "PPT 生成平均延迟过高 (>2分钟)",
    windowSeconds: 300,
  },
  {
    name: "stuck_missions",
    metric: "slides_stuck_missions_count",
    condition: "gt",
    threshold: 5,
    severity: "warning",
    message: "存在过多卡死的 PPT 生成任务 (>5)",
    windowSeconds: 60,
  },
  {
    name: "checkpoint_failures",
    metric: "slides_checkpoint_failures_total",
    condition: "gt",
    threshold: 10,
    severity: "critical",
    message: "检查点保存失败次数过多 (>10)",
    windowSeconds: 300,
  },
];

// ==================== Service ====================

@Injectable()
export class SlidesMetricsService implements OnModuleInit {
  private readonly logger = new Logger(SlidesMetricsService.name);

  // Metric storage
  private readonly counters = new Map<string, CounterValue>();
  private readonly gauges = new Map<string, GaugeValue>();
  private readonly histograms = new Map<string, HistogramValue>();

  // Alert state
  private readonly alertRules: AlertRule[] = DEFAULT_ALERT_RULES;
  private readonly alertStatus = new Map<string, AlertStatus>();

  // Timing tracking for rate calculations
  private recentGenerations: { timestamp: Date; success: boolean }[] = [];
  private recentDurations: { timestamp: Date; durationMs: number }[] = [];

  constructor(private readonly eventEmitter: EventEmitter2) {}

  onModuleInit(): void {
    this.initializeMetrics();
    this.initializeAlerts();
    this.logger.log("Metrics service initialized");

    // Clean up old data periodically
    setInterval(() => this.cleanupOldData(), 60 * 1000).unref(); // Every minute
  }

  /**
   * Initialize all metric definitions
   */
  private initializeMetrics(): void {
    // Counters
    this.initCounter("slides_generation_started_total", 0);
    this.initCounter("slides_generation_completed_total", 0);
    this.initCounter("slides_generation_failed_total", 0);
    this.initCounter("slides_pages_rendered_total", 0);
    this.initCounter("slides_checkpoint_created_total", 0);
    this.initCounter("slides_checkpoint_failures_total", 0);

    // Gauges
    this.initGauge("slides_active_generations", 0);
    this.initGauge("slides_stuck_missions_count", 0);

    // Histograms
    this.initHistogram("slides_generation_duration_ms");
    this.initHistogram("slides_page_render_duration_ms");
    this.initHistogram("slides_checkpoint_duration_ms");
  }

  /**
   * Initialize alert status
   */
  private initializeAlerts(): void {
    for (const rule of this.alertRules) {
      this.alertStatus.set(rule.name, {
        name: rule.name,
        firing: false,
        value: 0,
        threshold: rule.threshold,
        severity: rule.severity,
        message: rule.message,
        lastChecked: new Date(),
      });
    }
  }

  // ==================== Counter Operations ====================

  private initCounter(name: string, initialValue = 0): void {
    this.counters.set(name, { value: initialValue });
  }

  private incrementCounter(name: string, amount = 1): void {
    const counter = this.counters.get(name);
    if (counter) {
      counter.value += amount;
    }
  }

  // ==================== Gauge Operations ====================

  private initGauge(name: string, initialValue = 0): void {
    this.gauges.set(name, { value: initialValue });
  }

  private setGauge(name: string, value: number): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.value = value;
    }
  }

  private incrementGauge(name: string, amount = 1): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.value += amount;
    }
  }

  private decrementGauge(name: string, amount = 1): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.value = Math.max(0, gauge.value - amount);
    }
  }

  // ==================== Histogram Operations ====================

  private initHistogram(name: string): void {
    const buckets = new Map<number, number>();
    for (const bucket of DEFAULT_TIMING_BUCKETS) {
      buckets.set(bucket, 0);
    }
    this.histograms.set(name, { count: 0, sum: 0, buckets });
  }

  private observeHistogram(name: string, value: number): void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      histogram.count++;
      histogram.sum += value;

      // Update buckets
      for (const bucket of DEFAULT_TIMING_BUCKETS) {
        if (value <= bucket) {
          histogram.buckets.set(
            bucket,
            (histogram.buckets.get(bucket) || 0) + 1,
          );
        }
      }
    }
  }

  // ==================== Event Handlers ====================

  @OnEvent("slides.generation.started")
  handleGenerationStarted(_payload: { missionId: string }): void {
    this.incrementCounter("slides_generation_started_total");
    this.incrementGauge("slides_active_generations");
    this.recentGenerations.push({ timestamp: new Date(), success: false });
  }

  @OnEvent("slides.generation.completed")
  handleGenerationCompleted(payload: {
    missionId: string;
    durationMs: number;
  }): void {
    this.incrementCounter("slides_generation_completed_total");
    this.decrementGauge("slides_active_generations");
    this.observeHistogram("slides_generation_duration_ms", payload.durationMs);

    // Update recent generations
    const recent = this.recentGenerations.find(
      (g) => !g.success && Date.now() - g.timestamp.getTime() < 300000,
    );
    if (recent) {
      recent.success = true;
    }

    this.recentDurations.push({
      timestamp: new Date(),
      durationMs: payload.durationMs,
    });

    this.checkAlerts();
  }

  @OnEvent("slides.generation.failed")
  handleGenerationFailed(payload: { missionId: string; error: string }): void {
    this.incrementCounter("slides_generation_failed_total");
    this.decrementGauge("slides_active_generations");

    this.logger.warn(
      `Generation failed: ${payload.missionId} - ${payload.error}`,
    );
    this.checkAlerts();
  }

  @OnEvent("slides.page.rendered")
  handlePageRendered(payload: { pageIndex: number; durationMs: number }): void {
    this.incrementCounter("slides_pages_rendered_total");
    this.observeHistogram("slides_page_render_duration_ms", payload.durationMs);
  }

  @OnEvent("slides.checkpoint.created")
  handleCheckpointCreated(payload: { durationMs: number }): void {
    this.incrementCounter("slides_checkpoint_created_total");
    this.observeHistogram("slides_checkpoint_duration_ms", payload.durationMs);
  }

  @OnEvent("slides.checkpoint.failed")
  handleCheckpointFailed(_payload: { error: string }): void {
    this.incrementCounter("slides_checkpoint_failures_total");
    this.checkAlerts();
  }

  // ==================== Public API ====================

  /**
   * Record generation start
   */
  recordGenerationStart(missionId: string): void {
    this.eventEmitter.emit("slides.generation.started", { missionId });
  }

  /**
   * Record generation completion
   */
  recordGenerationComplete(missionId: string, durationMs: number): void {
    this.eventEmitter.emit("slides.generation.completed", {
      missionId,
      durationMs,
    });
  }

  /**
   * Record generation failure
   */
  recordGenerationFailure(missionId: string, error: string): void {
    this.eventEmitter.emit("slides.generation.failed", { missionId, error });
  }

  /**
   * Record page render
   */
  recordPageRendered(pageIndex: number, durationMs: number): void {
    this.eventEmitter.emit("slides.page.rendered", { pageIndex, durationMs });
  }

  /**
   * Record checkpoint creation
   */
  recordCheckpointCreated(durationMs: number): void {
    this.eventEmitter.emit("slides.checkpoint.created", { durationMs });
  }

  /**
   * Record checkpoint failure
   */
  recordCheckpointFailure(error: string): void {
    this.eventEmitter.emit("slides.checkpoint.failed", { error });
  }

  /**
   * Update stuck missions count
   */
  updateStuckMissionsCount(count: number): void {
    this.setGauge("slides_stuck_missions_count", count);
    this.checkAlerts();
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): MetricsSnapshot {
    const metrics: MetricsSnapshot["metrics"] = [];

    // Add counters
    for (const [name, counter] of this.counters) {
      metrics.push({
        name,
        type: MetricType.COUNTER,
        description: this.getMetricDescription(name),
        value: counter.value,
        labels: counter.labels,
      });
    }

    // Add gauges
    for (const [name, gauge] of this.gauges) {
      metrics.push({
        name,
        type: MetricType.GAUGE,
        description: this.getMetricDescription(name),
        value: gauge.value,
        labels: gauge.labels,
      });
    }

    // Add histograms
    for (const [name, histogram] of this.histograms) {
      const avg = histogram.count > 0 ? histogram.sum / histogram.count : 0;
      metrics.push({
        name: `${name}_avg`,
        type: MetricType.HISTOGRAM,
        description: `Average of ${name}`,
        value: avg,
      });
      metrics.push({
        name: `${name}_count`,
        type: MetricType.HISTOGRAM,
        description: `Count of ${name}`,
        value: histogram.count,
      });
    }

    // Add computed metrics
    metrics.push({
      name: "slides_generation_failure_rate",
      type: MetricType.GAUGE,
      description: "Recent generation failure rate",
      value: this.calculateFailureRate(),
    });

    metrics.push({
      name: "slides_generation_avg_duration_ms",
      type: MetricType.GAUGE,
      description: "Recent average generation duration",
      value: this.calculateAverageDuration(),
    });

    return {
      timestamp: new Date(),
      metrics,
    };
  }

  /**
   * Get alert status
   */
  getAlertStatus(): AlertStatus[] {
    return Array.from(this.alertStatus.values());
  }

  /**
   * Get firing alerts only
   */
  getFiringAlerts(): AlertStatus[] {
    return Array.from(this.alertStatus.values()).filter((a) => a.firing);
  }

  /**
   * Export metrics in Prometheus format
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    const snapshot = this.getMetrics();

    for (const metric of snapshot.metrics) {
      const metricName = metric.name.replace(/-/g, "_");
      lines.push(`# HELP ${metricName} ${metric.description}`);
      lines.push(`# TYPE ${metricName} ${metric.type}`);

      if (typeof metric.value === "number") {
        const labelsStr = metric.labels
          ? `{${Object.entries(metric.labels)
              .map(([k, v]) => `${k}="${v}"`)
              .join(",")}}`
          : "";
        lines.push(`${metricName}${labelsStr} ${metric.value}`);
      }
    }

    return lines.join("\n");
  }

  // ==================== Private Methods ====================

  /**
   * Get metric description
   */
  private getMetricDescription(name: string): string {
    const descriptions: Record<string, string> = {
      slides_generation_started_total:
        "Total number of slide generations started",
      slides_generation_completed_total:
        "Total number of slide generations completed",
      slides_generation_failed_total:
        "Total number of slide generations failed",
      slides_pages_rendered_total: "Total number of pages rendered",
      slides_checkpoint_created_total: "Total number of checkpoints created",
      slides_checkpoint_failures_total: "Total number of checkpoint failures",
      slides_active_generations: "Number of currently active generations",
      slides_stuck_missions_count: "Number of stuck missions",
      slides_generation_duration_ms: "Generation duration in milliseconds",
      slides_page_render_duration_ms: "Page render duration in milliseconds",
      slides_checkpoint_duration_ms:
        "Checkpoint creation duration in milliseconds",
    };

    return descriptions[name] || name;
  }

  /**
   * Calculate failure rate from recent generations
   */
  private calculateFailureRate(): number {
    const recentWindow = 5 * 60 * 1000; // 5 minutes
    const cutoff = Date.now() - recentWindow;

    const recent = this.recentGenerations.filter(
      (g) => g.timestamp.getTime() > cutoff,
    );

    if (recent.length === 0) return 0;

    const failures = recent.filter((g) => !g.success).length;
    return failures / recent.length;
  }

  /**
   * Calculate average duration from recent generations
   */
  private calculateAverageDuration(): number {
    const recentWindow = 5 * 60 * 1000; // 5 minutes
    const cutoff = Date.now() - recentWindow;

    const recent = this.recentDurations.filter(
      (d) => d.timestamp.getTime() > cutoff,
    );

    if (recent.length === 0) return 0;

    const sum = recent.reduce((acc, d) => acc + d.durationMs, 0);
    return sum / recent.length;
  }

  /**
   * Check alert rules and update status
   */
  private checkAlerts(): void {
    const snapshot = this.getMetrics();

    for (const rule of this.alertRules) {
      const metric = snapshot.metrics.find((m) => m.name === rule.metric);
      if (!metric || typeof metric.value !== "number") continue;

      const status = this.alertStatus.get(rule.name);
      if (!status) continue;

      let firing = false;
      const value = metric.value;

      switch (rule.condition) {
        case "gt":
          firing = value > rule.threshold;
          break;
        case "lt":
          firing = value < rule.threshold;
          break;
        case "eq":
          firing = value === rule.threshold;
          break;
        case "gte":
          firing = value >= rule.threshold;
          break;
        case "lte":
          firing = value <= rule.threshold;
          break;
      }

      // Update status
      const wasFiring = status.firing;
      status.firing = firing;
      status.value = value;
      status.lastChecked = new Date();

      if (firing && !wasFiring) {
        status.firingStartedAt = new Date();
        this.logger.warn(
          `Alert ${rule.name} firing: ${rule.message} (value: ${value}, threshold: ${rule.threshold})`,
        );

        // Emit alert event
        this.eventEmitter.emit("slides.alert.firing", {
          name: rule.name,
          severity: rule.severity,
          message: rule.message,
          value,
          threshold: rule.threshold,
        });
      } else if (!firing && wasFiring) {
        this.logger.log(`Alert ${rule.name} resolved`);
        status.firingStartedAt = undefined;

        // Emit resolved event
        this.eventEmitter.emit("slides.alert.resolved", {
          name: rule.name,
          severity: rule.severity,
        });
      }
    }
  }

  /**
   * Clean up old data to prevent memory growth
   */
  private cleanupOldData(): void {
    const maxAge = 10 * 60 * 1000; // 10 minutes
    const cutoff = Date.now() - maxAge;

    this.recentGenerations = this.recentGenerations.filter(
      (g) => g.timestamp.getTime() > cutoff,
    );

    this.recentDurations = this.recentDurations.filter(
      (d) => d.timestamp.getTime() > cutoff,
    );
  }
}
