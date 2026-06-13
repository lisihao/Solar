/**
 * AI Engine - MCP Client Factory
 * 根据传输类型创建对应的 MCP 客户端实例
 */

import { IMCPClient, MCPServerConfig } from "../abstractions/mcp.interface";
import { StdioMCPClient } from "./mcp-client";
import { StreamableHttpMCPClient } from "./streamable-http-mcp-client";
import { SSEMCPClient } from "./sse-mcp-client";

/**
 * 创建 MCP 客户端
 */
export function createMCPClient(config: MCPServerConfig): IMCPClient {
  switch (config.transport) {
    case "stdio":
      return new StdioMCPClient(config);

    case "http":
      return new StreamableHttpMCPClient(config);

    case "sse":
      return new SSEMCPClient(config);

    default:
      throw new Error(`Unknown transport: ${config.transport}`);
  }
}
