/**
 * Event Emitter Interface
 * 事件发射器抽象接口
 */

/**
 * 事件类型定义
 */
export interface EngineEvent<T = unknown> {
  type: string;
  payload: T;
  metadata: {
    timestamp: Date;
    source: string; // 事件来源模块
    correlationId?: string; // 关联 ID（用于追踪）
    userId?: string;
    sessionId?: string;
  };
}

/**
 * 进度事件
 */
export interface ProgressEvent {
  taskId: string;
  taskType: string;
  phase: string;
  progress: number; // 0-100
  message?: string;
  currentStep?: number;
  totalSteps?: number;
  estimatedRemaining?: number; // 预计剩余时间 (ms)
  details?: Record<string, unknown>;
}

/**
 * 房间类型
 */
export type RoomType =
  | "topic"
  | "project"
  | "team"
  | "user"
  | "mission"
  | "session";

/**
 * 房间配置
 */
export interface RoomConfig {
  roomId: string;
  roomType: RoomType;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/**
 * 事件订阅者
 */
export interface EventSubscription {
  id: string;
  eventType: string | string[];
  handler: (event: EngineEvent) => void | Promise<void>;
  once?: boolean;
}

/**
 * 事件发射器接口
 */
export interface IEngineEventEmitter {
  /**
   * 发射事件（全局）
   */
  emit<T>(event: EngineEvent<T>): void;

  /**
   * 发射到指定房间
   */
  emitToRoom<T>(roomConfig: RoomConfig, event: EngineEvent<T>): void;

  /**
   * 发射进度事件
   */
  emitProgress(roomConfig: RoomConfig, progress: ProgressEvent): void;

  /**
   * 订阅事件
   * @returns 取消订阅的函数
   */
  subscribe<T>(
    eventType: string,
    handler: (event: EngineEvent<T>) => void,
  ): () => void;

  /**
   * 订阅一次性事件
   */
  once<T>(
    eventType: string,
    handler: (event: EngineEvent<T>) => void,
  ): () => void;

  /**
   * 取消订阅
   */
  unsubscribe(subscriptionId: string): void;

  /**
   * 加入房间
   */
  joinRoom(socketId: string, roomConfig: RoomConfig): void;

  /**
   * 离开房间
   */
  leaveRoom(socketId: string, roomConfig: RoomConfig): void;

  /**
   * 获取房间成员
   */
  getRoomMembers(roomConfig: RoomConfig): string[];

  /**
   * 广播到所有连接
   */
  broadcast<T>(event: EngineEvent<T>): void;
}

/**
 * 标准事件类型
 */
export const StandardEventTypes = {
  // 任务相关
  TASK_STARTED: "task:started",
  TASK_PROGRESS: "task:progress",
  TASK_COMPLETED: "task:completed",
  TASK_FAILED: "task:failed",

  // 研究相关
  RESEARCH_PLANNING: "research:planning",
  RESEARCH_DIMENSION_STARTED: "research:dimension_started",
  RESEARCH_DIMENSION_COMPLETED: "research:dimension_completed",
  RESEARCH_REPORT_SYNTHESIZING: "research:report_synthesizing",
  RESEARCH_COMPLETED: "research:completed",

  // 写作相关
  WRITING_CHAPTER_STARTED: "writing:chapter_started",
  WRITING_CHAPTER_PROGRESS: "writing:chapter_progress",
  WRITING_CHAPTER_COMPLETED: "writing:chapter_completed",

  // 审查相关
  REVIEW_REQUESTED: "review:requested",
  REVIEW_ASSIGNED: "review:assigned",
  REVIEW_COMPLETED: "review:completed",

  // 系统相关
  SYSTEM_ERROR: "system:error",
  SYSTEM_WARNING: "system:warning",
} as const;

export type StandardEventType =
  (typeof StandardEventTypes)[keyof typeof StandardEventTypes];
