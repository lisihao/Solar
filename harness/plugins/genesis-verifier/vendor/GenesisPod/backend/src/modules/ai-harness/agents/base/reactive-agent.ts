/**
 * Legacy Reactive Agent (migrated from ai-harness/agents/base)
 *
 * @deprecated Use HarnessedAgent / SpecBasedAgent for new agents.
 * Migrated: PR-X5 (ai-harness/agents/base → ai-harness/agents/base)
 */

import { ExecutionMode } from "@/modules/ai-harness/agents/abstractions/agent.types";
import { AgentError } from "@/modules/ai-harness/agents/abstractions/agent-error";
import {
  AgentContext,
  AgentInput,
  AgentOutput,
  AgentEvent,
  AgentResult,
  ToolCallRecord,
} from "../abstractions/plan-based-agent.interface";
import { BaseAgent } from "./base-agent";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "../../../ai-engine/llm/abstractions";

/**
 * ReAct Agent 配置
 */
export interface ReactAgentConfig {
  /**
   * 最大迭代次数
   */
  maxIterations?: number;

  /**
   * 是否自动执行工具调用
   */
  autoExecuteTools?: boolean;

  /**
   * 思考提示词模板
   */
  thinkingPrompt?: string;

  /**
   * 工具选择策略
   */
  toolSelectionStrategy?: "auto" | "manual";
}

/**
 * ReAct 模式 Agent 基类
 * 实现 Reasoning + Acting 循环
 */
export abstract class ReactiveAgent<
  TInput = AgentInput,
  TOutput = AgentOutput,
