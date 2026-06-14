'use client';

import { useState, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Cpu,
  Database,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/i18n-context';

// RAG服务状态类型
export interface RAGServiceStatus {
  embedding: {
    status: 'ok' | 'error' | 'loading';
    modelId?: string;
    provider?: string;
    dimensions?: number;
    error?: string;
  };
  database: {
    status: 'ok' | 'error' | 'loading';
    error?: string;
  };
}

interface RAGStatusIndicatorProps {
  status: RAGServiceStatus;
  onRefresh?: () => void;
}

/**
 * RAG 服务状态指示器
 * 显示为小型按钮，点击展开详情面板
 */
export default function RAGStatusIndicator({
  status,
  onRefresh,
}: RAGStatusIndicatorProps) {
  const { t } = useI18n();
  const [showDetails, setShowDetails] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭面板
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        setShowDetails(false);
      }
    };

    if (showDetails) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDetails]);

  // 计算整体状态
  const overallStatus =
    status.embedding.status === 'ok' && status.database.status === 'ok'
      ? 'ok'
      : status.embedding.status === 'error' ||
          status.database.status === 'error'
        ? 'error'
        : 'loading';

  return (
    <div className="relative" ref={panelRef}>
      {/* 状态指示器按钮 */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all ${
          overallStatus === 'ok'
            ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
            : overallStatus === 'error'
              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
              : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
        }`}
      >
        {overallStatus === 'ok' && (
          <>
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="hidden sm:inline">
              {t('library.rag.status.ok')}
            </span>
          </>
        )}
        {overallStatus === 'error' && (
          <>
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="hidden sm:inline">
              {t('library.rag.status.error')}
            </span>
          </>
        )}
        {overallStatus === 'loading' && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="hidden sm:inline">
              {t('library.rag.status.checking')}
            </span>
          </>
        )}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${showDetails ? 'rotate-180' : ''}`}
        />
      </button>

      {/* 详情下拉面板 */}
      {showDetails && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
          {/* 标题 */}
          <div className="mb-4 flex items-center justify-between">
            <h4 className="font-semibold text-gray-900">
              {t('library.rag.status.title')}
            </h4>
            {onRefresh && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRefresh();
                }}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
                title={t('library.rag.status.refresh')}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* 嵌入服务状态 */}
          <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    status.embedding.status === 'ok'
                      ? 'bg-green-100 text-green-600'
                      : status.embedding.status === 'error'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {t('library.rag.status.embeddingService')}
                  </p>
                  {status.embedding.status === 'ok' &&
                    status.embedding.modelId && (
                      <p className="text-xs text-gray-500">
                        {status.embedding.modelId} (
                        {status.embedding.dimensions}D)
                      </p>
                    )}
                  {status.embedding.status === 'error' && (
                    <p className="text-xs text-red-500">
                      {status.embedding.error}
                    </p>
                  )}
                </div>
              </div>
              {status.embedding.status === 'ok' ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : status.embedding.status === 'error' ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              )}
            </div>
          </div>

          {/* 数据库状态 */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    status.database.status === 'ok'
                      ? 'bg-green-100 text-green-600'
                      : status.database.status === 'error'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {t('library.rag.status.vectorDatabase')}
                  </p>
                  {status.database.status === 'ok' && (
                    <p className="text-xs text-gray-500">
                      PostgreSQL + pgvector
                    </p>
                  )}
                  {status.database.status === 'error' && (
                    <p className="text-xs text-red-500">
                      {status.database.error}
                    </p>
                  )}
                </div>
              </div>
              {status.database.status === 'ok' ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : status.database.status === 'error' ? (
                <XCircle className="h-5 w-5 text-red-500" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              )}
            </div>
          </div>

          {/* 提示信息 */}
          {overallStatus === 'error' && (
            <p className="mt-3 text-xs text-gray-500">
              {t('library.rag.status.errorHint')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
