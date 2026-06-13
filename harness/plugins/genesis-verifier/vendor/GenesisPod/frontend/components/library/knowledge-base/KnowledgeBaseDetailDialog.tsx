'use client';

import { useEffect, useState } from 'react';
import {
  FileText,
  RefreshCw,
  Loader2,
  Calendar,
  Search,
  Layers,
  CheckCircle,
  Clock,
  Database,
  Plus,
  Pencil,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  Cloud,
  Globe,
  Bookmark,
  NotebookPen,
  ImageIcon,
  BookOpen,
  ChevronUp,
  Trash2,
  Check,
} from 'lucide-react';
import {
  useKnowledgeBaseDetail,
  type KnowledgeBaseDocument,
} from '@/hooks/domain/useKnowledgeBase';
import { formatDateSafe } from '@/lib/utils/date';
import { Modal } from '@/components/ui/dialogs/Modal';

interface KnowledgeBaseDetailDialogProps {
  knowledgeBaseId: string;
  onClose: () => void;
  onEdit?: () => void;
  onAddDocuments?: () => void;
  onSearchTest?: () => void;
  onViewDocuments?: (docs: KnowledgeBaseDocument[]) => void;
}

/**
 * 知识库详情弹窗
 * 显示知识库的概览信息、统计数据和文档列表
 * 编辑模式可以删除文档
 */
