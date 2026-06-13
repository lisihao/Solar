/**
 * StructuralReportAssembler —— v1.4 报告装配重构核心
 *
 * 上游：docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md v1.4
 *
 * 设计要点（与文档严格一致）：
 *   - 把"文档结构决定权"从 LLM 收回到 backend
 *   - 输入：ReportSegments（plan + bodies + citations 等）
 *   - 输出：ReportArtifact（fullMarkdown + sections[] 一次性产出）
 *   - 不调 LLM，纯字符串拼装
 *   - 拼装时记录 offset，不"回头解析"
 *   - sections.length === expectedSectionCount(template, segments)
 *
 * stateless 强约束（v1.2 B6）：
 *   - 禁止任何实例字段
 *   - assemble() 内所有中间变量局部于方法栈
 *   - return 必为新对象（不持有 caller 传入对象的引用）
 *   - spec 锁 Promise.all 互不污染（structural-report-assembler.spec.ts）
 *
 * v1.4 类型严格化：
 *   - ReportTemplate.slot.bodySource 用 discriminated union
 *   - 编译期严格区分 fromBodies / fromBuilder
 *   - 不再有 `as never` cast
 */

import { Injectable, Optional } from "@nestjs/common";
import { sanitizeMarkdownBody } from "../../../../ai-engine/content/markdown/markdown-sanitizer.util";
import type { SanitizeOptions } from "../../../../ai-engine/content/markdown/markdown-sanitizer.types";
// ★ PR-A8 (2026-05-07): metrics 聚合（Optional 注入：DI 没接通时安静 noop，不影响装配）
import { SanitizerMetricsService } from "../../../../ai-engine/content/markdown/sanitizer-metrics.service";
import { normalizeMarkdownSlug } from "../../../../ai-engine/content/markdown/slug-normalize.util";

/**
 * ★ R2 共识 P1 (security P2-B, 2026-05-07): dim.id 来自 LLM 输出，
 * 写入 metrics label 前必须 sanitize，防 Prometheus label / 日志解析注入。
 *
 * R3 改进 (security R2 P1-NEW)：纯字符过滤会让中文 dim.id（如 "宏观环境"
 * vs "微观经济"）全替换成 "____" 撞一起，导致 metrics 维度区分度丢失。
 * 改用：
 *   1. 已是 alphanumeric/dash/underscore 的 raw 直接保留（截 64 字符）
 *   2. 含非 ASCII 字符时改用 base64url encode（保唯一性 + 可逆 + Prometheus 兼容）
 *
 * Empty/null 输入返回 'unknown'，让 caller 仍能 record 而非 crash。
 */
function sanitizeMetricsLabel(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  const s = String(raw);
  // 全 ASCII 安全字符 → 直接用（短、可读）
  if (/^[a-zA-Z0-9_\-]+$/.test(s)) return s.slice(0, 64);
  // 含特殊字符（中文 / 空格 / 标点）→ base64url 保唯一性
  const encoded = Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `b64_${encoded.slice(0, 60)}`;
}
import {
  MULTI_DIMENSION_REPORT_TEMPLATE,
  expectedSectionCount,
  type ReportSegments,
  type ReportTemplateSlot,
  type SlotBodySource,
} from "./report-segments.dto";
import type { ReportArtifact, ArtifactSection } from "./report-artifact.dto";

/** 拼装中间产物：一段 = 标题 + body + offset 区间 */
interface AssembledChunk {
  title: string;
  type: ArtifactSection["type"];
  level: 2 | 3;
  body: string;
  startOffset: number;
  endOffset: number;
  sourceDimensionId?: string;
}

@Injectable()
export class StructuralReportAssembler {
  // ★ PR-A8 (2026-05-07): 唯一允许的实例字段 —— DI 注入的 metrics 单例。
  //   不破坏 stateless 约束（caller 仍互不污染：metrics 服务自身有内部 Map，
  //   每次 record 是 thread-safe append；assemble() 仍不写实例字段）。
  constructor(
    @Optional()
    private readonly sanitizerMetrics?: SanitizerMetricsService,
  ) {}

