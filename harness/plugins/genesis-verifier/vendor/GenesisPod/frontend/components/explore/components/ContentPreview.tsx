'use client';

import { Resource } from '../utils/types';
import { extractYouTubeVideoId, getResourceDisplayMode } from '../utils';
import PDFViewer from '@/components/ui/viewers/PDFViewer';
import HTMLViewer from '@/components/ui/viewers/HTMLViewer';
import ReaderView from '@/components/ui/viewers/ReaderView';
import TextSelectionToolbar from '@/components/ui/content/TextSelectionToolbar';

interface ContentPreviewProps {
  selectedResource: Resource;
  htmlViewMode: 'reader' | 'original';
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

export default function ContentPreview({
  selectedResource,
  htmlViewMode,
  onArticleLoaded,
  onAddToNotes,
  onAskAI,
}: ContentPreviewProps) {
  const displayMode = getResourceDisplayMode(selectedResource);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* PDF Viewer — only when displayMode is 'pdf' */}
      {displayMode === 'pdf' ? (
        <TextSelectionToolbar
          resourceId={selectedResource.id}
          onAddToNotes={onAddToNotes}
          onAskAI={onAskAI}
          showClipboardFAB={true}
          className="h-full w-full flex-1"
        >
          <PDFViewer
            url={selectedResource.pdfUrl || selectedResource.sourceUrl}
            title={selectedResource.title}
            className="h-full w-full"
          />
        </TextSelectionToolbar>
      ) : displayMode === 'youtube' ? (
        // YouTube Video Player
        (() => {
          const videoId = extractYouTubeVideoId(selectedResource.sourceUrl);
          return videoId ? (
            <div className="flex h-full w-full flex-col bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`}
                title={selectedResource.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-900">
              <div className="text-center text-white">
                <svg
                  className="mx-auto h-16 w-16 text-red-500"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                </svg>
                <p className="mt-4 text-lg font-medium">无法加载视频</p>
                <a
                  href={selectedResource.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-blue-400 hover:underline"
                >
                  在 YouTube 上观看
                </a>
              </div>
            </div>
          );
        })()
      ) : displayMode === 'html' ? (
        // HTML Viewer (Reader or Original)
        htmlViewMode === 'reader' ? (
          <TextSelectionToolbar
            resourceId={selectedResource.id}
            onAddToNotes={onAddToNotes}
            onAskAI={onAskAI}
            className="h-full w-full flex-1"
          >
            <ReaderView
              url={selectedResource.sourceUrl}
              title={selectedResource.title}
              category={selectedResource.type}
              isImportedResource={true}
              fallbackContent={
                selectedResource.content || selectedResource.abstract
              }
              className="h-full w-full"
              onArticleLoaded={onArticleLoaded}
            />
          </TextSelectionToolbar>
        ) : (
          <TextSelectionToolbar
            resourceId={selectedResource.id}
            onAddToNotes={onAddToNotes}
            onAskAI={onAskAI}
            className="h-full w-full flex-1"
          >
            <HTMLViewer
              url={selectedResource.sourceUrl}
              title={selectedResource.title}
              className="h-full w-full"
            />
          </TextSelectionToolbar>
        )
      ) : (
        // No Preview Available
        <div className="flex h-full w-full items-center justify-center bg-gray-50">
          <div className="text-center">
            <svg
              className="mx-auto h-16 w-16 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="mt-4 text-lg font-medium text-gray-600">预览不可用</p>
            <p className="mt-2 text-sm text-gray-500">
              该资源暂无可用的PDF或HTML预览
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
