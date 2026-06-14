/**
 * A2A Protocol v0.3 — Specification-Compliant Types
 *
 * 2026-05-01 (PR-X-P): 对齐 Google A2A v0.3 / Anthropic A2A SDK 标准。
 *
 * Spec source:
 *   - https://github.com/google/A2A (v0.3.0+)
 *   - Anthropic A2A SDK 2026-04 release
 *
 * 与早期 a2a.types.ts 的兼容关系：
 *   早期版本是 v0.1 风格 REST + 5-state task；本文件是 v0.3 完整 spec。
 *   旧类型仍保留供 backwards-compat shim 使用，新代码请用本文件类型。
 *
 * 关键差异（vs a2a.types.ts）:
 *   - JSON-RPC 2.0 envelope 替代裸 REST body
 *   - TaskState 8 个值（submitted/working/input-required/completed/failed/canceled/rejected/auth-required）
 *     替代旧 5 状态（pending/running/completed/failed/cancelled）
 *   - Message + Part 替代裸 input.content（multi-modal: text/file/data）
 *   - Artifact 替代裸 result.content
 *   - AgentCard.securitySchemes（OpenAPI-style）替代旧 authentication.schemes
 *   - 主方法名: message/send / message/stream / tasks/get / tasks/cancel
 */

// ════════════════════════════════════════════════════════════════════
// JSON-RPC 2.0 Envelope
// ════════════════════════════════════════════════════════════════════

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: TResult;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: JsonRpcError;
}

export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** A2A 标准错误码（含 JSON-RPC 标准 + A2A 扩展） */
export const A2A_ERROR_CODES = {
  // JSON-RPC standard
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // A2A specific
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED: -32007,
} as const;

// ════════════════════════════════════════════════════════════════════
// Message + Part (multi-modal)
// ════════════════════════════════════════════════════════════════════

/** 文本 Part */
export interface TextPart {
  kind: "text";
  text: string;
  metadata?: Record<string, unknown>;
}

/** 文件 Part — 通过 URI 引用 */
export interface FilePart {
  kind: "file";
  file: FileWithUri | FileWithBytes;
  metadata?: Record<string, unknown>;
}

export interface FileWithUri {
  uri: string;
  name?: string;
  mimeType?: string;
}

export interface FileWithBytes {
  bytes: string; // base64
  name?: string;
  mimeType?: string;
}

