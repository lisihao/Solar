/**
 * ToolExecSubFacade
 * Handles tool execution, tool listing, and AI capability resolution.
 * Plain TypeScript class — NOT @Injectable. Instantiated by AIFacade.
 */

import { Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import type { ToolFeature } from "../facade.providers";
import type {
  AICapabilityResolver,
  AICapabilityContext,
} from "../../../ai-harness/runner/capabilities/ai-capability-resolver.service";
import type { CapabilitySummary } from "../../../ai-harness/runner/capabilities/types";
import type {
  ChatRequest,
  ChatResponse,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolInfo,
  ToolCategory,
  TaskProfile,
} from "../types";
import type {
  AgentEvent,
  ExecutionConfig,
} from "../../../ai-harness/runner/executor/function-calling-executor";

export class ToolExecSubFacade {
  private readonly logger = new Logger(ToolExecSubFacade.name);

  constructor(
    private readonly tools: ToolFeature | undefined,
    private readonly capabilityResolver: AICapabilityResolver | undefined,
    private readonly chatFn: (req: ChatRequest) => Promise<ChatResponse>,
  ) {}

  async executeTool<T = unknown>(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult<T>> {
    const executionId = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    this.logger.debug(
      `[executeTool] toolId=${request.toolId}, executionId=${executionId}`,
    );

    if (!this.tools?.registry) {
      return {
        success: false,
        error: {
          code: "TOOL_REGISTRY_NOT_AVAILABLE",
          message: "ToolRegistry not available",
          retryable: false,
        },
        metadata: {
          executionId,
          duration: Date.now() - startTime,
        },
      };
    }

    const tool = this.tools.registry.tryGet(request.toolId);
    if (!tool) {
      return {
        success: false,
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Tool "${request.toolId}" not found in registry`,
          retryable: false,
        },
        metadata: {
          executionId,
          duration: Date.now() - startTime,
        },
      };
    }

    if (tool.enabled === false) {
      return {
        success: false,
        error: {
          code: "TOOL_DISABLED",
          message: `Tool "${request.toolId}" is disabled`,
          retryable: false,
        },
        metadata: {
          executionId,
          duration: Date.now() - startTime,
        },
      };
    }

    const toolContext = {
      executionId,
      toolId: request.toolId,
      userId: request.context?.userId,
      sessionId: request.context?.sessionId,
      workspaceId: request.context?.workspaceId,
      timeout: request.timeout || tool.defaultTimeout || 30000,
      createdAt: new Date(),
    };

    try {
      const result = await tool.execute(request.input, toolContext);
      const duration = Date.now() - startTime;

      return {
        success: result.success,
        data: result.data as T,
        error: result.error
          ? {
              code: result.error.code,
              message: result.error.message,
              retryable: result.error.retryable,
            }
          : undefined,
        metadata: {
          executionId,
          duration,
          tokensUsed: result.metadata.tokensUsed,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[executeTool] Tool ${request.toolId} failed after ${duration}ms: ${errorMsg}`,
      );

      return {
        success: false,
        error: {
          code: "TOOL_EXECUTION_ERROR",
          message: errorMsg,
          retryable: true,
        },
        metadata: {
          executionId,
          duration,
        },
      };
    }
  }

  getAvailableTools(category?: ToolCategory): ToolInfo[] {
    if (!this.tools?.registry) {
      return [];
    }

    const tools = category
      ? this.tools.registry.getByCategory(category)
      : this.tools.registry.getEnabled();

    return tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      enabled: tool.enabled !== false,
      tags: tool.tags,
    }));
  }

  isToolAvailable(toolId: string): boolean {
    if (!this.tools?.registry) {
      return false;
    }
    return this.tools.registry.isAvailable(toolId);
  }

  getToolFunctionDefinitions(toolIds?: string[]): Array<{
    name: string;
    description: string;
    parameters: object;
  }> {
    if (!this.tools?.registry) {
      return [];
    }

    const definitions = toolIds
      ? this.tools.registry.getFunctionDefinitions(toolIds)
      : this.tools.registry.getAllFunctionDefinitions();

    return definitions;
  }

  async getAvailableCapabilities(
    context: AICapabilityContext,
  ): Promise<CapabilitySummary> {
    if (!this.capabilityResolver) {
      this.logger.warn(
        "[getAvailableCapabilities] AICapabilityResolver not available",
      );
      return { tools: [], skills: [], mcpTools: [] };
    }

    this.logger.debug(
      `[getAvailableCapabilities] Resolving capabilities for context: ${JSON.stringify(context)}`,
    );

    const { tools, skills, mcpTools } =
      await this.capabilityResolver.resolveAllCapabilities(context);

    const toolSummaries = tools.map((toolId) => {
      const tool = this.tools?.registry?.tryGet(toolId);
      return {
        id: toolId,
        name: tool?.name || toolId,
        description: tool?.description || "",
        category: tool?.category || ("information" as const),
        enabled: tool?.enabled !== false,
        functionDefinition: tool?.toFunctionDefinition() || {
          name: toolId,
          description: "",
          parameters: { type: "object", properties: {} },
        },
      };
    });

    const skillSummaries = skills.map((skillId) => ({
      id: skillId,
      name: skillId,
      description: "",
      domain: "common",
      layer: "domain" as const,
      enabled: true,
    }));

    const mcpToolSummaries = mcpTools.map((mcp) => ({
      serverId: mcp.serverId,
      toolName: mcp.toolName,
      description: mcp.description,
    }));

    this.logger.log(
      `[getAvailableCapabilities] Found ${toolSummaries.length} tools, ${skillSummaries.length} skills, ${mcpToolSummaries.length} MCP tools`,
    );

    return {
      tools: toolSummaries,
      skills: skillSummaries,
      mcpTools: mcpToolSummaries,
    };
  }

  async chatWithTools(request: {
    messages: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string;
      toolCallId?: string;
    }>;
    context: AICapabilityContext;
    modelType?: AIModelType;
    model?: string;
    taskProfile?: TaskProfile;
    maxIterations?: number;
    maxToolCalls?: number;
  }): Promise<{
    content: string;
    model: string;
    tokensUsed: number;
    toolCalls: Array<{
      toolId: string;
      input: unknown;
      output: unknown;
      success: boolean;
      duration: number;
    }>;
    isError?: boolean;
  }> {
    this.logger.log(
      `[chatWithTools] Starting with context: ${JSON.stringify(request.context)}`,
    );

    if (!this.capabilityResolver || !this.tools?.executor) {
      this.logger.warn(
        "[chatWithTools] AICapabilityResolver or FunctionCallingExecutor not available",
      );
      const result = await this.chatFn({
        messages: request.messages,
        modelType: request.modelType,
        model: request.model,
        taskProfile: request.taskProfile,
      });

      return {
        content: result.content,
        model: result.model,
        tokensUsed: result.tokensUsed,
        toolCalls: [],
        isError: result.isError,
      };
    }

    this.logger.warn(
      "[chatWithTools] Full implementation requires LLMAdapter - returning placeholder",
    );

    const result = await this.chatFn({
      messages: request.messages,
      modelType: request.modelType,
      model: request.model,
      taskProfile: request.taskProfile,
    });

    return {
      content: result.content,
      model: result.model,
      tokensUsed: result.tokensUsed,
      toolCalls: [],
      isError: result.isError,
    };
  }

  async *chatWithToolsStream(request: {
    systemPrompt: string;
    userPrompt: string;
    context: AICapabilityContext;
    modelConfig: {
      provider: string;
      modelId: string;
      apiKey?: string;
      apiEndpoint?: string;
    };
    executionConfig?: Partial<ExecutionConfig>;
  }): AsyncGenerator<AgentEvent> {
    if (!this.tools?.executor || !this.tools?.llmAdapter) {
      yield {
        type: "error",
        error: "Tool execution not available",
      } as AgentEvent;
      return;
    }

    this.tools.llmAdapter.setConfig({
      provider: request.modelConfig.provider,
      modelId: request.modelConfig.modelId,
      apiKey: request.modelConfig.apiKey,
      apiEndpoint: request.modelConfig.apiEndpoint,
      // 2026-05-21 BYOK：透传 context.userId，否则 FunctionCallingLLMAdapter
      // .resolveApiKeyForProvider 拿不到 userId → 不走 KeyResolver →
      // NoAvailableKeyError("xai")（"No API Key available for provider"）。
      // 对话整理等 caller 故意传 apiKey=undefined，期望此处按 BYOK 解析用户的 key。
      userId: request.context.userId,
    });

    yield* this.tools.executor.executeWithContext(
      this.tools.llmAdapter,
      request.systemPrompt,
      request.userPrompt,
      request.context,
      request.executionConfig,
    );
  }

  isToolExecutionAvailable(): boolean {
    return !!(this.tools?.executor && this.tools?.llmAdapter);
  }
}
