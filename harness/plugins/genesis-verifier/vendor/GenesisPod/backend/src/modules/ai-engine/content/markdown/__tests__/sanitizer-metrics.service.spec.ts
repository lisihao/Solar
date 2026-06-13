/**
 * SanitizerMetricsService spec — PR-A8（2026-05-07）
 *
 * 反向证据：
 *   1. record 累计 rule.count 到 totalCount
 *   2. record triggerCount = 调用次数（不是 count 之和）
 *   3. high severity 单独计数
 *   4. snapshot 按 totalCount 降序
 *   5. lastTriggeredAt / lastSegmentName 实时更新
 *   6. reset 清空（仅测试用）
 */

import { SanitizerMetricsService } from "../sanitizer-metrics.service";
import type { SanitizeRuleApplied } from "../markdown-sanitizer.types";

describe("SanitizerMetricsService", () => {
  let svc: SanitizerMetricsService;

  beforeEach(() => {
    svc = new SanitizerMetricsService();
  });

  it("record 单 rule —— totalCount 累计 / triggerCount=1", () => {
    const applied: SanitizeRuleApplied[] = [
      { rule: "unclosed-fence-appended", count: 3, severity: "medium" },
    ];
    svc.record(applied);
    const snap = svc.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].rule).toBe("unclosed-fence-appended");
    expect(snap[0].totalCount).toBe(3);
    expect(snap[0].triggerCount).toBe(1);
    expect(snap[0].highSeverityCount).toBe(0);
  });

  it("两次 record 同 rule —— totalCount 累加 / triggerCount=2", () => {
    svc.record([
      { rule: "unclosed-fence-appended", count: 2, severity: "medium" },
    ]);
    svc.record([
      { rule: "unclosed-fence-appended", count: 5, severity: "medium" },
    ]);
    const snap = svc.snapshot();
    expect(snap[0].totalCount).toBe(7);
    expect(snap[0].triggerCount).toBe(2);
  });

  it("high severity 单独计数 —— highSeverityCount 反映 high 触发数", () => {
    svc.record([
      { rule: "instruction-injection-redacted", count: 1, severity: "high" },
    ]);
    svc.record([
      { rule: "instruction-injection-redacted", count: 1, severity: "high" },
    ]);
    const snap = svc.snapshot();
    expect(snap[0].highSeverityCount).toBe(2);
  });

  it("snapshot 按 totalCount 降序", () => {
    svc.record([{ rule: "bom-stripped", count: 1, severity: "low" }]);
    svc.record([
      { rule: "unclosed-fence-appended", count: 10, severity: "medium" },
    ]);
    svc.record([{ rule: "html-comment-stripped", count: 3, severity: "low" }]);
    const snap = svc.snapshot();
    expect(snap.map((s) => s.rule)).toEqual([
      "unclosed-fence-appended",
      "html-comment-stripped",
      "bom-stripped",
    ]);
  });

  it("lastTriggeredAt 实时更新", () => {
    const before = new Date();
    svc.record([{ rule: "bom-stripped", count: 1, severity: "low" }]);
    const snap = svc.snapshot();
    expect(snap[0].lastTriggeredAt).not.toBeNull();
    expect(snap[0].lastTriggeredAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
  });

  it("lastSegmentName 跟踪触发段（observability — 无 body PII）", () => {
    svc.record([
      {
        rule: "unclosed-fence-appended",
        count: 1,
        severity: "medium",
        segmentName: "dim-Market",
      },
    ]);
    svc.record([
      {
        rule: "unclosed-fence-appended",
        count: 1,
        severity: "medium",
        segmentName: "dim-Tech",
      },
    ]);
    const snap = svc.snapshot();
    expect(snap[0].lastSegmentName).toBe("dim-Tech");
  });

  it("空 / null applied —— no-op", () => {
    svc.record([]);
    svc.record(null as never);
    expect(svc.snapshot()).toHaveLength(0);
  });

  it("reset 清空 counters（仅测试用）", () => {
    svc.record([{ rule: "bom-stripped", count: 1, severity: "low" }]);
    expect(svc.snapshot()).toHaveLength(1);
    svc.reset();
    expect(svc.snapshot()).toHaveLength(0);
  });

  // ★ R2 共识 P1 (security R2 P1-NEW): 中文 segmentName 不应让两个不同 dim 撞同一 label
  //   sanitizeMetricsLabel 的 base64 fallback 路径在 structural-report-assembler.service.ts，
  //   这里用 raw segmentName 验证 record 不会聚合两个不同来源到同一 counter。
  it("两个 segmentName（含中文）不同 → snapshot 各自保留 lastSegmentName 不丢失", () => {
    svc.record([
      {
        rule: "unclosed-fence-appended",
        count: 1,
        severity: "medium",
        segmentName: "dim:b64_5a6X5oS_55_e",
      },
    ]);
    svc.record([
      {
        rule: "unclosed-fence-appended",
        count: 1,
        severity: "medium",
        segmentName: "dim:b64_6Iqx5LiL5pyJ",
      },
    ]);
    const snap = svc.snapshot();
    // record 是按 rule 聚合，lastSegmentName 反映最近一次（不同字符串）
    expect(snap[0].lastSegmentName).toBe("dim:b64_6Iqx5LiL5pyJ");
    expect(snap[0].triggerCount).toBe(2);
  });
});
