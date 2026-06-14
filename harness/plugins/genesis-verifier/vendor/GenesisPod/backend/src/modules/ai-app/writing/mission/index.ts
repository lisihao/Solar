/**
 * Writing Mission —— mission-pipeline 迁移层 barrel export（B0 脚手架）
 *
 * 聚合 runtime（pipeline 配置）+ context（ctx / deps 类型），便于 module wire 与
 * stage / dispatcher 引用。后续波次（B1-B4）的 agents / roles / stages / pipeline /
 * projectors 落地后在此追加 re-export。
 */

// ─── runtime: pipeline 配置 ─────────────────────────────────────────────
export {
  WRITING_FULL_STORY_PIPELINE,
  WRITING_CHAPTER_PIPELINE,
  WRITING_OUTLINE_PIPELINE,
  WRITING_CONSISTENCY_PIPELINE,
  WRITING_EDIT_PIPELINE,
  selectWritingPipeline,
} from "./runtime/writing.config";

// ─── context: 跨 stage 共享状态包 ───────────────────────────────────────
export type {
  WritingMissionContext,
  WritingMissionInvariants,
  BudgetPhaseCtx,
  WorldPhaseCtx,
  OutlinePhaseCtx,
  DraftPhaseCtx,
  ConsistencyPhaseCtx,
  EditPhaseCtx,
  QualityPhaseCtx,
  PersistPhaseCtx,
} from "./context/mission-context";

// ─── context: stage 依赖包 ──────────────────────────────────────────────
export type {
  WritingMissionDeps,
  CommonDeps,
  WorldDeps,
  OutlineDeps,
  DraftDeps,
  ConsistencyDeps,
  EditDeps,
  QualityDeps,
  PersistDeps,
  AgentInvoker,
  WritingArtifactProjector,
  WritingMissionStore,
  EmitFn,
  LifecycleFn,
} from "./context/mission-deps";

// ─── projectors: WritingArtifact composer（B4）───────────────────────────
export { WritingArtifactProjector as WritingArtifactProjectorService } from "./projectors/writing-artifact.projector";
export type {
  WritingArtifact,
  WritingChapterListView,
  WritingFullTextView,
  WritingQualityReportView,
} from "./projectors/writing-artifact.projector";
