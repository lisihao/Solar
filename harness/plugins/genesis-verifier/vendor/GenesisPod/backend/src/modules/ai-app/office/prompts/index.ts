/**
 * AI Office 提示词模块
 * 统一管理内容分析、模板选择、内容生成的 AI 提示词
 * Note: DOCS_* prompts have been deprecated and removed
 */

// 内容分析提示词
export {
  CONTENT_ANALYSIS_SYSTEM_PROMPT,
  CONTENT_ANALYSIS_USER_PROMPT,
  IMAGE_MATCHING_SYSTEM_PROMPT,
  READING_EXPERIENCE_SYSTEM_PROMPT,
} from "./content-analysis.prompt";

// 模板选择提示词 (Slides only)
export {
  SLIDE_TEMPLATE_SELECTION_SYSTEM_PROMPT,
  TEMPLATE_SELECTION_USER_PROMPT,
} from "./template-selection.prompt";

// 内容生成提示词 (Slides only)
export {
  SLIDE_CONTENT_GENERATION_SYSTEM_PROMPT,
  SLIDE_CONTENT_USER_PROMPT,
  IMAGE_PROMPT_GENERATION_SYSTEM_PROMPT,
} from "./content-generation.prompt";

// AI 自适应 HTML 生成设计系统 (v6.0)
export {
  SLIDE_DESIGN_SYSTEM_PROMPT,
  buildSlideHtmlUserPrompt,
} from "./slide-design-system.prompt";
