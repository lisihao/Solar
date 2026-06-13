'use client';

import { useState } from 'react';
import { Loader2, Lock, RefreshCw, Users } from 'lucide-react';
import {
  useKnowledgeBase,
  useKnowledgeBaseDetail,
  type KnowledgeBase,
  type KnowledgeBaseDocument,
  type CreateKnowledgeBaseDto,
} from '@/hooks/domain/useKnowledgeBase';
import CreateKnowledgeBaseDialog from './CreateKnowledgeBaseDialog';
import EditKnowledgeBaseDialog from './EditKnowledgeBaseDialog';
import MemberManagementDialog from '../dialogs/MemberManagementDialog';
import SearchTestDialog from './SearchTestDialog';
import DocumentListDialog from '../dialogs/DocumentListDialog';
import AddDocumentsDialog from '../resources/AddDocumentsDialog';
import KnowledgeBaseDetailDialog from './KnowledgeBaseDetailDialog';
import SignInPrompt, { isAuthError } from '@/components/common/SignInPrompt';
import { ConfirmDialog } from '@/components/ui/dialogs/ConfirmDialog';
import KnowledgeBaseCard from './KnowledgeBaseCard';
import CreateKnowledgeBaseCard from './CreateKnowledgeBaseCard';
import { CardGrid } from '@/components/ui/cards/CardGrid';
import SectionTitle from '../_design/SectionTitle';

import { logger } from '@/lib/utils/logger';
import { ErrorState } from '@/components/ui/states/ErrorState';

interface TeamKnowledgeBaseTabProps {
  searchQuery?: string;
}

/**
 * 团队知识库 Tab — 改为统一卡片网格（含"新建"占位卡）
 */