  /**
   * 主入口 — 拼装 ReportArtifact
   * stateless：所有中间变量局部，无实例字段
   */
  assemble(segments: ReportSegments): ReportArtifact {
    const tpl = segments.template ?? MULTI_DIMENSION_REPORT_TEMPLATE;

    // 局部 accumulator 收集 sanitizerVersion（v1.6: stateless 严守 — 不放实例字段）
    const sanitizerAcc: { sanitizerVersion?: string } = {};

    // 1. dim.name 入装前防御（B9）
    const safePlan = this.sanitizePlan(segments.plan);
    const safeSegments: ReportSegments = { ...segments, plan: safePlan };

    // 2. 按 slot 顺序拼装，记录 offset
    const chunks: AssembledChunk[] = [];
    let cursor = 0;
    for (const slot of tpl.slots) {
      if (slot.kind === "loop" && slot.key === "perDimension") {
        for (const dim of safePlan.dimensions) {
          const item = safeSegments.bodies.perDimension.find(
            (p) => p.dimensionId === dim.id,
          );
          const bodyRaw = item?.body ?? null;
          const body =
            bodyRaw === null
              ? "*（本维度内容缺失）*"
              : this.runSanitizer(
                  bodyRaw,
                  safePlan.dimensions.map((d) => d.name),
                  sanitizerAcc,
                  // ★ PR-A8 (2026-05-07): 让 metrics 知道哪段触发的 rule
                  //   （仅 dim.id，不含 dim.name 或 body 内容，避免 PII 泄露）
                  // ★ R2 共识 P1 (security P2-B): dim.id 来自 LLM 输出，
                  //   写入 metrics label 前 sanitize 防 Prometheus label /
                  //   日志解析注入：仅保留 alphanumeric / dash / underscore，
                  //   截到 64 字符。
                  `dim:${sanitizeMetricsLabel(dim.id)}`,
                );
          const chunk = this.makeChunk(
            cursor,
            dim.name,
            "dimension",
            2,
            body,
            dim.id,
          );
          chunks.push(chunk);
          cursor = chunk.endOffset;
        }
        continue;
      }

      if (slot.kind === "fixed" || slot.kind === "optional") {
        const body = this.resolveSlotBody(slot, safeSegments, sanitizerAcc);
        // (slot.key 是 backend 定义的 ReportTemplate enum 字面量，本身已安全；
        //  不需要 sanitizeMetricsLabel)
        if (slot.kind === "optional" && !body.trim()) continue;
        const type = this.slotTypeFor(slot.key);
        const chunk = this.makeChunk(cursor, slot.title, type, 2, body);
        chunks.push(chunk);
        cursor = chunk.endOffset;
      }
    }

    // 3. fullMarkdown
    const fullMarkdown = chunks
      .map((c) => `## ${c.title}\n\n${c.body}`)
      .join("\n\n");

    // 4. sections[] 由 chunks 派生（offset 一一对齐）
    const sections: ArtifactSection[] = chunks.map((c, i) => ({
      id: `sec-${i + 1}`,
      type: c.type,
      level: c.level,
      title: c.title,
      anchor: normalizeMarkdownSlug(c.title),
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      wordCount: this.countWords(c.body),
      readingTimeMinutes: Math.max(1, Math.ceil(this.countWords(c.body) / 250)),
      citations: [],
      figureIds: [],
      factIds: [],
      sourceDimensionId: c.sourceDimensionId,
    }));

    // 5. 不变量自检（v1.5 收尾：从 noop 改为真实写 metadata）
    const expected = expectedSectionCount(tpl, safeSegments);
    const sectionCountMismatch =
      sections.length !== expected
        ? { expected, actual: sections.length }
        : undefined;

    return {
      content: {
        fullMarkdown,
        fullReportSize: Buffer.byteLength(fullMarkdown, "utf-8"),
      },
      sections,
      citations: segments.citations,
      figures: segments.figures,
      factTable: segments.factTable,
      quickView: this.buildQuickView(safeSegments, sections),
      metadata: {
        ...segments.metadata,
        templateId: tpl.id,
        sanitizerVersion: sanitizerAcc.sanitizerVersion,
        sectionCountMismatch,
      },
      quality: this.buildQualityVerdicts(segments.qualityInputs, sections),
    };
  }

