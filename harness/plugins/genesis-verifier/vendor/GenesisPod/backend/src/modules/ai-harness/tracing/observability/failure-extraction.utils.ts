/**
 * Failure-extraction utilities — read agent event streams to derive
 * structured failure diagnostic + human-friendly message.
 *
 * 纯函数，无副作用，无依赖。从 mission/workflow/team.mission.ts 抽出。
 */

import type { IAgentEvent } from "@/modules/ai-harness/facade";

/**
 * 抽取 RunResult.events 里最具体的 failure 快照。
 * 策略：倒序扫描 error 事件，第一个带 failureCode 的就是 root cause。
 */
export function extractAgentFailureDiagnostic(events: readonly IAgentEvent[]):
  | {
      failureCode?: string;
      message?: string;
      diagnostic?: Record<string, unknown>;
      recoveryHint?: Record<string, unknown>;
    }
  | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === "error") {
      const p = ev.payload as {
        message?: string;
        failureCode?: string;
        diagnostic?: Record<string, unknown>;
        recoveryHint?: Record<string, unknown>;
      } | null;
      if (p?.failureCode) {
        return {
          failureCode: p.failureCode,
          message: p.message,
          diagnostic: p.diagnostic,
          recoveryHint: p.recoveryHint,
        };
      }
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === "terminated") {
      const p = ev.payload as { reason?: string } | null;
      if (p?.reason && p.reason !== "completed") {
        const code =
          p.reason === "budget"
            ? "LOOP_BUDGET_EXHAUSTED"
            : p.reason === "cancelled"
              ? "UNKNOWN"
              : p.reason === "empty_llm_response"
                ? "LOOP_EMPTY_RESPONSE_IMMEDIATE"
                : p.reason === "error"
                  ? "PROVIDER_API_ERROR"
                  : "UNKNOWN";
        return { failureCode: code };
      }
    }
  }
  return undefined;
}

export function extractFailureMessage(
  events: readonly IAgentEvent[],
  state: string,
  hasOutput: boolean,
  runStats?: { iterations?: number; wallTimeMs?: number; tokensUsed?: number },
): string | undefined {
  if (state === "completed") return undefined;
  const tokensUsed =
    runStats?.tokensUsed ??
    events.reduce((sum, ev) => {
      if (ev.type === "action_executed") {
        const p = ev.payload as { tokensUsed?: number } | null;
        if (p && typeof p.tokensUsed === "number") return sum + p.tokensUsed;
      }
      return sum;
    }, 0);
  const reflectionVerdicts: { score: number; critique?: string }[] = [];
  for (const ev of events) {
    if (ev.type === "reflection") {
      const p = ev.payload as {
        score?: number;
        verdicts?: { score?: number; critique?: string }[];
      } | null;
      if (typeof p?.score === "number") {
        reflectionVerdicts.push({ score: p.score });
      }
      if (Array.isArray(p?.verdicts)) {
        for (const v of p.verdicts) {
          if (typeof v.score === "number") {
            reflectionVerdicts.push({
              score: v.score,
              critique: v.critique,
            });
          }
        }
      }
    }
  }
  const finalizeObs = events.filter((ev) => {
    if (ev.type !== "action_executed") return false;
    const p = ev.payload as {
      action?: { kind?: string };
      output?: unknown;
    } | null;
    return p?.action?.kind === "finalize";
  });
  const emptyFinalize = finalizeObs.filter((ev) => {
    const p = ev.payload as { output?: unknown } | null;
    const out = p?.output;
    return (
      out == null ||
      out === "" ||
      (typeof out === "string" && out.trim() === "")
    );
  });
  const llmReturnedEmpty =
    finalizeObs.length >= 2 && emptyFinalize.length === finalizeObs.length;
  let usedModelId: string | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === "thinking") {
      const p = ev.payload as { modelId?: string } | null;
      if (p?.modelId) {
        usedModelId = p.modelId;
        break;
      }
    }
  }
  const ctx = {
    iterations: runStats?.iterations,
    wallTimeMs: runStats?.wallTimeMs,
    tokensUsed: tokensUsed > 0 ? tokensUsed : undefined,
    reflectionVerdicts,
    llmReturnedEmpty,
    emptyFinalizeCount: emptyFinalize.length,
    usedModelId,
  };
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === "error") {
      const p = ev.payload as {
        message?: string;
        failureCode?: string;
        diagnostic?: Record<string, unknown>;
      } | null;
      if (p?.failureCode) {
        const diagSnippet = p.diagnostic
          ? ` [${Object.entries(p.diagnostic)
              .filter(
                ([k, v]) =>
                  v != null &&
                  [
                    "modelId",
                    "completionTokens",
                    "toolId",
                    "schemaError",
                  ].includes(k),
              )
              .map(
                ([k, v]) =>
                  `${k}=${typeof v === "string" ? v.slice(0, 80) : v}`,
              )
              .join(" ")}]`
          : "";
        return `[${p.failureCode}]${diagSnippet} ${p.message ?? ""}`.trim();
      }
      if (p?.message) return p.message;
    }
    if (ev.type === "action_executed") {
      const p = ev.payload as { error?: { message?: string } } | null;
      if (p?.error?.message) return `工具调用失败：${p.error.message}`;
    }
    if (ev.type === "terminated") {
      const p = ev.payload as {
        reason?: string;
        message?: string;
        detail?: string;
      } | null;
      if (p?.message) return p.message;
      if (p?.detail) return p.detail;
      if (p?.reason && p.reason !== "completed") {
        return explainTerminatedReason(p.reason, ctx);
      }
    }
  }
  if (state === "failed") {
    if (!hasOutput) {
      const observations = events.filter((ev) => ev.type === "action_executed");
      const emptyObs = observations.filter((ev) => {
        const p = ev.payload as { output?: unknown } | null;
        const out = p?.output;
        return (
          out == null ||
          out === "" ||
          (typeof out === "object" &&
            Object.keys(out as Record<string, unknown>).length === 0)
        );
      });
      if (observations.length > 0 && emptyObs.length === observations.length) {
        return `LLM 持续返回空内容 (${observations.length} 次调用全部空响应) —— 多半是 BYOK 模型配置异常 (model id 不存在 / API 拒绝 / 输出被过滤)。请前往 设置 → 模型 检查当前选用的模型是否真实可用`;
      }
      return "Agent 未产出有效输出（可能是 LLM 返回空 / 超时 / 网络中断）";
    }
    return "outputSchema 校验失败 —— Agent 产出格式不符合预期 schema（详见原始执行轨迹中最后一个 finalize 事件的 input/output）";
  }
  if (state === "cancelled") return "Agent 被取消";
  return undefined;
}

