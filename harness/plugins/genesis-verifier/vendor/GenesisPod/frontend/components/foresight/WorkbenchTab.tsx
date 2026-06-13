'use client';

import { Radar, Zap } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { EmptyState } from '@/components/ui/states/EmptyState';
import type {
  ForesightConclusion,
  ForesightLayerDef,
  ForesightOverview,
  ForesightSignal,
} from '@/services/foresight/api';
import {
  SENS_META,
  STAGE_BAR_CLS,
  STAGE_META,
  type CardPendingState,
} from './foresight-meta';

interface WorkbenchTabProps {
  overview: ForesightOverview;
  layers: ForesightLayerDef[];
  pending: Map<string, CardPendingState>;
  impactedConclusions: ForesightConclusion[];
  injecting: string | null;
  scanning: boolean;
  onInject: (signal: ForesightSignal) => void;
  onScanRadar: () => void;
  onOpenImport: () => void;
  onGoTab: (tab: string) => void;
  onSelectCard: (cardId: string) => void;
}

function SectionHead({
  no,
  title,
  note,
}: {
  no: string;
  title: string;
  note: string;
}) {
  return (
    <div className="mb-3 mt-7 flex flex-wrap items-baseline gap-3 border-b border-gray-300 pb-2 first:mt-0">
      <span className="text-xl font-bold text-amber-600">{no}</span>
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      <span className="ml-auto text-xs text-gray-500">{note}</span>
    </div>
  );
}

