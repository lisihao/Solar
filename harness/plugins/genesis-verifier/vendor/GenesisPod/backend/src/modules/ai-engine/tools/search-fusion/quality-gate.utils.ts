/**
 * Search Quality Gate 通用工具 — Phase 8 沉淀
 *
 * 沉淀自：ai-app/{app}/services/search/fusion/quality-gate.service.ts
 * 提取**纯算法**评估，调用方传 ResultEvalInput 不绑业务源类型。
 *
 * 用途：fusion 后判断结果是否达"可入库 / 可总结 / 需重搜"质量门槛。
 *
 * 五道门：
 *   1. 最少结果数（默认 ≥3）
 *   2. 源类型多样性（≥2 种 sourceType）
 *   3. 时新性（>20% 有 publishedAt 的条目在最近 6 个月内）
 *   4. 学术覆盖（requireAcademic 时检查 academicTypes 命中）
 *   5. 失败源比例（>50% 请求源 0 结果 → suggest retry）
 */

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

const DEFAULT_FRESHNESS_RATIO = 0.2;
const DEFAULT_MIN_RESULTS = 3;
const DEFAULT_FAILED_SOURCE_RATIO = 0.5;

export type SuggestedSearchAction =
  | "add_web_fallback"
  | "broaden_query"
  | "extend_time_range"
  | "add_academic_source"
  | "retry";

export interface QualityGateInput<TItem> {
  items: TItem[];
  sources: string[];
  /** 各源类型本次返回数（缺失或 0 视为该源失败）*/
  sourceCounts?: Record<string, number>;
}

export interface QualityGateContext<TSourceType extends string = string> {
  requestedSources: TSourceType[];
  /** 最少结果数（默认 3）*/
  minResults?: number;
  /** 是否要求学术源（默认 false）*/
  requireAcademic?: boolean;
  /** 哪些 sourceType 算"学术"（调用方业务定义）*/
  academicSourceTypes?: ReadonlySet<string>;
  /** 时新性比例阈值（默认 0.2）*/
  freshnessRatio?: number;
  /** 失败源比例阈值（默认 0.5）*/
  failedSourceRatio?: number;
}

export interface QualityGateItem {
  sourceType: string;
  publishedAt?: Date;
}

export interface QualityVerdict {
  sufficient: boolean;
  gaps: string[];
  suggestedActions: SuggestedSearchAction[];
}

export function evaluateSearchQuality<T extends QualityGateItem>(
  result: QualityGateInput<T>,
  context: QualityGateContext,
): QualityVerdict {
  const {
    requestedSources,
    minResults = DEFAULT_MIN_RESULTS,
    requireAcademic = false,
    academicSourceTypes,
    freshnessRatio = DEFAULT_FRESHNESS_RATIO,
    failedSourceRatio = DEFAULT_FAILED_SOURCE_RATIO,
  } = context;

  const gaps: string[] = [];
  const suggestedActions: SuggestedSearchAction[] = [];
  const pushAction = (a: SuggestedSearchAction) => {
    if (!suggestedActions.includes(a)) suggestedActions.push(a);
  };

  // 1. 最少结果数
  if (result.items.length < minResults) {
    gaps.push(
      `Insufficient results: ${result.items.length} found, ${minResults} required`,
    );
    pushAction("add_web_fallback");
  }

  // 2. 源类型多样性
  const represented = new Set(result.items.map((i) => i.sourceType));
  if (represented.size < 2) {
    gaps.push(
      `Low source diversity: only ${represented.size} source type(s) represented`,
    );
    pushAction("broaden_query");
  }

  // 3. 时新性
  const datedItems = result.items.filter((i) => i.publishedAt !== undefined);
  if (datedItems.length > 0) {
    const cutoff = new Date(Date.now() - SIX_MONTHS_MS);
    const fresh = datedItems.filter(
      (i) => i.publishedAt !== undefined && i.publishedAt >= cutoff,
    );
    const ratio = fresh.length / datedItems.length;
    if (ratio < freshnessRatio) {
      gaps.push(
        `Low freshness: only ${(ratio * 100).toFixed(0)}% of dated items are recent`,
      );
      pushAction("extend_time_range");
    }
  }

  // 4. 学术覆盖
  // ★ P2-R5 (3) (2026-04-30): requireAcademic=true 但 academicSourceTypes 未传时
  //   原代码静默跳过整段检查，违反 requireAcademic 承诺。改为：未传时直接 gap
  //   (调用方拼装错配置)。
  if (requireAcademic) {
    if (!academicSourceTypes) {
      gaps.push(
        "requireAcademic=true but academicSourceTypes not provided — caller misconfiguration",
      );
      pushAction("add_academic_source");
    } else {
      const hasAcademic = result.items.some((i) =>
        academicSourceTypes.has(i.sourceType),
      );
      if (!hasAcademic) {
        gaps.push("No academic sources present despite requireAcademic flag");
        pushAction("add_academic_source");
      }
    }
  }

  // 5. 失败源比例
  // ★ P0-R5-5 (2026-04-30): sourceCounts[src]=undefined 但 sources.includes(src)=true
  //   时原 if-else 都不进 failed++，缺失数据被误判成功。统一：count 不存在或 0 → failed++
  if (requestedSources.length > 0) {
    let failed = 0;
    for (const src of requestedSources) {
      const count = result.sourceCounts?.[src];
      if (count === undefined || count === 0) failed++;
    }
    const ratio = failed / requestedSources.length;
    if (ratio > failedSourceRatio) {
      gaps.push(
        `High source failure ratio: ${(ratio * 100).toFixed(0)}% of requested sources returned 0 results`,
      );
      pushAction("retry");
    }
  }

  return {
    sufficient: gaps.length === 0,
    gaps,
    suggestedActions,
  };
}
