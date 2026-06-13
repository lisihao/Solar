'use client';

/**
 * ContentDetailDrawer —— 内容详情抽屉（PR-4 UI 候选 A 核心组件）
 *
 * 替代旧 MissionsTab 长表单 + ContentsTab 旧 publish modal 的双轨入口。
 * Row 点开 → 右 480px slide-over，三段：
 *   1. 状态段：内容元信息 + 当前 status
 *   2. 发布表单：平台多选 + 智能档位（业务化文案）+ advanced budget 折叠
 *   3. 进度时间线：mission 启动后实时事件流（WebSocket）
 *
 * 设计稿：docs/architecture/ai-app/social/ui-redesign-2026-05-17.md 候选 A
 * 单源后端：runSocialMission (POST /ai-social/mission/run)，按 depth 派 13/4 stage pipeline
 */

import { useMemo, useState } from 'react';
import { useFocusTrap } from '@/hooks/utils/useFocusTrap';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Loader2,
  PlayCircle,
  Rocket,
  Settings2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  runSocialMission,
  type SocialContent,
  type SocialPlatformConnection,
  type SocialPlatformType,
} from '@/services/ai-social/api';
import { useSocialMissionStream } from '@/hooks/features/useSocialMissionStream';
import { useTranslation } from '@/lib/i18n';

type Depth = 'quick' | 'standard' | 'deep';
type BudgetProfile = 'lean' | 'standard' | 'rich';

const DEPTH_ICON: Record<Depth, JSX.Element> = {
  quick: <Zap className="h-3.5 w-3.5" />,
  standard: <Rocket className="h-3.5 w-3.5" />,
  deep: <Settings2 className="h-3.5 w-3.5" />,
};

const DEPTH_VALUES: Depth[] = ['quick', 'standard', 'deep'];
const BUDGET_VALUES: BudgetProfile[] = ['lean', 'standard', 'rich'];

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-amber-50 text-amber-700',
  SCHEDULED: 'bg-blue-50 text-blue-700',
  PUBLISHED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-red-50 text-red-700',
  ARCHIVED: 'bg-gray-100 text-gray-500',
};

const STATUS_I18N_KEY: Record<string, string> = {
  DRAFT: 'aiSocial.status.draft',
  PENDING: 'aiSocial.status.pending',
  SCHEDULED: 'aiSocial.status.scheduled',
  PUBLISHED: 'aiSocial.status.published',
  FAILED: 'aiSocial.status.failed',
  ARCHIVED: 'aiSocial.status.archived',
};

const PLATFORM_I18N_KEY: Record<SocialPlatformType, string> = {
  WECHAT_MP: 'aiSocial.platforms.wechat_mp',
  XIAOHONGSHU: 'aiSocial.platforms.xiaohongshu',
};

interface ContentDetailDrawerProps {
  content: SocialContent;
  connections: SocialPlatformConnection[];
  onClose: () => void;
  /** mission 启动成功后回调（用于触发列表刷新） */
  onMissionStarted?: (missionId: string) => void;
}

