/**
 * Steward stage agent — barrel export
 *
 * 资源守门员，当前唯一 scope: budget-guard（预算 token / cost 阈值警告）。
 * 历史预留 scope（compliance-check / data-boundary / source-diversity）已删
 * （2026-05-15 PR-E），从未接入 orchestrator 也无 SKILL.md duty body。
 */

export {
  StewardAgent,
  type StewardInput,
  type StewardOutput,
} from "./steward.agent";
