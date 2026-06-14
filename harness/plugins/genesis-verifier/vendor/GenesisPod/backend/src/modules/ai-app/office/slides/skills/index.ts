/**
 * Slides Engine v5.0 - Skills Module
 *
 * Code-based 技能 (NestJS Provider, barrel exports):
 *
 * Layer 3 - 模板调度层:
 * - TemplateMatcherSkill, PageTypeSelectionSkill (deprecated)
 *
 * Layer 4 - 内容生成层:
 * - ContentCompressionSkill, DataSupplementSkill (DI-dependent prompt)
 * - TemplateRenderingSkill, ChartRendererSkill, ImageFetcherSkill
 *
 * Layer 4.5 - 内容驱动布局:
 * - ContentAnalyzerSkill, LayoutOptimizerSkill
 *
 * Layer 5.5 - AI Edit (DI-dependent prompt):
 * - LayoutFixerSkill, ContentPolisherSkill, FactCheckerSkill
 *
 * Layer 6 - QualityAuditSkill
 * Layer 7 - SlideThinkingSkill
 * Layer 8 - VoiceNarrationSkill (DI-dependent prompt)
 *
 * Prompt 技能 (SKILL.md → PromptSkillBridge 自动注册):
 * - task-decomposition, outline-planning, four-step-design
 * - terminology-unifier, transition-checker
 *
 * 模板库：Templates - 32 种页面类型的专业 HTML 模板
 */

// Layer 3 - Template Dispatch
export * from "./template-matcher.skill";
export * from "./page-type-selection.skill"; // @deprecated - use TemplateMatcherSkill

// Layer 4 - Content Generation
export * from "./content-compression.skill";
export * from "./data-supplement.skill";
export * from "./template-rendering.skill";
export * from "./chart-renderer.skill";
export * from "./image-fetcher.skill";
export * from "./slide-html-generation.skill";
export { postProcessSlideHtml } from "./html-post-processor";

// Layer 4.5 - Content-Driven Layout (v4.0 experimental)
export * from "./content-analyzer.skill";
export * from "./layout-optimizer.skill";

// Layer 5.5 - AI Edit Skills (v5.0)
export * from "./layout-fixer.skill";
export * from "./content-polisher.skill";
export * from "./fact-checker.skill";

// Layer 5 - Consistency (prompt skills via SKILL.md → PromptSkillBridge)

// Layer 6 - Quality Assurance
export * from "./quality-audit.skill";

// Enhancement Skills (v6.1: quality improvement pipeline)
export * from "./design-token-injector.skill";
export * from "./smart-content-extractor.skill";
export * from "./slide-visual-validator.skill";
export * from "./slide-iterative-refiner.skill";
export * from "./deck-consistency-auditor.skill";
export * from "./slide-self-healer.skill";
export * from "./types/enhancement-types";

// Layer 7 - Monitoring & Transparency (v5.0)
export * from "./slide-thinking.skill";

// Layer 8 - Voice & Narration (v5.0)
export * from "./voice-narration.skill";

// Module (v4.0: 技能注册模块)
export * from "./slides-skills.module";

// Templates
export * from "../templates";
