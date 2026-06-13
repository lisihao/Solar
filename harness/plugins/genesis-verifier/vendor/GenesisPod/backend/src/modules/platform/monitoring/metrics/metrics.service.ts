/**
 * MetricsService - 应用指标收集服务
 *
 * 提供统一的业务指标收集接口，支持：
 * - 计数器（Counter）：累加型指标
 * - 直方图（Histogram）：分布型指标（延迟、大小等）
 * - 仪表（Gauge）：瞬时值指标
 *
 * 设计原则：
 * - 内存存储，低开销
 * - 支持 Prometheus 格式导出
 * - 可选的定期持久化
 */

import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";

// ============================================================================
// Types
// ============================================================================

/**
 * 指标标签
 */
export interface MetricLabels {
  [key: string]: string;
}

/**
 * 计数器指标
 */
interface CounterMetric {
  type: "counter";
  name: string;
  description: string;
  values: Map<string, number>; // label hash -> value
}

/**
 * 直方图指标
 */
interface HistogramMetric {
  type: "histogram";
  name: string;
  description: string;
  buckets: number[];
  values: Map<
    string,
    {
      bucketCounts: number[];
      sum: number;
      count: number;
    }
  >;
}

/**
 * 仪表指标
 */
interface GaugeMetric {
  type: "gauge";
  name: string;
  description: string;
  values: Map<string, number>;
}

type Metric = CounterMetric | HistogramMetric | GaugeMetric;

/**
 * 指标快照
 */
export interface MetricSnapshot {
  name: string;
  type: "counter" | "histogram" | "gauge";
  description: string;
  values: Array<{
    labels: MetricLabels;
    value:
      | number
      | { buckets: Record<string, number>; sum: number; count: number };
  }>;
}

// ============================================================================
// Default Histogram Buckets
// ============================================================================

/**
 * 默认延迟桶（毫秒）
 */
