'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Settings,
  Trash2,
} from 'lucide-react';
import { LoadingState } from '@/components/ui/states';
import {
  deleteTopic,
  getTopic,
  listRuns,
  listSources,
  triggerRefresh,
  updateTopic,
} from '@/services/ai-radar/api';
import type {
  RadarSource,
  RadarTopicWithCounts,
} from '@/services/ai-radar/types';
import { RadarBriefingPanel } from '@/components/ai-radar/RadarBriefingPanel';
import { RadarHistoricalItemsPanel } from '@/components/ai-radar/RadarHistoricalItemsPanel';
import { RadarTopicConfigDrawer } from '@/components/ai-radar/RadarTopicConfigDrawer';
import type { RadarTopicConfigDrawerTopic } from '@/components/ai-radar/RadarTopicConfigDrawer';
import { ConfirmDialog } from '@/components/ui/dialogs/ConfirmDialog';
import { RadarBucketSwitcher } from '@/components/ai-radar/RadarBucketSwitcher';
import {
  useDailyBriefingRange,
  type BriefingBucket,
} from '@/hooks/domain/useDailyBriefingRange';
import { useRadarSocket } from '@/hooks/domain/useRadarSocket';

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format time until nextDueAt as "Xh" / "Xd" / "刚刚" */
function formatNextRefreshIn(nextDueAt: string | null): string {
  if (!nextDueAt) return '—';
  const diff = new Date(nextDueAt).getTime() - Date.now();
  if (diff <= 0) return '即将开始';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function RadarTopicDetailPage() {
  const params = useParams<{ topicId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const topicId = params?.topicId;

  // R14 2026-05-19: 4 bucket URL-synced
  const urlBucket = (searchParams?.get('bucket') as BriefingBucket) ?? 'today';
  const [bucket, setBucketState] = useState<BriefingBucket>(
    ['today', 'week', 'month', 'year'].includes(urlBucket) ? urlBucket : 'today'
  );

  const handleBucketChange = (b: BriefingBucket) => {
    setBucketState(b);
    const url = new URL(window.location.href);
    if (b === 'today') {
      url.searchParams.delete('bucket');
    } else {
      url.searchParams.set('bucket', b);
    }
    // 清掉旧 date 参数（兼容旧 URL）
    url.searchParams.delete('date');
    router.replace(url.pathname + url.search);
  };

  const [topic, setTopic] = useState<RadarTopicWithCounts | null>(null);
  const [sources, setSources] = useState<RadarSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stageStatus, setStageStatus] = useState<{
    stage: string;
    status: string;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  // 「查看详情」跳新路由 /runs/{runId}（整页运行历史 + drawer 看单 run 详情）。
  // 优先用当前 active（running 中）的 runId；退化到最近一次 run；都没有则 disabled。
  const [latestRunId, setLatestRunId] = useState<string | null>(null);

  // Subscribe to active run WS progress
  useRadarSocket(activeRunId, {
    onStage: (e) => setStageStatus({ stage: e.stage, status: e.status }),
    onCompleted: () => {
      setRefreshing(false);
      setActiveRunId(null);
      setStageStatus(null);
      void reloadTopicRef.current?.();
      void briefingRefreshRef.current?.();
    },
    onFailed: (e) => {
      setRefreshing(false);
      setActiveRunId(null);
      setStageStatus(null);
      setError(`刷新失败：${e.error}`);
    },
    onCancelled: () => {
      setRefreshing(false);
      setActiveRunId(null);
      setStageStatus(null);
    },
  });

  const reloadTopicRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const briefingRefreshRef = useRef<(() => Promise<void>) | undefined>(
    undefined
  );

  const reloadTopic = useCallback(async () => {
    if (!topicId) return;
    try {
      const [t, s] = await Promise.all([
        getTopic(topicId),
        listSources(topicId),
      ]);
      setTopic(t);
      setSources(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    reloadTopicRef.current = reloadTopic;
  }, [reloadTopic]);

  useEffect(() => {
    void reloadTopic();
  }, [reloadTopic]);

  // PR-DR2-FU3: 持久化 refresh stepper —— mount 时查 runs API 找 running mission
  // 用户离页/重载后回来仍能看到当前进度（之前 activeRunId 只活在 React state，
  // 一刷新就消失，stepper 被烫平）。WS 订阅由下面 useRadarSocket 在 activeRunId
  // set 后自动续上。
  useEffect(() => {
    if (!topicId) return;
    let cancelled = false;
    void listRuns(topicId, 5)
      .then((runs) => {
        if (cancelled) return;
        const running = runs.find((r) => r.status === 'running');
        if (running) {
          setActiveRunId(running.id);
          setRefreshing(true);
        }
        // 记录最近 run id —— 「查看详情」按钮跳 /runs/{id} 时用
        const latest = running ?? runs[0] ?? null;
        if (latest) {
          setLatestRunId(latest.id);
        }
      })
      .catch(() => {
        // 失败 silent —— stepper 不显也不影响主流程
      });
    return () => {
      cancelled = true;
    };
  }, [topicId]);

  // R8 2026-05-19：refreshing 状态 polling 兜底防 WS race。
  //
  // Bug 场景：mission 跑得太快（4.3s），client 拿到 runId → setActiveRunId →
  // useRadarSocket subscribe 还在握手，backend 已经 emit RUN_COMPLETED 完了。
  // → onCompleted 永远不触发 → refreshing 卡 true → 外面"准备中"，里面已结束。
  //
  // 兜底：refreshing=true 期间每 3s listRuns 看 activeRunId 实际 status，已 terminal
  // 立即清 refreshing + setLatestRunSummary 让 UI 切到回放卡片。
  // 用 ref 引用 reload/briefingRefresh 因为它们 declare 在本 effect 后。
  useEffect(() => {
    if (!refreshing || !topicId || !activeRunId) return;
    const interval = window.setInterval(() => {
      void listRuns(topicId, 5)
        .then((runs) => {
          const current = runs.find((r) => r.id === activeRunId);
          if (!current) return;
          if (current.status !== 'running') {
            setRefreshing(false);
            setActiveRunId(null);
            setStageStatus(null);
            void reloadTopicRef.current?.();
            void briefingRefreshRef.current?.();
          }
        })
        .catch(() => {
          // 静默：下次 tick 再试
        });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [refreshing, topicId, activeRunId]);

  // R14: 4 bucket 聚合 briefing
  const {
    data: briefingRange,
    loading: briefingLoading,
    refresh: briefingRefresh,
    error: briefingError,
  } = useDailyBriefingRange(topicId ?? null, bucket);

  useEffect(() => {
    briefingRefreshRef.current = briefingRefresh;
  }, [briefingRefresh]);

  const handleRefresh = async () => {
    if (!topicId) return;
    setRefreshing(true);
    setError(null);
    try {
      // 后端 fire-and-forget：立即返回 runId，mission 异步跑 + WS 实时 emit
      // stage 进度。前端拿 runId 立即 setActiveRunId → useRadarSocket 订阅
      // → 渲染 stepper。onCompleted/onFailed 由 WS 回调 reset state。
      const resp = await triggerRefresh(topicId);
      setActiveRunId(resp.runId);
      setLatestRunId(resp.runId);
      // 安全网：mission 极少数情况 WS 漏完成事件（pod 重启 / 网络抖动）
      // → 5 分钟硬超时强制 reset state，避免 spinner 永远转
      window.setTimeout(
        () => {
          setRefreshing((cur) => {
            if (!cur) return cur;
            void reloadTopic();
            void briefingRefresh();
            setActiveRunId(null);
            setStageStatus(null);
            return false;
          });
        },
        5 * 60 * 1000
      );
    } catch (e) {
      setRefreshing(false);
      setError(`刷新失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!topic) return;
    setDeleting(true);
    try {
      await deleteTopic(topic.id);
      router.push('/ai-radar');
    } catch (e) {
      setDeleting(false);
      setDeleteOpen(false);
      setError(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleConfigUpdate = async (
    patch: Partial<RadarTopicConfigDrawerTopic>
  ) => {
    if (!topic) return;
    // UpdateRadarTopicInput frontend type only defines base fields, but the
    // backend UpdateRadarTopicDto accepts briefingTime / signalsTarget etc.
    // Cast to allow passing extended fields through to the API.
    const payload = {
      ...(patch.keywords !== undefined && {
        keywords: patch.keywords,
      }),
      ...(patch.matchMode !== undefined && {
        matchMode: patch.matchMode,
      }),
      ...(patch.briefingTime !== undefined && {
        briefingTime: patch.briefingTime,
      }),
      ...(patch.signalsTarget !== undefined && {
        signalsTarget: patch.signalsTarget,
      }),
      ...(patch.signalTypes !== undefined && {
        signalTypes: patch.signalTypes,
      }),
      ...(patch.weekendSkip !== undefined && {
        weekendSkip: patch.weekendSkip,
      }),
      ...(patch.outputLanguage !== undefined && {
        outputLanguage: patch.outputLanguage,
      }),
      ...(patch.pushConfig !== undefined && {
        pushConfig: patch.pushConfig as Record<string, unknown>,
      }),
      ...(patch.refreshCron !== undefined && {
        refreshCron: patch.refreshCron,
      }),
    } as Parameters<typeof updateTopic>[1];
    await updateTopic(topic.id, payload);
    await reloadTopic();
  };

  // ------------------------------------------------------------------
  // Loading / error states
  // ------------------------------------------------------------------

  if (!topicId) return null;

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <LoadingState size="md" />
      </div>
    );
  }

  if (error && !topic) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          加载失败：{error}
        </div>
      </div>
    );
  }

  if (!topic) return null;

  // Extract config drawer topic from topic (fields are in the Prisma model response)
  const topicAsRecord = topic as RadarTopicWithCounts & Record<string, unknown>;
  const configTopic: RadarTopicConfigDrawerTopic = {
    id: topic.id,
    name: topic.name,
    description: topic.description,
    keywords: topic.keywords,
    matchMode: topic.matchMode ?? 'semantic',
    briefingTime: (topicAsRecord.briefingTime as string) ?? '08:00',
    signalsTarget: ((topicAsRecord.signalsTarget as number) === 5 ? 5 : 3) as
      | 3
      | 5,
    signalTypes: Array.isArray(topicAsRecord.signalTypes)
      ? (topicAsRecord.signalTypes as string[])
      : ['turning_point', 'trend_acceleration', 'new_entity', 'key_event'],
    weekendSkip: (topicAsRecord.weekendSkip as boolean) ?? false,
    outputLanguage:
      (topicAsRecord.outputLanguage as 'zh-CN' | 'en-US') ?? 'zh-CN',
    pushConfig:
      (topicAsRecord.pushConfig as RadarTopicConfigDrawerTopic['pushConfig']) ??
      null,
    refreshCron: topic.refreshCron,
    entityType: topic.entityType,
  };

  // R14: briefing groups（区间内每天一组）。今天 bucket 时长度 0-1，其他 bucket 多组。
  const briefingGroups = briefingRange?.briefings ?? [];
  // 今天 bucket 的 rerunCount 取今天那一组（如存在）
  const todayDateStr = todayDate();
  const todayBriefing = briefingGroups.find(
    (g) => g.briefingDate === todayDateStr
  );

  const nextRefreshIn = formatNextRefreshIn(topic.nextDueAt);
  const rawUrl = `/ai-radar/topic/${topicId}/raw?date=${todayDateStr}`;

  // 数据源健康度统计（侧边栏用）
  // 字段对齐：后端 RadarSource.health 是 RadarSourceHealth enum
  // (UNKNOWN/HEALTHY/DEGRADED/FAILING)，不是 healthStatus
  const healthStats = sources.reduce(
    (acc, s) => {
      if (s.health === 'HEALTHY') acc.ok += 1;
      else if (s.health === 'DEGRADED') acc.degraded += 1;
      else if (s.health === 'FAILING') acc.down += 1;
      else acc.unknown += 1;
      return acc;
    },
    { ok: 0, degraded: 0, down: 0, unknown: 0 }
  );

  return (
    <div className="mx-auto h-full w-full max-w-7xl overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
      {/* Back link */}
      <button
        type="button"
        onClick={() => router.push('/ai-radar')}
        className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        返回雷达列表
      </button>

      {/* Page header */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900 md:text-2xl">
              {topic.name}
            </h1>
            <button
              type="button"
              onClick={() => setConfigOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-50"
              aria-label="配置"
            >
              <Settings className="h-3.5 w-3.5" />
              配置
            </button>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-50"
              aria-label="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          </div>
          {topic.description && (
            <p className="mt-1.5 text-sm text-gray-600">{topic.description}</p>
          )}
          <p className="mt-1 text-sm text-gray-500">
            {topic.counts.sources} 源 · 下次刷新 {nextRefreshIn}
          </p>
        </div>
      </header>

      {/* Inline error banner */}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Refresh progress stepper（mission S1-S8 实时进度） */}
      {refreshing && (
        <RefreshProgressStepper
          currentStage={stageStatus?.stage ?? null}
          onOpenDetail={
            latestRunId
              ? () =>
                  router.push(`/ai-radar/topic/${topicId}/runs/${latestRunId}`)
              : undefined
          }
        />
      )}

      {/* R10 2026-05-19: 删 LatestRunRecap 黄色卡 —— 用户吐槽与右侧
          「查看详情·历史运行」按钮重复。状态信息已下放到 mission 详情页。 */}

      {/* 双栏：左侧 briefing（主），右侧 sidebar（信息）；≥lg 才双栏，≤md 单栏 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* 左主区 — Briefing toolbar + Panel */}
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <RadarBucketSwitcher value={bucket} onChange={handleBucketChange} />

            <div className="flex items-center gap-2">
              {/* "重新精选"按钮收敛到 RadarBriefingPanel 内（PR-DR2-FU2 修
                  双按钮重复 bug）。顶栏只保留"全部原始"次级动作 */}
              <a
                href={rawUrl}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                全部原始
              </a>
            </div>
          </div>

          <RadarBriefingPanel
            bucket={bucket}
            groups={briefingGroups}
            loading={briefingLoading}
            errorMsg={briefingError ? briefingError.message : null}
            topicId={topicId}
            topicName={topic.name}
            onRerun={() => void handleRefresh()}
            rerunCount={0}
          />

          {/* R13.5 2026-05-19：已收录信号面板 —— 即便今日 briefing 0 信号，
              用户也能看到 DB 中真实存在的历史 item（含 rel/qual 分），
              避免"系统好像没在工作"的错觉。 */}
          <RadarHistoricalItemsPanel topicId={topicId} />
        </div>

        {/* 右侧 sidebar — 数据源 / 配置摘要 / 行动 */}
        <aside className="flex flex-col gap-4">
          {/* 历史运行入口 —— 跳整页 /runs/{latestRunId} 看所有运行 + drawer 详情 */}
          <button
            type="button"
            onClick={() => {
              if (!latestRunId) return;
              router.push(`/ai-radar/topic/${topicId}/runs/${latestRunId}`);
            }}
            disabled={!latestRunId}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-2 font-medium text-gray-700">
              <RefreshCw className="h-4 w-4 text-violet-600" />
              查看详情 · 历史运行
            </span>
            <ChevronRight className="h-4 w-4 text-gray-400" />
          </button>

          {/* 数据源状态卡 */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">数据源</h3>
              <button
                type="button"
                onClick={() => setConfigOpen(true)}
                className="text-sm text-violet-600 hover:underline"
              >
                管理
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                正常 {healthStats.ok}
              </span>
              {healthStats.degraded > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  降级 {healthStats.degraded}
                </span>
              )}
              {healthStats.down > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                  故障 {healthStats.down}
                </span>
              )}
              {healthStats.unknown > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
                  待采集 {healthStats.unknown}
                </span>
              )}
              {sources.length === 0 && (
                <span className="text-gray-400">尚未添加</span>
              )}
            </div>
            {sources.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5 text-sm text-gray-600">
                {sources.slice(0, 5).map((s) => {
                  // 按 health 配色：HEALTHY→绿、DEGRADED→黄、FAILING→红、UNKNOWN→灰
                  const dotColor =
                    s.health === 'HEALTHY'
                      ? 'bg-emerald-500'
                      : s.health === 'DEGRADED'
                        ? 'bg-amber-500'
                        : s.health === 'FAILING'
                          ? 'bg-red-500'
                          : 'bg-gray-300';
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 truncate"
                      title={s.lastError ?? `health: ${s.health}`}
                    >
                      <span
                        className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`}
                      />
                      <span className="truncate">
                        {s.label ?? s.identifier}
                      </span>
                    </li>
                  );
                })}
                {sources.length > 5 && (
                  <li className="text-gray-400">+ {sources.length - 5} 个</li>
                )}
              </ul>
            )}
          </div>

          {/* 配置摘要卡 */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-base font-semibold text-gray-800">
              精选偏好
            </h3>
            <dl className="flex flex-col gap-2 text-sm text-gray-600">
              <div className="flex justify-between">
                <dt className="text-gray-500">推送时间</dt>
                <dd>{configTopic.briefingTime}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">目标条数</dt>
                <dd>{configTopic.signalsTarget}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">语言</dt>
                <dd>
                  {configTopic.outputLanguage === 'en-US' ? 'English' : '中文'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">周末</dt>
                <dd>{configTopic.weekendSkip ? '跳过' : '正常推送'}</dd>
              </div>
            </dl>
          </div>

          {/* 快速行动卡（空数据时主推用户加源） */}
          {sources.length === 0 && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-xs text-violet-700">
              <p className="font-semibold">还没添加数据源</p>
              <p className="mt-1">
                添加 RSS / YouTube / X / 自定义 URL 让雷达开始监控。
              </p>
              <button
                type="button"
                onClick={() => setConfigOpen(true)}
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700"
              >
                添加数据源 →
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* Config drawer */}
      <RadarTopicConfigDrawer
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        topic={configTopic}
        sources={sources}
        onSourceReload={() => void reloadTopic()}
        onUpdate={handleConfigUpdate}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteOpen}
        title={`确定删除主题「${topic.name}」？`}
        description="所有数据源、采集记录、洞察将一并删除，不可恢复。"
        confirmText="删除"
        type="danger"
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

// ------------------------------------------------------------------
// RefreshProgressStepper — mission S1-S8 实时可视化（5 步聚合，避免过密）
// ------------------------------------------------------------------

/** mission stage 名 → 用户可读 5 步分组 + 顺序 index */
const STAGE_STEPS: Array<{
  id: string;
  label: string;
  stages: ReadonlyArray<string>;
}> = [
  {
    id: 'collect',
    label: '采集源数据',
    stages: ['s1-source-resolve', 's2-collect'],
  },
  { id: 'dedupe', label: '去重', stages: ['s3-dedupe'] },
  {
    id: 'score',
    label: '评分（相关性 + 质量）',
    stages: ['s4-relevance', 's5-quality'],
  },
  {
    id: 'enrich',
    label: '实体抽取 + 洞察',
    stages: ['s6-entity', 's7-insight'],
  },
  { id: 'finalize', label: '生成精选 + 持久化', stages: ['s8-persist'] },
];

function findStepIndex(currentStage: string | null): number {
  if (!currentStage) return -1;
  return STAGE_STEPS.findIndex((step) =>
    step.stages.some((s) => currentStage.startsWith(s))
  );
}

function RefreshProgressStepper({
  currentStage,
  onOpenDetail,
}: {
  currentStage: string | null;
  onOpenDetail?: () => void;
}) {
  const activeIdx = findStepIndex(currentStage);

  return (
    <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium text-violet-700">
        <span className="inline-flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          正在重新精选 · {currentStage ? `当前 ${currentStage}` : '准备中…'}
        </span>
        {onOpenDetail && (
          <button
            type="button"
            onClick={onOpenDetail}
            className="text-sm text-violet-600 hover:underline"
          >
            查看详情 →
          </button>
        )}
      </div>
      <ol className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {STAGE_STEPS.map((step, idx) => {
          const isDone = activeIdx > idx;
          const isActive = activeIdx === idx;
          return (
            <li key={step.id} className="flex items-center gap-1.5">
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                  isDone
                    ? 'bg-violet-600 text-white'
                    : isActive
                      ? 'bg-violet-100 text-violet-700 ring-2 ring-violet-400'
                      : 'bg-slate-100 text-slate-400'
                }`}
                aria-current={isActive ? 'step' : undefined}
              >
                {isDone ? <Check className="h-3 w-3" /> : idx + 1}
              </span>
              <span
                className={
                  isActive
                    ? 'font-medium text-violet-700'
                    : isDone
                      ? 'text-slate-600'
                      : ''
                }
              >
                {step.label}
              </span>
              {idx < STAGE_STEPS.length - 1 && (
                <ChevronRight
                  className="ml-1 h-3 w-3 text-slate-300"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// R10 2026-05-19: LatestRunRecap + relativeAgo + formatDuration 已删 ——
// 用户反馈黄色卡片与右侧「查看详情·历史运行」按钮重复。回放信息可在
// mission 详情页查看。
