/**
 * Wiki Skills — registration entrypoint.
 *
 * The wiki module currently ships one prompt-only skill (`wiki-ingest`) defined
 * in `wiki-ingest.skill.md`. Skills are registered at boot via the WikiModule's
 * `onModuleInit` hook (per llm-wiki §3.1 + §5.1 Step 3) using:
 *   1. `SkillLoaderService.addSkillDirectory({ path: __dirname, domain: "library" })`
 *   2. `PromptSkillBridge.registerDomain("library")` to bridge SKILL.md → SkillRegistry
 *
 * Pattern parity: research/topic-insights/writing/office-slides all register
 * their prompt skills through PromptSkillBridge. This barrel file exists so
 * future code-based skills under wiki/ can be re-exported from a single point.
 */

export const WIKI_SKILLS_DIR = __dirname;
export const WIKI_SKILL_DOMAIN = "library" as const;
