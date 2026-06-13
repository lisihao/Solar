'use client';

import { Resource } from '../utils/types';
import ResourceHeader from './ResourceHeader';
import ContentPreview from './ContentPreview';

interface DetailViewProps {
  selectedResource: Resource;
  htmlViewMode: 'reader' | 'original';
  setHtmlViewMode: (mode: 'reader' | 'original') => void;
  isHeaderCollapsed: boolean;
  setIsHeaderCollapsed: (collapsed: boolean) => void;
  onBackToList: () => void;
  onToggleBookmark: (resourceId: string, e?: React.MouseEvent) => void;
  onToggleUpvote: (resourceId: string, e: React.MouseEvent) => void;
  isBookmarked: (resourceId: string) => boolean;
  hasUpvoted: (resourceId: string) => boolean;
  onArticleLoaded: (article: {
    success: boolean;
    title: string;
    content: string;
    textContent: string;
    excerpt?: string;
    byline?: string;
    siteName?: string;
    length?: number;
    sourceUrl: string;
  }) => void;
  onAddToNotes: (text: string) => void;
  onAskAI: (text: string) => void;
}

export default function DetailView({
  selectedResource,
  htmlViewMode,
  setHtmlViewMode,
  isHeaderCollapsed,
  setIsHeaderCollapsed,
  onBackToList,
  onToggleBookmark,
  onToggleUpvote,
  isBookmarked,
  hasUpvoted,
  onArticleLoaded,
  onAddToNotes,
  onAskAI,
}: DetailViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Resource Header */}
      <ResourceHeader
        selectedResource={selectedResource}
        htmlViewMode={htmlViewMode}
        setHtmlViewMode={setHtmlViewMode}
        isHeaderCollapsed={isHeaderCollapsed}
        setIsHeaderCollapsed={setIsHeaderCollapsed}
        onBackToList={onBackToList}
        onToggleBookmark={onToggleBookmark}
        onToggleUpvote={onToggleUpvote}
        isBookmarked={isBookmarked}
        hasUpvoted={hasUpvoted}
      />

      {/* Content Preview */}
      <ContentPreview
        selectedResource={selectedResource}
        htmlViewMode={htmlViewMode}
        onArticleLoaded={onArticleLoaded}
        onAddToNotes={onAddToNotes}
        onAskAI={onAskAI}
      />
    </div>
  );
}
