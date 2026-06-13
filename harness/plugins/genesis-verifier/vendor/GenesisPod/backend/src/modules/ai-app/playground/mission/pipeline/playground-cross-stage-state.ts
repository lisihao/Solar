/**
 * PlaygroundCrossStageState —— Stage 1 / S1-2 (2026-05-09,closes T3)
 *
 * Typed wrapper around harness `CrossStageState`,替代 SessionEntry 内的 14 个
 * ad-hoc cache fields(`lastPlan` / `lastResearcherResults` / ... /
 * `s4PatchFailures` / `inheritedResearchResults` / `inheritedChapters`)。
 *
 * 2026-05-24 P4 重构：base 上提到
 *   `ai-harness/teams/business-team/state/business-team-cross-stage-state.framework`，
 * playground 仅暴露 typed 字段视图（business-agnostic 底座 + business 视图分离）。
 *
 * **设计目标**(idempotent refactor,外部行为完全保留):
 *   - getter/setter 语法与原 field 一致(`entry.crossState.lastPlan = X`)
 *   - 内部 sync in-memory Map（从 framework / 底座 CrossStageState 继承），0 async I/O
 *   - 底座是 harness CrossStageState，playground 视图与 social/research 等业务方解耦
 *
 * 详见:
 *   - docs/architecture/ai-app/playground/agent-team-boundary-audit-2026-05-08.md §7 S1-2 + §2.5 T3
 *   - docs/architecture/ai-harness/facade/sediment-topology.md §5 T3
 */

import {
  BusinessTeamCrossStageStateFramework,
  CrossStageState,
} from "@/modules/ai-harness/facade";
import type { MissionContext } from "../context/mission-context";

type LastPlan = MissionContext["plan"];
type LastResearcherResults = MissionContext["researcherResults"];
type LastReconciliationReport = MissionContext["reconciliationReport"];
type LastAnalystOutput = MissionContext["analystOutput"];
type LastOutlinePlan = MissionContext["outlinePlan"];
type LastReport = MissionContext["report"];
type LastReportArtifact = MissionContext["reportArtifact"];
type LastReviewScore = MissionContext["reviewScore"];
type LastVerifierVerdicts = unknown[];
type LastLeaderForeword = MissionContext["leaderForeword"];
type LastLeaderSignOff = MissionContext["leaderSignOff"];
type S4PatchFailures = MissionContext["s4PatchFailures"];

interface InheritedResearchResult {
  dimension: string;
  findings: { claim: string; evidence: string; source: string }[];
  summary: string;
}
interface InheritedChapter {
  dimension: string;
  chapterIndex: number;
  heading: string;
  thesis?: string;
  content: string;
  score?: number;
  attempts: number;
  wordCount?: number;
}

export class PlaygroundCrossStageState extends BusinessTeamCrossStageStateFramework {
  // ── stage 中间产物缓存(11 类) ────────────────────────────────────────────

  get lastPlan(): LastPlan | undefined {
    return this.read<LastPlan>("lastPlan");
  }
  set lastPlan(value: LastPlan | undefined) {
    this.write("lastPlan", value);
  }

  get lastResearcherResults(): LastResearcherResults | undefined {
    return this.read<LastResearcherResults>("lastResearcherResults");
  }
  set lastResearcherResults(value: LastResearcherResults | undefined) {
    this.write("lastResearcherResults", value);
  }

  get lastReconciliationReport(): LastReconciliationReport | undefined {
    return this.read<LastReconciliationReport>("lastReconciliationReport");
  }
  set lastReconciliationReport(value: LastReconciliationReport | undefined) {
    this.write("lastReconciliationReport", value);
  }

  get lastAnalystOutput(): LastAnalystOutput | undefined {
    return this.read<LastAnalystOutput>("lastAnalystOutput");
  }
  set lastAnalystOutput(value: LastAnalystOutput | undefined) {
    this.write("lastAnalystOutput", value);
  }

  get lastOutlinePlan(): LastOutlinePlan | undefined {
    return this.read<LastOutlinePlan>("lastOutlinePlan");
  }
  set lastOutlinePlan(value: LastOutlinePlan | undefined) {
    this.write("lastOutlinePlan", value);
  }

  get lastReport(): LastReport | undefined {
    return this.read<LastReport>("lastReport");
  }
  set lastReport(value: LastReport | undefined) {
    this.write("lastReport", value);
  }

  get lastReportArtifact(): LastReportArtifact | undefined {
    return this.read<LastReportArtifact>("lastReportArtifact");
  }
  set lastReportArtifact(value: LastReportArtifact | undefined) {
    this.write("lastReportArtifact", value);
  }

  get lastReviewScore(): LastReviewScore | undefined {
    return this.read<LastReviewScore>("lastReviewScore");
  }
  set lastReviewScore(value: LastReviewScore | undefined) {
    this.write("lastReviewScore", value);
  }

  get lastVerifierVerdicts(): LastVerifierVerdicts | undefined {
    return this.read<LastVerifierVerdicts>("lastVerifierVerdicts");
  }
  set lastVerifierVerdicts(value: LastVerifierVerdicts | undefined) {
    this.write("lastVerifierVerdicts", value);
  }

  get lastLeaderForeword(): LastLeaderForeword | undefined {
    return this.read<LastLeaderForeword>("lastLeaderForeword");
  }
  set lastLeaderForeword(value: LastLeaderForeword | undefined) {
    this.write("lastLeaderForeword", value);
  }

  get lastLeaderSignOff(): LastLeaderSignOff | undefined {
    return this.read<LastLeaderSignOff>("lastLeaderSignOff");
  }
  set lastLeaderSignOff(value: LastLeaderSignOff | undefined) {
    this.write("lastLeaderSignOff", value);
  }

  // ── 跨 stage 共享状态 ────────────────────────────────────────────────────

  get s4PatchFailures(): S4PatchFailures | undefined {
    return this.read<S4PatchFailures>("s4PatchFailures");
  }
  set s4PatchFailures(value: S4PatchFailures | undefined) {
    this.write("s4PatchFailures", value);
  }

  // ── #37 S3 迭代级 checkpoint(2026-05-23) ──────────────────────────────
  // dim → ResearcherDimResult；resume 时用来跳过已完成维度。
  get s3PartialResults(): Record<string, unknown> | undefined {
    return this.read<Record<string, unknown>>("s3PartialResults");
  }
  set s3PartialResults(value: Record<string, unknown> | undefined) {
    this.write("s3PartialResults", value);
  }

  // ── trajectory rerun cache(P0-D 完整版,2026-05-06) ────────────────────

  get inheritedResearchResults(): InheritedResearchResult[] | undefined {
    return this.read<InheritedResearchResult[]>("inheritedResearchResults");
  }
  set inheritedResearchResults(value: InheritedResearchResult[] | undefined) {
    this.write("inheritedResearchResults", value);
  }

  get inheritedChapters(): InheritedChapter[] | undefined {
    return this.read<InheritedChapter[]>("inheritedChapters");
  }
  set inheritedChapters(value: InheritedChapter[] | undefined) {
    this.write("inheritedChapters", value);
  }

  // ── 序列化(Stage 2 follow-up:接 IMissionStore.saveCrossStageState) ────
  // toJSON inherited from base; fromJSON 重写让返回类型收窄到 Playground 子类。

  static fromJSON(data: Record<string, unknown>): PlaygroundCrossStageState {
    return new PlaygroundCrossStageState(CrossStageState.fromJSON(data));
  }
}
