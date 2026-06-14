/**
 * Type definitions for Explore component
 */

export interface Resource {
  id: string;
  type: string;
  title: string;
  abstract?: string;
  content?: string;
  aiSummary?: string;
  keyInsights?: AIInsight[];
  methodology?: string;
  publishedAt: string;
  sourceUrl: string;
  pdfUrl?: string;
  thumbnailUrl?: string;
  videoId?: string; // YouTube video ID
  authors?: Array<{ username?: string; platform?: string; name?: string }>;
  categories?: string[];
  qualityScore?: string;
  upvoteCount?: number;
  viewCount?: number;
  commentCount?: number;
  // Source information for display
  metadata?: {
    feedTitle?: string;
    channelName?: string;
    sourceName?: string;
    imageUrl?: string;
    [key: string]: unknown;
  };
  sourceType?: string;
  linkHealth?: string;
  // GitHub/原始数据增强
  rawData?: {
    readme?: string;
    description?: string;
    stars?: number;
    forks?: number;
    language?: string;
    languages?: Record<string, number>;
    contributors?: Array<unknown>;
    [key: string]: unknown;
  };
}

export interface SearchSuggestion {
  id: string;
  title: string;
  type: string;
  abstract: string;
  highlight: string;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface AIInsight {
  title: string;
  description: string;
  importance: 'high' | 'medium' | 'low';
}
