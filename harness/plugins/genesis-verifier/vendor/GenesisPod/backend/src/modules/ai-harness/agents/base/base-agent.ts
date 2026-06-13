/**
 * Legacy Base Agent (migrated from ai-harness/agents/base)
 *
 * @deprecated Use HarnessedAgent / SpecBasedAgent for new agents.
 * This class is kept for backwards-compat with existing ai-app agents (e.g. research).
 *
 * Migrated: PR-X5 (ai-harness/agents/base → ai-harness/agents/base)
 */

import { v4 as uuid } from "uuid";
import { Logger } from "@nestjs/common";
import { JsonObject } from "@/modules/ai-engine/facade/index";
import { ExecutionMode } from "@/modules/ai-harness/agents/abstractions/agent.types";
import { AgentError } from "@/modules/ai-harness/agents/abstractions/agent-error";
import { ToolRegistry } from "../../../ai-engine/tools/registry";
import { ToolContext, ToolResult } from "../../../ai-engine/tools/abstractions";
import { ToolPipeline } from "../../../ai-engine/tools/middleware/tool-pipeline";
import { SkillRegistry } from "../../../ai-engine/skills/registry";
import {
  SkillContext,
  SkillResult,
} from "../../../ai-engine/skills/abstractions";
import {
  IAgent,
  AgentContext,
  AgentInput,
  AgentOutput,
  AgentResult,
  AgentEvent,
  AgentCapability,
  ExecutionPlan,
} from "../abstractions/plan-based-agent.interface";
import {
  ILLMAdapter,
  LLMMessage,
  LLMResponse,
  LLMToolDefinition,
} from "../../../ai-engine/llm/abstractions";

/**
 * 基础 Agent 抽象类
 */
export abstract class BaseAgent<
  TInput = AgentInput,
  TOutput = AgentOutput,
