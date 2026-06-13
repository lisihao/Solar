/**
 * AI Engine - Base Skill
 * 技能基类实现
 */

import { v4 as uuid } from "uuid";
import { Logger } from "@nestjs/common";
import { ValidationResult, JsonObject } from "@/modules/ai-engine/facade/index";
import { SkillError } from "@/modules/ai-engine/skills/abstractions/skill.error";
import { ToolRegistry } from "../../tools/registry";
import { ToolContext } from "../../tools/abstractions";
import { ToolPipeline } from "../../tools/middleware/tool-pipeline";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  PreconditionResult,
  JsonSchema,
  TriggerRule,
  SkillExample,
  SkillPermissions,
} from "../abstractions/skill.interface";

/**
 * LLM 调用选项
 */
export interface LLMCallOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

/**
 * LLM 适配器接口（简化版）
 */
export interface ILLMAdapter {
  chat(options: {
    messages: Array<{ role: string; content: string }>;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ content: string; tokensUsed?: number }>;
}

/**
 * 基础技能抽象类
 */
export abstract class BaseSkill<
  TInput = unknown,
  TOutput = unknown,
> implements ISkill<TInput, TOutput> {
  /**
   * 技能 ID
   */
  abstract readonly id: string;

  /**
   * 技能名称
   */
  abstract readonly name: string;

  /**
   * 技能描述
   */
  abstract readonly description: string;

  /**
   * 所属层次
   */
  abstract readonly layer: SkillLayer;

  /**
   * 所属领域
   */
  abstract readonly domain: string;

  /**
   * 依赖的工具
   */
  readonly requiredTools?: string[];

  /**
   * 依赖的技能
   */
  readonly requiredSkills?: string[];

  /**
   * 标签
   */
  readonly tags?: string[];

  /**
   * 版本
   */
  readonly version: string = "1.0.0";

  // --- Enhanced Manifest Fields (optional) ---

  readonly author?: string;
  readonly license?: string;
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly triggers?: TriggerRule[];
  readonly examples?: SkillExample[];
  readonly permissions?: SkillPermissions;

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
   * LLM 适配器
   */
  protected llmAdapter?: ILLMAdapter;

  /**
   * 执行统计
   */
  private stats = {
    totalExecutions: 0,
    successCount: 0,
    failureCount: 0,
    fallbackCount: 0,
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
   * 设置 LLM 适配器
   */
  setLLMAdapter(adapter: ILLMAdapter): void {
    this.llmAdapter = adapter;
  }

  /**
   * 核心执行逻辑（子类必须实现）
   */
  protected abstract doExecute(
    input: TInput,
    context: SkillContext,
  ): Promise<TOutput>;

  /**
   * 执行技能
   */
  async execute(
    input: TInput,
    context: SkillContext,
  ): Promise<SkillResult<TOutput>> {
    const startTime = new Date();
    const executionId = context.executionId || uuid();
    this.stats.totalExecutions++;

    const toolsCalled: string[] = [];
    const skillsCalled: string[] = [];

    try {
      // 检查取消信号
      if (context.signal?.aborted) {
        throw SkillError.cancelled(this.id);
      }

      // 检查前置条件
      if (this.checkPreconditions) {
        const precondition = await this.checkPreconditions(context);
        if (!precondition.satisfied) {
          throw SkillError.preconditionFailed(
            this.id,
            precondition.reason || "Precondition not satisfied",
          );
        }
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
      // 尝试降级
      const fallback = this.getFallback?.();
      if (fallback) {
        this.logger.warn(
          `[${this.id}] Primary execution failed, trying fallback: ${fallback.id}`,
        );
        try {
          const fallbackResult = await fallback.execute(input, context);
          this.stats.fallbackCount++;
          return {
            ...fallbackResult,
            usedFallback: true,
          };
        } catch (fallbackError) {
          this.logger.error(
            `[${this.id}] Fallback also failed: ${(fallbackError as Error).message}`,
          );
        }
      }

      this.stats.failureCount++;
      const skillError = SkillError.fromError(error, this.id);

      return {
        success: false,
        error: {
          code: skillError.code,
          message: skillError.message,
          details: skillError.details as JsonObject,
          retryable: skillError.retryable,
        },
        metadata: this.buildMetadata(
          executionId,
          startTime,
          toolsCalled,
          skillsCalled,
        ),
      };
    }
  }

  /**
   * 检查前置条件（子类可覆盖）
   */
  async checkPreconditions(context: SkillContext): Promise<PreconditionResult> {
    const missing: string[] = [];

    // 检查依赖的工具
    if (this.requiredTools && this.toolRegistry) {
      for (const toolId of this.requiredTools) {
        if (!this.toolRegistry.has(toolId)) {
          missing.push(`tool:${toolId}`);
        }
      }
    }

    // 检查依赖的技能
    if (this.requiredSkills && context.availableSkills) {
      for (const skillId of this.requiredSkills) {
        if (!context.availableSkills.includes(skillId)) {
          missing.push(`skill:${skillId}`);
        }
      }
    }

    if (missing.length > 0) {
      return {
        satisfied: false,
        reason: `Missing dependencies: ${missing.join(", ")}`,
        missingDependencies: missing,
      };
    }

    return { satisfied: true };
  }

  /**
   * 获取降级技能（子类可覆盖）
   */
  getFallback?(): ISkill<TInput, TOutput> | null;

  /**
   * 验证输入（子类可覆盖）
   */
  validateInput?(input: TInput): ValidationResult;

  /**
   * 调用工具
   * Pipeline 优先；无 pipeline 时降级到 direct execute（保留单测兼容 + setter 可选注入）
   */
  protected async callTool<T>(
    toolId: string,
    input: unknown,
    context: SkillContext,
  ): Promise<T> {
    if (!this.toolRegistry) {
      throw SkillError.missingTool(this.id, toolId);
    }

    const tool = this.toolRegistry.tryGet(toolId);
    if (!tool) {
      throw SkillError.missingTool(this.id, toolId);
    }

    const toolContext: ToolContext = {
      executionId: context.executionId,
      toolId,
      userId: context.userId,
      sessionId: context.sessionId,
      callerId: this.id,
      callerType: "skill",
      signal: context.signal,
      createdAt: new Date(),
    };

    const result = this.toolPipeline
      ? await this.toolPipeline.execute(tool, input, toolContext)
      : await tool.execute(input, toolContext);

    if (!result.success) {
      throw SkillError.toolCallFailed(
        this.id,
        toolId,
        new Error(result.error?.message ?? "Tool execution failed"),
      );
    }

    return result.data as T;
  }

  /**
   * 调用 LLM
   */
  protected async callLLM(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMCallOptions,
  ): Promise<string> {
    if (!this.llmAdapter) {
      throw SkillError.llmCallFailed(this.id, new Error("LLM adapter not set"));
    }

    try {
      const response = await this.llmAdapter.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        ...options,
      });

      return response.content;
    } catch (error) {
      throw SkillError.llmCallFailed(this.id, error as Error);
    }
  }

  /**
   * 验证数据是否符合 JSON Schema（轻量级）
   * 仅检查 required fields 和 top-level type
   */
  protected validateSchema(
    data: unknown,
    schema: JsonSchema,
  ): ValidationResult {
    if (!schema || !data) {
      return { valid: true };
    }

    const errors: Array<{ path: string; message: string; type: string }> = [];

    // 类型检查
    if (schema.type === "object" && typeof data !== "object") {
      errors.push({
        path: "$",
        message: `Expected object, got ${typeof data}`,
        type: "type",
      });
    } else if (schema.type === "string" && typeof data !== "string") {
      errors.push({
        path: "$",
        message: `Expected string, got ${typeof data}`,
        type: "type",
      });
    } else if (schema.type === "number" && typeof data !== "number") {
      errors.push({
        path: "$",
        message: `Expected number, got ${typeof data}`,
        type: "type",
      });
    } else if (schema.type === "array" && !Array.isArray(data)) {
      errors.push({
        path: "$",
        message: `Expected array, got ${typeof data}`,
        type: "type",
      });
    }

    // required fields 检查
    if (
      schema.type === "object" &&
      schema.required &&
      typeof data === "object" &&
      data !== null
    ) {
      for (const field of schema.required) {
        if (!(field in data)) {
          errors.push({
            path: `$.${field}`,
            message: `Missing required field: ${field}`,
            type: "required",
          });
        }
      }
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  /**
   * 解析 JSON 响应（带容错）
   */
  protected parseJsonResponse<T>(content: string, fallback?: T): T {
    try {
      // 尝试提取 JSON 块
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
      return JSON.parse(jsonStr);
    } catch (error) {
      if (fallback !== undefined) {
        this.logger.warn(`[${this.id}] Failed to parse JSON, using fallback`);
        return fallback;
      }
      throw new Error(
        `Failed to parse JSON response: ${(error as Error).message}`,
      );
    }
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
 * 创建简单技能的工厂函数
 */
export function createSkill<TInput, TOutput>(options: {
  id: string;
  name: string;
  description: string;
  layer: SkillLayer;
  domain: string;
  execute: (input: TInput, context: SkillContext) => Promise<TOutput>;
  requiredTools?: string[];
  requiredSkills?: string[];
  tags?: string[];
}): ISkill<TInput, TOutput> {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    layer: options.layer,
    domain: options.domain,
    requiredTools: options.requiredTools,
    requiredSkills: options.requiredSkills,
    tags: options.tags,

    async execute(
      input: TInput,
      context: SkillContext,
    ): Promise<SkillResult<TOutput>> {
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
        const skillError = SkillError.fromError(error, options.id);
        return {
          success: false,
          error: {
            code: skillError.code,
            message: skillError.message,
            retryable: skillError.retryable,
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

