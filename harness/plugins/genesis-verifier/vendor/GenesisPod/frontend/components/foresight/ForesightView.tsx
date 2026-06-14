'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Compass,
  GitBranch,
  Inbox,
  Layers as LayersIcon,
  Lightbulb,
  Link2,
  ListChecks,
  Plus,
  Table2,
} from 'lucide-react';
import { Tabs } from '@/components/ui/tabs/Tabs';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states/LoadingState';
import { PageHeaderHero } from '@/components/ui/page-header-hero/PageHeaderHero';
import { AssetCard } from '@/components/ui/cards/asset-card/AssetCard';
import { confirm } from '@/stores';
import {
  deleteTopic,
  updateTopic,
  fetchOverview,
  fetchTopics,
  injectSignal,
  resolveReview,
  scanRadar,
  seedDemo,
  type ForesightOverview,
  type ForesightSignal,
  type ForesightTopic,
} from '@/services/foresight/api';
import { pendingByCard } from './foresight-meta';
import { GraphCanvas } from './GraphCanvas';
import { CardDetailPanel } from './CardDetailPanel';
import { WorkbenchTab } from './WorkbenchTab';
import { ReviewTab } from './ReviewTab';
import { ConclusionsTab } from './ConclusionsTab';
import { LibraryTab } from './LibraryTab';
import {
  CreateCardDialog,
  CreateEdgeDialog,
  CreateTopicDialog,
  ImportInsightDialog,
} from './ForesightDialogs';

/**
 * AI 前瞻主视图 —— 多主题判断资产。
 * 落地页 = 主题卡片画廊（全站惯例，AssetCard）；点卡进入主题工作台。
 * 主题 = 独立洞察工作台（算力底座只是其中之一），层级本体随主题自定义；
 * 工作台 Tab IA 按 Owner 一日巡检动线：工作台 → 判断图谱 → 假设库 → 复核 → 洞察结论。
 */
