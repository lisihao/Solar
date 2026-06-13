'use client';

import { useState } from 'react';
import {
  Database,
  Plus,
  Trash2,
  RefreshCw,
  FileText,
  Search,
  Settings,
  Pencil,
  ArrowLeft,
  Calendar,
  User,
  Users,
  Layers,
  Hash,
  Mail,
} from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { CitationListItem } from '@/components/common/citations';
import ClientDate from '@/components/common/ClientDate';
import {
  useKnowledgeBase,
  useKnowledgeBaseDetail,
  useRAGQuery,
} from '@/hooks/domain/useKnowledgeBase';
import type {
  KnowledgeBase,
  CreateKnowledgeBaseDto,
} from '@/hooks/domain/useKnowledgeBase';
import SignInPrompt, { isAuthError } from '@/components/common/SignInPrompt';
import { InternalReportsImportPanel } from '@/components/library/import-panels';
import { toast, confirm } from '@/stores';

/**
 * RAG 知识库管理页面
 */
export default function RAGPage() {
  const [selectedKB, setSelectedKB] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showQueryPanel, setShowQueryPanel] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const {
    knowledgeBases,
    loading,
    error,
    creating,
    deleteKnowledgeBase,
    createKnowledgeBase,
    refreshList,
  } = useKnowledgeBase();

  const {
    knowledgeBase,
    stats,
    loading: detailLoading,
    syncing,
    processing,
    updating,
    syncGoogleDrive,
    processDocuments,
    updateKnowledgeBase,
    refresh: refreshDetail,
  } = useKnowledgeBaseDetail(selectedKB);

  const handleCreate = async (dto: CreateKnowledgeBaseDto) => {
    await createKnowledgeBase(dto);
    setShowCreateDialog(false);
  };

  const handleEdit = async (data: { name: string; description?: string }) => {
    await updateKnowledgeBase(data);
    await refreshList();
    setShowEditDialog(false);
  };

  const handleDelete = async (id: string) => {
    if (
      !(await confirm({
        title: '确定要删除这个知识库吗？',
        description: '所有文档和向量数据都将被删除。',
        type: 'danger',
      }))
    ) {
      return;
    }
    await deleteKnowledgeBase(id);
    if (selectedKB === id) {
      setSelectedKB(null);
    }
  };

  const getStatusBadge = (status: KnowledgeBase['status']) => {
    const colors = {
      PENDING: 'bg-yellow-100 text-yellow-700',
      PROCESSING: 'bg-blue-100 text-blue-700',
      READY: 'bg-green-100 text-green-700',
      UPDATING: 'bg-purple-100 text-purple-700',
      ERROR: 'bg-red-100 text-red-700',
    };
    const labels = {
      PENDING: '待处理',
      PROCESSING: '处理中',
      READY: '就绪',
      UPDATING: '更新中',
      ERROR: '错误',
    };
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status]}`}
      >
        {labels[status]}
      </span>
    );
  };

  const getSourceTypeLabel = (type: KnowledgeBase['sourceType']) => {
    const labels: Record<KnowledgeBase['sourceType'], string> = {
      GOOGLE_DRIVE: 'Google Drive',
      MANUAL: '手动上传',
      URL: 'URL 抓取',
      NOTION: 'Notion',
      BOOKMARK: '书签',
      NOTE: '笔记',
      IMAGE: '图片',
    };
    return labels[type] || type;
  };

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-140px)]">
        {/* 左侧：知识库列表 */}
        <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-gray-50">
          <div className="p-4">
            {/* 返回按钮 */}
            <Link
              href="/library"
              className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4" />
              返回资源库
            </Link>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">知识库</h2>
              <button
                onClick={() => setShowCreateDialog(true)}
                className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                新建
              </button>
            </div>

            {loading ? (
              <LoadingState size="sm" />
            ) : error ? (
              isAuthError(error) ? (
                <SignInPrompt
                  title="请先登录"
                  description="登录后即可管理知识库"
                  className="py-8"
                />
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-sm text-red-600">
                    加载失败: {error.message}
                  </p>
                  <button
                    onClick={() => refreshList()}
                    className="mt-2 text-sm text-red-700 underline"
                  >
                    重试
                  </button>
                </div>
              )
            ) : knowledgeBases.length === 0 ? (
              <EmptyState
                icon={<Database className="h-12 w-12" />}
                title="还没有知识库"
                action={{
                  label: '创建第一个知识库',
                  onClick: () => setShowCreateDialog(true),
                }}
              />
            ) : (
              <div className="space-y-2">
                {knowledgeBases.map((kb) => (
                  <button
                    key={kb.id}
                    onClick={() => setSelectedKB(kb.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-all ${
                      selectedKB === kb.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-900">{kb.name}</h3>
                        {kb.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                            {kb.description}
                          </p>
                        )}
                      </div>
                      {getStatusBadge(kb.status)}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                      <span>{getSourceTypeLabel(kb.sourceType)}</span>
                      <span>·</span>
                      <span>{kb._count?.documents ?? 0} 文档</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：详情面板 */}
        <div className="flex-1 overflow-auto">
          {selectedKB && knowledgeBase ? (
            <div className="p-6">
              {/* 头部信息 */}
              <div className="mb-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                      {knowledgeBase.name}
                    </h1>
                    {knowledgeBase.description && (
                      <p className="mt-1 text-gray-600">
                        {knowledgeBase.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {knowledgeBase.sourceType === 'GOOGLE_DRIVE' && (
                      <button
                        onClick={() => syncGoogleDrive()}
                        disabled={syncing}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`}
                        />
                        {syncing ? '同步中...' : '同步 Drive'}
                      </button>
                    )}
                    <button
                      onClick={() => processDocuments()}
                      disabled={processing}
                      className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                    >
                      <FileText className="h-4 w-4" />
                      {processing ? '处理中...' : '处理文档'}
                    </button>
                    <button
                      onClick={() => setShowQueryPanel(true)}
                      className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                    >
                      <Search className="h-4 w-4" />
                      测试查询
                    </button>
                    <button
                      onClick={() => setShowEditDialog(true)}
                      className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100"
                      title="编辑知识库"
                    >
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(knowledgeBase.id)}
                      className="rounded-lg p-2 text-red-600 transition-colors hover:bg-red-50"
                      title="删除知识库"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  {getStatusBadge(knowledgeBase.status)}
                  <span className="text-sm text-gray-500">
                    来源: {getSourceTypeLabel(knowledgeBase.sourceType)}
                  </span>
                  {knowledgeBase.lastSyncedAt && (
                    <span className="text-sm text-gray-500">
                      上次同步:{' '}
                      <ClientDate
                        date={knowledgeBase.lastSyncedAt}
                        format="datetime"
                        locale="zh-CN"
                      />
                    </span>
                  )}
                </div>

                {knowledgeBase.lastError && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                    <p className="text-sm text-red-700">
                      {knowledgeBase.lastError}
                    </p>
                  </div>
                )}
              </div>

              {/* 统计信息 */}
              {stats && (
                <div className="mb-6 grid grid-cols-4 gap-4">
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-2xl font-bold text-gray-900">
                      {stats.documentCount}
                    </p>
                    <p className="text-sm text-gray-500">文档数</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-2xl font-bold text-gray-900">
                      {stats.parentChunkCount}
                    </p>
                    <p className="text-sm text-gray-500">父分块</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-2xl font-bold text-gray-900">
                      {stats.childChunkCount}
                    </p>
                    <p className="text-sm text-gray-500">子分块 (向量)</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-2xl font-bold text-gray-900">
                      {(stats.totalTokens / 1000).toFixed(1)}k
                    </p>
                    <p className="text-sm text-gray-500">总 Token 数</p>
                  </div>
                </div>
              )}

              {/* 添加文档 */}
              {knowledgeBase.sourceType === 'MANUAL' && (
                <AddDocumentForm knowledgeBaseId={knowledgeBase.id} />
              )}

              {/* 从内部报告（Playground / Topic Insight）导入 */}
              <InternalReportsImportPanel
                knowledgeBaseId={knowledgeBase.id}
                onImportComplete={() => refreshDetail()}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Database className="mx-auto h-16 w-16 text-gray-300" />
                <p className="mt-4 text-gray-500">选择一个知识库查看详情</p>
              </div>
            </div>
          )}
        </div>

        {/* 创建对话框 */}
        {showCreateDialog && (
          <CreateKnowledgeBaseDialog
            onClose={() => setShowCreateDialog(false)}
            onCreate={handleCreate}
            creating={creating}
          />
        )}

        {/* 查询面板 */}
        {showQueryPanel && selectedKB && (
          <QueryPanel
            knowledgeBaseId={selectedKB}
            onClose={() => setShowQueryPanel(false)}
          />
        )}

        {/* 编辑对话框 */}
        {showEditDialog && knowledgeBase && (
          <EditKnowledgeBaseDialog
            knowledgeBase={knowledgeBase}
            onClose={() => setShowEditDialog(false)}
            onSave={handleEdit}
            saving={updating}
          />
        )}
      </div>
    </AppShell>
  );
}

