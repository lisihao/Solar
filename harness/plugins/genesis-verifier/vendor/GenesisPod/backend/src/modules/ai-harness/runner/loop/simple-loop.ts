/**
 * SimpleLoop — 单步直答型 Loop（无 tool 编排 / 无 self-critique）
 *
 * 适用：
 *   - 评分 / 评判 / 分类 / 数据提取（dimension-quality-judge / verifier 等）
 *   - 任何 outputSchema 是业务结构化 JSON、且不需要工具调用的纯生成型 agent
 *
 * 行为：
 *   1. 一次 LLM chat() 调用（messages + agent outputSchema 强约束）
 *   2. 不强制 LLM 输出 ReAct 协议 (thinking + action)；LLM 直接吐 outputSchema 实例
 *   3. 业务侧用 outputSchemaValidator 验证后 yield "output" + "terminated"
 *   4. 验证失败 → yield "validation_failed" + "terminated" reason="error"，
 *      调用方（AgentRunner / ReflexionLoop）按 RUNNER_OUTPUT_SCHEMA_MISMATCH 处理
 *
 * 与其他 loop 区别：
 *   simple    : 1 次 LLM，无 tool，无重试 ← 本文件
 *   reflexion : N 次 LLM (act + critique + revise)
 *   react     : N 次 LLM + tool 编排 (thinking → action → observation)
 *   plan-execute / leader-worker：复杂多步
 *
 * 沉淀背景：consumer 11 个 agent 误配 loop:"react" 但 outputSchema 是业务 JSON，
 * 导致 ReActLoop parseDecision 抛 InvalidActionError，fallback finalize-raw 救场
 * 浪费 ~3x token + 章节质量降级。SimpleLoop 让纯生成型 agent 一步到位。
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  AgentEventPayload,
  AgentLoopKind,
  IAgentEvent,
  IAgentLoop,
  IContextEnvelope,
  ILoopTerminationCriteria,
  ILoopRunOptions,
} from "../../agents/abstractions";
import {
  AiChatService,
  type ChatMessage,
} from "../../../ai-engine/llm/chat/ai-chat.service";
import { AIModelType } from "@prisma/client";
import type { TaskProfile } from "../../../ai-engine/llm/types/task-profile.types";
import { BudgetAccountant } from "../../guardrails/budget/budget-accountant";
import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";
import { SIMPLE_LOOP_OUTPUT_JSON_SCHEMA } from "./loop-output-schemas";
import { executeWithModelFailover } from "./model-failover.util";

export interface SimpleLoopRunOptions extends ILoopRunOptions {
  /** Spec 声明的 TaskProfile（透传给 chat()） */
  taskProfile?: TaskProfile;
  /** outputSchema 校验闸（业务侧通过 AgentSpec 注入） */
  outputSchemaValidator?: (
    output: unknown,
  ) => { ok: true } | { ok: false; issues: string };
  /** 业务规则校验（schema 通过后再校验，如 sectionId 唯一性） */
  validateBusinessRules?: (output: unknown) => string | null | undefined;
  /** 显式 model 覆盖（BudgetAccountant downgrade 透传） */
  modelOverride?: string;
  /** BYOK userId 透传给 chat() */
  userId?: string;
  /** 预算计费 */
  budget?: BudgetAccountant;
}

@Injectable()
export class SimpleLoop implements IAgentLoop {
  readonly kind: AgentLoopKind = "simple";
  private readonly logger = new Logger(SimpleLoop.name);

  constructor(private readonly chatService: AiChatService) {}

