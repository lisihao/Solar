/**
 * 辩论 Pattern - 通用编排基元（无持久化）
 *
 * 来源：W1 PR2，docs/architecture/ai-app/ask/teams-mode-review.md §3.1 P0-4
 */

export { DebatePattern } from "./debate-pattern";
export {
  buildAgentSystemPrompt,
  composeJudgeUserMessage,
  composeRoundUserMessage,
} from "./debate-prompts";
export type {
  DebatePatternConfig,
  DebateRole,
  DebateRoundResult,
  IDebateAgent,
} from "./debate.types";
