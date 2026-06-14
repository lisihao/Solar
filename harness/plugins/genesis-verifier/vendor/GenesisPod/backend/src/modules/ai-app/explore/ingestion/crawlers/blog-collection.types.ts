/**
 * Blog Collection Types
 * Defines interfaces and types for blog collection system
 */

export type BlogSourceCategory = "enterprise" | "analyst" | "research";

export interface BlogSource {
  id: string;
  name: string;
  displayName: string;
  category: BlogSourceCategory;
  blogUrl?: string;
  logoUrl?: string;
  rssFeeds?: string[];
  isActive: boolean;
  lastCollected?: Date;
}

export interface CollectedBlogPost {
  id: string;
  title: string;
  excerpt?: string;
  content?: string;
  sourceUrl: string;
  sourceId: string;
  sourceName: string;
  publishedAt: Date;
  category?: string;
  tags?: string[];
  author?: string;
  imageUrl?: string;
  contentHash: string; // For duplicate detection
}

export interface CollectionTask {
  id: string;
  sourceId: string;
  sourceName: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  postsCollected: number;
  postsSaved: number;
  error?: string;
  startTime?: Date;
  endTime?: Date;
  retryCount: number;
}

export interface SchedulerConfig {
  enabled: boolean;
  cronExpression: string;
  maxConcurrent: number;
  activeTasks: number;
  lastRun?: Date;
  nextRun?: Date;
}

export interface CollectionStats {
  totalPosts: number;
  totalSources: number;
  activeTasks: number;
  collectionStatus: "active" | "inactive" | "error";
  lastCollectionTime?: Date;
  averageCollectionDuration: number; // in seconds
}

export interface BlogCollectionOptions {
  sourceId?: string;
  force?: boolean;
  retryFailed?: boolean;
  categories?: string[];
  limit?: number;
}

export interface RSSFeedItem {
  title: string;
  link?: string;
  description?: string;
  pubDate?: string;
  author?: string;
  categories?: string[];
}

export interface WebScrapedPost {
  title: string;
  url: string;
  excerpt?: string;
  publishedDate?: Date;
  author?: string;
  contentHtml?: string;
}
