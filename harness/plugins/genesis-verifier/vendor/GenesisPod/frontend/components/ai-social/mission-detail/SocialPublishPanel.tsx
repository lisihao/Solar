'use client';

/**
 * SocialPublishPanel — 发布 tab（PR-V7 唯一全新组件）
 *
 * 展示每个平台的发布状态，提供"发布到草稿箱"按钮。
 * 后端 POST /tasks/:id/publish?platform=X 复用 PublishExecutorService 发到草稿箱；
 * 读取返回的 PublishResult.success 反映真实结果（HTTP 200 不代表发布成功）。
 */

import { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import { getAuthTokens } from '@/lib/utils/auth';
import { Alert } from '@/components/ui/feedback/Alert';
import type {
  SocialContentTask,
  SocialContentTaskVersion,
} from '@/services/ai-social/task-types';

interface SocialPublishPanelProps {
  task: SocialContentTask;
  onAction: () => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  WECHAT_MP: '微信公众号',
  XIAOHONGSHU: '小红书',
};

function getVersionForPlatform(
  task: SocialContentTask,
  platform: string
): SocialContentTaskVersion | undefined {
  return task.versions?.find((v) => v.platform === platform);
}

async function callPublishStub(
  taskId: string,
  platform: string
): Promise<{ ok: boolean; message: string }> {
  const tokens = getAuthTokens();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (tokens?.accessToken) {
    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  }

  const res = await fetch(
    `/api/v1/ai-social/tasks/${taskId}/publish?platform=${platform}`,
    { method: 'POST', headers }
  );

  if (res.status === 404) {
    return { ok: false, message: '发布接口未就绪' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    return { ok: false, message: text || `HTTP ${res.status}` };
  }
  // 后端返回 PublishResult（经 ResponseTransformInterceptor 包成 {data}）；
  // HTTP 200 不代表发布成功，要看 data.success
  const body = (await res.json().catch(() => null)) as {
    data?: { success?: boolean; errorMessage?: string; externalUrl?: string };
    success?: boolean;
    errorMessage?: string;
  } | null;
  const result = body?.data ?? body;
  if (result && typeof result.success === 'boolean') {
    return result.success
      ? { ok: true, message: '已发布到草稿箱，请到公众号后台确认' }
      : { ok: false, message: result.errorMessage || '发布失败' };
  }
  return { ok: true, message: '已提交发布请求' };
}

interface PlatformState {
  loading: boolean;
  toast: string | null;
}

export function SocialPublishPanel({
  task,
  onAction,
}: SocialPublishPanelProps) {
  const [platformStates, setPlatformStates] = useState<
    Record<string, PlatformState>
  >({});

  const isActionable =
    task.status === 'DRAFT_READY' || task.status === 'PARTIAL_PUBLISHED';

  if (!isActionable) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-16 text-center">
        <Send className="h-10 w-10 text-gray-300" />
        <div>
          <p className="text-base font-medium text-gray-700">暂无可发布内容</p>
          <p className="mt-1 text-sm text-gray-400">
            任务尚未完成生成，发布按钮在 DRAFT_READY 后可用
          </p>
          <p className="mt-1 text-xs text-gray-400">当前状态：{task.status}</p>
        </div>
      </div>
    );
  }

  const handlePublish = async (platform: string) => {
    setPlatformStates((prev) => ({
      ...prev,
      [platform]: { loading: true, toast: null },
    }));
    try {
      const result = await callPublishStub(task.id, platform);
      setPlatformStates((prev) => ({
        ...prev,
        [platform]: { loading: false, toast: result.message },
      }));
      onAction();
      setTimeout(() => {
        setPlatformStates((prev) => ({
          ...prev,
          [platform]: { ...prev[platform], toast: null },
        }));
      }, 4000);
    } catch (err) {
      setPlatformStates((prev) => ({
        ...prev,
        [platform]: {
          loading: false,
          toast: (err as Error).message ?? '发布失败',
        },
      }));
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-gray-800">发布到草稿箱</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          选择平台将内容推送到对应账号草稿箱，确认后自行发布
        </p>
      </div>

      {task.platforms.map((platform) => {
        const version = getVersionForPlatform(task, platform);
        const state = platformStates[platform] ?? {
          loading: false,
          toast: null,
        };
        const versionStatus = version?.status;
        const isPublished = versionStatus === 'PUBLISHED';
        const isFailed = versionStatus === 'FAILED';

        return (
          <div
            key={platform}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">
                    {PLATFORM_LABELS[platform] ?? platform}
                  </span>
                  {isPublished && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" />
                      已发布
                    </span>
                  )}
                  {isFailed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      <XCircle className="h-3 w-3" />
                      发布失败
                    </span>
                  )}
                  {!isPublished && !isFailed && versionStatus && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      未发布
                    </span>
                  )}
                </div>
                {version?.title && (
                  <p
                    className="mt-1 truncate text-xs text-gray-500"
                    title={version.title}
                  >
                    {version.title}
                  </p>
                )}
                {version?.errorMessage && isFailed && (
                  <p className="mt-1 text-xs text-red-500">
                    {version.errorMessage}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isPublished && version?.externalUrl && (
                  <a
                    href={version.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    查看
                  </a>
                )}
                {isFailed && (
                  <button
                    type="button"
                    disabled={state.loading}
                    onClick={() => void handlePublish(platform)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${state.loading ? 'animate-spin' : ''}`}
                    />
                    仅重试此平台
                  </button>
                )}
                {!isPublished && (
                  <button
                    type="button"
                    disabled={state.loading}
                    onClick={() => void handlePublish(platform)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-rose-500 to-pink-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:shadow-md disabled:opacity-50"
                  >
                    <Send
                      className={`h-3.5 w-3.5 ${state.loading ? 'animate-pulse' : ''}`}
                    />
                    {state.loading ? '发布中...' : '发布到草稿箱'}
                  </button>
                )}
              </div>
            </div>

            {state.toast && (
              <div className="mt-3">
                <Alert tone="info">{state.toast}</Alert>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
