/**
 * ai-engine/content/sources — 通用 ContentSource 契约
 *
 * 2026-05-24 P17a: 从 ai-app/contracts/social-data-source 上提为 engine 通用契约。
 *
 * 设计原则:
 *   - 任何 ai-app 都可以"暴露内容"，统一通过 ContentSource 提供。
 *   - consumer 通过 ContentSourceRegistry 拉取，**不直接 import 任何兄弟
 *     ai-app 模块**。
 *   - provider id 字段保留兼容（运行时标识 + DB / 前端 mapping，不改名）。
 *
 * MECE 红线:
 *   - engine 不知道 agent / mission / social。本契约纯结构化数据接口，零业务语义。
 */

/**
 * Single item exposed by a content source (list view).
 */
export interface SourceItem {
  id: string;
  title: string;
  preview?: string;
  contentKind: "article" | "video" | "report" | "note" | "other";
  wordCount?: number;
  durationSec?: number;
  thumbnailUrl?: string;
  createdAt: string;
  tags?: string[];
}

/**
 * Filter options for listing items from a content source.
 */
export interface SourceListFilter {
  search?: string;
  tags?: string[];
  dateRange?: { from: string; to: string };
  cursor?: string;
  limit?: number;
}

/**
 * Paginated result from listing items.
 */
export interface SourceListResult {
  items: SourceItem[];
  nextCursor?: string;
}

/**
 * Full content bundle fetched from a content source (detail view).
 */
export interface SourceContentBundle {
  sourceType: string;
  sourceId: string;
  title: string;
  body: string;
  bodyMime: "text/markdown" | "text/html" | "text/plain";
  sourceMetadata: Record<string, unknown>;
  displayMetadata: Record<string, unknown>;
}

/**
 * Descriptor — metadata for picker UI without item data.
 */
export interface ContentSourceDescriptor {
  id: string;
  displayName: { "zh-CN": string; "en-US": string };
  icon: string;
  description: { "zh-CN": string; "en-US": string };
  contentKinds: ReadonlyArray<SourceItem["contentKind"]>;
  maxItemsPerTask?: number;
}

/**
 * Full ContentSource provider interface.
 *
 * Implemented by each ai-app's `<app>-content-source.provider.ts` and registered
 * via `@ContentSourceProvider()` decorator. Consumers (e.g. ai-app/social) pull
 * from `ContentSourceRegistry` — they never import provider classes directly.
 */
export interface ContentSource extends ContentSourceDescriptor {
  listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<SourceListResult>;
  fetchBundle(
    itemIds: string[],
    userId: string,
  ): Promise<SourceContentBundle[]>;
}