  /**
   * dim.name 多重防御：strip newline + trim + slice(0, 200)
   * v1.6 (代码评审反馈): 加 null/non-string guard，避免 sanitizePlan
   * 因 LLM/上游意外返回 null/undefined/number 而抛 TypeError（spec 测试
   * 应通过显式 mock 触发降级，而非靠 .replace(null) 这种实现细节脆弱性）。
   */
  private sanitizePlan(plan: ReportSegments["plan"]): ReportSegments["plan"] {
    return {
      themeSummary: plan.themeSummary,
      dimensions: plan.dimensions.map((d) => ({
        id: d.id,
        name: String(d.name ?? "")
          .replace(/[\r\n]/g, " ")
          .trim()
          .slice(0, 200),
        rationale: d.rationale,
      })),
    };
  }

  private resolveSlotBody(
    slot: Extract<ReportTemplateSlot, { kind: "fixed" | "optional" }>,
    segments: ReportSegments,
    sanitizerAcc: { sanitizerVersion?: string },
  ): string {
    const src: SlotBodySource = slot.bodySource;
    if (src.kind === "fromBodies") {
      const raw = segments.bodies[src.field];
      const text = typeof raw === "string" ? raw : "";
      return text.trim()
        ? this.runSanitizer(
            text,
            segments.plan.dimensions.map((d) => d.name),
            sanitizerAcc,
            // ★ PR-A8 (2026-05-07): slot.key 标识哪个 fixed/optional slot 触发了 rule
            `slot:${slot.key}`,
          )
        : "";
    }
    // fromBuilder
    return this.runBuilder(src.builder, segments);
  }

  private runBuilder(
    builder: Extract<SlotBodySource, { kind: "fromBuilder" }>["builder"],
    segments: ReportSegments,
  ): string {
    switch (builder) {
      case "toc":
        return this.buildToc(segments);
      case "references":
        return this.buildReferences(segments);
      case "foreword-preface":
        return segments.bodies.preface ?? "";
      case "foreword-conclusion":
        return segments.bodies.conclusion ?? "";
      case "foreword-recommendations":
        return segments.bodies.recommendations ?? "";
    }
  }

  /** 自动目录 — 用 plan.dimensions 构造（fallback：从 sections 派生） */
  private buildToc(segments: ReportSegments): string {
    const lines = segments.plan.dimensions.map(
      (d, i) => `${i + 1}. [${d.name}](#${normalizeMarkdownSlug(d.name)})`,
    );
    return lines.length === 0 ? "*（本报告无章节）*" : lines.join("\n");
  }

  /** 自动参考文献 — 从 citations 派生 */
  private buildReferences(segments: ReportSegments): string {
    if (!segments.citations || segments.citations.length === 0) {
      return "*（本报告无参考文献）*";
    }
    return segments.citations
      .map((c) => `${c.index}. [${c.title}](${c.url}) — ${c.domain}`)
      .join("\n");
  }

  /**
   * 单段 sanitize：注入 knownDimNames 让 sanitizer 精确剥首行 H2
   *
   * v1.6 (架构师二轮 hard miss B 修): 通过局部 accumulator 收集 sanitizerVersion
   * 让 assemble() 写入 metadata.sanitizerVersion，同时**严守 stateless**
   * （B6 约束：不允许实例字段）—— accumulator 是 caller 局部对象的引用。
   */
  private runSanitizer(
    raw: string,
    knownDimNames: string[],
    acc: { sanitizerVersion?: string },
    segmentName?: string,
  ): string {
    const opts: SanitizeOptions = { knownDimNames, segmentName };
    const result = sanitizeMarkdownBody(raw, opts);
    acc.sanitizerVersion = result.sanitizerVersion;
    // ★ PR-A8 (2026-05-07): 触发了任意 sanitize rule 时把 appliedRules 汇入 metrics。
    //   try/catch 包裹防 metrics service 异常阻断装配（observability 失败 ≠ 装配失败）。
    if (this.sanitizerMetrics && result.appliedRules.length > 0) {
      try {
        this.sanitizerMetrics.record(result.appliedRules);
      } catch {
        /* noop — metrics 失败不能拖垮装配 */
      }
    }
    return result.body;
  }

