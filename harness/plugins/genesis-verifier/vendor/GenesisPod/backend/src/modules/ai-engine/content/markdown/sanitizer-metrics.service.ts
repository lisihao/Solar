/**
 * SanitizerMetricsService — PR-A8（2026-05-07）
 *
 * 上游：docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md v1.4 §5 PR-A8
 *
 * 职责：
 *   - 接收 sanitizer 产出的 SanitizeRuleApplied[]，按 rule + severity 聚合
 *   - 暴露 snapshot() 给 admin / metrics endpoint 拉取（rule → count + lastTriggeredAt）
 *   - 不写 DB（保持轻量）；外部观测系统（Prometheus / DataDog）拉 snapshot 自行 scrape
 *
 * 设计决策（与 v1.4 §5 PR-A8 一致）：
 *   - in-memory Map：单 pod 单实例聚合，重启清零（与 production observability 模式对齐）
 *   - 不引入新 DB 表（design 明确"监控钩子"≠"DB 持久化"）
 *   - sanitizerVersion 持久化由 ReportArtifact.metadata.sanitizerVersion 已落（在 PR-A2 完成）
 *
 * 反向证据 spec：sanitizer-metrics.service.spec.ts
 */

import { Injectable } from "@nestjs/common";
import type {
  SanitizeRule,
  SanitizeRuleApplied,
} from "./markdown-sanitizer.types";

export interface SanitizerMetricSnapshot {
  rule: SanitizeRule;
  totalCount: number;
  triggerCount: number;
  highSeverityCount: number;
  lastTriggeredAt: Date | null;
  /** 最近触发的段名（observability — 不含 body 内容，避免 PII） */
  lastSegmentName: string | null;
}

@Injectable()
export class SanitizerMetricsService {
  private readonly counters = new Map<
    SanitizeRule,
    {
      totalCount: number;
      triggerCount: number;
      highSeverityCount: number;
      lastTriggeredAt: Date | null;
      lastSegmentName: string | null;
    }
  >();

  /**
   * 把一次 sanitize 调用的 appliedRules 汇入 metrics。
   *
   * caller：StructuralReportAssembler.sanitizeAndCount（已在 PR-A2 集成）
   * 在 sanitize 调用后注入本方法（fire-and-forget — 监控失败不阻断装配）。
   */
  record(applied: ReadonlyArray<SanitizeRuleApplied>): void {
    if (!applied || applied.length === 0) return;
    const now = new Date();
    for (const a of applied) {
      const cur = this.counters.get(a.rule) ?? {
        totalCount: 0,
        triggerCount: 0,
        highSeverityCount: 0,
        lastTriggeredAt: null,
        lastSegmentName: null,
      };
      cur.totalCount += a.count;
      cur.triggerCount += 1;
      if (a.severity === "high") cur.highSeverityCount += 1;
      cur.lastTriggeredAt = now;
      cur.lastSegmentName = a.segmentName ?? cur.lastSegmentName;
      this.counters.set(a.rule, cur);
    }
  }

  /**
   * 拉 snapshot（按 totalCount 降序）；admin metrics endpoint 直接 JSON 序列化。
   */
  snapshot(): SanitizerMetricSnapshot[] {
    const out: SanitizerMetricSnapshot[] = [];
    for (const [rule, c] of this.counters.entries()) {
      out.push({
        rule,
        totalCount: c.totalCount,
        triggerCount: c.triggerCount,
        highSeverityCount: c.highSeverityCount,
        lastTriggeredAt: c.lastTriggeredAt,
        lastSegmentName: c.lastSegmentName,
      });
    }
    return out.sort((a, b) => b.totalCount - a.totalCount);
  }

  /**
   * 仅供测试用 — 清空 counters。生产不调用。
   */
  reset(): void {
    this.counters.clear();
  }
}
