/**
 * RadarEvents —— EventBus 事件 schema 注册清单
 *
 * 所有 ai-radar.* 事件必须在此声明 zod schema；EventBus 校验未注册的
 * type 一律 drop+warn 不广播。
 *
 * scope.missionId 实际是 RadarRun.id，前端 socket.io room "radar:<runId>"。
 */
import { z } from "zod";
import type { DomainEventTypeSpec } from "@/modules/ai-harness/facade";

export const RunStartedSchema = z.object({
  runId: z.string(),
  topicId: z.string(),
  trigger: z.enum(["MANUAL", "SCHEDULED", "FIRST_RUN"]),
  startedAt: z.string(),
});

export const RunStageSchema = z.object({
  runId: z.string(),
  topicId: z.string(),
  stage: z.string(),
  status: z.enum(["started", "completed", "failed"]),
  message: z.string().optional(),
  metrics: z.record(z.unknown()).optional(),
});

// 2026-05-17 R4-B 整改：status 改小写对齐 DB VarChar(20) 实际值 + 前端
// RadarRunStatus / useRadarSocket.RadarRunCompletedEvent 小写枚举。原大写
// 与 frontend 类型不匹配，任何 `if (e.status === 'completed')` 在 prod
// 恒 false（reviewer 已确认 dead code 路径）。
export const RunCompletedSchema = z.object({
  runId: z.string(),
  topicId: z.string(),
  status: z.enum(["completed", "failed", "cancelled"]),
  durationMs: z.number(),
  metrics: z.record(z.unknown()),
});

export const RunFailedSchema = z.object({
  runId: z.string(),
  topicId: z.string(),
  error: z.string(),
  durationMs: z.number(),
});

export const RunCancelledSchema = z.object({
  runId: z.string(),
  topicId: z.string(),
  reason: z.string(),
});

/**
 * RunRejectedSchema —— 2026-05-17 R4 闭环 markRejected 调用链。
 *
 * dispatcher.catch 在识别到 framework 抛出的 budget/rate-limit 类异常时
 * 调 store.markRejected + emit 此事件；与 RUN_FAILED 区分让运维 + 前端
 * 知道 "用户没真烧 token，只是被门槛挡了"。
 */
export const RunRejectedSchema = z.object({
  runId: z.string(),
  topicId: z.string(),
  reason: z.string(),
});

/**
 * RunSourceProgressSchema —— 单个采集源完成的实时进度（对齐 playground 细粒度
 * 事件流）。每个 source 在 S2 fanOut 中一完成就 emit 一条，让前端 Drawer 能逐源
 * 点亮"Cisco Blogs RSS → 12 条 (1.2s)" / "某源 → 超时"。
 */
export const RunSourceProgressSchema = z.object({
  runId: z.string(),
  topicId: z.string(),
  sourceId: z.string(),
  sourceLabel: z.string(),
  sourceType: z.string(),
  items: z.number(),
  durationMs: z.number(),
  error: z.string().nullable(),
  /** 抓到的条目样本（title+url，top N）—— 让前端显示"具体采集了什么"，可点击原文 */
  sample: z
    .array(
      z.object({
        title: z.string().nullable(),
        url: z.string().nullable(),
      }),
    )
    .optional(),
});

export const InsightCreatedSchema = z.object({
  runId: z.string(),
  topicId: z.string(),
  insightId: z.string(),
  signalCount: z.number(),
  entityCount: z.number(),
});

export const SourceHealthChangedSchema = z.object({
  runId: z.string().optional(),
  topicId: z.string(),
  sourceId: z.string(),
  health: z.enum(["HEALTHY", "DEGRADED", "FAILING", "UNKNOWN"]),
  consecutiveFailures: z.number(),
});

const S = <TPayload>(
  type: string,
  schema: z.ZodType<TPayload>,
): DomainEventTypeSpec<TPayload> => ({ type, schema });

export const RADAR_DOMAIN_EVENTS: readonly DomainEventTypeSpec[] = [
  S("ai-radar.run.started", RunStartedSchema),
  S("ai-radar.run.stage", RunStageSchema),
  S("ai-radar.run.source-progress", RunSourceProgressSchema),
  S("ai-radar.run.completed", RunCompletedSchema),
  S("ai-radar.run.failed", RunFailedSchema),
  S("ai-radar.run.cancelled", RunCancelledSchema),
  S("ai-radar.run.rejected", RunRejectedSchema),
  S("ai-radar.insight.created", InsightCreatedSchema),
  S("ai-radar.source.health-changed", SourceHealthChangedSchema),
];
