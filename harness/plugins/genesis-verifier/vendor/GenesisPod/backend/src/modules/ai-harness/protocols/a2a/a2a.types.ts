/**
 * A2A (Agent-to-Agent) Protocol Types
 * Google A2A v0.3 标准类型定义
 *
 * 基于 Google Agent-to-Agent Protocol (A2A)
 * https://github.com/google/A2A
 */

/**
 * A2A Agent Card - 描述 Agent 的能力和接口
 */
export interface A2AAgentCard {
  /** Agent 名称 */
  name: string;

  /** Agent 描述 */
  description: string;

  /** Agent 端点 URL */
  url: string;

  /** 提供方信息 */
  provider: {
    organization: string;
    url: string;
  };

  /** Agent 版本 */
  version: string;

  /** 能力支持 */
  capabilities?: {
    /** 是否支持流式响应 */
    streaming?: boolean;

    /** 是否支持推送通知 */
    pushNotifications?: boolean;

    /** 是否支持状态转换历史 */
    stateTransitionHistory?: boolean;
  };

  /** 认证配置 */
  authentication?: {
    /** 支持的认证方式 */
    schemes: string[];

    /** 认证说明 */
    credentials?: string;
  };

  /** 默认输入模式 */
  defaultInputModes: string[];

  /** 默认输出模式 */
  defaultOutputModes: string[];

  /** 技能列表 */
  skills: A2ASkill[];
}

/**
 * A2A Skill - Agent 的具体能力
 */
export interface A2ASkill {
  /** 技能ID（唯一标识） */
  id: string;

  /** 技能名称 */
  name: string;

  /** 技能描述 */
  description: string;

  /** 技能标签（用于分类和搜索） */
  tags: string[];

  /** 示例用法 */
  examples?: string[];

  /** 输入模式 */
  inputModes?: string[];

  /** 输出模式 */
  outputModes?: string[];
}

/**
 * A2A Task Request - 创建任务请求
 */
export interface A2ATaskRequest {
  /** 技能ID */
  skillId: string;

  /** 任务输入 */
  input: {
    /** 输入内容 */
    content: string;

    /** 输入模式 */
    mode?: string;
  };

  /** 任务配置 */
  config?: {
    /** 是否流式响应 */
    streaming?: boolean;

    /** Webhook URL（用于异步通知） */
    webhookUrl?: string;

    /** 附加参数 */
    [key: string]: unknown;
  };

  /** 任务元数据 */
  metadata?: {
    /** 客户端标识 */
    clientId?: string;

    /** 请求追踪ID */
    traceId?: string;

    /** 附加元数据 */
    [key: string]: unknown;
  };
}

/**
 * A2A Task Response - 任务创建响应
 */
export interface A2ATaskResponse {
  /** 任务ID */
  taskId: string;

  /** 任务状态 */
  status: A2ATaskStatus;

  /** 任务结果（如果已完成） */
  result?: A2ATaskResult;

  /** 错误信息（如果失败） */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };

  /** 创建时间 */
  createdAt: string;

  /** 更新时间 */
  updatedAt: string;
}

/**
 * A2A Task Status - 任务状态
 */
export enum A2ATaskStatus {
  /** 等待中 */
  PENDING = "pending",

  /** 运行中 */
  RUNNING = "running",

  /** 已完成 */
  COMPLETED = "completed",

  /** 失败 */
  FAILED = "failed",

  /** 已取消 */
  CANCELLED = "cancelled",
}

/**
 * A2A Task Result - 任务结果
 */
export interface A2ATaskResult {
  /** 输出内容 */
  content: string;

  /** 输出模式 */
  mode: string;

  /** 附加数据 */
  data?: unknown;

  /** 元数据 */
  metadata?: {
    /** 处理耗时（毫秒） */
    duration?: number;

    /** Token 使用量 */
    tokenUsage?: {
      input: number;
      output: number;
      total: number;
    };

    /** 附加元数据 */
    [key: string]: unknown;
  };
}

/**
 * A2A Task Status Update - 任务状态查询响应
 */
export interface A2ATaskStatusResponse {
  /** 任务ID */
  taskId: string;

  /** 技能ID */
  skillId: string;

  /** 任务状态 */
  status: A2ATaskStatus;

  /** 任务结果（如果已完成） */
  result?: A2ATaskResult;

  /** 错误信息（如果失败） */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };

  /** 创建时间 */
  createdAt: string;

  /** 更新时间 */
  updatedAt: string;

  /** 状态转换历史 */
  history?: A2ATaskStateTransition[];
}

/**
 * A2A Task State Transition - 状态转换历史
 */
export interface A2ATaskStateTransition {
  /** 转换时间 */
  timestamp: string;

  /** 旧状态 */
  from: A2ATaskStatus;

  /** 新状态 */
  to: A2ATaskStatus;

  /** 转换原因 */
  reason?: string;
}
