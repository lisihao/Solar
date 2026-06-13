/**
 * Radar config snapshot —— C5/G7(2026-05-22,三 app 统一接入):radar mission 在 openSession
 * 冻结 typed MissionConfigSnapshot,与 playground/social 一致(统一契约)。
 *
 * 说明:radar 当前 rerun = 限次重新触发(不从 snapshot 重建输入),故只提供 buildForFreshRun
 * (无 full/incremental/local 变体)——契约一致即可,不为不存在的 rerun-rebuild 造变体(YAGNI)。
 * snapshot 是 radar mission 的 canonical 配置记录(单一真源,getById 暴露)。
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import {
  ResolvedBudgetCaps,
  type MissionConfigSnapshot,
} from "@/modules/ai-harness/facade";

export const RADAR_SNAPSHOT_SCHEMA_VERSION = 1;

/** RB5: radar businessInput 运行期 zod schema(单一真源)。 */
export const radarBusinessInputSchema = z.object({
  topicId: z.string().min(1),
  topicName: z.string().min(1),
  description: z.string().nullable().optional(),
  keywords: z.array(z.string()).optional(),
  entityType: z.string().nullable().optional(),
  refreshCron: z.string().optional(),
  trigger: z.string().min(1),
});

/** radar 业务输入子集(平台不解释)。topic/budget/runtimeLimits 在 snapshot 顶层。 */
export type RadarBusinessInput = z.infer<typeof radarBusinessInputSchema>;

export type RadarConfigSnapshot = MissionConfigSnapshot<RadarBusinessInput>;

/** openSession 首跑冻结 radar config snapshot。换算走 ResolvedBudgetCaps(唯一处)。 */
export function buildRadarConfigSnapshot(args: {
  businessInput: RadarBusinessInput;
  language?: string;
  maxCredits: number;
  budgetMultiplier: number;
  wallTimeCapMs: number;
}): RadarConfigSnapshot {
  // RB5: 冻结时对 businessInput 做运行期 zod 校验(从 JSONB 读回时非法即抛)。
  const validatedInput = radarBusinessInputSchema.parse(args.businessInput);
  return {
    schemaVersion: RADAR_SNAPSHOT_SCHEMA_VERSION,
    snapshotRevision: 0,
    snapshotId: randomUUID(),
    mutationReason: "fresh",
    resolvedAt: new Date().toISOString(),
    topic: validatedInput.topicName,
    language: args.language ?? "zh-CN",
    businessInput: validatedInput,
    budget: ResolvedBudgetCaps.resolve({
      maxCredits: args.maxCredits,
      budgetMultiplier: args.budgetMultiplier,
      source: "default",
    }),
    runtimeLimits: { wallTimeCapMs: args.wallTimeCapMs },
  };
}
