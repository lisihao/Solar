/**
 * Mission events 表 type 字符串前缀分类（playground 业务规则）。
 *
 * ★ 2026-05-24 P6 Wave 1：framework 化下沉到
 *   `ai-harness/teams/business-team/lifecycle/business-team-event-categories.ts`。
 *   本文件保留 playground 专属规则集 + 经 facade re-export framework helpers。
 *
 * 用途：RerunGuard.getLatestBusinessEventTs 区分"业务真活迹" vs "用户行为/状态机/cleanup"，
 * 防止 c195035f 类因果倒置（用户 emit 的 lifecycle 事件被自己当 mission 活迹读 → 拒绝用户）。
 *
 * ★ SQL 安全守护：BUSINESS_PREFIXES 必须保持 `as const` 编译期常量。**禁止从 DB /
 * 环境变量 / 用户输入读取**，否则参数化 SQL LIKE 的 prefix 端引入用户可控字符串
 * 可能触发 wildcard 滥用。新增 prefix 直接在本数组追加 const 字符串。
 *
 * 决策（4 路 R1+R2 共识）：
 *   - BUSINESS：全限定前缀 + startsWith 匹配（防 type="mission:lifecycle-note-dimension:fake" 子串攻击）
 *   - LIFECYCLE：精确字符串集合（Set.has，不会误伤）
 *   - UNKNOWN（既不是 BUSINESS 前缀也不在 LIFECYCLE 列表）→ fail-open 当 BUSINESS
 */

import {
  categorizeBusinessEvent,
  isBusinessTeamEventType,
  isLifecycleTeamEventType,
  type EventCategory,
  type EventCategoryRules,
} from "@/modules/ai-harness/facade";

/** Playground 专属规则集。 */
export const EVENT_CATEGORY = {
  BUSINESS_PREFIXES: [
    "playground.dimension:",
    "playground.chapter:",
    "playground.stage:",
    "playground.agent:narrative",
    "playground.tool:",
  ] as const,
  LIFECYCLE_TYPES: new Set<string>([
    "playground.mission:rerun-started",
    "playground.mission:rerun-completed",
    "playground.mission:rerun-failed",
    "playground.mission:reopened",
    "playground.mission:failed",
    "playground.mission:completed",
    "playground.mission:cancelled",
    "playground.mission:rejected",
    "playground.mission:warning",
    "playground.mission:budget-warning-hard",
    "playground.mission:manual-rerun-from-todo",
    "playground.mission:zombie-cleanup",
  ]),
} as const;

/** Playground 规则适配器（注入到 framework helpers）。 */
const PLAYGROUND_RULES: EventCategoryRules = {
  businessPrefixes: EVENT_CATEGORY.BUSINESS_PREFIXES,
  lifecycleTypes: EVENT_CATEGORY.LIFECYCLE_TYPES,
};

export type { EventCategory };

export function categorizeEvent(
  eventType: string | null | undefined,
): EventCategory {
  return categorizeBusinessEvent(eventType, PLAYGROUND_RULES);
}

export function isBusinessEventType(
  eventType: string | null | undefined,
): boolean {
  return isBusinessTeamEventType(eventType, PLAYGROUND_RULES);
}

export function isLifecycleEventType(
  eventType: string | null | undefined,
): boolean {
  return isLifecycleTeamEventType(eventType, PLAYGROUND_RULES);
}
