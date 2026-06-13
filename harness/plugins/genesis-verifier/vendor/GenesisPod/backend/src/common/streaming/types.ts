/**
 * Streaming Types
 *
 * 统一的流式响应类型定义
 */

/**
 * SSE 事件类型
 */
export interface SSEEvent<T = unknown> {
  // 事件类型（用于 EventSource.addEventListener）
  type: string;

  // 事件数据
  data: T;

  // 时间戳
  timestamp: string;

  // 可选的事件 ID（用于断点续传）
  id?: string;
}

/**
 * 进度事件
 */
export interface ProgressEvent {
  type: "progress";
  phase: string;
  progress: number; // 0-100
  message: string;
  current?: number;
  total?: number;
}

/**
 * 完成事件
 */
export interface CompleteEvent<T = unknown> {
  type: "complete";
  result: T;
  totalTime?: number;
}

/**
 * 错误事件
 */
export interface ErrorEvent {
  type: "error";
  error: string;
  code?: string;
  recoverable?: boolean;
}

/**
 * 心跳事件
 */
export interface HeartbeatEvent {
  type: "heartbeat";
  timestamp: string;
}

/**
 * 流式配置
 */
export interface StreamConfig {
  // 心跳间隔（毫秒）
  heartbeatInterval?: number;

  // 超时时间（毫秒）
  timeout?: number;

  // 是否启用心跳
  enableHeartbeat?: boolean;

  // 客户端断开时的清理函数
  onClientDisconnect?: () => void;
}

/**
 * 背压控制策略
 */
export type BackpressureStrategy = "drop" | "pause" | "error";

/**
 * 流式处理选项（支持背压控制）
 */
export interface StreamingOptions {
  // 缓冲区大小（默认 10）
  bufferSize?: number;

  // 背压策略
  backpressureStrategy?: BackpressureStrategy;

  // 客户端断开时的回调
  onClientDisconnect?: () => void;

  // 心跳间隔（毫秒）
  heartbeatInterval?: number;

  // 事件映射函数
  mapToEvent?: (item: unknown) => SSEEvent<unknown>;

  // 完成事件回调
  onComplete?: () => SSEEvent<unknown>;

  // 错误事件回调
  onError?: (error: Error) => SSEEvent<unknown>;
}

/**
 * NestJS SSE 返回的 MessageEvent 格式
 */
export interface NestSSEMessageEvent {
  data: string;
  type?: string;
  id?: string;
  retry?: number;
}
