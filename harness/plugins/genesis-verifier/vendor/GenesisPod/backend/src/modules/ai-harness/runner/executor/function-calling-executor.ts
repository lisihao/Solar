/**
 * AI Engine - Function Calling Executor
 * 执行引擎 - 让 LLM 自主选择和调用工具
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ToolRegistry } from "../../../ai-engine/tools/registry";
import {
  ToolContext,
  ToolResult,
  FunctionDefinition,
} from "../../../ai-engine/tools/abstractions/tool.interface";
import { ToolId } from "@/modules/ai-harness/agents/abstractions/agent.types";
import { RetryStrategy } from "./retry-strategy";
import {
  AICapabilityResolver,
  AICapabilityContext,
} from "../capabilities/ai-capability-resolver.service";
import type { IMCPProvider } from "../../../ai-engine/facade";
import { MCP_PROVIDER_PORT } from "@/modules/ai-engine/facade/abstractions/runtime-deps.tokens";
import { QueryLoopService } from "./query-loop.service";
import { TokenTrackerService } from "./token-tracker.service";
import { ContextCompactionPipelineService } from "../../../ai-engine/planning/context/context-compaction-pipeline.service";
import { ExecutionCheckpointService } from "./execution-checkpoint.service";
import { ToolConcurrencyService } from "../../../ai-engine/tools/concurrency/tool-concurrency.service";
import { ModelFallbackService } from "../../../ai-engine/llm/models/selection/model-fallback.service";
import { SessionMemorySidecarService } from "./session-memory-sidecar.service";

// ============================================================================
// Types — LLM 协议接口已抽到 ai-engine/llm/abstractions/function-calling-protocol
// (2026-04-30) — 让 llm-adapter 与 fc-executor 共享，fc-executor 后续可搬 harness
// ============================================================================

// 内部使用 + Re-export 协议类型保持向后兼容（外部 import 不变）
import type {
  LLMMessage,
  LLMRequestOptions,
  LLMResponse,
  ToolCallRequest,
  ILLMAdapter,
} from "../../../ai-engine/llm/abstractions/function-calling-protocol";
export type {
  LLMMessage,
  LLMRequestOptions,
  LLMResponse,
  ToolCallRequest,
  ILLMAdapter,
};

/**
 * 执行配置
 */
export interface ExecutionConfig {
  maxIterations: number;
  maxToolCalls: number;
  parallelToolCalls: boolean;
  enableRetry: boolean;
  /** @deprecated Use taskProfile.creativity instead */
  temperature?: number;
  /** @deprecated Use taskProfile.outputLength instead */
  maxTokens?: number;
  /** ★ TaskProfile for semantic parameter mapping */
  taskProfile?: import("../../../ai-engine/llm/types").TaskProfile;
  /** Enable auto-continuation when LLM output is truncated (default: false) */
  enableQueryLoop?: boolean;
  /** Enable fine-grained checkpointing per iteration (default: false) */
  enableCheckpoints?: boolean;
  /** Token budget limit for the entire execution */
  tokenBudgetLimit?: number;
}

/**
 * 执行统计
 */
export interface ExecutionMetrics {
  iterations: number;
  toolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  totalDuration: number;
  toolCallDetails: Array<{
    tool: string;
    duration: number;
    success: boolean;
    retries?: number;
  }>;
}

/**
 * Agent 事件类型
 */
export type AgentEvent =
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; output: unknown; duration: number }
  | { type: "tool_progress"; tool: string; progress: number; message?: string }
  | {
      type: "complete";
      result: {
        success: boolean;
        artifacts: unknown[];
        summary: string;
        tokensUsed: number;
        duration: number;
      };
    }
  | { type: "error"; error: string };

// ============================================================================
// Function Calling Executor
// ============================================================================

/**
 * Function Calling 执行器
 * ReAct 模式实现：Reasoning + Acting 循环
 */
@Injectable()
export class FunctionCallingExecutor {
  private readonly logger = new Logger(FunctionCallingExecutor.name);
  private readonly retryStrategy: RetryStrategy;

