/**
 * MCP Server - Interface Definitions
 * GenesisPod 作为 MCP Server 对外暴露能力的接口定义
 *
 * 支持 MCP 协议三大原语: Tools / Resources / Prompts
 */

// ============================================================================
// JSON-RPC 2.0 Core
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// MCP Tools
// ============================================================================

export interface ExposedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface IMCPToolHandler {
  readonly toolName: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  execute(
    args: Record<string, unknown>,
    context: MCPRequestContext,
  ): Promise<MCPToolResponse>;
}

export interface MCPToolResponse {
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

// ============================================================================
// MCP Resources
// ============================================================================

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface IMCPResourceProvider {
  listResources(): Promise<MCPResource[]>;
  readResource(uri: string): Promise<MCPResourceContent>;
}

// ============================================================================
// MCP Prompts
// ============================================================================

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface MCPPromptMessage {
  role: "user" | "assistant";
  content: {
    type: "text";
    text: string;
  };
}

export interface IMCPPromptProvider {
  listPrompts(): Promise<MCPPrompt[]>;
  getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<MCPPromptMessage[]>;
}

// ============================================================================
// MCP Request Context (Enhanced)
// ============================================================================

export interface MCPRequestContext {
  apiKeyId: string;
  sessionId?: string;
  clientInfo?: { name: string; version: string };
}

// ============================================================================
// MCP Session (Enhanced)
// ============================================================================

export interface MCPSession {
  sessionId: string;
  apiKeyId: string;
  clientInfo?: { name: string; version: string };
  permissionPolicy?: MCPPermissionPolicy;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface MCPPermissionPolicy {
  allowedToolPatterns: string[];
  deniedToolPatterns: string[];
  maxConcurrency: number;
  dailyQuota: number;
  allowStreaming: boolean;
  allowResources: boolean;
  allowPrompts: boolean;
}

// ============================================================================
// MCP Capability Discovery
// ============================================================================

export type MCPToolSource =
  | "curated"
  | "registry-tool"
  | "registry-skill"
  | "registry-agent";

export interface ExposedToolWithMeta extends ExposedTool {
  source: MCPToolSource;
  category?: string;
  tags?: string[];
}

// ============================================================================
// SSE Streaming Events
// ============================================================================

export interface MCPStreamEvent {
  type: "progress" | "log" | "result" | "error";
  taskId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

// ============================================================================
// JSON-RPC 2.0 Error Codes
// ============================================================================

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
  AUTH_ERROR: { code: -32001, message: "Authentication failed" },
  PERMISSION_DENIED: { code: -32002, message: "Permission denied" },
  RATE_LIMITED: { code: -32003, message: "Rate limit exceeded" },
  RESOURCE_NOT_FOUND: { code: -32004, message: "Resource not found" },
} as const;
