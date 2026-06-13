/**
 * AI Social Task — 意图驱动重设计 v1 数据类型
 *
 * 与后端 `SocialContentTask` / `SocialContentTaskSource` / `SocialContentTaskVersion`
 * （prisma/schema/models.prisma）以及 `CreateSocialTaskDto` 对齐。
 */

export type SocialContentTaskStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'DRAFT_READY'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIAL_PUBLISHED'
  | 'FAILED'
  | 'CANCELLED';

export type SocialContentVersionStatus =
  | 'GENERATING'
  | 'DRAFT_READY'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED';

export type SourceContentKind =
  | 'article'
  | 'video'
  | 'report'
  | 'note'
  | 'other';

/** 来源 item — 由 `SocialDataSource.listItems(userId, filter)` 返回 */
export interface SourceItem {
  id: string;
  title: string;
  preview?: string;
  contentKind: SourceContentKind;
  wordCount?: number;
  durationSec?: number;
  thumbnailUrl?: string;
  createdAt: string;
  tags?: string[];
}

export interface SourceListResult {
  items: SourceItem[];
  nextCursor?: string;
}

/** 单个数据源 descriptor — GET /ai-social/data-sources 返回 */
export interface SocialDataSourceDescriptor {
  id: string;
  displayName: { 'zh-CN': string; 'en-US': string };
  icon: string;
  description: { 'zh-CN': string; 'en-US': string };
  contentKinds: SourceContentKind[];
  maxItemsPerTask?: number;
}

/** 任务来源条目 */
export interface SocialContentTaskSource {
  id: string;
  taskId: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  /** 来源标题（dispatch 时从 bundle 回写；参考文献 tab 明细） */
  title?: string | null;
  /** 来源链接（有则可点开；笔记类来源可能为 null） */
  url?: string | null;
}

/** 平台版本 */
export interface SocialContentTaskVersion {
  id: string;
  taskId: string;
  platform: string;
  status: SocialContentVersionStatus;
  title: string;
  content: string;
  bodyMime: string;
  digest?: string | null;
  tags: string[];
  coverMediaId?: string | null;
  /** 可渲染的封面图 URL（输出报告 tab 文章预览用；来自 s5 cover-artist） */
  coverImageUrl?: string | null;
  publishedAt?: string | null;
  externalUrl?: string | null;
  errorMessage?: string | null;
}

/** 完整任务对象 */
export interface SocialContentTask {
  id: string;
  userId: string;
  status: SocialContentTaskStatus;
  /** 任务名称 — 创建时自动派生（首个源条目标题 + 等 N 项），可在 NewTaskDialog 内覆盖 */
  title?: string | null;
  prompt?: string | null;
  externalUrls: string[];
  platforms: string[];
  accountIds: Record<string, string>;
  missionId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  sources?: SocialContentTaskSource[];
  versions?: SocialContentTaskVersion[];
}

/** 列表返回（cursor 分页） */
export interface SocialContentTaskListResult {
  items: SocialContentTask[];
  nextCursor?: string;
}

/**
 * Mission 持久化快照 — GET /ai-social/tasks/:id/mission-snapshot 返回。
 * mission 结束、内存事件 buffer 过期（1h TTL）后，前端用它回显历史算力 + 终态。
 * status 为后端 SocialMission.status（小写：'completed' | 'failed' | 'running'…）。
 */
export interface SocialMissionSnapshot {
  missionId: string | null;
  status: string | null;
  tokensUsed: number;
  costUsd: number;
  wallTimeMs: number | null;
  completedAt: string | null;
  errorMessage: string | null;
}

/** 创建任务请求 */
export interface CreateSocialTaskInput {
  sources: { sourceType: string; sourceId: string }[];
  externalUrls?: string[];
  /** 任务名称（自动派生 + 用户可改） */
  title?: string;
  prompt?: string;
  platforms: ('WECHAT_MP' | 'XIAOHONGSHU')[];
  accountIds: Record<string, string>;
  depth?: 'quick' | 'standard' | 'deep';
}

/** 主弹窗中已选 item 的统一形态（每个 item 自带 sourceType） */
export interface PickedSourceItem extends SourceItem {
  sourceType: string;
}