  /**
   * 拼装时计算 offset
   * 每段 = "## {title}\n\n{body}"，段间用 "\n\n" 连接
   */
  private makeChunk(
    cursor: number,
    title: string,
    type: ArtifactSection["type"],
    level: 2 | 3,
    body: string,
    sourceDimensionId?: string,
  ): AssembledChunk {
    const headerLine = `## ${title}\n\n`;
    const sep = cursor === 0 ? "" : "\n\n";
    const startOffset = cursor + sep.length;
    const text = sep + headerLine + body;
    const endOffset = cursor + text.length;
    return {
      title,
      type,
      level,
      body,
      startOffset,
      endOffset,
      sourceDimensionId,
    };
  }

  private slotTypeFor(key: string): ArtifactSection["type"] {
    switch (key) {
      case "execSummary":
        return "executive_summary";
      case "preface":
      case "toc":
        return "preface";
      case "crossDim":
        return "cross_dimension";
      case "risk":
        return "risk_assessment";
      case "recommendations":
        return "recommendations";
      case "outlook":
        return "outlook";
      case "conclusion":
        return "conclusion";
      case "references":
        return "appendix";
      default:
        return "appendix";
    }
  }

  /**
   * ★ PR-quickview-parity (2026-05-09): 从 segments.quickViewData 填实快速视图卡片。
   *
   * 数据来源：analyst Output 的 5 组结构化字段（keyFindingsByDimension /
   * trendsByDimension / riskMatrix / recommendationsByAudience / whatYouWillLearn），
   * 经 segment-extractors 透传到 segments.quickViewData。
   *
   * 兜底语义：任一字段缺失 → 对应数组为空，前端卡片短路不渲染（无回归）。
   * topHighlights 由 keyFindingsByDimension 派生（type='finding'，significance→ranking）；
   * 若 analyst 没产 keyFindingsByDimension 但有 insights[]，按 supportingDimensions[0] 兜底分组成 topHighlights。
   */
  private buildQuickView(
    segments: ReportSegments,
    sections: ArtifactSection[],
  ): ReportArtifact["quickView"] {
    const exec = sections.find((s) => s.type === "executive_summary");
    const qd = segments.quickViewData ?? {};

    // dim name → dim id 反查表（让 highlight 携带 sourceDimensionId 让前端定位章节）
    const dimNameToId = new Map<string, string>();
    for (const d of segments.plan.dimensions) {
      dimNameToId.set(d.name, d.id);
    }

    // keyFindingsByDimension → topHighlights (type='finding')
    const findingHighlights: ReportArtifact["quickView"]["topHighlights"] = [];
    const keyFindingsByDimension: ReportArtifact["quickView"]["keyFindingsByDimension"] =
      [];
    for (const group of qd.keyFindingsByDimension ?? []) {
      const dimId = dimNameToId.get(group.dimensionName);
      keyFindingsByDimension.push({
        dimensionId: dimId,
        dimensionName: group.dimensionName,
        findings: group.findings,
      });
      for (const f of group.findings) {
        findingHighlights.push({
          type: "finding",
          title: f.finding.slice(0, 80),
          oneLineSummary: f.finding,
          sourceDimensionId: dimId ?? "",
          citations: [],
        });
      }
    }

    // 没 keyFindingsByDimension 时，从 insights[] 兜底派生 topHighlights
    if (findingHighlights.length === 0 && (qd.insights ?? []).length > 0) {
      for (const ins of qd.insights ?? []) {
        const firstDim = ins.supportingDimensions[0];
        const dimId = firstDim ? (dimNameToId.get(firstDim) ?? "") : "";
        findingHighlights.push({
          type: "finding",
          title: ins.headline.slice(0, 80),
          oneLineSummary: ins.narrative.slice(0, 200),
          sourceDimensionId: dimId,
          citations: [],
        });
      }
    }

    // trendsByDimension → topTrends（直接展平，保留 dim 关联）
    const topTrends: ReportArtifact["quickView"]["topTrends"] = [];
    for (const group of qd.trendsByDimension ?? []) {
      const dimId = dimNameToId.get(group.dimensionName);
      for (const t of group.trends) {
        topTrends.push({
          title: t.trend.slice(0, 80),
          description: t.trend,
          sourceDimensionId: dimId,
          direction: t.direction,
          timeframe: t.timeframe,
        });
      }
    }

    // riskMatrix → keyRisks（保留扁平兼容字段）+ 同时把结构化 riskMatrix 直透到 quickView
    const keyRisks = (qd.riskMatrix ?? []).map((r) => ({
      title: r.riskType,
      description: `概率 ${r.probability} · 影响 ${r.impact} · ${r.timeframe}`,
    }));

    // recommendationsByAudience → topRecommendations（扁平兼容字段，每受众×时间窗口取头几条）
    const topRecommendations: ReportArtifact["quickView"]["topRecommendations"] =
      [];
    const rba = qd.recommendationsByAudience;
    if (rba?.forEnterprise) {
      for (const s of rba.forEnterprise.shortTerm.slice(0, 2)) {
        topRecommendations.push({ title: "企业·短期", description: s });
      }
      for (const s of rba.forEnterprise.midTerm.slice(0, 1)) {
        topRecommendations.push({ title: "企业·中期", description: s });
      }
    }
    if (rba?.forInvestors) {
      for (const s of rba.forInvestors.shortTerm.slice(0, 2)) {
        topRecommendations.push({ title: "投资者·短期", description: s });
      }
      for (const s of rba.forInvestors.midTerm.slice(0, 1)) {
        topRecommendations.push({ title: "投资者·中期", description: s });
      }
    }

    return {
      executiveSummary: {
        markdown: segments.bodies.executiveSummary ?? "",
        wordCount: exec?.wordCount ?? 0,
      },
      topHighlights: findingHighlights,
      topTrends,
      keyRisks,
      topRecommendations,
      keyCitations: segments.citations.slice(0, 5).map((c) => c.index),
      keyFigures: segments.figures.slice(0, 3).map((f) => f.id),
      estimatedReadingTime: sections.reduce(
        (sum, s) => sum + s.readingTimeMinutes,
        0,
      ),
      whatYouWillLearn: qd.whatYouWillLearn ?? [],
      riskMatrix: qd.riskMatrix ?? [],
      recommendationsByAudience: rba,
      keyFindingsByDimension,
      // ★ Foresight L1：结构化前瞻判断直透 quickView，驱动前端"未来推演"卡片
      foresight: qd.foresight,
    };
  }

