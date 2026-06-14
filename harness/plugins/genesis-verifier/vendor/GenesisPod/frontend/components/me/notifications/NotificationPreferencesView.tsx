'use client';

/**
 * NotificationPreferencesView —— 账户级通知偏好设置（极简 + 高级折叠）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §7.3.1
 *
 * UX 重设计（用户反馈 2026-05-18 Screenshot_39）：
 * - 默认展开只**极简**：邮件接收 ON/OFF + 站内推送 ON/OFF + Tier 3 即时推主开关 + 静默时段
 *   → 普通用户 30 秒可懂可配
 * - **高级**（默认折叠）：业务类型 × 渠道三态矩阵 + 渠道绑定状态
 *   → 进阶用户按需展开
 *
 * 复用入口：
 * - /settings/notifications 独立路由（带 AppShell）
 * - /profile?tab=notifications profile tab（嵌入版无 AppShell）
 */

import { useEffect, useMemo, useState } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { SettingsSectionCard } from '@/components/ui/cards/SettingsSectionCard';
import { Alert } from '@/components/ui/feedback/Alert';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mail,
  MessageSquare,
  MoonStar,
  Save,
  Smartphone,
  Sparkles,
  Star,
} from 'lucide-react';
import {
  useNotificationPreferences,
  type NotificationChannel,
  type NotificationPreferences,
} from '@/hooks/domain/useNotifications';

// 业务类型 × 行
const NOTIFICATION_TYPE_ROWS: Array<{
  type: string;
  label: string;
  desc: string;
}> = [
  {
    type: 'RADAR_DAILY',
    label: 'AI 雷达每日精选',
    desc: '每日固定时间收 TOP 3 关键信号',
  },
  {
    type: 'RADAR_WEEKLY',
    label: 'AI 雷达周报',
    desc: '周日 18:00 自动汇总本周 Tier 3 信号',
  },
  {
    type: 'RADAR_TIER3_INSTANT',
    label: '最高级 (Tier 3) 信号即时推',
    desc: '最高级信号实时推送（默认走站内 + 公众号，不发邮件避风暴）',
  },
  {
    type: 'MISSION_COMPLETED',
    label: 'Mission 完成',
    desc: 'Agent / Research mission 完成通知',
  },
  {
    type: 'FEEDBACK_STATUS_CHANGED',
    label: '反馈状态变更',
    desc: '你提交的反馈被处理时收到通知',
  },
  {
    type: 'KEY_REQUEST_APPROVED',
    label: 'BYOK 密钥申请结果',
    desc: 'admin 审批密钥申请的结果通知',
  },
];

// 4 渠道
const CHANNELS: Array<{
  key: NotificationChannel;
  label: string;
  icon: typeof Mail;
  available: boolean;
  unavailableReason?: string;
}> = [
  { key: 'email', label: '邮件', icon: Mail, available: true },
  { key: 'site', label: '站内', icon: Bell, available: true },
  {
    key: 'wechat',
    label: '公众号',
    icon: MessageSquare,
    available: false,
    unavailableReason: 'PR-DR3 启用后可绑定微信公众号',
  },
  {
    key: 'webpush',
    label: '浏览器',
    icon: Smartphone,
    available: false,
    unavailableReason: 'Phase 2 启用浏览器推送',
  },
];

type TriState = boolean | null;

export interface NotificationPreferencesViewProps {
  /**
   * 是否显示页面标题（独立 /settings/notifications 路由 = true；嵌入 profile tab = false）
   */
  showHeader?: boolean;
}

