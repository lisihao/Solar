/**
 * MissionConfigSnapshot —— C5 / G7（2026-05-22）：mission 启动时冻结的 canonical 运行时配置。
 *
 * 收口此前"input → row+JSON → rerun 重拼 → hydrate 重拼 → 前端再拼"的多源问题:
 *   - openSession 时解析一次 + 持久化;run/rerun/resume/hydrate 一律只读 snapshot。
 *   - ★ RB5:businessInput 不是 opaque blob——由 app 声明 schema(TBusiness 泛型,运行期 zod
 *     校验在 app adapter),平台据此做完整性校验 + 版本迁移。
 *   - ★ G2/RM4:任何影响 rerun 的配置改动必须生成**新 versioned snapshot**(snapshotRevision++ /
 *     parentSnapshotId 链),不就地改。schemaVersion=结构契约版本,snapshotRevision=同结构内
 *     实例派生次数(Codex r6:二者不可混)。
 *   - lineage(Codex r5):snapshotId/parentSnapshotId/derivedFromMissionId/mutationReason
 *     供事故审计——"为什么这次 rerun 用了这个预算"可追溯到派生方式。
 */

import type { ResolvedBudgetCaps } from "../../../guardrails/budget/resolved-budget-caps";
import type { ResolvedRuntimeLimits } from "./runtime-limits";

/** 派生方式(本快照怎么来的)。 */
export type MissionMutationReason =
  | "fresh"
  | "full_rerun"
  | "incremental_rerun"
  | "local_rerun"
  | "settings_patch"
  | "save_as_new";

export interface MissionConfigSnapshot<TBusiness = unknown> {
  /** 结构契约版本(snapshot 结构本身演进才 ++)。 */
  readonly schemaVersion: number;
  /** 同结构内实例派生次数(每次 rerun/patch 派生 ++)。 */
  readonly snapshotRevision: number;
  readonly snapshotId: string;
  readonly parentSnapshotId?: string;
  readonly derivedFromMissionId?: string;
  readonly mutationReason: MissionMutationReason;
  readonly resolvedAt: string;
  readonly topic: string;
  readonly language: string;
  /** app 声明 schema 的业务输入(非 opaque blob,RB5)。 */
  readonly businessInput: TBusiness;
  readonly budget: ResolvedBudgetCaps;
  readonly runtimeLimits: ResolvedRuntimeLimits;
}

/**
 * 从父快照派生子快照(rerun/patch 用):snapshotRevision++ / parentSnapshotId 链 /
 * 新 snapshotId / mutationReason 标注。schemaVersion 不变(结构没变)。
 * 不就地改父快照(G2)。budget/runtimeLimits/businessInput 由 caller 传(已 re-resolve)。
 */
export function deriveChildSnapshot<TBusiness>(
  parent: MissionConfigSnapshot<TBusiness>,
  next: {
    snapshotId: string;
    mutationReason: MissionMutationReason;
    budget: ResolvedBudgetCaps;
    runtimeLimits: ResolvedRuntimeLimits;
    businessInput: TBusiness;
    derivedFromMissionId?: string;
  },
): MissionConfigSnapshot<TBusiness> {
  return {
    schemaVersion: parent.schemaVersion,
    snapshotRevision: parent.snapshotRevision + 1,
    snapshotId: next.snapshotId,
    parentSnapshotId: parent.snapshotId,
    derivedFromMissionId:
      next.derivedFromMissionId ?? parent.derivedFromMissionId,
    mutationReason: next.mutationReason,
    resolvedAt: new Date().toISOString(),
    topic: parent.topic,
    language: parent.language,
    businessInput: next.businessInput,
    budget: next.budget,
    runtimeLimits: next.runtimeLimits,
  };
}