> extends BaseAgent<TInput, TOutput> {
  /**
   * 支持的执行模式
   */
  readonly supportedModes: ExecutionMode[] = ["reactive"];

  /**
   * 配置
   */
  protected config: ReactAgentConfig;

  /**
   * 默认配置
   */
  private static readonly DEFAULT_CONFIG: ReactAgentConfig = {
    maxIterations: 10,
    autoExecuteTools: true,
    toolSelectionStrategy: "auto",
  };

  constructor(config?: Partial<ReactAgentConfig>) {
    super();
    this.config = { ...ReactiveAgent.DEFAULT_CONFIG, ...config };
  }

  /**
   * 获取可用工具定义
   */
  protected abstract getToolDefinitions(): LLMToolDefinition[];

  /**
   * 处理最终输出
   */
  protected abstract processOutput(
    content: string,
    context: AgentContext,
    toolResults: ToolCallRecord[],
  ): Promise<TOutput>;

  /**
   * 核心执行逻辑
   */
  protected async doExecute(
    input: TInput,
    context: AgentContext,
  ): Promise<TOutput> {
    const toolResults: ToolCallRecord[] = [];
    let iterationCount = 0;
    const messages = this.buildInitialMessages(input, context);

    while (iterationCount < (this.config.maxIterations || 10)) {
      iterationCount++;

      // 检查取消信号
      if (context.signal?.aborted) {
        throw AgentError.cancelled(this.id);
      }

      // 调用 LLM
      const response = await this.callLLM(messages, {
        tools: this.getToolDefinitions(),
      });

      // 检查是否有工具调用
      if (response.toolCalls && response.toolCalls.length > 0) {
        // 执行工具调用
        const results = await this.executeToolCalls(
          response.toolCalls,
          context,
        );
        toolResults.push(...results);

        // 添加助手消息和工具结果到消息列表
        messages.push({
          role: "assistant",
          content: response.content || "",
          toolCalls: response.toolCalls,
        });

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const toolCall = response.toolCalls[i];
          messages.push({
            role: "tool",
            content: JSON.stringify(result.output),
            toolCallId: toolCall.id,
          });
        }
      } else {
        // 没有工具调用，返回最终结果
        return this.processOutput(response.content || "", context, toolResults);
      }
    }

    // 达到最大迭代次数
    const maxIter = this.config.maxIterations || 10;
    this.logger.warn(`[${this.id}] Reached max iterations (${maxIter})`);
    throw AgentError.maxIterationsReached(this.id, iterationCount, maxIter);
  }

  /**
   * 流式执行
   */
  async *executeStream(
    input: TInput,
    context: AgentContext,
  ): AsyncGenerator<AgentEvent, AgentResult<TOutput>> {
    const startTime = new Date();
    const executionId = context.executionId || "";
    const toolResults: ToolCallRecord[] = [];
    let iterationCount = 0;
    const messages = this.buildInitialMessages(input, context);

    // 发送开始事件
    yield {
      type: "started",
      agentId: this.id,
      executionId,
      timestamp: new Date(),
    };

    try {
      while (iterationCount < (this.config.maxIterations || 10)) {
        iterationCount++;

        if (context.signal?.aborted) {
          throw AgentError.cancelled(this.id);
        }

        // 发送思考事件
        yield {
          type: "thinking",
          agentId: this.id,
          executionId,
          timestamp: new Date(),
          data: { iteration: iterationCount },
        };

        const response = await this.callLLM(messages, {
          tools: this.getToolDefinitions(),
        });

        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const toolCall of response.toolCalls) {
            // 发送工具调用事件
            yield {
              type: "tool_call",
              agentId: this.id,
              executionId,
              timestamp: new Date(),
              data: {
                toolId: toolCall.name,
                input: toolCall.arguments,
              },
            };

            // 执行工具
            const result = await this.executeSingleToolCall(toolCall, context);
            toolResults.push(result);

            // 发送工具结果事件
            yield {
              type: "tool_result",
              agentId: this.id,
              executionId,
              timestamp: new Date(),
              data: {
                toolId: toolCall.name,
                output: result.output,
                success: result.success,
              },
            };

            messages.push({
              role: "tool",
              content: JSON.stringify(result.output),
              toolCallId: toolCall.id,
            });
          }

          messages.push({
            role: "assistant",
            content: response.content || "",
            toolCalls: response.toolCalls,
          });
        } else {
          // 发送消息事件
          yield {
            type: "message",
            agentId: this.id,
            executionId,
            timestamp: new Date(),
            data: { content: response.content },
          };

          const output = await this.processOutput(
            response.content || "",
            context,
            toolResults,
          );

          const result: AgentResult<TOutput> = {
            success: true,
            data: output,
            metadata: {
              executionId,
              startTime,
              endTime: new Date(),
              duration: Date.now() - startTime.getTime(),
              toolsCalled: toolResults.map((r) => r.toolId),
              iterationCount,
            },
          };

          yield {
            type: "completed",
            agentId: this.id,
            executionId,
            timestamp: new Date(),
            data: result,
          };

          return result;
        }
      }

      throw AgentError.maxIterationsReached(
        this.id,
        iterationCount,
        this.config.maxIterations || 10,
      );
    } catch (error) {
      const agentError = AgentError.fromError(error, this.id);

      yield {
        type: "error",
        agentId: this.id,
        executionId,
        timestamp: new Date(),
        data: { error: agentError.message },
      };

      return {
        success: false,
        error: {
          code: agentError.code,
          message: agentError.message,
          retryable: agentError.retryable,
        },
        metadata: {
          executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
          iterationCount,
        },
      };
    }
  }

  /**
   * 构建初始消息
   */
  protected buildInitialMessages(
    input: TInput,
    context: AgentContext,
  ): LLMMessage[] {
    if (!this.isAgentInput(input)) {
      throw AgentError.executionFailed(
        this.id,
        "Input missing required prompt field",
      );
    }
    return this.buildMessages(input.prompt, context);
  }

  /**
   * 类型守卫：检查 input 是否符合 AgentInput
   */
  private isAgentInput(v: unknown): v is AgentInput {
    return typeof v === "object" && v !== null && "prompt" in v;
  }

  /**
   * 执行工具调用列表
   */
  private async executeToolCalls(
    toolCalls: LLMToolCall[],
    context: AgentContext,
  ): Promise<ToolCallRecord[]> {
    const results: ToolCallRecord[] = [];

    for (const toolCall of toolCalls) {
      const result = await this.executeSingleToolCall(toolCall, context);
      results.push(result);
    }

    return results;
  }

  /**
   * 执行单个工具调用
   */
  private async executeSingleToolCall(
    toolCall: LLMToolCall,
    context: AgentContext,
  ): Promise<ToolCallRecord> {
    const startTime = Date.now();

    try {
      const result = await this.callTool(
        toolCall.name,
        toolCall.arguments,
        context,
      );

      return {
        toolId: toolCall.name,
        input: toolCall.arguments,
        output: result.data,
        duration: Date.now() - startTime,
        success: result.success,
      };
    } catch (error) {
      return {
        toolId: toolCall.name,
        input: toolCall.arguments,
        output: { error: (error as Error).message },
        duration: Date.now() - startTime,
        success: false,
      };
    }
  }
}