export function NotificationPreferencesView({
  showHeader = true,
}: NotificationPreferencesViewProps) {
  const { preferences, loading, updating, error, refresh, updatePreferences } =
    useNotificationPreferences();
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (preferences && !draft) {
      setDraft({ ...preferences });
    }
  }, [preferences, draft]);

  const matrix = useMemo(
    () => draft?.channelSubscriptions ?? {},
    [draft?.channelSubscriptions]
  );

  const setChannelFor = (
    type: string,
    channel: NotificationChannel,
    value: TriState
  ) => {
    if (!draft) return;
    const newMatrix = { ...matrix };
    const row = { ...(newMatrix[type] ?? {}) } as Partial<
      Record<NotificationChannel, boolean>
    >;
    if (value === null) {
      delete row[channel];
    } else {
      row[channel] = value;
    }
    if (Object.keys(row).length === 0) {
      delete newMatrix[type];
    } else {
      newMatrix[type] = row;
    }
    setDraft({ ...draft, channelSubscriptions: newMatrix });
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaveError(null);
    try {
      await updatePreferences({
        emailEnabled: draft.emailEnabled,
        pushEnabled: draft.pushEnabled,
        soundEnabled: draft.soundEnabled,
        quietHoursStart: draft.quietHoursStart || undefined,
        quietHoursEnd: draft.quietHoursEnd || undefined,
        channelSubscriptions: draft.channelSubscriptions,
        instantPushForTier3: draft.instantPushForTier3,
      });
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败，请稍后重试';
      setSaveError(msg);
      setSaved(false);
    }
  };

  if (loading && !draft) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!loading && error && !draft) {
    return (
      <Alert
        tone="error"
        title="加载通知偏好失败"
        action={
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            重试
          </button>
        }
      >
        {error instanceof Error ? error.message : '网络异常，请检查连接后重试'}
      </Alert>
    );
  }

  if (!draft) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const saveBtn = (
    <button
      onClick={handleSave}
      disabled={updating}
      className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
    >
      {updating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : saved ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <Save className="h-4 w-4" />
      )}
      {saved ? '已保存' : updating ? '保存中…' : '保存设置'}
    </button>
  );

  return (
    <div className="space-y-6">
      {showHeader && (
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">通知偏好</h1>
            <p className="mt-1 text-sm text-slate-500">
              控制 AI 雷达 / Mission / 系统通知如何送达
            </p>
          </div>
          {saveBtn}
        </header>
      )}

      {saveError && (
        <Alert tone="error" title="保存失败">
          {saveError}
        </Alert>
      )}

      {/* 基础（默认展开） */}
      <SettingsSectionCard
        as="section"
        variant="slate"
        title="基础设置"
        description={
          <>
            涵盖 90% 用户场景。如需 per 业务类型 × 渠道精细控制，请展开下方
            "高级选项"。
          </>
        }
      >
        <div className="space-y-3">
          <ToggleRow
            icon={Mail}
            label="邮件接收"
            desc="关闭后所有通知不再发邮件（站内通知不受影响）"
            value={draft.emailEnabled}
            onChange={(v) => setDraft({ ...draft, emailEnabled: v })}
          />
          <ToggleRow
            icon={Bell}
            label="站内 + 实时推送"
            desc="关闭后站内 inbox 仍写入但不实时推送（页面 reload 才看到）"
            value={draft.pushEnabled}
            onChange={(v) => setDraft({ ...draft, pushEnabled: v })}
          />
          <ToggleRow
            icon={Sparkles}
            label="最高级 (Tier 3) 信号即时推"
            desc="关闭即整类静音；保持开启时按下方高级矩阵的渠道策略走"
            value={draft.instantPushForTier3 ?? true}
            onChange={(v) => setDraft({ ...draft, instantPushForTier3: v })}
          />
        </div>
      </SettingsSectionCard>

      {/* 静默时段（默认展开，配置简单） */}
      <SettingsSectionCard
        as="section"
        variant="slate"
        title={
          <span className="flex items-center gap-2">
            <MoonStar className="h-4 w-4" />
            静默时段
          </span>
        }
        description={
          <>
            该时段内即时推送（如 Tier 3
            即时推）静默；站内通知仍写入。时间按你的本地时区 (
            {Intl.DateTimeFormat().resolvedOptions().timeZone})。
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-700" htmlFor="quiet-hours-start">
            从
          </label>
          <input
            id="quiet-hours-start"
            type="time"
            value={draft.quietHoursStart ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, quietHoursStart: e.target.value })
            }
            className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
          />
          <label className="text-sm text-slate-700" htmlFor="quiet-hours-end">
            到
          </label>
          <input
            id="quiet-hours-end"
            type="time"
            value={draft.quietHoursEnd ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, quietHoursEnd: e.target.value })
            }
            className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none"
          />
          <span className="text-xs text-slate-400">
            支持跨午夜（如 22:00–06:00）
          </span>
          {draft.quietHoursStart &&
            draft.quietHoursEnd &&
            draft.quietHoursStart === draft.quietHoursEnd && (
              <span className="text-xs text-amber-600">
                起止相同会被视为全天静默
              </span>
            )}
        </div>
      </SettingsSectionCard>

      {/* 高级选项（默认折叠） */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
          aria-expanded={advancedOpen}
        >
          <div>
            <div className="text-sm font-semibold text-slate-900">高级选项</div>
            <div className="text-xs text-slate-500">
              每个业务类型 × 4
              渠道精细控制（默认走系统推荐策略，多数用户无需调整）
            </div>
          </div>
          {advancedOpen ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
        </button>
        {advancedOpen && (
          <div className="space-y-6 border-t border-slate-100 p-4">
            {/* 类型 × 渠道矩阵 */}
            <div>
              <h3 className="mb-1 text-sm font-medium text-slate-900">
                业务类型 × 渠道
              </h3>
              <p className="mb-3 text-xs text-slate-500">
                每格三态：<span className="font-medium">默认</span>{' '}
                走系统策略（推荐）· <span className="font-medium">开</span>{' '}
                强制启用 · <span className="font-medium">关</span> 强制静音。
                基础开关 OFF 时整类静音；矩阵勾选不会越过基础开关。
              </p>
              <div className="overflow-x-auto">
                <Table className="w-full text-sm">
                  <THead>
                    <Tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <Th className="px-2 py-2 font-medium">业务类型</Th>
                      {CHANNELS.map((ch) => (
                        <Th
                          key={ch.key}
                          className="w-32 px-2 py-2 text-center font-medium"
                        >
                          <div className="flex flex-col items-center gap-1">
                            <ch.icon className="h-4 w-4" />
                            <span>{ch.label}</span>
                            {!ch.available && (
                              <span
                                className="text-[10px] text-slate-400"
                                title={ch.unavailableReason}
                              >
                                未启用
                              </span>
                            )}
                          </div>
                        </Th>
                      ))}
                    </Tr>
                  </THead>
                  <TBody>
                    {NOTIFICATION_TYPE_ROWS.map((row) => (
                      <Tr
                        key={row.type}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <Td className="px-2 py-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                            {row.type === 'RADAR_TIER3_INSTANT' && (
                              <Star
                                className="h-3.5 w-3.5 text-amber-500"
                                aria-label="Tier 3"
                              />
                            )}
                            {row.label}
                          </div>
                          <div className="text-xs text-slate-500">
                            {row.desc}
                          </div>
                        </Td>
                        {CHANNELS.map((ch) => {
                          const current = matrix[row.type]?.[ch.key] ?? null;
                          const renderValue: TriState = ch.available
                            ? current
                            : null;
                          return (
                            <Td key={ch.key} className="px-2 py-3">
                              <TriStateSegmented
                                value={renderValue}
                                disabled={!ch.available}
                                disabledReason={ch.unavailableReason}
                                ariaLabel={`${row.label} - ${ch.label}`}
                                onChange={(v) =>
                                  setChannelFor(row.type, ch.key, v)
                                }
                              />
                            </Td>
                          );
                        })}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            </div>

            {/* 渠道绑定状态 */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-slate-900">
                渠道状态
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-slate-700">
                    <Mail className="h-4 w-4 text-slate-500" />
                    邮件
                  </span>
                  <span className="inline-flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    自动启用
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-slate-700">
                    <Bell className="h-4 w-4 text-slate-500" />
                    站内
                  </span>
                  <span className="inline-flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    自动启用
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-slate-700">
                    <MessageSquare className="h-4 w-4 text-slate-500" />
                    微信公众号
                  </span>
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    未绑定（PR-DR3 启用）
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 嵌入版（无 header）的保存按钮放底部 */}
      {!showHeader && <div className="flex justify-end pt-2">{saveBtn}</div>}
    </div>
  );
}

interface ToggleRowProps {
  icon: typeof Bell;
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({
  icon: Icon,
  label,
  desc,
  value,
  onChange,
}: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 text-slate-500" />
        <div>
          <div className="text-sm font-medium text-slate-900">{label}</div>
          <div className="text-xs text-slate-500">{desc}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          value ? 'bg-violet-600' : 'bg-slate-300'
        }`}
        aria-pressed={value}
        aria-label={label}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

interface TriStateSegmentedProps {
  value: TriState;
  disabled?: boolean;
  disabledReason?: string;
  ariaLabel: string;
  onChange: (v: TriState) => void;
}

function TriStateSegmented({
  value,
  disabled,
  disabledReason,
  ariaLabel,
  onChange,
}: TriStateSegmentedProps) {
  const options: Array<{
    key: 'default' | 'on' | 'off';
    label: string;
    v: TriState;
  }> = [
    { key: 'default', label: '默认', v: null },
    { key: 'on', label: '开', v: true },
    { key: 'off', label: '关', v: false },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      title={disabled ? disabledReason : ariaLabel}
      className={`inline-flex overflow-hidden rounded-md border border-slate-200 ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      {options.map((opt) => {
        const active = value === opt.v;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.v)}
            className={`px-2 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-violet-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            } ${disabled ? 'cursor-not-allowed' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
