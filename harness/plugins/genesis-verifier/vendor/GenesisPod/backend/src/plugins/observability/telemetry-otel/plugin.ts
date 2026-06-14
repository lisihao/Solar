/**
 * telemetry-otel plugin 实现（v5.1 R0.5 PR-7）
 *
 * 设计要点：
 * - 监听 6 个核心 hook，每个 hook 调用产生 1 条 span
 * - LLM/Tool 走 wrap pattern：BEFORE 记起始时间到 ctx.events 自己 namespace；
 *   AFTER 计算 duration + 写 span
 * - Mission 不需要 wrap：START/END 各自独立 span（START 写"开始"事件，END 计算 duration）
 * - 业务无关：所有 span attribute 都从 hook payload.meta 拿（missionId/agentId/model）
 *   不读 messages / request body 等含 PII 的字段
 * - cache-hit / abort 标记到 span.status 让监控可视化
 *
 * Capability: read:llm-payload:meta + read:tool-payload + service:http
 */
import type {
  IPlugin,
  IPluginContext,
  HookHandler,
  PluginHealth,
  LlmRequestPayload,
  LlmResponsePayload,
  ToolBeforePayload,
  ToolAfterPayload,
  MissionStartPayload,
  MissionEndPayload,
} from "@/plugins/core/abstractions";
import { CORE_HOOKS } from "@/plugins/core/abstractions";
import { TELEMETRY_OTEL_MANIFEST } from "./manifest";
import {
  type ISpanExporter,
  type TelemetrySpanData,
  InMemorySpanExporter,
} from "@/plugins/core/abstractions/observability/span-exporter.port";

/**
 * plugin 配置
 */
export interface TelemetryOtelConfig {
  /** OTLP endpoint（注入真实 exporter 时用）*/
  readonly endpoint?: string;
  /** sample rate 0-1，默认 1.0（全采）；plugin 不实现采样，由 exporter 处理 */
  readonly sampleRate?: number;
  /** service.name attribute */
  readonly serviceName?: string;
}

export class TelemetryOtelPlugin implements IPlugin<TelemetryOtelConfig> {
  readonly manifest = TELEMETRY_OTEL_MANIFEST;

  private exporter: ISpanExporter;
  /** missionId/correlationId → 起始时间戳；hook BEFORE 写入，AFTER 读出 */
  private readonly startTimes = new Map<string, number>();
  private serviceName = "genesis-agent-teams";
  private logger?: IPluginContext["logger"];

  constructor(exporter?: ISpanExporter) {
    this.exporter = exporter ?? new InMemorySpanExporter();
  }

  /** 测试用：注入自定义 exporter */
  setExporter(exporter: ISpanExporter): void {
    this.exporter = exporter;
  }

  async init(ctx: IPluginContext, config: TelemetryOtelConfig): Promise<void> {
    this.logger = ctx.logger;
    this.serviceName = config.serviceName ?? "genesis-agent-teams";

    ctx.hooks.register(CORE_HOOKS.LLM_REQUEST, this.onLlmRequest);
    ctx.hooks.register(CORE_HOOKS.LLM_RESPONSE, this.onLlmResponse);
    ctx.hooks.register(CORE_HOOKS.TOOL_BEFORE, this.onToolBefore);
    ctx.hooks.register(CORE_HOOKS.TOOL_AFTER, this.onToolAfter);
    ctx.hooks.register(CORE_HOOKS.MISSION_START, this.onMissionStart);
    ctx.hooks.register(CORE_HOOKS.MISSION_END, this.onMissionEnd);
  }

  async healthCheck(): Promise<PluginHealth> {
    return { status: "healthy" };
  }

  async dispose(): Promise<void> {
    if (this.exporter.flush) {
      await this.exporter.flush();
    }
    this.startTimes.clear();
  }

  // ── hook handlers ──

  private onLlmRequest: HookHandler<LlmRequestPayload> = async (ctx) => {
    const key = this.llmKey(ctx.payload);
    this.startTimes.set(key, Date.now());
    return ctx.next();
  };

  private onLlmResponse: HookHandler<LlmResponsePayload> = async (ctx) => {
    const key = this.llmKey(ctx.payload);
    const startTime =
      this.startTimes.get(key) ?? ctx.payload.meta.timestamp ?? Date.now();
    this.startTimes.delete(key);

    const span: TelemetrySpanData = {
      name: "llm.request",
      attributes: this.scrubAttributes({
        "service.name": this.serviceName,
        "llm.mission_id": ctx.payload.meta.missionId,
        "llm.agent_id": ctx.payload.meta.agentId,
        "llm.model": ctx.payload.meta.model,
        "llm.tenant_id": ctx.payload.meta.tenantId,
        "llm.tokens_used": ctx.payload.tokensUsed,
        "llm.cache_hit": ctx.payload.cacheHit ?? false,
      }),
      startTime,
      endTime: Date.now(),
      status: ctx.payload.cacheHit ? "ok" : "ok",
    };
    this.exportSafe(span);
    return ctx.next();
  };

