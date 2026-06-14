'use client';

import React, { useState } from 'react';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';

type ResourceType =
  | 'PAPER'
  | 'BLOG'
  | 'NEWS'
  | 'YOUTUBE_VIDEO'
  | 'REPORT'
  | 'EVENT'
  | 'RSS'
  | 'POLICY';

interface ImportUrlDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  onImportSuccess: () => void;
  apiBaseUrl: string;
}

interface ParsedMetadata {
  url: string;
  domain: string;
  title: string;
  description?: string;
  imageUrl?: string;
  authors?: string[];
  publishedDate?: string;
  language: string;
  contentType: string;
  siteName?: string;
  canonicalUrl?: string;
  favicon?: string;
  wordCount?: number;
}

interface Classification {
  resourceType: ResourceType;
  confidence: number;
  reason: string;
  alternatives?: Array<{
    resourceType: ResourceType;
    confidence: number;
    reason: string;
  }>;
}

type DialogStep = 'input-url' | 'preview' | 'confirm';

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  PAPER: 'Academic Paper',
  BLOG: 'Research Blog',
  REPORT: 'Industry Report',
  YOUTUBE_VIDEO: 'YouTube Video',
  NEWS: 'Tech News',
  POLICY: 'Policy Document',
  EVENT: 'Event',
  RSS: 'RSS Feed',
};

const RESOURCE_TYPE_ICONS: Record<ResourceType, string> = {
  PAPER: '📄',
  BLOG: '📝',
  REPORT: '📊',
  YOUTUBE_VIDEO: '🎬',
  NEWS: '📰',
  POLICY: '⚖️',
  EVENT: '📅',
  RSS: '📡',
};

