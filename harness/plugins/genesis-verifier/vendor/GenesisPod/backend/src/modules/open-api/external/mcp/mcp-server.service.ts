/**
 * MCP Server - Core Service
 *
 * 处理 JSON-RPC 2.0 请求路由和 MCP 协议逻辑。
 * 支持完整 MCP 协议: Tools + Resources + Prompts。
 *
 * 工具来源:
 * 1. Curated Handlers (精选工具) - 手写的高级 Tool Handler
 * 2. Dynamic Bridge (动态桥接) - 从 Registry 自动生成的 Tool/Skill/Agent
 */

import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  JsonRpcRequest,
  JsonRpcResponse,
  ExposedTool,
  IMCPToolHandler,
  MCPRequestContext,
  MCPToolResponse,
  JSON_RPC_ERRORS,
} from "./abstractions/mcp-server.interface";
import { GuardrailsPipelineService } from "../../../ai-engine/facade";
import {
  AiObservabilityService,
  CostAttributionService,
} from "../../../ai-harness/facade";
import { MCPToolBridgeService } from "./bridge/mcp-tool-bridge.service";
import { MCPResourceProvider } from "./bridge/mcp-resource-provider";
import { MCPPromptProvider } from "./bridge/mcp-prompt-provider";
import { MCPSessionManager } from "./gateway/mcp-session-manager";

interface ToolCallMetric {
  toolName: string;
  success: boolean;
  duration: number;
  apiKeyId: string;
  timestamp: Date;
  errorType?: string;
  source?: string;
}

@Injectable()
export class MCPServerService implements OnModuleInit {
  private readonly logger = new Logger(MCPServerService.name);
  private readonly guardrailsEnabled: boolean;
  private readonly guardrailsFailClosed: boolean;
  private readonly toolHandlers = new Map<string, IMCPToolHandler>();
  private readonly metrics: (ToolCallMetric | null)[] = [];
  private readonly MAX_METRICS = 10000;
  private metricsWriteIdx = 0;
  private metricsCount = 0;
  private startedAt: Date = new Date();

  constructor(
    private readonly sessionManager: MCPSessionManager,
    @Optional() private readonly toolBridge?: MCPToolBridgeService,
    @Optional() private readonly resourceProvider?: MCPResourceProvider,
    @Optional() private readonly promptProvider?: MCPPromptProvider,
    @Optional() private readonly guardrailsPipeline?: GuardrailsPipelineService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly observability?: AiObservabilityService,
    @Optional() private readonly costAttribution?: CostAttributionService,
  ) {
    this.guardrailsEnabled =
      this.configService?.get<string>("GUARDRAILS_ENABLED") !== "false";
    this.guardrailsFailClosed =
      this.configService?.get<string>("GUARDRAILS_FAIL_CLOSED") === "true";
    if (this.guardrailsEnabled && this.guardrailsPipeline) {
      this.logger.log("MCP Server guardrails enabled");
    }
  }

  onModuleInit() {
    this.startedAt = new Date();

    // 触发 Bridge 初始发现
    if (this.toolBridge) {
      const bridgedTools = this.toolBridge.listBridgedTools();
      this.logger.log(
        `Bridge initialized with ${bridgedTools.length} dynamic tools`,
      );
    }

    this.logger.log(
      `MCP Server initialized: ` +
        `${this.toolHandlers.size} curated tools, ` +
        `bridge ${this.toolBridge ? "enabled" : "disabled"}, ` +
        `resources ${this.resourceProvider ? "enabled" : "disabled"}, ` +
        `prompts ${this.promptProvider ? "enabled" : "disabled"}`,
    );
  }

  // =========================================================================
  // Tool Handler Registration (Curated)
  // =========================================================================

  registerToolHandler(handler: IMCPToolHandler): void {
    this.toolHandlers.set(handler.toolName, handler);
    this.logger.log(`Registered curated MCP tool: ${handler.toolName}`);
  }

  // =========================================================================
  // JSON-RPC Request Handling
  // =========================================================================

