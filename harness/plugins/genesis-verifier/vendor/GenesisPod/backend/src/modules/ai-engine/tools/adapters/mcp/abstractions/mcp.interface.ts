/**
 * AI Engine - MCP Interface
 * Model Context Protocol 接口定义
 */

/**
 * MCP Server 信息
 */
export interface MCPServerInfo {
  /**
   * 服务器名称
   */
  name: string;

  /**
   * 服务器版本
   */
  version: string;

  /**
   * 协议版本
   */
  protocolVersion: string;

  /**
   * 能力
   */
  capabilities: MCPCapabilities;
}

/**
 * MCP 能力
 */
export interface MCPCapabilities {
  /**
   * 支持的工具
   */
  tools?: boolean;

  /**
   * 支持的资源
   */
  resources?: boolean;

  /**
   * 支持的提示词
   */
  prompts?: boolean;

  /**
   * 支持的采样
   */
  sampling?: boolean;

  /**
   * 实验性功能
   */
  experimental?: Record<string, boolean>;
}

/**
 * MCP 工具定义
 */
export interface MCPTool {
  /**
   * 工具名称
   */
  name: string;

  /**
   * 工具描述
   */
  description: string;

  /**
   * 输入 Schema
   */
  inputSchema: MCPSchema;
}

/**
 * MCP Schema (JSON Schema 子集)
 */
export interface MCPSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  properties?: Record<string, MCPSchemaProperty>;
  required?: string[];
  items?: MCPSchemaProperty;
  description?: string;
}

/**
 * MCP Schema 属性
 */
export interface MCPSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: MCPSchemaProperty;
}

/**
 * MCP 工具调用结果
 */
export interface MCPToolResult {
  /**
   * 内容列表
   */
  content: MCPContent[];

  /**
   * 是否为错误
   */
  isError?: boolean;
}

/**
 * MCP 内容
 */
export interface MCPContent {
  /**
   * 内容类型
   */
  type: "text" | "image" | "resource";

  /**
   * 文本内容
   */
  text?: string;

  /**
   * 图像数据 (base64)
   */
  data?: string;

  /**
   * 图像 MIME 类型
   */
  mimeType?: string;

  /**
   * 资源 URI
   */
  uri?: string;
}

/**
 * MCP 资源
 */
export interface MCPResource {
  /**
   * 资源 URI
   */
  uri: string;

  /**
   * 资源名称
   */
  name: string;

  /**
   * 资源描述
   */
  description?: string;

  /**
   * MIME 类型
   */
  mimeType?: string;
}

/**
 * MCP 资源内容
 */
export interface MCPResourceContent {
  /**
   * 资源 URI
   */
  uri: string;

  /**
   * MIME 类型
   */
  mimeType?: string;

  /**
   * 文本内容
   */
  text?: string;

  /**
   * 二进制内容 (base64)
   */
  blob?: string;
}

/**
 * MCP 提示词
 */
export interface MCPPrompt {
  /**
   * 提示词名称
   */
  name: string;

  /**
   * 提示词描述
   */
  description?: string;

  /**
   * 参数定义
   */
  arguments?: MCPPromptArgument[];
}

/**
 * MCP 提示词参数
 */
export interface MCPPromptArgument {
  /**
   * 参数名称
   */
  name: string;

  /**
   * 参数描述
   */
  description?: string;

  /**
   * 是否必需
   */
  required?: boolean;
}

/**
 * MCP 提示词消息
 */
export interface MCPPromptMessage {
  role: "user" | "assistant";
  content: MCPContent;
}

/**
 * MCP 客户端接口
 */
export interface IMCPClient {
  /**
   * 客户端 ID
   */
  readonly id: string;

  /**
   * 连接状态
   */
  readonly connected: boolean;

  /**
   * 服务器信息
   */
  readonly serverInfo?: MCPServerInfo;

  /**
   * 连接到服务器
   */
  connect(): Promise<void>;

  /**
   * 断开连接
   */
  disconnect(): Promise<void>;

  /**
   * 获取可用工具列表
   */
  listTools(): Promise<MCPTool[]>;

  /**
   * 调用工具
   */
  callTool(
    name: string,
    arguments_: Record<string, unknown>,
  ): Promise<MCPToolResult>;

  /**
   * 获取可用资源列表
   */
  listResources(): Promise<MCPResource[]>;

  /**
   * 读取资源
   */
  readResource(uri: string): Promise<MCPResourceContent>;

  /**
   * 获取可用提示词列表
   */
  listPrompts(): Promise<MCPPrompt[]>;

  /**
   * 获取提示词内容
   */
  getPrompt(
    name: string,
    arguments_?: Record<string, unknown>,
  ): Promise<MCPPromptMessage[]>;
}

/**
 * MCP 服务器配置
 */
export interface MCPServerConfig {
  /**
   * 服务器 ID
   */
  id: string;

  /**
   * 服务器名称
   */
  name: string;

  /**
   * 传输类型
   */
  transport: MCPTransportType;

  /**
   * 命令（stdio 传输）
   */
  command?: string;

  /**
   * 命令参数
   */
  args?: string[];

  /**
   * 环境变量
   */
  env?: Record<string, string>;

  /**
   * URL（HTTP/WebSocket 传输）
   */
  url?: string;

  /**
   * 是否自动重连
   */
  autoReconnect?: boolean;

  /**
   * 超时时间 (ms)
   */
  timeout?: number;
}

/**
 * MCP 传输类型
 */
export type MCPTransportType = "stdio" | "http" | "sse" | "websocket";

/**
 * MCP 事件类型
 */
export type MCPEventType =
  | "connected"
  | "disconnected"
  | "error"
  | "tools_changed"
  | "resources_changed"
  | "prompts_changed";

/**
 * MCP 事件
 */
export interface MCPEvent {
  type: MCPEventType;
  serverId: string;
  timestamp: Date;
  data?: unknown;
}

/**
 * MCP 管理器接口
 */
export interface IMCPManager {
  /**
   * 注册服务器
   */
  registerServer(config: MCPServerConfig): void;

  /**
   * 注销服务器
   */
  unregisterServer(serverId: string): void;

  /**
   * 获取客户端
   */
  getClient(serverId: string): IMCPClient | undefined;

  /**
   * 获取所有客户端
   */
  getAllClients(): IMCPClient[];

  /**
   * 连接所有服务器
   */
  connectAll(): Promise<void>;

  /**
   * 断开所有连接
   */
  disconnectAll(): Promise<void>;

  /**
   * 获取所有可用工具
   */
  getAllTools(): Promise<Map<string, MCPTool[]>>;

  /**
   * 调用工具
   */
  callTool(
    serverId: string,
    toolName: string,
    arguments_: Record<string, unknown>,
  ): Promise<MCPToolResult>;

  /**
   * 订阅事件
   */
  onEvent(handler: (event: MCPEvent) => void): () => void;
}
