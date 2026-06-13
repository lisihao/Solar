/**
 * ReportSegments DTO + ReportTemplate Slot 抽象
 *
 * 上游：docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md v1.4
 *
 * 设计意图：
 *   把"文档结构决定权"从 LLM 收回到 backend：
 *     - LLM 只产出"每段 body markdown"（不带 H2 标题）
 *     - backend 按确定性 ReportTemplate 拼装 fullMarkdown + 同步构造 sections[]
 *
 * 类型设计要点：
 *   - `bodySource` 用 discriminated union，避免 v1.2 的 `as never` cast
 *   - `perDimension: Array<{dimensionId, body}>` 按 dimensionId 关联，避免 partial dim failure 时 index 漂移
 *   - dim.name 入装前必须已经过 strip-newline + slice(0,200)（B9 安全）
 *   - `qualityInputs` 用业务无关词（scopeKey 而非 dimension），harness 不感知 ai-app 业务概念
 *
 * v1.4 文件骨架先落地（PR-A0），PR-A2 完整实现 StructuralReportAssembler 时复用本 DTO。
 */

import type {
  ArtifactCitation,
  ArtifactFigure,
  ArtifactFactTriple,
  ArtifactMetadata,
} from "./report-artifact.dto";

/**
 * Slot 的 body 来源 —— 严格 discriminated union（删 v1.2 `as never` cast）
 *  - fromBodies: 取 segments.bodies[field]
 *  - fromBuilder: 调专用 builder（toc / references / foreword-{preface,conclusion,recommendations}）
 */
export type SlotBodySource =
  | { kind: "fromBodies"; field: keyof ReportSegments["bodies"] }
  | {
      kind: "fromBuilder";
      builder:
        | "toc"
        | "references"
        | "foreword-preface"
        | "foreword-conclusion"
        | "foreword-recommendations";
    };

export type ReportTemplateSlot =
  | { kind: "fixed"; key: string; title: string; bodySource: SlotBodySource }
  | { kind: "loop"; key: "perDimension"; titleFrom: "plan.dimensions[].name" }
  | {
      kind: "optional";
      key: string;
      title: string;
      bodySource: SlotBodySource;
    };

export interface ReportTemplate {
  /** template id 用于 metrics / observability / sanitizerVersion 关联 */
  id: string;
  slots: ReportTemplateSlot[];
}

/**
 * ReportSegments —— writer / 各 stage 产出后的"段集合"
 * StructuralReportAssembler 的输入；与具体业务（任何 ai-app 报告 stage）解耦。
 */
export interface ReportSegments {
  plan: {
    themeSummary: string;
    /** dimensions[].name 必须已通过 strip-newline + slice(0,200)（B9 安全） */
    dimensions: { id: string; name: string; rationale: string }[];
  };
  bodies: {
    executiveSummary: string;
    preface: string;
    /**
     * v1.4 B7: 按 dimensionId 关联（不依赖数组 index），容忍 partial dim failure
     * - body=null 表示该 dim 章节生成失败（明确建模，禁止 undefined / "")
     * - 不要求 length === plan.dimensions.length（caller 可能丢失某 dim）
     */
    perDimension: Array<{ dimensionId: string; body: string | null }>;
    crossDimAnalysis?: string;
    riskAssessment?: string;
    recommendations?: string;
    conclusion?: string;
    /** ★ Foresight L1：未来推演（Outlook）章节正文，由 foresight 结构确定性渲染 */
    futureOutlook?: string;
  };
  /**
   * ★ PR-quickview-parity (2026-05-09): 结构化 quickView 数据（来源 analyst Output 的同名字段）。
   *   与 bodies 的 prose 章节并行存在：bodies 喂全文章节，quickViewData 喂 ArtifactQuickView 卡片区。
   *   全 optional：缺失时 assembler buildQuickView 兜底空数组，前端卡片短路。
   */
  quickViewData?: {
    keyFindingsByDimension?: {
      dimensionName: string;
      findings: {
        finding: string;
        significance: "high" | "medium" | "low";
      }[];
    }[];
    trendsByDimension?: {
      dimensionName: string;
      trends: {
        trend: string;
        direction: "increasing" | "decreasing" | "stable" | "emerging";
        timeframe: string;
      }[];
    }[];
    riskMatrix?: {
      riskType: string;
      probability: "高" | "中" | "低";
      impact: "高" | "中" | "低";
      timeframe: string;
    }[];
    recommendationsByAudience?: {
      forEnterprise?: { shortTerm: string[]; midTerm: string[] };
      forInvestors?: { shortTerm: string[]; midTerm: string[] };
    };
    whatYouWillLearn?: string[];
    /** insights 透传，供 buildQuickView 兜底生成 topHighlights */
    insights?: {
      headline: string;
      narrative: string;
      supportingDimensions: string[];
      confidence: number;
    }[];
    /** ★ Foresight L1：结构化前瞻判断，供 buildQuickView 派生"未来推演"卡片 */
    foresight?: {
      baseCase: {
        judgment: string;
        probability: number;
        confidence: "low" | "moderate" | "high";
        horizon: "0-6m" | "6-18m" | "18m-3y" | "3y+";
        resolutionCriteria: string;
        baseRate?: string;
        evidenceIds: string[];
      }[];
      scenarios: {
        kind: "bull" | "base" | "bear";
        narrative: string;
        trigger: string;
        probability: number;
      }[];
      predeterminedElements: string[];
      criticalUncertainties: string[];
      leadingIndicators: { signal: string; watchFor: string }[];
    };
  };
  citations: ArtifactCitation[];
  figures: ArtifactFigure[];
  factTable: ArtifactFactTriple[];
  metadata: ArtifactMetadata;
  /**
   * 业务无关 quality 反馈
   * scopeKey: 调方自定义维度键（dim id / segment id / freeform），harness 不感知业务名
   */
  qualityInputs: {
    verifierScores: Record<string, number>;
    warnings: Array<{
      severity: "warn" | "error";
      scopeKey: string;
      message: string;
    }>;
    coverageBySegment?: Record<string, number>;
  };
  /** 不传则用 MULTI_DIMENSION_REPORT_TEMPLATE */
  template?: ReportTemplate;
}

