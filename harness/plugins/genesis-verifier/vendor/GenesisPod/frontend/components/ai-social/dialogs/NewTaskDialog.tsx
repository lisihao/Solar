'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Loader2,
  Rocket,
  Link,
  MessageSquare,
  ChevronRight,
} from 'lucide-react';
import * as Icons from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSocialDataSources } from '@/hooks/domain/useSocialDataSources';
import { createTaskAndRefresh } from '@/hooks/domain/useSocialTasks';
import { getConnections } from '@/services/ai-social/api';
import type { SocialPlatformConnection } from '@/services/ai-social/api';
import type {
  PickedSourceItem,
  SocialDataSourceDescriptor,
} from '@/services/ai-social/task-types';
import { SourceItemPicker } from '../pickers/SourceItemPicker';
import { Modal } from '@/components/ui/dialogs/Modal';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { ErrorState, ErrorInline } from '@/components/ui/states/ErrorState';

const MAX_TOTAL_ITEMS = 20;
const MAX_EXTERNAL_URLS = 3;
const MAX_PROMPT_CHARS = 500;

export interface NewTaskDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}

type Platform = 'WECHAT_MP' | 'XIAOHONGSHU';

export function NewTaskDialog({
  open,
  onClose,
  onCreated,
}: NewTaskDialogProps) {
  const { t } = useTranslation();
  const {
    sources,
    isLoading: sourcesLoading,
    error: sourcesError,
    refresh: refreshSources,
  } = useSocialDataSources();

  const [pickedItems, setPickedItems] = useState<PickedSourceItem[]>([]);
  const [externalUrls, setExternalUrls] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [accountIds, setAccountIds] = useState<Record<string, string>>({});
  const [activePickerSourceId, setActivePickerSourceId] = useState<
    string | null
  >(null);
  const [connections, setConnections] = useState<SocialPlatformConnection[]>(
    []
  );
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch connections when dialog opens
  useEffect(() => {
    if (!open) return;
    setConnectionsLoading(true);
    getConnections()
      .then((list) => setConnections(list.filter((c) => c.isActive)))
      .catch(() => setConnections([]))
      .finally(() => setConnectionsLoading(false));
  }, [open]);

  // Merge picked items from a source into pickedItems
  const handlePickerConfirm = (
    source: SocialDataSourceDescriptor,
    picked: PickedSourceItem[]
  ) => {
    setPickedItems((prev) => {
      const withoutSource = prev.filter((p) => p.sourceType !== source.id);
      return [...withoutSource, ...picked];
    });
    setActivePickerSourceId(null);
  };

  const removePickedItem = (itemId: string) => {
    setPickedItems((prev) => prev.filter((p) => p.id !== itemId));
  };

  const addExternalUrl = () => {
    const url = urlDraft.trim();
    if (!url) return;
    try {
      new URL(url);
    } catch {
      setUrlError('请输入有效的 URL');
      return;
    }
    if (externalUrls.includes(url)) {
      setUrlError('URL 已添加');
      return;
    }
    if (externalUrls.length >= MAX_EXTERNAL_URLS) {
      setUrlError(`最多添加 ${MAX_EXTERNAL_URLS} 个 URL`);
      return;
    }
    setExternalUrls((prev) => [...prev, url]);
    setUrlDraft('');
    setUrlError(null);
  };

  const removeUrl = (url: string) => {
    setExternalUrls((prev) => prev.filter((u) => u !== url));
  };

  const togglePlatform = (platform: Platform) => {
    setPlatforms((prev) => {
      if (prev.includes(platform)) {
        const next = prev.filter((p) => p !== platform);
        // Also clear accountId for that platform
        setAccountIds((ids) => {
          const copy = { ...ids };
          delete copy[platform];
          return copy;
        });
        return next;
      } else {
        // Auto-assign first matching active connection
        const conn = connections.find((c) => c.platformType === platform);
        if (conn) {
          setAccountIds((ids) => ({ ...ids, [platform]: conn.id }));
        }
        return [...prev, platform];
      }
    });
  };

  const totalSources = pickedItems.length + externalUrls.length;
  const canSubmit =
    !submitLoading &&
    totalSources > 0 &&
    platforms.length > 0 &&
    totalSources <= MAX_TOTAL_ITEMS;

  /**
   * 自动派生任务标题（用户不填，由所选内容生成）：
   *   1 项 → 直接用源条目标题
   *   N 项 → "{首项} 等 N 项"
   *   仅外链 → URL host 或 URL 截断
   *   完全为空 → 时间戳 fallback（极少触发，canSubmit 已挡）
   */
  const deriveAutoTitle = (): string => {
    if (pickedItems.length === 1) {
      return pickedItems[0].title.slice(0, 200);
    }
    if (pickedItems.length > 1) {
      return `${pickedItems[0].title.slice(0, 60)} 等 ${pickedItems.length} 项`.slice(
        0,
        200
      );
    }
    if (externalUrls.length === 1) {
      try {
        return new URL(externalUrls[0]).hostname.slice(0, 200);
      } catch {
        return externalUrls[0].slice(0, 200);
      }
    }
    if (externalUrls.length > 1) {
      return `${externalUrls.length} 个外部链接`;
    }
    return '未命名任务';
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const result = await createTaskAndRefresh({
        sources: pickedItems.map((p) => ({
          sourceType: p.sourceType,
          sourceId: p.id,
        })),
        externalUrls: externalUrls.length > 0 ? externalUrls : undefined,
        title: deriveAutoTitle(),
        prompt: prompt.trim() || undefined,
        platforms,
        accountIds,
      });
      onCreated(result.id);
      onClose();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : t('common.error') || '创建失败，请重试'
      );
    } finally {
      setSubmitLoading(false);
    }
  };

  const activePickerSource = activePickerSourceId
    ? (sources.find((s) => s.id === activePickerSourceId) ?? null)
    : null;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100">
              <Rocket className="h-5 w-5 text-rose-600" />
            </span>
            {t('aiSocial.newTask.title') || '新建社媒发布任务'}
          </span>
        }
        size="md"
        contentClassName="px-6 py-4 space-y-6"
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
            >
              {t('aiSocial.newTask.cancel') || t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  启动中…
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" />
                  {t('aiSocial.newTask.launch') || '启动 AI Teams'}
                </>
              )}
            </button>
          </>
        }
      >
        {/* Data Sources Section */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700">
              {t('aiSocial.newTask.dataSources') ||
                '数据源（点开各模块挑具体内容）'}
            </h3>
            <span className="text-xs text-gray-400">
              {`${pickedItems.length} / ${MAX_TOTAL_ITEMS}`}
            </span>
          </div>

          {sourcesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : sourcesError ? (
            <ErrorState
              error={
                sourcesError instanceof Error
                  ? sourcesError
                  : String(sourcesError)
              }
              title="数据源加载失败"
              onRetry={() => refreshSources()}
            />
          ) : sources.length === 0 ? (
            <EmptyState
              title="暂无可用数据源"
              description="后端 SocialDataSourceRegistry 未发现任何已注册 provider。请稍候 1-2 分钟刷新重试，或检查浏览器 Console 中的 [useSocialDataSources] 日志。"
              size="sm"
              action={
                <button
                  type="button"
                  onClick={() => refreshSources()}
                  className="rounded-md bg-amber-600 px-2 py-1 text-xs text-white hover:bg-amber-700"
                >
                  立即重试
                </button>
              }
            />
          ) : (
            <ul className="space-y-2 rounded-xl border border-gray-200 p-1">
              {sources.map((source) => {
                const count = pickedItems.filter(
                  (p) => p.sourceType === source.id
                ).length;
                const SourceIcon =
                  (
                    Icons as unknown as Record<
                      string,
                      React.ComponentType<{ className?: string }>
                    >
                  )[source.icon] ?? Icons.Box;
                const displayName =
                  source.displayName['zh-CN'] || source.displayName['en-US'];
                return (
                  <li key={source.id}>
                    <button
                      type="button"
                      onClick={() => setActivePickerSourceId(source.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gray-100">
                        <SourceIcon className="h-4 w-4 text-gray-600" />
                      </div>
                      <span className="flex-1 text-sm font-medium text-gray-800">
                        {displayName}
                      </span>
                      <span
                        className={`text-xs ${count > 0 ? 'font-medium text-rose-600' : 'text-gray-400'}`}
                      >
                        {count > 0 ? `已选 ${count} 篇` : '未选'}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-300" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Picked preview */}
        {pickedItems.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium text-gray-700">
              {`已选内容预览（${pickedItems.length} 项 / 上限 ${MAX_TOTAL_ITEMS}）`}
            </h3>
            <ul className="space-y-1.5 rounded-xl border border-gray-100 bg-gray-50 p-3">
              {pickedItems.map((item) => {
                const sourceDesc = sources.find(
                  (s) => s.id === item.sourceType
                );
                const sourceName =
                  sourceDesc?.displayName['zh-CN'] ?? item.sourceType;
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
                  >
                    <span className="flex-shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-600">
                      {sourceName}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-gray-700">
                      {item.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePickedItem(item.id)}
                      className="ml-1 flex-shrink-0 rounded p-0.5 text-gray-300 hover:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
                      aria-label={`移除 ${item.title}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* External URLs */}
        <section>
          <button
            type="button"
            onClick={() => setShowUrlInput((v) => !v)}
            className="flex items-center gap-1.5 rounded text-sm text-rose-600 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <Plus className="h-4 w-4" />
            <Link className="h-3.5 w-3.5" />
            {t('aiSocial.newTask.addExternalUrl') || '+ 外部 URL'}
          </button>
          {showUrlInput && (
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://example.com/article"
                  value={urlDraft}
                  onChange={(e) => {
                    setUrlDraft(e.target.value);
                    setUrlError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addExternalUrl();
                    }
                  }}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
                <button
                  type="button"
                  onClick={addExternalUrl}
                  disabled={externalUrls.length >= MAX_EXTERNAL_URLS}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50"
                >
                  添加
                </button>
              </div>
              {urlError && <ErrorInline message={urlError} />}
              {externalUrls.length > 0 && (
                <ul className="space-y-1">
                  {externalUrls.map((url) => (
                    <li
                      key={url}
                      className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-600"
                    >
                      <Link className="h-3 w-3 flex-shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 truncate">{url}</span>
                      <button
                        type="button"
                        onClick={() => removeUrl(url)}
                        className="flex-shrink-0 rounded text-gray-300 hover:text-red-400 focus-visible:outline-none"
                        aria-label={`移除 ${url}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Prompt */}
        <section>
          <button
            type="button"
            onClick={() => setShowPromptInput((v) => !v)}
            className="flex items-center gap-1.5 rounded text-sm text-rose-600 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <Plus className="h-4 w-4" />
            <MessageSquare className="h-3.5 w-3.5" />
            {t('aiSocial.newTask.addPrompt') || '+ 补充提示词'}
          </button>
          {showPromptInput && (
            <div className="mt-2">
              <textarea
                rows={3}
                maxLength={MAX_PROMPT_CHARS}
                placeholder="补充说明，例如：请聚焦技术层面，语气轻松…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
              <p className="mt-1 text-right text-xs text-gray-400">
                {`${prompt.length} / ${MAX_PROMPT_CHARS}`}
              </p>
            </div>
          )}
        </section>

        {/* Platforms */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-700">
            {t('aiSocial.newTask.platforms') || '发布平台（多选）'}
          </h3>
          {connectionsLoading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
            </div>
          ) : (
            <div className="space-y-2">
              {(['WECHAT_MP', 'XIAOHONGSHU'] as Platform[]).map((platform) => {
                const conn = connections.find(
                  (c) => c.platformType === platform
                );
                const isChecked = platforms.includes(platform);
                const label =
                  platform === 'WECHAT_MP' ? 'WeChat 公众号' : '小红书';
                return (
                  <label
                    key={platform}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
                      isChecked
                        ? 'border-rose-400 bg-rose-50'
                        : 'border-gray-200 hover:border-rose-200 hover:bg-rose-50/50'
                    } ${!conn ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!conn}
                      onChange={() => togglePlatform(platform)}
                      className="h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">
                        {label}
                      </p>
                      {conn ? (
                        <p className="text-xs text-gray-400">
                          {`绑定: ${conn.accountName ?? conn.id}`}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400">未绑定账号</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {/* Validation errors */}
        {submitError && <ErrorInline message={submitError} />}
      </Modal>

      {/* Sub-picker dialog */}
      {activePickerSource && (
        <SourceItemPicker
          source={activePickerSource}
          alreadyPicked={pickedItems.filter(
            (p) => p.sourceType === activePickerSource.id
          )}
          onConfirm={(picked) =>
            handlePickerConfirm(activePickerSource, picked)
          }
          onCancel={() => setActivePickerSourceId(null)}
          maxRemainingGlobal={MAX_TOTAL_ITEMS - pickedItems.length}
        />
      )}
    </>
  );
}
