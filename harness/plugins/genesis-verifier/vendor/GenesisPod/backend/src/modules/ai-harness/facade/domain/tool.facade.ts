/**
 * ToolFacade — Domain Facade for Tool Execution, Discovery, Capabilities, and MCP
 *
 * Responsibilities:
 * - Tool execution (single tool, tool calling with LLM, streaming tool execution)
 * - Tool discovery and function definition schemas
 * - AI capability resolution (tools + skills + MCP)
 * - Module capability listing
 * - MCP manager access
 *
 * @Injectable — registered as a NestJS provider in facade.providers.ts
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ToolExecSubFacade } from "../sub-facades/tool-exec.sub-facade";
import type { ToolFeature, RegistryFeature } from "../facade.providers";
import { TOOL_FEATURE, REGISTRY_FEATURE } from "../facade.providers";
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
// IntentRouter / TaskPlanner 已删 (2026-04-30)
import { MCPManager } from "../../../ai-engine/tools/adapters/mcp/manager/mcp-manager";
import { FunctionCallingLLMAdapter } from "../../../ai-engine/llm/adapters/function-calling-llm.adapter";
import { FunctionCallingExecutor } from "../../../ai-harness/runner/executor/function-calling-executor";
import type {
  SkillPromptBundle,
  SkillPromptOptions,
} from "../../../ai-harness/runner/capabilities/types";
import type { ToolRegistry } from "../../../ai-engine/tools/registry/tool.registry";

@Injectable()
export class ToolFacade {
  private readonly logger = new Logger(ToolFacade.name);

  private readonly toolExecSub: ToolExecSubFacade;

  /**
   * chatFn is injected externally by the God Facade after construction.
   * We store it here so toolExecSub can reference the facade's chat().
   */
  private _chatFn?: (req: ChatRequest) => Promise<ChatResponse>;

  constructor(
    @Optional()
    @Inject(TOOL_FEATURE)
    private readonly tools?: ToolFeature,
    @Optional()
    @Inject(REGISTRY_FEATURE)
    _registry?: RegistryFeature, // reserved for future registry-based tool lookups
    @Optional() private readonly mcpManagerSvc?: MCPManager,
  ) {
    // toolExecSub's chatFn will be a no-op placeholder until setChatFn is called
    this.toolExecSub = new ToolExecSubFacade(
      tools,
      tools?.capabilityResolver,
      (req) => this.delegateChat(req),
    );
  }

  /**
   * Called by AIFacade after construction to wire the chat function.
   * This breaks the circular dependency between ChatFacade and ToolFacade.
   */
  setChatFn(fn: (req: ChatRequest) => Promise<ChatResponse>): void {
    this._chatFn = fn;
  }

  private async delegateChat(req: ChatRequest): Promise<ChatResponse> {
    if (this._chatFn) {
      return this._chatFn(req);
    }
    this.logger.warn(
      "[ToolFacade] chatFn not set yet — returning empty response",
    );
    return { content: "", model: "unknown", tokensUsed: 0, isError: true };
  }

  // ==================== Tool Execution ====================

  async executeTool<T = unknown>(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult<T>> {
    return this.toolExecSub.executeTool<T>(request);
  }

  getAvailableTools(category?: ToolCategory): ToolInfo[] {
    return this.toolExecSub.getAvailableTools(category);
  }

  isToolAvailable(toolId: string): boolean {
    return this.toolExecSub.isToolAvailable(toolId);
  }

  getToolFunctionDefinitions(toolIds?: string[]): Array<{
    name: string;
    description: string;
    parameters: object;
  }> {
    return this.toolExecSub.getToolFunctionDefinitions(toolIds);
  }

  // ==================== Capabilities ====================

  async getAvailableCapabilities(
    context: AICapabilityContext,
  ): Promise<CapabilitySummary> {
    return this.toolExecSub.getAvailableCapabilities(context);
  }

  // listModuleCapabilities 已删 (2026-04-30) — IntentRouter 链路全删

  async capabilityResolveTools(
    context: AICapabilityContext,
  ): Promise<string[]> {
    const resolver = this.tools?.capabilityResolver;
    if (!resolver) {
      // P0 fix (2026-05-05): 之前静默 fallback 到 []，导致 data-source-router
      // 等下游错误地认为"所有工具被 Admin 关掉"。改为显式 warn —— 不抛错（避免回归 ai-app 启动），
      // 但通过 logger 暴露 contract violation。
      this.logger.warn(
        `[capabilityResolveTools] capabilityResolver missing (DI not wired). ` +
          `Returning empty list — caller should fall back to ToolRegistry.getEnabled() directly. ` +
          `context=${JSON.stringify(context)}`,
      );
      return [];
    }
    const result = await resolver.resolveToolsForAgent(context);
    if (!result || result.length === 0) {
      this.logger.debug(
        `[capabilityResolveTools] resolved 0 tools for context=${JSON.stringify(context)}`,
      );
    }
    return result ?? [];
  }

  async capabilityGetSkillPrompts(
    context: AICapabilityContext,
    options?: SkillPromptOptions,
  ): Promise<SkillPromptBundle | null> {
    return (
      (await this.tools?.capabilityResolver?.getSkillPrompts(
        context,
        options,
      )) ?? null
    );
  }

  // ==================== Tool Calling with LLM ====================

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
    return this.toolExecSub.chatWithTools(request);
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
    yield* this.toolExecSub.chatWithToolsStream(request);
  }

  isToolExecutionAvailable(): boolean {
    return this.toolExecSub.isToolExecutionAvailable();
  }

  // ==================== Service Getters ====================

  get toolRegistry(): ToolRegistry | undefined {
    return this.tools?.registry;
  }

  get functionCallingAdapter(): FunctionCallingLLMAdapter | undefined {
    return this.tools?.llmAdapter;
  }

  get functionCallingExecutor(): FunctionCallingExecutor | undefined {
    return this.tools?.executor;
  }

  get capabilityResolverService(): AICapabilityResolver | undefined {
    return this.tools?.capabilityResolver;
  }

  get mcpManager(): MCPManager | undefined {
    return this.mcpManagerSvc;
  }
}
