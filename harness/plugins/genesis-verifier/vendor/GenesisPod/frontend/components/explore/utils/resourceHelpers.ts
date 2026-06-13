/**
 * Helper functions for resource data processing
 */

import type { Resource } from './types';
import type { Resource as AIOfficeResource } from '@/lib/types/ai-office';

/**
 * Extract source name from resource metadata
 */
export function getSourceName(resource: Resource): string | null {
  // Try metadata fields first
  if (resource.metadata?.feedTitle) {
    return resource.metadata.feedTitle;
  }
  if (resource.metadata?.channelName) {
    return resource.metadata.channelName;
  }
  if (resource.metadata?.sourceName) {
    return resource.metadata.sourceName;
  }
  // Try authors (RSS feeds store channel name in author)
  if (resource.authors && resource.authors.length > 0) {
    const author = resource.authors[0];
    if (author.name) return author.name;
    if (author.username) return author.username;
  }
  // Try to extract from sourceUrl domain
  if (resource.sourceUrl) {
    try {
      const url = new URL(resource.sourceUrl);
      const hostname = url.hostname.replace('www.', '');
      // Known source domain mappings
      const domainMap: Record<string, string> = {
        'youtube.com': 'YouTube',
        'arxiv.org': 'arXiv',
        'github.com': 'GitHub',
        'medium.com': 'Medium',
        'news.ycombinator.com': 'Hacker News',
        'substack.com': 'Substack',
      };
      if (domainMap[hostname]) {
        return domainMap[hostname];
      }
      // Return cleaned domain name
      return hostname.split('.')[0];
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Get badge color based on source type or name
 */
export function getSourceBadgeColor(
  sourceName: string,
  resourceType: string
): string {
  const name = sourceName.toLowerCase();
  if (
    name.includes('youtube') ||
    resourceType === 'YOUTUBE_VIDEO' ||
    resourceType === 'YOUTUBE'
  ) {
    return 'bg-red-100 text-red-700';
  }
  if (name.includes('arxiv') || resourceType === 'PAPER') {
    return 'bg-orange-100 text-orange-700';
  }
  if (name.includes('github') || resourceType === 'PROJECT') {
    return 'bg-gray-100 text-gray-700';
  }
  if (name.includes('hacker') || resourceType === 'NEWS') {
    return 'bg-amber-100 text-amber-700';
  }
  if (resourceType === 'POLICY') {
    return 'bg-blue-100 text-blue-700';
  }
  if (resourceType === 'REPORT') {
    return 'bg-purple-100 text-purple-700';
  }
  if (resourceType === 'BLOG') {
    return 'bg-green-100 text-green-700';
  }
  return 'bg-gray-100 text-gray-600';
}

/**
 * Convert page Resource to AI Office Resource format
 */
export function convertToAIOfficeResource(
  resource: Resource
): Partial<AIOfficeResource> {
  const baseResource = {
    _id: resource.id,
    userId: 'current-user', // TODO: Get from auth
    resourceId: resource.id,
    status: 'collected' as const,
    collectedAt: new Date(),
    updatedAt: new Date(),
  };

  // Determine resource type and create appropriate structure
  if (resource.type === 'youtube') {
    return {
      ...baseResource,
      resourceType: 'youtube_video' as const,
      metadata: {
        title: resource.title,
        description: resource.abstract || '',
        channel: {
          id: '',
          name: '',
          subscribers: 0,
        },
        duration: '',
        publishedAt: new Date(),
        statistics: {
          views: 0,
          likes: 0,
          comments: 0,
        },
        thumbnails: {
          default: resource.thumbnailUrl || '',
          medium: resource.thumbnailUrl || '',
          high: resource.thumbnailUrl || '',
        },
        tags: [],
        category: '',
        language: '',
      },
      aiAnalysis: {
        summary: resource.aiSummary || resource.abstract || '',
        keyPoints: [],
        topics: [],
        entities: [],
        sentiment: {
          overall: 'neutral' as const,
          confidence: 0,
        },
        difficultyLevel: 'intermediate' as const,
        targetAudience: [],
        prerequisites: [],
        learningOutcomes: [],
      },
    };
  } else if (resource.type === 'paper') {
    return {
      ...baseResource,
      resourceType: 'academic_paper' as const,
      metadata: {
        title: resource.title,
        authors:
          resource.authors?.map((a) => ({
            name: a.name || a.username || '',
            affiliation: '',
          })) || [],
        abstract: resource.abstract || '',
        keywords: [],
        publishedAt: new Date(),
        venue: '',
        citations: 0,
      },
      aiAnalysis: {
        summary: resource.aiSummary || resource.abstract || '',
        contributions: [],
        methodology: '',
        results: '',
        limitations: [],
        futureWork: [],
        impact: 'medium' as const,
        field: '',
        subfields: [],
      },
    };
  } else {
    return {
      ...baseResource,
      resourceType: 'web_page' as const,
      metadata: {
        title: resource.title,
        description: resource.abstract || '',
        author:
          resource.authors?.[0]?.name || resource.authors?.[0]?.username || '',
        publishedAt: resource.publishedAt
          ? new Date(resource.publishedAt)
          : undefined,
        language: 'en',
      },
      aiAnalysis: {
        summary: resource.aiSummary || resource.abstract || '',
        mainTopics: [],
        keyInsights: [],
        credibility: 0,
      },
    };
  }
}
