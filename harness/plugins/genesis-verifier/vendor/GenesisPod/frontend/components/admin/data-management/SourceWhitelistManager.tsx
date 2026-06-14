'use client';

import React, { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { Loader2, AlertCircle, Plus, Trash2 } from 'lucide-react';

import { logger } from '@/lib/utils/logger';
interface SourceWhitelist {
  id: string;
  resourceType: string;
  allowedDomains: string[];
  description?: string;
  isActive: boolean;
  totalValidated: number;
  totalRejected: number;
}

const RESOURCE_TYPE_NAMES: Record<string, string> = {
  PAPER: '学术论文',
  PROJECT: '开源项目',
  NEWS: '科技新闻',
  YOUTUBE_VIDEO: 'YouTube视频',
  RSS: 'RSS订阅',
  REPORT: '行业报告',
  EVENT: '技术活动',
};

export function SourceWhitelistManager() {
  const [whitelists, setWhitelists] = useState<SourceWhitelist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState('');

  useEffect(() => {
    fetchWhitelists();
  }, []);

  const fetchWhitelists = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${config.apiUrl}/data-management/whitelists`
      );
      const result = await response.json();
      // Handle wrapped response { success: true, data: [...] }
      const data = result?.data ?? result;
      if (Array.isArray(data)) {
        setWhitelists(data);
      } else if (data.success && data.data) {
        // Legacy format support
        setWhitelists(data.data);
      }
    } catch (err) {
      setError('获取白名单失败');
      logger.error(
        '获取白名单失败',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAddDomain = async (resourceType: string) => {
    if (!newDomain.trim()) return;

    try {
      const response = await fetch(
        `${config.apiUrl}/data-management/whitelists/${resourceType}/domains`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: newDomain }),
        }
      );
      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      if (response.ok) {
        setNewDomain('');
        setEditingId(null);
        await fetchWhitelists();
      }
    } catch (err) {
      setError('添加域名失败');
      logger.error(
        '添加域名失败',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  const handleRemoveDomain = async (resourceType: string, domain: string) => {
    try {
      const response = await fetch(
        `${config.apiUrl}/data-management/whitelists/${resourceType}/domains/${encodeURIComponent(domain)}`,
        { method: 'DELETE' }
      );
      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      if (response.ok) {
        await fetchWhitelists();
      }
    } catch (err) {
      setError('移除域名失败');
      logger.error(
        '移除域名失败',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  const handleToggleActive = async (
    resourceType: string,
    isActive: boolean
  ) => {
    try {
      const response = await fetch(
        `${config.apiUrl}/data-management/whitelists/${resourceType}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !isActive }),
        }
      );
      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      if (response.ok) {
        await fetchWhitelists();
      }
    } catch (err) {
      setError('更新白名单状态失败');
      logger.error(
        '更新白名单状态失败',
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded bg-red-50 p-4">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-700" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {whitelists.map((whitelist) => (
          <div key={whitelist.id} className="rounded-lg border border-gray-200">
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">
                    {RESOURCE_TYPE_NAMES[whitelist.resourceType] ||
                      whitelist.resourceType}
                  </h3>
                  {whitelist.description && (
                    <p className="mt-1 text-xs text-gray-600">
                      {whitelist.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block rounded px-2 py-1 text-xs font-medium ${
                      whitelist.isActive
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {whitelist.isActive ? '启用' : '禁用'}
                  </span>
                  <button
                    onClick={() =>
                      handleToggleActive(
                        whitelist.resourceType,
                        whitelist.isActive
                      )
                    }
                    className="rounded px-3 py-1 text-sm hover:bg-gray-100"
                  >
                    {whitelist.isActive ? '禁用' : '启用'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-4 px-6 py-4">
              {/* 统计信息 */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="rounded bg-blue-50 p-2">
                  <div className="text-gray-600">已验证</div>
                  <div className="text-lg font-bold">
                    {whitelist.totalValidated}
                  </div>
                </div>
                <div className="rounded bg-red-50 p-2">
                  <div className="text-gray-600">已拒绝</div>
                  <div className="text-lg font-bold">
                    {whitelist.totalRejected}
                  </div>
                </div>
              </div>

              {/* 允许的域名列表 */}
              <div>
                <h4 className="mb-2 text-sm font-medium">允许的域名</h4>
                <div className="flex flex-wrap gap-2">
                  {whitelist.allowedDomains.map((domain) => (
                    <div
                      key={domain}
                      className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1"
                    >
                      <span className="text-sm">{domain}</span>
                      <button
                        onClick={() =>
                          handleRemoveDomain(whitelist.resourceType, domain)
                        }
                        className="ml-1 text-xs hover:text-red-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 添加新域名 */}
              {editingId === whitelist.id ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="输入新域名 (例如: example.com)"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleAddDomain(whitelist.resourceType);
                      }
                    }}
                    className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => handleAddDomain(whitelist.resourceType)}
                    className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                  >
                    添加
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setNewDomain('');
                    }}
                    className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingId(whitelist.id)}
                  className="flex items-center gap-1 rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <Plus className="h-3 w-3" />
                  添加域名
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
