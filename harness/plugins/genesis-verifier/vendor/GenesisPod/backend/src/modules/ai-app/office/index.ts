/**
 * AI Office Module
 * 统一导出 Slides 相关服务、控制器和类型
 */

// Core (AIModelService 作为 Skills 后备)
export * from "./core";

// Slides (幻灯片生成) - v5.0: 使用 AI Teams Leader 协调模式
export * from "./slides";

// Common (共享服务) - Slides 使用的分析和模板选择服务
export {
  AIOfficeCommonModule,
  // 枚举类型
  ContentComplexity,
  ContentCategory,
  DataDensity,
  TemporalDimension,
  // 服务
  ContentAnalysisService,
  TemplateSelectionService,
  ReadingExperienceService,
  // 服务相关类型
  type SlidePlanItem,
  type PlanningResult,
  type OptimizedParagraph,
  type OptimizedSection,
} from "./common";

// Agents
export * from "./agents";

// Module
export { AiOfficeModule } from "./ai-office.module";
