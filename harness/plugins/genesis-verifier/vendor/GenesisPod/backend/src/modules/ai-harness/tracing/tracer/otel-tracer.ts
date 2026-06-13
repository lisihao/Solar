/**
 * SOTA Runtime · AgentTracer
 *
 * 方案文档 §4 / §9。LLM-native observability：每 mission / task / iteration /
 * llm-call / tool-call 是 span，嵌套完整。
 *
 * v2 (PR-G)：
 *   - span.end() 不再只 logger.debug，而是把标准化 SpanRecord push 给 SpanExporter
 *   - SpanExporter 多目标分发：LoggerSink + Langfuse（env 配置后启用）
 *   - 强制属性集合：agentId / loopKind / modelId / tokens / costUsd / cacheRead / toolName
 *     由调用方在 startSpan / setAttributes 时填，本类不强校验，但鼓励统一
 *   - exception 记录到 SpanRecord.exception 字段，sink 决定如何报警
 */

import { Injectable, Optional } from "@nestjs/common";
import { randomBytes } from "crypto";
import { SpanExporter } from "./span-exporter";

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly attributes: Record<string, unknown>;
  readonly startedAt: number;
  end(attributes?: Record<string, unknown>): void;
  recordException(err: Error): void;
  setAttributes(attrs: Record<string, unknown>): void;
}

export interface StartSpanOptions {
  readonly parent?: Span;
  readonly attributes?: Record<string, unknown>;
}

@Injectable()
export class AgentTracer {
  constructor(@Optional() private readonly exporter?: SpanExporter) {}

  private generateId(bytes: number): string {
    return randomBytes(bytes).toString("hex");
  }

  startSpan(name: string, options: StartSpanOptions = {}): Span {
    const traceId = options.parent?.traceId ?? this.generateId(16);
    const spanId = this.generateId(8);
    const startedAt = Date.now();
    const attributes = { ...(options.attributes ?? {}) };
    const parentSpanId = options.parent?.spanId;

    let exception:
      | { name: string; message: string; stack?: string }
      | undefined;
    let ended = false;

    const finish = (endAttrs?: Record<string, unknown>) => {
      if (ended) return;
      ended = true;
      const endedAt = Date.now();
      const durationMs = endedAt - startedAt;
      const merged = { ...attributes, ...(endAttrs ?? {}), durationMs };
      if (this.exporter) {
        // PR-U: 同时输出 OTel GenAI semantic conventions 兼容字段
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { toOtelGenAiAttributes } =
          require("./otel-semantic-conventions") as {
            toOtelGenAiAttributes: (
              n: string,
              r: Record<string, unknown>,
            ) => Record<string, unknown>;
          };
        const otelAttributes = toOtelGenAiAttributes(name, merged);
        this.exporter.emit({
          traceId,
          spanId,
          parentSpanId,
          name,
          startedAt,
          endedAt,
          durationMs,
          attributes: merged,
          otelAttributes,
          exception,
        });
      }
    };

    const span: Span = {
      traceId,
      spanId,
      parentSpanId,
      name,
      attributes,
      startedAt,
      end: finish,
      recordException: (err) => {
        exception = {
          name: err.name,
          message: err.message,
          stack: err.stack,
        };
      },
      setAttributes: (attrs) => {
        Object.assign(attributes, attrs);
      },
    };
    return span;
  }
}