export default function KnowledgeBaseDetailDialog({
  knowledgeBaseId,
  onClose,
  onEdit,
  onAddDocuments,
  onSearchTest,
  onViewDocuments,
}: KnowledgeBaseDetailDialogProps) {
  // Note: onEdit is available for parent components to trigger edit mode
  void onEdit; // suppress unused variable warning if not used internally
  const {
    knowledgeBase,
    stats,
    documents,
    loading,
    syncing,
    processing,
    progress,
    syncGoogleDrive,
    processDocuments,
    deleteDocument,
    deletingDocument,
    error,
  } = useKnowledgeBaseDetail(knowledgeBaseId);

  // cooldown 剩余秒数（每秒 tick）
  const [cooldownLeft, setCooldownLeft] = useState<number>(0);
  useEffect(() => {
    if (!progress?.cooldownUntil) {
      setCooldownLeft(0);
      return;
    }
    const target = new Date(progress.cooldownUntil).getTime();
    const tick = () => {
      const remain = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setCooldownLeft(remain);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [progress?.cooldownUntil]);

  const isProcessing =
    processing || knowledgeBase?.status === 'PROCESSING' || !!progress;
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  // 文档列表分页状态
  const [showAllDocs, setShowAllDocs] = useState(false);
  const DOCS_PER_PAGE = 5;

  // 编辑模式状态
  const [editMode, setEditMode] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  // ESC handling delegated to Modal component

  const getSourceTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
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

  const getSourceTypeIcon = (type: string) => {
    const iconClass = 'h-4 w-4';
    const icons: Record<string, React.ReactNode> = {
      GOOGLE_DRIVE: <Cloud className={`${iconClass} text-emerald-500`} />,
      MANUAL: <BookOpen className={`${iconClass} text-blue-500`} />,
      URL: <Globe className={`${iconClass} text-purple-500`} />,
      NOTION: <Layers className={`${iconClass} text-gray-600`} />,
      BOOKMARK: <Bookmark className={`${iconClass} text-orange-500`} />,
      NOTE: <NotebookPen className={`${iconClass} text-pink-500`} />,
      IMAGE: <ImageIcon className={`${iconClass} text-cyan-500`} />,
    };
    return icons[type] || <Database className={`${iconClass} text-gray-500`} />;
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'READY':
        return {
          label: '就绪',
          color: 'text-green-600',
          bgColor: 'bg-green-100',
          icon: <CheckCircle className="h-4 w-4" />,
        };
      case 'PROCESSING':
        return {
          label: '处理中',
          color: 'text-blue-600',
          bgColor: 'bg-blue-100',
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
        };
      case 'ERROR':
        return {
          label: '错误',
          color: 'text-red-600',
          bgColor: 'bg-red-100',
          icon: <AlertCircle className="h-4 w-4" />,
        };
      default:
        return {
          label: '待处理',
          color: 'text-gray-600',
          bgColor: 'bg-gray-100',
          icon: <Clock className="h-4 w-4" />,
        };
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-lg">
            <Database className="h-6 w-6" />
          </div>
          <div>
            {loading && !knowledgeBase ? (
              <div className="h-6 w-32 animate-pulse rounded bg-gray-200" />
            ) : (
              <div className="text-xl font-semibold text-gray-900">
                {knowledgeBase?.name || '知识库详情'}
              </div>
            )}
            <div className="text-sm text-gray-500">知识库概览</div>
          </div>
        </div>
      }
      size="xl"
      headerClassName="border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4"
      footer={
        <button
          onClick={onClose}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
        >
          关闭
        </button>
      }
      footerClassName="border-t border-gray-100 bg-gray-50/50 px-6 py-3"
    >
      {loading && !knowledgeBase ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className="ml-3 text-gray-500">加载中...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16">
          <AlertCircle className="h-12 w-12 text-red-400" />
          <p className="mt-3 text-gray-600">加载失败</p>
          <p className="text-sm text-gray-500">{error.message}</p>
        </div>
      ) : knowledgeBase ? (
        <div className="space-y-6">
          {/* Status and Source Types */}
          <div className="flex flex-wrap items-center gap-3">
            {(() => {
              const status = getStatusInfo(knowledgeBase.status);
              return (
                <span
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${status.bgColor} ${status.color}`}
                >
                  {status.icon}
                  {status.label}
                </span>
              );
            })()}
            {(knowledgeBase.sourceTypes?.length
              ? knowledgeBase.sourceTypes
              : [knowledgeBase.sourceType]
            ).map((type) => (
              <span
                key={type}
                className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600"
              >
                {getSourceTypeIcon(type)}
                {getSourceTypeLabel(type)}
              </span>
            ))}
          </div>

          {/* Description */}
          {knowledgeBase.description && (
            <p className="text-gray-600">{knowledgeBase.description}</p>
          )}

          {/* Statistics */}
          {stats && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl bg-blue-50 p-4 text-center">
                <p className="text-2xl font-bold text-blue-700">
                  {stats.documentCount}
                </p>
                <p className="text-sm text-blue-600">文档</p>
              </div>
              <div className="rounded-xl bg-green-50 p-4 text-center">
                <p className="text-2xl font-bold text-green-700">
                  {stats.childChunkCount}
                </p>
                <p className="text-sm text-green-600">分块</p>
              </div>
              <div className="rounded-xl bg-purple-50 p-4 text-center">
                <p className="text-2xl font-bold text-purple-700">
                  {stats.embeddingCount ?? 0}
                </p>
                <p className="text-sm text-purple-600">向量</p>
              </div>
              <div className="rounded-xl bg-orange-50 p-4 text-center">
                <p className="text-2xl font-bold text-orange-700">
                  {stats.totalTokens >= 1000
                    ? `${(stats.totalTokens / 1000).toFixed(1)}k`
                    : stats.totalTokens}
                </p>
                <p className="text-sm text-orange-600">Tokens</p>
              </div>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span>
                创建: {formatDateSafe(knowledgeBase.createdAt, 'date')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span>
                更新: {formatDateSafe(knowledgeBase.updatedAt, 'date')}
              </span>
            </div>
            {knowledgeBase.lastSyncedAt && (
              <div className="flex items-center gap-2 text-gray-600">
                <RefreshCw className="h-4 w-4 text-gray-400" />
                <span>
                  同步: {formatDateSafe(knowledgeBase.lastSyncedAt, 'date')}
                </span>
              </div>
            )}
          </div>

          {/* 向量化进度条（PROCESSING 中） */}
          {isProcessing && (
            <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 font-medium text-blue-900">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {progress?.stage === 'cooling'
                    ? `Embedding 限流冷却中${cooldownLeft > 0 ? ` · ${cooldownLeft}s` : ''}`
                    : '向量化中'}
                </div>
                {progress && (
                  <span className="font-mono text-xs text-blue-700">
                    {progress.processed}/{progress.total} · {pct}%
                  </span>
                )}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                <div
                  className={`h-full transition-all ${
                    progress?.stage === 'cooling'
                      ? 'bg-amber-500'
                      : 'bg-blue-600'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {progress?.lastError && progress.stage !== 'cooling' && (
                <p
                  className="line-clamp-2 text-xs text-amber-700"
                  title={progress.lastError}
                >
                  最近错误：{progress.lastError}
                </p>
              )}
            </div>
          )}

          {/* ERROR 状态横幅 + 重试 */}
          {!isProcessing &&
            knowledgeBase.status === 'ERROR' &&
            knowledgeBase.lastError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-900">
                    向量化未完成
                  </p>
                  <p className="mt-1 text-xs text-red-700">
                    {knowledgeBase.lastError}
                  </p>
                </div>
                <button
                  onClick={() => processDocuments()}
                  disabled={processing}
                  className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试向量化
                </button>
              </div>
            )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
            {stats && (stats.embeddingCount ?? 0) > 0 && onSearchTest && (
              <button
                onClick={onSearchTest}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-purple-700 hover:to-indigo-700"
              >
                <Search className="h-4 w-4" />
                测试搜索
              </button>
            )}
            <button
              onClick={() => processDocuments()}
              disabled={isProcessing}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Layers
                className={`h-4 w-4 ${isProcessing ? 'animate-spin' : ''}`}
              />
              {isProcessing ? '处理中...' : '向量化'}
            </button>
            {(knowledgeBase.sourceType === 'GOOGLE_DRIVE' ||
              knowledgeBase.sourceTypes?.includes('GOOGLE_DRIVE')) && (
              <button
                onClick={() => syncGoogleDrive()}
                disabled={syncing}
                className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`}
                />
                {syncing ? '同步中...' : '同步'}
              </button>
            )}
            {documents && documents.length > 0 && (
              <button
                onClick={() => setEditMode(!editMode)}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  editMode
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {editMode ? (
                  <>
                    <Check className="h-4 w-4" />
                    完成
                  </>
                ) : (
                  <>
                    <Pencil className="h-4 w-4" />
                    管理
                  </>
                )}
              </button>
            )}
            {onAddDocuments && (
              <button
                onClick={onAddDocuments}
                className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100"
              >
                <Plus className="h-4 w-4" />
                添加内容
              </button>
            )}
          </div>

          {/* Documents Section */}
          {documents && documents.length > 0 && (
            <div className="space-y-4 border-t border-gray-100 pt-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-gray-900">
                  <FileText className="h-4 w-4 text-gray-500" />
                  文档列表
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {documents.length}
                  </span>
                </h3>
                {onViewDocuments && (
                  <button
                    onClick={() => onViewDocuments(documents)}
                    className="flex items-center gap-1 text-sm text-blue-600 transition-colors hover:text-blue-700"
                  >
                    查看全部详情
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div
                className={`space-y-2 ${showAllDocs ? 'max-h-96' : 'max-h-64'} overflow-y-auto pr-1`}
              >
                {(showAllDocs
                  ? documents
                  : documents.slice(0, DOCS_PER_PAGE)
                ).map((doc) => (
                  <div
                    key={doc.id}
                    className="group rounded-lg border border-gray-100 bg-white p-3 transition-all hover:border-blue-200 hover:shadow-sm"
                  >
                    {/* Document Header - Title + Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-2.5">
                        <div
                          className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded ${
                            doc.isVectorized ? 'bg-green-100' : 'bg-gray-100'
                          }`}
                        >
                          <FileText
                            className={`h-3.5 w-3.5 ${
                              doc.isVectorized
                                ? 'text-green-600'
                                : 'text-gray-500'
                            }`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="line-clamp-2 text-sm font-medium text-gray-900"
                            title={doc.title}
                          >
                            {doc.title}
                          </p>
                          {/* Meta info */}
                          <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              {getSourceTypeIcon(doc.sourceType || 'MANUAL')}
                              {getSourceTypeLabel(doc.sourceType || 'MANUAL')}
                            </span>
                            {doc.chunkCount > 0 && (
                              <span className="flex items-center gap-1">
                                <Layers className="h-3 w-3" />
                                {doc.chunkCount} 分块
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Status Badge + Actions */}
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {!editMode && (
                          <span
                            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                              doc.isVectorized
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {doc.isVectorized ? '已向量化' : '待处理'}
                          </span>
                        )}
                        {doc.sourceUrl && !editMode && (
                          <a
                            href={doc.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded p-1 text-gray-400 transition-all hover:bg-blue-50 hover:text-blue-600"
                            title="打开源链接"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        {/* 编辑模式：删除按钮 */}
                        {editMode &&
                          (deletingDocId === doc.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-500">
                                确认删除？
                              </span>
                              <button
                                onClick={async () => {
                                  await deleteDocument(doc.id);
                                  setDeletingDocId(null);
                                }}
                                disabled={deletingDocument}
                                className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                              >
                                {deletingDocument ? '删除中...' : '确认'}
                              </button>
                              <button
                                onClick={() => setDeletingDocId(null)}
                                className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeletingDocId(doc.id)}
                              className="rounded p-1.5 text-gray-400 transition-all hover:bg-red-50 hover:text-red-600"
                              title="删除文档"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {documents.length > DOCS_PER_PAGE && (
                <button
                  onClick={() => setShowAllDocs(!showAllDocs)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 py-2.5 text-sm font-medium text-gray-600 transition-all hover:bg-gray-100"
                >
                  {showAllDocs ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      收起列表
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      展开全部 ({documents.length - DOCS_PER_PAGE} 个更多)
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16">
          <AlertCircle className="h-12 w-12 text-amber-400" />
          <p className="mt-3 text-gray-600">未找到知识库</p>
        </div>
      )}
    </Modal>
  );
}