export function ForesightView() {
  const [topics, setTopics] = useState<ForesightTopic[] | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [overview, setOverview] = useState<ForesightOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('workbench');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [injecting, setInjecting] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [createCardOpen, setCreateCardOpen] = useState(false);
  const [createEdgeOpen, setCreateEdgeOpen] = useState(false);
  const [createTopicOpen, setCreateTopicOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadTopics = useCallback(async (): Promise<ForesightTopic[]> => {
    try {
      const list = await fetchTopics();
      setTopics(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTopics([]);
      return [];
    }
  }, []);

  const loadOverview = useCallback(async (tid: string) => {
    try {
      setError(null);
      const data = await fetchOverview(tid);
      setOverview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /* 启动：取主题列表，落在画廊（全站惯例：列表页是入口，不自动进上次主题） */
  useEffect(() => {
    void (async () => {
      await loadTopics();
      setLoading(false);
    })();
  }, [loadTopics]);

  /* 进入主题：拉工作台数据 + 清选中 */
  useEffect(() => {
    if (!topicId) return;
    setOverview(null);
    setSelectedId(null);
    setTab('workbench');
    void loadOverview(topicId);
  }, [topicId, loadOverview]);

  const reload = useCallback(async () => {
    if (topicId) await loadOverview(topicId);
  }, [topicId, loadOverview]);

  const pending = useMemo(
    () => pendingByCard(overview?.reviewItems ?? []),
    [overview]
  );

  const impactedConclusions = useMemo(() => {
    if (!overview) return [];
    const pendingKeys = new Set(
      overview.cards.filter((c) => pending.has(c.id)).map((c) => c.cardKey)
    );
    return overview.conclusions.filter((cc) =>
      cc.upstreamKeys.some((k) => pendingKeys.has(k))
    );
  }, [overview, pending]);

  const impactedKeys = useMemo(
    () => new Set(impactedConclusions.map((c) => c.conclKey)),
    [impactedConclusions]
  );

  const pendingCount = useMemo(
    () =>
      (overview?.reviewItems ?? []).filter((r) => r.status === 'pending')
        .length,
    [overview]
  );

  const selectCard = useCallback((cardId: string) => {
    setSelectedId(cardId);
    setTab('graph');
  }, []);

  const selectCardKey = useCallback(
    (cardKey: string) => {
      const card = overview?.cards.find((c) => c.cardKey === cardKey);
      if (card) selectCard(card.id);
    },
    [overview, selectCard]
  );

  const handleInject = useCallback(
    async (signal: ForesightSignal) => {
      setInjecting(signal.id);
      try {
        await injectSignal(signal.id);
        await reload();
        setTab('graph');
        setSelectedId(signal.targetCardId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setInjecting(null);
      }
    },
    [reload]
  );

  const handleResolve = useCallback(
    async (itemId: string, decision: 'adjust' | 'keep') => {
      setResolving(itemId);
      try {
        await resolveReview(itemId, decision);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setResolving(null);
      }
    },
    [reload]
  );

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const res = (await seedDemo()) as { topicId?: string };
      const list = await loadTopics();
      const next =
        res.topicId ?? list[list.length - 1]?.id ?? list[0]?.id ?? null;
      if (next) setTopicId(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }, [loadTopics]);

  const handleScanRadar = useCallback(async () => {
    if (!topicId) return;
    setScanning(true);
    setNotice(null);
    setError(null);
    try {
      const res = await scanRadar(topicId);
      await reload();
      setNotice(
        res.scanned === 0
          ? '雷达没有可扫描的近期信号 — 先在「AI 雷达」订阅与主题相关的话题源'
          : `扫描完成：候选 ${res.scanned} 条 · 命中 falsifier ${res.matched} 条 · 新建信号 ${res.created} 条${res.created === 0 ? '（无新命中或已存在）' : '，见信号收件箱'}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [topicId, reload]);

  const handleTopicCreated = useCallback(
    async (topic: ForesightTopic) => {
      await loadTopics();
      setTopicId(topic.id);
    },
    [loadTopics]
  );

  const handleRenameTopic = useCallback(
    async (topic: ForesightTopic) => {
      const next = window.prompt('主题名称', topic.name);
      if (!next || next.trim() === topic.name) return;
      try {
        await updateTopic(topic.id, { name: next.trim() });
        await loadTopics();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadTopics]
  );

  const handleDeleteTopic = useCallback(
    async (topic: ForesightTopic) => {
      const ok = await confirm({
        title: `删除主题「${topic.name}」？`,
        description: '其下全部假设卡、影响边、信号与结论将一并删除，不可恢复。',
        type: 'danger',
      });
      if (!ok) return;
      try {
        await deleteTopic(topic.id);
        await loadTopics();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadTopics]
  );

  if (loading || topics === null) {
    return <LoadingState text="加载前瞻主题…" className="min-h-96" />;
  }

  /* 无任何主题：引导建第一个工作台 */
  if (topics.length === 0) {
    return (
      <div className="flex min-h-96 items-center justify-center p-8">
        <EmptyState
          icon={<Compass className="h-12 w-12" />}
          title="AI 前瞻 · 判断资产"
          description={
            error ??
            '每个洞察主题是一个独立工作台：自定义层级本体、假设图谱、信号与复核。从空白主题开始，或先载入示例感受完整方法论。'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => setCreateTopicOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                <Plus className="h-4 w-4" />
                新建洞察主题
              </button>
              <button
                onClick={() => void handleSeed()}
                disabled={seeding}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {seeding ? '载入中…' : '载入示例主题（下一代算力底座）'}
              </button>
            </div>
          }
        />
        <CreateTopicDialog
          open={createTopicOpen}
          onClose={() => setCreateTopicOpen(false)}
          onCreated={(t) => void handleTopicCreated(t)}
        />
      </div>
    );
  }

  /* ── 主题画廊（落地页，全站卡片惯例） ── */
  if (!topicId) {
    return (
      <div className="pb-10">
        <PageHeaderHero
          title="AI 前瞻"
          subtitle="多主题判断资产 — 每个洞察主题是一个独立工作台"
          icon={<Compass className="h-7 w-7 text-white" />}
          module="research"
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSeed()}
                disabled={seeding}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                {seeding ? '载入中…' : '载入示例主题'}
              </button>
              <button
                type="button"
                onClick={() => setCreateTopicOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
              >
                <Plus className="h-4 w-4" />
                新建洞察主题
              </button>
            </div>
          }
        />
        <div className="px-8">
          {error && (
            <p className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {topics.map((t) => (
              <AssetCard
                key={t.id}
                title={t.name}
                description={
                  t.description ??
                  '点击进入工作台：假设图谱 / 信号检验 / 复核 / 决策结论'
                }
                icon={<Compass className="h-6 w-6 text-white" />}
                gradient="from-amber-500 to-orange-600"
                stats={[
                  {
                    key: 'cards',
                    icon: <Table2 className="h-3.5 w-3.5" />,
                    text: `${t.cardCount ?? 0} 假设`,
                  },
                  {
                    key: 'layers',
                    icon: <LayersIcon className="h-3.5 w-3.5" />,
                    text: `${t.layers.length} 层级`,
                  },
                ]}
                isOwner
                onEdit={() => void handleRenameTopic(t)}
                onDelete={() => void handleDeleteTopic(t)}
                onClick={() => setTopicId(t.id)}
              />
            ))}
          </div>
        </div>
        <CreateTopicDialog
          open={createTopicOpen}
          onClose={() => setCreateTopicOpen(false)}
          onCreated={(t) => void handleTopicCreated(t)}
        />
      </div>
    );
  }

  /* ── 主题工作台 ── */
  const layers = overview?.topic.layers ?? [];
  const selectedCard = overview?.cards.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="pb-10">
      <PageHeaderHero
        title={overview?.topic.name ?? 'AI 前瞻'}
        subtitle={
          overview?.topic.description ??
          '判断资产工作台 — 信号驱动复核，跨层影响衰减传播'
        }
        icon={<LayersIcon className="h-7 w-7 text-white" />}
        module="research"
        onBack={() => setTopicId(null)}
        backLabel="返回主题列表"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateEdgeOpen(true)}
              disabled={!overview}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <Link2 className="h-4 w-4" />
              新建影响边
            </button>
            <button
              type="button"
              onClick={() => setCreateCardOpen(true)}
              disabled={!overview}
              className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              新建假设卡
            </button>
          </div>
        }
      />
      <div className="px-8">
        {error && (
          <p className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-3 border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-700">
            {notice}
          </p>
        )}

        {!overview ? (
          <LoadingState text="加载判断资产…" className="min-h-64" />
        ) : (
          <>
            <div className="font-mono mb-4 flex justify-end gap-4 text-xs text-gray-500">
              <span>
                假设 <b className="text-gray-900">{overview.cards.length}</b>
              </span>
              <span>
                影响边 <b className="text-gray-900">{overview.edges.length}</b>
              </span>
              <span>
                待复核{' '}
                <b
                  className={
                    pendingCount > 0 ? 'text-amber-600' : 'text-gray-900'
                  }
                >
                  {pendingCount}
                </b>
              </span>
            </div>

            <Tabs
              value={tab}
              onChange={setTab}
              className="mb-5 border-b border-gray-200"
              items={[
                { key: 'workbench', label: '工作台', icon: Inbox },
                { key: 'graph', label: '判断图谱', icon: GitBranch },
                { key: 'library', label: '假设库', icon: Table2 },
                {
                  key: 'review',
                  label: '复核',
                  icon: ListChecks,
                  count: pendingCount > 0 ? pendingCount : undefined,
                },
                { key: 'conclusions', label: '洞察结论', icon: Lightbulb },
              ]}
            />

            {tab === 'workbench' && (
              <WorkbenchTab
                overview={overview}
                layers={layers}
                pending={pending}
                impactedConclusions={impactedConclusions}
                injecting={injecting}
                scanning={scanning}
                onInject={(s) => void handleInject(s)}
                onScanRadar={() => void handleScanRadar()}
                onOpenImport={() => setImportOpen(true)}
                onGoTab={setTab}
                onSelectCard={selectCard}
              />
            )}

            {tab === 'graph' && (
              <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
                <div className="min-w-0">
                  <p className="font-mono mb-2 text-xs text-gray-400">
                    边粗细 = 传导强度 · 点击卡片查看血缘与详情 ·
                    传播冲击度沿边权连乘衰减（阈值 0.30）
                  </p>
                  {overview.cards.length === 0 ? (
                    <EmptyState
                      title="主题还没有假设卡"
                      description="点右上角「新建假设卡」录入第一条可证伪的判断 — falsifier 是入库门槛"
                    />
                  ) : (
                    <GraphCanvas
                      cards={overview.cards}
                      edges={overview.edges}
                      layers={layers}
                      pending={pending}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                    />
                  )}
                </div>
                <aside className="xl:sticky xl:top-4 xl:max-h-screen xl:overflow-y-auto">
                  <div className="border border-gray-300 bg-white p-4 shadow-sm">
                    {selectedCard ? (
                      <CardDetailPanel
                        card={selectedCard}
                        cards={overview.cards}
                        edges={overview.edges}
                        layers={layers}
                        onSelect={setSelectedId}
                      />
                    ) : (
                      <EmptyState
                        size="sm"
                        title="点击图谱中任意假设卡片"
                        description="查看完整断言 / 信源 / 证伪信号 / 情景 / 账本 / 上下游血缘"
                      />
                    )}
                  </div>
                </aside>
              </div>
            )}

            {tab === 'library' && (
              <LibraryTab
                overview={overview}
                layers={layers}
                pending={pending}
                onSelectCard={selectCard}
              />
            )}

            {tab === 'review' && (
              <ReviewTab
                overview={overview}
                resolving={resolving}
                onResolve={(id, d) => void handleResolve(id, d)}
                onSelectCard={selectCard}
              />
            )}

            {tab === 'conclusions' && (
              <ConclusionsTab
                overview={overview}
                impactedKeys={impactedKeys}
                onSelectCardKey={selectCardKey}
              />
            )}
          </>
        )}
      </div>

      {overview && topicId && (
        <>
          <CreateCardDialog
            open={createCardOpen}
            topicId={topicId}
            layers={layers}
            cards={overview.cards}
            onClose={() => setCreateCardOpen(false)}
            onCreated={() => void reload()}
          />
          <CreateEdgeDialog
            open={createEdgeOpen}
            topicId={topicId}
            cards={overview.cards}
            onClose={() => setCreateEdgeOpen(false)}
            onCreated={() => void reload()}
          />
          <ImportInsightDialog
            open={importOpen}
            topicId={topicId}
            layers={layers}
            cards={overview.cards}
            onClose={() => setImportOpen(false)}
            onImported={() => void reload()}
          />
        </>
      )}
    </div>
  );
}
