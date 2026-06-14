/**
 * AI Engine LLM Prompts
 * Prompt 模板管理导出
 */

export { PromptsModule } from "./prompts.module";
export { PromptTemplateService } from "./prompt-template.service";
export type {
  PromptTemplateData,
  CreatePromptTemplateDto,
} from "./prompt-template.service";
export { PromptRegistryService } from "./prompt-registry.service";

// Tier 适配（原 prompt-adaptation/，2026-06-03 合并入 prompts/）
export type { TierSuffix } from "./types";
export { TIER_SUFFIX_DEFAULTS } from "./tier-suffix-defaults.config";
export {
  PromptTierAdaptationService,
  TIER_SUFFIX_SEED,
  TIER_ADAPT_ENABLED_ENV,
} from "./prompt-tier-adaptation.service";
