/**
 * MCP Server Module
 *
 * 将 GenesisPod 暴露为完整 MCP Server，支持:
 * - Tools: 精选工具 (curated) + 动态桥接 (Registry 自动发现)
 * - Resources: 知识库、能力摘要、工具/技能/Agent 列表
 * - Prompts: 可复用提示模板 (研究、分析、辩论、写作)
 * - Streaming: SSE 进度推送 (接入 Engine EventEmitter)
 * - Session: 完整生命周期管理 + 权限策略
 *
 * 让外部 AI 工具（Claude Code、Cursor、OpenClaw 等）调用 GenesisPod 能力
 */

import { Module, OnModuleInit } from "@nestjs/common";
import { MCPServerController } from "./mcp-server.controller";
import { MCPServerService } from "./mcp-server.service";
import { MCPApiKeyGuard } from "./guards/mcp-api-key.guard";

// Curated Tool Handlers
import { ResearchToolHandler } from "./tools/research-tool-handler";
import { AskToolHandler } from "./tools/ask-tool-handler";
import { TeamsDebateToolHandler } from "./tools/teams-tool-handler";
import { ContentAnalysisToolHandler } from "./tools/content-analysis-tool-handler";
import { WritingAssistToolHandler } from "./tools/writing-assist-tool-handler";

// Bridge: Dynamic Tool/Resource/Prompt
import { MCPToolBridgeService } from "./bridge/mcp-tool-bridge.service";
import { MCPResourceProvider } from "./bridge/mcp-resource-provider";
import { MCPPromptProvider } from "./bridge/mcp-prompt-provider";

// Gateway: Session Management
import { MCPSessionManager } from "./gateway/mcp-session-manager";

// Streaming: SSE Progress Bridge
import { MCPStreamingBridge } from "./streaming/mcp-streaming-bridge";

// Dependencies
import { SecretsModule } from "../../../platform/credentials/storage/secrets/secrets.module";
import { AiEngineSafetyModule } from "../../../ai-engine/safety/safety.module";

@Module({
  imports: [
    SecretsModule,
    AiEngineSafetyModule,
    // ★ DiscussionModule removed — research accessed via AIFacade.executeDirectResearch()
  ],
  controllers: [MCPServerController],
  providers: [
    // Core
    MCPServerService,
    MCPApiKeyGuard,

    // Gateway
    MCPSessionManager,

    // Bridge
    MCPToolBridgeService,
    MCPResourceProvider,
    MCPPromptProvider,

    // Streaming
    MCPStreamingBridge,

    // Curated Tool Handlers
    ResearchToolHandler,
    AskToolHandler,
    TeamsDebateToolHandler,
    ContentAnalysisToolHandler,
    WritingAssistToolHandler,
  ],
  exports: [
    MCPServerService,
    MCPSessionManager,
    MCPStreamingBridge,
    MCPToolBridgeService,
  ],
})
export class MCPServerModule implements OnModuleInit {
  constructor(
    private readonly mcpServerService: MCPServerService,
    private readonly researchToolHandler: ResearchToolHandler,
    private readonly askToolHandler: AskToolHandler,
    private readonly teamsDebateToolHandler: TeamsDebateToolHandler,
    private readonly contentAnalysisToolHandler: ContentAnalysisToolHandler,
    private readonly writingAssistToolHandler: WritingAssistToolHandler,
  ) {}

  onModuleInit() {
    // Register curated tool handlers（精选工具，保持向后兼容）
    this.mcpServerService.registerToolHandler(this.researchToolHandler);
    this.mcpServerService.registerToolHandler(this.askToolHandler);
    this.mcpServerService.registerToolHandler(this.teamsDebateToolHandler);
    this.mcpServerService.registerToolHandler(this.contentAnalysisToolHandler);
    this.mcpServerService.registerToolHandler(this.writingAssistToolHandler);

    // Dynamic bridge tools 在 MCPServerService.onModuleInit() 中自动发现
  }
}
