/**
 * ai-harness/evaluation/critique —— Reflexion 批评-改进闭环（沉淀自 {app}, 2026-04-29）
 *
 * 参考: Reflexion (Shinn et al., 2023) + Self-Consistency (Wang et al., 2022)
 *
 * 单一入口 CritiqueRefineService.run({ content, context, config }) →
 * 多轮 critique → refine → reach 收敛阈值或 maxIterations。
 *
 * TI 仍使用 ai-app/{app}/services/quality/critique-refine.service.ts。
 */

export { CritiqueRefineService } from "./critique-refine.service";
export type { CritiqueRefineRequest } from "./critique-refine.service";
// ★ 沉淀 v2: section-level 4 维自评（写中评估，~700 token）
export { SectionSelfEvalService } from "./section-self-eval.service";
// ★ 沉淀 v2: 内容缺陷扫描（纯函数 utility，0 LLM）
export {
  type ContentDefectScan,
  type DefectDetail,
  type DefectDetails,
  scanContentDefects,
  createEmptyScan,
  extractDefectDetails,
} from "./defect-scanner";
export {
  CritiqueCategory,
  CritiqueSeverity,
  type CritiqueItem,
  type CritiqueResult,
  type RefineResult,
  type CritiqueRefineIteration,
  type CritiqueRefineLoopResult,
  type CritiqueRefineConfig,
  type SelfEvalDimension,
  type SectionSelfEvalResult,
  type RemediationAction,
  type RemediationActionType,
  type RemediationResult,
  type RemediationTrace,
  DEFAULT_CRITIQUE_REFINE_CONFIG,
} from "./quality.types";

// ★ 沉淀 v3 (2026-04-29): code-enforced 质量门控（取代部分 LLM 审阅）
export {
  ReportQualityGateService,
  type QualityViolation,
  type QualityCheckResult,
} from "./report-quality-gate.service";

// ★ 沉淀 v3 (2026-04-29): 弱维度合并补救（单次 LLM 调用 + STRONG tier 升级）
export { SectionRemediationService } from "./section-remediation.service";

// ★ 沉淀 Phase 3 (2026-04-29): 字数中位数归一化（沉淀自 TI leader-planning）
export {
  balanceTargetWords,
  type BalancerOptions,
  type BalancerResult,
} from "./word-count-balancer";

// ★ 沉淀 v3 (2026-04-29): 10 维结构化报告评审 + 模型对比（EVALUATOR 类型）
export {
  ReportEvaluationService,
  type EvaluationDimension,
  type ChapterEvaluation,
  type EvaluationResult,
  type ModelComparisonEntry,
  type ChapterInput,
} from "./report-evaluation.service";

// ★ 沉淀 v3 (2026-04-29): 全链路质量 trace（5 探针 + 5 维评分）— 纯计算，持久化由消费方
export {
  QualityTraceComputeService,
  type QualityTraceContext,
  type QualityTrace,
  type QualityTraceEvidence,
  type EvidenceQualityProbe,
  type DimensionOutputProbe,
  type PostProcessingProbe,
  type SynthesisOutputProbe,
  type FinalAssessmentProbe,
  type OutputReviewProbe,
  type PromptMetadata,
} from "./quality-trace-compute.service";
