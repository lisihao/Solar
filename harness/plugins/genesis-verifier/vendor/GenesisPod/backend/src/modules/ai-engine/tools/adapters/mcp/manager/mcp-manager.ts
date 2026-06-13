/**
 * AI Engine - MCP Manager
 * MCP 管理器实现
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  IMCPManager,
  IMCPClient,
  MCPServerConfig,
  MCPTool,
  MCPToolResult,
  MCPEvent,
  MCPEventType,
} from "../abstractions/mcp.interface";
import { createMCPClient } from "../client/mcp-client-factory";
import { LruMap } from "@/common/utils/lru-map";

/**
 * MCP 管理器
 * 管理多个 MCP 服务器连接
 */
@Injectable()
export class MCPManager implements IMCPManager {
  private readonly logger = new Logger(MCPManager.name);
  private readonly configs = new Map<string, MCPServerConfig>();
  private readonly clients = new LruMap<string, IMCPClient>(50);
  private readonly eventHandlers = new Set<(event: MCPEvent) => void>();

  /**
   * 注册服务器
   */
  registerServer(config: MCPServerConfig): void {
    // Validate required fields
    if (!config.id || !config.name || !config.transport) {
      this.logger.warn(
        `[registerServer] Invalid config: missing required fields (id=${config.id}, name=${config.name}, transport=${config.transport})`,
      );
      return;
    }

    if (this.configs.has(config.id)) {
      throw new Error(`Server ${config.id} already registered`);
    }

    this.configs.set(config.id, config);
    this.logger.log(`Registered MCP server: ${config.name} (${config.id})`);
  }

  /**
   * 更新服务器配置
   * 如果服务器已连接，会先断开连接，更新配置后需要重新连接
   */
  async updateServerConfig(config: MCPServerConfig): Promise<void> {
    const existingClient = this.clients.get(config.id);

    // 如果有现有连接，先断开
    if (existingClient?.connected) {
      await existingClient.disconnect();
      this.clients.delete(config.id);
    }

    // 更新配置
    this.configs.set(config.id, config);
    this.logger.log(`Updated MCP server config: ${config.name} (${config.id})`);
  }

  /**
   * 注册或更新服务器配置
   */
  async registerOrUpdateServer(config: MCPServerConfig): Promise<void> {
    if (this.configs.has(config.id)) {
      await this.updateServerConfig(config);
    } else {
      this.registerServer(config);
    }
  }

  /**
   * 注销服务器
   */
  async unregisterServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client?.connected) {
      await client.disconnect();
    }

    this.clients.delete(serverId);
    this.configs.delete(serverId);
    this.logger.log(`Unregistered MCP server: ${serverId}`);
  }

  /**
   * 获取客户端
   */
  getClient(serverId: string): IMCPClient | undefined {
    return this.clients.get(serverId);
  }

  /**
   * 获取所有客户端
   */
  getAllClients(): IMCPClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * 获取已注册的服务器配置
   */
  getServerConfigs(): MCPServerConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * 连接到指定服务器
   */
  async connect(serverId: string): Promise<void> {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`Server ${serverId} not registered`);
    }

    let client = this.clients.get(serverId);
    if (!client) {
      client = createMCPClient(config);
      this.clients.set(serverId, client);
    }

    if (!client.connected) {
      await client.connect();
      this.emitEvent("connected", serverId);
    }
  }

  /**
   * 连接所有服务器
   */
  async connectAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const serverId of this.configs.keys()) {
      promises.push(
        this.connect(serverId).catch((error) => {
          this.logger.error(
            `Failed to connect to ${serverId}: ${error.message}`,
          );
          this.emitEvent("error", serverId, { error: error.message });
        }),
      );
    }

    await Promise.allSettled(promises);
  }

  /**
   * 断开指定服务器连接
   */
  async disconnect(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client?.connected) {
      await client.disconnect();
      this.emitEvent("disconnected", serverId);
    }
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [serverId, client] of this.clients) {
      if (client.connected) {
        promises.push(
          client.disconnect().catch((error) => {
            this.logger.error(
              `Failed to disconnect from ${serverId}: ${error.message}`,
            );
          }),
        );
      }
    }

    await Promise.allSettled(promises);
  }

  /**
   * 获取所有可用工具
   */
  async getAllTools(): Promise<Map<string, MCPTool[]>> {
    const result = new Map<string, MCPTool[]>();

    for (const [serverId, client] of this.clients) {
      if (client.connected) {
        try {
          const tools = await client.listTools();
          result.set(serverId, tools);
        } catch (error) {
          this.logger.error(
            `Failed to list tools from ${serverId}: ${(error as Error).message}`,
          );
          result.set(serverId, []);
        }
      }
    }

    return result;
  }

  /**
   * 获取所有工具的扁平列表
   */
  async getAllToolsFlat(): Promise<Array<{ serverId: string; tool: MCPTool }>> {
    const toolMap = await this.getAllTools();
    const result: Array<{ serverId: string; tool: MCPTool }> = [];

    for (const [serverId, tools] of toolMap) {
      for (const tool of tools) {
        result.push({ serverId, tool });
      }
    }

    return result;
  }

  /**
   * 调用工具
   */
  async callTool(
    serverId: string,
    toolName: string,
    arguments_: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not found`);
    }

    if (!client.connected) {
      throw new Error(`Server ${serverId} not connected`);
    }

    return client.callTool(toolName, arguments_);
  }

  /**
   * 查找并调用工具（自动路由）
   */
  async callToolAuto(
    toolName: string,
    arguments_: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    // 查找提供该工具的服务器
    const allTools = await this.getAllToolsFlat();
    const match = allTools.find((t) => t.tool.name === toolName);

    if (!match) {
      throw new Error(`Tool ${toolName} not found on any server`);
    }

    return this.callTool(match.serverId, toolName, arguments_);
  }

  /**
   * 订阅事件
   */
  onEvent(handler: (event: MCPEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * 发送事件
   */
  private emitEvent(
    type: MCPEventType,
    serverId: string,
    data?: unknown,
  ): void {
    const event: MCPEvent = {
      type,
      serverId,
      timestamp: new Date(),
      data,
    };

    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        this.logger.error(`Event handler error: ${(error as Error).message}`);
      }
    }
  }
}