/** 结构化数据 Part — 任意 JSON */
export interface DataPart {
  kind: "data";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type Part = TextPart | FilePart | DataPart;

/** Message — agent / user 通信单位 */
export interface Message {
  /** 消息发送方 */
  role: "user" | "agent";
  /** 消息内容（多模态 parts） */
  parts: Part[];
  /** 消息 ID（建议 UUID）*/
  messageId: string;
  /** 任务 ID（关联 task） */
  taskId?: string;
  /** 上下文 ID（跨任务会话） */
  contextId?: string;
  /** 引用上一条 message ID */
  referenceTaskIds?: string[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 消息类型标识符 */
  kind: "message";
}

// ════════════════════════════════════════════════════════════════════
// Task + State (8 states)
// ════════════════════════════════════════════════════════════════════

/** Task State — A2A v0.3 8-state machine */
export enum TaskState {
  /** 已提交，等待 agent 接受 */
  SUBMITTED = "submitted",
  /** Agent 正在处理 */
  WORKING = "working",
  /** Agent 等待用户额外输入 */
  INPUT_REQUIRED = "input-required",
  /** 完成 */
  COMPLETED = "completed",
  /** 失败 */
  FAILED = "failed",
  /** 客户端取消 */
  CANCELED = "canceled",
  /** Agent 拒绝（不在能力范围 / 政策违反）*/
  REJECTED = "rejected",
  /** 需要鉴权（如 OAuth flow） */
  AUTH_REQUIRED = "auth-required",
}

/** Task 状态对象 */
export interface TaskStatus {
  state: TaskState;
  message?: Message;
  /** 状态变更时间戳 ISO 8601 */
  timestamp?: string;
}

/** Artifact — task 输出 */
export interface Artifact {
  /** Artifact ID（task 内唯一） */
  artifactId: string;
  /** 名称（可选展示用） */
  name?: string;
  /** 描述 */
  description?: string;
  /** 内容 parts（多模态） */
  parts: Part[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 扩展属性 */
  extensions?: string[];
}

/** Task — A2A v0.3 标准 task 对象 */
export interface Task {
  /** Task ID（UUID） */
  id: string;
  /** Context ID（会话） */
  contextId: string;
  /** 当前状态 */
  status: TaskStatus;
  /** 历史 message 列表（client + agent 多轮） */
  history?: Message[];
  /** 输出 artifacts */
  artifacts?: Artifact[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** kind 类型识别 */
  kind: "task";
}

// ════════════════════════════════════════════════════════════════════
// Streaming Events (for message/stream)
// ════════════════════════════════════════════════════════════════════

/** 任务状态更新事件 */
export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: TaskStatus;
  /** 是否最终事件（结束流） */
  final: boolean;
  metadata?: Record<string, unknown>;
  kind: "status-update";
}

/** 任务 artifact 更新事件 */
export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: Artifact;
  /** 是否追加（true=append parts，false=replace） */
  append?: boolean;
  /** 是否最后一个 chunk */
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
  kind: "artifact-update";
}

export type StreamEvent =
  | Message
  | Task
  | TaskStatusUpdateEvent
  | TaskArtifactUpdateEvent;

// ════════════════════════════════════════════════════════════════════
// JSON-RPC Method Params
// ════════════════════════════════════════════════════════════════════

/** message/send params */
export interface MessageSendParams {
  message: Message;
  configuration?: MessageSendConfiguration;
  metadata?: Record<string, unknown>;
}

export interface MessageSendConfiguration {
  /** 接受的输出模式（ContentType）*/
  acceptedOutputModes?: string[];
  /** 历史消息条数限制 */
  historyLength?: number;
  /** Push notification 配置（异步通知）*/
  pushNotificationConfig?: PushNotificationConfig;
  /** Blocking: 是否等待最终结果 */
  blocking?: boolean;
}

/** tasks/get params */
export interface TaskQueryParams {
  id: string;
  /** 历史消息条数 */
  historyLength?: number;
  metadata?: Record<string, unknown>;
}

/** tasks/cancel params */
export interface TaskIdParams {
  id: string;
  metadata?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════════
// Push Notifications
// ════════════════════════════════════════════════════════════════════

export interface PushNotificationConfig {
  /** Webhook URL */
  url: string;
  /** 鉴权 */
  authentication?: PushNotificationAuthenticationInfo;
  /** Token 用于校验 webhook 来源 */
  token?: string;
}

export interface PushNotificationAuthenticationInfo {
  /** Bearer / API key / OAuth2 等 scheme name */
  schemes: string[];
  credentials?: string;
}

export interface TaskPushNotificationConfig {
  taskId: string;
  pushNotificationConfig: PushNotificationConfig;
}

// ════════════════════════════════════════════════════════════════════
// AgentCard v0.3 (OpenAPI-style securitySchemes)
// ════════════════════════════════════════════════════════════════════

export interface AgentCard {
  /** Agent name */
  name: string;
  /** Description */
  description: string;
  /** Service endpoint URL */
  url: string;
  /** A2A protocol version supported */
  protocolVersion?: string;
  /** Provider info */
  provider?: AgentProvider;
  /** Agent version */
  version: string;
  /** 文档 URL */
  documentationUrl?: string;
  /** Capabilities */
  capabilities: AgentCapabilities;
  /** OpenAPI-style 安全 schemes */
  securitySchemes?: Record<string, SecurityScheme>;
  /** 必需安全要求 */
  security?: Array<Record<string, string[]>>;
  /** 默认输入模式（MIME types）*/
  defaultInputModes: string[];
  /** 默认输出模式 */
  defaultOutputModes: string[];
  /** Skills 列表 */
  skills: AgentSkill[];
  /** 是否提供更详细的 authenticated agent card */
  supportsAuthenticatedExtendedCard?: boolean;
}

export interface AgentProvider {
  organization: string;
  url: string;
}

export interface AgentCapabilities {
  /** 流式 (message/stream)? */
  streaming?: boolean;
  /** Push notifications? */
  pushNotifications?: boolean;
  /** State transition history? */
  stateTransitionHistory?: boolean;
  /** 扩展能力 */
  extensions?: AgentExtension[];
}

export interface AgentExtension {
  uri: string;
  description?: string;
  required?: boolean;
  params?: Record<string, unknown>;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

/** OpenAPI-style security scheme */
export type SecurityScheme =
  | APIKeySecurityScheme
  | HTTPAuthSecurityScheme
  | OAuth2SecurityScheme
  | OpenIdConnectSecurityScheme;

export interface APIKeySecurityScheme {
  type: "apiKey";
  in: "query" | "header" | "cookie";
  name: string;
  description?: string;
}

export interface HTTPAuthSecurityScheme {
  type: "http";
  scheme: string; // "bearer" | "basic" 等
  bearerFormat?: string;
  description?: string;
}

export interface OAuth2SecurityScheme {
  type: "oauth2";
  flows: Record<string, unknown>;
  description?: string;
}

export interface OpenIdConnectSecurityScheme {
  type: "openIdConnect";
  openIdConnectUrl: string;
  description?: string;
}

// ════════════════════════════════════════════════════════════════════
// Method type aliases
// ════════════════════════════════════════════════════════════════════

/** 标准 A2A v0.3 JSON-RPC method names */
export const A2A_METHODS = {
  MESSAGE_SEND: "message/send",
  MESSAGE_STREAM: "message/stream",
  TASKS_GET: "tasks/get",
  TASKS_CANCEL: "tasks/cancel",
  TASKS_PUSH_NOTIFICATION_CONFIG_SET: "tasks/pushNotificationConfig/set",
  TASKS_PUSH_NOTIFICATION_CONFIG_GET: "tasks/pushNotificationConfig/get",
  TASKS_RESUBSCRIBE: "tasks/resubscribe",
  AGENT_AUTHENTICATED_EXTENDED_CARD: "agent/getAuthenticatedExtendedCard",
} as const;
export type A2AMethod = (typeof A2A_METHODS)[keyof typeof A2A_METHODS];
