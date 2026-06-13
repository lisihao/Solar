/**
 * AI Engine - MCP Tool Adapter
 * MCP 工具适配器
 *
 * 将 MCP 工具转换为 ai-engine ITool 接口
 */

import {
  ITool,
  ToolContext,
  ToolResult,
  CompactToolSummary,
} from "../../../abstractions";
import { MCPTool, MCPToolResult } from "../abstractions/mcp.interface";
import { MCPManager } from "../manager/mcp-manager";

/**
 * MCP 工具适配器
 * 将 MCP 工具包装为 ITool
 */
export class MCPToolAdapter implements ITool<
  Record<string, unknown>,
  MCPToolResult
> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category = "mcp";
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema = { type: "object" };
  readonly tags: string[];

  constructor(
    private readonly mcpTool: MCPTool,
    private readonly serverId: string,
    private readonly mcpManager: MCPManager,
  ) {
    this.id = `mcp:${serverId}:${mcpTool.name}`;
    this.name = mcpTool.name;
    this.description = mcpTool.description;
    this.inputSchema = mcpTool.inputSchema as unknown as Record<
      string,
      unknown
    >;
    this.tags = ["mcp", serverId];
  }

  /**
   * 执行工具
   */
  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult<MCPToolResult>> {
    const startTime = new Date();

    try {
      const result = await this.mcpManager.callTool(
        this.serverId,
        this.mcpTool.name,
        input,
      );

      return {
        success: !result.isError,
        data: result,
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "MCP_TOOL_ERROR",
          message: (error as Error).message,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }
  }

  /**
   * 转换为函数定义（用于 LLM）
   */
  toFunctionDefinition() {
    return {
      name: this.mcpTool.name,
      description: this.mcpTool.description,
      parameters: this.mcpTool.inputSchema,
    };
  }

  /**
   * 转换为精简摘要格式（节省 Token）
   */
  toCompactSummary(): CompactToolSummary {
    const brief =
      this.description.length > 100
        ? this.description.substring(0, 97) + "..."
        : this.description;

    return {
      id: this.id,
      name: this.name,
      brief,
      category: "mcp",
      tags: this.tags,
    };
  }
}

/**
 * MCP 工具注册器
 * 自动将 MCP 工具注册到 ToolRegistry
 */
export class MCPToolRegistrar {
  private registeredTools = new Map<string, MCPToolAdapter>();

  constructor(private readonly mcpManager: MCPManager) {}

  /**
   * 同步所有 MCP 工具到注册表
   */
  async syncTools(): Promise<MCPToolAdapter[]> {
    const allTools = await this.mcpManager.getAllToolsFlat();
    const adapters: MCPToolAdapter[] = [];

    for (const { serverId, tool } of allTools) {
      const adapter = new MCPToolAdapter(tool, serverId, this.mcpManager);

      // 检查是否已注册
      if (!this.registeredTools.has(adapter.id)) {
        this.registeredTools.set(adapter.id, adapter);
        adapters.push(adapter);
      }
    }

    return adapters;
  }

  /**
   * 获取所有已注册的 MCP 工具
   */
  getRegisteredTools(): MCPToolAdapter[] {
    return Array.from(this.registeredTools.values());
  }

  /**
   * 获取指定服务器的工具
   */
  getToolsByServer(serverId: string): MCPToolAdapter[] {
    return this.getRegisteredTools().filter((t) =>
      t.id.startsWith(`mcp:${serverId}:`),
    );
  }

  /**
   * 清除指定服务器的工具注册
   */
  clearServer(serverId: string): number {
    let count = 0;
    for (const [id] of this.registeredTools) {
      if (id.startsWith(`mcp:${serverId}:`)) {
        this.registeredTools.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * 清除所有工具注册
   */
  clearAll(): void {
    this.registeredTools.clear();
  }
}

/**
 * 从 MCP 工具结果中提取文本
 */
export function extractTextFromMCPResult(result: MCPToolResult): string {
  const textParts: string[] = [];

  for (const content of result.content) {
    if (content.type === "text" && content.text) {
      textParts.push(content.text);
    }
  }

  return textParts.join("\n");
}

/**
 * 从 MCP 工具结果中提取图像
 */
export function extractImagesFromMCPResult(result: MCPToolResult): Array<{
  data: string;
  mimeType: string;
}> {
  const images: Array<{ data: string; mimeType: string }> = [];

  for (const content of result.content) {
    if (content.type === "image" && content.data && content.mimeType) {
      images.push({
        data: content.data,
        mimeType: content.mimeType,
      });
    }
  }

  return images;
}
