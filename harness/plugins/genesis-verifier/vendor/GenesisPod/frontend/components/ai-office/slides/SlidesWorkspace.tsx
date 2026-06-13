'use client';

/**
 * AI Slides V5.0 - Slides Workspace
 *
 * Main workspace combining:
 * - LeftPanel (slide navigator, generating status, controls)
 * - RightPanel (preview, AI chat)
 */

import React, { useState, useRef, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useSlidesStore, toast } from '@/stores';
import {
  useCheckpoints,
  useChatEdit,
  useSlideGenerationTeam,
} from '@/hooks/features/slides';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { SourceUpdateBadge } from './SourceUpdateBadge';
import { logger } from '@/lib/utils/logger';
import { formatDateSafe } from '@/lib/utils/date';
import { useI18n } from '@/lib/i18n/i18n-context';
import { useAuth } from '@/contexts/AuthContext';

const API_SLIDES_BASE = '/api/ai-office/slides';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SlidesWorkspaceProps {
  className?: string;
  onGoBack?: () => void;
  onRegenerate?: () => void;
  onRefreshSource?: () => void;
}

export function SlidesWorkspace({
  className,
  onGoBack,
  onRegenerate,
  onRefreshSource,
}: SlidesWorkspaceProps) {
  const { t } = useI18n();
  const { accessToken } = useAuth();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const {
    session,
    pages,
    selectedPageIndex,
    updatePage,
    setGenerating,
    setProgress,
  } = useSlidesStore();

  const { generateWithTeam } = useSlideGenerationTeam();
  const isRefreshingRef = useRef(false);

  const { createCheckpoint, restoreCheckpoint } = useCheckpoints();
  const { chatEdit, loading: chatLoading } = useChatEdit();

  const handleCheckpointRestore = useCallback(
    async (checkpointId: string) => {
      await restoreCheckpoint(checkpointId);
    },
    [restoreCheckpoint]
  );

  const handleCreateCheckpoint = useCallback(() => {
    createCheckpoint(
      t('office.slides.savePoint', { time: formatDateSafe(new Date(), 'time') })
    );
  }, [createCheckpoint, t]);

  const handleFactCheck = useCallback(async () => {
    logger.debug('[SlidesWorkspace] Fact check triggered');
  }, []);

  const handleAIEdit = useCallback(
    async (action: 'fix-layout' | 'polish-content' | 'mark-edit') => {
      logger.debug('[SlidesWorkspace] AI Edit:', action);
    },
    []
  );

  const handleAdvanced = useCallback(() => {
    logger.debug('[SlidesWorkspace] Advanced options clicked');
  }, []);

  // Cancel stops UI generating state; actual SSE stream is managed by SlidesTab
  const handleCancel = useCallback(() => {
    setGenerating(false);
    setProgress(null);
    logger.info('[SlidesWorkspace] Generation cancelled by user');
  }, [setGenerating, setProgress]);

  // Re-generate: go back to gallery and open the new generation form
  const handleGenerate = useCallback(() => {
    if (onRegenerate) {
      onRegenerate();
    }
    logger.info('[SlidesWorkspace] Re-generate: opening new generation form');
  }, [onRegenerate]);

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!session?.id) {
        toast.warning('请先生成幻灯片');
        return;
      }

      // Append user message immediately so UI feels responsive
      setChatMessages((prev) => [...prev, { role: 'user', content: message }]);

      const result = await chatEdit(session.id, selectedPageIndex, message);

      if (result && result.success) {
        // Update the slide preview in the store
        const currentPage = pages[selectedPageIndex];
        if (currentPage && result.updatedHtml) {
          updatePage(currentPage.pageNumber, { html: result.updatedHtml });
        }

        // Append AI reply
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.reply },
        ]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '修改失败，请检查网络或重试。' },
        ]);
      }
    },
    [session?.id, selectedPageIndex, pages, updatePage, chatEdit]
  );

  // Refresh subscription: fetch updated source text and re-generate
  const handleRefreshSubscription = useCallback(async () => {
    if (isRefreshingRef.current) return;

    if (onRefreshSource) {
      onRefreshSource();
      return;
    }

    const currentSession = useSlidesStore.getState().session;
    if (!currentSession?.id) return;

    isRefreshingRef.current = true;
    try {
      const response = await fetch(
        `${API_SLIDES_BASE}/sessions/${currentSession.id}/subscription`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ action: 'refresh' }),
        }
      );

      if (!response.ok) {
        throw new Error(`Refresh failed: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        success: boolean;
        sourceText?: string;
      };

      if (data.sourceText && currentSession.title) {
        // Preserve crossModuleSource so the new Mission keeps the subscription
        // and will continue to receive stale notifications on future source updates
        const sub = currentSession.sourceSubscription;
        generateWithTeam({
          title: currentSession.title,
          sourceText: data.sourceText,
          userRequirement: '',
          stylePreference: 'dark',
          themeId: 'genspark-dark',
          ...(sub && {
            crossModuleSource: {
              type: sub.type,
              sourceId: sub.sourceId,
              sourceName: sub.sourceName,
            },
          }),
        });
      }
    } catch (err) {
      logger.error('[SlidesWorkspace] Refresh subscription failed:', err);
    } finally {
      isRefreshingRef.current = false;
    }
  }, [onRefreshSource, accessToken, generateWithTeam]);

  const isStale = session?.sourceSubscription?.isStale ?? false;

  return (
    <div className={cn('flex flex-col overflow-hidden', className)}>
      {/* Source stale banner */}
      {isStale && (
        <div className="flex-shrink-0 border-b bg-amber-50 px-4 py-2">
          <SourceUpdateBadge
            sourceName={session?.sourceSubscription?.sourceName}
            onRefresh={handleRefreshSubscription}
          />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: 280px AI interaction center */}
        {!leftCollapsed && (
          <div className="flex h-full w-[280px] flex-shrink-0 flex-col overflow-hidden">
            <LeftPanel
              onCollapse={() => setLeftCollapsed(true)}
              onGenerate={handleGenerate}
              onCancel={handleCancel}
              onCreateCheckpoint={handleCreateCheckpoint}
              chatMessages={chatMessages}
              chatLoading={chatLoading}
              onSendMessage={handleSendMessage}
              className="flex-1"
            />
          </div>
        )}

        {/* Collapsed left panel: narrow expand strip */}
        {leftCollapsed && (
          <div className="flex flex-shrink-0 flex-col border-r border-slate-200 bg-white">
            <button
              onClick={() => setLeftCollapsed(false)}
              className="m-1 rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="展开面板"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Right Panel */}
        <RightPanel
          title={session?.title || t('office.slides.title')}
          sessionId={session?.id}
          onCheckpointRestore={handleCheckpointRestore}
          onCreateCheckpoint={handleCreateCheckpoint}
          onFactCheck={handleFactCheck}
          onAIEdit={handleAIEdit}
          onAdvanced={handleAdvanced}
        />
      </div>
    </div>
  );
}

export default SlidesWorkspace;
