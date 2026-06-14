/**
 * 平台适配器类型定义
 */

import { SocialPlatformType, SocialContent } from "./index";

// ==================== 会话相关 ====================

export interface SessionData {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  // 平台特定数据
  wechatToken?: string;
}

export interface LoginSession {
  sessionKey: string;
  qrCodeBase64?: string;
  qrCodeUrl?: string;
  expiresAt: Date;
  status: "pending" | "scanning" | "confirmed" | "expired";
}

export interface SessionValidationResult {
  valid: boolean;
  reason?: string;
  expiredCookies?: string[];
  missingCookies?: string[];
}

// ==================== 发布相关 ====================

export type PublishMode = "draft" | "publish";

export interface PublishOptions {
  mode: PublishMode;
  scheduledAt?: Date;
  retryOnFailure?: boolean;
  maxRetries?: number;
  // 平台特定选项
  wechatOptions?: {
    sendPreview?: boolean;
    previewOpenId?: string;
  };
  xhsOptions?: {
    location?: string;
    allowComment?: boolean;
  };
}

export interface PublishResult {
  success: boolean;
  type: "draft" | "published";
  externalId?: string;
  externalUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  debugInfo?: DebugInfo;
  duration?: number;
}

export interface DraftResult {
  success: boolean;
  draftId?: string;
  draftUrl?: string;
  error?: string;
}

export interface DebugInfo {
  url?: string;
  screenshot?: string;
  pageTitle?: string;
  htmlSnippet?: string;
  timestamp: Date;
}

// ==================== 数据分析相关 ====================

export interface AnalyticsData {
  followers?: number;
  following?: number;
  likes?: number;
  views?: number;
  articles?: number;
  notes?: number;
  comments?: number;
  shares?: number;
  lastUpdated?: Date;
}

export interface ArticleStats {
  id: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  publishedAt: Date;
}

// ==================== 适配器接口 ====================

export interface IPlatformAdapter {
  readonly platformType: SocialPlatformType;
  readonly name: string;
  readonly supportsMcp: boolean;

  // 登录管理
  initLogin(): Promise<LoginSession>;
  checkLoginStatus(sessionKey: string): Promise<LoginStatusResult>;
  validateSession(sessionData: SessionData): Promise<SessionValidationResult>;
  refreshSession(sessionData: SessionData): Promise<SessionData | null>;

  // 发布能力
  publish(
    content: SocialContent,
    sessionData: SessionData,
    options: PublishOptions,
  ): Promise<PublishResult>;
  saveDraft(
    content: SocialContent,
    sessionData: SessionData,
  ): Promise<DraftResult>;

  // 数据能力（可选）
  getAnalytics?(sessionData: SessionData): Promise<AnalyticsData>;
  getPublishedArticles?(sessionData: SessionData): Promise<ArticleStats[]>;
}

export interface LoginStatusResult {
  loggedIn: boolean;
  accountName?: string;
  accountId?: string;
  avatarUrl?: string;
  sessionData?: SessionData;
}

// ==================== 队列相关 ====================

export interface PublishJobData {
  contentId: string;
  userId: string;
  platformType: SocialPlatformType;
  options: PublishOptions;
}

export interface PublishJobResult {
  success: boolean;
  result?: PublishResult;
  error?: string;
  attempts: number;
  duration: number;
}

export type JobStatus =
  | "pending"
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "delayed";

export interface JobStatusInfo {
  status: JobStatus;
  progress?: number;
  result?: PublishJobResult;
  failReason?: string;
  nextRetryAt?: Date;
}

// ==================== 频率限制相关 ====================

export interface RateLimitConfig {
  maxPerDay: number;
  maxPerHour: number;
  minIntervalMinutes: number;
  cooldownAfterFailure?: number; // 失败后冷却时间（分钟）
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  nextAvailableAt?: Date;
  remainingToday?: number;
  remainingThisHour?: number;
}

// ==================== MCP 相关 ====================

export type MCPTransportType = "stdio" | "http" | "sse";

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransportType;
  // stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http/sse transport
  url?: string;
  // common options
  autoReconnect?: boolean;
  timeout?: number;
  healthCheckInterval?: number;
  restartOnFailure?: boolean;
}

export interface MCPToolCall {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
