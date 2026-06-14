/**
 * AI Writing Quality Services - 质量提升服务模块
 *
 * 导出所有质量相关服务：
 * - ExpressionMemoryService: 表达记忆服务
 * - CharacterPersonalityService: 角色人格服务
 * - CharacterConsistencyService: 角色一致性服务 - 状态追踪和OOC检测 (v4)
 * - WritingQualityGateService: 质量门禁服务
 * - HistoricalKnowledgeService: 历史知识服务
 * - DialogueConstraintsService: 对话约束服务 - 时代对话风格和角色对话生成 (v4)
 * - OutputValidatorService: 输出验证服务
 * - NarrativePacingService: 叙事节奏服务
 * - SemanticConsistencyService: 语义一致性检查服务 (v2)
 * - ExpressionAlternativesService: 表达替代生成服务 (v2)
 * - ProfessionalVoiceService: 专业声音服务 - 职业思维映射 (v3)
 * - SensoryImmersionService: 五感沉浸服务 - 感官描写增强 (v3)
 * - OpeningHookService: 开篇钩子服务 - 网文开篇技巧 (v3)
 * - ForeshadowingService: 伏笔追踪服务 - 长中短线伏笔管理 (v3)
 * - PacingControlService: 节奏控制服务 - 叙事节奏张弛有度 (v3)
 * - ChapterQualityEvaluatorService: 章节质量评估服务 - 多维度评估 (v3)
 * - NarrativeCraftService: 叙事工艺服务 - 禁止说教/总结式结尾/NPC对话 (v3)
 * - StoryCompletionDetectorService: 智能故事完结检测服务 - 多维度完结分析 (v4-DOME)
 */

export * from "./expression-memory.service";
export * from "./character-personality.service";
export * from "./character-consistency.service";
export * from "./historical-knowledge.service";
export * from "./dialogue-constraints.service";
export * from "./output-validator.service";
export * from "./narrative-pacing.service";
export * from "./semantic-consistency.service";
export * from "./expression-alternatives.service";
export * from "./professional-voice.service";
export * from "./sensory-immersion.service";
export * from "./opening-hook.service";
export * from "./foreshadowing.service";
export * from "./pacing-control.service";
export * from "./chapter-quality-evaluator.service";
export * from "./narrative-craft.service";

// Export services with potential type conflicts separately
export { WritingQualityGateService } from "./quality-gate.service";
export type { QualityIssue as QualityGateIssue } from "./quality-gate.service";

export { WritingQualityCheckerService } from "./writing-quality-checker.service";
export type {
  WritingQualityIssue,
  QualityIssueSeverity,
  QualityIssueType,
} from "./writing-quality-checker.service";

// Story Completion Detector (DOME-inspired)
export { StoryCompletionDetectorService } from "./story-completion-detector.service";
export type {
  CompletionSignal,
  CompletionAnalysis,
  CompletionSignalType,
} from "./story-completion-detector.service";
