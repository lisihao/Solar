'use client';

import {
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Layers,
  Zap,
  Database,
  FolderOpen,
  Calendar,
  Link2,
  ArrowLeft,
} from 'lucide-react';
import { formatDateSafe } from '@/lib/utils/date';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { Modal } from '@/components/ui/dialogs/Modal';

interface Document {
  id: string;
  title: string;
  status: string;
  sourceType?: string;
  sourceUrl?: string;
  chunkCount: number;
  embeddingCount?: number;
  isVectorized?: boolean;
  createdAt?: string;
  mimeType?: string;
  // W1 v2.0 rebuild: preparse 状态（URL/YT 文档的源语料富化进度）
  metadata?: {
    preparse?: {
      status: 'pending' | 'parsing' | 'ready' | 'failed';
      mediaUrls?: string[];
      sourceLocale?: 'zh' | 'en';
      errorCode?: string;
    };
  };
}

interface DocumentListDialogProps {
  documents: Document[];
  knowledgeBaseName: string;
  onClose: () => void;
  onBack?: () => void;
}

/**
 * 文档列表弹窗
 * 专业、美观、阅读友好的文档详情展示
 */
export default function DocumentListDialog({
  documents,
  knowledgeBaseName,
  onClose,
  onBack,
}: DocumentListDialogProps) {
  const vectorizedCount = documents.filter(
    (d) => d.isVectorized === true
  ).length;
  const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);
  const totalEmbeddings = documents.reduce(
    (sum, d) => sum + (d.embeddingCount || 0),
    0
  );

  const getSourceIcon = (sourceType?: string) => {
    switch (sourceType?.toLowerCase()) {
      case 'google_drive':
        return <FolderOpen className="h-4 w-4 text-blue-500" />;
      case 'url':
        return <Link2 className="h-4 w-4 text-green-500" />;
      case 'manual':
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  const getSourceLabel = (sourceType?: string) => {
    switch (sourceType?.toLowerCase()) {
      case 'google_drive':
        return 'Google Drive';
      case 'url':
        return 'URL';
      case 'manual':
      default:
        return '手动上传';
    }
  };

  const getStatusInfo = (doc: Document) => {
    if (doc.isVectorized === true) {
      return {
        icon: <CheckCircle className="h-5 w-5 text-green-500" />,
        label: '已向量化',
        color: 'text-green-600',
        bgColor: 'bg-green-50',
      };
    }
    if (doc.status === 'ERROR') {
      return {
        icon: <XCircle className="h-5 w-5 text-red-500" />,
        label: '处理失败',
        color: 'text-red-600',
        bgColor: 'bg-red-50',
      };
    }
    if (doc.status === 'PROCESSING') {
      return {
        icon: <Loader2 className="h-5 w-5 animate-spin text-blue-500" />,
        label: '处理中',
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
      };
    }
    return {
      icon: <Clock className="h-5 w-5 text-gray-400" />,
      label: '待处理',
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
    };
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/80 hover:text-gray-700"
              title="返回知识库详情"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-lg">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-gray-900">
              {knowledgeBaseName}
            </div>
            <div className="text-xs text-gray-500">文档列表</div>
          </div>
        </div>
      }
      size="lg"
      headerClassName="border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-4"
      contentClassName="p-0 flex flex-col overflow-hidden"
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-xs text-gray-500">
            共 {documents.length} 个文档
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            关闭
          </button>
        </div>
      }
      footerClassName="border-t border-gray-100 bg-gray-50/50 px-6 py-3"
    >
      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4 border-b border-gray-100 bg-gray-50/50 px-6 py-3">
        <div className="text-center">
          <div className="text-lg font-bold text-gray-900">
            {documents.length}
          </div>
          <div className="text-xs text-gray-500">文档总数</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-green-600">
            {vectorizedCount}
          </div>
          <div className="text-xs text-gray-500">已向量化</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-blue-600">{totalChunks}</div>
          <div className="text-xs text-gray-500">分块数</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-purple-600">
            {totalEmbeddings}
          </div>
          <div className="text-xs text-gray-500">向量数</div>
        </div>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {documents.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<FileText className="h-12 w-12" />}
            title="暂无文档"
          />
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => {
              const status = getStatusInfo(doc);
              return (
                <div
                  key={doc.id}
                  className="group rounded-xl border border-gray-100 bg-white p-4 transition-all hover:border-indigo-200 hover:shadow-md"
                >
                  {/* Row 1: Status Icon + Title + Status Badge */}
                  <div className="flex items-start gap-3">
                    {/* Status Icon */}
                    <div
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${status.bgColor}`}
                    >
                      {status.icon}
                    </div>

                    {/* Title and Status */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3
                          className="line-clamp-2 flex-1 text-sm font-medium leading-5 text-gray-900"
                          title={doc.title}
                        >
                          {doc.title}
                        </h3>
                        <span
                          className={`flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${status.bgColor} ${status.color}`}
                        >
                          {status.label}
                        </span>
                      </div>

                      {/* Row 2: Meta Info */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                        {/* Source */}
                        <span className="flex items-center gap-1">
                          {getSourceIcon(doc.sourceType)}
                          {getSourceLabel(doc.sourceType)}
                        </span>

                        {/* W1 v2.0: 预解析状态徽章 */}
                        <PreparseBadge preparse={doc.metadata?.preparse} />

                        {/* Chunks */}
                        {doc.chunkCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Layers className="h-3.5 w-3.5 text-blue-500" />
                            {doc.chunkCount} 分块
                          </span>
                        )}

                        {/* Embeddings */}
                        {doc.embeddingCount !== undefined &&
                          doc.embeddingCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Zap className="h-3.5 w-3.5 text-purple-500" />
                              {doc.embeddingCount} 向量
                            </span>
                          )}

                        {/* Date */}
                        {doc.createdAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDateSafe(doc.createdAt, 'date')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Source URL (if exists) */}
                  {doc.sourceUrl && (
                    <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2">
                      <a
                        href={doc.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700"
                        title={doc.sourceUrl}
                      >
                        <Link2 className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{doc.sourceUrl}</span>
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * W1 v2.0 rebuild：preparse 状态徽章。
 * 仅 URL / YouTube 类源文档有 preparse 字段；手工粘贴文本 metadata.preparse=undefined → 不显示徽章。
 */
function PreparseBadge({
  preparse,
}: {
  preparse?: {
    status: 'pending' | 'parsing' | 'ready' | 'failed';
    mediaUrls?: string[];
    sourceLocale?: 'zh' | 'en';
    errorCode?: string;
  };
}) {
  if (!preparse) return null;
  const { status, mediaUrls = [], sourceLocale } = preparse;
  if (status === 'parsing') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
        解析中
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
        title={`已抽取 ${mediaUrls.length} 张图${sourceLocale ? ` · 源语种 ${sourceLocale}` : ''}`}
      >
        已就绪 · {mediaUrls.length}图
        {sourceLocale && (
          <span className="text-emerald-500">[{sourceLocale}]</span>
        )}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700"
        title={preparse.errorCode}
      >
        解析失败
      </span>
    );
  }
  // pending
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
      待解析
    </span>
  );
}
