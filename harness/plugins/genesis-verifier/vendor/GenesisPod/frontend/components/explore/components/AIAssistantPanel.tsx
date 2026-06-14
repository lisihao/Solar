'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Resource, AIMessage, AIInsight } from '../utils/types';
import { extractImagesFromMarkdown } from '../utils';
import { Base64Image } from '../resources/Base64Image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import NotesList from '@/components/common/resource-lists/NotesList';
import CommentsList from '@/components/common/comments/CommentsList';
import SimilarResourcesList from '@/components/common/resource-lists/SimilarResourcesList';
import AIModelSelector from './AIModelSelector';
import type { AIModel } from '@/hooks';
import QuickActions from './QuickActions';
import AISummaryCard from './AISummaryCard';
import AIInsightsCard from './AIInsightsCard';
import AIMethodologyCard from './AIMethodologyCard';
import AIChatMessages from './AIChatMessages';
import AIInputArea from './AIInputArea';
import { useTranslation } from '@/lib/i18n/i18n-context';

interface AIAssistantPanelProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  selectedResource: Resource | null;
  aiRightTab: 'assistant' | 'notes' | 'comments' | 'similar';
  setAiRightTab: (tab: 'assistant' | 'notes' | 'comments' | 'similar') => void;
  aiModel: string;
  setAiModel: (model: string) => void;
  aiModels: AIModel[];
  aiLoading: boolean;
  isStreaming: boolean;
  aiSummary: string | null;
  aiInsights: AIInsight[];
  aiMethodology: AIInsight[];
  aiMessages: AIMessage[];
  aiInput: string;
  setAiInput: (input: string) => void;
  attachments: File[];
  onQuickAction: (action: 'summary' | 'insights' | 'methodology') => void;
  onSendMessage: () => void;
  onContextMenu: (e: React.MouseEvent, text: string) => void;
  notesRefreshKey: number;
  setNotesRefreshKey: (key: number) => void;
  onAttachmentClick: () => void;
  onRemoveAttachment: (index: number) => void;
  onSaveConversation: () => void;
  attachmentFileInputRef: React.RefObject<HTMLInputElement>;
  onAttachmentFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  resources: Resource[];
  router: ReturnType<typeof useRouter>;
  extractYouTubeVideoId: (url: string) => string | null;
}

