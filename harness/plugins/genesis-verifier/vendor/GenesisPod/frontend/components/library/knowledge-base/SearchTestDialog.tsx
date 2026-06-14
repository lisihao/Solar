'use client';

import { useState } from 'react';
import { Search, Loader2, FileText, Zap, AlertCircle } from 'lucide-react';
import { CopyButton } from '@/components/ui/primitives/CopyButton';
import { apiClient } from '@/lib/api/client';
import { Modal } from '@/components/ui/dialogs/Modal';

interface SearchResult {
  id: string;
  content: string;
  score: number;
  documentTitle?: string;
  documentId?: string;
  metadata?: Record<string, unknown>;
}

interface SearchTestDialogProps {
  knowledgeBaseId: string;
  onClose: () => void;
}

/**
 * 向量搜索测试对话框
 * 允许用户输入查询并查看向量检索结果
 */
export default function SearchTestDialog({
  knowledgeBaseId,
  onClose,
}: SearchTestDialogProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [topK, setTopK] = useState(5);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setSearching(true);
    setError(null);
    setResults([]);

    try {
      const data = await apiClient.post<{ results: SearchResult[] }>(
        '/rag/simple-query',
        {
          query: query.trim(),
          knowledgeBaseIds: [knowledgeBaseId],
          topK,
        }
      );
      setResults(data.results || []);
    } catch (err) {
      setError((err as { message?: string })?.message || '搜索出错');
    } finally {
      setSearching(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600 bg-green-50';
    if (score >= 0.6) return 'text-blue-600 bg-blue-50';
    if (score >= 0.4) return 'text-amber-600 bg-amber-50';
    return 'text-gray-600 bg-gray-50';
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-gray-900">
              向量搜索测试
            </div>
            <div className="text-xs text-gray-500">
              测试知识库的语义检索效果
            </div>
          </div>
        </div>
      }
      size="xl"
      headerClassName="border-b border-gray-200 bg-gradient-to-r from-purple-50 to-indigo-50 px-6 py-4"
      contentClassName="p-0 flex flex-col overflow-hidden"
      footer={
        <div className="flex w-full items-center justify-between text-xs text-gray-500">
          <span>使用 Embedding 向量进行语义相似度搜索</span>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            关闭
          </button>
        </div>
      }
      footerClassName="bg-gray-50 px-6 py-3"
    >
      {/* Search Input */}
      <div className="border-b border-gray-200 bg-gray-50 p-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="输入搜索内容，按 Enter 搜索..."
              className="w-full rounded-lg border border-gray-300 py-3 pl-10 pr-4 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
            />
          </div>
          <select
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
          >
            <option value={3}>Top 3</option>
            <option value={5}>Top 5</option>
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
          </select>
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-sm font-medium text-white transition-all hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50"
          >
            {searching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            搜索
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!searching && results.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Zap className="h-12 w-12 text-gray-300" />
            <p className="mt-3 text-sm">输入查询内容进行向量语义搜索</p>
            <p className="mt-1 text-xs text-gray-400">
              系统将从知识库中检索最相关的文档片段
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-700">
                找到 {results.length} 个相关结果
              </h3>
              <span className="text-xs text-gray-500">按相关度排序</span>
            </div>

            {results.map((result, index) => (
              <div
                key={result.id}
                className="group rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-purple-200 hover:shadow-md"
              >
                {/* Result Header */}
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">
                      {index + 1}
                    </span>
                    {result.documentTitle && (
                      <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                        <FileText className="h-4 w-4 text-gray-400" />
                        {result.documentTitle}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-medium ${getScoreColor(result.score)}`}
                    >
                      相关度: {(result.score * 100).toFixed(1)}%
                    </span>
                    <CopyButton
                      value={result.content}
                      title="复制内容"
                      size="sm"
                      className="opacity-0 transition-all group-hover:opacity-100"
                    />
                  </div>
                </div>

                {/* Result Content */}
                <div className="rounded-md bg-gray-50 p-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                    {result.content}
                  </p>
                </div>

                {/* Metadata */}
                {result.metadata && Object.keys(result.metadata).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(result.metadata)
                      .filter(
                        ([key]) => !['chunkIndex', 'parentId'].includes(key)
                      )
                      .slice(0, 3)
                      .map(([key, value]) => (
                        <span
                          key={key}
                          className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                        >
                          {key}: {String(value).slice(0, 30)}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
