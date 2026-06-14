'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, User, AlertCircle } from 'lucide-react';
import {
  useKnowledgeBase,
  useKnowledgeBaseDetail,
  type KnowledgeBase,
  type KnowledgeBaseDocument,
  type CreateKnowledgeBaseDto,
} from '@/hooks/domain/useKnowledgeBase';
import CreateKnowledgeBaseDialog from './CreateKnowledgeBaseDialog';
import EditKnowledgeBaseDialog from './EditKnowledgeBaseDialog';
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

interface PersonalKnowledgeBaseTabProps {
  searchQuery?: string;
}

/**
 * 个人知识库 Tab — 改为统一卡片网格（含"新建"占位卡）
 */
export default function PersonalKnowledgeBaseTab({
  searchQuery = '',
}: PersonalKnowledgeBaseTabProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingKbId, setEditingKbId] = useState<string | null>(null);
  const [deletingKbId, setDeletingKbId] = useState<string | null>(null);
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

  const personalKBs = knowledgeBases.filter((kb) => {
    const isPersonal = !kb.type || kb.type === 'PERSONAL';
    if (!isPersonal) return false;
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
        await createKnowledgeBase({ ...dto, type: 'PERSONAL' });
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
          description="登录后即可查看和管理你的个人知识库"
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
      {/* 分组标题 + 操作 */}
      <SectionTitle
        icon={User}
        title="我的知识库"
        description="个人私有知识库，仅你可见，可作为 AI 检索来源"
        count={personalKBs.length}
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

      {/* 卡片网格（末格永远是"新建"卡） */}
      <CardGrid>
        {personalKBs.map((kb) => (
          <KnowledgeBaseCard
            key={kb.id}
            kb={kb}
            variant="personal"
            onOpen={() => setShowDetailKbId(kb.id)}
            onEdit={() => setEditingKbId(kb.id)}
            onDelete={() => setDeletingKbId(kb.id)}
            onVisibilityChange={(k, next) =>
              void handleVisibilityChange(k, next)
            }
          />
        ))}
        <CreateKnowledgeBaseCard
          title="新建个人知识库"
          description="为新主题创建专属空间，用于私人文档、笔记与 AI 检索"
          onClick={() => setShowCreateDialog(true)}
        />
      </CardGrid>

      {/* Create Dialog */}
      {showCreateDialog && (
        <CreateKnowledgeBaseDialog
          key={`create-kb-${Date.now()}`}
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreate}
          creating={creating}
          kbType="PERSONAL"
        />
      )}

      {/* Edit Dialog */}
      {editingKbId &&
        (editingKbDetail.loading ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-xl bg-white p-8 shadow-xl">
              <div className="flex items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
                <span className="text-gray-600">加载知识库信息...</span>
              </div>
            </div>
          </div>
        ) : editingKbDetail.knowledgeBase ? (
          <EditKnowledgeBaseDialog
            key={`edit-kb-${editingKbId}`}
            knowledgeBase={editingKbDetail.knowledgeBase}
            onClose={() => setEditingKbId(null)}
            onUpdate={async (data) => {
              await editingKbDetail.updateKnowledgeBase(data);
              await refreshList();
              setEditingKbId(null);
            }}
            updating={editingKbDetail.updating || editingKbDetail.syncing}
          />
        ) : (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-xl bg-white p-8 shadow-xl">
              <div className="flex flex-col items-center gap-3">
                <AlertCircle className="h-8 w-8 text-red-500" />
                <span className="text-gray-600">无法加载知识库信息</span>
                <button
                  onClick={() => setEditingKbId(null)}
                  className="mt-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        ))}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deletingKbId}
        onClose={() => setDeletingKbId(null)}
        onConfirm={() => {
          if (deletingKbId) void handleDelete(deletingKbId);
        }}
        title="确认删除"
        description="确定要删除这个知识库吗？此操作不可撤销，所有相关的文档和向量数据都将被删除。"
        type="danger"
        confirmText="删除"
        cancelText="取消"
      />

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
            const kb = personalKBs.find(
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
            const kb = personalKBs.find(
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
