/**
 * SpanExporter — span 完成时的多目标分发器
 *
 * 设计：
 *   - AgentTracer.startSpan 内部不直接写日志；end() 时把 finished span 的快照 push 给 exporter
 *   - SpanExporter 维护一个 sinks 列表（Logger / Langfuse / 自定义）
 *   - 每个 sink 收到 SpanRecord 自行处理（fire-and-forget；sink 抛错不影响主流程）
 *
 * 当前内置 sinks：
 *   - LoggerSink     · 把 span 写到 NestJS Logger（等价旧行为）
 *   - LangfuseSink   · POST 到 Langfuse REST API（env LANGFUSE_HOST / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY 配置后启用）
 *
 * 第三方 sink 通过 SpanExporter.addSink(sink) 注册，e.g. Jaeger/Arize/自建 OTel collector。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * 标准化 span 事件 —— 任何 sink 收到的形状一致。
 * 字段集合参考 OTel Span 子集 + 我们 harness 关心的 cost/token 维度。
 *
 * PR-U：增加 `otelAttributes` 字段，按 GenAI Semantic Conventions 标准化。
 * 业务自定义字段保留在 `attributes`；要导出到 OTel collector 用 `otelAttributes`。
 */
export interface SpanRecord {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  /** PR-U: OTel GenAI semantic conventions 兼容字段（gen_ai.system / gen_ai.usage.* 等） */
  readonly otelAttributes: Readonly<Record<string, unknown>>;
  readonly exception?: { name: string; message: string; stack?: string };
}

export interface SpanSink {
  readonly id: string;
  emit(record: SpanRecord): void | Promise<void>;
}

class LoggerSink implements SpanSink {
  readonly id = "logger";
  private readonly log = new Logger("HarnessSpan");

  emit(rec: SpanRecord): void {
    const tail =
      rec.attributes.tokens != null || rec.attributes.costUsd != null
        ? ` tok=${rec.attributes.tokens ?? "-"} $=${rec.attributes.costUsd ?? "-"}`
        : "";
    this.log.debug(
      `[${rec.name}] trace=${rec.traceId} span=${rec.spanId}${rec.parentSpanId ? ` parent=${rec.parentSpanId}` : ""} ${rec.durationMs}ms${tail}`,
    );
    if (rec.exception) {
      this.log.warn(
        `[span.exception] ${rec.name} ${rec.exception.name}: ${rec.exception.message}`,
      );
    }
  }
}

/**
 * Langfuse REST 导出器（v0 minimal — public traces / generations API）。
 *
 * 启用条件（任一缺失则不注册）：
 *   LANGFUSE_HOST          e.g. https://cloud.langfuse.com
 *   LANGFUSE_PUBLIC_KEY
 *   LANGFUSE_SECRET_KEY
 *
 * 失败策略：网络错误只 logger.warn，不阻塞 agent；Langfuse 不该影响生产决策。
 */
class LangfuseSink implements SpanSink {
  readonly id = "langfuse";
  private readonly log = new Logger("LangfuseSink");

  constructor(
    private readonly host: string,
    private readonly publicKey: string,
    private readonly secretKey: string,
  ) {}

  async emit(rec: SpanRecord): Promise<void> {
    const body = {
      id: rec.spanId,
      traceId: rec.traceId,
      parentObservationId: rec.parentSpanId,
      name: rec.name,
      startTime: new Date(rec.startedAt).toISOString(),
      endTime: new Date(rec.endedAt).toISOString(),
      level: rec.exception ? "ERROR" : "DEFAULT",
      statusMessage: rec.exception?.message,
      input: rec.attributes.input,
      output: rec.attributes.output,
      metadata: rec.attributes,
    };
    try {
      const auth = Buffer.from(`${this.publicKey}:${this.secretKey}`).toString(
        "base64",
      );
      const res = await fetch(`${this.host}/api/public/observations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.log.warn(
          `Langfuse export failed: HTTP ${res.status} for span=${rec.spanId}`,
        );
      }
    } catch (err) {
      // Network / DNS — never throw out
      this.log.warn(
        `Langfuse export error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

@Injectable()
export class SpanExporter {
  private readonly sinks: SpanSink[] = [];

  constructor(@Optional() configService?: ConfigService) {
    this.sinks.push(new LoggerSink());
    if (configService) {
      const host = configService.get<string>("LANGFUSE_HOST");
      const pub = configService.get<string>("LANGFUSE_PUBLIC_KEY");
      const sec = configService.get<string>("LANGFUSE_SECRET_KEY");
      if (host && pub && sec) {
        this.sinks.push(new LangfuseSink(host, pub, sec));
      }
    }
  }

  addSink(sink: SpanSink): void {
    if (!this.sinks.find((s) => s.id === sink.id)) this.sinks.push(sink);
  }

  removeSink(id: string): void {
    const i = this.sinks.findIndex((s) => s.id === id);
    if (i >= 0) this.sinks.splice(i, 1);
  }

  emit(record: SpanRecord): void {
    for (const sink of this.sinks) {
      try {
        const r = sink.emit(record);
        if (r && typeof r.catch === "function") {
          r.catch(() => {
            /* swallowed; sink-side already logged */
          });
        }
      } catch {
        // never let a sink break the main flow
      }
    }
  }

  /** Test introspection */
  listSinks(): readonly string[] {
    return this.sinks.map((s) => s.id);
  }
}
