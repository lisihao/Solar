'use client';

import React, { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { Loader2, AlertCircle } from 'lucide-react';

import { logger } from '@/lib/utils/logger';
import { ClientDate } from '@/components/common/ClientDate';
interface CollectionRule {
  id: string;
  resourceType: string;
  cronExpression: string;
  maxConcurrent: number;
  timeout: number;
  isActive: boolean;
  lastExecutedAt?: string;
  nextScheduledAt?: string;
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

export function CollectionRuleManager() {
  const [rules, setRules] = useState<CollectionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${config.apiUrl}/data-management/rules`, {
        headers: getAuthHeader(),
      });
      const result = await response.json();
      // Handle wrapped response { success: true, data: [...] }
      const data = result?.data ?? result;
      if (Array.isArray(data)) {
        setRules(data);
      } else if (data.success && data.data) {
        // Legacy format support
        setRules(data.data);
      }
    } catch (err) {
      setError('获取采集规则失败');
      logger.error(
        '获取采集规则失败',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (
    resourceType: string,
    isActive: boolean
  ) => {
    try {
      const endpoint = isActive ? 'disable' : 'enable';
      const response = await fetch(
        `${config.apiUrl}/data-management/rules/${resourceType}/${endpoint}`,
        { method: 'POST', headers: getAuthHeader() }
      );
      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      if (response.ok) {
        await fetchRules();
      }
    } catch (err) {
      setError('更新规则失败');
      logger.error(
        '更新规则失败',
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
        {rules.map((rule) => (
          <div key={rule.id} className="rounded-lg border border-gray-200">
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">
                    {RESOURCE_TYPE_NAMES[rule.resourceType] ||
                      rule.resourceType}
                  </h3>
                  <p className="mt-1 text-xs text-gray-600">
                    Cron: {rule.cronExpression}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block rounded px-2 py-1 text-xs font-medium ${
                      rule.isActive
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {rule.isActive ? '启用' : '禁用'}
                  </span>
                  <button
                    onClick={() =>
                      handleToggleActive(rule.resourceType, rule.isActive)
                    }
                    className="rounded px-3 py-1 text-sm hover:bg-gray-100"
                  >
                    {rule.isActive ? '禁用' : '启用'}
                  </button>
                </div>
              </div>
            </div>

            <div className="px-6 py-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="rounded bg-blue-50 p-2">
                  <div className="text-gray-600">最大并发数</div>
                  <div className="text-lg font-bold">{rule.maxConcurrent}</div>
                </div>
                <div className="rounded bg-green-50 p-2">
                  <div className="text-gray-600">超时时间(秒)</div>
                  <div className="text-lg font-bold">{rule.timeout}</div>
                </div>
                <div className="rounded bg-purple-50 p-2">
                  <div className="text-gray-600">下次执行</div>
                  <div className="font-mono text-xs">
                    {rule.nextScheduledAt ? (
                      <ClientDate
                        date={rule.nextScheduledAt}
                        format="datetime"
                      />
                    ) : (
                      '待定'
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
