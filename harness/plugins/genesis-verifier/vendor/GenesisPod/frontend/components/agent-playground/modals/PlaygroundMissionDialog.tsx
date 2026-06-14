'use client';

/**
 * PlaygroundMissionDialog
 *
 * Playground 创建 Mission 的精简对话框（替代旧的全页 DemoLauncher）。
 * 视觉上对齐 Topic Insight CreateTopicDialog —— 走 MissionDialogShell 共用壳子，
 * 必填只保留：话题 / 深度 / 语言 / 预算；其余进 advanced 折叠。
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Radar } from 'lucide-react';
import {
  runTeam,
  type AudienceProfile,
  type AuditLayers,
  type LengthProfile,
  type RunMissionInput,
  type SearchTimeRange,
  type StyleProfile,
} from '@/services/agent-playground/api';
import { KnowledgeBaseSelector } from '@/components/common/selectors';
import { MissionDialogShell } from '@/components/common/dialogs/MissionDialogShell';
import {
  BudgetAndTimeLimitPanel,
  MAX_CREDITS_LIMIT,
  MULTIPLIER_LIMIT,
  WALL_TIME_LIMIT_MINUTES,
} from '@/components/agent-playground/panels/BudgetAndTimeLimitPanel';
import { useBudgetTiers, pickTier } from '@/hooks/features/useBudgetTiers';

interface PlaygroundMissionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 创建成功后回调，参数是新 mission id */
  onCreated?: (missionId: string) => void;
}

// 静态兜底标签(仅 fetch 未就绪时用;数值不在此,全部来自 useBudgetTiers)
const DEPTH_LABEL_FALLBACK: Record<RunMissionInput['depth'], string> = {
  quick: '快速',
  standard: '标准',
  deep: '深度',
};

const TIME_RANGE_OPTIONS: Array<{
  value: SearchTimeRange;
  label: string;
}> = [
  { value: '30d', label: '1 月' },
  { value: '90d', label: '3 月' },
  { value: '180d', label: '6 月' },
  { value: '365d', label: '12 月' },
  { value: '730d', label: '24 月' },
  { value: 'all', label: '不限' },
];

const AUDIT_OPTIONS: Array<{
  value: AuditLayers;
  label: string;
}> = [
  { value: 'minimal', label: '最简' },
  { value: 'default', label: '标准' },
  { value: 'thorough', label: '完整' },
  { value: 'thorough+', label: '全审' },
];

const SAMPLE_TOPICS = [
  '2026 Q2 AI Agent 市场格局与竞争力变化',
  '全球存储芯片供需拐点与主要厂商策略',
  '生成式 AI 在金融风控场景的最新成熟度评估',
];

function loadPref<T extends string>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  return (localStorage.getItem(`playground:${key}`) as T | null) ?? fallback;
}

function persistPref(key: string, value: string | number) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`playground:${key}`, String(value));
  }
}

