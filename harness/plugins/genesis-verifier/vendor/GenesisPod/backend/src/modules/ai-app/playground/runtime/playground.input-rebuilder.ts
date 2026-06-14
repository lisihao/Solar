/**
 * PlaygroundMissionInputRebuilder —— C5/C6 / G7-G8（2026-05-22）：playground 对 harness
 * MissionInputRebuilder 契约的实现(纯值变换,无运行时 IO)。
 *
 * 职责:把 playground 的 RunMissionInput / 既有 snapshot 产出 typed MissionConfigSnapshot
 * (openSession 冻结 + rerun 派生)。**唯一 config 真源**——取代旧 userProfile JSON 重拼。
 *   - businessInput = 业务子集(depth/style/length/... 平台不解释);topic/language/budget/
 *     runtimeLimits 在 snapshot 顶层(§0.8 共识岔口1:禁把整个 RunMissionInput 塞 businessInput)。
 *   - budget 走 ResolvedBudgetCaps.resolve()(唯一换算处);wallTimeCap 走 resolveMissionWallTimeMs
 *     (外部输入 override → 内部 cap 的合法边界映射)。
 *   - rerun:applyInputPatch(白名单 patch + re-resolve + 派生新 versioned snapshot,不就地改)。
 */

import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  ResolvedBudgetCaps,
  applyInputPatch,
  type MissionConfigSnapshot,
  type MissionInputPatch,
  type MissionInputRebuilder,
} from "@/modules/ai-harness/facade";
import {
  BUDGET_PROFILE,
  SEARCH_TIME_RANGE_VALUES,
  resolveMissionCredits,
  resolveBudgetMultiplier,
  resolveMissionWallTimeMs,
  type RunMissionInput,
} from "../api/dto/run-mission.dto";

/** playground config snapshot 当前结构版本(结构演进才 ++)。 */
export const PLAYGROUND_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * RB5: playground businessInput 运行期 zod schema(单一真源)。
 * 字段与 RunMissionInputSchema 业务子集同步；顶层字段(topic/language/budget/runtimeLimits)不在此。
 */
export const playgroundBusinessInputSchema = z.object({
  /** 选填长文本研究描述（用户 brief）——持久化进 snapshot，供设置视图回显 + 重跑 rehydrate
   *  + 透传给 Leader plan / Researcher。2026-05-29 修：原先只在首跑内存里传 Leader，
   *  没进 snapshot → 设置看不到、刷新/重跑丢失。 */
  description: z.string().max(10000).optional(),
  depth: z.enum(["quick", "standard", "deep"]),
  budgetProfile: z.enum(BUDGET_PROFILE),
  styleProfile: z.enum(["academic", "executive", "journalistic", "technical"]),
  lengthProfile: z.enum([
    "brief",
    "standard",
    "deep",
    "extended",
    "epic",
    "mega",
  ]),
  audienceProfile: z.enum(["executive", "domain-expert", "general-public"]),
  withFigures: z.boolean(),
  auditLayers: z.enum(["minimal", "default", "thorough", "thorough+"]),
  concurrency: z.number().int().min(1).max(10),
  viewMode: z.enum(["continuous", "chapter", "quick"]),
  searchTimeRange: z.enum(SEARCH_TIME_RANGE_VALUES),
  knowledgeBaseIds: z.array(z.string().uuid()).max(10).optional(),
  inheritFromMissionId: z.string().uuid().optional(),
});

/**
 * playground 业务输入子集(平台不解释)。**不含** topic/language(顶层)、
 * maxCredits/wallTimeMs/budgetMultiplierOverride(归 budget/runtimeLimits 顶层)。
 */
export type PlaygroundBusinessInput = z.infer<
  typeof playgroundBusinessInputSchema
>;

export type PlaygroundConfigSnapshot =
  MissionConfigSnapshot<PlaygroundBusinessInput>;

/** patch 的业务子集(rerun 时可改的业务字段,白名单)。 */
export type PlaygroundBusinessPatch = Partial<PlaygroundBusinessInput>;

function extractBusinessInput(input: RunMissionInput): PlaygroundBusinessInput {
  return {
    description: input.description,
    depth: input.depth,
    budgetProfile: input.budgetProfile,
    styleProfile: input.styleProfile,
    lengthProfile: input.lengthProfile,
    audienceProfile: input.audienceProfile,
    withFigures: input.withFigures,
    auditLayers: input.auditLayers,
    concurrency: input.concurrency,
    viewMode: input.viewMode,
    searchTimeRange: input.searchTimeRange,
    knowledgeBaseIds: input.knowledgeBaseIds,
    inheritFromMissionId: input.inheritFromMissionId,
  };
}

@Injectable()
export class PlaygroundMissionInputRebuilder implements MissionInputRebuilder<
  RunMissionInput,
  PlaygroundBusinessInput,
  PlaygroundBusinessPatch
> {
  /** openSession 首跑:从 RunMissionInput 冻结出 snapshot v0。 */
  buildForFreshRun(input: RunMissionInput): PlaygroundConfigSnapshot {
    // RB5: 冻结时对 businessInput 做运行期 zod 校验(从 JSONB 读回时非法即抛)。
    const validatedBusinessInput = playgroundBusinessInputSchema.parse(
      extractBusinessInput(input),
    );
    return {
      schemaVersion: PLAYGROUND_SNAPSHOT_SCHEMA_VERSION,
      snapshotRevision: 0,
      snapshotId: randomUUID(),
      mutationReason: "fresh",
      resolvedAt: new Date().toISOString(),
      topic: input.topic,
      language: input.language,
      businessInput: validatedBusinessInput,
      // ★ 换算唯一处:credits→caps 走 ResolvedBudgetCaps;cap 时长走 resolveMissionWallTimeMs。
      budget: ResolvedBudgetCaps.resolve({
        maxCredits: resolveMissionCredits(input),
        budgetMultiplier: resolveBudgetMultiplier(input),
        source: "default",
      }),
      runtimeLimits: { wallTimeCapMs: resolveMissionWallTimeMs(input) },
    };
  }

  buildForFullRerun(
    snapshot: PlaygroundConfigSnapshot,
    patch?: MissionInputPatch<PlaygroundBusinessPatch>,
  ): PlaygroundConfigSnapshot {
    return this.derive(snapshot, patch, "full_rerun");
  }

  buildForIncrementalRerun(
    snapshot: PlaygroundConfigSnapshot,
    _checkpointStepId: string,
    patch?: MissionInputPatch<PlaygroundBusinessPatch>,
  ): PlaygroundConfigSnapshot {
    return this.derive(snapshot, patch, "incremental_rerun");
  }

  buildForLocalRerun(
    snapshot: PlaygroundConfigSnapshot,
    _targetStage: string,
    patch?: MissionInputPatch<PlaygroundBusinessPatch>,
  ): PlaygroundConfigSnapshot {
    return this.derive(snapshot, patch, "local_rerun");
  }

  /** 统一派生:走 harness applyInputPatch(白名单 + re-resolve + 派生新版本)。 */
  private derive(
    snapshot: PlaygroundConfigSnapshot,
    patch: MissionInputPatch<PlaygroundBusinessPatch> | undefined,
    mutationReason: "full_rerun" | "incremental_rerun" | "local_rerun",
  ): PlaygroundConfigSnapshot {
    return applyInputPatch(snapshot, patch, {
      snapshotId: randomUUID(),
      mutationReason,
      mergeBusinessInput: (current, businessInputPatch) => ({
        ...current,
        ...businessInputPatch,
      }),
    });
  }
}
