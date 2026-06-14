/**
 * AI Engine - Collaborator Interface
 * 协作者接口定义
 */

import { JsonObject } from "@/modules/ai-engine/facade/index";

/**
 * 协作消息
 */
export interface CollaborationMessage {
  /**
   * 消息 ID
   */
  id: string;

  /**
   * 发送者 ID
   */
  senderId: string;

  /**
   * 接收者 ID（可选，为空表示广播）
   */
  receiverId?: string;

  /**
   * 消息类型
   */
  type: MessageType;

  /**
   * 消息内容
   */
  content: unknown;

  /**
   * 时间戳
   */
  timestamp: Date;

  /**
   * 元数据
   */
  metadata?: JsonObject;
}

/**
 * 消息类型
 */
export type MessageType =
  | "request" // 请求
  | "response" // 响应
  | "handoff" // 交接
  | "proposal" // 提案
  | "vote" // 投票
  | "feedback" // 反馈
  | "notification" // 通知
  | "sync" // 同步
  | string; // 自定义

/**
 * 协作会话
 */
export interface CollaborationSession {
  /**
   * 会话 ID
   */
  id: string;

  /**
   * 会话名称
   */
  name?: string;

  /**
   * 参与者
   */
  participants: Participant[];

  /**
   * 会话状态
   */
  status: SessionStatus;

  /**
   * 消息历史
   */
  messages: CollaborationMessage[];

  /**
   * 共享状态
   */
  sharedState: JsonObject;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 元数据
   */
  metadata?: JsonObject;
}

/**
 * 参与者
 */
export interface Participant {
  /**
   * 参与者 ID
   */
  id: string;

  /**
   * 参与者类型
   */
  type: ParticipantType;

  /**
   * 参与者名称
   */
  name: string;

  /**
   * 角色
   */
  role: ParticipantRole;

  /**
   * 状态
   */
  status: ParticipantStatus;

  /**
   * 能力
   */
  capabilities?: string[];

  /**
   * 元数据
   */
  metadata?: JsonObject;
}

/**
 * 参与者类型
 */
export type ParticipantType = "agent" | "human" | "system";

/**
 * 参与者角色
 */
export type ParticipantRole =
  | "leader" // 领导者
  | "coordinator" // 协调者
  | "worker" // 执行者
  | "reviewer" // 审核者
  | "observer" // 观察者
  | string; // 自定义

/**
 * 参与者状态
 */
export type ParticipantStatus = "active" | "idle" | "busy" | "offline";

/**
 * 会话状态
 */
export type SessionStatus = "active" | "paused" | "completed" | "cancelled";

/**
 * 协作模式
 */
export type CollaborationPattern =
  | "handoff" // 交接模式
  | "voting" // 投票模式
  | "review" // 审核模式
  | "delegation" // 委派模式
  | "broadcast" // 广播模式
  | "pipeline"; // 管道模式

/**
 * 交接请求
 */
export interface HandoffRequest {
  /**
   * 源 Agent ID
   */
  fromAgentId: string;

  /**
   * 目标 Agent ID
   */
  toAgentId: string;

  /**
   * 交接原因
   */
  reason: string;

  /**
   * 交接上下文
   */
  context: JsonObject;

  /**
   * 任务信息
   */
  task?: {
    id: string;
    description: string;
    priority?: number;
  };
}

/**
 * 交接响应
 */
export interface HandoffResponse {
  /**
   * 是否接受
   */
  accepted: boolean;

  /**
   * 响应消息
   */
  message?: string;

  /**
   * 如果拒绝，建议的替代 Agent
   */
  suggestedAgent?: string;
}

/**
 * 投票请求
 */
export interface VoteRequest {
  /**
   * 投票 ID
   */
  id: string;

  /**
   * 主题
   */
  topic: string;

  /**
   * 选项
   */
  options: VoteOption[];

  /**
   * 投票策略
   */
  strategy: VotingStrategy;

  /**
   * 截止时间
   */
  deadline?: Date;

  /**
   * 发起者
   */
  initiator: string;
}

/**
 * 投票选项
 */
export interface VoteOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * 投票策略
 */
export type VotingStrategy =
  | "majority" // 多数票
  | "unanimous" // 一致同意
  | "weighted" // 加权投票
  | "ranked"; // 排名投票

/**
 * 投票结果
 */
export interface VoteResult {
  /**
   * 投票 ID
   */
  voteId: string;

  /**
   * 获胜选项
   */
  winner?: string;

  /**
   * 票数统计
   */
  tally: Record<string, number>;

  /**
   * 是否达成共识
   */
  consensus: boolean;

  /**
   * 参与者数量
   */
  participantCount: number;

  /**
   * 实际投票数量
   */
  voteCount: number;
}

/**
 * 审核请求
 */
export interface ReviewRequest {
  /**
   * 审核 ID
   */
  id: string;

  /**
   * 被审核的内容
   */
  content: unknown;

  /**
   * 内容类型
   */
  contentType: string;

  /**
   * 审核者 ID
   */
  reviewerId: string;

  /**
   * 提交者 ID
   */
  submitterId: string;

  /**
   * 审核标准
   */
  criteria?: string[];

  /**
   * 截止时间
   */
  deadline?: Date;
}

/**
 * 审核结果
 */
export interface ReviewResult {
  /**
   * 审核 ID
   */
  reviewId: string;

  /**
   * 审核状态
   */
  status: "approved" | "rejected" | "needs_revision";

  /**
   * 评分
   */
  score?: number;

  /**
   * 反馈
   */
  feedback?: string;

  /**
   * 建议
   */
  suggestions?: string[];

  /**
   * 审核者 ID
   */
  reviewerId: string;

  /**
   * 审核时间
   */
  reviewedAt: Date;
}

/**
 * 协作者接口
 */
export interface ICollaborator {
  /**
   * 协作者 ID
   */
  readonly id: string;

  /**
   * 发送消息
   */
  sendMessage(
    message: Omit<CollaborationMessage, "id" | "timestamp">,
  ): Promise<void>;

  /**
   * 接收消息
   */
  onMessage(handler: (message: CollaborationMessage) => void): void;

  /**
   * 发起交接
   */
  handoff(request: HandoffRequest): Promise<HandoffResponse>;

  /**
   * 发起投票
   */
  vote(request: VoteRequest): Promise<VoteResult>;

  /**
   * 请求审核
   */
  requestReview(request: ReviewRequest): Promise<ReviewResult>;

  /**
   * 加入会话
   */
  joinSession(sessionId: string): Promise<void>;

  /**
   * 离开会话
   */
  leaveSession(sessionId: string): Promise<void>;
}

/**
 * 协作管理器接口
 */
export interface ICollaborationManager {
  /**
   * 创建会话
   */
  createSession(options: CreateSessionOptions): Promise<CollaborationSession>;

  /**
   * 获取会话
   */
  getSession(sessionId: string): Promise<CollaborationSession | null>;

  /**
   * 添加参与者
   */
  addParticipant(sessionId: string, participant: Participant): Promise<void>;

  /**
   * 移除参与者
   */
  removeParticipant(sessionId: string, participantId: string): Promise<void>;

  /**
   * 广播消息
   */
  broadcast(
    sessionId: string,
    message: Omit<CollaborationMessage, "id" | "timestamp">,
  ): Promise<void>;

  /**
   * 结束会话
   */
  endSession(sessionId: string): Promise<void>;
}

/**
 * 创建会话选项
 */
export interface CreateSessionOptions {
  name?: string;
  participants?: Participant[];
  pattern?: CollaborationPattern;
  metadata?: JsonObject;
}
