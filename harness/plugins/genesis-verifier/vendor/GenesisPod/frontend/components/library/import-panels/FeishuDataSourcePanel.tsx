'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  FileText,
  Table,
  Database,
  Link as LinkIcon,
  Copy,
  ExternalLink,
  Trash2,
  Plus,
  Zap,
  BookOpen,
  MessageSquare,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { getAuthHeader } from '@/lib/utils/auth';
import { formatDateSafe } from '@/lib/utils/date';
import { logger } from '@/lib/utils/logger';
import { OrganizeChatMode } from '@/components/library/OrganizeChatMode';
import { Alert } from '@/components/ui/feedback/Alert';

interface FeishuItem {
  id: string;
  type: 'WIKI_NODE' | 'DOC' | 'SHEET' | 'BITABLE' | 'EXTERNAL';
  title: string;
  description: string | null;
  sourceUrl: string;
  content: string | null;
  nodeToken: string | null;
  author: string | null;
  syncedAt: string;
  syncedToRag: boolean;
  ragKnowledgeBaseId: string | null;
  createdAt: string;
}

interface FeishuStats {
  totalItems: number;
  wikiNodeCount: number;
  docCount: number;
  sheetCount: number;
  bitableCount: number;
  externalCount: number;
  syncedToRagCount: number;
  lastSyncAt: string | null;
}

interface FeishuStatus {
  isConnected: boolean;
  appId: string | null;
  stats: FeishuStats;
}

