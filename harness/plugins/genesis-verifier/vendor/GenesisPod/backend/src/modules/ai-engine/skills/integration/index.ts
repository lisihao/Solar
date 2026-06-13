/**
 * AI Engine - SKILL.md Integration (skill adapters / binding / registration)
 *
 * Barrel export for the unified SKILL.md runtime components.
 */

export { PromptSkillAdapter } from "./adapters/prompt-skill.adapter";
export {
  PromptSkillRegistrationService,
  type PromptSkillRegistrationResult,
} from "./registration/prompt-skill-registration.service";
export { PromptSkillRegistrationService as PromptSkillBridge } from "./registration/prompt-skill-registration.service";
export {
  InputBindingResolver,
  type BindingContext,
} from "./binding/skill-input-binding-resolver.service";
export { EngineSkillProvider } from "./adapters/engine-skill-provider.adapter";
