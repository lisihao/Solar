/**
 * AI Engine - Agent Error
 * Agent 错误类
 */

import { JsonObject } from "@/modules/ai-engine/facade/abstractions/common.types";
import { EngineError } from "@/modules/ai-engine/facade/abstractions/engine.error";
import { AgentErrorCode } from "@/modules/ai-engine/facade/abstractions/error-codes.constants";

/**
 * Agent 错误
 */
export class AgentError extends EngineError {
  /**
   * Agent ID
   */
  readonly agentId?: string;

  /**
   * Agent 名称
   */
  readonly agentName?: string;

  constructor(
    message: string,
    code: string = AgentErrorCode.UNKNOWN,
    options?: {
      agentId?: string;
      agentName?: string;
      details?: JsonObject;
      cause?: Error;
      retryable?: boolean;
    },
  ) {
    const details: JsonObject = { ...options?.details };
    if (options?.agentId) details.agentId = options.agentId;
    if (options?.agentName) details.agentName = options.agentName;

    super(message, code, {
      details: Object.keys(details).length > 0 ? details : undefined,
      cause: options?.cause,
      retryable: options?.retryable,
    });
    this.agentId = options?.agentId;
    this.agentName = options?.agentName;
  }

  /**
   * Agent 未找到
   */
  static notFound(agentId: string): AgentError {
    return new AgentError(
      `Agent '${agentId}' not found`,
      AgentErrorCode.NOT_FOUND,
      { agentId, retryable: false },
    );
  }

  /**
   * Agent 未注册
   */
  static notRegistered(agentId: string): AgentError {
    return new AgentError(
      `Agent '${agentId}' is not registered`,
      AgentErrorCode.NOT_REGISTERED,
      { agentId, retryable: false },
    );
  }

  /**
   * Agent 未就绪
   */
  static notReady(agentId: string, reason?: string): AgentError {
    return new AgentError(
      `Agent '${agentId}' is not ready${reason ? `: ${reason}` : ""}`,
      AgentErrorCode.NOT_READY,
      { agentId, details: reason ? { reason } : undefined, retryable: true },
    );
  }

  /**
   * 规划失败
   */
  static planningFailed(
    agentId: string,
    reason: string,
    cause?: Error,
  ): AgentError {
    return new AgentError(
      `Planning failed for agent '${agentId}': ${reason}`,
      AgentErrorCode.PLANNING_FAILED,
      { agentId, details: { reason }, cause, retryable: true },
    );
  }

  /**
   * 计划无效
   */
  static invalidPlan(agentId: string, reason: string): AgentError {
    return new AgentError(
      `Invalid plan for agent '${agentId}': ${reason}`,
      AgentErrorCode.INVALID_PLAN,
      { agentId, details: { reason }, retryable: false },
    );
  }

  /**
   * 规划超时
   */
  static planTimeout(agentId: string, timeout: number): AgentError {
    return new AgentError(
      `Planning timed out for agent '${agentId}' after ${timeout}ms`,
      AgentErrorCode.PLAN_TIMEOUT,
      { agentId, details: { timeout }, retryable: true },
    );
  }

  /**
   * 执行失败
   */
  static executionFailed(
    agentId: string,
    reason: string,
    cause?: Error,
  ): AgentError {
    return new AgentError(
      `Execution failed for agent '${agentId}': ${reason}`,
      AgentErrorCode.EXECUTION_FAILED,
      { agentId, cause, retryable: false },
    );
  }

  /**
   * 超过最大迭代次数
   */
  static maxIterationsExceeded(
    agentId: string,
    iterations: number,
    maxIterations: number,
  ): AgentError {
    return new AgentError(
      `Agent '${agentId}' exceeded max iterations: ${iterations}/${maxIterations}`,
      AgentErrorCode.MAX_ITERATIONS_EXCEEDED,
      { agentId, details: { iterations, maxIterations }, retryable: false },
    );
  }

  /**
   * 超过最大迭代次数 (别名)
   * @deprecated Use maxIterationsExceeded instead
   */
  static maxIterationsReached(
    agentId: string,
    iterations: number,
    maxIterations: number,
  ): AgentError {
    return AgentError.maxIterationsExceeded(agentId, iterations, maxIterations);
  }

