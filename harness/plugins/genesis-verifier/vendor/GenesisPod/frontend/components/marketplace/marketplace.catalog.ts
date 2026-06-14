/**
 * 智能体市场货架数据 —— 由 useMarketplaceCatalog 从后端加载后写入。
 *
 * 原始 M0 硬编码数组已移除。ALL_LISTINGS 和 findListing 均从模块级缓存读取，
 * 加载前返回空列表 / undefined；调用方已使用可选链，不会因此崩溃。
 *
 * 设计：模块级单例缓存（非 Zustand store），避免为只需同步读取的场景引入
 * 订阅开销。useMarketplaceCatalog hook 在 data 返回后调用 setMarketplaceCatalog
 * 写入，MarketplaceView 重渲染后各组件从 ALL_LISTINGS / findListing 取到真实数据。
 */

import type {
  AgentListing,
  AnyListing,
  ListingKind,
  SkillListing,
  TeamListing,
  ToolListing,
  WorkflowListing,
} from './marketplace.types';

// ─── 模块级 catalog 缓存 ──────────────────────────────────────────────────────

export interface CatalogStore {
  team: TeamListing[];
  agent: AgentListing[];
  skill: SkillListing[];
  tool: ToolListing[];
  workflow: WorkflowListing[];
}

let _catalog: CatalogStore = {
  team: [],
  agent: [],
  skill: [],
  tool: [],
  workflow: [],
};

// ─── 轻量订阅（useSyncExternalStore 用）─────────────────────────────────────────
// 之前 _catalog 是纯模块变量，setMarketplaceCatalog 写入后不触发任何重渲染，
// 导致"首次进入市场全部显示 0、点一下 Tab 才出数据"。加最小订阅让读取方可响应。

type CatalogSubscriber = () => void;
const _subscribers = new Set<CatalogSubscriber>();

/** 订阅 catalog 变更；返回退订函数。供 useSyncExternalStore 使用。 */
export function subscribeCatalog(cb: CatalogSubscriber): () => void {
  _subscribers.add(cb);
  return () => {
    _subscribers.delete(cb);
  };
}

/** 当前 catalog 的稳定快照引用（未变更时返回同一引用，满足 useSyncExternalStore）。 */
export function getCatalogSnapshot(): CatalogStore {
  return _catalog;
}

/** 由 useMarketplaceCatalog 在数据就绪后调用，写入适配后的 catalog 并通知订阅者。 */
export function setMarketplaceCatalog(catalog: CatalogStore): void {
  _catalog = catalog;
  _subscribers.forEach((cb) => cb());
}

// ─── 公共访问器 ───────────────────────────────────────────────────────────────

/**
 * 当前所有货架的 snapshot（按 kind 分组）。
 * 注：加载完成前各列表为空数组。
 */
export function getAllListings(): Record<ListingKind, AnyListing[]> {
  return {
    team: _catalog.team,
    agent: _catalog.agent,
    skill: _catalog.skill,
    tool: _catalog.tool,
    workflow: _catalog.workflow,
  };
}

/**
 * 按 id 反查任意 listing（详情/装配用）。
 * 加载前或 id 不存在时返回 undefined；调用方需用可选链。
 */
export function findListing(id: string): AnyListing | undefined {
  return (
    _catalog.team.find((x) => x.id === id) ??
    _catalog.agent.find((x) => x.id === id) ??
    _catalog.skill.find((x) => x.id === id) ??
    _catalog.tool.find((x) => x.id === id) ??
    _catalog.workflow.find((x) => x.id === id)
  );
}

/**
 * ALL_LISTINGS —— 向后兼容的对象形式访问器。
 *
 * 用法：ALL_LISTINGS[kind] 或 ALL_LISTINGS.agent
 * 每次读取时返回当前 _catalog 快照（非 reactive，但 MarketplaceView 加载完后
 * 会整体重渲染，届时读到真实数据）。
 */
export const ALL_LISTINGS: Record<ListingKind, AnyListing[]> = new Proxy(
  {} as Record<ListingKind, AnyListing[]>,
  {
    get(_target, prop: string) {
      if (prop === 'team') return _catalog.team;
      if (prop === 'agent') return _catalog.agent;
      if (prop === 'skill') return _catalog.skill;
      if (prop === 'tool') return _catalog.tool;
      if (prop === 'workflow') return _catalog.workflow;
      return undefined;
    },
  }
);