> implements IAgent<TInput, TOutput> {
  /**
   * Agent ID
   */
  abstract readonly id: string;

  /**
   * Agent 名称
   */
  abstract readonly name: string;

  /**
   * Agent 描述
   */
  abstract readonly description: string;

  /**
   * 支持的执行模式
   */
  abstract readonly supportedModes: ExecutionMode[];

  /**
   * Agent 能力
   */
  abstract readonly capabilities: AgentCapability[];

  /**
   * 依赖的工具
   */
  readonly requiredTools?: string[];

  /**
   * 依赖的技能
   */
  readonly requiredSkills?: string[];

  /**
   * 版本
   */
  readonly version: string = "1.0.0";

  /**
   * 日志记录器
   */
  protected readonly logger: Logger;

  /**
   * 工具注册表
   */
  protected toolRegistry?: ToolRegistry;

  /**
   * 工具执行管道
   */
  protected toolPipeline?: ToolPipeline;

  /**
   * 技能注册表
   */
  protected skillRegistry?: SkillRegistry;

  /**
   * LLM 适配器
   */
  protected llmAdapter?: ILLMAdapter;

  /**
   * 系统提示词
   */
  protected systemPrompt?: string;

  /**
   * 执行统计
   */
  private stats = {
    totalExecutions: 0,
    successCount: 0,
    failureCount: 0,
    totalTokensUsed: 0,
    toolsCalled: [] as string[],
    skillsCalled: [] as string[],
  };

  constructor() {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * 设置工具注册表
   */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /**
   * 设置工具执行管道
   */
  setToolPipeline(pipeline: ToolPipeline): void {
    this.toolPipeline = pipeline;
  }

  /**
   * 设置技能注册表
   */
  setSkillRegistry(registry: SkillRegistry): void {
    this.skillRegistry = registry;
  }

  /**
   * 设置 LLM 适配器
   */
  setLLMAdapter(adapter: ILLMAdapter): void {
    this.llmAdapter = adapter;
  }

  /**
   * 设置系统提示词
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 核心执行逻辑（子类必须实现）
   */
  protected abstract doExecute(
    input: TInput,
    context: AgentContext,
  ): Promise<TOutput>;

  /**
   * 执行 Agent
   */
  async execute(
    input: TInput,
    context: AgentContext,
  ): Promise<AgentResult<TOutput>> {
    const startTime = new Date();
    const executionId = context.executionId || uuid();

    const toolsCalled: string[] = [];
    const skillsCalled: string[] = [];

    try {
      // 检查取消信号
      if (context.signal?.aborted) {
        throw AgentError.cancelled(this.id);
      }

      // 验证执行模式
      if (context.mode && !this.supportedModes.includes(context.mode)) {
        throw AgentError.invalidMode(
          this.id,
          context.mode,
          this.supportedModes,
        );
      }

      // 执行核心逻辑
      const data = await this.doExecute(input, context);

      this.stats.successCount++;
      return {
        success: true,
        data,
        metadata: this.buildMetadata(
          executionId,
          startTime,
          toolsCalled,
          skillsCalled,
        ),
      };
    } catch (error) {
      this.stats.failureCount++;
      const agentError = AgentError.fromError(error, this.id);

      return {
        success: false,
        error: {
          code: agentError.code,
          message: agentError.message,
          details: agentError.details as JsonObject,
          retryable: agentError.retryable,
        },
        metadata: this.buildMetadata(
          executionId,
          startTime,
          toolsCalled,
          skillsCalled,
        ),
      };
    } finally {
      this.stats.totalExecutions++;
    }
  }

  /**
   * 流式执行（子类可覆盖）
   */
  async *executeStream(
    input: TInput,
    context: AgentContext,
  ): AsyncGenerator<AgentEvent, AgentResult<TOutput>> {
    const startTime = new Date();
    const executionId = context.executionId || uuid();

    // 发送开始事件
    yield {
      type: "started",
      agentId: this.id,
      executionId,
      timestamp: new Date(),
    };

    try {
      // 默认实现：调用 execute 并发送完成事件
      const result = await this.execute(input, context);

      yield {
        type: "completed",
        agentId: this.id,
        executionId,
        timestamp: new Date(),
        data: result,
      };

      return result;
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
        },
      };
    }
  }

  /**
   * 生成执行计划（子类可覆盖）
   */
  async plan(_input: TInput, _context: AgentContext): Promise<ExecutionPlan> {
    return {
      id: uuid(),
      agentId: this.id,
      steps: [],
    };
  }

  /**
   * 验证输入（子类可覆盖）
   */
  validateInput?(_input: TInput): { valid: boolean; errors?: string[] };

  /**
   * 调用工具
   * Pipeline 优先；无 pipeline 时降级到 direct execute（保留单测兼容 + setter 可选注入）
   */
  protected async callTool<T>(
    toolId: string,
    toolInput: unknown,
    context: AgentContext,
  ): Promise<ToolResult<T>> {
    if (!this.toolRegistry) {
      throw AgentError.missingDependency(this.id, "tool", toolId);
    }

    const tool = this.toolRegistry.tryGet(toolId);
    if (!tool) {
      throw AgentError.missingDependency(this.id, "tool", toolId);
    }

    const toolContext: ToolContext = {
      executionId: context.executionId,
      toolId,
      userId: context.userId,
      sessionId: context.sessionId,
      callerId: this.id,
      callerType: "agent",
      signal: context.signal,
      createdAt: new Date(),
    };

    const result = this.toolPipeline
      ? ((await this.toolPipeline.execute(
          tool,
          toolInput,
          toolContext,
        )) as ToolResult<T>)
      : ((await tool.execute(toolInput, toolContext)) as ToolResult<T>);

    if (result.success) {
      this.stats.toolsCalled.push(toolId);
    }
    return result;
  }

  /**
   * 调用技能
   */
  protected async callSkill<TSkillInput, TSkillOutput>(
    skillId: string,
    skillInput: TSkillInput,
    context: AgentContext,
  ): Promise<SkillResult<TSkillOutput>> {
    if (!this.skillRegistry) {
      throw AgentError.missingDependency(this.id, "skill", skillId);
    }

    const skill = this.skillRegistry.tryGet(skillId);
    if (!skill) {
      throw AgentError.missingDependency(this.id, "skill", skillId);
    }

    const skillContext: SkillContext = {
      executionId: context.executionId,
      skillId,
      userId: context.userId,
      sessionId: context.sessionId,
      callerId: this.id,
      signal: context.signal,
      availableTools: context.availableTools,
      availableSkills: context.availableSkills,
      createdAt: new Date(),
    };

    const result = await (skill.execute(skillInput, skillContext) as Promise<
      SkillResult<TSkillOutput>
    >);
    if (result.success) {
      this.stats.skillsCalled.push(skillId);
    }
    return result;
  }

  /**
   * 调用 LLM
   */
  protected async callLLM(
    messages: LLMMessage[],
    options?: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: LLMToolDefinition[];
      taskProfile?: import("../../../ai-engine/llm/types").TaskProfile;
    },
  ): Promise<LLMResponse> {
    if (!this.llmAdapter) {
      throw AgentError.llmCallFailed(this.id, "LLM adapter not set");
    }

    try {
      const response = await this.llmAdapter.chat({
        messages,
        ...options,
      });

      if (response.usage?.totalTokens) {
        this.stats.totalTokensUsed += response.usage.totalTokens;
      }

      return response;
    } catch (error) {
      throw AgentError.llmCallFailed(
        this.id,
        (error as Error).message,
        error as Error,
      );
    }
  }

  /**
   * 构建带系统提示词的消息列表
   */
  protected buildMessages(
    userMessage: string,
    context: AgentContext,
  ): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // 添加系统提示词
    if (this.systemPrompt) {
      messages.push({
        role: "system",
        content: this.systemPrompt,
      });
    }

    // 添加历史消息
    if (context.memory?.messages) {
      messages.push(...context.memory.messages);
    }

    // 添加用户消息
    messages.push({
      role: "user",
      content: userMessage,
    });

    return messages;
  }

  /**
   * 解析 JSON 响应（多级 fallback）
   * 1. Markdown 代码块（```json ... ```）
   * 2. 直接 JSON.parse
   * 3. 正则提取第一个 { } / [ ] 块
   */
  protected parseJsonResponse<T>(content: string, fallback?: T): T {
    const attempts: Array<() => T> = [
      // 1. Markdown 代码块
      () => {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (!match) throw new Error("no markdown block");
        return JSON.parse(match[1].trim()) as T;
      },
      // 2. 直接解析
      () => JSON.parse(content.trim()) as T,
      // 3. 提取第一个 JSON 对象或数组
      () => {
        const objMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (!objMatch) throw new Error("no json structure found");
        return JSON.parse(objMatch[1]) as T;
      },
    ];

    for (const attempt of attempts) {
      try {
        return attempt();
      } catch {
        // 继续下一级
      }
    }

    if (fallback !== undefined) {
      this.logger.warn(`[${this.id}] Failed to parse JSON, using fallback`);
      return fallback;
    }
    throw new Error("Failed to parse JSON response: no valid JSON found");
  }

  /**
   * 构建执行元数据
   */
  private buildMetadata(
    executionId: string,
    startTime: Date,
    toolsCalled: string[],
    skillsCalled: string[],
  ) {
    const endTime = new Date();
    return {
      executionId,
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      toolsCalled,
      skillsCalled,
    };
  }

  /**
   * 获取执行统计
   */
  getStats() {
    return { ...this.stats };
  }
}

/**
 * 创建简单 Agent 的工厂函数
 */
export function createAgent<
  TInput = AgentInput,
  TOutput = AgentOutput,
>(options: {
  id: string;
  name: string;
  description: string;
  supportedModes: ExecutionMode[];
  capabilities: AgentCapability[];
  execute: (input: TInput, context: AgentContext) => Promise<TOutput>;
  requiredTools?: string[];
  requiredSkills?: string[];
}): IAgent<TInput, TOutput> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    supportedModes: options.supportedModes,
    capabilities: options.capabilities,
    requiredTools: options.requiredTools,
    requiredSkills: options.requiredSkills,

    async execute(
      input: TInput,
      context: AgentContext,
    ): Promise<AgentResult<TOutput>> {
      const startTime = new Date();
      const executionId = context.executionId || uuid();

      try {
        const data = await options.execute(input, context);
        return {
          success: true,
          data,
          metadata: {
            executionId,
            startTime,
            endTime: new Date(),
            duration: Date.now() - startTime.getTime(),
          },
        };
      } catch (error) {
        const agentError = AgentError.fromError(error, options.id);
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
          },
        };
      }
    },
  };
}
