/**
 * tool-gate.util — requireToolBeforeFinalize 闸的纯函数 helper。
 *
 * 从 react-loop.ts 抽出（god-class size guard：loop 文件 >2500 行，单次净增 ≤50）。
 *
 * 背景（prod mission df6c14ea 实证）：弱模型（deepseek-v4-flash / qwen3-max）常在
 * 第 1 轮就 finalize、0 工具、编造 arxiv.org/nature.com 假来源 → 维度 0/100。
 * researcher 等"必须先检索再产出"的 agent 用 requireToolBeforeFinalize 开启本闸。
 */

/** 同一 agent 因 0 工具被拦截并 nudge 的次数上限；超限后放行（防 retry 死循环）。 */
export const MAX_TOOL_GATE_NUDGES = 2;

/**
 * 是否应拦截本次 finalize（强制先调用一次真实工具）。
 * 仅在仍有迭代预算 + nudge 未超限时拦截；逼近 maxIterations 或多次 nudge 仍无成功
 * 工具（如搜索环境全挂）则返回 false 放行，避免反向洞察 #4 的 retry 死循环。
 */
export function shouldBlockFinalizeForToolGate(opts: {
  requireToolBeforeFinalize: boolean | undefined;
  successfulToolCalls: number;
  toolGateNudges: number;
  iteration: number;
  maxIterations: number;
}): boolean {
  return (
    !!opts.requireToolBeforeFinalize &&
    opts.successfulToolCalls === 0 &&
    opts.toolGateNudges < MAX_TOOL_GATE_NUDGES &&
    opts.iteration < opts.maxIterations - 1
  );
}

/** 拦截时注入给 LLM 的 critique —— 明确要求先发一个 tool_call 再 finalize。 */
export function buildToolGateCritique(nudge: number, max: number): string {
  return (
    `[TOOL REQUIRED ${nudge}/${max}] You attempted to finalize WITHOUT calling any research tool, ` +
    `so any findings would be fabricated. You MUST first emit at least one tool_call ` +
    `(e.g. web-search / arxiv-search / rag-search) to gather real evidence, then finalize ` +
    `using ONLY the returned results. ` +
    `Emit exactly: {"thinking":"...","action":{"kind":"tool_call","toolId":"web-search","input":{"query":"<your query>"}}}`
  );
}
