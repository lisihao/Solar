/**
 * Topic Research Prompts
 *
 * 导出所有 Prompt 模板
 */

export {
  HEADING_HIERARCHY,
  NARRATIVE_STRUCTURE,
  PROFESSIONAL_TONE,
  FORMATTING_LIMITS,
  ANALYSIS_DEPTH,
  CITATION_STANDARDS,
  CHART_STANDARDS,
  TABLE_STANDARDS,
  DIMENSION_OPENING_CONCLUSION,
  CHAPTER_HIGHLIGHTS,
  EXECUTIVE_SUMMARY_FORMAT,
  SYNTHESIS_FORMATTING,
  QUALITY_CHECKLIST,
  getWritingStandards,
  getExecutiveSummaryFormat,
  getDimensionResearchStandards,
  getQualityChecklist,
} from "@/modules/ai-app/contracts/report-template";

export {
  DIMENSION_RESEARCH_SYSTEM_PROMPT,
  DIMENSION_RESEARCH_USER_PROMPT_TEMPLATE,
  formatEvidenceForPrompt,
  renderPromptTemplate,
  getLanguageInstruction,
} from "./dimension-research.prompt";

export {
  REPORT_SYNTHESIS_SYSTEM_PROMPT,
  REPORT_SYNTHESIS_USER_PROMPT_TEMPLATE,
  formatDimensionOverview,
  formatDimensionDetails,
  formatEvidenceList,
  renderReportSynthesisPrompt,
  renderSynthesisSystemPrompt,
} from "./report-synthesis.prompt";

export {
  LEADER_PLAN_PROMPT,
  LEADER_REVIEW_PROMPT,
  GLOBAL_OUTLINE_PROMPT,
  DIMENSION_OUTLINE_PROMPT,
  SECTION_REVIEW_PROMPT,
  LEADER_DECODE_PROMPT,
  LEADER_INTERVENE_PROMPT,
} from "./research-leader.prompt";

export {
  REPORT_EDITING_SYSTEM_PROMPT,
  REPORT_EDIT_OPERATION_PROMPTS,
  TARGET_STYLE_NAMES,
  getStylePrompt,
  buildEditPrompt,
  buildEnhancedEditPrompt,
  type EnhancedEditPromptOptions,
} from "./report-editing.prompt";

export {
  PROMPT_VERSIONS,
  PROMPT_METADATA,
  getPromptMetadata,
  hashPrompt,
  type PromptMetadata,
  type PromptName,
} from "./prompt-version";
