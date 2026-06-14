'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { LoadingState } from '@/components/ui/states/LoadingState';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  createCard,
  createEdge,
  createTopic,
  extractFromMission,
  fetchInsightMissions,
  type DraftCard,
  type ForesightCard,
  type ForesightLayerDef,
  type ForesightTopic,
  type InsightMissionItem,
} from '@/services/foresight/api';
import { DEFAULT_TOPIC_LAYERS, STAGE_META, layerName } from './foresight-meta';

const fieldCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-gray-700 focus:outline-none';
const labelCls = 'mb-1 block text-xs font-medium text-gray-600';

/** 按层级推荐下一个空闲编号（A-L{n}-{seq}），可手改 */
function suggestKey(cards: ForesightCard[], layer: string): string {
  const seqs = cards
    .filter((c) => c.layer === layer)
    .map((c) => parseInt(c.cardKey.split('-').pop() ?? '0', 10))
    .filter((n) => !Number.isNaN(n));
  const next = (seqs.length ? Math.max(...seqs) : 0) + 1;
  return `A-${layer}-${String(next).padStart(2, '0')}`;
}

function splitLines(v: string): string[] {
  return v
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

interface CreateCardDialogProps {
  open: boolean;
  topicId: string;
  layers: ForesightLayerDef[];
  cards: ForesightCard[];
  onClose: () => void;
  onCreated: () => void;
}

/** 新建假设卡 —— 真实判断资产的手动录入通道（P0） */
export function CreateCardDialog({
  open,
  topicId,
  layers,
  cards,
  onClose,
  onCreated,
}: CreateCardDialogProps) {
  const [layer, setLayer] = useState(layers[0]?.id ?? '');
  const [cardKey, setCardKey] = useState('');
  const [title, setTitle] = useState('');
  const [claim, setClaim] = useState('');
  const [conf, setConf] = useState('0.5');
  const [sens, setSens] = useState('mid');
  const [horizon, setHorizon] = useState('2028');
  const [stage, setStage] = useState('exploring');
  const [evidence, setEvidence] = useState('');
  const [falsifiers, setFalsifiers] = useState('');
  const [sources, setSources] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveKey = cardKey.trim() || suggestKey(cards, layer);

  async function handleSubmit() {
    if (!title.trim() || !claim.trim()) {
      setError('标题与断言为必填');
      return;
    }
    const fals = splitLines(falsifiers);
    if (fals.length === 0) {
      setError(
        '至少写一条证伪信号（falsifier）——写不出"什么情况出现说明这条假设错了"的断言不具备入库资格'
      );
      return;
    }
    const confNum = parseFloat(conf);
    if (Number.isNaN(confNum) || confNum < 0 || confNum > 1) {
      setError('置信度必须在 0–1 之间');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createCard({
        topicId,
        cardKey: effectiveKey,
        layer: layer || layers[0]?.id || '',
        title: title.trim(),
        claim: claim.trim(),
        conf: confNum,
        sens,
        horizon: parseInt(horizon, 10) || 2028,
        stage,
        evidence: splitLines(evidence),
        falsifiers: fals,
        sources: splitLines(sources).flatMap((line) => {
          const [org, t, type, url] = line.split('|').map((s) => s.trim());
          return org && t
            ? [{ org, title: t, type: type || 'report', url: url || '' }]
            : [];
        }),
        originType: 'manual',
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建假设卡"
      subtitle="一条可证伪的判断 — 证伪信号（falsifier）是入库门槛"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? '保存中…' : '入库'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>层级</label>
            <select
              value={layer || layers[0]?.id || ''}
              onChange={(e) => setLayer(e.target.value)}
              className={fieldCls}
            >
              {layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id} {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>编号（留空自动）</label>
            <input
              value={cardKey}
              onChange={(e) => setCardKey(e.target.value)}
              placeholder={effectiveKey}
              className={fieldCls}
            />
          </div>
          <div>
            <label className={labelCls}>代际阶段</label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className={fieldCls}
            >
              {Object.entries(STAGE_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>标题 *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：HBM4 路线图兑现"
            className={fieldCls}
          />
        </div>
        <div>
          <label className={labelCls}>断言 *（具体、可检验，带量化指标）</label>
          <textarea
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={2}
            placeholder="如：HBM4 于 2026–27 量产，2028 单栈达 48GB / 2TB·s 级，供应不构成第一瓶颈。"
            className={fieldCls}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>置信度（0–1）</label>
            <input
              value={conf}
              onChange={(e) => setConf(e.target.value)}
              type="number"
              step="0.05"
              min="0"
              max="1"
              className={fieldCls}
            />
          </div>
          <div>
            <label className={labelCls}>敏感度</label>
            <select
              value={sens}
              onChange={(e) => setSens(e.target.value)}
              className={fieldCls}
            >
              <option value="high">高敏（翻了下游影响大）</option>
              <option value="mid">中敏</option>
              <option value="low">低敏</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Horizon（年份）</label>
            <input
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              type="number"
              min="2024"
              max="2045"
              className={fieldCls}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>
            证伪信号 *（每行一条 — 什么信号出现说明这条假设错了）
          </label>
          <textarea
            value={falsifiers}
            onChange={(e) => setFalsifiers(e.target.value)}
            rows={2}
            placeholder={
              'HBM4 良率爬坡延期超过 2 个季度\n头部买家锁产能造成结构性短缺'
            }
            className={fieldCls}
          />
        </div>
        <div>
          <label className={labelCls}>证据要点（每行一条，选填）</label>
          <textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            rows={2}
            className={fieldCls}
          />
        </div>
        <div>
          <label className={labelCls}>
            信源（每行一条，格式：机构 | 标题 |
            类型(vendor/paper/report/oss/std) | URL，选填）
          </label>
          <textarea
            value={sources}
            onChange={(e) => setSources(e.target.value)}
            rows={2}
            placeholder="SK hynix | HBM4 量产节奏 Newsroom | vendor | https://news.skhynix.com"
            className={fieldCls}
          />
        </div>
      </div>
    </Modal>
  );
}

interface CreateEdgeDialogProps {
  open: boolean;
  topicId: string;
  cards: ForesightCard[];
  /** 预选上游卡（从详情面板进入时） */
  defaultFromKey?: string;
  onClose: () => void;
  onCreated: () => void;
}

/** 新建影响边 —— 跨层影响必须经过量化参数中转，metric 为必填语义 */
export function CreateEdgeDialog({
  open,
  topicId,
  cards,
  defaultFromKey,
  onClose,
  onCreated,
}: CreateEdgeDialogProps) {
  const [fromKey, setFromKey] = useState(defaultFromKey ?? '');
  const [toKey, setToKey] = useState('');
  const [metric, setMetric] = useState('');
  const [type, setType] = useState<'flow' | 'constrain'>('flow');
  const [weight, setWeight] = useState('0.7');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...cards].sort((a, b) => a.cardKey.localeCompare(b.cardKey)),
    [cards]
  );

  async function handleSubmit() {
    if (!fromKey || !toKey || !metric.trim()) {
      setError(
        '上游 / 下游 / 量化参数均为必填 — 不经参数中转的"领域到领域"边没有信息量'
      );
      return;
    }
    if (fromKey === toKey) {
      setError('上下游不能是同一张卡');
      return;
    }
    const w = parseFloat(weight);
    if (Number.isNaN(w) || w < 0.05 || w > 1) {
      setError('传导强度必须在 0.05–1 之间');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createEdge({
        topicId,
        fromKey,
        toKey,
        metric: metric.trim(),
        type,
        weight: w,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建影响边"
      subtitle="影响经由量化参数传导 — 传导强度决定冲击衰减速度"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? '保存中…' : '连接'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>上游假设（变动方）</label>
            <select
              value={fromKey}
              onChange={(e) => setFromKey(e.target.value)}
              className={fieldCls}
            >
              <option value="">选择…</option>
              {sorted.map((c) => (
                <option key={c.id} value={c.cardKey}>
                  {c.cardKey} · {c.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>下游假设（被影响方）</label>
            <select
              value={toKey}
              onChange={(e) => setToKey(e.target.value)}
              className={fieldCls}
            >
              <option value="">选择…</option>
              {sorted.map((c) => (
                <option key={c.id} value={c.cardKey}>
                  {c.cardKey} · {c.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>
            量化传导参数 *（影响通过什么量传导，如"专家并行 EP 通信量"）
          </label>
          <input
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className={fieldCls}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>边类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'flow' | 'constrain')}
              className={fieldCls}
            >
              <option value="flow">影响传导（需求自上而下）</option>
              <option value="constrain">约束反压（物理极限向上）</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>传导强度（0.05–1）</label>
            <input
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              type="number"
              step="0.1"
              min="0.05"
              max="1"
              className={fieldCls}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface CreateTopicDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (topic: ForesightTopic) => void;
}

/** 新建前瞻主题 —— 每个洞察主题是独立工作台，层级本体随主题自定义 */
export function CreateTopicDialog({
  open,
  onClose,
  onCreated,
}: CreateTopicDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [layers, setLayers] = useState<ForesightLayerDef[]>([
    ...DEFAULT_TOPIC_LAYERS,
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchLayer(i: number, patch: Partial<ForesightLayerDef>) {
    setLayers((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l))
    );
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError('主题名称必填');
      return;
    }
    const cleaned = layers
      .map((l) => ({ ...l, id: l.id.trim(), name: l.name.trim() }))
      .filter((l) => l.id && l.name);
    if (cleaned.length === 0) {
      setError('至少定义一个层级 — 层级是图谱泳道与影响传导的骨架');
      return;
    }
    if (new Set(cleaned.map((l) => l.id)).size !== cleaned.length) {
      setError('层级 ID 不能重复');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const topic = await createTopic({
        name: name.trim(),
        description: description.trim() || undefined,
        layers: cleaned,
      });
      onCreated(topic);
      onClose();
      setName('');
      setDescription('');
      setLayers([...DEFAULT_TOPIC_LAYERS]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建前瞻主题"
      subtitle="一个独立的洞察工作台 — 层级本体（泳道）由主题自定义"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? '创建中…' : '创建主题'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        <div>
          <label className={labelCls}>主题名称 *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：创新药出海 / 具身智能供应链 / 下一代能源"
            className={fieldCls}
          />
        </div>
        <div>
          <label className={labelCls}>主题描述（选填）</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="时间窗、范围边界、这个主题要回答的核心问题"
            className={fieldCls}
          />
        </div>
        <div>
          <label className={labelCls}>
            层级本体 *（图谱泳道，从需求侧到物理/约束侧排列；如算力底座用
            业务负载→模型→软件→硬件→芯片→物理底座 六层）
          </label>
          <div className="space-y-2">
            {layers.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={l.id}
                  onChange={(e) => patchLayer(i, { id: e.target.value })}
                  placeholder="ID"
                  className="font-mono w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-gray-700 focus:outline-none"
                />
                <input
                  value={l.name}
                  onChange={(e) => patchLayer(i, { name: e.target.value })}
                  placeholder="层级名称"
                  className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-700 focus:outline-none"
                />
                <input
                  value={l.en ?? ''}
                  onChange={(e) => patchLayer(i, { en: e.target.value })}
                  placeholder="EN（选填）"
                  className="font-mono w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-xs uppercase focus:border-gray-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    setLayers((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="删除层级"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setLayers((prev) => [
                  ...prev,
                  { id: `L${prev.length}`, name: '' },
                ])
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-gray-500 hover:text-gray-700"
            >
              <Plus className="h-3 w-3" />
              添加层级
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface ImportInsightDialogProps {
  open: boolean;
  topicId: string;
  layers: ForesightLayerDef[];
  cards: ForesightCard[];
  onClose: () => void;
  onImported: () => void;
}

/** 从 AI 洞察导入 —— 选已完成 mission，LLM 抽取草稿假设卡，人工审核后入库（P3） */
export function ImportInsightDialog({
  open,
  topicId,
  layers,
  cards,
  onClose,
  onImported,
}: ImportInsightDialogProps) {
  const [missions, setMissions] = useState<InsightMissionItem[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [missionTitle, setMissionTitle] = useState('');
  const [drafts, setDrafts] = useState<DraftCard[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMissions(null);
    setDrafts(null);
    setError(null);
    fetchInsightMissions()
      .then(setMissions)
      .catch((e) => {
        setMissions([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [open]);

  async function handlePick(m: InsightMissionItem) {
    setExtracting(true);
    setError(null);
    try {
      const res = await extractFromMission(topicId, m.id);
      setMissionTitle(res.missionTitle);
      setDrafts(res.drafts);
      setChecked(new Set(res.drafts.map((_, i) => i)));
      if (res.drafts.length === 0) {
        setError(
          '报告中没有抽取到符合纪律的假设卡（falsifier 必填）— 换一份报告试试'
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  async function handleAdmit() {
    if (!drafts) return;
    const selected = drafts.filter((_, i) => checked.has(i));
    if (selected.length === 0) return;
    setSubmitting(true);
    setError(null);
    /* 逐层计数避免同层多张草稿编号撞车 */
    const seqByLayer = new Map<string, number>();
    for (const c of cards) {
      const n = parseInt(c.cardKey.split('-').pop() ?? '0', 10);
      if (!Number.isNaN(n)) {
        seqByLayer.set(c.layer, Math.max(seqByLayer.get(c.layer) ?? 0, n));
      }
    }
    try {
      for (const d of selected) {
        const next = (seqByLayer.get(d.layer) ?? 0) + 1;
        seqByLayer.set(d.layer, next);
        await createCard({
          topicId,
          cardKey: `A-${d.layer}-${String(next).padStart(2, '0')}`,
          layer: d.layer,
          title: d.title,
          claim: d.claim,
          conf: d.conf,
          sens: d.sens,
          horizon: d.horizon,
          stage: d.stage,
          evidence: d.evidence,
          falsifiers: d.falsifiers,
          sources: d.sources,
          originType: 'insight-mission',
        });
      }
      onImported();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCount = drafts
    ? drafts.filter((_, i) => checked.has(i)).length
    : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="从 AI 洞察导入草稿假设卡"
      subtitle={
        drafts
          ? `来自「${missionTitle}」— 审核勾选后入库（originType=insight-mission）`
          : '选择一份已完成的洞察 Mission 报告，AI 按本主题层级本体抽取可证伪的假设卡'
      }
      footer={
        drafts ? (
          <div className="flex w-full items-center justify-between">
            <button
              onClick={() => setDrafts(null)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              重新选择报告
            </button>
            <button
              onClick={() => void handleAdmit()}
              disabled={submitting || selectedCount === 0}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {submitting ? '入库中…' : `入库选中（${selectedCount} 张）`}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {extracting ? (
          <LoadingState
            text="AI 正在按主题层级本体抽取假设卡…"
            className="min-h-40"
          />
        ) : drafts ? (
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <label
                key={i}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:border-gray-400"
              >
                <input
                  type="checkbox"
                  checked={checked.has(i)}
                  onChange={(e) => {
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      return next;
                    });
                  }}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono rounded border border-gray-300 px-1.5 text-xs text-gray-500">
                      {d.layer} {layerName(layers, d.layer)}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">
                      {d.title}
                    </span>
                    <span className="font-mono text-xs text-gray-400">
                      conf {d.conf.toFixed(2)} · {d.sens} · H{d.horizon}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-gray-600">
                    {d.claim}
                  </span>
                  <span className="font-mono mt-1 block text-xs text-red-500">
                    falsifier ×{d.falsifiers.length}：{d.falsifiers[0]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : missions === null ? (
          <LoadingState text="加载已完成的洞察 Mission…" className="min-h-40" />
        ) : missions.length === 0 ? (
          <EmptyState
            size="sm"
            title="没有已完成的洞察 Mission"
            description="先在「AI 洞察」跑一个深度洞察任务，完成后回这里导入结论"
          />
        ) : (
          <div className="space-y-2">
            {missions.map((m) => (
              <button
                key={m.id}
                onClick={() => void handlePick(m)}
                className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left hover:border-gray-500"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900">
                    {m.title}
                  </span>
                  {m.preview && (
                    <span className="mt-0.5 block truncate text-xs text-gray-500">
                      {m.preview}
                    </span>
                  )}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