export default function FeishuDataSourcePanel() {
  // 数据源统一整理：飞书对话整理浮层开关
  const [organizeChatOpen, setOrganizeChatOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<FeishuStatus | null>(null);
  const [items, setItems] = useState<FeishuItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.apiUrl}/feishu-data-source/status`,
        {
          headers: { ...getAuthHeader() },
        }
      );
      if (response.ok) {
        const result = await response.json();
        const data = result?.data ?? result;
        setStatus(data);
      }
    } catch (error) {
      logger.error('Failed to fetch Feishu status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoadingItems(true);
    setError(null);
    try {
      const response = await fetch(
        `${config.apiUrl}/feishu-data-source/items?limit=50`,
        {
          headers: { ...getAuthHeader() },
        }
      );
      if (response.ok) {
        const result = await response.json();
        const data = result?.data ?? result;
        setItems(data.items || []);
      }
    } catch (error) {
      logger.error('Failed to fetch Feishu items:', error);
      setError('加载内容失败');
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchItems();
  }, [fetchStatus, fetchItems]);

  const getItemIcon = (type: string) => {
    switch (type) {
      case 'WIKI_NODE':
        return <BookOpen className="h-4 w-4 text-blue-500" />;
      case 'DOC':
        return <FileText className="h-4 w-4 text-blue-500" />;
      case 'SHEET':
        return <Table className="h-4 w-4 text-green-500" />;
      case 'BITABLE':
        return <Database className="h-4 w-4 text-purple-500" />;
      default:
        return <LinkIcon className="h-4 w-4 text-gray-500" />;
    }
  };

  const getItemTypeLabel = (type: string) => {
    switch (type) {
      case 'WIKI_NODE':
        return 'Wiki';
      case 'DOC':
        return '云文档';
      case 'SHEET':
        return '电子表格';
      case 'BITABLE':
        return '多维表格';
      default:
        return '外部链接';
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      const response = await fetch(
        `${config.apiUrl}/feishu-data-source/items/${itemId}`,
        {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
        }
      );
      if (response.ok) {
        setItems(items.filter((item) => item.id !== itemId));
        setSelectedItems((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
        fetchStatus();
      }
    } catch (error) {
      logger.error('Failed to delete item:', error);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedItems.size === 0) return;

    try {
      const response = await fetch(
        `${config.apiUrl}/feishu-data-source/items/batch-delete`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids: Array.from(selectedItems) }),
        }
      );
      if (response.ok) {
        setItems(items.filter((item) => !selectedItems.has(item.id)));
        setSelectedItems(new Set());
        fetchStatus();
      }
    } catch (error) {
      logger.error('Failed to batch delete items:', error);
    }
  };

  const handleAddUrl = async () => {
    if (!newUrl.trim()) return;

    setAddingUrl(true);
    setError(null);

    try {
      const response = await fetch(
        `${config.apiUrl}/feishu-data-source/items`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: newUrl.trim() }),
        }
      );

      if (response.ok) {
        setNewUrl('');
        setShowAddUrl(false);
        fetchItems();
        fetchStatus();
      } else {
        const result = await response.json();
        const data = result?.data ?? result;
        setError(data.message || '添加失败');
      }
    } catch (error) {
      logger.error('Failed to add URL:', error);
      setError('添加失败');
    } finally {
      setAddingUrl(false);
    }
  };

  const toggleSelectItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map((item) => item.id)));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection status */}
      <div className="rounded-xl border-2 border-blue-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-100">
              <Zap className="h-7 w-7 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">飞书</h3>
              <p className="text-sm text-gray-500">
                通过飞书同步 Wiki 知识库和云文档内容
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status?.isConnected ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-blue-600" />
                <span className="text-sm font-medium text-blue-600">
                  已连接
                </span>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 text-gray-400" />
                <span className="text-sm text-gray-500">未配置</span>
              </>
            )}
          </div>
        </div>

        {status?.isConnected && status.appId && (
          <div className="mt-4 text-sm text-gray-500">
            App ID: {status.appId}
          </div>
        )}

        {/* Stats */}
        {status?.stats && status.stats.totalItems > 0 && (
          <div className="mt-4 grid grid-cols-4 gap-4 border-t border-gray-100 pt-4">
            <div className="text-center">
              <div className="text-2xl font-semibold text-gray-900">
                {status.stats.totalItems}
              </div>
              <div className="text-xs text-gray-500">总计</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-blue-600">
                {status.stats.wikiNodeCount + status.stats.docCount}
              </div>
              <div className="text-xs text-gray-500">文档</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-green-600">
                {status.stats.sheetCount + status.stats.bitableCount}
              </div>
              <div className="text-xs text-gray-500">表格</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-purple-600">
                {status.stats.syncedToRagCount}
              </div>
              <div className="text-xs text-gray-500">已入库</div>
            </div>
          </div>
        )}
      </div>

      {/* Usage guide */}
      <Alert tone="info" title="如何使用">
        <ol className="mt-1 list-inside list-decimal space-y-1">
          <li>在飞书中向机器人发送文档链接或 Wiki 地址</li>
          <li>系统会自动同步内容到此处</li>
          <li>可以选择内容同步到 RAG 知识库进行 AI 检索</li>
          <li>也可以手动添加任意 URL 到数据源</li>
        </ol>
      </Alert>

      {/* Synced content list */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h4 className="text-sm font-medium text-gray-700">
              已同步的内容 ({items.length})
            </h4>
            {selectedItems.size > 0 && (
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100"
              >
                <Trash2 className="h-4 w-4" />
                删除 ({selectedItems.size})
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 数据源统一整理：飞书内容对话整理 */}
            <button
              onClick={() => setOrganizeChatOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50"
            >
              <MessageSquare className="h-4 w-4" />
              对话整理
            </button>
            <button
              onClick={() => setShowAddUrl(!showAddUrl)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" />
              手动添加
            </button>
            <button
              onClick={() => {
                fetchItems();
                fetchStatus();
              }}
              disabled={loadingItems}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingItems ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              刷新
            </button>
          </div>
        </div>

        {/* Add URL form */}
        {showAddUrl && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex gap-2">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="粘贴飞书文档链接或任意 URL..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleAddUrl}
                disabled={addingUrl || !newUrl.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {addingUrl ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  '添加'
                )}
              </button>
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        )}

        {items.length === 0 ? (
          <EmptyState
            icon={<Zap className="h-12 w-12" />}
            title="暂无同步的内容"
            description="在飞书中向机器人发送链接即可同步"
          />
        ) : (
          <div className="space-y-2">
            {/* Select all */}
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <input
                type="checkbox"
                checked={
                  selectedItems.size === items.length && items.length > 0
                }
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span>全选</span>
            </div>

            {items.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 rounded-lg border bg-white p-4 transition-colors hover:bg-gray-50 ${
                  selectedItems.has(item.id)
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-gray-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedItems.has(item.id)}
                  onChange={() => toggleSelectItem(item.id)}
                  className="h-4 w-4 rounded border-gray-300"
                />

                {getItemIcon(item.type)}

                <div className="min-w-0 flex-1">
                  <h5 className="truncate font-medium text-gray-900">
                    {item.title}
                  </h5>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">
                      {getItemTypeLabel(item.type)}
                    </span>
                    {item.author && <span>作者: {item.author}</span>}
                    <span>{formatDateSafe(item.syncedAt, 'date')}</span>
                    {item.syncedToRag && (
                      <span className="flex items-center gap-1 text-blue-600">
                        <Database className="h-3 w-3" />
                        已入库
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopyUrl(item.sourceUrl)}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="复制链接"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="打开原文"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-100 hover:text-red-600"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 数据源统一整理：飞书内容对话整理浮层 */}
      <OrganizeChatMode
        open={organizeChatOpen}
        onClose={() => setOrganizeChatOpen(false)}
        itemType="FEISHU"
      />
    </div>
  );
}