const DEFAULT_LATENCY_BUCKETS = [
  10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

/**
 * 默认 Token 数桶
 */
const DEFAULT_TOKEN_BUCKETS = [
  100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000,
];

// ============================================================================
// Service Implementation
// ============================================================================

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly metrics = new Map<string, Metric>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // 初始化预定义指标
    this.initializeDefaultMetrics();

    // 每5分钟清理过期标签组合
    this.cleanupInterval = setInterval(
      () => this.cleanupStaleLabels(),
      5 * 60 * 1000,
    ).unref();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  // ==========================================================================
  // Public API - Counter
  // ==========================================================================

  /**
   * 增加计数器
   */
  incrementCounter(name: string, labels: MetricLabels = {}, value = 1): void {
    const metric = this.ensureCounter(name);
    const key = this.labelsToKey(labels);
    const current = metric.values.get(key) || 0;
    metric.values.set(key, current + value);
  }

  // ==========================================================================
  // Public API - Histogram
  // ==========================================================================

  /**
   * 记录直方图值
   */
  recordHistogram(
    name: string,
    value: number,
    labels: MetricLabels = {},
  ): void {
    const metric = this.ensureHistogram(name);
    const key = this.labelsToKey(labels);

    let data = metric.values.get(key);
    if (!data) {
      data = {
        bucketCounts: new Array(metric.buckets.length + 1).fill(0),
        sum: 0,
        count: 0,
      };
      metric.values.set(key, data);
    }

    // 更新桶计数
    for (let i = 0; i < metric.buckets.length; i++) {
      if (value <= metric.buckets[i]) {
        data.bucketCounts[i]++;
        break;
      }
    }
    // +Inf 桶
    if (value > metric.buckets[metric.buckets.length - 1]) {
      data.bucketCounts[metric.buckets.length]++;
    }

    data.sum += value;
    data.count++;
  }

  // ==========================================================================
  // Public API - Gauge
  // ==========================================================================

  /**
   * 设置仪表值
   */
  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    const metric = this.ensureGauge(name);
    const key = this.labelsToKey(labels);
    metric.values.set(key, value);
  }

  /**
   * 增加仪表值
   */
  incrementGauge(name: string, labels: MetricLabels = {}, delta = 1): void {
    const metric = this.ensureGauge(name);
    const key = this.labelsToKey(labels);
    const current = metric.values.get(key) || 0;
    metric.values.set(key, current + delta);
  }

  /**
   * 减少仪表值
   */
  decrementGauge(name: string, labels: MetricLabels = {}, delta = 1): void {
    this.incrementGauge(name, labels, -delta);
  }

  // ==========================================================================
  // AI Teams 专用指标方法
  // ==========================================================================

  /**
   * 记录 AI 响应延迟
   */
  recordAIResponseLatency(model: string, duration: number): void {
    this.recordHistogram("ai_response_latency_ms", duration, { model });
  }

  /**
   * 记录 AI 响应 Token 数
   */
  recordAIResponseTokens(model: string, tokens: number): void {
    this.recordHistogram("ai_response_tokens", tokens, { model });
  }

  /**
   * 记录 AI 响应错误
   */
  recordAIResponseError(model: string, errorType: string): void {
    this.incrementCounter("ai_response_errors_total", {
      model,
      error_type: errorType,
    });
  }

  /**
   * 记录 AI 响应成功
   */
  recordAIResponseSuccess(model: string): void {
    this.incrementCounter("ai_response_success_total", { model });
  }

  /**
   * 记录任务完成
   */
  recordMissionCompleted(_topicId: string, duration: number): void {
    this.incrementCounter("mission_completed_total", {});
    this.recordHistogram("mission_duration_ms", duration, {});
  }

  /**
   * 记录投票完成
   */
  recordVoteCompleted(strategy: string, consensusReached: boolean): void {
    this.incrementCounter("vote_completed_total", {
      strategy,
      consensus: consensusReached ? "true" : "false",
    });
  }

  /**
   * 记录消息发送
   */
  recordMessageSent(_topicId: string, senderType: "user" | "ai"): void {
    this.incrementCounter("messages_sent_total", { sender_type: senderType });
  }

  /**
   * 设置活跃话题数
   */
  setActiveTopics(count: number): void {
    this.setGauge("active_topics", count);
  }

  /**
   * 设置活跃 AI 成员数
   */
  setActiveAIMembers(count: number): void {
    this.setGauge("active_ai_members", count);
  }

  // ==========================================================================
  // Export
  // ==========================================================================

  /**
   * 获取所有指标快照
   */
  getMetricsSnapshot(): MetricSnapshot[] {
    const snapshots: MetricSnapshot[] = [];

    for (const [name, metric] of this.metrics) {
      const snapshot: MetricSnapshot = {
        name,
        type: metric.type,
        description: metric.description,
        values: [],
      };

      if (metric.type === "counter" || metric.type === "gauge") {
        for (const [key, value] of metric.values) {
          snapshot.values.push({
            labels: this.keyToLabels(key),
            value,
          });
        }
      } else if (metric.type === "histogram") {
        const histogramMetric = metric;
        for (const [key, data] of histogramMetric.values) {
          const buckets: Record<string, number> = {};
          let cumulative = 0;
          for (let i = 0; i < histogramMetric.buckets.length; i++) {
            cumulative += data.bucketCounts[i];
            buckets[`${histogramMetric.buckets[i]}`] = cumulative;
          }
          cumulative += data.bucketCounts[histogramMetric.buckets.length];
          buckets["+Inf"] = cumulative;

          snapshot.values.push({
            labels: this.keyToLabels(key),
            value: {
              buckets,
              sum: data.sum,
              count: data.count,
            },
          });
        }
      }

      snapshots.push(snapshot);
    }

    return snapshots;
  }

  /**
   * 导出 Prometheus 格式
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    for (const [name, metric] of this.metrics) {
      lines.push(`# HELP ${name} ${metric.description}`);
      lines.push(`# TYPE ${name} ${metric.type}`);

      if (metric.type === "counter" || metric.type === "gauge") {
        for (const [key, value] of metric.values) {
          const labels = this.formatPrometheusLabels(this.keyToLabels(key));
          lines.push(`${name}${labels} ${value}`);
        }
      } else if (metric.type === "histogram") {
        const histogramMetric = metric;
        for (const [key, data] of histogramMetric.values) {
          const baseLabels = this.keyToLabels(key);
          let cumulative = 0;

          for (let i = 0; i < histogramMetric.buckets.length; i++) {
            cumulative += data.bucketCounts[i];
            const bucketLabels = {
              ...baseLabels,
              le: `${histogramMetric.buckets[i]}`,
            };
            lines.push(
              `${name}_bucket${this.formatPrometheusLabels(bucketLabels)} ${cumulative}`,
            );
          }
          cumulative += data.bucketCounts[histogramMetric.buckets.length];
          lines.push(
            `${name}_bucket${this.formatPrometheusLabels({ ...baseLabels, le: "+Inf" })} ${cumulative}`,
          );

          lines.push(
            `${name}_sum${this.formatPrometheusLabels(baseLabels)} ${data.sum}`,
          );
          lines.push(
            `${name}_count${this.formatPrometheusLabels(baseLabels)} ${data.count}`,
          );
        }
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    for (const metric of this.metrics.values()) {
      metric.values.clear();
    }
    this.logger.log("[MetricsService] All metrics reset");
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * 初始化默认指标
   */
  private initializeDefaultMetrics(): void {
    // HTTP 请求指标
    this.registerHistogram(
      "http_request_duration_ms",
      "HTTP request duration in milliseconds",
      DEFAULT_LATENCY_BUCKETS,
    );
    this.registerCounter("http_requests_total", "Total HTTP requests");
    this.registerCounter("http_errors_total", "Total HTTP errors (4xx + 5xx)");

    // AI 响应指标
    this.registerHistogram(
      "ai_response_latency_ms",
      "AI response latency in milliseconds",
      DEFAULT_LATENCY_BUCKETS,
    );
    this.registerHistogram(
      "ai_response_tokens",
      "AI response token count",
      DEFAULT_TOKEN_BUCKETS,
    );
    this.registerCounter(
      "ai_response_errors_total",
      "Total AI response errors",
    );
    this.registerCounter(
      "ai_response_success_total",
      "Total successful AI responses",
    );

    // 任务指标
    this.registerCounter("mission_completed_total", "Total completed missions");
    this.registerHistogram(
      "mission_duration_ms",
      "Mission duration in milliseconds",
      DEFAULT_LATENCY_BUCKETS,
    );

    // 投票指标
    this.registerCounter("vote_completed_total", "Total completed votes");

    // 消息指标
    this.registerCounter("messages_sent_total", "Total messages sent");

    // 活跃资源指标
    this.registerGauge("active_topics", "Number of active topics");
    this.registerGauge("active_ai_members", "Number of active AI members");
  }

  /**
   * 注册计数器
   */
  private registerCounter(name: string, description: string): void {
    this.metrics.set(name, {
      type: "counter",
      name,
      description,
      values: new Map(),
    });
  }

  /**
   * 注册直方图
   */
  private registerHistogram(
    name: string,
    description: string,
    buckets: number[],
  ): void {
    this.metrics.set(name, {
      type: "histogram",
      name,
      description,
      buckets: [...buckets].sort((a, b) => a - b),
      values: new Map(),
    });
  }

  /**
   * 注册仪表
   */
  private registerGauge(name: string, description: string): void {
    this.metrics.set(name, {
      type: "gauge",
      name,
      description,
      values: new Map(),
    });
  }

  /**
   * 确保计数器存在
   */
  private ensureCounter(name: string): CounterMetric {
    let metric = this.metrics.get(name);
    if (!metric) {
      this.registerCounter(name, `Counter: ${name}`);
      metric = this.metrics.get(name);
    }
    if (metric?.type !== "counter") {
      throw new Error(`Metric ${name} is not a counter`);
    }
    return metric;
  }

  /**
   * 确保直方图存在
   */
  private ensureHistogram(name: string): HistogramMetric {
    let metric = this.metrics.get(name);
    if (!metric) {
      this.registerHistogram(
        name,
        `Histogram: ${name}`,
        DEFAULT_LATENCY_BUCKETS,
      );
      metric = this.metrics.get(name);
    }
    if (metric?.type !== "histogram") {
      throw new Error(`Metric ${name} is not a histogram`);
    }
    return metric;
  }

  /**
   * 确保仪表存在
   */
  private ensureGauge(name: string): GaugeMetric {
    let metric = this.metrics.get(name);
    if (!metric) {
      this.registerGauge(name, `Gauge: ${name}`);
      metric = this.metrics.get(name);
    }
    if (metric?.type !== "gauge") {
      throw new Error(`Metric ${name} is not a gauge`);
    }
    return metric;
  }

  /**
   * 标签转换为 key
   */
  private labelsToKey(labels: MetricLabels): string {
    const sorted = Object.keys(labels)
      .sort()
      .map((k) => `${k}=${labels[k]}`);
    return sorted.join(",") || "__empty__";
  }

  /**
   * key 转换为标签
   */
  private keyToLabels(key: string): MetricLabels {
    if (key === "__empty__") return {};
    const labels: MetricLabels = {};
    for (const pair of key.split(",")) {
      const [k, v] = pair.split("=");
      if (k && v !== undefined) {
        labels[k] = v;
      }
    }
    return labels;
  }

  /**
   * 格式化 Prometheus 标签
   */
  private formatPrometheusLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return "";
    const formatted = entries.map(([k, v]) => `${k}="${v}"`).join(",");
    return `{${formatted}}`;
  }

  /**
   * 清理过期标签组合（防止内存泄漏）
   */
  private cleanupStaleLabels(): void {
    // 当前简单实现：保留所有标签
    // 未来可以添加 LRU 或 TTL 机制
    this.logger.debug("[MetricsService] Cleanup check completed");
  }
}