export default function ContentDetailDrawer({
  content,
  connections,
  onClose,
  onMissionStarted,
}: ContentDetailDrawerProps) {
  const { t } = useTranslation();

  const platformToConnectionId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of connections) if (c.isActive) m[c.platformType] = c.id;
    return m;
  }, [connections]);

  const availablePlatforms = useMemo(
    () => connections.filter((c) => c.isActive).map((c) => c.platformType),
    [connections]
  );

  // 平台初始：内容原有 connection 优先；否则单平台时自动勾选（R1 P1：避免
  // 用户看到"唯一选项"还要手点的反直觉 UX）
  const initialPlatform = useMemo<SocialPlatformType[]>(() => {
    if (content.connection?.platformType) {
      return [content.connection.platformType];
    }
    if (availablePlatforms.length === 1) {
      return [availablePlatforms[0]];
    }
    return [];
  }, [content.connection, availablePlatforms]);

  const [selectedPlatforms, setSelectedPlatforms] =
    useState<SocialPlatformType[]>(initialPlatform);

  // a11y：focus trap + Escape close（R1 P0）
  const containerRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const [depth, setDepth] = useState<Depth>('quick'); // PR-4 默认 quick（4-stage fast pipeline）
  const [budgetProfile, setBudgetProfile] = useState<BudgetProfile>('lean');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [currentMissionId, setCurrentMissionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const canStart =
    selectedPlatforms.length > 0 &&
    selectedPlatforms.every((p) => platformToConnectionId[p]) &&
    !starting;

  const togglePlatform = (p: SocialPlatformType) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const handleStart = async () => {
    if (!canStart) return;
    setStarting(true);
    setStartError(null);
    try {
      const resp = await runSocialMission({
        contentId: content.id,
        platforms: selectedPlatforms,
        connectionIds: Object.fromEntries(
          selectedPlatforms.map((p) => [p, platformToConnectionId[p]])
        ),
        depth,
        budgetProfile,
        language: 'zh-CN',
      });
      setCurrentMissionId(resp.missionId);
      onMissionStarted?.(resp.missionId);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const statusKey = STATUS_I18N_KEY[content.status];
  const statusLabel = statusKey ? t(statusKey) : content.status;
  const statusColor =
    STATUS_COLOR[content.status] ?? 'bg-gray-100 text-gray-700';
  const platformLabel = (p: SocialPlatformType): string =>
    t(PLATFORM_I18N_KEY[p] ?? p);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('aiSocial.drawer.ariaLabel')}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-gray-200 bg-white shadow-2xl"
    >
      {/* Header */}
      <header className="border-b border-gray-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-500">
              {t('aiSocial.drawer.label')}
            </div>
            <h3 className="truncate text-base font-semibold text-gray-900">
              {content.title}
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {content.contentType === 'WECHAT_ARTICLE'
                ? t('aiSocial.drawer.contentTypeArticle')
                : t('aiSocial.drawer.contentTypeNote')}
              {' · '}
              {new Date(content.createdAt ?? Date.now()).toLocaleString(
                'zh-CN',
                {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label={t('aiSocial.drawer.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 状态段 */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
          >
            {statusLabel}
          </span>
          {content.connection?.platformType && (
            <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
              {platformLabel(content.connection.platformType)}
              {content.connection.accountName
                ? ` · ${content.connection.accountName}`
                : ''}
            </span>
          )}
          {content.externalUrl && (
            <a
              href={content.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100"
            >
              <ExternalLink className="h-3 w-3" />
              {t('aiSocial.drawer.viewPublished')}
            </a>
          )}
        </div>
      </header>

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* 发布表单 */}
        <section className="mb-6">
          <h4 className="mb-3 text-sm font-semibold text-gray-900">
            {t('aiSocial.drawer.publishTo')}
          </h4>

          {availablePlatforms.length === 0 ? (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              {t('aiSocial.drawer.noConnectionsHint')}
              <a
                href="/ai-social/connections"
                className="ml-1 underline hover:no-underline"
              >
                {t('aiSocial.drawer.connectionsLinkText')}
              </a>
              {t('aiSocial.drawer.noConnectionsHintTail')}
            </div>
          ) : (
            <div className="mb-4 flex flex-wrap gap-2">
              {availablePlatforms.map((p) => {
                const selected = selectedPlatforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      selected
                        ? 'border-rose-500 bg-rose-50 text-rose-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {platformLabel(p)}
                  </button>
                );
              })}
            </div>
          )}

          {/* 智能档位（业务化文案，痛点 5 修复） */}
          <div className="mb-3 space-y-1.5">
            {DEPTH_VALUES.map((value) => {
              const selected = depth === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDepth(value)}
                  className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? 'border-rose-500 bg-rose-50/50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                      selected
                        ? 'bg-rose-500 text-white'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {DEPTH_ICON[value]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-sm font-medium ${
                        selected ? 'text-rose-700' : 'text-gray-900'
                      }`}
                    >
                      {t(`aiSocial.depth.${value}.label`)}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {t(`aiSocial.depth.${value}.hint`)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Advanced 折叠：预算档位（痛点 5：高级用户才看 budget） */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="mb-2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            {showAdvanced ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {t('aiSocial.drawer.advanced')}
          </button>
          {showAdvanced && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <div className="mb-2 text-xs font-medium text-gray-700">
                {t('aiSocial.drawer.budgetTitle')}
              </div>
              <div className="space-y-1">
                {BUDGET_VALUES.map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-gray-700 hover:bg-white"
                  >
                    <input
                      type="radio"
                      name="budgetProfile"
                      value={value}
                      checked={budgetProfile === value}
                      onChange={() => setBudgetProfile(value)}
                      className="h-3.5 w-3.5 accent-rose-500"
                    />
                    <span>{t(`aiSocial.budget.${value}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!canStart}
            onClick={handleStart}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-500/25 transition-all hover:shadow-xl hover:shadow-rose-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            {starting
              ? t('aiSocial.drawer.starting')
              : t('aiSocial.drawer.startPublish')}
          </button>

          {startError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{startError}</span>
            </div>
          )}
        </section>

        {/* 进度时间线段 */}
        {currentMissionId && (
          <section className="mb-2">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-rose-500" />
              <h4 className="text-sm font-semibold text-gray-900">
                {t('aiSocial.drawer.progress')}
              </h4>
            </div>
            <MissionEventLog missionId={currentMissionId} />
          </section>
        )}
      </div>
    </div>
  );
}

interface EventPayload {
  status?: string;
  stage?: string;
  stepId?: string;
  message?: string;
  text?: string;
  role?: string;
  tag?: string;
  failureCode?: string;
  publishedCount?: number;
  wallTimeMs?: number;
}

function MissionEventLog({ missionId }: { missionId: string }) {
  const { t } = useTranslation();
  const { events, connState, error } = useSocialMissionStream(missionId);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-xs text-gray-500">
          {missionId.slice(0, 18)}…
        </div>
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            connState === 'live'
              ? 'bg-emerald-50 text-emerald-700'
              : connState === 'connecting'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-gray-100 text-gray-500'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connState === 'live'
                ? 'animate-pulse bg-emerald-500'
                : connState === 'connecting'
                  ? 'bg-amber-500'
                  : 'bg-gray-400'
            }`}
          />
          {connState}
        </span>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="font-mono max-h-72 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
        {events.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-gray-400">
            {t('aiSocial.drawer.waitingEvents')}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e, idx) => (
              <EventLine
                key={`${e.timestamp}-${idx}`}
                type={e.type}
                payload={e.payload as EventPayload}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EventLine({ type, payload }: { type: string; payload: EventPayload }) {
  const { t } = useTranslation();
  const isMissionCompleted = type === 'social.mission:completed';
  const isMissionFailed = type === 'social.mission:failed';
  const isMissionAborted = type === 'social.mission:aborted';
  const isStageLifecycle = type === 'social.stage:lifecycle';
  const isNarrative = type === 'social.agent:narrative';

  let icon = <Clock className="h-3.5 w-3.5 text-gray-400" />;
  let color = 'text-gray-700';

  if (isMissionCompleted) {
    icon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    color = 'text-emerald-700';
  } else if (isMissionFailed) {
    icon = <XCircle className="h-3.5 w-3.5 text-red-500" />;
    color = 'text-red-700';
  } else if (isMissionAborted) {
    icon = <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
    color = 'text-amber-700';
  } else if (isStageLifecycle && payload.status === 'completed') {
    icon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    color = 'text-emerald-700';
  } else if (isStageLifecycle && payload.status === 'failed') {
    icon = <XCircle className="h-3.5 w-3.5 text-red-500" />;
    color = 'text-red-700';
  }

  const text =
    isNarrative && payload.text
      ? payload.text
      : isStageLifecycle
        ? `${payload.stepId} · ${payload.status}`
        : isMissionCompleted
          ? t('aiSocial.drawer.eventPublished', {
              count: payload.publishedCount ?? 0,
              seconds: payload.wallTimeMs
                ? (payload.wallTimeMs / 1000).toFixed(1)
                : '?',
            })
          : isMissionFailed
            ? t('aiSocial.drawer.eventFailed', {
                code: payload.failureCode ?? 'UNKNOWN',
                message: payload.message ?? '',
              })
            : type.replace(/^social\./, '');

  return (
    <li className={`flex items-start gap-2 ${color}`}>
      {icon}
      <span className="break-all">{text}</span>
    </li>
  );
}
