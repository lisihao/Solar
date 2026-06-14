/**
 * MCP 客户端服务
 *
 * 管理 MCP Server 连接和工具调用
 * ★ 已重构为 MCPManager 的轻量级适配器
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { execSync } from "child_process";
import { MCPToolResult } from "../mission/types/platform.types";
import { MCP_SERVER_CONFIGS } from "../runtime/platforms.config";
import { ToolFacade } from "@/modules/ai-harness/facade";
import type {
  MCPServerConfig as UnifiedMCPServerConfig,
  MCPToolResult as UnifiedMCPToolResult,
} from "@/modules/ai-harness/facade";

/**
 * ★ Social Module MCP Client Service (Refactored)
 * 现在是 MCPManager 的轻量级适配器，保持向后兼容的 API
 */
@Injectable()
export class MCPClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MCPClientService.name);
  private readonly startingServers = new Set<string>();

  constructor(private readonly toolFacade: ToolFacade) {}

  /**
   * 转换 Social 模块的 MCPServerConfig 到统一的 MCPServerConfig
   */
  private convertConfig(
    socialConfig: (typeof MCP_SERVER_CONFIGS)[number],
  ): UnifiedMCPServerConfig {
    return {
      id: socialConfig.id,
      name: socialConfig.name,
      transport: socialConfig.transport || "stdio",
      command: socialConfig.command,
      args: socialConfig.args,
      env: socialConfig.env,
      url: socialConfig.url,
      autoReconnect:
        socialConfig.autoReconnect ?? socialConfig.restartOnFailure ?? true,
      timeout: socialConfig.timeout ?? 30000,
    };
  }

  /**
   * 转换 MCPManager 的 MCPToolResult 到 Social 模块的格式
   */
  private convertToolResult(result: UnifiedMCPToolResult): MCPToolResult {
    if (result.isError) {
      const errorText =
        result.content.find((c) => c.type === "text")?.text ??
        "Unknown MCP error";
      return {
        success: false,
        error: errorText,
      };
    }

    // 提取文本内容或返回完整内容数组
    const textContent = result.content.find((c) => c.type === "text");
    if (textContent?.text) {
      try {
        // 尝试解析 JSON
        const data: unknown = JSON.parse(textContent.text);
        return { success: true, data };
      } catch {
        // 如果不是 JSON，返回原始文本
        return { success: true, data: { text: textContent.text } };
      }
    }

    // 返回完整内容
    return {
      success: true,
      data: result.content,
    };
  }

  /**
   * 检查命令是否存在于 PATH 中
   */
  private isCommandAvailable(command: string): boolean {
    try {
      const cmd =
        process.platform === "win32" ? `where ${command}` : `which ${command}`;
      execSync(cmd, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async onModuleInit(): Promise<void> {
    this.logger.log("Initializing Social MCP Client (via MCPManager)");

    // 注册所有 Social 模块的 MCP 服务器到统一的 MCPManager
    let registered = 0;
    for (const config of MCP_SERVER_CONFIGS) {
      // stdio transport: 跳过命令不存在的服务器（如 Railway 环境无 python3）
      if (
        config.transport === "stdio" &&
        config.command &&
        !this.isCommandAvailable(config.command)
      ) {
        this.logger.warn(
          `Skipping MCP server ${config.id}: command '${config.command}' not found`,
        );
        continue;
      }

      try {
        const unifiedConfig = this.convertConfig(config);
        await this.toolFacade.mcpManager?.registerOrUpdateServer(unifiedConfig);
        this.logger.log(`Registered MCP server: ${config.name} (${config.id})`);
        registered++;
      } catch (error) {
        this.logger.error(
          `Failed to register MCP server ${config.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // 连接所有服务器
    if (registered > 0) {
      try {
        await this.toolFacade.mcpManager?.connectAll();
      } catch (error) {
        this.logger.error(
          `Failed to connect MCP servers: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log("Shutting down Social MCP Client");
    for (const config of MCP_SERVER_CONFIGS) {
      try {
        await this.toolFacade.mcpManager?.disconnect(config.id);
      } catch (error) {
        this.logger.warn(
          `Failed to disconnect ${config.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * 启动 MCP 服务器
   * ★ 现在委托给 MCPManager
   */
  async startServer(serverId: string): Promise<boolean> {
    try {
      await this.toolFacade.mcpManager?.connect(serverId);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to start MCP server ${serverId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * 停止 MCP 服务器
   * ★ 现在委托给 MCPManager
   */
  async stopServer(serverId: string): Promise<void> {
    try {
      await this.toolFacade.mcpManager?.disconnect(serverId);
    } catch (error) {
      this.logger.error(
        `Failed to stop MCP server ${serverId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 调用 MCP 工具
   * ★ 现在委托给 MCPManager，自动处理连接和格式转换
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    try {
      const mgr = this.toolFacade.mcpManager;
      if (!mgr) {
        return {
          success: false,
          error: `MCP manager not available`,
        };
      }

      // 检查客户端是否存在
      let client = mgr.getClient(serverId);
      if (!client) {
        // 防止并发启动同一服务器
        if (this.startingServers.has(serverId)) {
          return {
            success: false,
            error: `Server ${serverId} is starting, please retry later`,
          };
        }

        this.startingServers.add(serverId);
        try {
          const started = await this.startServer(serverId);
          if (!started) {
            return {
              success: false,
              error: `Server ${serverId} not found or failed to start`,
            };
          }
          // Re-fetch after start
          client = mgr.getClient(serverId);
          if (!client) {
            return {
              success: false,
              error: `Server ${serverId} started but client not available`,
            };
          }
        } finally {
          this.startingServers.delete(serverId);
        }
      }

      // 如果未连接，尝试连接
      if (!client.connected) {
        await mgr.connect(serverId);
      }

      // 调用工具
      const result = await mgr.callTool(serverId, toolName, args);

      // 转换为 Social 模块格式
      return this.convertToolResult(result);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 列出可用工具
   * ★ 现在委托给 MCPManager
   */
  async listTools(serverId: string): Promise<unknown[]> {
    try {
      const mgr = this.toolFacade.mcpManager;
      if (!mgr) {
        throw new Error(`MCP manager not available`);
      }

      let client = mgr.getClient(serverId);
      if (!client) {
        throw new Error(`Server ${serverId} not found`);
      }

      if (!client.connected) {
        await mgr.connect(serverId);
        client = mgr.getClient(serverId);
        if (!client) {
          throw new Error(`Failed to reconnect to ${serverId}`);
        }
      }

      const tools = await client.listTools();
      return tools;
    } catch (error) {
      this.logger.error(
        `Failed to list tools from ${serverId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 获取服务器状态
   * ★ 现在从 MCPManager 获取状态
   */
  getServerStatus(serverId: string): {
    status: string;
    lastError?: string;
  } | null {
    const client = this.toolFacade.mcpManager?.getClient(serverId);
    if (!client) return null;

    return {
      status: client.connected ? "running" : "stopped",
      lastError: undefined,
    };
  }

  /**
   * 获取所有服务器状态
   * ★ 现在从 MCPManager 获取状态
   */
  getAllServerStatus(): Array<{
    id: string;
    name: string;
    status: string;
    lastError?: string;
  }> {
    const mgr = this.toolFacade.mcpManager;
    const configs = mgr?.getServerConfigs() ?? [];
    return configs.map((config) => {
      const client = mgr?.getClient(config.id);
      return {
        id: config.id,
        name: config.name,
        status: client?.connected ? "running" : "stopped",
        lastError: undefined,
      };
    });
  }

  /**
   * 检查服务器是否可用
   * ★ 现在从 MCPManager 检查连接状态
   */
  isServerAvailable(serverId: string): boolean {
    const client = this.toolFacade.mcpManager?.getClient(serverId);
    return client?.connected ?? false;
  }
}
