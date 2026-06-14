'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { SideDrawer } from '@/components/common/drawers/SideDrawer';
import { Tabs } from '@/components/ui/tabs';
import { RadarSourceList } from './RadarSourceList';
import type { RadarMatchMode, RadarSource } from '@/services/ai-radar/types';

/** 与后端 UpdateRadarTopicDto / radar-topic.service 校验对齐 */
const KEYWORD_MAX_COUNT = 20;
const KEYWORD_MAX_LEN = 80;

export interface RadarTopicConfigDrawerTopic {
  id: string;
  name: string;
  description: string | null;
  keywords: string[];
  matchMode: RadarMatchMode;
  briefingTime: string;
  signalsTarget: 3 | 5;
  signalTypes: string[];
  weekendSkip: boolean;
  outputLanguage: 'zh-CN' | 'en-US';
  pushConfig: {
    mode: 'account_default' | 'override';
    channels?: Record<string, boolean>;
  } | null;
  refreshCron: string;
  entityType: string | null;
}

export interface RadarTopicConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  topic: RadarTopicConfigDrawerTopic;
  sources: RadarSource[];
  onSourceReload: () => void;
  onUpdate: (patch: Partial<RadarTopicConfigDrawerTopic>) => Promise<void>;
}

type TabKey = 'briefing' | 'push' | 'sources' | 'keywords' | 'advanced';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'briefing', label: '精选偏好' },
  { key: 'push', label: '推送方式' },
  { key: 'sources', label: '数据源' },
  { key: 'keywords', label: '关键词' },
  { key: 'advanced', label: '高级' },
];

const SIGNAL_TYPES = [
  { value: 'turning_point', label: '转折点' },
  { value: 'trend_acceleration', label: '趋势加速' },
  { value: 'new_entity', label: '新实体' },
  { value: 'anomaly', label: '异常' },
  { value: 'key_event', label: '关键事件' },
];