  static readonly DEFAULT_CONFIG: ExecutionConfig = {
    maxIterations: 10,
    maxToolCalls: 20,
    parallelToolCalls: false,
    enableRetry: true,
    taskProfile: {
      creativity: "medium",
      outputLength: "medium",
    },
  };

  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Optional() private readonly capabilityResolver?: AICapabilityResolver,
    @Optional()
    @Inject(MCP_PROVIDER_PORT)
    private readonly mcpManager?: IMCPProvider,
    @Optional() private readonly queryLoop?: QueryLoopService,
    @Optional() private readonly tokenTracker?: TokenTrackerService,
    @Optional()
    private readonly contextCompaction?: ContextCompactionPipelineService,
    @Optional() private readonly checkpoint?: ExecutionCheckpointService,
    @Optional() private readonly toolConcurrency?: ToolConcurrencyService,
    @Optional() private readonly modelFallback?: ModelFallbackService,
    @Optional() private readonly sidecar?: SessionMemorySidecarService,
  ) {
    this.retryStrategy = new RetryStrategy();
  }

  /**
   * 执行 Function Calling 循环
   */
  async *execute(
    llmAdapter: ILLMAdapter,
    systemPrompt: string,
    userPrompt: string,
    tools: ToolId[],
    context: ToolContext,
    config?: Partial<ExecutionConfig>,
  ): AsyncGenerator<AgentEvent> {
    const cfg: ExecutionConfig = {
      ...FunctionCallingExecutor.DEFAULT_CONFIG,
      ...config,
    };
    const startTime = Date.now();

    const executionId =
      context.executionId ||
      `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.tokenTracker?.createSession(executionId);

    const metrics: ExecutionMetrics = {
      iterations: 0,
      toolCalls: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
      totalDuration: 0,
      toolCallDetails: [],
    };

    const functionDefinitions = this.getFunctionDefinitions(tools);

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    this.logger.log(
      `[execute] Starting with ${functionDefinitions.length} tools`,
    );

    try {
      while (
        metrics.iterations < cfg.maxIterations &&
        metrics.toolCalls < cfg.maxToolCalls
      ) {
        metrics.iterations++;

        this.logger.log(`[execute] Iteration ${metrics.iterations}`);

        // Context compaction — BEFORE each LLM call
        if (this.contextCompaction) {
          const currentTokens = this.estimateTokens(messages);
          // Save originals before compaction to preserve tool_calls/tool_call_id/name fields
          const originalMessages = [...messages];
          const compactionResult = await this.contextCompaction.compact(
            messages.map((m) => ({
              role: m.role as "system" | "user" | "assistant" | "tool",
              content: m.content ?? "",
              isToolUse: !!m.tool_calls,
              isToolResult: m.role === "tool",
              toolUseId: m.tool_calls?.[0]?.id,
              toolResultFor: m.tool_call_id,
            })),
            currentTokens,
            undefined, // config (use defaults)
            async (text: string, maxLength: number) => {
              // Level 2: AI-powered summarization
              const summaryResponse = await llmAdapter.chat({
                messages: [
                  {
                    role: "system",
                    content:
                      "Summarize the following conversation concisely, preserving key decisions and findings.",
                  },
                  { role: "user", content: text.slice(0, 8000) },
                ],
              });
              return (summaryResponse.content ?? "").slice(0, maxLength);
            },
          );
          if (compactionResult.levelApplied !== "none") {
            messages.length = 0;
            for (const compactedMsg of compactionResult.messages) {
              // Try to find the original message to preserve tool fields
              const original = originalMessages.find(
                (o) =>
                  o.role === compactedMsg.role &&
                  o.content === compactedMsg.content,
              );
              if (original) {
                messages.push(original); // preserve all original fields
              } else {
                // New message (e.g., summary) — construct with basic fields
                messages.push({
                  role: compactedMsg.role as LLMMessage["role"],
                  content: (compactedMsg.content as string) ?? "",
                });
              }
            }
            this.logger.log(
              `[execute] Context compacted: level=${compactionResult.levelApplied}, saved=${compactionResult.tokensSaved} tokens`,
            );

            // ★ Phase 7: SessionMemorySidecar — inject preserved summary after compaction
            if (this.sidecar) {
              const summary = this.sidecar.onCompaction(executionId);
              if (summary) {
                const insertIdx = messages.findIndex(
                  (m) => m.role !== "system",
                );
                if (insertIdx >= 0) {
                  messages.splice(insertIdx, 0, {
                    role: "system" as const,
                    content: `[Session Memory - preserved from compacted context]\n${summary}`,
                  });
                }
              }
            }
          }
        }

        let response: LLMResponse;
        const primaryRequestOptions: LLMRequestOptions = {
          messages,
          functions: functionDefinitions,
          temperature: cfg.temperature,
          maxTokens: cfg.maxTokens,
          tool_choice: "auto",
        };
        try {
          response = await llmAdapter.chat(primaryRequestOptions);
        } catch (error) {
          if (this.modelFallback) {
            this.logger.warn(
              `[execute] Primary model failed, attempting fallback`,
            );
            const fallbackResult = await this.modelFallback.executeWithFallback(
              primaryRequestOptions.model || "",
              async (modelConfig) => {
                return llmAdapter.chat({
                  ...primaryRequestOptions,
                  model: modelConfig.modelId,
                });
              },
              { operation: "function-calling-loop" },
            );
            if (fallbackResult.success && fallbackResult.data) {
              response = fallbackResult.data;
              this.logger.log(
                `[execute] Fallback successful: model=${fallbackResult.modelUsed}`,
              );
            } else {
              yield {
                type: "error",
                error: fallbackResult.error?.message || "All models failed",
              };
              break;
            }
          } else {
            this.logger.error(`[execute] LLM call failed: ${error}`);
            yield {
              type: "error",
              error: error instanceof Error ? error.message : "LLM call failed",
            };
            break;
          }
        }

        if (response.usage) {
          metrics.tokensUsed.prompt += response.usage.promptTokens;
          metrics.tokensUsed.completion += response.usage.completionTokens;
          metrics.tokensUsed.total += response.usage.totalTokens;
        }

        // Token tracking — after each LLM response
        if (this.tokenTracker && response.usage) {
          this.tokenTracker.recordUsage(executionId, {
            inputTokens: response.usage.promptTokens,
            outputTokens: response.usage.completionTokens,
          });
        }

        const toolCalls = llmAdapter.parseToolCalls(response);

        if (toolCalls.length === 0) {
          // Auto-continuation via QueryLoop when output is truncated
          if (
            cfg.enableQueryLoop &&
            this.queryLoop &&
            response.finishReason === "length"
          ) {
            this.logger.log(
              "[execute] Output truncated, using QueryLoop for continuation",
            );
            const requestOptions: LLMRequestOptions = {
              messages,
              functions: functionDefinitions,
              temperature: cfg.temperature,
              maxTokens: cfg.maxTokens,
              tool_choice: "auto",
            };
            const loopResult = await this.queryLoop.executeWithLoop(
              async (msgs) => {
                const loopResponse = await llmAdapter.chat({
                  ...requestOptions,
                  messages: msgs.map((m) => ({
                    role: m.role as LLMMessage["role"],
                    content: m.content,
                  })),
                });
                return {
                  content: loopResponse.content ?? "",
                  model: loopResponse.model ?? "",
                  tokensUsed: loopResponse.usage?.totalTokens ?? 0,
                  inputTokens: loopResponse.usage?.promptTokens,
                  outputTokens: loopResponse.usage?.completionTokens,
                  finishReason: loopResponse.finishReason,
                };
              },
              messages.map((m) => ({
                role: m.role,
                content: typeof m.content === "string" ? m.content : "",
              })),
            );

            metrics.totalDuration = Date.now() - startTime;
            yield {
              type: "complete",
              result: {
                success: true,
                artifacts: [],
                summary: loopResult.content,
                tokensUsed:
                  metrics.tokensUsed.total +
                  loopResult.totalInputTokens +
                  loopResult.totalOutputTokens,
                duration: metrics.totalDuration,
              },
            };
            return;
          }

          this.logger.log("[execute] No tool calls, task completed");

          metrics.totalDuration = Date.now() - startTime;

          yield {
            type: "complete",
            result: {
              success: true,
              artifacts: [],
              summary: response.content || "",
              tokensUsed: metrics.tokensUsed.total,
              duration: metrics.totalDuration,
            },
          };

          return;
        }

        messages.push({
          role: "assistant",
          content: response.content,
          tool_calls: response.tool_calls,
        });

        this.logger.log(`[execute] Executing ${toolCalls.length} tool calls`);

        // Tool execution — parallel or serial
        if (cfg.parallelToolCalls && this.toolConcurrency) {
          const partition = this.toolConcurrency.partition(
            toolCalls.map((tc) => ({
              toolId: tc.name,
              category: this.toolRegistry.has(tc.name)
                ? this.toolRegistry.get(tc.name).category
                : undefined,
            })),
          );

          // Build a lookup from toolId to ToolCallRequest (last wins if duplicated)
          const toolCallByName = new Map<string, ToolCallRequest>();
          for (const tc of toolCalls) {
            toolCallByName.set(tc.name, tc);
          }

          // Execute parallel groups
          for (const group of partition.parallelGroups) {
            const groupResults = await Promise.allSettled(
              group.map((toolId) => {
                const toolCall = toolCallByName.get(toolId);
                if (!toolCall) return Promise.resolve(null);

                let input: unknown;
                try {
                  input = JSON.parse(toolCall.arguments);
                } catch {
                  input = toolCall.arguments;
                }
                return this.executeTool(
                  toolId,
                  input,
                  context,
                  cfg.enableRetry,
                ).then((toolResult) => ({
                  toolId,
                  toolCall,
                  input,
                  toolResult,
                }));
              }),
            );

            for (const [settledIdx, settled] of groupResults.entries()) {
              if (settled.status === "fulfilled" && settled.value !== null) {
                const { toolId, toolCall, input, toolResult } =
                  settled.value as {
                    toolId: string;
                    toolCall: ToolCallRequest;
                    input: unknown;
                    toolResult: ToolResult;
                  };

                metrics.toolCalls++;

                yield { type: "tool_call", tool: toolId, input };

                metrics.toolCallDetails.push({
                  tool: toolId,
                  duration: toolResult.metadata?.duration || 0,
                  success: toolResult.success,
                });

                if (toolResult.success) {
                  metrics.successfulToolCalls++;
                } else {
                  metrics.failedToolCalls++;
                }

                yield {
                  type: "tool_result",
                  tool: toolId,
                  output: toolResult.data,
                  duration: toolResult.metadata?.duration || 0,
                };

                // ★ Phase 7: SessionMemorySidecar — record meaningful tool findings
                if (
                  this.sidecar &&
                  toolResult.success &&
                  toolResult.data !== undefined
                ) {
                  const dataStr =
                    typeof toolResult.data === "string"
                      ? toolResult.data
                      : JSON.stringify(toolResult.data);
                  if (dataStr.length > 50) {
                    this.sidecar.addEntry(executionId, {
                      timestamp: new Date(),
                      category: "finding",
                      content: `[${toolId}] ${dataStr.slice(0, 200)}`,
                    });
                  }
                }

                messages.push(
                  llmAdapter.buildToolResultMessage(
                    toolCall.id,
                    toolCall.name,
                    toolResult.success
                      ? toolResult.data
                      : { error: toolResult.error },
                  ),
                );
              } else if (settled.status === "rejected") {
                const rejectedToolId = group[settledIdx];
                const rejectedToolCall = rejectedToolId
                  ? toolCallByName.get(rejectedToolId)
                  : undefined;
                metrics.toolCalls++;
                metrics.failedToolCalls++;
                const reason =
                  settled.reason instanceof Error
                    ? settled.reason.message
                    : String(settled.reason);
                this.logger.warn(
                  `[execute] Parallel tool rejected: ${rejectedToolId} — ${reason}`,
                );
                if (rejectedToolId) {
                  yield {
                    type: "tool_result" as const,
                    tool: rejectedToolId,
                    output: { error: reason },
                    duration: 0,
                  };
                }
                if (rejectedToolCall) {
                  messages.push(
                    llmAdapter.buildToolResultMessage(
                      rejectedToolCall.id,
                      rejectedToolCall.name,
                      { error: reason },
                    ),
                  );
                }
              }
            }
          }

          // Execute sequential tools
          for (const seqToolId of partition.sequential) {
            const toolCall = toolCallByName.get(seqToolId);
            if (!toolCall) continue;

            metrics.toolCalls++;

            let input: unknown;
            try {
              input = JSON.parse(toolCall.arguments);
            } catch {
              input = toolCall.arguments;
            }

            yield { type: "tool_call", tool: seqToolId, input };

            const toolResult = await this.executeTool(
              seqToolId,
              input,
              context,
              cfg.enableRetry,
            );

            metrics.toolCallDetails.push({
              tool: seqToolId,
              duration: toolResult.metadata?.duration || 0,
              success: toolResult.success,
            });

            if (toolResult.success) {
              metrics.successfulToolCalls++;
            } else {
              metrics.failedToolCalls++;
            }

            yield {
              type: "tool_result",
              tool: seqToolId,
              output: toolResult.data,
              duration: toolResult.metadata?.duration || 0,
            };

            // ★ Phase 7: SessionMemorySidecar — record meaningful tool findings
            if (
              this.sidecar &&
              toolResult.success &&
              toolResult.data !== undefined
            ) {
              const dataStr =
                typeof toolResult.data === "string"
                  ? toolResult.data
                  : JSON.stringify(toolResult.data);
              if (dataStr.length > 50) {
                this.sidecar.addEntry(executionId, {
                  timestamp: new Date(),
                  category: "finding",
                  content: `[${seqToolId}] ${dataStr.slice(0, 200)}`,
                });
              }
            }

            messages.push(
              llmAdapter.buildToolResultMessage(
                toolCall.id,
                toolCall.name,
                toolResult.success
                  ? toolResult.data
                  : { error: toolResult.error },
              ),
            );
          }
        } else {
          // Original serial execution
          for (const toolCall of toolCalls) {
            metrics.toolCalls++;

            const toolId = toolCall.name;
            let input: unknown;

            try {
              input = JSON.parse(toolCall.arguments);
            } catch {
              input = toolCall.arguments;
            }

            yield {
              type: "tool_call",
              tool: toolId,
              input,
            };

            yield {
              type: "tool_progress",
              tool: toolId,
              progress: 0,
              message: `Starting ${toolId}`,
            };

            const toolResult = await this.executeTool(
              toolId,
              input,
              context,
              cfg.enableRetry,
            );

            yield {
              type: "tool_progress",
              tool: toolId,
              progress: 100,
              message: `Completed ${toolId}`,
            };

            metrics.toolCallDetails.push({
              tool: toolId,
              duration: toolResult.metadata?.duration || 0,
              success: toolResult.success,
            });

            if (toolResult.success) {
              metrics.successfulToolCalls++;
            } else {
              metrics.failedToolCalls++;
            }

            yield {
              type: "tool_result",
              tool: toolId,
              output: toolResult.data,
              duration: toolResult.metadata?.duration || 0,
            };

            // ★ Phase 7: SessionMemorySidecar — record meaningful tool findings
            if (
              this.sidecar &&
              toolResult.success &&
              toolResult.data !== undefined
            ) {
              const dataStr =
                typeof toolResult.data === "string"
                  ? toolResult.data
                  : JSON.stringify(toolResult.data);
              if (dataStr.length > 50) {
                this.sidecar.addEntry(executionId, {
                  timestamp: new Date(),
                  category: "finding",
                  content: `[${toolId}] ${dataStr.slice(0, 200)}`,
                });
              }
            }

            const toolResultMessage = llmAdapter.buildToolResultMessage(
              toolCall.id,
              toolCall.name,
              toolResult.success
                ? toolResult.data
                : { error: toolResult.error },
            );
            messages.push(toolResultMessage);
          }
        }

        // Checkpoint at end of each iteration
        if (cfg.enableCheckpoints && this.checkpoint) {
          this.checkpoint.save({
            executionId,
            iteration: metrics.iterations,
            messages: [...messages],
            toolResults: metrics.toolCallDetails.map((d) => ({
              toolId: d.tool,
              result: { duration: d.duration, success: d.success },
            })),
            tokenUsage: this.tokenTracker?.getUsage(executionId) ?? {
              inputTokens: 0,
              outputTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              totalTokens: 0,
              callCount: 0,
            },
            timestamp: new Date(),
          });
        }
      }

      if (metrics.iterations >= cfg.maxIterations) {
        this.logger.warn("[execute] Max iterations reached");
        yield {
          type: "error",
          error: "Max iterations reached, task may be incomplete",
        };
      }

      if (metrics.toolCalls >= cfg.maxToolCalls) {
        this.logger.warn("[execute] Max tool calls reached");
        yield {
          type: "error",
          error: "Max tool calls reached, task may be incomplete",
        };
      }

      metrics.totalDuration = Date.now() - startTime;

      yield {
        type: "complete",
        result: {
          success: true,
          artifacts: [],
          summary: "Task execution completed",
          tokensUsed: metrics.tokensUsed.total,
          duration: metrics.totalDuration,
        },
      };
    } finally {
      this.tokenTracker?.endSession(executionId);
      this.checkpoint?.endExecution(executionId);
    }
  }

  /**
   * Resume execution from a checkpoint (for crash recovery)
   */
  async *resumeFromCheckpoint(
    llmAdapter: ILLMAdapter,
    executionId: string,
    tools: ToolId[],
    context: ToolContext,
    config?: Partial<ExecutionConfig>,
  ): AsyncGenerator<AgentEvent> {
    if (!this.checkpoint) {
      this.logger.error(
        "[resumeFromCheckpoint] ExecutionCheckpointService not available",
      );
      yield { type: "error", error: "Checkpoint service not available" };
      return;
    }

    const cp = this.checkpoint.restore(executionId);
    if (!cp) {
      this.logger.error(
        `[resumeFromCheckpoint] No checkpoint found for ${executionId}`,
      );
      yield {
        type: "error",
        error: `No checkpoint found for execution ${executionId}`,
      };
      return;
    }

    this.logger.log(
      `[resumeFromCheckpoint] Resuming ${executionId} from iteration ${cp.iteration}`,
    );

    const cfg: ExecutionConfig = {
      ...FunctionCallingExecutor.DEFAULT_CONFIG,
      ...config,
    };
    const functionDefinitions = this.getFunctionDefinitions(tools);
    const messages: LLMMessage[] = cp.messages.map((m) => ({
      role: m.role as LLMMessage["role"],
      content: m.content as string,
    }));

    const startTime = Date.now();
    const metrics: ExecutionMetrics = {
      iterations: cp.iteration,
      toolCalls: cp.toolResults.length,
      successfulToolCalls: cp.toolResults.filter((r) => !!r.result).length,
      failedToolCalls: cp.toolResults.filter((r) => !r.result).length,
      tokensUsed: {
        prompt: cp.tokenUsage.inputTokens,
        completion: cp.tokenUsage.outputTokens,
        total: cp.tokenUsage.totalTokens,
      },
      totalDuration: 0,
      toolCallDetails: [],
    };

    while (
      metrics.iterations < cfg.maxIterations &&
      metrics.toolCalls < cfg.maxToolCalls
    ) {
      metrics.iterations++;
      this.logger.log(`[resumeFromCheckpoint] Iteration ${metrics.iterations}`);

      let response: LLMResponse;
      try {
        response = await llmAdapter.chat({
          messages,
          functions: functionDefinitions,
          tool_choice: "auto",
        });
      } catch (error) {
        this.logger.error(`[resumeFromCheckpoint] LLM call failed: ${error}`);
        yield {
          type: "error",
          error: error instanceof Error ? error.message : "LLM call failed",
        };
        break;
      }

      if (response.usage) {
        metrics.tokensUsed.prompt += response.usage.promptTokens;
        metrics.tokensUsed.completion += response.usage.completionTokens;
        metrics.tokensUsed.total += response.usage.totalTokens;
      }

      const toolCalls = llmAdapter.parseToolCalls(response);

      if (toolCalls.length === 0) {
        metrics.totalDuration = Date.now() - startTime;
        yield {
          type: "complete",
          result: {
            success: true,
            artifacts: [],
            summary: response.content || "",
            tokensUsed: metrics.tokensUsed.total,
            duration: metrics.totalDuration,
          },
        };
        return;
      }

      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
      });

      for (const toolCall of toolCalls) {
        metrics.toolCalls++;
        const toolId = toolCall.name;
        let input: unknown;
        try {
          input = JSON.parse(toolCall.arguments);
        } catch {
          input = toolCall.arguments;
        }

        yield { type: "tool_call", tool: toolId, input };

        yield {
          type: "tool_progress",
          tool: toolId,
          progress: 0,
          message: `Starting ${toolId}`,
        };

        const toolResult = await this.executeTool(
          toolId,
          input,
          context,
          cfg.enableRetry,
        );

        yield {
          type: "tool_progress",
          tool: toolId,
          progress: 100,
          message: `Completed ${toolId}`,
        };

        if (toolResult.success) {
          metrics.successfulToolCalls++;
        } else {
          metrics.failedToolCalls++;
        }

        yield {
          type: "tool_result",
          tool: toolId,
          output: toolResult.data,
          duration: toolResult.metadata?.duration || 0,
        };

        messages.push(
          llmAdapter.buildToolResultMessage(
            toolCall.id,
            toolCall.name,
            toolResult.success ? toolResult.data : { error: toolResult.error },
          ),
        );
      }

      if (cfg.enableCheckpoints && this.checkpoint) {
        this.checkpoint.save({
          executionId,
          iteration: metrics.iterations,
          messages: [...messages],
          toolResults: metrics.toolCallDetails.map((d) => ({
            toolId: d.tool,
            result: { duration: d.duration, success: d.success },
          })),
          tokenUsage: this.tokenTracker?.getUsage(executionId) ?? {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 0,
            callCount: 0,
          },
          timestamp: new Date(),
        });
      }
    }

    metrics.totalDuration = Date.now() - startTime;
    yield {
      type: "complete",
      result: {
        success: true,
        artifacts: [],
        summary: "Resumed execution completed",
        tokensUsed: metrics.tokensUsed.total,
        duration: metrics.totalDuration,
      },
    };
  }

  /**
   * 执行单个工具
   * A3 Fix: 支持 MCP 工具（工具名以 mcp_ 开头）
   */
  private async executeTool(
    toolId: string,
    input: unknown,
    context: ToolContext,
    enableRetry: boolean,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // A3 Fix: 检查是否为 MCP 工具（格式: mcp_{serverId}_{toolName}）
    if (toolId.startsWith("mcp_") && this.mcpManager) {
      return this.executeMCPTool(toolId, input, context, startTime);
    }

    if (!this.toolRegistry.has(toolId)) {
      this.logger.warn(`[executeTool] Tool not found: ${toolId}`);
      return {
        success: false,
        error: { message: `Tool not found: ${toolId}`, code: "NOT_FOUND" },
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: Date.now() - startTime,
        },
      };
    }

    const tool = this.toolRegistry.get(toolId);

    if (enableRetry) {
      const result = await this.retryStrategy.executeWithRetry(
        () => tool.execute(input, context),
        toolId,
        `Tool:${toolId}`,
      );

      if (result.success && result.data) {
        return result.data;
      }

      return {
        success: false,
        error: {
          message: result.error?.message || "Tool execution failed",
          code: "EXECUTION_FAILED",
        },
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: result.totalDuration,
          extra: { attempts: result.attempts },
        },
      };
    }

    return tool.execute(input, context);
  }

  /**
   * A3 Fix: 执行 MCP 工具
   */
  private async executeMCPTool(
    toolId: string,
    input: unknown,
    context: ToolContext,
    startTime: number,
  ): Promise<ToolResult> {
    // 解析 MCP 工具名（格式: mcp_{serverId}_{toolName}）
    const parts = toolId.split("_");
    if (parts.length < 3) {
      return {
        success: false,
        error: {
          message: `Invalid MCP tool ID format: ${toolId}`,
          code: "INVALID_FORMAT",
        },
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: Date.now() - startTime,
        },
      };
    }

    const serverId = parts[1];
    const toolName = parts.slice(2).join("_"); // 工具名可能包含下划线

    try {
      const result = await this.mcpManager!.callTool(
        serverId,
        toolName,
        input as Record<string, unknown>,
      );

      // 转换 MCP 结果为 ToolResult 格式
      const content = result.content
        .map((c) => c.text || c.data || "")
        .join("\n");

      return {
        success: !result.isError,
        data: result.isError ? undefined : content,
        error: result.isError
          ? {
              message: content || "MCP tool execution failed",
              code: "MCP_ERROR",
            }
          : undefined,
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: Date.now() - startTime,
          extra: { serverId, toolName, mcpTool: true },
        },
      };
    } catch (error) {
      this.logger.error(
        `[executeMCPTool] Failed to execute ${serverId}:${toolName}: ${(error as Error).message}`,
      );
      return {
        success: false,
        error: {
          message: (error as Error).message || "MCP tool execution failed",
          code: "MCP_EXECUTION_FAILED",
        },
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: Date.now() - startTime,
          extra: { serverId, toolName, mcpTool: true },
        },
      };
    }
  }

  /**
   * 获取工具的 Function 定义
   */
  private getFunctionDefinitions(tools: ToolId[]): FunctionDefinition[] {
    const definitions: FunctionDefinition[] = [];

    for (const toolId of tools) {
      if (this.toolRegistry.has(toolId)) {
        const tool = this.toolRegistry.get(toolId);
        definitions.push(tool.toFunctionDefinition());
      } else {
        this.logger.warn(
          `[getFunctionDefinitions] Tool not registered: ${toolId}`,
        );
      }
    }

    return definitions;
  }

  /**
   * 获取所有已注册工具的 Function 定义
   */
  getAllFunctionDefinitions(): FunctionDefinition[] {
    const tools = this.toolRegistry.getAll();
    return tools.map((tool) => tool.toFunctionDefinition());
  }

  /**
   * ★ NEW: 执行 Function Calling with AICapabilityContext
   *
   * 使用 AICapabilityResolver 来解析可用的工具，自动处理权限和配置
   * A3 Fix: 现在包含 MCP 工具
   */
  async *executeWithContext(
    llmAdapter: ILLMAdapter,
    systemPrompt: string,
    userPrompt: string,
    context: AICapabilityContext,
    config?: Partial<ExecutionConfig>,
  ): AsyncGenerator<AgentEvent> {
    if (!this.capabilityResolver) {
      this.logger.warn(
        "[executeWithContext] AICapabilityResolver not available, using empty tool list",
      );
      yield {
        type: "error",
        error: "AICapabilityResolver not available",
      };
      return;
    }

    // A3 Fix: 获取包含 MCP 工具的完整 Function Definitions
    const functionDefinitions =
      await this.capabilityResolver.getToolFunctionDefinitions(context);

    this.logger.log(
      `[executeWithContext] Resolved ${functionDefinitions.length} tools (including MCP) for context`,
    );

    // 2. 构建 ToolContext
    const toolContext: ToolContext = {
      executionId: context.agentId || `exec-${Date.now()}`,
      toolId: "function-calling",
      userId: context.userId,
      createdAt: new Date(),
    };

    // 3. A3 Fix: 执行 Function Calling（使用 function definitions 直接）
    let successfulCalls = 0;
    let failedCalls = 0;

    for await (const event of this.executeWithDefinitions(
      llmAdapter,
      systemPrompt,
      userPrompt,
      functionDefinitions,
      toolContext,
      config,
    )) {
      // 4. 记录工具调用日志
      if (event.type === "tool_result") {
        const success = event.output !== undefined && event.output !== null;

        if (success) {
          successfulCalls++;
        } else {
          failedCalls++;
        }

        // 记录到 AIUsageLog（fire-and-forget 模式，不阻塞主流程）
        if (this.capabilityResolver) {
          this.capabilityResolver
            .logCapabilityUsage({
              capabilityType: "tool",
              capabilityId: event.tool,
              agentId: context.agentId,
              teamId: context.teamId,
              userId: context.userId,
              success,
              duration: event.duration,
            })
            .catch((err) => {
              this.logger.warn(
                `Failed to log tool usage: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
      }

      yield event;
    }

    this.logger.log(
      `[executeWithContext] Completed with ${successfulCalls} successful and ${failedCalls} failed tool calls`,
    );
  }

  /**
   * A3 Fix: 内部方法 - 使用 FunctionDefinitions 直接执行
   * 支持内置工具和 MCP 工具的混合执行
   */
  private async *executeWithDefinitions(
    llmAdapter: ILLMAdapter,
    systemPrompt: string,
    userPrompt: string,
    functionDefinitions: FunctionDefinition[],
    context: ToolContext,
    config?: Partial<ExecutionConfig>,
  ): AsyncGenerator<AgentEvent> {
    const cfg: ExecutionConfig = {
      ...FunctionCallingExecutor.DEFAULT_CONFIG,
      ...config,
    };
    const startTime = Date.now();

    const executionId =
      context.executionId ||
      `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.tokenTracker?.createSession(executionId);

    const metrics: ExecutionMetrics = {
      iterations: 0,
      toolCalls: 0,
      successfulToolCalls: 0,
      failedToolCalls: 0,
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
      totalDuration: 0,
      toolCallDetails: [],
    };

    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    this.logger.log(
      `[executeWithDefinitions] Starting with ${functionDefinitions.length} tools`,
    );

    // ★ Map legacy parameters to taskProfile if taskProfile not provided
    const requestOptions: LLMRequestOptions = {
      messages,
      functions: functionDefinitions,
      tool_choice: "auto",
    };

    if (cfg.taskProfile) {
      // Use provided taskProfile
      requestOptions.taskProfile = cfg.taskProfile;
    } else {
      // Map legacy temperature/maxTokens to taskProfile (fallback for backward compat)
      requestOptions.taskProfile = {
        creativity: this.mapTemperatureToCreativity(cfg.temperature ?? 0.7),
        outputLength: this.mapMaxTokensToOutputLength(cfg.maxTokens ?? 4096),
      };
    }

    try {
      while (
        metrics.iterations < cfg.maxIterations &&
        metrics.toolCalls < cfg.maxToolCalls
      ) {
        metrics.iterations++;

        this.logger.log(
          `[executeWithDefinitions] Iteration ${metrics.iterations}`,
        );

        // Context compaction — BEFORE each LLM call
        if (this.contextCompaction) {
          const currentTokens = this.estimateTokens(messages);
          // Save originals before compaction to preserve tool_calls/tool_call_id/name fields
          const originalMessages = [...messages];
          const compactionResult = await this.contextCompaction.compact(
            messages.map((m) => ({
              role: m.role as "system" | "user" | "assistant" | "tool",
              content: m.content ?? "",
              isToolUse: !!m.tool_calls,
              isToolResult: m.role === "tool",
              toolUseId: m.tool_calls?.[0]?.id,
              toolResultFor: m.tool_call_id,
            })),
            currentTokens,
            undefined, // config (use defaults)
            async (text: string, maxLength: number) => {
              // Level 2: AI-powered summarization
              const summaryResponse = await llmAdapter.chat({
                messages: [
                  {
                    role: "system",
                    content:
                      "Summarize the following conversation concisely, preserving key decisions and findings.",
                  },
                  { role: "user", content: text.slice(0, 8000) },
                ],
              });
              return (summaryResponse.content ?? "").slice(0, maxLength);
            },
          );
          if (compactionResult.levelApplied !== "none") {
            messages.length = 0;
            for (const compactedMsg of compactionResult.messages) {
              // Try to find the original message to preserve tool fields
              const original = originalMessages.find(
                (o) =>
                  o.role === compactedMsg.role &&
                  o.content === compactedMsg.content,
              );
              if (original) {
                messages.push(original); // preserve all original fields
              } else {
                // New message (e.g., summary) — construct with basic fields
                messages.push({
                  role: compactedMsg.role as LLMMessage["role"],
                  content: (compactedMsg.content as string) ?? "",
                });
              }
            }
            this.logger.log(
              `[executeWithDefinitions] Context compacted: level=${compactionResult.levelApplied}, saved=${compactionResult.tokensSaved} tokens`,
            );
          }
        }

        let response: LLMResponse;
        try {
          response = await llmAdapter.chat(requestOptions);
        } catch (error) {
          if (this.modelFallback) {
            this.logger.warn(
              `[executeWithDefinitions] Primary model failed, attempting fallback`,
            );
            const fallbackResult = await this.modelFallback.executeWithFallback(
              requestOptions.model || "",
              async (modelConfig) => {
                return llmAdapter.chat({
                  ...requestOptions,
                  model: modelConfig.modelId,
                });
              },
              { operation: "function-calling-loop" },
            );
            if (fallbackResult.success && fallbackResult.data) {
              response = fallbackResult.data;
              this.logger.log(
                `[executeWithDefinitions] Fallback successful: model=${fallbackResult.modelUsed}`,
              );
            } else {
              yield {
                type: "error",
                error: fallbackResult.error?.message || "All models failed",
              };
              break;
            }
          } else {
            this.logger.error(
              `[executeWithDefinitions] LLM call failed: ${error}`,
            );
            yield {
              type: "error",
              error: error instanceof Error ? error.message : "LLM call failed",
            };
            break;
          }
        }

        if (response.usage) {
          metrics.tokensUsed.prompt += response.usage.promptTokens;
          metrics.tokensUsed.completion += response.usage.completionTokens;
          metrics.tokensUsed.total += response.usage.totalTokens;
        }

        // Token tracking — after each LLM response
        if (this.tokenTracker && response.usage) {
          this.tokenTracker.recordUsage(executionId, {
            inputTokens: response.usage.promptTokens,
            outputTokens: response.usage.completionTokens,
          });
        }

        const toolCalls = llmAdapter.parseToolCalls(response);

        if (toolCalls.length === 0) {
          // Auto-continuation via QueryLoop when output is truncated
          if (
            cfg.enableQueryLoop &&
            this.queryLoop &&
            response.finishReason === "length"
          ) {
            this.logger.log(
              "[executeWithDefinitions] Output truncated, using QueryLoop for continuation",
            );
            const loopResult = await this.queryLoop.executeWithLoop(
              async (msgs) => {
                const loopResponse = await llmAdapter.chat({
                  ...requestOptions,
                  messages: msgs.map((m) => ({
                    role: m.role as LLMMessage["role"],
                    content: m.content,
                  })),
                });
                return {
                  content: loopResponse.content ?? "",
                  model: loopResponse.model ?? "",
                  tokensUsed: loopResponse.usage?.totalTokens ?? 0,
                  inputTokens: loopResponse.usage?.promptTokens,
                  outputTokens: loopResponse.usage?.completionTokens,
                  finishReason: loopResponse.finishReason,
                };
              },
              messages.map((m) => ({
                role: m.role,
                content: typeof m.content === "string" ? m.content : "",
              })),
            );

            metrics.totalDuration = Date.now() - startTime;
            yield {
              type: "complete",
              result: {
                success: true,
                artifacts: [],
                summary: loopResult.content,
                tokensUsed:
                  metrics.tokensUsed.total +
                  loopResult.totalInputTokens +
                  loopResult.totalOutputTokens,
                duration: metrics.totalDuration,
              },
            };
            return;
          }

          this.logger.log(
            "[executeWithDefinitions] No tool calls, task completed",
          );

          metrics.totalDuration = Date.now() - startTime;

          yield {
            type: "complete",
            result: {
              success: true,
              artifacts: [],
              summary: response.content || "",
              tokensUsed: metrics.tokensUsed.total,
              duration: metrics.totalDuration,
            },
          };

          return;
        }

        messages.push({
          role: "assistant",
          content: response.content,
          tool_calls: response.tool_calls,
        });

        this.logger.log(
          `[executeWithDefinitions] Executing ${toolCalls.length} tool calls`,
        );

        // Tool execution — parallel or serial
        if (cfg.parallelToolCalls && this.toolConcurrency) {
          const partition = this.toolConcurrency.partition(
            toolCalls.map((tc) => ({
              toolId: tc.name,
              category: this.toolRegistry.has(tc.name)
                ? this.toolRegistry.get(tc.name).category
                : undefined,
            })),
          );

          // Build a lookup from toolId to ToolCallRequest (last wins if duplicated)
          const toolCallByName = new Map<string, ToolCallRequest>();
          for (const tc of toolCalls) {
            toolCallByName.set(tc.name, tc);
          }

          // Execute parallel groups
          for (const group of partition.parallelGroups) {
            const groupResults = await Promise.allSettled(
              group.map((toolId) => {
                const toolCall = toolCallByName.get(toolId);
                if (!toolCall) return Promise.resolve(null);

                let input: unknown;
                try {
                  input = JSON.parse(toolCall.arguments);
                } catch {
                  input = toolCall.arguments;
                }
                return this.executeTool(
                  toolId,
                  input,
                  context,
                  cfg.enableRetry,
                ).then((toolResult) => ({
                  toolId,
                  toolCall,
                  input,
                  toolResult,
                }));
              }),
            );

            for (const [settledIdx, settled] of groupResults.entries()) {
              if (
                settled.status === "fulfilled" &&
                settled.value !== null &&
                settled.value !== undefined
              ) {
                const { toolId, toolCall, input, toolResult } =
                  settled.value as {
                    toolId: string;
                    toolCall: ToolCallRequest;
                    input: unknown;
                    toolResult: ToolResult;
                  };

                metrics.toolCalls++;

                yield { type: "tool_call", tool: toolId, input };

                metrics.toolCallDetails.push({
                  tool: toolId,
                  duration: toolResult.metadata?.duration || 0,
                  success: toolResult.success,
                });

                if (toolResult.success) {
                  metrics.successfulToolCalls++;
                } else {
                  metrics.failedToolCalls++;
                }

                yield {
                  type: "tool_result",
                  tool: toolId,
                  output: toolResult.data,
                  duration: toolResult.metadata?.duration || 0,
                };

                messages.push(
                  llmAdapter.buildToolResultMessage(
                    toolCall.id,
                    toolCall.name,
                    toolResult.success
                      ? toolResult.data
                      : { error: toolResult.error },
                  ),
                );
              } else if (settled.status === "rejected") {
                const rejectedToolId = group[settledIdx];
                const rejectedToolCall = rejectedToolId
                  ? toolCallByName.get(rejectedToolId)
                  : undefined;
                metrics.toolCalls++;
                metrics.failedToolCalls++;
                const reason =
                  settled.reason instanceof Error
                    ? settled.reason.message
                    : String(settled.reason);
                this.logger.warn(
                  `[executeWithDefinitions] Parallel tool rejected: ${rejectedToolId} — ${reason}`,
                );
                if (rejectedToolId) {
                  yield {
                    type: "tool_result" as const,
                    tool: rejectedToolId,
                    output: { error: reason },
                    duration: 0,
                  };
                }
                if (rejectedToolCall) {
                  messages.push(
                    llmAdapter.buildToolResultMessage(
                      rejectedToolCall.id,
                      rejectedToolCall.name,
                      { error: reason },
                    ),
                  );
                }
              }
            }
          }

          // Execute sequential tools
          for (const seqToolId of partition.sequential) {
            const toolCall = toolCallByName.get(seqToolId);
            if (!toolCall) continue;

            metrics.toolCalls++;

            let input: unknown;
            try {
              input = JSON.parse(toolCall.arguments);
            } catch {
              input = toolCall.arguments;
            }

            yield { type: "tool_call", tool: seqToolId, input };

            const toolResult = await this.executeTool(
              seqToolId,
              input,
              context,
              cfg.enableRetry,
            );

            metrics.toolCallDetails.push({
              tool: seqToolId,
              duration: toolResult.metadata?.duration || 0,
              success: toolResult.success,
            });

            if (toolResult.success) {
              metrics.successfulToolCalls++;
            } else {
              metrics.failedToolCalls++;
            }

            yield {
              type: "tool_result",
              tool: seqToolId,
              output: toolResult.data,
              duration: toolResult.metadata?.duration || 0,
            };

            messages.push(
              llmAdapter.buildToolResultMessage(
                toolCall.id,
                toolCall.name,
                toolResult.success
                  ? toolResult.data
                  : { error: toolResult.error },
              ),
            );
          }
        } else {
          // Original serial execution
          for (const toolCall of toolCalls) {
            metrics.toolCalls++;

            const toolId = toolCall.name;
            let input: unknown;

            try {
              input = JSON.parse(toolCall.arguments);
            } catch {
              input = toolCall.arguments;
            }

            yield {
              type: "tool_call",
              tool: toolId,
              input,
            };

            yield {
              type: "tool_progress",
              tool: toolId,
              progress: 0,
              message: `Starting ${toolId}`,
            };

            const toolResult = await this.executeTool(
              toolId,
              input,
              context,
              cfg.enableRetry,
            );

            yield {
              type: "tool_progress",
              tool: toolId,
              progress: 100,
              message: `Completed ${toolId}`,
            };

            metrics.toolCallDetails.push({
              tool: toolId,
              duration: toolResult.metadata?.duration || 0,
              success: toolResult.success,
            });

            if (toolResult.success) {
              metrics.successfulToolCalls++;
            } else {
              metrics.failedToolCalls++;
            }

            yield {
              type: "tool_result",
              tool: toolId,
              output: toolResult.data,
              duration: toolResult.metadata?.duration || 0,
            };

            const toolResultMessage = llmAdapter.buildToolResultMessage(
              toolCall.id,
              toolCall.name,
              toolResult.success
                ? toolResult.data
                : { error: toolResult.error },
            );
            messages.push(toolResultMessage);
          }
        }

        // Checkpoint at end of each iteration
        if (cfg.enableCheckpoints && this.checkpoint) {
          this.checkpoint.save({
            executionId,
            iteration: metrics.iterations,
            messages: [...messages],
            toolResults: metrics.toolCallDetails.map((d) => ({
              toolId: d.tool,
              result: { duration: d.duration, success: d.success },
            })),
            tokenUsage: this.tokenTracker?.getUsage(executionId) ?? {
              inputTokens: 0,
              outputTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              totalTokens: 0,
              callCount: 0,
            },
            timestamp: new Date(),
          });
        }
      }

      if (metrics.iterations >= cfg.maxIterations) {
        this.logger.warn("[executeWithDefinitions] Max iterations reached");
        yield {
          type: "error",
          error: "Max iterations reached, task may be incomplete",
        };
      }

      if (metrics.toolCalls >= cfg.maxToolCalls) {
        this.logger.warn("[executeWithDefinitions] Max tool calls reached");
        yield {
          type: "error",
          error: "Max tool calls reached, task may be incomplete",
        };
      }

      metrics.totalDuration = Date.now() - startTime;

      yield {
        type: "complete",
        result: {
          success: true,
          artifacts: [],
          summary: "Task execution completed",
          tokensUsed: metrics.tokensUsed.total,
          duration: metrics.totalDuration,
        },
      };
    } finally {
      this.tokenTracker?.endSession(executionId);
      this.checkpoint?.endExecution(executionId);
    }
  }

  /**
   * Estimate token count for messages (used by context compaction)
   */
  private estimateTokens(messages: LLMMessage[]): number {
    let chars = 0;
    for (const msg of messages) {
      chars +=
        typeof msg.content === "string"
          ? msg.content.length
          : JSON.stringify(msg.content).length;
    }
    return Math.ceil(chars * 0.6); // avg tokens per char for mixed CJK/EN
  }

  /**
   * Map legacy temperature values to creativity levels
   */
  private mapTemperatureToCreativity(
    temperature: number,
  ): "deterministic" | "low" | "medium" | "high" {
    if (temperature <= 0.2) return "deterministic";
    if (temperature <= 0.3) return "low";
    if (temperature <= 0.7) return "medium";
    return "high";
  }

  /**
   * Map legacy maxTokens values to outputLength levels
   */
  private mapMaxTokensToOutputLength(
    maxTokens: number,
  ): "minimal" | "short" | "medium" | "standard" | "long" | "extended" {
    if (maxTokens <= 1000) return "minimal";
    if (maxTokens <= 2000) return "short";
    if (maxTokens <= 4000) return "medium";
    if (maxTokens <= 6000) return "standard";
    if (maxTokens <= 8000) return "long";
    return "extended";
  }
}
