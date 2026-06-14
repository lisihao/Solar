/**
 * event-categories spec — 12 case + RV-5 + RV-9。
 *
 * design v1.1 §3.3 + §7：
 *   - BUSINESS 用 startsWith 全限定前缀（不能用 includes，防 RV-9 子串攻击）
 *   - LIFECYCLE 精确字符串集合
 *   - UNKNOWN = fail-open 当 BUSINESS（宁可误算活迹放行用户）
 *   - 穷举所有现有 emit 点：每个都被分类，不静默落空（R1 architect P0-1）
 */

import {
  categorizeEvent,
  isBusinessEventType,
  isLifecycleEventType,
} from "../event-categories";

describe("event-categories", () => {
  describe("BUSINESS — 全限定前缀 startsWith 匹配", () => {
    it("playground.dimension:web → BUSINESS", () => {
      expect(categorizeEvent("playground.dimension:web")).toBe(
        "BUSINESS",
      );
      expect(isBusinessEventType("playground.dimension:web")).toBe(true);
    });

    it("playground.chapter:writing-completed → BUSINESS", () => {
      expect(
        categorizeEvent("playground.chapter:writing-completed"),
      ).toBe("BUSINESS");
    });

    it("playground.stage:s7-review-started → BUSINESS", () => {
      expect(categorizeEvent("playground.stage:s7-review-started")).toBe(
        "BUSINESS",
      );
    });

    it("playground.tool:web-search:completed → BUSINESS", () => {
      expect(
        categorizeEvent("playground.tool:web-search:completed"),
      ).toBe("BUSINESS");
    });

    it("playground.agent:narrative → BUSINESS", () => {
      expect(categorizeEvent("playground.agent:narrative")).toBe(
        "BUSINESS",
      );
    });
  });

  describe("LIFECYCLE — RV-5 精确匹配（用户行为 / 状态机 / cleanup 不算活迹）", () => {
    const lifecycleTypes = [
      "playground.mission:rerun-started",
      "playground.mission:reopened",
      "playground.mission:zombie-cleanup",
      "playground.mission:rerun-failed",
      "playground.mission:rerun-completed",
      "playground.mission:failed",
      "playground.mission:completed",
      "playground.mission:cancelled",
      "playground.mission:rejected",
      "playground.mission:warning",
      "playground.mission:budget-warning-hard",
      "playground.mission:manual-rerun-from-todo",
    ];

    it.each(lifecycleTypes)(
      "%s → LIFECYCLE（不被 isBusinessEventType 误判）",
      (type) => {
        expect(categorizeEvent(type)).toBe("LIFECYCLE");
        expect(isLifecycleEventType(type)).toBe(true);
        expect(isBusinessEventType(type)).toBe(false);
      },
    );
  });

  describe("UNKNOWN — fail-open 当 BUSINESS（R1 architect P0-1）", () => {
    it("playground.misc:foo → UNKNOWN，但 isBusinessEventType=true（fail-open）", () => {
      expect(categorizeEvent("playground.misc:foo")).toBe("UNKNOWN");
      expect(isBusinessEventType("playground.misc:foo")).toBe(true);
      expect(isLifecycleEventType("playground.misc:foo")).toBe(false);
    });

    it("空 / null / undefined → UNKNOWN（type guard，不抛错）", () => {
      expect(categorizeEvent("")).toBe("UNKNOWN");
      expect(categorizeEvent(null)).toBe("UNKNOWN");
      expect(categorizeEvent(undefined)).toBe("UNKNOWN");
      expect(isBusinessEventType("")).toBe(true); // fail-open
      expect(isBusinessEventType(null)).toBe(true);
    });
  });

  describe("RV-9 — startsWith 不被 includes 子串攻击绕过", () => {
    it("mission:lifecycle-note-dimension:fake → 不当 BUSINESS（startsWith 拒）", () => {
      // 攻击向量：构造一个含 "dimension:" 子串但不是 BUSINESS 前缀开头的字符串
      const attackVector =
        "playground.mission:lifecycle-note-dimension:fake";
      // 它不在 LIFECYCLE_TYPES 集合里，也不以任何 BUSINESS 前缀开头 → UNKNOWN（fail-open 当 BUSINESS）
      // 但关键：直接 categorizeEvent 不会误判 BUSINESS（因为不是前缀开头）
      expect(categorizeEvent(attackVector)).toBe("UNKNOWN");
      // 注：fail-open 让 isBusinessEventType=true（设计取舍 —— 误算活迹比误判 zombie 安全）
      // 这条 spec 锁的是 categorizeEvent 严格语义：不被 includes 误匹配 BUSINESS
    });

    it("纯前缀本身（'playground.dimension:'）→ BUSINESS（startsWith 命中）", () => {
      expect(categorizeEvent("playground.dimension:")).toBe("BUSINESS");
    });

    it("不带命名空间前缀的 'dimension:web' → UNKNOWN（不是全限定前缀）", () => {
      expect(categorizeEvent("dimension:web")).toBe("UNKNOWN");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 现有 emit 点穷举回归（R1 architect P1-1 + design §6 R10）
  // ─────────────────────────────────────────────────────────────
  // PR review checklist：新增 emit 点必须在此列表更新；CI 跑这个 spec 强制覆盖。
  // grep 命令（实施时维护）：rg -o "type:\s*[\"']playground\.[^\"']+[\"']" backend/src
  describe("现有 emit 点穷举回归", () => {
    it("已知所有 mission_events.type 全部能被 categorizeEvent 分类（不返回 UNKNOWN）", () => {
      const knownTypes = [
        // BUSINESS prefixes（采样）
        "playground.dimension:web",
        "playground.dimension:academic:graded",
        "playground.chapter:writing-started",
        "playground.chapter:writing-completed",
        "playground.chapter:review:started",
        "playground.chapter:done",
        "playground.stage:s2-leader-plan-mission:started",
        "playground.stage:s11-persist:completed",
        "playground.tool:web-search:started",
        "playground.agent:narrative",
        // LIFECYCLE 全列
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
      ];
      for (const type of knownTypes) {
        expect(categorizeEvent(type)).not.toBe("UNKNOWN");
      }
    });
  });
});
