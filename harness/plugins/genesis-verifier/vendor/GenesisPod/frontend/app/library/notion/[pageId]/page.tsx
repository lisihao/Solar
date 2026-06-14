'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  getPage,
  updatePage,
  pushToNotion,
  NotionPage,
} from '@/services/notion/api';
import AppShell from '@/components/layout/AppShell';
import { LoadingState } from '@/components/ui/states';

import { logger } from '@/lib/utils/logger';
import ClientDate from '@/components/common/ClientDate';
// Dynamically import the editor to avoid SSR issues
const NotionBlockEditor = dynamic(
  () => import('@/components/library/integrations/notion/NotionBlockEditor'),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse">
        <div className="h-8 w-3/4 rounded bg-gray-200" />
        <div className="mt-4 h-4 w-full rounded bg-gray-200" />
        <div className="mt-2 h-4 w-5/6 rounded bg-gray-200" />
        <div className="mt-2 h-4 w-4/6 rounded bg-gray-200" />
      </div>
    ),
  }
);

export default function NotionPageDetail() {
  const params = useParams();
  const router = useRouter();
  const pageId = params?.pageId as string;

  const [page, setPage] = useState<NotionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [localBlocks, setLocalBlocks] = useState<Record<string, unknown>[]>([]);

  const fetchPage = useCallback(async () => {
    if (!pageId) return;

    try {
      setLoading(true);
      const result = await getPage(pageId);
      setPage(result.page);
      setLocalBlocks(result.page.blocks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load page');
    } finally {
      setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Handle block changes from editor
  const handleBlocksChange = useCallback(
    (blocks: Array<Record<string, unknown>>) => {
      setLocalBlocks(blocks);
    },
    []
  );

  // Save blocks to backend
  const handleSave = useCallback(
    async (blocks: Array<Record<string, unknown>>) => {
      if (!pageId) return;

      try {
        const result = await updatePage(pageId, blocks);
        setPage(result.page);
        setLocalBlocks(blocks);
      } catch (err) {
        logger.error('Failed to save:', err);
        throw err;
      }
    },
    [pageId]
  );

  const handlePushToNotion = async () => {
    if (!pageId || !page?.isLocallyModified) return;

    try {
      setPushing(true);
      await pushToNotion(pageId);
      await fetchPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to push changes');
    } finally {
      setPushing(false);
    }
  };

  // Removed formatDate helper - using ClientDate component instead to avoid hydration errors

  if (loading) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  if (error || !page) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-gray-900">
              Page Not Found
            </h2>
            <p className="mt-2 text-gray-600">
              {error || 'The page you are looking for does not exist.'}
            </p>
            <Link
              href="/library?tab=notion"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
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
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back to Library
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="border-b border-gray-200 bg-white px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
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
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
              </button>
              <div>
                <div className="flex items-center gap-2">
                  {page.icon && <span className="text-2xl">{page.icon}</span>}
                  <h1 className="text-xl font-semibold text-gray-900">
                    {page.title || 'Untitled'}
                  </h1>
                </div>
                <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
                  <span>
                    Updated{' '}
                    <ClientDate
                      date={page.notionUpdatedAt}
                      format="date"
                      locale="en-US"
                      dateOptions={{
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }}
                    />
                  </span>
                  {page.isLocallyModified && (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      <svg
                        className="mr-1 h-3 w-3"
                        fill="currentColor"
                        viewBox="0 0 8 8"
                      >
                        <circle cx="4" cy="4" r="3" />
                      </svg>
                      Locally Modified
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Edit/View toggle */}
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  isEditing
                    ? 'bg-blue-100 text-blue-700'
                    : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {isEditing ? (
                  <>
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
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                    Editing
                  </>
                ) : (
                  <>
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
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                    Edit
                  </>
                )}
              </button>

              {page.isLocallyModified && (
                <button
                  onClick={handlePushToNotion}
                  disabled={pushing}
                  className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {pushing ? (
                    <>
                      <svg
                        className="h-4 w-4 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      Pushing...
                    </>
                  ) : (
                    <>
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
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                      Push to Notion
                    </>
                  )}
                </button>
              )}
              <a
                href={page.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                Open in Notion
              </a>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <article className="mx-auto max-w-4xl px-8 py-8">
            {/* Cover image */}
            {page.coverUrl && (
              <div className="mb-8 overflow-hidden rounded-xl">
                <img
                  src={page.coverUrl}
                  alt="Cover"
                  className="h-64 w-full object-cover"
                />
              </div>
            )}

            {/* BlockNote Editor */}
            {isEditing ? (
              <NotionBlockEditor
                initialBlocks={localBlocks}
                onChange={handleBlocksChange}
                onSave={handleSave}
                readOnly={false}
              />
            ) : (
              <NotionBlockEditor
                key={`view-${page.id}`}
                initialBlocks={page.blocks || []}
                readOnly={true}
              />
            )}

            {/* Version history */}
            {page.versions && page.versions.length > 0 && (
              <div className="mt-12 border-t border-gray-200 pt-8">
                <h3 className="mb-4 text-lg font-semibold text-gray-900">
                  Version History
                </h3>
                <div className="space-y-2">
                  {page.versions.map((version) => (
                    <div
                      key={version.id}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                          v{version.version}
                        </span>
                        <span className="text-sm text-gray-700">
                          {version.source === 'notion'
                            ? 'Synced from Notion'
                            : 'Local edit'}
                        </span>
                      </div>
                      <span className="text-sm text-gray-500">
                        {
                          <ClientDate
                            date={version.createdAt}
                            format="date"
                            locale="en-US"
                            dateOptions={{
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            }}
                          />
                        }
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </article>
        </main>
      </div>
    </AppShell>
  );
}