  /**
   * 无效的执行模式
   */
  static invalidMode(
    agentId: string,
    mode: string,
    supportedModes: string[],
  ): AgentError {
    return new AgentError(
      `Invalid execution mode '${mode}' for agent '${agentId}'. Supported: ${supportedModes.join(", ")}`,
      AgentErrorCode.INVALID_MODE,
      { agentId, details: { mode, supportedModes }, retryable: false },
    );
  }

  /**
   * 缺少依赖
   */
  static missingDependency(
    agentId: string,
    dependencyType: string,
    dependencyId: string,
  ): AgentError {
    return new AgentError(
      `Agent '${agentId}' missing ${dependencyType}: ${dependencyId}`,
      AgentErrorCode.MISSING_DEPENDENCY,
      { agentId, details: { dependencyType, dependencyId }, retryable: false },
    );
  }

  /**
   * LLM 调用失败
   */
  static llmCallFailed(
    agentId: string,
    reason: string,
    cause?: Error,
  ): AgentError {
    return new AgentError(
      `LLM call failed for agent '${agentId}': ${reason}`,
      AgentErrorCode.EXECUTION_FAILED,
      { agentId, details: { reason }, cause, retryable: true },
    );
  }

  /**
   * 超过最大工具调用次数
   */
  static maxToolCallsExceeded(
    agentId: string,
    toolCalls: number,
    maxToolCalls: number,
  ): AgentError {
    return new AgentError(
      `Agent '${agentId}' exceeded max tool calls: ${toolCalls}/${maxToolCalls}`,
      AgentErrorCode.MAX_TOOL_CALLS_EXCEEDED,
      { agentId, details: { toolCalls, maxToolCalls }, retryable: false },
    );
  }

  /**
   * 执行超时
   */
  static timeout(agentId: string, timeout: number): AgentError {
    return new AgentError(
      `Agent '${agentId}' execution timed out after ${timeout}ms`,
      AgentErrorCode.TIMEOUT,
      { agentId, details: { timeout }, retryable: true },
    );
  }

  /**
   * 执行取消
   */
  static cancelled(agentId: string): AgentError {
    return new AgentError(
      `Agent '${agentId}' execution was cancelled`,
      AgentErrorCode.CANCELLED,
      { agentId, retryable: false },
    );
  }

  /**
   * 路由失败
   */
  static routingFailed(reason: string): AgentError {
    return new AgentError(
      `Agent routing failed: ${reason}`,
      AgentErrorCode.ROUTING_FAILED,
      { retryable: false },
    );
  }

  /**
   * 没有匹配的 Agent
   */
  static noMatchingAgent(input: string): AgentError {
    return new AgentError(
      `No matching agent found for input: ${input.substring(0, 100)}...`,
      AgentErrorCode.NO_MATCHING_AGENT,
      { details: { inputPreview: input.substring(0, 100) }, retryable: false },
    );
  }

  /**
   * 路由歧义
   */
  static ambiguousRouting(candidates: string[], input: string): AgentError {
    return new AgentError(
      `Ambiguous routing: multiple agents match (${candidates.join(", ")})`,
      AgentErrorCode.AMBIGUOUS_ROUTING,
      {
        details: { candidates, inputPreview: input.substring(0, 100) },
        retryable: false,
      },
    );
  }

  /**
   * 从普通错误创建
   */
  static override fromError(
    error: unknown,
    code: string = AgentErrorCode.UNKNOWN,
    details?: JsonObject,
  ): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    const agentId = details?.agentId as string | undefined;

    if (error instanceof Error) {
      return new AgentError(error.message, code, {
        agentId,
        cause: error,
        details,
      });
    }

    return new AgentError(
      typeof error === "string" ? error : "Unknown agent error",
      code,
      { agentId, details },
    );
  }

  /**
   * 从普通错误创建（带 agentId）
   */
  static fromAgentError(
    error: unknown,
    agentId?: string,
    code: string = AgentErrorCode.UNKNOWN,
  ): AgentError {
    return AgentError.fromError(error, code, agentId ? { agentId } : undefined);
  }
}