export function ImportUrlDialog({
  isOpen,
  onClose,
  activeTab,
  onImportSuccess,
  apiBaseUrl,
}: ImportUrlDialogProps) {
  const [step, setStep] = useState<DialogStep>('input-url');
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [metadata, setMetadata] = useState<ParsedMetadata | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [classification, setClassification] = useState<Classification | null>(
    null
  );
  const [selectedResourceType, setSelectedResourceType] =
    useState<ResourceType | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setStep('input-url');
    setUrl('');
    setError('');
    setMetadata(null);
    setEditedTitle('');
    setClassification(null);
    setSelectedResourceType(null);
    setShowAlternatives(false);
    onClose();
  };

  const handleValidateUrl = async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Use AI-powered auto classification
      const data = await apiClient.post<{
        metadata: ParsedMetadata;
        classification?: Classification;
      }>('/data-management/parse-url-auto', { url });

      if (!data || !data.metadata) {
        throw new Error('Invalid response data format');
      }

      setMetadata(data.metadata);
      setEditedTitle(data.metadata.title);

      // Set classification from AI
      if (data.classification) {
        setClassification(data.classification);
        setSelectedResourceType(data.classification.resourceType);
      }

      setStep('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!metadata || !selectedResourceType) return;

    setIsLoading(true);
    setError('');

    try {
      await apiClient.post('/data-management/import-auto', {
        url,
        resourceType: selectedResourceType,
        title: editedTitle || undefined,
      });

      handleClose();
      onImportSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.5) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return 'High confidence';
    if (confidence >= 0.5) return 'Medium confidence';
    return 'Low confidence';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles size={20} className="text-blue-500" />
            AI-Powered Import
            {step === 'input-url' && ' - Enter URL'}
            {step === 'preview' && ' - Preview & Classify'}
            {step === 'confirm' && ' - Confirm Import'}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {/* Step indicator */}
          <div className="mb-4 flex gap-2">
            <div
              className={`h-1 flex-1 rounded ${step === 'input-url' ? 'bg-blue-600' : 'bg-gray-300'}`}
            />
            <div
              className={`h-1 flex-1 rounded ${step === 'preview' ? 'bg-blue-600' : 'bg-gray-300'}`}
            />
            <div
              className={`h-1 flex-1 rounded ${step === 'confirm' ? 'bg-blue-600' : 'bg-gray-300'}`}
            />
          </div>

          {/* Step 1: Input URL */}
          {step === 'input-url' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <h4 className="mb-2 flex items-center gap-2 font-semibold text-blue-900">
                  <Sparkles size={16} />
                  AI Auto-Classification
                </h4>
                <ul className="space-y-1 text-sm text-blue-800">
                  <li>
                    ✓ Just paste the URL - AI will automatically detect the
                    content type
                  </li>
                  <li>
                    ✓ Supports papers, blogs, news, videos, reports, and more
                  </li>
                  <li>✓ No whitelist restrictions - import from any website</li>
                  <li>
                    ✓ You can verify and change the classification if needed
                  </li>
                </ul>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold">
                  Resource URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste any URL here (paper, blog, news, video, etc.)"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyPress={(e) => e.key === 'Enter' && handleValidateUrl()}
                  autoFocus
                />
                <p className="mt-1 text-xs text-gray-500">
                  Enter any URL and AI will classify it into the correct
                  category
                </p>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="mb-2 text-xs font-medium text-gray-700">
                  Supported content types:
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(RESOURCE_TYPE_LABELS).map(([type, label]) => (
                    <span
                      key={type}
                      className="rounded-full border bg-white px-2 py-1 text-xs text-gray-600"
                    >
                      {RESOURCE_TYPE_ICONS[type as ResourceType]} {label}
                    </span>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                  <AlertCircle size={20} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Error</p>
                    <p className="text-sm">{error}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Preview with Classification */}
          {step === 'preview' && metadata && (
            <div className="space-y-4">
              {/* AI Classification Result */}
              {classification && (
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                  <h4 className="mb-3 flex items-center gap-2 font-semibold text-purple-900">
                    <Sparkles size={16} />
                    AI Classification
                  </h4>

                  <div className="space-y-3">
                    {/* Primary Classification */}
                    <div className="flex items-center justify-between rounded-lg border border-purple-100 bg-white p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">
                          {
                            RESOURCE_TYPE_ICONS[
                              selectedResourceType ||
                                classification.resourceType
                            ]
                          }
                        </span>
                        <div>
                          <p className="font-medium">
                            {
                              RESOURCE_TYPE_LABELS[
                                selectedResourceType ||
                                  classification.resourceType
                              ]
                            }
                          </p>
                          <p className="text-xs text-gray-500">
                            {classification.reason}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-sm font-medium ${getConfidenceColor(classification.confidence)}`}
                        >
                          {Math.round(classification.confidence * 100)}%
                        </p>
                        <p className="text-xs text-gray-500">
                          {getConfidenceLabel(classification.confidence)}
                        </p>
                      </div>
                    </div>

                    {/* Alternatives */}
                    {classification.alternatives &&
                      classification.alternatives.length > 0 && (
                        <div>
                          <button
                            onClick={() =>
                              setShowAlternatives(!showAlternatives)
                            }
                            className="flex items-center gap-1 text-sm text-purple-600 hover:text-purple-800"
                          >
                            <ChevronDown
                              size={16}
                              className={`transition-transform ${showAlternatives ? 'rotate-180' : ''}`}
                            />
                            {showAlternatives ? 'Hide' : 'Show'} alternative
                            classifications
                          </button>

                          {showAlternatives && (
                            <div className="mt-2 space-y-2">
                              {classification.alternatives.map((alt, idx) => (
                                <button
                                  key={idx}
                                  onClick={() =>
                                    setSelectedResourceType(alt.resourceType)
                                  }
                                  className={`flex w-full items-center justify-between rounded-lg border p-2 text-left transition-colors ${
                                    selectedResourceType === alt.resourceType
                                      ? 'border-purple-500 bg-purple-100'
                                      : 'border-gray-200 bg-white hover:border-purple-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span>
                                      {RESOURCE_TYPE_ICONS[alt.resourceType]}
                                    </span>
                                    <span className="text-sm">
                                      {RESOURCE_TYPE_LABELS[alt.resourceType]}
                                    </span>
                                  </div>
                                  <span
                                    className={`text-xs ${getConfidenceColor(alt.confidence)}`}
                                  >
                                    {Math.round(alt.confidence * 100)}%
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                </div>
              )}

              {/* Content Preview */}
              <div className="rounded-lg bg-gray-50 p-4">
                <h4 className="mb-3 flex items-center gap-2 font-semibold">
                  <CheckCircle2 size={18} className="text-green-600" />
                  Content Preview
                </h4>
                {metadata.imageUrl && (
                  <img
                    src={metadata.imageUrl}
                    alt={metadata.title}
                    className="mb-3 h-32 w-full rounded object-cover"
                  />
                )}
                <p className="mb-2 font-medium">{metadata.title}</p>
                {metadata.description && (
                  <p className="mb-2 line-clamp-2 text-sm text-gray-600">
                    {metadata.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                  <span className="rounded bg-gray-200 px-2 py-1">
                    {metadata.domain}
                  </span>
                  {metadata.publishedDate && (
                    <span className="rounded bg-gray-200 px-2 py-1">
                      {metadata.publishedDate}
                    </span>
                  )}
                  {metadata.language && (
                    <span className="rounded bg-gray-200 px-2 py-1">
                      {metadata.language}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium">
                  Edit Title (optional)
                </label>
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                />
              </div>

              {error && (
                <div className="flex gap-2 rounded-lg bg-red-50 p-3 text-red-700">
                  <AlertCircle size={20} className="flex-shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 'confirm' && metadata && (
            <div className="space-y-3 rounded-lg bg-gray-50 p-4">
              <h4 className="font-semibold">Import Summary</h4>
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-gray-500">Resource Type</dt>
                  <dd className="flex items-center gap-2 font-medium">
                    {selectedResourceType && (
                      <>
                        <span>{RESOURCE_TYPE_ICONS[selectedResourceType]}</span>
                        {RESOURCE_TYPE_LABELS[selectedResourceType]}
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Domain</dt>
                  <dd className="font-medium">{metadata.domain}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Title</dt>
                  <dd className="font-medium">
                    {editedTitle || metadata.title}
                  </dd>
                </div>
                {classification && (
                  <div>
                    <dt className="text-gray-500">AI Confidence</dt>
                    <dd
                      className={`font-medium ${getConfidenceColor(classification.confidence)}`}
                    >
                      {Math.round(classification.confidence * 100)}%
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t px-6 py-4">
          {step !== 'input-url' && (
            <button
              onClick={() => {
                if (step === 'preview') setStep('input-url');
                else if (step === 'confirm') setStep('preview');
              }}
              disabled={isLoading}
              className="rounded border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              Back
            </button>
          )}

          <button
            onClick={handleClose}
            disabled={isLoading}
            className="rounded border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>

          {step === 'input-url' && (
            <button
              onClick={handleValidateUrl}
              disabled={!url || isLoading}
              className="ml-auto flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              {isLoading ? 'Analyzing...' : 'Analyze URL'}
            </button>
          )}

          {step === 'preview' && (
            <button
              onClick={() => setStep('confirm')}
              disabled={!selectedResourceType}
              className="ml-auto rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Confirm Classification
            </button>
          )}

          {step === 'confirm' && (
            <button
              onClick={handleImport}
              disabled={isLoading}
              className="ml-auto flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              Confirm Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
