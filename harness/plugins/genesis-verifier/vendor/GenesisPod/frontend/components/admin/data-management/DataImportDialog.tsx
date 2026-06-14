'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle, AlertCircle, Copy, X } from 'lucide-react';
import { config } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';
interface DataImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType:
    | 'PAPER'
    | 'BLOG'
    | 'PROJECT'
    | 'NEWS'
    | 'YOUTUBE_VIDEO'
    | 'RSS'
    | 'REPORT'
    | 'EVENT';
}

interface SourceWhitelist {
  resourceType: string;
  allowedDomains: string[];
  description: string;
  totalValidated: number;
  totalRejected: number;
}

interface URLParseResult {
  title: string;
  domain: string;
  description?: string;
}

const RESOURCE_TYPE_DISPLAY = {
  PAPER: '学术论文',
  BLOG: '研究博客',
  PROJECT: '开源项目',
  NEWS: '科技新闻',
  YOUTUBE_VIDEO: 'YouTube视频',
  RSS: 'RSS订阅',
  REPORT: '行业报告',
  EVENT: '技术活动',
  POLICY: '政策文件',
};

export function DataImportDialog({
  open,
  onOpenChange,
  resourceType,
}: DataImportDialogProps) {
  const [stage, setStage] = useState<
    'select-type' | 'validate-url' | 'confirm-import'
  >('select-type');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [whitelist, setWhitelist] = useState<SourceWhitelist | null>(null);
  const [validationResult, setValidationResult] = useState<{
    isValid: boolean;
    matchedDomain?: string;
    reason?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<URLParseResult | null>(null);
  const [copied, setCopied] = useState(false);

  // 获取白名单信息
  useEffect(() => {
    if (open && stage === 'select-type') {
      fetchWhitelist();
    }
  }, [open, stage]);

  const fetchWhitelist = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${config.apiUrl}/data-management/whitelists/${resourceType}`
      );
      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      if (data && typeof data === 'object' && 'resourceType' in data) {
        setWhitelist(data as SourceWhitelist);
      } else if (data.success && data.data) {
        // Legacy format support
        setWhitelist(data.data);
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

  const handleValidateUrl = async () => {
    if (!url.trim()) {
      setError('请输入有效的URL');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 1. 验证URL合法性
      const validationResponse = await fetch(
        `${config.apiUrl}/data-management/whitelists/${resourceType}/validate?url=${encodeURIComponent(url)}`
      );
      const validationData = await validationResponse.json();
      setValidationResult(validationData.data);

      if (!validationData.data.isValid) {
        const reason = validationData.data.reason || '该URL来源不在允许列表中';
        const friendlyError = `验证失败: ${reason}\n\n请检查:\n• URL是否正确\n• 网络连接是否正常\n• 该网站是否在${RESOURCE_TYPE_DISPLAY[resourceType]}支持列表中`;
        setError(friendlyError);
        return;
      }

      // 2. 解析URL获取标题
      const parseResponse = await fetch(
        `${config.apiUrl}/data-management/parse-url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, resourceType }),
        }
      );

      if (parseResponse.ok) {
        const parseData = await parseResponse.json();
        if (parseData.success) {
          setParseResult(parseData.data);
          setTitle(parseData.data.title);
        }
      }

      setStage('confirm-import');
    } catch (err) {
      setError(
        '无法读取该URL的内容。请检查:\n• URL是否正确\n• 网络连接是否正常\n• 该网站是否支持'
      );
      logger.error(
        '验证URL失败',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!title.trim()) {
      setError('请输入标题');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${config.apiUrl}/data-management/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          title,
          resourceType,
          domain: validationResult?.matchedDomain,
        }),
      });

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;

      if (data.success !== false && response.ok) {
        // 导入成功
        onOpenChange(false);
        resetDialog();
        // 可以在这里触发刷新列表的回调
      } else {
        setError(data.error || data.message || '导入失败');
      }
    } catch (err) {
      setError('导入失败，请重试');
      logger.error(
        '导入失败',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setLoading(false);
    }
  };

  const resetDialog = () => {
    setStage('select-type');
    setUrl('');
    setTitle('');
    setValidationResult(null);
    setParseResult(null);
    setError(null);
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="relative max-h-screen w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-gray-500 hover:text-gray-700"
        >
          <X className="h-6 w-6" />
        </button>

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-bold">
            导入{RESOURCE_TYPE_DISPLAY[resourceType]}
          </h2>
          <p className="text-sm text-gray-600">
            三步流程：选择来源 → 验证URL → 确认导入
          </p>
        </div>

        {/* 阶段1: 选择来源 */}
        {stage === 'select-type' && (
          <div className="space-y-4">
            {/* 允许的来源列表 */}
            {whitelist && (
              <div className="rounded-lg border border-gray-200 p-4">
                <h3 className="mb-2 font-semibold">允许的数据源</h3>
                <p className="mb-3 text-sm text-gray-600">
                  {whitelist.description}
                </p>
                <div className="mb-3 flex flex-wrap gap-2">
                  {whitelist.allowedDomains.map((domain, idx) => (
                    <div key={idx} className="group relative">
                      <button
                        onClick={() => copyToClipboard(domain)}
                        className="rounded bg-gray-100 px-3 py-1 text-sm hover:bg-gray-200"
                      >
                        {domain}
                      </button>
                      {copied && (
                        <div className="absolute -top-8 left-0 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white">
                          已复制
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  点击域名可复制 | 已验证: {whitelist.totalValidated} | 已拒绝:{' '}
                  {whitelist.totalRejected}
                </p>
              </div>
            )}

            {/* URL输入框 */}
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="mb-3 font-semibold">输入URL</h3>
              <div className="space-y-2">
                <label className="text-sm font-medium">数据源URL</label>
                <input
                  type="text"
                  placeholder="输入要导入的URL (例如: https://arxiv.org/abs/2024.xxxxx)"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleValidateUrl()}
                  disabled={loading}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                />
                <p className="text-xs text-gray-500">
                  系统将自动验证URL是否来自允许的数据源
                </p>
              </div>

              {error && (
                <div className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">
                  <div className="flex gap-2">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <div className="whitespace-pre-wrap">{error}</div>
                  </div>
                </div>
              )}

              <button
                onClick={handleValidateUrl}
                disabled={!url.trim() || loading}
                className="mt-3 w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {loading && (
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                )}
                验证 & 下一步
              </button>
            </div>
          </div>
        )}

        {/* 阶段2: 验证URL & 编辑标题 */}
        {stage === 'confirm-import' && validationResult?.isValid && (
          <div className="space-y-4">
            {/* 验证结果 */}
            <div className="rounded-lg border-2 border-green-200 bg-green-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <h3 className="font-semibold text-green-900">URL验证成功</h3>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-600">来源域名: </span>
                  <span className="font-mono rounded bg-white px-2 py-1 text-sm">
                    {validationResult.matchedDomain}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">完整URL: </span>
                  <div className="font-mono mt-1 break-all rounded bg-gray-100 p-2 text-xs">
                    {url}
                  </div>
                </div>
              </div>
            </div>

            {/* 标题编辑 */}
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="mb-1 font-semibold">确认标题</h3>
              <p className="mb-3 text-sm text-gray-600">
                系统已自动解析标题，你可以修改它
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">标题 (可编辑)</label>
                <input
                  type="text"
                  placeholder="输入或编辑标题"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={loading}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                />
                {parseResult?.description && (
                  <div className="rounded bg-gray-50 p-2 text-xs text-gray-600">
                    <span className="font-medium">摘要: </span>
                    {parseResult.description}
                  </div>
                )}
              </div>

              {error && (
                <div className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">
                  <div className="flex gap-2">
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <div className="whitespace-pre-wrap">{error}</div>
                  </div>
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    setStage('select-type');
                    setValidationResult(null);
                    setParseResult(null);
                  }}
                  disabled={loading}
                  className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-50 disabled:bg-gray-100"
                >
                  返回
                </button>
                <button
                  onClick={handleImport}
                  disabled={!title.trim() || loading}
                  className="flex-1 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-300"
                >
                  {loading && (
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  )}
                  确认导入
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 验证失败 */}
        {stage === 'confirm-import' && !validationResult?.isValid && (
          <div className="space-y-4">
            <div className="rounded bg-red-50 p-4 text-sm text-red-700">
              <div className="mb-2 flex gap-2">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <div className="font-medium">URL验证失败</div>
              </div>
              <div className="text-sm">{validationResult?.reason}</div>
            </div>
            <button
              onClick={() => {
                setStage('select-type');
                setValidationResult(null);
              }}
              className="w-full rounded border border-gray-300 px-4 py-2 hover:bg-gray-50"
            >
              返回重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
