'use client';

import { useState, useEffect } from 'react';
import { Topic, TopicSummary, GenerateSummaryDto } from '@/lib/types/ai-teams';
import type { WebResource } from '@/lib/types/ai-office';
import { useAIModels, pickPreferredModel } from '@/hooks';
import { ModelBadges } from '@/components/common/badges/ModelBadges';
import * as api from '@/services/ai-teams/api';
import { useResourceStore } from '@/stores/aiOfficeStore';
import { FileText, Download, CheckCircle } from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui';
import { Modal } from '@/components/ui/dialogs/Modal';

import { logger } from '@/lib/utils/logger';
import { formatDateSafe } from '@/lib/utils/date';
import ClientDate from '@/components/common/ClientDate';
interface SummaryDialogProps {
  topic: Topic;
  onClose: () => void;
}

export default function SummaryDialog({ topic, onClose }: SummaryDialogProps) {
  const [summaries, setSummaries] = useState<TopicSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [selectedSummary, setSelectedSummary] = useState<TopicSummary | null>(
    null
  );
  const [exportedSummaries, setExportedSummaries] = useState<Set<string>>(
    new Set()
  );
  const { models: aiModels } = useAIModels();
  const aiOfficeStore = useResourceStore();

  // 查找模型：优先用 modelId 匹配，兼容旧数据
  const findModel = (aiModel: string) => {
    const models = aiModels || [];
    return (
      models.find((m) => m.modelId === aiModel) ||
      models.find((m) => m.modelName === aiModel) ||
      models.find((m) => m.id === aiModel)
    );
  };

  useEffect(() => {
    loadSummaries();
  }, [topic.id]);

  const loadSummaries = async () => {
    setIsLoading(true);
    try {
      const data = await api.getSummaries(topic.id);
      setSummaries(data);
    } catch (error) {
      logger.error('Failed to load summaries:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSummary = async (summaryId: string) => {
    try {
      await api.deleteSummary(topic.id, summaryId);
      setSummaries((prev) => prev.filter((s) => s.id !== summaryId));
      if (selectedSummary?.id === summaryId) {
        setSelectedSummary(null);
      }
    } catch (error) {
      logger.error('Failed to delete summary:', error);
    }
  };

  const handleExportToAIOffice = (summary: TopicSummary) => {
    const resourceId = `summary-${summary.id}`;

    // Check if already exported
    if (aiOfficeStore.resources.some((r) => r._id === resourceId)) {
      return;
    }

    // Convert summary to AI Office resource format
    const summaryAsResource: WebResource = {
      _id: resourceId,
      userId: 'current-user',
      resourceId: summary.id,
      resourceType: 'web_page',
      status: 'collected',
      collectedAt: new Date(),
      updatedAt: new Date(),
      url: '',
      metadata: {
        title: summary.title,
        description: `AI Team Summary from "${topic.name}"`,
        author: '',
        publishedAt: new Date(),
        siteName: 'AI Teams',
        language: 'en',
      },
      content: {
        rawHtml: '',
        cleanedText: summary.content,
        images: [],
        links: [],
      },
      aiAnalysis: {
        summary: summary.content,
        mainTopics: ['ai-team-summary'],
        keyInsights: [],
        credibility: 100,
      },
    };

    aiOfficeStore.addResource(summaryAsResource);
    setExportedSummaries((prev) => new Set([...prev, summary.id]));
  };

  const isExported = (summaryId: string) => {
    return (
      exportedSummaries.has(summaryId) ||
      aiOfficeStore.resources.some((r) => r._id === `summary-${summaryId}`)
    );
  };

  // formatDate removed - using ClientDate component for hydration safety

  return (
    <>
      <Modal
        open={true}
        onClose={onClose}
        title="Meeting Summaries"
        size="2xl"
        contentClassName="p-0"
        footer={
          <button
            onClick={() => setShowGenerateDialog(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
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
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            Generate Summary
          </button>
        }
      >
        {/* Two-panel layout */}
        <div className="flex h-[65vh] overflow-hidden">
          {/* Summaries List */}
          <div className="w-1/3 overflow-auto border-r border-gray-200">
            {isLoading ? (
              <LoadingState size="md" />
            ) : summaries.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<FileText className="h-8 w-8" />}
                title="No summaries yet"
                description="Generate your first summary"
              />
            ) : (
              <div className="divide-y divide-gray-100">
                {summaries.map((summary) => (
                  <button
                    key={summary.id}
                    onClick={() => setSelectedSummary(summary)}
                    className={`w-full p-4 text-left transition-colors ${
                      selectedSummary?.id === summary.id
                        ? 'bg-blue-50'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <h3 className="truncate font-medium text-gray-900">
                      {summary.title}
                    </h3>
                    <p className="mt-1 text-xs text-gray-500">
                      <ClientDate date={summary.createdAt} format="datetime" />
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      by{' '}
                      {summary.createdBy.fullName || summary.createdBy.username}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Summary Content */}
          <div className="flex-1 overflow-auto p-6">
            {selectedSummary ? (
              <div>
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900">
                      {selectedSummary.title}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Generated on{' '}
                      <ClientDate
                        date={selectedSummary.createdAt}
                        format="datetime"
                      />{' '}
                      by{' '}
                      {selectedSummary.createdBy.fullName ||
                        selectedSummary.createdBy.username}
                    </p>
                    {selectedSummary.generatedBy && (
                      <p className="text-xs text-gray-400">
                        AI Model:{' '}
                        {findModel(selectedSummary.generatedBy)?.name ||
                          selectedSummary.generatedBy}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Export to AI Office Button */}
                    <button
                      onClick={() => handleExportToAIOffice(selectedSummary)}
                      disabled={isExported(selectedSummary.id)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        isExported(selectedSummary.id)
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                      }`}
                      title={
                        isExported(selectedSummary.id)
                          ? 'Already in AI Office'
                          : 'Export to AI Office'
                      }
                    >
                      {isExported(selectedSummary.id) ? (
                        <>
                          <CheckCircle className="h-4 w-4" />
                          Exported
                        </>
                      ) : (
                        <>
                          <FileText className="h-4 w-4" />
                          Add to AI Office
                        </>
                      )}
                    </button>

                    {/* Delete Button */}
                    <button
                      onClick={() => handleDeleteSummary(selectedSummary.id)}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete summary"
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="prose prose-sm max-w-none">
                  <div className="whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-gray-700">
                    {selectedSummary.content}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<FileText className="h-12 w-12" />}
                title="Select a summary to view"
              />
            )}
          </div>
        </div>
      </Modal>

      {/* Generate Summary Dialog */}
      {showGenerateDialog && (
        <GenerateSummaryDialog
          topicId={topic.id}
          aiModels={aiModels}
          onGenerate={async (summary) => {
            setSummaries((prev) => [summary, ...prev]);
            setSelectedSummary(summary);
            setShowGenerateDialog(false);
          }}
          onClose={() => setShowGenerateDialog(false)}
        />
      )}
    </>
  );
}

// Generate Summary Dialog
function GenerateSummaryDialog({
  topicId,
  aiModels,
  onGenerate,
  onClose,
}: {
  topicId: string;
  aiModels: ReturnType<typeof useAIModels>['models'];
  onGenerate: (summary: TopicSummary) => void;
  onClose: () => void;
}) {
  // 严格 BYOK：用户 key 模型优先（pickPreferredModel）
  const defaultModelId =
    pickPreferredModel(aiModels)?.modelId || 'grok-3-latest';
  const [title, setTitle] = useState('');
  const [selectedModel, setSelectedModel] = useState(defaultModelId);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const summary = await api.generateSummary(topicId, {
        title:
          title.trim() || `Summary - ${formatDateSafe(new Date(), 'date')}`,
        aiModel: selectedModel,
      });
      onGenerate(summary);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate summary'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Generate Summary"
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Generating...
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
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
                Generate
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Title (optional)
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Weekly Discussion Summary"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            AI Model
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(aiModels || []).map((model) => (
              <button
                key={model.id}
                onClick={() => setSelectedModel(model.modelId)}
                className={`flex items-center gap-2 rounded-lg border-2 p-3 text-left transition-colors ${
                  selectedModel === model.modelId
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {model.iconUrl ? (
                  <img
                    src={model.iconUrl}
                    alt={model.name}
                    className="h-5 w-5"
                  />
                ) : (
                  <span className="text-xl">{model.icon}</span>
                )}
                <span className="flex-1 text-sm font-medium">{model.name}</span>
                <ModelBadges model={model} />
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <p className="text-xs text-gray-500">
          The AI will analyze all messages in this topic and generate a
          comprehensive summary of the discussion.
        </p>
      </div>
    </Modal>
  );
}
