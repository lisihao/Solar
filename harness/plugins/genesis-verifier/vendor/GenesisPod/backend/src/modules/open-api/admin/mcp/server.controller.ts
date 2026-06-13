/**
 * MCP Server Admin Controller
 * Admin monitoring for the externally-exposed MCP Server
 * Routes: /admin/mcp-server/*
 */

import { Controller, Get, Query, UseGuards, Logger } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { MCPServerService } from "../../external/mcp/mcp-server.service";
import { MCPSessionManager } from "../../external/mcp/gateway/mcp-session-manager";
import { MCPStreamingBridge } from "../../external/mcp/streaming/mcp-streaming-bridge";
import { MCPToolBridgeService } from "../../external/mcp/bridge/mcp-tool-bridge.service";

@ApiTags("Admin - MCP Server")
@Controller("admin/mcp-server")
@UseGuards(JwtAuthGuard, AdminGuard)
export class MCPServerController {
  private readonly logger = new Logger(MCPServerController.name);

  constructor(
    private readonly mcpServerService: MCPServerService,
    private readonly sessionManager: MCPSessionManager,
    private readonly streamingBridge: MCPStreamingBridge,
    private readonly toolBridge: MCPToolBridgeService,
  ) {}

  @Get("status")
  @ApiOperation({ summary: "MCP Server 状态概览" })
  @ApiResponse({ status: 200, description: "返回 MCP Server 完整状态" })
  async getStatus() {
    this.logger.log("Admin: Fetching MCP Server status");
    return this.mcpServerService.getDetailedStatus();
  }

  @Get("metrics")
  @ApiOperation({ summary: "MCP Server 使用指标" })
  @ApiQuery({ name: "startDate", required: false, type: String })
  @ApiQuery({ name: "endDate", required: false, type: String })
  @ApiQuery({ name: "toolName", required: false, type: String })
  @ApiResponse({ status: 200, description: "返回使用指标" })
  async getMetrics(
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("toolName") toolName?: string,
  ) {
    this.logger.log("Admin: Fetching MCP Server metrics");
    return this.mcpServerService.getMetrics({
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      toolName,
    });
  }

  @Get("sessions")
  @ApiOperation({ summary: "活动会话列表" })
  @ApiResponse({ status: 200, description: "返回活动会话" })
  async getSessions() {
    this.logger.log("Admin: Fetching MCP Server sessions");
    const stats = this.sessionManager.getStats();
    const sessions = this.mcpServerService.getSessions();
    return {
      ...stats,
      sessions,
    };
  }

  @Get("tools")
  @ApiOperation({ summary: "已注册工具列表（精选 + 桥接）" })
  @ApiResponse({ status: 200, description: "返回工具详情" })
  async getTools() {
    this.logger.log("Admin: Fetching MCP Server tools");
    const status = this.mcpServerService.getDetailedStatus();
    const bridgeStats = this.toolBridge.getStats();
    return {
      tools: status.tools,
      totalCount: status.totalToolCount,
      curatedCount: status.curatedToolCount,
      bridgedCount: status.bridgedToolCount,
      bridgeBySource: bridgeStats.bySource,
    };
  }

  @Get("streaming")
  @ApiOperation({ summary: "SSE 连接状态" })
  @ApiResponse({ status: 200, description: "返回 SSE 连接详情" })
  async getStreamingStatus() {
    this.logger.log("Admin: Fetching streaming status");
    return this.streamingBridge.getStats();
  }

  @Get("capabilities")
  @ApiOperation({ summary: "MCP 能力总览" })
  @ApiResponse({ status: 200, description: "返回 MCP 协议能力支持情况" })
  async getCapabilities() {
    this.logger.log("Admin: Fetching MCP capabilities");
    const status = this.mcpServerService.getDetailedStatus();
    return {
      protocol: {
        version: "2024-11-05",
        transport: "streamable-http",
      },
      capabilities: status.capabilities,
      tools: {
        curated: status.curatedToolCount,
        bridged: status.bridgedToolCount,
        total: status.totalToolCount,
      },
      health: {
        status: status.status,
        uptime: status.uptime,
        sessions: status.activeSessions,
      },
    };
  }
}