function explainTerminatedReason(
  reason: string,
  detail?: {
    tokensUsed?: number;
    iterations?: number;
    wallTimeMs?: number;
    reflectionVerdicts?: { score: number; critique?: string }[];
    llmReturnedEmpty?: boolean;
    emptyFinalizeCount?: number;
    usedModelId?: string;
  } | null,
): string {
  const ctx: string[] = [];
  if (detail?.tokensUsed != null) ctx.push(`已用 ${detail.tokensUsed} tokens`);
  if (detail?.iterations != null) ctx.push(`已迭代 ${detail.iterations} 轮`);
  if (detail?.wallTimeMs != null)
    ctx.push(`耗时 ${(detail.wallTimeMs / 1000).toFixed(1)}s`);
  const ctxStr = ctx.length > 0 ? ` (${ctx.join(", ")})` : "";

  const verdicts = detail?.reflectionVerdicts ?? [];
  const lastVerdict =
    verdicts.length > 0 ? verdicts[verdicts.length - 1] : null;
  const isVerifierExhaustion =
    verdicts.length > 0 && verdicts.every((v) => v.score < 70);

  switch (reason) {
    case "budget":
    case "budget_exhausted":
    case "token_limit":
      if (detail?.llmReturnedEmpty) {
        return `LLM 持续返回空 finalize${ctxStr} —— ${detail.emptyFinalizeCount ?? "?"} 次调用全部 output="" 且立即 finalize。**根因极可能是 BYOK 模型配置错误**：当前使用的 model id 可能不存在 / API 拒绝 / 输出被过滤 / 模型不支持 ReAct JSON 协议。请前往 设置 → 模型 验证模型可用性，或换用主流模型 (gpt-4o / claude-3.5)`;
      }
      if (isVerifierExhaustion) {
        const lastCritique = lastVerdict?.critique
          ? ` 最后一次评分批注：「${lastVerdict.critique.slice(0, 200)}${
              lastVerdict.critique.length > 200 ? "…" : ""
            }」`
          : "";
        return `Reflexion 反复未通过质量门槛${ctxStr} —— ${verdicts.length} 轮评分均 <70 分（最后 ${lastVerdict?.score.toFixed(
          1,
        )} 分）。${lastCritique} 可调高 budget.maxIterations 给更多重写机会，或降低 passThreshold，或检查 verifier prompt 是否过严`;
      }
      return `Agent 预算耗尽${ctxStr} —— maxTokens 触顶。可在 @DefineAgent.budget.maxTokens 调高，或缩短输入 / 减少迭代`;
    case "empty_llm_response":
      return `LLM 立即 finalize 空结果（${detail?.emptyFinalizeCount ?? "?"} 次）—— Harness 已熔断防止浪费 token。${
        detail?.usedModelId ? `当前 model: "${detail.usedModelId}"。` : ""
      }常见根因：(1) BYOK model id 在 provider 不存在 (2) reasoning model max_completion_tokens 不足让 CoT + visible output 同时装下 (3) prompt 让 LLM 完全无所适从。建议先在「设置→模型」确认 model id 真实可用`;
    case "iteration_limit":
    case "max_iterations":
      return `Agent 达到最大迭代次数${ctxStr} —— 通常是 LLM 反复尝试未收敛。可调高 maxIterations，或检查 prompt 是否引导歧义`;
    case "wall_time":
    case "wall_time_limit":
      return `Agent 超时${ctxStr} —— maxWallTimeMs 触顶。可调高 budget.maxWallTimeMs 或检查工具调用是否卡住`;
    case "cancelled":
      return `Agent 被取消${ctxStr}`;
    case "error":
      return `Agent 内部错误${ctxStr} —— 详见 trace 末尾的 error / observation.error 字段`;
    case "context_too_long":
      return `Agent 上下文超长${ctxStr} —— 已触发 ContextCompactor 但仍溢出。可缩短 systemPrompt 或减少历史轮数`;
    default:
      return `Agent 异常终止：${reason}${ctxStr}`;
  }
}
