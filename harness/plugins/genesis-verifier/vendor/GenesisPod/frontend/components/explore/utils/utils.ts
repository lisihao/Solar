/**
 * Utility functions for Explore component
 */

import type { Resource, AIInsight } from './types';

/**
 * Determine the content display mode for a resource.
 *
 * Single source of truth — used by ExploreContent, ExploreDetail, and ContentPreview.
 *
 * Rules:
 *  1. sourceUrl or pdfUrl containing "/html/" → always HTML (never PDF)
 *  2. sourceUrl ending with ".pdf" → PDF
 *  3. pdfUrl ending with ".pdf" or containing "/pdf/" → PDF
 *  4. YouTube URLs → YOUTUBE
 *  5. Everything else with a sourceUrl → HTML
 *  6. No sourceUrl → NONE
 */
export function getResourceDisplayMode(
  resource: Pick<Resource, 'type' | 'sourceUrl' | 'pdfUrl'>
): 'pdf' | 'html' | 'youtube' | 'none' {
  const { sourceUrl, pdfUrl } = resource;

  // YouTube detection (before PDF — some YouTube URLs could have .pdf in query)
  if (resource.type === 'YOUTUBE' || resource.type === 'YOUTUBE_VIDEO') {
    return 'youtube';
  }

  // HTML override: if either URL points to an HTML page, never use PDF viewer
  if (sourceUrl?.includes('/html/') || pdfUrl?.includes('/html/')) {
    return sourceUrl ? 'html' : 'none';
  }

  // PDF detection: sourceUrl itself is a PDF file
  if (sourceUrl?.toLowerCase().endsWith('.pdf')) {
    return 'pdf';
  }

  // PDF detection: sourceUrl path is a PDF endpoint (e.g. openreview.net/pdf?id=xxx)
  if (sourceUrl) {
    try {
      const pathname = new URL(sourceUrl).pathname;
      if (pathname === '/pdf' || pathname.endsWith('/pdf')) {
        return 'pdf';
      }
    } catch {
      // invalid URL, skip
    }
  }

  // PDF detection: pdfUrl points to a real PDF
  if (pdfUrl) {
    if (pdfUrl.endsWith('.pdf') || pdfUrl.includes('/pdf/')) {
      return 'pdf';
    }
    // pdfUrl path is a PDF endpoint (e.g. openreview.net/pdf?id=xxx)
    try {
      const pathname = new URL(pdfUrl).pathname;
      if (pathname === '/pdf' || pathname.endsWith('/pdf')) {
        return 'pdf';
      }
    } catch {
      // invalid URL, skip
    }
  }

  // Fallback: any resource with a sourceUrl → HTML viewer
  if (sourceUrl) {
    return 'html';
  }

  return 'none';
}

/**
 * Extract base64 images from markdown content
 */
export function extractImagesFromMarkdown(content: string): {
  images: Array<{ alt: string; src: string }>;
  textContent: string;
} {
  const imageRegex =
    /!\[([^\]]*)\]\s*\(\s*(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)\s*\)/g;
  const images: Array<{ alt: string; src: string }> = [];
  let textContent = content;

  let match;
  while ((match = imageRegex.exec(content)) !== null) {
    images.push({
      alt: match[1] || 'Generated Image',
      src: match[2],
    });
  }

  textContent = content.replace(imageRegex, '').trim();

  // Also try standalone base64 data
  if (images.length === 0 && content.includes('data:image/')) {
    const standaloneBase64Regex =
      /(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)/g;
    let standaloneMatch;
    while ((standaloneMatch = standaloneBase64Regex.exec(content)) !== null) {
      images.push({
        alt: 'Generated Image',
        src: standaloneMatch[1],
      });
    }
    textContent = content
      .replace(standaloneBase64Regex, '')
      .replace(/!\[[^\]]*\]\s*\(\s*\)/g, '')
      .replace(/!\[[^\]]*\]/g, '')
      .trim();
  }

  return { images, textContent };
}

/**
 * Extract YouTube video ID from URL
 * Supports various formats:
 * - youtube.com/watch?v=ID
 * - youtube.com/watch?app=desktop&v=ID (with other params before v)
 * - youtu.be/ID
 * - youtube.com/embed/ID
 * - youtube.com/v/ID
 * - youtube.com/shorts/ID
 */
export function extractYouTubeVideoId(url: string): string | null {
  if (!url) return null;

  // Handle watch URLs with query parameters (v can be anywhere in query string)
  if (url.includes('youtube.com/watch')) {
    const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
  }

  // Handle other URL formats
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract arXiv paper ID from URL
 */
export function extractArxivId(url: string): string | null {
  if (!url) return null;
  // Match arxiv.org/abs/2312.12345 or arxiv.org/pdf/2312.12345
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Get resource thumbnail URL based on resource type
 * Priority: thumbnailUrl > dynamically generated > metadata.imageUrl
 */
export function getResourceThumbnail(resource: Resource): string | null {
  // 1. If thumbnailUrl exists, return it
  if (resource.thumbnailUrl) {
    return resource.thumbnailUrl;
  }

  // 2. YouTube video - build thumbnail URL from sourceUrl
  if (resource.type === 'YOUTUBE' || resource.type === 'YOUTUBE_VIDEO') {
    const videoId = extractYouTubeVideoId(resource.sourceUrl);
    if (videoId) {
      // Use mqdefault (320x180) for list thumbnails, more reliable than maxresdefault
      return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    }
  }

  // 3. arXiv paper - use ar5iv thumbnail service
  if (resource.type === 'PAPER' && resource.sourceUrl?.includes('arxiv.org')) {
    const arxivId = extractArxivId(resource.sourceUrl);
    if (arxivId) {
      // ar5iv provides HTML rendered version, can get first page preview
      // or use arxiv-vanity's thumbnail service
      return `https://arxiv.org/html/${arxivId}/extraction/figure/page_001_figure_001.png`;
    }
  }

  // 4. Get imageUrl from metadata (og:image for blogs/news)
  if (resource.metadata?.imageUrl) {
    return resource.metadata.imageUrl;
  }

  // 5. No available thumbnail
  return null;
}

/**
 * Parse markdown format to insights array
 */
export function parseMarkdownToInsights(markdown: string): AIInsight[] {
  const insights: AIInsight[] = [];

  // Split by #### headings (numbered items)
  const sections = markdown.split(/####\s+\d+\.\s+/);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i].trim();
    if (!section) continue;

    // Extract title (first line before newline or **)
    const titleMatch = section.match(/^([^\n*]+)/);
    const title = titleMatch ? titleMatch[1].trim() : '未命名';

    // Extract importance if present
    let importance: 'high' | 'medium' | 'low' = 'medium';
    if (
      section.includes('重要性：高') ||
      section.includes('importance: high') ||
      section.includes('**重要性：高**')
    ) {
      importance = 'high';
    } else if (
      section.includes('重要性：低') ||
      section.includes('importance: low') ||
      section.includes('**重要性：低**')
    ) {
      importance = 'low';
    }

    // Extract description (text after the importance line or after first newline)
    let description = section;
    // Remove title from description
    description = description.replace(/^([^\n*]+)/, '');
    // Remove importance markers
    description = description.replace(/\*\*重要性：[^*]+\*\*/g, '').trim();
    description = description.replace(/重要性：[^\n]+/g, '').trim();
    // Take first few lines as description
    const lines = description.split('\n').filter((line) => line.trim());
    description = lines.slice(0, 3).join(' ').substring(0, 200);

    if (title && description) {
      insights.push({ title, description, importance });
    }
  }

  return insights.length > 0 ? insights : [];
}