/** 工作台 —— Owner 一日巡检动线：① 今日入站 → ② 待我处理 → ③ 体系状态 */
export function WorkbenchTab({
  overview,
  layers,
  pending,
  impactedConclusions,
  injecting,
  scanning,
  onInject,
  onScanRadar,
  onOpenImport,
  onGoTab,
  onSelectCard,
}: WorkbenchTabProps) {
  const { cards, edges, signals, reviewItems, conclusions } = overview;
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const pendingItems = reviewItems
    .filter((r) => r.status === 'pending')
    .sort((a, b) => (b.isSource ? 2 : b.impact) - (a.isSource ? 2 : a.impact));
  const candidates = signals.filter((s) => s.status === 'candidate');
  const forkCards = cards.filter((c) => c.scenarios && c.scenarios.length > 0);

  const kpis = [
    {
      n: cards.length,
      label: '假设资产',
      hint: '判断卡片总量',
      tab: 'library',
    },
    { n: edges.length, label: '影响边', hint: '经量化参数传导', tab: 'graph' },
    {
      n: pendingItems.length,
      label: '待复核',
      hint: pendingItems.length > 0 ? '信号冲击待裁定' : '全部裁定完毕',
      tab: 'review',
      warn: pendingItems.length > 0,
    },
    {
      n: impactedConclusions.length,
      label: '受冲击结论',
      hint: impactedConclusions.length > 0 ? '依赖假设被动摇' : '结论层稳固',
      tab: 'conclusions',
      danger: impactedConclusions.length > 0,
    },
    {
      n: candidates.filter((s) => s.grade === 'strong').length,
      label: '待注入强信号',
      hint: `候选信号共 ${candidates.length} 条`,
      tab: 'overview',
      warn: candidates.some((s) => s.grade === 'strong'),
    },
  ];

  return (
    <div>
      <SectionHead
        no="①"
        title="今日入站"
        note="巡检起点：命中预登记证伪条件的强信号在此等你查验注入"
      />
      <div className="border border-gray-300 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2.5">
          <span className="bg-sky-700 px-2 py-0.5 text-xs font-bold text-white">
            信号
          </span>
          <span className="text-sm font-bold">信号收件箱</span>
          <span className="font-mono text-xs text-gray-500">
            候选 {candidates.length} 条
          </span>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onScanRadar}
              disabled={scanning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
            >
              <Radar className="h-3.5 w-3.5" />
              {scanning ? '扫描中…' : '扫描雷达信号'}
            </button>
            <button
              type="button"
              onClick={onOpenImport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
            >
              <Zap className="h-3.5 w-3.5" />从 AI 洞察导入
            </button>
          </span>
        </div>
        {candidates.length === 0 ? (
          <EmptyState
            size="sm"
            title="暂无候选信号"
            description="点「扫描雷达信号」用 AI 把雷达近期资讯与本主题的 falsifier 匹配；命中的在此入列。也可「从 AI 洞察导入」把 mission 报告抽取为草稿假设卡。"
          />
        ) : (
          candidates.map((s) => {
            const target = cardById.get(s.targetCardId);
            return (
              <div
                key={s.id}
                className="flex items-start gap-3 border-b border-dashed border-gray-200 px-4 py-3 last:border-b-0"
              >
                <span
                  className={cn(
                    'font-mono mt-0.5 shrink-0 border px-2 py-0.5 text-xs font-semibold',
                    s.grade === 'strong'
                      ? 'border-red-600 bg-red-600 text-white'
                      : 'border-amber-400 bg-amber-50 text-amber-700'
                  )}
                >
                  {s.grade === 'strong' ? '强信号' : '弱信号'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">
                    {s.name}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                    命中{' '}
                    {target && (
                      <button
                        onClick={() => onSelectCard(target.id)}
                        className="font-mono border border-gray-300 bg-white px-1.5 text-xs text-gray-600 hover:border-gray-500"
                      >
                        {target.cardKey} · {target.title}
                      </button>
                    )}{' '}
                    的预登记条件「{s.basis.falsifier ?? '—'}」 ·{' '}
                    {s.basis.gradeNote ?? ''}
                  </p>
                  <p className="font-mono mt-0.5 text-xs text-gray-400">
                    阈值：{s.basis.threshold ?? '—'} · 观测：
                    {s.basis.observed ?? '—'}
                  </p>
                </div>
                {s.grade === 'strong' ? (
                  <button
                    onClick={() => onInject(s)}
                    disabled={injecting === s.id}
                    className="shrink-0 bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <Zap className="mr-1 inline h-3 w-3" />
                    {injecting === s.id ? '传播中…' : '注入并传播'}
                  </button>
                ) : (
                  <span className="font-mono shrink-0 text-right text-xs leading-relaxed text-gray-400">
                    仅标记关注
                    <br />
                    不触发传播
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      <SectionHead
        no="②"
        title="待我处理"
        note="信号冲击产生的复核待办 — 按冲击度降序"
      />
      <div className="border border-gray-300 bg-white p-4 shadow-sm">
        {pendingItems.length === 0 ? (
          <p className="py-3 text-center text-xs text-gray-400">
            当前无待办 — 注入强信号后，受冲击假设会在这里排队等你裁定
          </p>
        ) : (
          <>
            {pendingItems.slice(0, 3).map((r) => {
              const c = cardById.get(r.cardId);
              if (!c) return null;
              return (
                <button
                  key={r.id}
                  onClick={() => onSelectCard(c.id)}
                  className="flex w-full items-center gap-3 border-b border-dashed border-gray-200 py-2 text-left hover:bg-gray-50"
                >
                  <span className="font-mono w-20 shrink-0 text-xs text-gray-400">
                    {c.cardKey}
                  </span>
                  <span className="flex-1 text-sm font-semibold text-gray-800">
                    {c.title}
                  </span>
                  <span
                    className={cn(
                      'font-mono border px-1.5 text-xs',
                      SENS_META[c.sens]?.cls
                    )}
                  >
                    {SENS_META[c.sens]?.label}
                  </span>
                  <span className="font-mono text-xs text-gray-500">
                    {r.isSource ? '信号命中' : `冲击 ${r.impact.toFixed(2)}`}
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => onGoTab('review')}
              className="mt-3 bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              去复核处理（{pendingItems.length} 项待裁定）
            </button>
          </>
        )}
      </div>

      <SectionHead
        no="③"
        title="体系状态"
        note="判断资产健康度 — 一眼看出哪一层在晃"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {kpis.map((k) => (
          <button
            key={k.label}
            onClick={() => onGoTab(k.tab)}
            className="border border-gray-300 bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-500"
          >
            <span
              className={cn(
                'block text-2xl font-bold tabular-nums',
                k.danger
                  ? 'text-red-600'
                  : k.warn
                    ? 'text-amber-600'
                    : 'text-gray-900'
              )}
            >
              {k.n}
            </span>
            <span className="font-mono mt-1 block text-xs uppercase tracking-wider text-gray-400">
              {k.label}
            </span>
            <span className="block text-xs text-gray-500">{k.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="border border-gray-300 bg-white shadow-sm">
          <div className="font-mono border-b border-gray-200 px-4 py-2.5 text-xs uppercase tracking-widest text-gray-500">
            分层健康度 Layer Health
          </div>
          <div className="p-4">
            {layers.map((layer) => {
              const cs = cards.filter((c) => c.layer === layer.id);
              if (cs.length === 0) return null;
              const avg = cs.reduce((s, c) => s + c.conf, 0) / cs.length;
              const dirty = cs.filter((c) => pending.has(c.id)).length;
              return (
                <div
                  key={layer.id}
                  className="flex items-center gap-3 border-b border-dashed border-gray-100 py-2 last:border-b-0"
                >
                  <span className="w-7 font-bold text-amber-600">
                    {layer.id}
                  </span>
                  <span className="w-20 text-xs font-semibold">
                    {layer.name}
                  </span>
                  <span className="h-1.5 flex-1 bg-gray-100">
                    <span
                      className="block h-full bg-amber-500"
                      style={{ width: `${avg * 100}%` }}
                    />
                  </span>
                  <span className="font-mono w-16 text-right text-xs text-gray-500">
                    conf {avg.toFixed(2)}
                  </span>
                  <span
                    className={cn(
                      'font-mono w-16 border px-1 text-center text-xs',
                      dirty > 0
                        ? 'border-amber-500 bg-amber-500 font-semibold text-white'
                        : 'border-emerald-300 text-emerald-700'
                    )}
                  >
                    {dirty > 0 ? `${dirty} 待复核` : '稳固'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border border-gray-300 bg-white shadow-sm">
          <div className="font-mono flex items-center gap-2 border-b border-gray-200 px-4 py-2.5 text-xs uppercase tracking-widest text-gray-500">
            <Radar className="h-3.5 w-3.5 text-violet-600" />
            情景分叉卡 Scenario Forks
          </div>
          <div className="p-4">
            {forkCards.length === 0 ? (
              <p className="py-3 text-center text-xs text-gray-400">
                暂无情景分叉卡
              </p>
            ) : (
              forkCards.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelectCard(c.id)}
                  className="block w-full border-b border-dashed border-gray-100 py-2 text-left last:border-b-0 hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn('h-2 w-2 shrink-0', STAGE_BAR_CLS[c.stage])}
                    />
                    <span className="font-mono text-xs text-gray-400">
                      {c.cardKey}
                    </span>
                    <span className="text-sm font-semibold text-gray-800">
                      {c.title}
                    </span>
                    <span className="font-mono ml-auto border border-violet-400 px-1 text-xs text-violet-700">
                      {STAGE_META[c.stage]?.label}
                    </span>
                  </span>
                  {(c.scenarios ?? []).map((s, i) => (
                    <span
                      key={i}
                      className="mt-1 flex items-center gap-2 pl-4 text-xs text-gray-600"
                    >
                      <span className="w-36 shrink-0">{s.scenario}</span>
                      <span className="h-1 flex-1 bg-gray-100">
                        <span
                          className="block h-full bg-violet-500"
                          style={{ width: `${s.conf * 100}%` }}
                        />
                      </span>
                      <span className="font-mono w-9 text-right text-violet-700">
                        {s.conf.toFixed(2)}
                      </span>
                    </span>
                  ))}
                </button>
              ))
            )}
            {conclusions.length > 0 && (
              <p className="mt-3 border-t border-dashed border-gray-200 pt-2 text-xs text-gray-500">
                {impactedConclusions.length > 0
                  ? `${impactedConclusions.length} 条决策结论受冲击待复核 — 去「洞察结论」查看`
                  : `${conclusions.length} 条决策级结论全部稳固`}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
