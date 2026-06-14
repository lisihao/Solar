'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { config } from '@/lib/utils/config';
import NoteEditor from '@/components/library/resources/NoteEditor';
import NotesList from '@/components/common/resource-lists/NotesList';
import CommentsList from '@/components/common/comments/CommentsList';
import AppShell from '@/components/layout/AppShell';
import dynamic from 'next/dynamic';
import {
  StructuredAISummaryRouter,
  isStructuredAISummary,
  convertToStructuredSummary,
} from '@/components/library/resources/StructuredAISummary';
import TextSelectionToolbar from '@/components/ui/content/TextSelectionToolbar';
import ClientDate from '@/components/common/ClientDate';

// Dynamic import for PDF viewer (client-side only)
const PDFViewerClient = dynamic(
  () => import('@/components/ui/viewers/PDFViewerClient'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 items-center justify-center rounded-lg bg-gray-100">
        Loading PDF viewer...
      </div>
    ),
  }
);

import type { ResourceAISummary } from '@/lib/types/ai-office';

import { logger } from '@/lib/utils/logger';
interface Resource {
  id: string;
  type: string;
  title: string;
  abstract?: string;
  content?: string;
  sourceUrl: string;
  pdfUrl?: string;
  thumbnailUrl?: string;
  codeUrl?: string;
  authors?: Array<{ name?: string; username?: string; platform?: string }>;
  publishedAt: string;
  aiSummary?: string | ResourceAISummary;
  structuredAISummary?: ResourceAISummary; // Added field
  keyInsights?: Array<{
    title: string;
    importance: string;
    description: string;
  }>;
  categories?: string[];
  tags?: string[];
  qualityScore?: string;
  viewCount: number;
  saveCount: number;
  upvoteCount: number;
  commentCount: number;
}

