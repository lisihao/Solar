export const SEARCH_TIME_RANGE_VALUES = [
  "30d",
  "90d",
  "180d",
  "365d",
  "730d",
  "all",
] as const;

export type SearchTimeRange = (typeof SEARCH_TIME_RANGE_VALUES)[number];

export const DEFAULT_SEARCH_TIME_RANGE: SearchTimeRange = "365d";

const SEARCH_TIME_RANGE_DAYS: Record<
  Exclude<SearchTimeRange, "all">,
  number
> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
  "730d": 730,
};

export function isSearchTimeRange(value: unknown): value is SearchTimeRange {
  return (
    typeof value === "string" &&
    (SEARCH_TIME_RANGE_VALUES as readonly string[]).includes(value)
  );
}

export function getSearchTimeRangeDays(
  range: SearchTimeRange,
): number | undefined {
  if (range === "all") return undefined;
  return SEARCH_TIME_RANGE_DAYS[range];
}

export function resolveSearchTimeRangeSince(
  range: SearchTimeRange,
  now = new Date(),
): Date | undefined {
  const days = getSearchTimeRangeDays(range);
  if (days == null) return undefined;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function formatDateYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatDateYmdSlash(date: Date): string {
  return formatDateYmd(date).replace(/-/g, "/");
}

export function getUnixTimestampSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function resolveSearchTimeRangeYearWindow(
  range: SearchTimeRange,
  now = new Date(),
): string | undefined {
  const since = resolveSearchTimeRangeSince(range, now);
  if (!since) return undefined;
  const fromYear = since.getUTCFullYear();
  const toYear = now.getUTCFullYear();
  return fromYear === toYear ? String(toYear) : `${fromYear}-${toYear}`;
}

export function getSearchTimeRangeLabel(range: SearchTimeRange): string {
  switch (range) {
    case "30d":
      return "past 1 month";
    case "90d":
      return "past 3 months";
    case "180d":
      return "past 6 months";
    case "365d":
      return "past 12 months";
    case "730d":
      return "past 24 months";
    case "all":
      return "all time";
  }
}

/**
 * 2026-05-13: Search tool 时效兜底解析。
 *
 * 解决问题：
 *   - 之前 10 个 search tool 全部 default `timeRange = "all"`，LLM 偶发漏传
 *     → mission DTO 选的 30d / 90d 完全失效，5 年前文章也命中。
 *   - 修复后 mission-aware caller（researcher / leader）可把 mission 选的
 *     searchTimeRange 注入 ToolContext.metadata.searchTimeRange，tool 实现
 *     时统一调用本函数解析。
 *
 * 优先级（由高到低）：
 *   1. LLM 显式传入 `inputTimeRange`（包括显式 "all"，尊重 LLM 决策）
 *   2. mission context `metadata.searchTimeRange`（caller 注入的 mission 默认）
 *   3. `DEFAULT_SEARCH_TIME_RANGE`（兜底 = 365d，不再无限制）
 */
export function resolveEffectiveTimeRange(
  inputTimeRange: SearchTimeRange | string | undefined,
  contextMetadata?: Record<string, unknown> | null,
): SearchTimeRange {
  if (inputTimeRange !== undefined && isSearchTimeRange(inputTimeRange)) {
    return inputTimeRange;
  }
  const fromContext = contextMetadata?.searchTimeRange;
  if (isSearchTimeRange(fromContext)) {
    return fromContext;
  }
  return DEFAULT_SEARCH_TIME_RANGE;
}