/**
 * 多维度报告模板（多 dim research / report 类 stage 默认）
 * 原 v1.2 名 DEEP_RESEARCH_TEMPLATE，v1.3 改中性词 MULTI_DIMENSION_REPORT_TEMPLATE
 */
export const MULTI_DIMENSION_REPORT_TEMPLATE: ReportTemplate = {
  id: "multi-dimension-report@v1",
  slots: [
    {
      kind: "fixed",
      key: "execSummary",
      title: "执行摘要",
      bodySource: { kind: "fromBodies", field: "executiveSummary" },
    },
    // ★ 2026-05-07 hotfix（mission c195035f 暴露）：preface 从 fixed → optional。
    //   Why：当前 leader signoff 没有 stage 把 leaderForeword wire 到 segments.bodies.preface，
    //   fixed 总产出 section 但 body 全空 → 触发 S11 chapter_content_incomplete guard
    //   (MIN_NON_EMPTY_SECTION_CHARS=40) → markFailed → report 不落 DB。
    //   How：optional + fromBuilder('foreword-preface') 已 resolveBuilderHasContent
    //   检查 segments.bodies.preface?.trim()，空时 expectedSectionCount 与 assembler
    //   都跳过该 slot，sectionCountMismatch 保持一致。后续 leader signoff stage 真
    //   wire foreword 时，optional 自动升起为 section（无需改回 fixed）。
    {
      kind: "optional",
      key: "preface",
      title: "前言",
      bodySource: { kind: "fromBuilder", builder: "foreword-preface" },
    },
    {
      kind: "fixed",
      key: "toc",
      title: "目录",
      bodySource: { kind: "fromBuilder", builder: "toc" },
    },
    {
      kind: "loop",
      key: "perDimension",
      titleFrom: "plan.dimensions[].name",
    },
    {
      kind: "optional",
      key: "crossDim",
      title: "跨维度分析",
      bodySource: { kind: "fromBodies", field: "crossDimAnalysis" },
    },
    {
      kind: "optional",
      key: "risk",
      title: "风险评估",
      bodySource: { kind: "fromBodies", field: "riskAssessment" },
    },
    {
      kind: "optional",
      key: "recommendations",
      title: "战略建议",
      bodySource: { kind: "fromBuilder", builder: "foreword-recommendations" },
    },
    // ★ Foresight L1：未来推演章节（基准判断 / 情景 / 早期信号），缺失时 optional 自动跳过
    {
      kind: "optional",
      key: "outlook",
      title: "未来推演",
      bodySource: { kind: "fromBodies", field: "futureOutlook" },
    },
    {
      kind: "optional",
      key: "conclusion",
      title: "结论",
      bodySource: { kind: "fromBuilder", builder: "foreword-conclusion" },
    },
    {
      kind: "fixed",
      key: "references",
      title: "参考文献",
      bodySource: { kind: "fromBuilder", builder: "references" },
    },
  ],
};

/** Single-agent ReAct freeform 模板（custom-agents 形态） */
export const SINGLE_AGENT_FREEFORM_TEMPLATE: ReportTemplate = {
  id: "single-agent-freeform@v1",
  slots: [
    {
      kind: "fixed",
      key: "body",
      title: "回复",
      bodySource: { kind: "fromBodies", field: "executiveSummary" },
    },
  ],
};

/**
 * 计算给定 (template, segments) 的期望 sections 数量
 * spec 用此函数做 invariant 断言，避免硬编码 +9 公式仅对 deep-research 形态成立
 */
export function expectedSectionCount(
  template: ReportTemplate,
  segments: ReportSegments,
): number {
  let count = 0;
  for (const slot of template.slots) {
    if (slot.kind === "fixed") {
      count += 1;
    } else if (slot.kind === "loop" && slot.key === "perDimension") {
      // perDimension 总是按 plan.dimensions.length 计入（缺失 body 由占位文字补，section 仍存在）
      count += segments.plan.dimensions.length;
    } else if (slot.kind === "optional") {
      const present =
        slot.bodySource.kind === "fromBodies"
          ? Boolean(segments.bodies[slot.bodySource.field]?.toString().trim())
          : resolveBuilderHasContent(slot.bodySource.builder, segments);
      if (present) count += 1;
    }
  }
  return count;
}

function resolveBuilderHasContent(
  builder: Extract<SlotBodySource, { kind: "fromBuilder" }>["builder"],
  segments: ReportSegments,
): boolean {
  // PR-A2 完整实现时连接 ForewordBuilder / TocBuilder / ReferencesBuilder
  // PR-A0 阶段提供保守判断：foreword-* 看 bodies 对应字段；toc / references 总是 true
  switch (builder) {
    case "toc":
    case "references":
      return true;
    case "foreword-preface":
      return Boolean(segments.bodies.preface?.trim());
    case "foreword-conclusion":
      return Boolean(segments.bodies.conclusion?.trim());
    case "foreword-recommendations":
      return Boolean(segments.bodies.recommendations?.trim());
    default: {
      const _exhaustive: never = builder;
      void _exhaustive;
      return false;
    }
  }
}
