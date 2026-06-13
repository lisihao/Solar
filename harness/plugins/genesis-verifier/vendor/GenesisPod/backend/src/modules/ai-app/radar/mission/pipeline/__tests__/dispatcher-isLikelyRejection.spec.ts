/**
 * isLikelyRejection helper 单元测试
 *
 * 2026-05-17 R4-B 闭环：dispatcher.catch 用此 helper 区分 framework reject 类
 * 异常 (markRejected) vs 普通失败 (markFailed)。本 spec 直接锁关键字匹配
 * 规则，让"加新异常关键字"或"误判 false positive"立即被 spec 拍住。
 *
 * 不写依赖 ai-harness 异常类的 instanceof 判断 —— 历史已踩坑双源契约
 * ([[feedback_no_dual_sources]])。本层只匹配 message text，未来 harness
 * 暴露稳定异常类后可在此 helper 内部加 instanceof 分支同步演进。
 */

import { isLikelyRejection } from "../radar-pipeline-dispatcher.service";

describe("isLikelyRejection", () => {
  describe("命中 (markRejected 路径)", () => {
    it.each([
      ["Budget exceeded for this mission"],
      ["budget_exhausted"],
      ["budget too low"],
      ["insufficient budget"],
      ["Rate limit reached (3/min)"],
      ["rate-limit triggered"],
      ["rate_limit"],
      ["Quota exceeded for user u-1"],
      ["quota_exhausted"],
      ["Forbidden by guardrail"],
      ["forbidden"],
      ["Rejected by framework"],
      ["Pre-check failed: insufficient credits"],
      ["pre_check rejected"],
    ])("returns true for: %s", (msg) => {
      expect(isLikelyRejection(msg)).toBe(true);
    });
  });

  describe("不命中 (markFailed 路径)", () => {
    it.each([
      ["LLM timeout after 30s"],
      ["Database connection lost"],
      ["JSON parse error"],
      ["Unknown stage failure"],
      ["aborted_during_persist"],
      ["RSS parser returned undefined"],
      [""],
    ])("returns false for: %s", (msg) => {
      expect(isLikelyRejection(msg)).toBe(false);
    });
  });

  it("'budget' 单独出现不命中（防误判普通日志）", () => {
    // 关键字必须配合修饰词（exceed/exhaust/over/too/insufficient）
    expect(isLikelyRejection("budget computed: $0.05")).toBe(false);
    expect(isLikelyRejection("budget OK")).toBe(false);
  });

  it("大小写不敏感（LLM message 大小写不固定）", () => {
    expect(isLikelyRejection("BUDGET EXCEEDED")).toBe(true);
    expect(isLikelyRejection("FORBIDDEN")).toBe(true);
    expect(isLikelyRejection("Rejected")).toBe(true);
  });
});
