/**
 * MCPToolAdapter — 把远端 MCP tool 适配为本地 ITool
 *
 * 职责：
 *   - 实现 ITool 接口（toFunctionDefinition / execute / toCompactSummary）
 *   - execute() 时调用 MCP client.callTool；返回值规范化为 ToolResult
 *   - 不缓存、不重试 —— ToolRegistry / circuit breaker 上层处理
 */

import type {
  ITool,
  ToolContext,
  ToolResult,
  FunctionDefinition,
  CompactToolSummary,
  JSONSchema,
} from "../../abstractions/tool.interface";
import { ToolCategory } from "../../abstractions/tool.interface";

/**
 * MCP Client 的最小子集 —— 解耦 SDK 版本，便于 mock 测试。
 */
export interface MCPClientLike {
  callTool(args: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ content: unknown; isError?: boolean }>;
}

export interface MCPToolDescriptor {
  /** MCP server 报上来的 tool 名（可能含点 / 斜线，本类不修饰） */
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JSONSchema;
  /** Optional output schema (MCP spec 1.x) */
  readonly outputSchema?: JSONSchema;
}

export class MCPRelayToolAdapter implements ITool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory = "general" as ToolCategory;
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema;
  readonly tags: string[];
  readonly enabled = true;

  constructor(
    serverId: string,
    private readonly descriptor: MCPToolDescriptor,
    private readonly client: MCPClientLike,
  ) {
    // ID 形如 mcp:<serverId>/<name>，避免与本地 tool 冲突
    this.id = `mcp:${serverId}/${descriptor.name}`;
    this.name = descriptor.name;
    this.description = descriptor.description ?? `MCP tool from ${serverId}`;
    this.inputSchema = descriptor.inputSchema;
    this.outputSchema =
      descriptor.outputSchema ?? ({ type: "object" } as JSONSchema);
    this.tags = ["mcp", `mcp:${serverId}`];
  }

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const startMs = Date.now();
    try {
      const result = await this.client.callTool({
        name: this.descriptor.name,
        arguments: input,
      });
      if (result.isError) {
        return {
          success: false,
          data: result.content,
          error: {
            code: "MCP_TOOL_ERROR",
            message:
              typeof result.content === "string"
                ? result.content
                : JSON.stringify(result.content),
          },
          metadata: {
            executionId: context.executionId,
            startTime: new Date(startMs),
            endTime: new Date(),
            duration: Date.now() - startMs,
          },
        };
      }
      return {
        success: true,
        data: result.content,
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startMs),
          endTime: new Date(),
          duration: Date.now() - startMs,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: {
          code: "MCP_TRANSPORT_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
        metadata: {
          executionId: context.executionId,
          startTime: new Date(startMs),
          endTime: new Date(),
          duration: Date.now() - startMs,
        },
      };
    }
  }

  toFunctionDefinition(): FunctionDefinition {
    return {
      name: this.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
      description: this.description,
      parameters: this.inputSchema,
    };
  }

  toCompactSummary(): CompactToolSummary {
    return {
      id: this.id,
      name: this.name,
      brief: this.description.slice(0, 100),
      category: this.category,
      tags: this.tags,
    };
  }
}
