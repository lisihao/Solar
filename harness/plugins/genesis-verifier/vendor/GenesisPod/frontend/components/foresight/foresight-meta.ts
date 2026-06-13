import type {
  ForesightCard,
  ForesightEdge,
  ForesightLayerDef,
  ForesightReviewItem,
} from '@/services/foresight/api';

/** 新建主题时的默认层级模板（通用四层；层级本体随主题自定义） */
export const DEFAULT_TOPIC_LAYERS: ForesightLayerDef[] = [
  { id: 'L0', name: '需求与场景', en: 'DEMAND' },
  { id: 'L1', name: '产品与应用', en: 'PRODUCT' },
  { id: 'L2', name: '技术与系统', en: 'TECHNOLOGY' },
  { id: 'L3', name: '基础设施', en: 'INFRA' },
];

export function layerName(layers: ForesightLayerDef[], id: string): string {
  return layers.find((l) => l.id === id)?.name ?? id;
}

export const STAGE_META: Record<string, { label: string; cls: string }> = {
  current: { label: '当前落地', cls: 'border-emerald-600 text-emerald-700' },
  evolving: { label: '演进中', cls: 'border-sky-600 text-sky-700' },
  exploring: { label: '探索验证', cls: 'border-amber-600 text-amber-700' },
  research: { label: '研究前沿', cls: 'border-violet-600 text-violet-700' },
};

export const STAGE_BAR_CLS: Record<string, string> = {
  current: 'bg-emerald-600',
  evolving: 'bg-sky-600',
  exploring: 'bg-amber-600',
  research: 'bg-violet-600',
};

export const SENS_META: Record<string, { label: string; cls: string }> = {
  high: { label: '高敏', cls: 'border-red-400 bg-red-50 text-red-600' },
  mid: { label: '中敏', cls: 'border-amber-400 bg-amber-50 text-amber-700' },
  low: { label: '低敏', cls: 'border-gray-300 bg-gray-50 text-gray-500' },
};

export const SOURCE_TYPE_META: Record<string, { label: string; cls: string }> =
  {
    vendor: { label: '厂商', cls: 'border-sky-400 text-sky-700' },
    paper: { label: '论文', cls: 'border-emerald-400 text-emerald-700' },
    report: { label: '研报', cls: 'border-amber-400 text-amber-700' },
    oss: { label: '开源', cls: 'border-violet-400 text-violet-700' },
    std: { label: '标准', cls: 'border-gray-300 text-gray-600' },
  };

export interface CardPendingState {
  impact: number;
  isSource: boolean;
}

/** 每张卡当前的待复核状态（取最大冲击，源命中优先） */
export function pendingByCard(
  items: ForesightReviewItem[]
): Map<string, CardPendingState> {
  const map = new Map<string, CardPendingState>();
  for (const it of items) {
    if (it.status !== 'pending') continue;
    const prev = map.get(it.cardId);
    if (!prev || it.isSource || it.impact > prev.impact) {
      map.set(it.cardId, {
        impact: it.impact,
        isSource: it.isSource || (prev?.isSource ?? false),
      });
    }
  }
  return map;
}

export interface Adjacency {
  out: Map<string, ForesightEdge[]>;
  inn: Map<string, ForesightEdge[]>;
}

export function buildAdjacency(edges: ForesightEdge[]): Adjacency {
  const out = new Map<string, ForesightEdge[]>();
  const inn = new Map<string, ForesightEdge[]>();
  for (const e of edges) {
    const outList = out.get(e.fromCardId) ?? [];
    outList.push(e);
    out.set(e.fromCardId, outList);
    const inList = inn.get(e.toCardId) ?? [];
    inList.push(e);
    inn.set(e.toCardId, inList);
  }
  return { out, inn };
}

/** 沿方向 BFS，返回可达节点集合（含起点）与经过的边 id 集合 */
export function bfsReach(
  start: string,
  adj: Map<string, ForesightEdge[]>,
  nextOf: (e: ForesightEdge) => string
): { nodes: Set<string>; edgeIds: Set<string> } {
  const nodes = new Set<string>([start]);
  const edgeIds = new Set<string>();
  let frontier = [start];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of adj.get(id) ?? []) {
        edgeIds.add(e.id);
        const n = nextOf(e);
        if (!nodes.has(n)) {
          nodes.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return { nodes, edgeIds };
}

export function cardByIdMap(
  cards: ForesightCard[]
): Map<string, ForesightCard> {
  return new Map(cards.map((c) => [c.id, c]));
}