export default function TeamKnowledgeBaseTab({
  searchQuery = '',
}: TeamKnowledgeBaseTabProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingKbId, setEditingKbId] = useState<string | null>(null);
  const [deletingKbId, setDeletingKbId] = useState<string | null>(null);
  const [managingMembersKbId, setManagingMembersKbId] = useState<string | null>(
    null
  );
  const [showDetailKbId, setShowDetailKbId] = useState<string | null>(null);
  const [showSearchTest, setShowSearchTest] = useState<string | null>(null);
  const [showDocList, setShowDocList] = useState<{
    kbId: string;
    kbName: string;
    documents: KnowledgeBaseDocument[];
  } | null>(null);
  const [showAddDocs, setShowAddDocs] = useState<{
    kbId: string;
    kbName: string;
  } | null>(null);

  const {
    knowledgeBases,
    loading,
    error,
    creating,
    createKnowledgeBase,
    deleteKnowledgeBase,
    setVisibility,
    refreshList,
  } = useKnowledgeBase();

  const editingKbDetail = useKnowledgeBaseDetail(editingKbId || '');

  const handleDelete = async (kbId: string) => {
    try {
      await deleteKnowledgeBase(kbId);
      setDeletingKbId(null);
      void refreshList();
    } catch (err) {
      logger.error('Failed to delete knowledge base:', err);
    }
  };

  const handleVisibilityChange = async (
    kb: KnowledgeBase,
    next: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  ) => {
    await setVisibility(kb.id, next);
  };

  const teamKBs = knowledgeBases.filter((kb) => {
    if (kb.type !== 'TEAM') return false;
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      kb.name?.toLowerCase().includes(query) ||
      kb.description?.toLowerCase().includes(query)
    );
  });

  const handleCreate = (dto: CreateKnowledgeBaseDto) => {
    void (async () => {
      try {
        await createKnowledgeBase({ ...dto, type: 'TEAM' });
        setShowCreateDialog(false);
      } catch (err) {
        logger.error('Failed to create knowledge base:', err);
      }
    })();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
      </div>
    );
  }

  if (error) {
    if (isAuthError(error)) {
      return (
        <SignInPrompt
          title="请先登录"
          description="登录后即可查看和管理团队知识库"
        />
      );
    }
    return (
      <ErrorState
        error={`加载知识库失败: ${error.message}`}
        onRetry={() => void refreshList()}
      />
    );
  }

  return (
    <div>
      <SectionTitle
        icon={Users}
        title="团队知识库"
        description="与团队成员共享的知识库，支持成员协作与权限控制"
        count={teamKBs.length}
        action={
          <button
            onClick={() => {
              void refreshList();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </button>
        }
      />

      <CardGrid>
        {teamKBs.map((kb) => (
          <KnowledgeBaseCard
            key={kb.id}
            kb={kb}
            variant="team"
            onOpen={() => setShowDetailKbId(kb.id)}
            onEdit={() => setEditingKbId(kb.id)}
            onDelete={() => setDeletingKbId(kb.id)}
            onManageMembers={() => setManagingMembersKbId(kb.id)}
            onVisibilityChange={(k, next) =>
              void handleVisibilityChange(k, next)
            }
          />
        ))}
        <CreateKnowledgeBaseCard
          title="创建团队知识库"
          description="与团队共享文档，让团队 AI 助手拥有专属知识"
          onClick={() => setShowCreateDialog(true)}
        />
      </CardGrid>

      {/* 团队知识库说明（仅当无任何团队 KB 时） */}
      {teamKBs.length === 0 && (
        <div className="mt-6 rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/60 to-purple-50/40 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
              <Lock className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-violet-900">
                团队知识库的能力
              </p>
              <p className="mt-1 text-xs leading-relaxed text-violet-700">
                团队知识库支持权限控制、协作编辑和知识共享。成员可以在 AI
                对话中直接引用团队知识，作为专家级回答的来源。
              </p>
            </div>
          </div>
        </div>
      )}

      {showCreateDialog && (
        <CreateKnowledgeBaseDialog
          key={`create-team-kb-${Date.now()}`}
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreate}
          creating={creating}
          kbType="TEAM"
        />
      )}

      {editingKbId && editingKbDetail.knowledgeBase && (
        <EditKnowledgeBaseDialog
          key={`edit-team-kb-${editingKbId}`}
          knowledgeBase={editingKbDetail.knowledgeBase}
          onClose={() => setEditingKbId(null)}
          onUpdate={async (data) => {
            await editingKbDetail.updateKnowledgeBase(data);
            await refreshList();
            setEditingKbId(null);
          }}
          updating={editingKbDetail.updating || editingKbDetail.syncing}
        />
      )}

      <ConfirmDialog
        open={!!deletingKbId}
        onClose={() => setDeletingKbId(null)}
        onConfirm={() => {
          if (deletingKbId) void handleDelete(deletingKbId);
        }}
        title="确认删除"
        description="确定要删除这个团队知识库吗？此操作不可撤销，所有相关的文档、向量数据和成员权限都将被删除。"
        type="danger"
        confirmText="删除"
        cancelText="取消"
      />

      {managingMembersKbId && (
        <MemberManagementDialog
          knowledgeBaseId={managingMembersKbId}
          knowledgeBaseName={
            teamKBs.find((kb: KnowledgeBase) => kb.id === managingMembersKbId)
              ?.name || ''
          }
          onClose={() => setManagingMembersKbId(null)}
        />
      )}

      {showSearchTest && (
        <SearchTestDialog
          knowledgeBaseId={showSearchTest}
          onClose={() => setShowSearchTest(null)}
        />
      )}

      {showDocList && (
        <DocumentListDialog
          documents={showDocList.documents}
          knowledgeBaseName={showDocList.kbName}
          onClose={() => setShowDocList(null)}
          onBack={() => {
            const kbId = showDocList.kbId;
            setShowDocList(null);
            setShowDetailKbId(kbId);
          }}
        />
      )}

      {showDetailKbId && (
        <KnowledgeBaseDetailDialog
          knowledgeBaseId={showDetailKbId}
          onClose={() => setShowDetailKbId(null)}
          onAddDocuments={() => {
            const kb = teamKBs.find(
              (k: KnowledgeBase) => k.id === showDetailKbId
            );
            if (kb) {
              setShowDetailKbId(null);
              setShowAddDocs({ kbId: kb.id, kbName: kb.name });
            }
          }}
          onSearchTest={() => {
            const kbId = showDetailKbId;
            setShowDetailKbId(null);
            setShowSearchTest(kbId);
          }}
          onViewDocuments={(docs: KnowledgeBaseDocument[]) => {
            const kb = teamKBs.find(
              (k: KnowledgeBase) => k.id === showDetailKbId
            );
            if (kb) {
              setShowDetailKbId(null);
              setShowDocList({ kbId: kb.id, kbName: kb.name, documents: docs });
            }
          }}
        />
      )}

      {showAddDocs && (
        <AddDocumentsDialog
          knowledgeBaseId={showAddDocs.kbId}
          knowledgeBaseName={showAddDocs.kbName}
          onClose={() => setShowAddDocs(null)}
          onDocumentsAdded={() => {
            void refreshList();
          }}
        />
      )}
    </div>
  );
}