export function RadarTopicConfigDrawer({
  open,
  onClose,
  topic,
  sources,
  onSourceReload,
  onUpdate,
}: RadarTopicConfigDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('briefing');
  const [draft, setDraft] = useState<RadarTopicConfigDrawerTopic>(topic);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // FU-P2-3：父组件 topic prop 变更（如 reloadTopic 后）→ 同步 draft；
  // 仅在 drawer 关闭时同步，避免覆盖用户正在编辑的脏值
  useEffect(() => {
    if (!open) setDraft(topic);
  }, [topic, open]);

  // Reset draft when topic changes or drawer reopens
  const isDirty = JSON.stringify(draft) !== JSON.stringify(topic);
  // 后端强制至少 1 个关键词；空时禁止保存（避免一次必失败的请求）
  const keywordsEmpty = draft.keywords.length === 0;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      await onUpdate(draft);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setDraft(topic);
    setSaveError(null);
    setSavedOk(false);
    setActiveTab('briefing');
    onClose();
  };

  const patchDraft = (patch: Partial<RadarTopicConfigDrawerTopic>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  return (
    <SideDrawer
      open={open}
      onClose={handleClose}
      title={`配置 · ${topic.name}`}
      widthPx={480}
    >
      {/* Tab nav */}
      <Tabs
        className="mb-4 overflow-x-auto"
        value={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
        items={TABS}
      />

      {/* Tab panels */}
      {activeTab === 'briefing' && (
        <BriefingTab draft={draft} onChange={patchDraft} />
      )}
      {activeTab === 'push' && <PushTab draft={draft} onChange={patchDraft} />}
      {activeTab === 'sources' && (
        <div className="-mx-4 -mb-4">
          <RadarSourceList
            topicId={topic.id}
            sources={sources}
            onReload={onSourceReload}
          />
        </div>
      )}
      {activeTab === 'keywords' && (
        <KeywordsTab draft={draft} onChange={patchDraft} />
      )}
      {activeTab === 'advanced' && (
        <AdvancedTab draft={draft} onChange={patchDraft} />
      )}

      {/* Footer */}
      {activeTab !== 'sources' && (
        <div className="mt-6 border-t border-gray-200 pt-4">
          {saveError && (
            <p className="mb-2 text-xs text-red-600">{saveError}</p>
          )}
          {keywordsEmpty && (
            <p className="mb-2 text-xs text-amber-600">
              至少保留 1 个关键词才能保存
            </p>
          )}
          {savedOk && <p className="mb-2 text-xs text-emerald-600">已保存</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving || !isDirty || keywordsEmpty}
              onClick={() => void handleSave()}
              className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
    </SideDrawer>
  );
}

// ── Tab 1: 精选偏好 ────────────────────────────────────

function BriefingTab({
  draft,
  onChange,
}: {
  draft: RadarTopicConfigDrawerTopic;
  onChange: (p: Partial<RadarTopicConfigDrawerTopic>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* 精选生成时间 */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          精选生成时间
        </label>
        <input
          type="time"
          value={draft.briefingTime}
          onChange={(e) => onChange({ briefingTime: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
        />
      </div>

      {/* 每日精选数量 */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          每日精选数量
        </label>
        <div className="flex gap-2">
          {([3, 5] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ signalsTarget: n })}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                draft.signalsTarget === n
                  ? 'border-cyan-300 bg-cyan-50 text-cyan-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              TOP {n}
            </button>
          ))}
        </div>
      </div>

      {/* 关注信号类型 */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          关注信号类型
        </label>
        <div className="space-y-1.5">
          {SIGNAL_TYPES.map((st) => {
            const checked = draft.signalTypes.includes(st.value);
            return (
              <label
                key={st.value}
                className="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? draft.signalTypes.filter((v) => v !== st.value)
                      : [...draft.signalTypes, st.value];
                    onChange({ signalTypes: next });
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="text-sm text-gray-700">{st.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* 周末跳过 */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          周末跳过精选
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={draft.weekendSkip}
          onClick={() => onChange({ weekendSkip: !draft.weekendSkip })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            draft.weekendSkip ? 'bg-cyan-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              draft.weekendSkip ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* AI 输出语言 */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          AI 输出语言
        </label>
        <div className="flex gap-2">
          {(
            [
              { value: 'zh-CN', label: '中文' },
              { value: 'en-US', label: 'English' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ outputLanguage: opt.value })}
              className={`rounded-lg border px-4 py-2 text-sm ${
                draft.outputLanguage === opt.value
                  ? 'border-cyan-300 bg-cyan-50 text-cyan-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tab 2: 推送方式 ────────────────────────────────────

const PUSH_CHANNELS = [
  { key: 'email', label: '邮件' },
  { key: 'wechat', label: '公众号' },
  { key: 'site', label: '站内' },
] as const;

type PushChannelKey = (typeof PUSH_CHANNELS)[number]['key'];

function PushTab({
  draft,
  onChange,
}: {
  draft: RadarTopicConfigDrawerTopic;
  onChange: (p: Partial<RadarTopicConfigDrawerTopic>) => void;
}) {
  const mode = draft.pushConfig?.mode ?? 'account_default';
  const channels: Record<string, boolean> = draft.pushConfig?.channels ?? {};

  const setMode = (m: 'account_default' | 'override') => {
    onChange({
      pushConfig:
        m === 'account_default'
          ? { mode: 'account_default' }
          : { mode: 'override', channels },
    });
  };

  const toggleChannel = (ch: PushChannelKey) => {
    const next = { ...channels, [ch]: !channels[ch] };
    onChange({ pushConfig: { mode: 'override', channels: next } });
  };

  return (
    <div className="space-y-5">
      {/* mode segmented */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          推送模式
        </label>
        <div className="flex gap-0 overflow-hidden rounded-lg border border-gray-300">
          {(
            [
              { value: 'account_default', label: '使用账户默认' },
              { value: 'override', label: '单独配置' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className={`flex-1 py-2 text-sm transition-colors ${
                mode === opt.value
                  ? 'bg-cyan-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* channels — only visible in override mode */}
      {mode === 'override' && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            推送渠道
          </label>
          <div className="space-y-2">
            {PUSH_CHANNELS.map((ch) => (
              <label
                key={ch.key}
                className="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={!!channels[ch.key]}
                  onChange={() => toggleChannel(ch.key)}
                  className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="text-sm text-gray-700">{ch.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {mode === 'account_default' && (
        <p className="text-xs text-gray-500">
          将使用账户级推送设置。
          <a
            href="/me/notifications"
            className="ml-1 text-cyan-600 hover:underline"
          >
            前往账户设置调整 →
          </a>
        </p>
      )}
    </div>
  );
}

// ── Tab: 关键词 ────────────────────────────────────────

const MATCH_MODES: { value: RadarMatchMode; label: string; hint: string }[] = [
  {
    value: 'semantic',
    label: '智能语义',
    hint: '仅由 AI 按主题语义评分（默认）',
  },
  {
    value: 'literal',
    label: '精确匹配',
    hint: '标题或正文必须含任一关键词，否则淘汰',
  },
  {
    value: 'hybrid',
    label: '混合加分',
    hint: '命中关键词的内容加分，但不淘汰未命中项',
  },
];

function KeywordsTab({
  draft,
  onChange,
}: {
  draft: RadarTopicConfigDrawerTopic;
  onChange: (p: Partial<RadarTopicConfigDrawerTopic>) => void;
}) {
  const [input, setInput] = useState('');
  const keywords = draft.keywords;
  const atLimit = keywords.length >= KEYWORD_MAX_COUNT;

  // 支持空格 / 逗号（中英）批量粘贴；去重 + 长度 + 上限校验，与后端 normalize 对齐
  const addFromInput = (raw: string) => {
    const parts = raw
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...keywords];
    for (const p of parts) {
      if (p.length > KEYWORD_MAX_LEN) continue;
      if (next.includes(p)) continue;
      if (next.length >= KEYWORD_MAX_COUNT) break;
      next.push(p);
    }
    if (next.length !== keywords.length) onChange({ keywords: next });
    setInput('');
  };

  const removeKeyword = (kw: string) => {
    onChange({ keywords: keywords.filter((k) => k !== kw) });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addFromInput(input);
    } else if (e.key === 'Backspace' && input === '' && keywords.length > 0) {
      removeKeyword(keywords[keywords.length - 1]);
    }
  };

  return (
    <div className="space-y-5">
      {/* 关键词 chip 编辑器 */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label className="block text-sm font-medium text-gray-700">
            关键词
          </label>
          <span className="text-xs text-gray-400">
            {keywords.length}/{KEYWORD_MAX_COUNT}
          </span>
        </div>

        {keywords.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {keywords.map((kw) => (
              <span
                key={kw}
                className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs text-cyan-700"
              >
                {kw}
                <button
                  type="button"
                  onClick={() => removeKeyword(kw)}
                  aria-label={`删除关键词 ${kw}`}
                  className="rounded-full text-cyan-500 hover:bg-cyan-100 hover:text-cyan-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-2 text-xs text-amber-600">
            至少保留 1 个关键词，雷达才能采集与评分
          </p>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={atLimit}
            placeholder={atLimit ? '已达上限' : '输入关键词，回车添加…'}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="button"
            onClick={() => addFromInput(input)}
            disabled={atLimit || !input.trim()}
            aria-label="添加关键词"
            className="inline-flex shrink-0 items-center rounded-lg border border-gray-200 px-3 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          空格 / 逗号分隔可批量添加，最多 {KEYWORD_MAX_COUNT} 个，每个 ≤
          {KEYWORD_MAX_LEN} 字符
        </p>
      </div>

      {/* 匹配模式 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          匹配模式
        </label>
        <div className="space-y-1.5">
          {MATCH_MODES.map((m) => {
            const checked = draft.matchMode === m.value;
            return (
              <label
                key={m.value}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${
                  checked
                    ? 'border-cyan-300 bg-cyan-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="matchMode"
                  checked={checked}
                  onChange={() => onChange({ matchMode: m.value })}
                  className="mt-0.5 h-4 w-4 text-cyan-600 focus:ring-cyan-500"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800">
                    {m.label}
                  </span>
                  <span className="block text-xs text-gray-500">{m.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-gray-400">
          精确 / 混合匹配对标题 +
          正文做大小写不敏感的子串判断，改动在下次「重新精选」生效。
        </p>
      </div>
    </div>
  );
}

// ── Tab 4: 高级 ────────────────────────────────────────

function AdvancedTab({
  draft,
  onChange,
}: {
  draft: RadarTopicConfigDrawerTopic;
  onChange: (p: Partial<RadarTopicConfigDrawerTopic>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* 采集频率 cron */}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          采集频率 (cron)
        </label>
        <input
          type="text"
          value={draft.refreshCron}
          onChange={(e) => onChange({ refreshCron: e.target.value })}
          className="font-mono w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          placeholder="0 */6 * * *"
        />
        <p className="mt-1 text-xs text-gray-400">标准 5 段 cron 表达式</p>
      </div>

      {/* 实体类型锁定 */}
      {draft.entityType && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            实体类型锁定
          </label>
          <span className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-500">
            {draft.entityType}
            <span className="ml-2 text-xs text-gray-400">
              （创建时已锁定，不可修改）
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
