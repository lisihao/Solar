import { Injectable, Logger, Optional } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { TraceCollectorService } from "./trace-collector.service";
import { CostAttributionService } from "./cost-attribution.service";
import { AiObservabilityService } from "./ai-observability.service";
import { SessionLatencyTrackerService } from "../latency/session-latency-tracker.service";
import { EventJournalService } from "@/modules/ai-harness/protocols/journal/event-journal.service";
import type { CreateSpanInput, EndSpanInput } from "./trace.interface";
import type { CostEvent } from "./cost-attribution.service";
import type { RecordActionInput } from "../latency/session-latency.types";

/**
 * LLM Events Listener
 *
 * 订阅 ai-engine/llm/chat/ai-chat.service 通过 EventEmitter2 发出的可观测性事件，
 * 转发到 harness 的实际 service。
 *
 * ★ 这是 ai-engine → ai-harness 反向依赖切断后的"软桥接层"。
 *   ai-engine 只发事件不知道接收方；ai-harness 监听事件，完成实际记录。
 */
@Injectable()
export class LlmEventsListener {
  private readonly logger = new Logger(LlmEventsListener.name);

  /** correlationId → spanId 映射，用于 span 生命周期跨多次事件 */
  private readonly spanIdMap = new Map<string, string>();

  constructor(
    @Optional() private readonly traceCollector?: TraceCollectorService,
    @Optional() private readonly eventJournal?: EventJournalService,
    @Optional() private readonly costAttribution?: CostAttributionService,
    @Optional() private readonly kernelMetrics?: AiObservabilityService,
    @Optional() private readonly latencyTracker?: SessionLatencyTrackerService,
  ) {}

  @OnEvent("llm.span.start")
  onSpanStart(payload: {
    correlationId: string;
    traceId: string;
    name: string;
    type?: string;
    metadata?: Record<string, unknown>;
  }): void {
    if (!this.traceCollector) return;
    const { correlationId, traceId, ...input } = payload;
    const spanId = this.traceCollector.addSpan(
      traceId,
      input as CreateSpanInput,
    );
    if (spanId) {
      this.spanIdMap.set(correlationId, spanId);
    }
  }

  @OnEvent("llm.span.end")
  onSpanEnd(payload: {
    correlationId: string;
    status: string;
    error?: string;
    output?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): void {
    if (!this.traceCollector) return;
    const spanId = this.spanIdMap.get(payload.correlationId);
    if (!spanId) return;
    const { correlationId: _correlationId, ...rest } = payload;
    this.traceCollector.endSpan(spanId, rest as EndSpanInput);
    this.spanIdMap.delete(payload.correlationId);
  }

  @OnEvent("llm.journal.record")
  onJournalRecord(payload: {
    processId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): void {
    this.forwardJournal(payload);
  }

  // ★ agent-orchestrator 通过同一桥接发 journal（PR-X3）
  @OnEvent("agent.journal.record")
  onAgentJournalRecord(payload: {
    processId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): void {
    this.forwardJournal(payload);
  }

  private forwardJournal(payload: {
    processId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): void {
    if (!this.eventJournal) return;
    void this.eventJournal
      .record(payload.processId, payload.eventType, payload.payload)
      .catch((err: Error) =>
        this.logger.debug(`Journal record failed: ${err.message}`),
      );
  }

  @OnEvent("llm.cost.record")
  onCostRecord(payload: Record<string, unknown>): void {
    if (!this.costAttribution) return;
    this.costAttribution.recordCost(payload as unknown as CostEvent);
  }

  @OnEvent("llm.metrics.record")
  onMetricsRecord(payload: Record<string, unknown>): void {
    if (!this.kernelMetrics) return;
    this.kernelMetrics.recordLLMCall(
      payload as Parameters<AiObservabilityService["recordLLMCall"]>[0],
    );
  }

  @OnEvent("llm.latency.action")
  onLatencyAction(payload: {
    sessionId: string;
    [key: string]: unknown;
  }): void {
    if (!this.latencyTracker) return;
    const { sessionId, ...action } = payload;
    this.latencyTracker.recordAction(
      sessionId,
      action as unknown as RecordActionInput,
    );
  }
}
