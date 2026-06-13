/**
 * BusinessAgentTeam — Stage Iteration Contract
 *
 * stage 迭代 / hook adaptation 的辅助类型，供 BusinessTeamOrchestratorFramework
 * 的 adaptRunnerToHooks 默认实现 + 业务方覆盖时使用。
 *
 * 注意：framework 的 default adapter 只支持最常见的"single-hook"模式（一个
 * stage 一个 primitive hook，如 persist / synthesize / draft）。多 hook stage
 * （如 s2-leader-plan 同时有 runRole + extractPlanFields；s3 同时有 fanOut +
 * perItemPipeline）需要业务方 override adaptRunnerToHooks 自定义。
 *
 * 2026-05-24 (P7) extracted from three ai-app business-orchestrator shared patterns.
 */

/**
 * Primitive ID → 主 hook 名称的标准映射。
 *
 * 来自三家业务 orchestrator 的最完整一份 PRIMARY_HOOK_BY_PRIMITIVE；其它两家
 * （纯 persist 子集）也满足这套映射，所以下沉到 framework。业务方可在
 * 子类构造时合并覆盖。
 */
export const DEFAULT_PRIMARY_HOOK_BY_PRIMITIVE: Readonly<
  Record<string, string>
> = {
  plan: "runRole",
  research: "perItemPipeline",
  assess: "runRole",
  synthesize: "synthesize",
  draft: "draftOnce",
  review: "review",
  signoff: "runRole",
  persist: "persist",
  learn: "postmortemClassifier",
};

/**
 * primitive → hook key 解析（framework 内默认 adapter 调用）；
 * 业务方 override 通过 BusinessTeamOrchestratorConfig.primaryHookOverrides 注入。
 */
export function resolvePrimaryHookKey(
  primitive: string,
  overrides?: Record<string, string>,
): string {
  return (
    overrides?.[primitive] ??
    DEFAULT_PRIMARY_HOOK_BY_PRIMITIVE[primitive] ??
    "persist"
  );
}
