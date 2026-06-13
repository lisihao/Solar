/**
 * Barrel re-exports for writing prompt builder functions.
 */

export {
  buildWorldBuildingPrompt,
  type WorldBuildingPromptParams,
} from "./world-building.prompt";

export {
  buildOutlinePlanningPrompt,
  type OutlinePlanningPromptParams,
  type WorldSummary,
} from "./outline-planning.prompt";

export {
  buildChapterWriterPrompt,
  type ChapterWriterPromptParams,
  type ChapterCharacter,
  type ChapterInfo,
  type OutlineCore,
  type KeeperContext,
} from "./chapter-writer.prompt";

export {
  buildBibleUpdatePrompt,
  buildConsistencyCheckPrompt,
  buildConsistencyFixPrompt,
  type BibleUpdatePromptParams,
  type ConsistencyCheckPromptParams,
  type ConsistencyFixPromptParams,
  type ConsistencyFixIssue,
} from "./consistency-check.prompt";

export {
  buildEditorPrompt,
  buildOpeningRewritePrompt,
  buildChapterModifyPrompt,
  type EditorPromptParams,
  type OpeningRewritePromptParams,
  type ChapterModifyPromptParams,
} from "./editor.prompt";

export {
  buildChapterSummaryPrompt,
  type ChapterSummaryPromptParams,
} from "./chapter-summary.prompt";

export {
  buildLeaderAnalysisPrompt,
  type LeaderAnalysisPromptParams,
} from "./leader-analysis.prompt";

export {
  buildContinuationPrompt,
  buildSimpleContentSystemPrompt,
  buildFullStoryUserPrompt,
  buildOutlineUserPrompt,
  type ContinuationPromptParams,
  type SimpleContentSystemPromptParams,
} from "./continuation.prompt";