  private onToolBefore: HookHandler<ToolBeforePayload> = async (ctx) => {
    const key = this.toolKey(ctx.payload);
    this.startTimes.set(key, Date.now());
    return ctx.next();
  };

  private onToolAfter: HookHandler<ToolAfterPayload> = async (ctx) => {
    const key = this.toolKey(ctx.payload);
    const startTime =
      this.startTimes.get(key) ?? ctx.payload.meta.timestamp ?? Date.now();
    this.startTimes.delete(key);

    const status: TelemetrySpanData["status"] = ctx.payload.abortReason
      ? "aborted"
      : "ok";
    const span: TelemetrySpanData = {
      name: "tool.execute",
      attributes: this.scrubAttributes({
        "service.name": this.serviceName,
        "tool.id": this.extractToolId(ctx.payload),
        "tool.mission_id": ctx.payload.meta.missionId,
        "tool.agent_id": ctx.payload.meta.agentId,
        "tool.cache_hit": ctx.payload.cacheHit ?? false,
        "tool.abort_reason": ctx.payload.abortReason,
      }),
      startTime,
      endTime: Date.now(),
      status,
    };
    this.exportSafe(span);
    return ctx.next();
  };

  private onMissionStart: HookHandler<MissionStartPayload> = async (ctx) => {
    this.startTimes.set(
      `mission:${ctx.payload.missionId}`,
      ctx.payload.startedAt,
    );
    return ctx.next();
  };

  private onMissionEnd: HookHandler<MissionEndPayload> = async (ctx) => {
    const key = `mission:${ctx.payload.missionId}`;
    const startTime = this.startTimes.get(key) ?? ctx.payload.completedAt;
    this.startTimes.delete(key);

    const span: TelemetrySpanData = {
      name: "mission.run",
      attributes: this.scrubAttributes({
        "service.name": this.serviceName,
        "mission.id": ctx.payload.missionId,
        "mission.status": ctx.payload.status,
        "mission.agent_id": ctx.payload.meta.agentId,
        "mission.tenant_id": ctx.payload.meta.tenantId,
      }),
      startTime,
      endTime: ctx.payload.completedAt,
      status: ctx.payload.status === "completed" ? "ok" : "error",
      errorMessage:
        ctx.payload.status === "failed" && ctx.payload.error
          ? this.summarizeError(ctx.payload.error)
          : undefined,
    };
    this.exportSafe(span);
    return ctx.next();
  };

  // ── helpers ──

  /** LLM hook 配对 key：用 missionId+agentId 关联 BEFORE/AFTER */
  private llmKey(payload: LlmRequestPayload | LlmResponsePayload): string {
    const meta = payload.meta;
    return `llm:${meta.missionId ?? "_"}:${meta.agentId ?? "_"}:${meta.timestamp ?? 0}`;
  }

  /** Tool hook 配对 key：用 toolId+executionId */
  private toolKey(payload: ToolBeforePayload | ToolAfterPayload): string {
    const callTyped = payload.call as
      | { toolId?: string; contextMeta?: { executionId?: string } }
      | undefined;
    return `tool:${callTyped?.toolId ?? "_"}:${
      callTyped?.contextMeta?.executionId ?? "_"
    }`;
  }

  private extractToolId(payload: ToolAfterPayload): string {
    const callTyped = payload.call as { toolId?: string } | undefined;
    return callTyped?.toolId ?? "unknown";
  }

  /** 移除 undefined attributes 并把 attributes 限定到 string|number|boolean */
  private scrubAttributes(
    raw: Record<string, unknown>,
  ): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === undefined || v === null) continue;
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        out[k] = v;
      }
    }
    return out;
  }

  /** error 字段截断为业务无关摘要（不含 stack）*/
  private summarizeError(err: unknown): string {
    if (typeof err === "string") return err.slice(0, 200);
    if (err && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message).slice(0, 200);
    }
    return "unknown-error";
  }

  /** 导出 span，吞掉 exporter 异常防止影响主流程 */
  private exportSafe(span: TelemetrySpanData): void {
    try {
      const r = this.exporter.export(span);
      if (r && typeof r.catch === "function") {
        r.catch((err: unknown) => {
          this.logger?.warn(`[telemetry-otel] export failed: ${String(err)}`);
        });
      }
    } catch (err) {
      this.logger?.warn(`[telemetry-otel] export threw: ${String(err)}`);
    }
  }
}