export default function ResourcePage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [resource, setResource] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'ai' | 'notes' | 'comments' | 'similar' | 'image'
  >('ai');
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | undefined>(
    undefined
  );
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [showAskAI, setShowAskAI] = useState(false);
  const [askAIText, setAskAIText] = useState('');

  useEffect(() => {
    loadResource();
  }, [id]);

  // Auto-generate summary if missing when on AI tab
  useEffect(() => {
    if (
      resource &&
      activeTab === 'ai' &&
      !resource.structuredAISummary &&
      !isGeneratingSummary
    ) {
      generateAISummary();
    }
  }, [resource, activeTab]);

  const loadResource = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/resources/${id}`
      );
      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;
        setResource(data);
      }
    } catch (err) {
      logger.error('Failed to load resource:', err);
    } finally {
      setLoading(false);
    }
  };

  const generateAISummary = async () => {
    if (!resource) return;

    try {
      setIsGeneratingSummary(true);
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/resources/${resource.id}/enrich-structured`,
        {
          method: 'POST',
        }
      );

      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const updatedResource = result?.data ?? result;
        setResource((prev) =>
          prev ? { ...prev, ...updatedResource } : updatedResource
        );
      }
    } catch (err) {
      logger.error('Failed to generate AI summary:', err);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const toggleBookmark = async () => {
    // TODO: Implement bookmark toggle
    setIsBookmarked(!isBookmarked);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-red-600"></div>
      </div>
    );
  }

  if (!resource) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="mb-2 text-2xl font-bold text-gray-900">
            Resource not found
          </h2>
          <p className="mb-4 text-gray-600">
            The resource you're looking for doesn't exist.
          </p>
          <Link href="/" className="text-red-600 hover:text-red-700">
            Return to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-8 py-8">
          {/* Back Button */}
          <button
            onClick={() => router.back()}
            className="mb-6 inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            <svg
              className="mr-2 h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </button>

          {/* Resource Header */}
          <div className="mb-6 rounded-lg bg-white p-8 shadow-sm">
            <div className="mb-4 flex items-start justify-between">
              <div className="flex-1">
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium uppercase text-red-800">
                    {resource.type}
                  </span>
                  {resource.categories &&
                    resource.categories.map((cat, idx) => (
                      <span
                        key={idx}
                        className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                      >
                        {cat}
                      </span>
                    ))}
                </div>
                <h1 className="mb-3 text-3xl font-bold text-gray-900">
                  {resource.title}
                </h1>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  {resource.authors && resource.authors.length > 0 && (
                    <div className="flex items-center gap-2">
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                      <span>
                        {resource.authors
                          .map((a) => a.name || a.username)
                          .join(', ')}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <span>
                      <ClientDate date={resource.publishedAt} format="date" />
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={toggleBookmark}
                className={`rounded-lg p-3 transition-colors ${
                  isBookmarked
                    ? 'bg-red-100 text-red-600 hover:bg-red-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <svg
                  className="h-6 w-6"
                  fill={isBookmarked ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                  />
                </svg>
              </button>
            </div>

            {/* Paper-specific metadata */}
            {resource.type === 'PAPER' && (
              <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
                <h3 className="mb-3 font-semibold text-blue-900">
                  Paper Information
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {resource.authors && resource.authors.length > 0 && (
                    <div>
                      <span className="font-medium text-blue-700">
                        Authors:
                      </span>
                      <p className="mt-1 text-gray-700">
                        {resource.authors
                          .map((a) => a.name || a.username)
                          .join(', ')}
                      </p>
                    </div>
                  )}
                  {resource.publishedAt && (
                    <div>
                      <span className="font-medium text-blue-700">
                        Published:
                      </span>
                      <p className="mt-1 text-gray-700">
                        <ClientDate date={resource.publishedAt} format="date" />
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Abstract - with Text Selection Toolbar */}
            {resource.abstract && (
              <TextSelectionToolbar
                resourceId={resource.id}
                onAddToNotes={(text, note) => {
                  logger.debug('Added to notes:', { text, note });
                  // Refresh notes if on notes tab
                  if (activeTab === 'notes') {
                    // Component will auto-refresh
                  }
                }}
                onTranslate={(text, lang, translation) => {
                  logger.debug('Translated:', { text, lang, translation });
                }}
                onHighlight={(text, color) => {
                  logger.debug('Highlighted:', { text, color });
                }}
                onAskAI={(text) => {
                  setAskAIText(text);
                  setShowAskAI(true);
                  setActiveTab('ai');
                }}
              >
                <div className="mt-6 rounded-lg bg-gray-50 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-gray-700">
                    Abstract
                  </h3>
                  <p className="select-text leading-relaxed text-gray-700">
                    {resource.abstract}
                  </p>
                </div>
              </TextSelectionToolbar>
            )}

            {/* Links */}
            <div className="mt-6 flex gap-3">
              <a
                href={resource.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700"
              >
                <svg
                  className="mr-2 h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                View Source
              </a>
              {resource.pdfUrl && (
                <a
                  href={resource.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-lg bg-gray-600 px-4 py-2 text-white transition-colors hover:bg-gray-700"
                >
                  <svg
                    className="mr-2 h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Download PDF
                </a>
              )}
              {resource.codeUrl && (
                <a
                  href={resource.codeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-lg bg-gray-800 px-4 py-2 text-white transition-colors hover:bg-gray-900"
                >
                  <svg
                    className="mr-2 h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                    />
                  </svg>
                  View Code
                </a>
              )}
            </div>
          </div>

          {/* AI Summary - Using Structured AI Summary Components */}
          {(resource.structuredAISummary || resource.aiSummary) && (
            <div className="mb-6">
              {resource.structuredAISummary ? (
                <StructuredAISummaryRouter
                  summary={
                    resource.structuredAISummary as unknown as ResourceAISummary
                  }
                  compact={false}
                  expandable={true}
                />
              ) : isStructuredAISummary(resource.aiSummary) ? (
                <StructuredAISummaryRouter
                  summary={resource.aiSummary as unknown as ResourceAISummary}
                  compact={false}
                  expandable={true}
                />
              ) : typeof resource.aiSummary === 'string' ? (
                <StructuredAISummaryRouter
                  summary={convertToStructuredSummary(
                    resource.aiSummary,
                    resource.type,
                    'intermediate'
                  )}
                  compact={false}
                  expandable={true}
                />
              ) : null}
            </div>
          )}

          {/* Tabs - Icon Only Design */}
          <div className="mb-6 rounded-lg bg-white shadow-sm">
            <div className="flex items-center justify-end gap-2 border-b border-gray-200 px-4 py-3">
              {/* AI Tab */}
              <button
                onClick={() => setActiveTab('ai')}
                className={`group flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
                  activeTab === 'ai'
                    ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:shadow'
                }`}
                title="AI Analysis"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              </button>

              {/* Notes Tab */}
              <button
                onClick={() => setActiveTab('notes')}
                className={`group flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
                  activeTab === 'notes'
                    ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:shadow'
                }`}
                title="Notes"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </button>

              {/* Comments Tab */}
              <button
                onClick={() => setActiveTab('comments')}
                className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
                  activeTab === 'comments'
                    ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:shadow'
                }`}
                title="Comments"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                {resource.commentCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {resource.commentCount}
                  </span>
                )}
              </button>

              {/* Similar Tab - Hidden until feature is implemented */}
              {/* Image Tab - Hidden until feature is implemented */}
            </div>

            <div className="p-6">
              {/* AI Tab Content */}
              {activeTab === 'ai' && (
                <div className="space-y-4">
                  {/* Quick Ask AI from Text Selection */}
                  {showAskAI && askAIText && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-medium text-red-800">
                          Ask about selected text
                        </h4>
                        <button
                          onClick={() => {
                            setShowAskAI(false);
                            setAskAIText('');
                          }}
                          className="text-red-400 hover:text-red-600"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                      <div className="mb-3 rounded border-l-4 border-yellow-400 bg-yellow-50 p-2">
                        <p className="line-clamp-3 text-sm text-gray-700">
                          {askAIText}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            // TODO: Integrate with chat functionality
                            window.open(
                              `/ai-office?question=${encodeURIComponent(`Explain this: ${askAIText}`)}`,
                              '_blank'
                            );
                          }}
                          className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm text-white transition-colors hover:bg-red-700"
                        >
                          Explain this
                        </button>
                        <button
                          onClick={() => {
                            window.open(
                              `/ai-office?question=${encodeURIComponent(`Summarize this: ${askAIText}`)}`,
                              '_blank'
                            );
                          }}
                          className="flex-1 rounded-lg bg-gray-600 px-3 py-2 text-sm text-white transition-colors hover:bg-gray-700"
                        >
                          Summarize
                        </button>
                        <button
                          onClick={() => {
                            window.open(
                              `/ai-office?question=${encodeURIComponent(`What are the key points in: ${askAIText}`)}`,
                              '_blank'
                            );
                          }}
                          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          Key Points
                        </button>
                      </div>
                    </div>
                  )}

                  {resource.structuredAISummary ? (
                    <StructuredAISummaryRouter
                      summary={
                        resource.structuredAISummary as unknown as ResourceAISummary
                      }
                      compact={false}
                      expandable={true}
                    />
                  ) : resource.aiSummary ? (
                    isStructuredAISummary(resource.aiSummary) ? (
                      <StructuredAISummaryRouter
                        summary={
                          resource.aiSummary as unknown as ResourceAISummary
                        }
                        compact={false}
                        expandable={true}
                      />
                    ) : typeof resource.aiSummary === 'string' ? (
                      <StructuredAISummaryRouter
                        summary={convertToStructuredSummary(
                          resource.aiSummary,
                          resource.type,
                          'intermediate'
                        )}
                        compact={false}
                        expandable={true}
                      />
                    ) : null
                  ) : (
                    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-gray-300">
                      <div className="text-center">
                        {isGeneratingSummary ? (
                          <>
                            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-b-2 border-red-600"></div>
                            <p className="text-sm text-gray-600">
                              Generating detailed AI analysis...
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                              Extracting summary, insights and methods
                            </p>
                          </>
                        ) : (
                          <>
                            <svg
                              className="mx-auto h-12 w-12 text-gray-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                              />
                            </svg>
                            <p className="mt-2 text-sm text-gray-500">
                              AI analysis not yet available
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'notes' && (
                <div className="space-y-4">
                  {!showNoteEditor ? (
                    <>
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-900">
                          我的笔记
                        </h3>
                        <button
                          onClick={() => {
                            setShowNoteEditor(true);
                            setEditingNoteId(undefined);
                          }}
                          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
                        >
                          创建新笔记
                        </button>
                      </div>
                      <NotesList
                        resourceId={resource.id}
                        onEditNote={(note) => {
                          setEditingNoteId(note.id);
                          setShowNoteEditor(true);
                        }}
                        onDeleteNote={() => {
                          // Refresh notes list handled by NotesList component
                        }}
                      />
                    </>
                  ) : (
                    <div className="rounded-lg bg-gray-50 p-6">
                      <NoteEditor
                        resourceId={resource.id}
                        noteId={editingNoteId}
                        onSave={(note) => {
                          logger.debug('Note saved:', note);
                          setShowNoteEditor(false);
                          setEditingNoteId(undefined);
                        }}
                        onCancel={() => {
                          setShowNoteEditor(false);
                          setEditingNoteId(undefined);
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'comments' && (
                <CommentsList resourceId={resource.id} />
              )}

              {/* Similar Tab Content - Hidden until feature is implemented */}
              {/* Image Tab Content - Hidden until feature is implemented */}
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
