/**
 * AI Harness - MCP Protocol Module
 * Model Context Protocol 协议层导出
 *
 * 包含：
 * - MCP Relay (轻量 relay，连 harness ToolRegistry)
 * - MCP 接口和类型定义 (abstractions)
 * - MCP 客户端 (Stdio/HTTP/WebSocket)
 * - MCP 管理器 (manager)
 * - MCP 工具适配器 (tools/relay)
 * - MCP 客户端注册服务 (registry)
 */

// Relay (harness-native, connects to harness ToolRegistry)
export { MCPRelay } from "./mcp-relay.service";
export type {
  MCPServerConfig as MCPRelayServerConfig,
  MCPHttpTransport,
  MCPStdioTransport,
  MCPTransportConfig,
} from "./mcp-relay.service";
export { MCPRelayToolAdapter } from "./mcp-relay-tool-adapter";
export type {
  MCPClientLike,
  MCPToolDescriptor,
} from "./mcp-relay-tool-adapter";

// Abstractions (PR-X7)
export * from "./abstractions";

// Client (PR-X7)
export * from "./client";

// Manager (PR-X7)
export * from "./manager";

// Tools (PR-X7 — engine-style MCPToolAdapter)
export * from "./tools";

// Registry (PR-X7)
export * from "./registry";
