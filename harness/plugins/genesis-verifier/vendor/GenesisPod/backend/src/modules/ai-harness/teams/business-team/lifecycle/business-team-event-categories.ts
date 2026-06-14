/**
 * BusinessAgentTeam — Event Categories (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/event-categories.ts
 *
 * Mission event 通用分类机制 —— BUSINESS / LIFECYCLE / UNKNOWN。
 *
 * 用途：RerunGuard.getLatestBusinessEventTs 区分"业务真活迹" vs "用户行为/状态机/cleanup"，
 * 防止因果倒置（用户 emit 的 lifecycle 事件被自己当 mission 活迹读 → 拒绝用户）。
 *
 * 决策：
 *   - BUSINESS: startsWith 全限定前缀匹配（防子串攻击）
 *   - LIFECYCLE: 精确字符串集合 Set.has
 *   - UNKNOWN: fail-open 当 BUSINESS（宁可误算活迹放行用户，也不误判 zombie 杀活 mission）
 *
 * 业务方提供 BUSINESS_PREFIXES + LIFECYCLE_TYPES。Framework 提供 categorize 机制。
 *
 * ★ SQL 安全守护：BUSINESS_PREFIXES 必须 `as const` 编译期常量。**禁止从 DB / env /
 * 用户输入读取**，否则参数化 SQL LIKE 的 prefix 端引入用户可控字符串可能触发
 * wildcard 滥用（用户传 `%` 把 LIKE 撑爆）。新增 prefix 在业务方 const 数组里追加。
 */

export type EventCategory = "BUSINESS" | "LIFECYCLE" | "UNKNOWN";

/** 业务方提供的分类规则集合。 */
export interface EventCategoryRules {
  readonly businessPrefixes: readonly string[];
  readonly lifecycleTypes: ReadonlySet<string>;
}

/** Framework: 给定规则 + 事件 type → 分类。 */
export function categorizeEvent(
  eventType: string | null | undefined,
  rules: EventCategoryRules,
): EventCategory {
  if (typeof eventType !== "string" || eventType.length === 0) return "UNKNOWN";
  if (rules.lifecycleTypes.has(eventType)) return "LIFECYCLE";
  if (rules.businessPrefixes.some((p) => eventType.startsWith(p))) {
    return "BUSINESS";
  }
  return "UNKNOWN";
}

/** UNKNOWN = fail-open 当 BUSINESS（宁可误算活迹放行用户）。 */
export function isBusinessEventType(
  eventType: string | null | undefined,
  rules: EventCategoryRules,
): boolean {
  const cat = categorizeEvent(eventType, rules);
  return cat === "BUSINESS" || cat === "UNKNOWN";
}

export function isLifecycleEventType(
  eventType: string | null | undefined,
  rules: EventCategoryRules,
): boolean {
  return categorizeEvent(eventType, rules) === "LIFECYCLE";
}