  async *run(
    envelope: IContextEnvelope,
    _criteria: ILoopTerminationCriteria,
    options?: SimpleLoopRunOptions,
  ): AsyncIterable<IAgentEvent> {
    const agentId = options?.agentId ?? "simple-agent";
    const signal = options?.signal;

    if (signal?.aborted) {
      yield this.makeEvent(agentId, "terminated", { reason: "cancelled" });
      return;
    }

    yield this.makeEvent(agentId, "iteration_progress", {
      iteration: 1,
      maxIterations: 1,
      progress: 1.0,
      approachingLimit: false,
      lastActionKind: undefined,
    });

    // 1) 装配 messages（envelope.reminders 优先 + envelope.messages）
    const messages = this.buildMessages(envelope);
    const systemPrompt = envelope.system ?? "";

    // 2) 一次 LLM 调用（不带 ReAct DECISION_SYSTEM_SUFFIX，让 LLM 按 outputSchema 直答）
    let response: Awaited<ReturnType<AiChatService["chat"]>>;
    const startMs = Date.now();
    try {
      // ★ 模型级 failover：chat 抛 provider 错（或返回 isError）时换用户/选举的
      //   下一个模型重试，而非直接判废。逻辑收口在 executeWithModelFailover。
      response = await executeWithModelFailover({
        agentId,
        logger: this.logger,
        provider: options?.modelFailoverProvider,
        attempt: (modelOverride) => {
          const effModel = modelOverride ?? options?.modelOverride;
          return this.chatService.chat({
            messages,
            systemPrompt,
            model: effModel,
            modelType: effModel ? undefined : AIModelType.CHAT,
            cachePolicy: "auto",
            taskProfile: options?.taskProfile ?? {
              creativity: "low",
              outputLength: "medium",
            },
            strictMode: true,
            responseFormat: "json",
            // R2-#35: native structured output — router auto-degrades per provider.
            // responseFormat:"json" is kept as the secondary safety net so providers
            // that do not support json_schema still get a JSON hint.
            // FIX 3: "json_schema" is the *requested* strategy; the ACTUAL response_format
            // put on the wire is reconciled by ModelCapabilityService at ai-api-caller
            // (e.g. deepseek-v4-pro gets downgraded to json_object, reasoner gets prompt
            // constraint only). No caller can bypass the capability gate.
            structuredOutputStrategy: "json_schema",
            outputJsonSchema: SIMPLE_LOOP_OUTPUT_JSON_SCHEMA,
            skipGuardrails: true,
            operationName: "harness:simple-loop:chat",
            userId: options?.userId,
            signal,
          });
        },
        // isError-RETURN 路径：provider 错以返回值形式（非抛错）回来也要触发
        // failover；分类器仍会拒掉 guardrail/安全拒答（不浪费换模型）。
        inspectResult: (res) => ({
          failoverable:
            (res as { isError?: boolean }).isError === true ||
            /^Request blocked by content safety guardrail/i.test(
              res.content ?? "",
            ) ||
            /^Response filtered by content safety guardrail/i.test(
              res.content ?? "",
            ),
          modelId: res.model,
          message: res.content ?? "",
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 2026-05-13: chat() 抛 abort 时必须当作 "cancelled" 而不是 "error"，否则
      // 上层 drainEvents 把 state 推成 "failed" → per-dim-pipeline 误报
      // "grade 阶段失败 state=failed"。真因是 mission-wide abort（如 budget_exhausted），
      // 不是 simple-loop 自己出错。
      const aborted = signal?.aborted || /abort/i.test(message);
      if (aborted) {
        yield this.makeEvent(agentId, "terminated", { reason: "cancelled" });
        return;
      }
      yield this.makeEvent(agentId, "error", {
        message,
        failureCode: this.classifyFailureCode(message),
      });
      yield this.makeEvent(agentId, "terminated", { reason: "error" });
      return;
    }

    if (signal?.aborted) {
      yield this.makeEvent(agentId, "terminated", { reason: "cancelled" });
      return;
    }

    // 2026-05-13 #65: AiChatService 在 provider 安全拒绝 / guardrail / 内部错误时
    // 不抛异常，而是返回 {isError: true, content: "Request blocked by content
    // safety guardrail: ..." 或 provider error message}。旧逻辑直接进 parseJson
    // → 必失败 → yield error+terminated{reason:"error"} → state=failed → 用户
    // 看到"grade 阶段失败 state=failed 无 5 轴评分"，但真因其实是 LLM 内容审核。
    // 同 JudgeService #53 处理：识别 isError + guardrail placeholder 短路为 error
    // 但 reason 改更精确（让上层 narrative 能区分）。
    const isErrLike =
      (response as { isError?: boolean }).isError === true ||
      /^Request blocked by content safety guardrail/i.test(
        response.content ?? "",
      ) ||
      /^Response filtered by content safety guardrail/i.test(
        response.content ?? "",
      );
    if (isErrLike) {
      const msg = (response.content ?? "").slice(0, 300) || "provider isError";
      this.logger.warn(
        `[simple-loop] chat returned isError/guardrail (no exception): ${msg}`,
      );
      yield this.makeEvent(agentId, "error", {
        message: msg,
        failureCode: /guardrail/i.test(msg)
          ? "PROVIDER_SAFETY_REFUSAL"
          : "PROVIDER_API_ERROR",
      });
      yield this.makeEvent(agentId, "terminated", { reason: "error" });
      return;
    }

    const promptTokens = response.usage?.inputTokens ?? 0;
    const completionTokens = response.usage?.outputTokens ?? 0;
    const cacheReadTokens = response.usage?.cacheReadTokens ?? 0;

    // 3) parse JSON output
    const rawContent = response.content ?? "";
    let parsedOutput: unknown;
    try {
      parsedOutput = this.extractJson(rawContent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield this.makeEvent(agentId, "validation_failed", {
        rejectCount: 1,
        maxRejects: 1,
        issues: `LLM output is not valid JSON: ${message}`,
        candidateOutput: rawContent.slice(0, 500),
      });
      yield this.makeEvent(agentId, "error", {
        message: "RUNNER_OUTPUT_SCHEMA_MISMATCH: not JSON",
        failureCode: "RUNNER_OUTPUT_SCHEMA_MISMATCH",
      });
      yield this.makeEvent(agentId, "terminated", { reason: "error" });
      return;
    }

    // 4) outputSchema 校验
    if (options?.outputSchemaValidator) {
      const verdict = options.outputSchemaValidator(parsedOutput);
      if (!verdict.ok) {
        yield this.makeEvent(agentId, "validation_failed", {
          rejectCount: 1,
          maxRejects: 1,
          issues: verdict.issues,
          candidateOutput: parsedOutput,
        });
        yield this.makeEvent(agentId, "error", {
          message: `RUNNER_OUTPUT_SCHEMA_MISMATCH: ${verdict.issues.slice(0, 200)}`,
          failureCode: "RUNNER_OUTPUT_SCHEMA_MISMATCH",
        });
        yield this.makeEvent(agentId, "terminated", { reason: "error" });
        return;
      }
    }

    // 5) businessRules 校验（schema 通过后才查）
    if (options?.validateBusinessRules) {
      const issue = options.validateBusinessRules(parsedOutput);
      if (issue) {
        yield this.makeEvent(agentId, "validation_failed", {
          rejectCount: 1,
          maxRejects: 1,
          issues: issue,
          candidateOutput: parsedOutput,
        });
        yield this.makeEvent(agentId, "error", {
          message: `BUSINESS_RULE_VIOLATION: ${issue.slice(0, 200)}`,
          failureCode: "BUSINESS_RULE_VIOLATION",
        });
        yield this.makeEvent(agentId, "terminated", { reason: "error" });
        return;
      }
    }

    // 6) Budget 计费 — accountLLM 签名: (promptTokens, completionTokens, costUsd, cacheReadTokens?)
    if (options?.budget) {
      try {
        // costUsd=null 让 BudgetAccountant 内部计 uncostedLLMCalls（pricing registry 在
        // ReActLoop 层注入；SimpleLoop 不强制依赖 pricing → 透传 null 保持账目诚实）
        options.budget.accountLLM(
          promptTokens,
          completionTokens,
          null,
          cacheReadTokens,
        );
      } catch (err) {
        // budget 故障不阻断；记 warn
        this.logger.warn(
          `[simple-loop] budget account failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 7) 成功路径：emit thinking（让 trace 看到原文）+ output + terminated
    if (rawContent && rawContent.length < 5000) {
      yield this.makeEvent(agentId, "thinking", {
        text: `(simple-loop output ${Date.now() - startMs}ms)`,
        tokenCount: completionTokens,
      });
    }
    yield this.makeEvent(agentId, "output", {
      output: parsedOutput as string | Record<string, unknown>,
    });
    yield this.makeEvent(agentId, "terminated", { reason: "completed" });
  }

  // ── Helpers ─────────────────────────────────────────────────

  private buildMessages(envelope: IContextEnvelope): ChatMessage[] {
    const msgs: ChatMessage[] = [];
    for (const r of envelope.reminders) {
      msgs.push({
        role: "system",
        content: `[reminder:${r.priority}] ${r.content}`,
      });
    }
    for (const m of envelope.messages) {
      msgs.push({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content,
      });
    }
    return msgs;
  }

  /**
   * 容错抽 JSON：路由到 common/utils/json-extraction.utils 的 7 策略抽取器，
   * 自动处理 <think>/<thinking>/<reasoning> 推理标签、```json fence、
   * 重复行去重、brace-counting、truncated JSON 修复等场景。
   *
   * 历史：曾经手卷 4 步 fence+regex，对推理模型（Nemotron / DeepSeek-R1 / QwQ）
   * 的 <think>...</think> 前缀会直接抛 RUNNER_OUTPUT_SCHEMA_MISMATCH。
   */
  private extractJson(content: string): unknown {
    if (!content?.trim()) {
      throw new Error("empty content");
    }
    const result = extractJsonFromAIResponse<unknown>(content);
    if (!result.success) {
      // 兜底：尝试找最外层 [...] 数组（utils 优先匹配 {} 对象）
      const arrMatch = content.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        try {
          return JSON.parse(arrMatch[0]);
        } catch {
          // fall through
        }
      }
      throw new Error(result.error ?? "no parseable JSON block found");
    }
    return result.data;
  }

  private classifyFailureCode(message: string): string {
    if (/rate.?limit|429/i.test(message)) return "PROVIDER_RATE_LIMIT";
    if (/safety|content filter|refusal/i.test(message))
      return "PROVIDER_SAFETY_REFUSAL";
    if (/byok|model not found/i.test(message))
      return "PROVIDER_BYOK_MODEL_NOT_FOUND";
    if (/timeout|timed out/i.test(message)) return "RUNNER_WALL_TIME_EXCEEDED";
    return "PROVIDER_API_ERROR";
  }

  private makeEvent(
    agentId: string,
    type: IAgentEvent["type"],
    payload: AgentEventPayload,
  ): IAgentEvent {
    return { type, agentId, timestamp: Date.now(), payload };
  }
}