export function PlaygroundMissionDialog({
  isOpen,
  onClose,
  onCreated,
}: PlaygroundMissionDialogProps) {
  const router = useRouter();

  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [depth, setDepth] = useState<RunMissionInput['depth']>(() =>
    loadPref('depth', 'deep' as RunMissionInput['depth'])
  );
  const [language, setLanguage] =
    useState<RunMissionInput['language']>('zh-CN');
  const [styleProfile, setStyleProfile] = useState<StyleProfile>(() =>
    loadPref('styleProfile', 'executive' as StyleProfile)
  );
  const [lengthProfile, setLengthProfile] = useState<LengthProfile>(() =>
    loadPref('lengthProfile', 'standard' as LengthProfile)
  );
  const [audienceProfile, setAudienceProfile] = useState<AudienceProfile>(() =>
    loadPref('audienceProfile', 'domain-expert' as AudienceProfile)
  );
  const [withFigures, setWithFigures] = useState(() =>
    typeof window === 'undefined'
      ? true
      : localStorage.getItem('playground:withFigures') !== '0'
  );
  const [auditLayers, setAuditLayers] = useState<AuditLayers>(() =>
    loadPref('auditLayers', 'default' as AuditLayers)
  );
  const [searchTimeRange, setSearchTimeRange] = useState<SearchTimeRange>(() =>
    loadPref('searchTimeRange', '365d' as SearchTimeRange)
  );
  // ★ 2026-05-22 修知识库污染：不再从 localStorage 读取上次选择 —— 每次新建默认不挂任何
  //   知识库。历史 bug：旧选择（如跑题的「Security」库）被静默带进新主题 → researcher
  //   rag-search 命中跑题内容 → 维度质量崩。知识源必须每次有意识地选。
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  // ★ 2026-05-22 ③J/K 单一源：档位数值全部来自后端（useBudgetTiers），前端无镜像。
  //   自定义预算字段仅在「自定义预算」覆盖开启时使用 + 发送；初始 0，开启时按当前档位灌入。
  const { data: budgetTierData } = useBudgetTiers();
  const [maxCredits, setMaxCredits] = useState<number>(0);
  const [budgetMultiplierOverride, setBudgetMultiplierOverride] =
    useState<number>(0);
  const [wallTimeMinutes, setWallTimeMinutes] = useState<number>(0);
  // 默认不覆盖预算 —— 仅传 depth，由后端按档位解析。
  //   开启「自定义预算」时把当前档位值灌入作为起点（见 onChange），再发送为覆盖。
  const [budgetOverrideEnabled, setBudgetOverrideEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ★ 调研规模档位卡片：label/成本/时长/维度全部来自后端 useBudgetTiers（单一源）。
  //   fetch 未就绪时用 DEPTH_LABEL_FALLBACK 标签 + "加载中…"占位。
  const depthOptions = useMemo(
    () =>
      (['quick', 'standard', 'deep'] as const).map((value) => {
        const t = pickTier(budgetTierData, value);
        return {
          value,
          label: t?.label ?? DEPTH_LABEL_FALLBACK[value],
          hint: t
            ? `约 $${t.capUsd} · ~${t.wallTimeMinutes} 分钟 · ${t.dimensionsHint}`
            : '加载中…',
        };
      }),
    [budgetTierData]
  );

  const isCustomProfile = useMemo(
    () =>
      depth !== 'deep' ||
      styleProfile !== 'executive' ||
      lengthProfile !== 'standard' ||
      audienceProfile !== 'domain-expert' ||
      !withFigures ||
      auditLayers !== 'default' ||
      searchTimeRange !== '365d',
    [
      depth,
      styleProfile,
      lengthProfile,
      audienceProfile,
      withFigures,
      auditLayers,
      searchTimeRange,
    ]
  );

  function resetDefaults() {
    setDepth('deep');
    setStyleProfile('executive');
    setLengthProfile('standard');
    setAudienceProfile('domain-expert');
    setWithFigures(true);
    setAuditLayers('default');
    setSearchTimeRange('365d');
    // ★ 2026-05-22 单一源：关掉自定义预算覆盖；预算字段清 0（仅覆盖开启时才用，按档位灌入）。
    setBudgetOverrideEnabled(false);
    setMaxCredits(0);
    setBudgetMultiplierOverride(0);
    setWallTimeMinutes(0);
    if (typeof window !== 'undefined') {
      [
        'depth',
        // 清掉历史遗留的独立预算持久化键（已不再写入），防止旧值再被读出
        'budgetProfile',
        'styleProfile',
        'lengthProfile',
        'audienceProfile',
        'withFigures',
        'auditLayers',
        'searchTimeRange',
        'maxCredits',
        'budgetMultiplierOverride',
        'wallTimeMinutes',
      ].forEach((k) => localStorage.removeItem(`playground:${k}`));
    }
  }

  async function handleSubmit() {
    const trimmed = topic.trim();
    if (!trimmed) return;
    if (trimmed.length < 4) {
      setError('Topic 至少 4 个字符');
      return;
    }
    // 仅当用户开启「自定义预算」覆盖时才校验这三项；否则后端按 depth 档位解析。
    if (budgetOverrideEnabled) {
      if (
        maxCredits < MAX_CREDITS_LIMIT.min ||
        maxCredits > MAX_CREDITS_LIMIT.max
      ) {
        setError(
          `Credits 上限必须在 ${MAX_CREDITS_LIMIT.min} - ${MAX_CREDITS_LIMIT.max} 之间`
        );
        return;
      }
      if (
        budgetMultiplierOverride < MULTIPLIER_LIMIT.min ||
        budgetMultiplierOverride > MULTIPLIER_LIMIT.max
      ) {
        setError(
          `Agent 倍率必须在 ${MULTIPLIER_LIMIT.min} - ${MULTIPLIER_LIMIT.max} 之间`
        );
        return;
      }
      if (
        wallTimeMinutes < WALL_TIME_LIMIT_MINUTES.min ||
        wallTimeMinutes > WALL_TIME_LIMIT_MINUTES.max
      ) {
        setError(
          `时长上限必须在 ${WALL_TIME_LIMIT_MINUTES.min} - ${WALL_TIME_LIMIT_MINUTES.max} 分钟之间`
        );
        return;
      }
    }
    setError(null);
    setSubmitting(true);
    try {
      const trimmedDescription = description.trim();
      const { missionId } = await runTeam({
        topic: trimmed,
        description:
          trimmedDescription.length > 0 ? trimmedDescription : undefined,
        depth,
        language,
        styleProfile,
        lengthProfile,
        audienceProfile,
        withFigures,
        auditLayers,
        searchTimeRange,
        // ★ 2026-05-22 单一源：默认不传预算 → 后端按 depth 档位解析；
        //   仅「高级·自定义预算」开启时作为覆盖发送。
        ...(budgetOverrideEnabled
          ? {
              maxCredits,
              budgetMultiplierOverride,
              wallTimeCapMs: wallTimeMinutes * 60_000,
            }
          : {}),
        knowledgeBaseIds:
          knowledgeBaseIds.length > 0 ? knowledgeBaseIds : undefined,
      });
      if (!missionId || missionId === 'undefined') {
        throw new Error('Server did not return a missionId');
      }
      setTopic('');
      setDescription('');
      onClose();
      if (onCreated) onCreated(missionId);
      else router.push(`/agent-playground/team/${missionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <MissionDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="新建洞察 Mission"
      subtitle="启动多 Agent 协作的深度洞察任务"
      submitLabel={submitting ? '启动中…' : '启动 Mission'}
      submitting={submitting}
      submitDisabled={!topic.trim()}
      onSubmit={() => {
        void handleSubmit();
      }}
      defaultAdvancedOpen={false}
      error={error}
      footerLeftSlot={
        isCustomProfile ? (
          <button
            type="button"
            onClick={resetDefaults}
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            恢复默认配置
          </button>
        ) : null
      }
      primary={
        <>
          <Field
            label="研究话题"
            required
            hint={topic.length > 0 ? `${topic.length}/200` : undefined}
          >
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：2026 Q2 AI Agent 市场格局与主要厂商竞争力变化"
              maxLength={200}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
              required
            />
            {!topic && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SAMPLE_TOPICS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTopic(s)}
                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </Field>

          <Field
            label="研究描述"
            hintInline="选填——给 Leader 更完整的背景 / 关注角度 / 约束，明显提升维度拆分质量"
            hint={
              description.length > 0 ? `${description.length}/10000` : undefined
            }
          >
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：聚焦头部 5 家厂商（OpenAI / Anthropic / Google / Meta / xAI），不分析中国厂商；重点对比 agent / coding / multimodal 三条产品线的能力差异 + 商业化打法；时间窗口 2026 Q1-Q2。"
              rows={5}
              maxLength={10000}
              className="w-full resize-y rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </Field>

          <Field
            label="调研规模"
            hintInline="预算 / 时长 / 维度数随档位自动匹配，无需手动设置"
          >
            <div className="grid grid-cols-3 gap-2">
              {depthOptions.map((opt) => (
                <SelectableTile
                  key={opt.value}
                  active={depth === opt.value}
                  label={opt.label}
                  hint={opt.hint}
                  onClick={() => {
                    setDepth(opt.value);
                    persistPref('depth', opt.value);
                  }}
                />
              ))}
            </div>
          </Field>

          <Field label="输出语言">
            <select
              value={language}
              onChange={(e) =>
                setLanguage(e.target.value as RunMissionInput['language'])
              }
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </Field>

          {knowledgeBaseIds.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              已挂载 {knowledgeBaseIds.length} 个知识源（在「高级设置 ·
              知识源」管理）。仅当与本主题相关时才保留 ——
              不相关的知识库会污染检索、拉低质量。
            </div>
          )}
        </>
      }
      advanced={
        <>
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/60 px-4 py-3">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span>
                <span className="text-sm font-medium text-gray-700">
                  自定义预算上限
                </span>
                <span className="mt-0.5 block text-xs text-gray-400">
                  {(() => {
                    const t = pickTier(budgetTierData, depth);
                    return t
                      ? `默认按「${t.label}」档位自动匹配（约 $${t.capUsd} · ~${t.wallTimeMinutes} 分钟）。开启后可手动设定 Credits / 倍率 / 时长。`
                      : '默认按当前调研规模档位自动匹配。开启后可手动设定 Credits / 倍率 / 时长。';
                  })()}
                </span>
              </span>
              <input
                type="checkbox"
                checked={budgetOverrideEnabled}
                disabled={!budgetTierData}
                onChange={(e) => {
                  const on = e.target.checked;
                  setBudgetOverrideEnabled(on);
                  // ★ 开启时以当前 depth 档位值（来自后端单一源）为起点，杜绝旧持久化漂移。
                  const tier = pickTier(budgetTierData, depth);
                  if (on && tier) {
                    setMaxCredits(tier.maxCredits);
                    setBudgetMultiplierOverride(tier.budgetMultiplier);
                    setWallTimeMinutes(tier.wallTimeMinutes);
                  }
                }}
                className="mt-0.5 h-4 w-4 flex-shrink-0 accent-blue-600"
              />
            </label>
            {budgetOverrideEnabled && (
              <BudgetAndTimeLimitPanel
                maxCredits={maxCredits}
                setMaxCredits={setMaxCredits}
                budgetMultiplierOverride={budgetMultiplierOverride}
                setBudgetMultiplierOverride={setBudgetMultiplierOverride}
                wallTimeMinutes={wallTimeMinutes}
                setWallTimeMinutes={setWallTimeMinutes}
              />
            )}
          </div>
          <Field label="搜索时效">
            <div className="grid grid-cols-6 gap-1.5">
              {TIME_RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setSearchTimeRange(opt.value);
                    persistPref('searchTimeRange', opt.value);
                  }}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${
                    searchTimeRange === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="审核层级">
            <div className="grid grid-cols-4 gap-1.5">
              {AUDIT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setAuditLayers(opt.value);
                    persistPref('auditLayers', opt.value);
                  }}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-all ${
                    auditLayers === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="文风">
              <select
                value={styleProfile}
                onChange={(e) => {
                  const v = e.target.value as StyleProfile;
                  setStyleProfile(v);
                  persistPref('styleProfile', v);
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="executive">管理层简报</option>
                <option value="academic">学术论证</option>
                <option value="journalistic">新闻型</option>
                <option value="technical">技术型</option>
              </select>
            </Field>
            <Field label="长度档位">
              <select
                value={lengthProfile}
                onChange={(e) => {
                  const v = e.target.value as LengthProfile;
                  setLengthProfile(v);
                  persistPref('lengthProfile', v);
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {/* ★ 2026-05-22 ③L/M：不再写死字数(总字数=depthBase×密度,随 depth 变);
                    只表"密度档"。实际总字数后端单一源 resolveMissionTotalWords。 */}
                <option value="brief">简洁</option>
                <option value="standard">标准（推荐）</option>
                <option value="deep">详细</option>
                <option value="extended">详尽</option>
                <option value="epic">超长</option>
                <option value="mega">极长</option>
              </select>
            </Field>
            <Field label="主要受众">
              <select
                value={audienceProfile}
                onChange={(e) => {
                  const v = e.target.value as AudienceProfile;
                  setAudienceProfile(v);
                  persistPref('audienceProfile', v);
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="domain-expert">领域专家</option>
                <option value="executive">管理层</option>
                <option value="general-public">大众</option>
              </select>
            </Field>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-700">
                图文并茂
              </span>
              <p className="text-xs text-gray-400">
                仅引用真实图片，不使用 AI 生成图
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = !withFigures;
                setWithFigures(next);
                persistPref('withFigures', next ? '1' : '0');
              }}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                withFigures ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  withFigures ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <Field
            label="知识源"
            hintInline="不选则纯 web-search；选了则先 KB 召回再补 web"
          >
            <KnowledgeBaseSelector
              selectedIds={knowledgeBaseIds}
              onSelectionChange={(ids) => setKnowledgeBaseIds(ids)}
              multiple
              maxSelections={10}
              filterType="ALL"
              onlyReady
            />
          </Field>

          {/* 雷达信号是 researcher 运行时自动调用的检索工具（radar-signal-search），
              非创建时挂载项 —— 这里做可见性说明，避免用户以为雷达数据没有参与 */}
          <div className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5">
            <Radar className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600" />
            <p className="text-xs leading-relaxed text-sky-800">
              <span className="font-semibold">雷达信号已自动接入：</span>
              研究员采证时会检索你 AI 雷达话题下的高分近期信号（已过 AI
              双重筛选），作为时效性素材；没有雷达话题时自动回落 web
              检索，无需配置。
            </p>
          </div>
        </>
      }
    />
  );
}

function Field({
  label,
  required,
  hint,
  hintInline,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  hintInline?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
          {hintInline && (
            <span className="ml-2 text-xs font-normal text-gray-400">
              {hintInline}
            </span>
          )}
        </label>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SelectableTile({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-start rounded-lg border-2 px-3 py-2.5 text-left transition-all ${
        active
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      {active && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
      <span
        className={`text-sm font-semibold ${active ? 'text-blue-700' : 'text-gray-800'}`}
      >
        {label}
      </span>
      {hint && (
        <span
          className={`mt-0.5 text-[11px] ${active ? 'text-blue-600' : 'text-gray-500'}`}
        >
          {hint}
        </span>
      )}
    </button>
  );
}