  private buildQualityVerdicts(
    qualityInputs: ReportSegments["qualityInputs"],
    sections: ArtifactSection[],
  ): ReportArtifact["quality"] {
    const verifierAvg =
      Object.values(qualityInputs.verifierScores).length === 0
        ? 70
        : Math.round(
            Object.values(qualityInputs.verifierScores).reduce(
              (a, b) => a + b,
              0,
            ) / Object.values(qualityInputs.verifierScores).length,
          );
    const wordCounts = sections.map((s) => s.wordCount);
    const total = wordCounts.reduce((a, b) => a + b, 0);
    const avg = wordCounts.length > 0 ? total / wordCounts.length : 0;
    const max = Math.max(...(wordCounts.length ? wordCounts : [0]));
    const balance =
      avg > 0 ? Math.max(0, 100 - Math.round((max / avg - 1) * 30)) : 0;

    return {
      overall: verifierAvg,
      dimensions: {
        traceability: verifierAvg,
        factualConsistency: verifierAvg,
        novelty: 70,
        coverage: 70,
        redundancy: 80,
        formatCorrectness: 90,
        citationDensity: 70,
        styleConformance: 80,
        lengthAccuracy: 80,
        chapterBalance: balance,
      },
      hardGateViolations: [],
      warnings: qualityInputs.warnings.map((w) => ({
        dimension: w.scopeKey,
        message: w.message,
      })),
      qualityTrace: [],
      finalVerdict:
        verifierAvg >= 85
          ? "excellent"
          : verifierAvg >= 70
            ? "good"
            : verifierAvg >= 50
              ? "acceptable"
              : "poor",
    };
  }

  private countWords(s: string): number {
    if (!s) return 0;
    const cn = (s.match(/[一-鿿]/g) ?? []).length;
    const en = (s.match(/\b[a-zA-Z][a-zA-Z0-9'-]*\b/g) ?? []).length;
    return cn + en;
  }
}

/** Default singleton instance — 方便测试 + non-DI 调用 */
export const defaultStructuralReportAssembler = new StructuralReportAssembler();

/**
 * Pure-function variant: assemble() 不需要 NestJS DI 时直接调
 */
export function assembleStructuralReport(
  segments: ReportSegments,
): ReportArtifact {
  return defaultStructuralReportAssembler.assemble(segments);
}
