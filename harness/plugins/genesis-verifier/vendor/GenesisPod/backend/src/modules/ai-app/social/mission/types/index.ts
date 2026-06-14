/**
 * AI Social 模块类型定义
 *
 * 注意：这些类型与 Prisma schema 中定义的枚举一致
 * 当 Prisma 迁移运行后，应从 @prisma/client 导入
 */

export enum SocialPlatformType {
  WECHAT_MP = "WECHAT_MP",
  XIAOHONGSHU = "XIAOHONGSHU",
}

export enum SocialContentType {
  WECHAT_ARTICLE = "WECHAT_ARTICLE",
  XIAOHONGSHU_NOTE = "XIAOHONGSHU_NOTE",
}

export enum SocialContentStatus {
  DRAFT = "DRAFT",
  PENDING = "PENDING",
  SCHEDULED = "SCHEDULED",
  PUBLISHING = "PUBLISHING",
  PUBLISHED = "PUBLISHED",
  FAILED = "FAILED",
}

export enum SocialContentSourceType {
  MANUAL = "MANUAL",
  EXTERNAL_URL = "EXTERNAL_URL",
  AI_EXPLORE = "AI_EXPLORE",
  AI_RESEARCH = "AI_RESEARCH",
  AI_OFFICE = "AI_OFFICE",
  AI_WRITING = "AI_WRITING",
  AI_TOPIC_INSIGHTS = "AI_TOPIC_INSIGHTS",
}

export enum SocialReviewStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  REVISION_REQUESTED = "REVISION_REQUESTED",
}

export interface SocialPlatformConnection {
  id: string;
  userId: string;
  platformType: SocialPlatformType;
  accountName?: string | null;
  accountId?: string | null;
  avatarUrl?: string | null;
  sessionData?: string | null; // 加密存储的 session 数据
  isActive: boolean;
  lastCheckAt?: Date | null;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialContent {
  id: string;
  userId: string;
  connectionId?: string | null;
  contentType: SocialContentType;
  sourceType: SocialContentSourceType;
  sourceId?: string | null;
  sourceUrl?: string | null;
  title: string; // ★ 必填字段，与 Prisma schema 一致
  content: string;
  author?: string | null;
  digest?: string | null;
  coverImageUrl?: string | null;
  images: string[];
  tags: string[];
  location?: string | null;
  status: SocialContentStatus;
  reviewStatus?: SocialReviewStatus | null;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
  complianceCheck?: unknown;
  scheduledAt?: Date | null;
  publishedAt?: Date | null;
  externalId?: string | null;
  externalUrl?: string | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
  connection?: SocialPlatformConnection | null;
  versions?: SocialContentVersion[];
}

export interface SocialContentVersion {
  id: string;
  contentId: string;
  platformType: SocialPlatformType;
  title: string;
  content: string;
  digest?: string | null;
  isDefault: boolean;
  generatedBy?: string | null; // "AI" | "MANUAL"
  createdAt: Date;
  updatedAt: Date;
}
