'use client';

import { useState, useEffect } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { config } from '@/lib/utils/config';
import { useThumbnailGenerator } from '@/hooks';

import { logger } from '@/lib/utils/logger';
import { confirm } from '@/stores';
// Disable static generation for this page (requires browser APIs)
export const dynamic = 'force-dynamic';

interface Resource {
  id: string;
  title: string;
  pdfUrl?: string;
  thumbnailUrl?: string;
}

interface ApiResponse {
  resources: Resource[];
}

export default function ThumbnailsAdminPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const { generateAndUploadThumbnail, batchGenerateThumbnails, isGenerating } =
    useThumbnailGenerator();

  useEffect(() => {
    void fetchResources();
  }, []);

  const fetchResources = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/resources?take=100`
      );
      if (response.ok) {
        const data = (await response.json()) as ApiResponse;
        setResources(data.resources || []);
      }
    } catch (error) {
      logger.error('Failed to fetch resources:', error);
    } finally {
      setLoading(false);
    }
  };

  const resourcesNeedingThumbnails = resources.filter(
    (r) => r.pdfUrl && !r.thumbnailUrl
  );

  const handleGenerateAll = async () => {
    const resourcesToGenerate = resourcesNeedingThumbnails
      .filter((r) => r.pdfUrl !== undefined)
      .map((r) => ({ id: r.id, pdfUrl: r.pdfUrl as string }));

    if (resourcesToGenerate.length === 0) {
      setStatusMessage('No resources need thumbnails!');
      return;
    }

    const confirmed = await confirm({
      title: `Generate thumbnails for ${resourcesToGenerate.length} resources?`,
      type: 'warning',
    });

    if (confirmed) {
      const results = await batchGenerateThumbnails(resourcesToGenerate);
      setStatusMessage(
        `Generation complete!\nSuccess: ${results.success}\nFailed: ${results.failed}\n${results.errors.length > 0 ? `Errors:\n${results.errors.join('\n')}` : ''}`
      );
      void fetchResources(); // Refresh the list
    }
  };

  const handleGenerateSelected = async () => {
    const resourcesToGenerate = resources
      .filter((r) => selectedResources.includes(r.id) && r.pdfUrl)
      .filter((r) => r.pdfUrl !== undefined)
      .map((r) => ({ id: r.id, pdfUrl: r.pdfUrl as string }));

    if (resourcesToGenerate.length === 0) {
      setStatusMessage('No valid resources selected!');
      return;
    }

    const results = await batchGenerateThumbnails(resourcesToGenerate);
    setStatusMessage(
      `Generation complete!\nSuccess: ${results.success}\nFailed: ${results.failed}\n${results.errors.length > 0 ? `Errors:\n${results.errors.join('\n')}` : ''}`
    );
    void fetchResources();
  };

  const handleGenerateSingle = async (id: string, pdfUrl: string) => {
    const success = await generateAndUploadThumbnail(id, pdfUrl);
    setStatusMessage(
      success
        ? 'Thumbnail generated successfully!'
        : 'Failed to generate thumbnail'
    );
    void fetchResources();
  };

  const toggleSelection = (id: string) => {
    setSelectedResources((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAllNeedingThumbnails = () => {
    setSelectedResources(resourcesNeedingThumbnails.map((r) => r.id));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-lg bg-white p-6 shadow-lg">
          <h1 className="mb-6 text-3xl font-bold text-gray-900">
            PDF Thumbnail Generator
          </h1>

          {statusMessage && (
            <div className="mb-4 rounded border border-blue-400 bg-blue-100 px-4 py-3 text-blue-700">
              <p className="whitespace-pre-line">{statusMessage}</p>
              <button
                onClick={() => setStatusMessage('')}
                className="mt-2 text-sm underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600">Loading resources...</p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-sm text-gray-600">Total Resources</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {resources.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">With Thumbnails</p>
                    <p className="text-2xl font-bold text-green-600">
                      {resources.filter((r) => r.thumbnailUrl).length}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Need Thumbnails</p>
                    <p className="text-2xl font-bold text-orange-600">
                      {resourcesNeedingThumbnails.length}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress */}
              {isGenerating && (
                <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                  <p className="mb-2 text-sm text-gray-700">
                    Generating thumbnails...
                  </p>
                  <div className="h-2 w-full rounded-full bg-gray-200">
                    <div className="h-2 w-full animate-pulse rounded-full bg-blue-600"></div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="mb-6 flex gap-4">
                <button
                  onClick={() => void handleGenerateAll()}
                  disabled={
                    resourcesNeedingThumbnails.length === 0 || isGenerating
                  }
                  className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  Generate All ({resourcesNeedingThumbnails.length})
                </button>

                <button
                  onClick={selectAllNeedingThumbnails}
                  disabled={resourcesNeedingThumbnails.length === 0}
                  className="rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:cursor-not-allowed disabled:bg-gray-100"
                >
                  Select All Needing Thumbnails
                </button>

                {selectedResources.length > 0 && (
                  <button
                    onClick={() => void handleGenerateSelected()}
                    disabled={isGenerating}
                    className="rounded-lg bg-green-600 px-6 py-3 font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                  >
                    Generate Selected ({selectedResources.length})
                  </button>
                )}
              </div>

              {/* Resources List */}
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <Table className="w-full">
                  <THead className="bg-gray-100">
                    <Tr>
                      <Th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                        Select
                      </Th>
                      <Th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                        Title
                      </Th>
                      <Th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                        Status
                      </Th>
                      <Th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                        Actions
                      </Th>
                    </Tr>
                  </THead>
                  <TBody className="divide-y divide-gray-200">
                    {resources.map((resource) => {
                      const hasThumbnail = !!resource.thumbnailUrl;
                      const hasPdf = !!resource.pdfUrl;

                      return (
                        <Tr key={resource.id} className="hover:bg-gray-50">
                          <Td className="px-4 py-3">
                            {hasPdf && !hasThumbnail && (
                              <input
                                type="checkbox"
                                checked={selectedResources.includes(
                                  resource.id
                                )}
                                onChange={() => toggleSelection(resource.id)}
                                className="h-4 w-4"
                              />
                            )}
                          </Td>
                          <Td className="px-4 py-3 text-sm text-gray-900">
                            <div className="max-w-md truncate">
                              {resource.title}
                            </div>
                          </Td>
                          <Td className="px-4 py-3">
                            {hasThumbnail && (
                              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                                Has Thumbnail
                              </span>
                            )}
                            {!hasThumbnail && hasPdf && (
                              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">
                                Needs Thumbnail
                              </span>
                            )}
                            {!hasPdf && (
                              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                                No PDF
                              </span>
                            )}
                          </Td>
                          <Td className="px-4 py-3">
                            {hasPdf && !hasThumbnail && resource.pdfUrl && (
                              <button
                                onClick={() =>
                                  void handleGenerateSingle(
                                    resource.id,
                                    resource.pdfUrl as string
                                  )
                                }
                                disabled={isGenerating}
                                className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                              >
                                Generate
                              </button>
                            )}
                            {hasThumbnail && (
                              <a
                                href={`${config.apiBaseUrl}${resource.thumbnailUrl}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-blue-600 hover:text-blue-800"
                              >
                                View
                              </a>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