export default function AIAssistantPanel({
  isCollapsed,
  onToggleCollapse,
  selectedResource,
  aiRightTab,
  setAiRightTab,
  aiModel,
  setAiModel,
  aiModels,
  aiLoading,
  isStreaming,
  aiSummary,
  aiInsights,
  aiMethodology,
  aiMessages,
  aiInput,
  setAiInput,
  attachments,
  onQuickAction,
  onSendMessage,
  onContextMenu,
  notesRefreshKey,
  setNotesRefreshKey,
  onAttachmentClick,
  onRemoveAttachment,
  onSaveConversation,
  attachmentFileInputRef,
  onAttachmentFileChange,
  resources,
  router,
  extractYouTubeVideoId,
}: AIAssistantPanelProps) {
  const { t } = useTranslation();
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages]);

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label="展开 AI 助手面板"
        className="group absolute right-0 top-1/2 z-20 flex -translate-y-1/2 items-center gap-2 rounded-l-lg bg-gradient-to-br from-red-50 to-pink-50 px-4 py-3 text-sm font-medium text-gray-700 shadow-lg ring-1 ring-red-200/50 transition-all duration-200 hover:shadow-xl hover:ring-red-300/60"
      >
        <svg
          className="h-4 w-4 text-gray-600 transition-all duration-200 group-hover:text-red-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        <span className="transition-colors duration-200 group-hover:text-red-600">
          AI助手
        </span>
        <div className="absolute inset-0 rounded-l-lg bg-gradient-to-br from-red-400/0 to-pink-400/0 opacity-0 transition-opacity duration-200 group-hover:from-red-400/10 group-hover:to-pink-400/10 group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <aside className="relative hidden w-96 flex-shrink-0 flex-col border-l border-gray-200 bg-white lg:flex lg:w-[480px] xl:w-[560px] 2xl:w-[640px]">
      {/* Collapse Button */}
      <button
        type="button"
        onClick={onToggleCollapse}
        className="group absolute -left-4 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-gradient-to-br from-red-50 to-pink-50 shadow-md ring-1 ring-red-200/50 transition-all duration-200 hover:shadow-lg hover:ring-red-300/60"
        aria-label="收起 AI 助手面板"
      >
        <svg
          className="h-4 w-4 text-gray-600 transition-all duration-200 group-hover:text-red-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-red-400/0 to-pink-400/0 opacity-0 transition-opacity duration-200 group-hover:from-red-400/10 group-hover:to-pink-400/10 group-hover:opacity-100" />
      </button>

      {/* Top Tab Navigation */}
      <div className="border-b border-gray-100 bg-gray-50 px-2 py-2">
        <div className="grid grid-cols-4 gap-1">
          <button
            onClick={() => setAiRightTab('assistant')}
            className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
              aiRightTab === 'assistant'
                ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
            }`}
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
            <span className="leading-tight">Chat</span>
          </button>
          <button
            onClick={() => setAiRightTab('notes')}
            className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
              aiRightTab === 'notes'
                ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
            }`}
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
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <span className="leading-tight">Notes</span>
          </button>
          <button
            onClick={() => setAiRightTab('comments')}
            className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
              aiRightTab === 'comments'
                ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
            }`}
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
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <span className="leading-tight">Comments</span>
          </button>
          <button
            onClick={() => setAiRightTab('similar')}
            className={`group relative flex flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium transition-all duration-200 ${
              aiRightTab === 'similar'
                ? 'bg-gradient-to-br from-red-500 to-red-600 text-white shadow-md shadow-red-500/20'
                : 'bg-white text-gray-600 shadow-sm hover:bg-gray-50 hover:shadow'
            }`}
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
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            <span className="leading-tight">Similar</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedResource ? (
          aiRightTab === 'assistant' ? (
            <div className="space-y-4">
              <AIModelSelector
                aiModel={aiModel}
                setAiModel={setAiModel}
                aiModels={aiModels}
              />
              <QuickActions
                onQuickAction={onQuickAction}
                aiLoading={aiLoading}
                isStreaming={isStreaming}
              />
              {aiSummary && (
                <AISummaryCard
                  aiSummary={aiSummary}
                  onContextMenu={onContextMenu}
                />
              )}
              {(aiLoading || isStreaming) && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-red-600"></div>
                  <span className="text-sm text-gray-600">
                    {isStreaming
                      ? `${String((aiModels || []).find((m) => m.modelId === aiModel)?.name || aiModel)} ${t('explore.aiPanel.thinking') || '正在思考...'}`
                      : t('explore.aiPanel.processing') || 'AI 处理中...'}
                  </span>
                </div>
              )}
              {aiInsights.length > 0 && (
                <AIInsightsCard
                  aiInsights={aiInsights}
                  onContextMenu={onContextMenu}
                />
              )}
              {aiMethodology.length > 0 && (
                <AIMethodologyCard
                  aiMethodology={aiMethodology}
                  onContextMenu={onContextMenu}
                />
              )}
              {aiMessages.length > 0 && (
                <AIChatMessages
                  aiMessages={aiMessages}
                  isStreaming={isStreaming}
                  aiModel={aiModel}
                  aiModels={aiModels}
                  onContextMenu={onContextMenu}
                  chatEndRef={chatEndRef}
                />
              )}
              {aiMessages.length === 0 && !aiLoading && (
                <div className="border-t border-gray-200 pt-4">
                  <p className="mb-3 text-xs text-gray-500">💡 你可以问：</p>
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        setAiInput('这篇文章的主要贡献是什么？');
                      }}
                      className="w-full rounded-lg bg-gray-50 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
                    >
                      这篇文章的主要贡献是什么？
                    </button>
                    <button
                      onClick={() => {
                        setAiInput('有哪些实际应用场景？');
                      }}
                      className="w-full rounded-lg bg-gray-50 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
                    >
                      有哪些实际应用场景？
                    </button>
                    <button
                      onClick={() => {
                        setAiInput('有什么局限性？');
                      }}
                      className="w-full rounded-lg bg-gray-50 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
                    >
                      有什么局限性？
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : aiRightTab === 'notes' ? (
            <div>
              <NotesList
                resourceId={selectedResource.id}
                refreshKey={notesRefreshKey}
                showActions={true}
                onDeleteNote={(noteId) => {
                  setNotesRefreshKey(Date.now());
                }}
              />
            </div>
          ) : aiRightTab === 'comments' ? (
            <div>
              <CommentsList resourceId={selectedResource.id} />
            </div>
          ) : aiRightTab === 'similar' ? (
            <div>
              <SimilarResourcesList
                resourceId={selectedResource.id}
                onResourceClick={(resource) => {
                  const newResource = resources.find(
                    (r) => r.id === resource.id
                  );
                  const targetResource = newResource || resource;

                  if (
                    targetResource.type === 'YOUTUBE' ||
                    targetResource.type === 'YOUTUBE_VIDEO' ||
                    targetResource.videoId
                  ) {
                    const videoId = extractYouTubeVideoId(
                      targetResource.sourceUrl
                    );
                    if (videoId) {
                      router.push(`/explore/youtube?videoId=${videoId}`);
                      return;
                    }
                  }

                  if (newResource) {
                    // Resource found in local list - this would need setSelectedResource passed as a prop
                    // For now, navigate to the resource detail page
                    router.push(`/explore/resource/${resource.id}`);
                  } else {
                    // Navigate to resource detail page within the app
                    router.push(`/explore/resource/${resource.id}`);
                  }
                }}
              />
            </div>
          ) : null
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <div>
              <div className="mb-6 flex justify-center">
                <svg
                  className="h-16 w-16 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                  />
                </svg>
              </div>
              <p className="mb-2 text-sm text-gray-500">No content selected</p>
              <p className="text-xs text-gray-400">
                Click on any paper, project, or news item to analyze it with AI
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Input Area */}
      <AIInputArea
        selectedResource={selectedResource}
        aiInput={aiInput}
        setAiInput={setAiInput}
        aiLoading={aiLoading}
        attachments={attachments}
        onSendMessage={onSendMessage}
        onAttachmentClick={onAttachmentClick}
        onRemoveAttachment={onRemoveAttachment}
        onSaveConversation={onSaveConversation}
        attachmentFileInputRef={attachmentFileInputRef}
        onAttachmentFileChange={onAttachmentFileChange}
        aiMessages={aiMessages}
      />
    </aside>
  );
}