/**
 * 创建知识库对话框
 */
function CreateKnowledgeBaseDialog({
  onClose,
  onCreate,
  creating,
}: {
  onClose: () => void;
  onCreate: (dto: CreateKnowledgeBaseDto) => void;
  creating: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceType, setSourceType] = useState<
    'MANUAL' | 'GOOGLE_DRIVE' | 'URL'
  >('MANUAL');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({
      name,
      description: description || undefined,
      sourceType,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="创建知识库"
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            form="create-kb-form"
            type="submit"
            disabled={!name || creating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? '创建中...' : '创建'}
          </button>
        </>
      }
    >
      <form id="create-kb-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            名称
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="输入知识库名称"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            描述 (可选)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="描述这个知识库的用途"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            数据来源
          </label>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="MANUAL">手动上传文档</option>
            <option value="GOOGLE_DRIVE">同步 Google Drive</option>
            <option value="URL">URL 抓取</option>
          </select>
        </div>
      </form>
    </Modal>
  );
}

/**
 * 添加文档表单
 */
function AddDocumentForm({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [adding, setAdding] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const response = await fetch(
        `/api/rag/knowledge-bases/${knowledgeBaseId}/documents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        }
      );
      if (!response.ok) throw new Error('添加失败');
      setTitle('');
      setContent('');
      toast.success('文档已添加，请点击"处理文档"生成向量');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加失败');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="mb-4 font-semibold text-gray-900">添加文档</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            标题
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="文档标题"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            内容
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            rows={6}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="粘贴文档内容..."
          />
        </div>
        <button
          type="submit"
          disabled={!title || !content || adding}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {adding ? '添加中...' : '添加文档'}
        </button>
      </form>
    </div>
  );
}

/**
 * 查询测试面板
 */
function QueryPanel({
  knowledgeBaseId,
  onClose,
}: {
  knowledgeBaseId: string;
  onClose: () => void;
}) {
  const [queryText, setQueryText] = useState('');
  const { result, loading, error, query, reset } = useRAGQuery();

  const handleQuery = async () => {
    if (!queryText.trim()) return;
    await query(queryText, [knowledgeBaseId]);
  };

  return (
    <Modal open onClose={onClose} title="测试 RAG 查询" size="xl">
      <div className="flex gap-2">
        <input
          type="text"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleQuery()}
          placeholder="输入查询问题..."
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2"
        />
        <button
          onClick={() => void handleQuery()}
          disabled={loading || !queryText.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '查询中...' : '查询'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error.message}</p>
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h3 className="mb-2 font-medium text-gray-900">检索上下文</h3>
            <pre className="whitespace-pre-wrap text-sm text-gray-700">
              {result.context.text || '无匹配内容'}
            </pre>
          </div>

          {result.context.sources.length > 0 && (
            <div>
              <h3 className="mb-2 font-medium text-gray-900">
                来源 ({result.context.sources.length})
              </h3>
              <div className="space-y-2">
                {result.context.sources.map((source, i) => (
                  <CitationListItem
                    key={i}
                    title={source.documentTitle}
                    description={source.excerpt}
                    actions={
                      <span className="text-xs text-gray-500">
                        相关度: {(source.score * 100).toFixed(1)}%
                      </span>
                    }
                    meta={
                      source.sectionTitle ? (
                        <span>章节: {source.sectionTitle}</span>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-500">
            处理时间: {result.processingTime.total}ms (搜索:{' '}
            {result.processingTime.search}ms
            {result.processingTime.hyde &&
              `, HyDE: ${result.processingTime.hyde}ms`}
            {result.processingTime.rerank &&
              `, 重排序: ${result.processingTime.rerank}ms`}
            )
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * 编辑知识库对话框
 */
function EditKnowledgeBaseDialog({
  knowledgeBase,
  onClose,
  onSave,
  saving,
}: {
  knowledgeBase: KnowledgeBase;
  onClose: () => void;
  onSave: (data: { name: string; description?: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(knowledgeBase.name);
  const [description, setDescription] = useState(
    knowledgeBase.description || ''
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      description: description || undefined,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="编辑知识库"
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            form="edit-kb-form"
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </>
      }
    >
      <form id="edit-kb-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            名称
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="输入知识库名称"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            描述 (可选)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="描述这个知识库的用途"
          />
        </div>
      </form>
    </Modal>
  );
}
