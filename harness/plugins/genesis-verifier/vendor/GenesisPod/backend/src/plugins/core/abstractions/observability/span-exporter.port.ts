/**
 * Span exporter 端口（plugins/core 中立契约）
 *
 * 2026-06-03 W1-B 归位：可换后端契约住在中立 plugins/core/abstractions（与 storage
 * 端口同构），由 L0 exporter 插件 implements、由消费侧经 DI 消费——对齐 OTel "SDK 产
 * span / exporter 可插拔"。原 plugins/observability/telemetry-otel/span-exporter.interface.ts。
 *
 * 此接口故意小：只接受 plain JSON-safe span 数据，不依赖任何 OTel SDK 类型。
 * SpanData 改名 TelemetrySpanData 以规避与 ai-harness/tracing trace.interface 的 SpanData 撞名。
 */

export interface TelemetrySpanData {
  /** span name，如 "llm.request" / "tool.execute" / "mission.run" */
  readonly name: string;
  /** 业务无关 attributes（不含 PII；attributes 已经过 PII scrubber 过滤）*/
  readonly attributes: Record<string, string | number | boolean>;
  /** 起止时间戳（毫秒）*/
  readonly startTime: number;
  readonly endTime: number;
  /** 状态：ok / error / aborted */
  readonly status: "ok" | "error" | "aborted";
  /** 业务无关错误标签（不含敏感字段 stack trace） */
  readonly errorMessage?: string;
}

export interface ISpanExporter {
  /** 导出一条 span（fire-and-forget；exporter 自己处理批量 / 重试 / OTLP 协议）*/
  export(span: TelemetrySpanData): void | Promise<void>;
  /** flush 缓存（可选，进程退出 / dispose 时调用）*/
  flush?(): Promise<void>;
}

/**
 * 测试 / 开发用：内存 exporter，spec 用它断言 plugin 写入正确 span
 */
export class InMemorySpanExporter implements ISpanExporter {
  private readonly spans: TelemetrySpanData[] = [];

  export(span: TelemetrySpanData): void {
    this.spans.push(span);
  }

  /** 测试用：拿到累计 span 列表 */
  getSpans(): ReadonlyArray<TelemetrySpanData> {
    return this.spans.slice();
  }

  /** 测试用：清空 */
  clear(): void {
    this.spans.length = 0;
  }
}