  async handleRequest(
    body: unknown,
    context: MCPRequestContext,
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(body)) {
      const responses = await Promise.all(
        body.map((req) =>
          req && typeof req === "object"
            ? this.processSingleRequest(req, { ...context })
            : Promise.resolve(
                this.errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST),
              ),
        ),
      );
      const filtered = responses.filter(
        (r): r is JsonRpcResponse => r !== null,
      );
      return filtered.length > 0 ? filtered : null;
    }
    return this.processSingleRequest(body, context);
  }

  private async processSingleRequest(
    body: unknown,
    context: MCPRequestContext,
  ): Promise<JsonRpcResponse | null> {
    if (!body || typeof body !== "object") {
      return this.errorResponse(null, JSON_RPC_ERRORS.INVALID_REQUEST);
    }

    const request = body as JsonRpcRequest;
    if (request.jsonrpc !== "2.0" || !request.method) {
      return this.errorResponse(
        request.id ?? null,
        JSON_RPC_ERRORS.INVALID_REQUEST,
      );
    }

    const isNotification = request.id === undefined;

    try {
      const result = await this.dispatch(request, context);
      if (isNotification) return null;
      return { jsonrpc: "2.0", id: request.id, result };
    } catch (error) {
      if (isNotification) return null;
      const errObj = error as Record<string, unknown>;
      const code =
        (errObj.code as number) || JSON_RPC_ERRORS.INTERNAL_ERROR.code;
      // 仅暴露已知错误码的消息，内部错误只返回通用文本
      const safeMessage = errObj.code
        ? (error as Error).message
        : "Internal server error";
      return this.errorResponse(request.id!, { code, message: safeMessage });
    }
  }

  // =========================================================================
  // Method Dispatch - 完整 MCP 协议路由
  // =========================================================================

  private async dispatch(
    request: JsonRpcRequest,
    context: MCPRequestContext,
  ): Promise<unknown> {
    switch (request.method) {
      // --- Lifecycle ---
      case "initialize":
        return this.handleInitialize(request.params, context);
      case "notifications/initialized":
        return undefined;
      case "ping":
        return {};

      // --- Tools (MCP Primitive #1) ---
      case "tools/list":
        return this.handleToolsList(context);
      case "tools/call":
        return this.handleToolsCall(request.params, context);

      // --- Resources (MCP Primitive #2) ---
      case "resources/list":
        return this.handleResourcesList(context);
      case "resources/read":
        return this.handleResourcesRead(request.params, context);

      // --- Prompts (MCP Primitive #3) ---
      case "prompts/list":
        return this.handlePromptsList(context);
      case "prompts/get":
        return this.handlePromptsGet(request.params, context);

      default: {
        const error: Error & { code?: number } = new Error(
          `Method not found: ${request.method}`,
        );
        error.code = JSON_RPC_ERRORS.METHOD_NOT_FOUND.code;
        throw error;
      }
    }
  }

  // =========================================================================
  // Initialize - Enhanced with Session Manager
  // =========================================================================

  private handleInitialize(
    params: Record<string, unknown> | undefined,
    context: MCPRequestContext,
  ): Record<string, unknown> {
    const clientInfo = params?.clientInfo as
      | { name: string; version: string }
      | undefined;

    const session = this.sessionManager.createSession(
      context.apiKeyId,
      clientInfo,
    );
    // Note: sessionId is returned in the response, not mutated on context
    // to avoid session leakage between requests sharing a context object

    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: {
        name: "genesis-ai",
        version: "2.0.0",
        sessionId: session.sessionId,
      },
    };
  }

  // =========================================================================
  // Tools - Curated + Dynamic Bridge
  // =========================================================================

  private handleToolsList(_context: MCPRequestContext): {
    tools: ExposedTool[];
  } {
    const tools: ExposedTool[] = [];

    // 1. Curated handlers（高优先级，精选工具）
    for (const handler of this.toolHandlers.values()) {
      tools.push({
        name: handler.toolName,
        description: handler.description,
        inputSchema: handler.inputSchema,
      });
    }

    // 2. Dynamic bridge tools（从 Registry 自动发现）
    if (this.toolBridge) {
      const bridgedTools = this.toolBridge.listBridgedTools();
      for (const bt of bridgedTools) {
        // 避免重复: 如果 curated handler 已覆盖同名工具，跳过
        if (!tools.some((t) => t.name === bt.name)) {
          tools.push({
            name: bt.name,
            description: bt.description,
            inputSchema: bt.inputSchema,
          });
        }
      }
    }

    return { tools };
  }

  private async handleToolsCall(
    params: Record<string, unknown> | undefined,
    context: MCPRequestContext,
  ): Promise<unknown> {
    if (!params?.name || typeof params.name !== "string") {
      const error = new Error("Missing required parameter: name");
      (error as unknown as Record<string, unknown>).code =
        JSON_RPC_ERRORS.INVALID_PARAMS.code;
      throw error;
    }

    const toolName = params.name;
    // M3 fix：let（非 const）—— PII redact-not-block 时下面会替换成脱敏后的 args。
    let args = (params.arguments as Record<string, unknown>) || {};

    // 原子性权限 + 配额检查（避免检查与消耗之间的竞态条件）
    const validation = this.sessionManager.validateAndConsumeQuota(
      context.apiKeyId,
      context.sessionId,
      toolName,
    );
    if (!validation.allowed) {
      const messages: Record<string, string> = {
        permission_denied: "Permission denied for this tool",
        session_expired: "Session expired or terminated",
        quota_exceeded: "Daily quota exceeded",
      };
      return {
        content: [
          {
            type: "text",
            text: messages[validation.reason!] || "Access denied",
          },
        ],
        isError: true,
      };
    }

    // Guardrails 输入验证
    if (this.guardrailsEnabled && this.guardrailsPipeline) {
      try {
        const inputCheck = await this.guardrailsPipeline.processInput({
          content: JSON.stringify(args),
          context: { toolName, sessionId: context.sessionId },
        });
        if (!inputCheck.passed) {
          this.logger.warn(
            `MCP tool call blocked by input guardrail: ${inputCheck.blockedBy}`,
          );
          return {
            content: [
              { type: "text", text: "Request blocked by security policy" },
            ],
            isError: true,
          };
        }
        // M3 fix：PII redact-not-block → 用脱敏后的 args（transformedContent 是
        // JSON.stringify(args) 的脱敏版）。解析失败（脱敏破坏 JSON，罕见）则保留原
        // args 不阻断。之前只看 passed，把**未脱敏的工具参数**直接发给模型/工具。
        if (typeof inputCheck.transformedContent === "string") {
          try {
            args =
              (JSON.parse(inputCheck.transformedContent) as Record<
                string,
                unknown
              >) || args;
          } catch {
            /* 保留原 args */
          }
        }
      } catch (guardrailError) {
        this.logger.error(
          `MCP input guardrail error: ${(guardrailError as Error).message}`,
        );
        if (this.guardrailsFailClosed) {
          return {
            content: [
              { type: "text", text: "Security validation unavailable" },
            ],
            isError: true,
          };
        }
      }
    }

    const startTime = Date.now();
    let result: MCPToolResponse;
    let source = "curated";

    try {
      // 路由: 先查 curated handler，再查 bridge
      const handler = this.toolHandlers.get(toolName);
      if (handler) {
        result = await handler.execute(args, context);
        source = "curated";
      } else if (this.toolBridge?.isBridgedTool(toolName)) {
        result = await this.toolBridge.executeBridgedTool(
          toolName,
          args,
          context,
        );
        source =
          this.toolBridge.getBridgedToolMeta(toolName)?.source ?? "bridge";
      } else {
        const error = new Error(`Unknown tool: ${toolName}`);
        (error as unknown as Record<string, unknown>).code =
          JSON_RPC_ERRORS.METHOD_NOT_FOUND.code;
        throw error;
      }

      this.recordMetric({
        toolName,
        success: !result.isError,
        duration: Date.now() - startTime,
        apiKeyId: context.apiKeyId || "unknown",
        timestamp: new Date(),
        source,
      });

      // Guardrails 输出验证
      if (
        this.guardrailsEnabled &&
        this.guardrailsPipeline &&
        !result.isError
      ) {
        try {
          const outputCheck = await this.guardrailsPipeline.processOutput({
            content: JSON.stringify(result),
            context: { toolName, sessionId: context.sessionId },
          });
          if (!outputCheck.passed) {
            this.logger.warn(
              `MCP tool output blocked by guardrail: ${outputCheck.blockedBy}`,
            );
            return {
              content: [
                { type: "text", text: "Response blocked by security policy" },
              ],
              isError: true,
            };
          }
        } catch (guardrailError) {
          this.logger.error(
            `MCP output guardrail error: ${(guardrailError as Error).message}`,
          );
          if (this.guardrailsFailClosed) {
            return {
              content: [
                { type: "text", text: "Security validation unavailable" },
              ],
              isError: true,
            };
          }
        }
      }

      return result;
    } catch (error) {
      this.recordMetric({
        toolName,
        success: false,
        duration: Date.now() - startTime,
        apiKeyId: context.apiKeyId || "unknown",
        timestamp: new Date(),
        errorType: (error as Error).name || "UnknownError",
        source,
      });

      if ((error as Record<string, unknown>).code) {
        throw error;
      }

      this.logger.error(`Tool ${toolName} failed: ${(error as Error).message}`);
      return {
        content: [{ type: "text", text: "Tool execution failed" }],
        isError: true,
      };
    }
  }

  // =========================================================================
  // Resources - MCP Primitive #2
  // =========================================================================

  private async handleResourcesList(
    context: MCPRequestContext,
  ): Promise<{ resources: unknown[] }> {
    if (!this.resourceProvider) {
      return { resources: [] };
    }

    if (
      context.sessionId &&
      !this.sessionManager.isResourceAllowed(context.sessionId)
    ) {
      return { resources: [] };
    }

    const resources = await this.resourceProvider.listResources();
    return { resources };
  }

  private async handleResourcesRead(
    params: Record<string, unknown> | undefined,
    context: MCPRequestContext,
  ): Promise<unknown> {
    if (!params?.uri || typeof params.uri !== "string") {
      const error = new Error("Missing required parameter: uri");
      (error as unknown as Record<string, unknown>).code =
        JSON_RPC_ERRORS.INVALID_PARAMS.code;
      throw error;
    }

    if (!this.resourceProvider) {
      const error = new Error("Resources not available");
      (error as unknown as Record<string, unknown>).code =
        JSON_RPC_ERRORS.RESOURCE_NOT_FOUND.code;
      throw error;
    }

    if (
      context.sessionId &&
      !this.sessionManager.isResourceAllowed(context.sessionId)
    ) {
      const error = new Error("Resource access denied");
      (error as unknown as Record<string, unknown>).code =
        JSON_RPC_ERRORS.PERMISSION_DENIED.code;
      throw error;
    }

    const content = await this.resourceProvider.readResource(params.uri);
    return { contents: [content] };
  }

  // =========================================================================
  // Prompts - MCP Primitive #3
  // =========================================================================

  private async handlePromptsList(
    context: MCPRequestContext,
  ): Promise<{ prompts: unknown[] }> {
    if (!this.promptProvider) {
      return { prompts: [] };
    }

    if (
      context.sessionId &&
      !this.sessionManager.isPromptAllowed(context.sessionId)
    ) {
      return { prompts: [] };
    }

    const prompts = await this.promptProvider.listPrompts();
    return { prompts };
  }

  private async handlePromptsGet(
    params: Record<string, unknown> | undefined,
    context: MCPRequestContext,
  ): Promise<unknown> {
    if (!params?.name || typeof params.name !== "string") {
      const error = new Error("Missing required parameter: name");
      (error as unknown as Record<string, unknown>).code =
        JSON_RPC_ERRORS.INVALID_PARAMS.code;
      throw error;
    }

    if (!this.promptProvider) {
      const error = new Error("Prompts not available");
      (error as unknown as Record<string, unknown>).code =
        JSON_RPC_ERRORS.RESOURCE_NOT_FOUND.code;
      throw error;
    }

    if (
      context.sessionId &&
      !this.sessionManager.isPromptAllowed(context.sessionId)
    ) {
      const error = new Error("Prompt access denied");
      (error as unknown as Record<string, unknown>).code =
        JSON_RPC_ERRORS.PERMISSION_DENIED.code;
      throw error;
    }

    const args = params.arguments as Record<string, string> | undefined;
    const messages = await this.promptProvider.getPrompt(params.name, args);
    return { messages };
  }

  // =========================================================================
  // Admin & Status APIs
  // =========================================================================

  getStatus(): {
    toolCount: number;
    tools: string[];
    activeSessions: number;
  } {
    return {
      toolCount: this.toolHandlers.size,
      tools: Array.from(this.toolHandlers.keys()),
      activeSessions: this.sessionManager.getStats().activeSessions,
    };
  }

  getDetailedStatus(): {
    status: "healthy" | "degraded" | "unhealthy";
    uptime: number;
    toolCount: number;
    curatedToolCount: number;
    bridgedToolCount: number;
    totalToolCount: number;
    tools: Array<{ name: string; description: string; source: string }>;
    activeSessions: number;
    capabilities: {
      tools: boolean;
      resources: boolean;
      prompts: boolean;
      streaming: boolean;
    };
    metrics24h: {
      totalCalls: number;
      successRate: number;
      avgDuration: number;
    };
  } {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const metrics24h = this.getMetrics({ startDate: oneDayAgo });

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (metrics24h.successRate < 95) status = "degraded";
    if (metrics24h.successRate < 80) status = "unhealthy";

    const tools: Array<{ name: string; description: string; source: string }> =
      [];

    for (const handler of this.toolHandlers.values()) {
      tools.push({
        name: handler.toolName,
        description: handler.description,
        source: "curated",
      });
    }

    const bridgeStats = this.toolBridge?.getStats();
    const bridgedCount = bridgeStats?.total ?? 0;

    if (this.toolBridge) {
      for (const bt of this.toolBridge.listBridgedTools()) {
        if (!tools.some((t) => t.name === bt.name)) {
          tools.push({
            name: bt.name,
            description: bt.description,
            source: bt.source,
          });
        }
      }
    }

    return {
      status,
      uptime: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      toolCount: tools.length,
      curatedToolCount: this.toolHandlers.size,
      bridgedToolCount: bridgedCount,
      totalToolCount: tools.length,
      tools,
      activeSessions: this.sessionManager.getStats().activeSessions,
      capabilities: {
        tools: true,
        resources: !!this.resourceProvider,
        prompts: !!this.promptProvider,
        streaming: true,
      },
      metrics24h: {
        totalCalls: metrics24h.totalCalls,
        successRate: metrics24h.successRate,
        avgDuration: metrics24h.avgDuration,
      },
    };
  }

  getSessions() {
    return this.sessionManager.getAllSessions();
  }

  terminateSession(sessionId: string): boolean {
    return this.sessionManager.terminateSession(sessionId);
  }

  // =========================================================================
  // Metrics
  // =========================================================================

  private recordMetric(metric: ToolCallMetric): void {
    // Circular buffer: O(1) write, no splice/shift needed
    this.metrics[this.metricsWriteIdx] = metric;
    this.metricsWriteIdx = (this.metricsWriteIdx + 1) % this.MAX_METRICS;
    if (this.metricsCount < this.MAX_METRICS) {
      this.metricsCount++;
    }

    // Forward to AI Engine observability (unified LLM call tracking)
    if (this.observability) {
      this.observability.recordLLMCall({
        model: "mcp-tool",
        provider: "mcp-server",
        modelType: "TOOL_EXECUTION",
        module: "mcp-server",
        operation: metric.toolName,
        userId: metric.apiKeyId,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: metric.duration,
        estimatedCost: 0,
        success: metric.success,
        error: metric.errorType,
        fallbackUsed: false,
        retryCount: 0,
      });
    }

    // Forward to cost attribution
    if (this.costAttribution) {
      this.costAttribution.recordCost({
        userId: metric.apiKeyId || "mcp-anonymous",
        moduleType: "mcp-server",
        model: `mcp:${metric.toolName}`,
        provider: "mcp-server",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        timestamp: metric.timestamp,
      });
    }
  }

  getMetrics(options?: {
    startDate?: Date;
    endDate?: Date;
    toolName?: string;
  }): {
    totalCalls: number;
    successCount: number;
    errorCount: number;
    successRate: number;
    avgDuration: number;
    byTool: Record<
      string,
      { calls: number; errors: number; avgDuration: number }
    >;
    byApiKey: Record<string, { calls: number; lastUsed: Date }>;
    bySource: Record<string, number>;
    recentErrors: Array<{
      toolName: string;
      errorType: string;
      timestamp: Date;
    }>;
  } {
    // Read from circular buffer into a flat array
    const allMetrics: ToolCallMetric[] = [];
    for (let i = 0; i < this.metricsCount; i++) {
      const idx =
        (this.metricsWriteIdx - this.metricsCount + i + this.MAX_METRICS) %
        this.MAX_METRICS;
      const m = this.metrics[idx];
      if (m) allMetrics.push(m);
    }

    let filtered = allMetrics;
    if (options?.startDate) {
      filtered = filtered.filter((m) => m.timestamp >= options.startDate!);
    }
    if (options?.endDate) {
      filtered = filtered.filter((m) => m.timestamp <= options.endDate!);
    }
    if (options?.toolName) {
      filtered = filtered.filter((m) => m.toolName === options.toolName);
    }

    const totalCalls = filtered.length;
    const successCount = filtered.filter((m) => m.success).length;
    const errorCount = totalCalls - successCount;
    const successRate =
      totalCalls > 0 ? (successCount / totalCalls) * 100 : 100;
    const avgDuration =
      totalCalls > 0
        ? filtered.reduce((sum, m) => sum + m.duration, 0) / totalCalls
        : 0;

    const byToolAccum: Record<
      string,
      { calls: number; errors: number; totalDuration: number }
    > = {};
    const byApiKey: Record<string, { calls: number; lastUsed: Date }> = {};
    const bySource: Record<string, number> = {};

    for (const metric of filtered) {
      // By tool
      if (!byToolAccum[metric.toolName]) {
        byToolAccum[metric.toolName] = {
          calls: 0,
          errors: 0,
          totalDuration: 0,
        };
      }
      byToolAccum[metric.toolName].calls++;
      if (!metric.success) byToolAccum[metric.toolName].errors++;
      byToolAccum[metric.toolName].totalDuration += metric.duration;

      // By API key
      if (!byApiKey[metric.apiKeyId]) {
        byApiKey[metric.apiKeyId] = { calls: 0, lastUsed: metric.timestamp };
      }
      byApiKey[metric.apiKeyId].calls++;
      if (metric.timestamp > byApiKey[metric.apiKeyId].lastUsed) {
        byApiKey[metric.apiKeyId].lastUsed = metric.timestamp;
      }

      // By source
      const source = metric.source ?? "curated";
      bySource[source] = (bySource[source] || 0) + 1;
    }

    const byTool: Record<
      string,
      { calls: number; errors: number; avgDuration: number }
    > = {};
    for (const [name, acc] of Object.entries(byToolAccum)) {
      byTool[name] = {
        calls: acc.calls,
        errors: acc.errors,
        avgDuration:
          acc.calls > 0 ? Math.round(acc.totalDuration / acc.calls) : 0,
      };
    }

    const recentErrors = filtered
      .filter((m) => !m.success && m.errorType)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10)
      .map((m) => ({
        toolName: m.toolName,
        errorType: m.errorType!,
        timestamp: m.timestamp,
      }));

    return {
      totalCalls,
      successCount,
      errorCount,
      successRate: Math.round(successRate * 100) / 100,
      avgDuration: Math.round(avgDuration),
      byTool,
      byApiKey,
      bySource,
      recentErrors,
    };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private errorResponse(
    id: string | number | null,
    error: { code: number; message: string },
  ): JsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id: id ?? undefined,
      error,
    };
  }
}
