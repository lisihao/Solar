/**
 * report-assembler.helper —— s8/s9b 富组装与评估的纯映射工具（无副作用，无 LLM）。
 *
 * 职责（把 crossStageState 里的产物映射成 harness 富服务的入参形状）：
 *   - buildAssembleInput：writer report + researcherResults + plan + analyst + usage
 *     → ReportArtifactAssembler.assemble 的 AssembleInput。
 *   - buildChapterInputs：reportArtifact.sections → ReportEvaluation 的 ChapterInput[]。
 *   - buildCriticArtifactSummary：reportArtifact → critic agent 的 artifactSummary。
 *   - sectionsToMarkdown：把 reportArtifact.sections 回写成 fullMarkdown（s8b 段落替换用）。
 *
 * 设计：所有函数纯映射，bindings 据此组合 harness 富服务；零 app import、零 DB、零 LLM。
 */
import type { ChapterInput } from "@/modules/ai-harness/facade";

/**
 * ReportArtifactAssembler.assemble 的入参形状（本地结构副本）。
 *
 * 说明：harness facade 当前**未导出** `AssembleInput` 类型（只导出了
 * ReportArtifactAssembler 服务类与 ReportArtifact 输出类型）。本地按 assemble 形参
 * 结构镜像一份，使 buildAssembleInput 返回值在 bindings 调 assemble(input) 时结构兼容。
 * 待主 Agent 在 ai-harness/facade 补 `export type { AssembleInput }` 后，本地副本可删，
 * 改为直接 import（见返回里的「需主 Agent 补的 facade 导出」）。
 */
export interface AssembleInput {
  topic: string;
  language: "zh-CN" | "en-US";
  styleProfile: "academic" | "executive" | "journalistic" | "technical";
  lengthProfile: "brief" | "standard" | "deep" | "extended" | "epic" | "mega";
  audienceProfile: "executive" | "domain-expert" | "general-public";
  searchTimeRange?: "30d" | "90d" | "180d" | "365d" | "730d" | "all";
  plan: {
    themeSummary: string;
    dimensions: { id: string; name: string; rationale: string }[];
  };
  researcherResults: Array<{
    dimension: string;
    findings: Array<{
      claim: string;
      evidence: string;
      source: string;
      sourceTitle?: string;
      sourceSnippet?: string;
      sourcePublishedAt?: string;
    }>;
    summary: string;
    // per-dim chapter pipeline 产出（assembler 优先用作正文，避免被压成摘要）。
    // 能力轨单发 writer 当前不产此字段，但运行时若存在则透传不丢（对齐基线优先路径）。
    fullMarkdown?: string;
    chapters?: Array<{
      index: number;
      heading: string;
      body: string;
      wordCount: number;
      figureReferences?: Array<{
        figureId: string;
        anchorParagraph?: number;
        caption?: string;
      }>;
    }>;
    figureCandidates?: Array<{
      sourceUrl: string;
      imageUrl?: string;
      caption: string;
      sourcePageOrSection?: string;
      relevanceHint?: "high" | "medium" | "low";
    }>;
  }>;
  analyst?: {
    themeSummary?: string;
    keyInsights?: { title?: string; oneLine?: string }[];
    contradictions?: unknown[];
    gaps?: unknown[];
    preface?: string;
    crossDimAnalysis?: string;
    riskAssessment?: string;
    strategicRecommendations?: string;
  };
  writerReport: {
    title: string;
    summary: string;
    sections: { heading: string; body: string; sources?: string[] }[];
    conclusion: string;
    citations?: string[];
  };
  reconciliationReport?: {
    factTable: {
      id: string;
      entity: string;
      attribute: string;
      value: string;
      sources: string[];
    }[];
    conflicts: {
      factIds: string[];
      resolutionType: "kept-both" | "preferred-one" | "flagged-unresolved";
      preferredFactId?: string;
      rationale: string;
    }[];
  };
  generationTimeMs: number;
  totalTokens: { prompt: number; completion: number; total: number };
  costCents: number;
  modelTrail: string[];
}

/** plan 阶段产物（与 bindings 内同形）。 */
export interface PlanShape {
  themeSummary: string;
  dimensions: { id: string; name: string; rationale: string }[];
}

/** 单维 researcher 产物（findings + summary + 可选 per-dim 章节正文 + 图候选）。 */
export interface ResearcherShape {
  dimension: string;
  findings: Array<{
    claim?: string;
    evidence?: string;
    source?: string;
    sourceTitle?: string;
    sourceSnippet?: string;
    sourcePublishedAt?: string;
  }>;
  summary: string;
  // per-dim chapter pipeline 产物（运行时若存在则透传给 assembler 的 fullMarkdown 优先路径）。
  fullMarkdown?: string;
  chapters?: Array<{
    index: number;
    heading: string;
    body: string;
    wordCount: number;
    figureReferences?: Array<{
      figureId: string;
      anchorParagraph?: number;
      caption?: string;
    }>;
  }>;
  figureCandidates?: Array<{
    sourceUrl: string;
    imageUrl?: string;
    caption: string;
    sourcePageOrSection?: string;
    relevanceHint?: "high" | "medium" | "low";
  }>;
}

/** writer 阶段产物（ResearchReport schema 形状）。 */
export interface WriterReportShape {
  title?: string;
  summary?: string;
  sections?: Array<{
    heading?: string;
    title?: string;
    body?: string;
    sources?: string[];
  }>;
  conclusion?: string;
  citations?: string[];
}

/** analyst 阶段产物（report-structure 字段 + insights）。 */
export interface AnalystShape {
  themeSummary?: string;
  insights?: Array<{
    headline?: string;
    title?: string;
    narrative?: string;
    oneLine?: string;
  }>;
  contradictions?: unknown[];
  gaps?: unknown[];
  preface?: string;
  crossDimAnalysis?: string;
  riskAssessment?: string;
  strategicRecommendations?: string;
}

/**
 * 报告档位（从 invocation 透传到 assembler metadata profile）。
 * style/length/audience 优先用用户在 Dialog 选定的档位，缺省才回退。
 */
export interface ProfileShape {
  topic: string;
  language: "zh-CN" | "en-US";
  depth?: "quick" | "standard" | "deep";
  /** 用户选定的风格档位（CapabilityRunInput.styleProfile 透传）。 */
  styleProfile?: string;
  /** 用户选定的长度档位（CapabilityRunInput.lengthProfile 透传，优先于 depth 映射）。 */
  lengthProfile?: string;
  /** 用户选定的受众档位（CapabilityRunInput.audienceProfile 透传）。 */
  audienceProfile?: string;
  /** 搜索时效窗口（CapabilityRunInput.searchTimeRange 透传）。 */
  searchTimeRange?: "30d" | "90d" | "180d" | "365d" | "730d" | "all";
}

/** S5 reconciler 产物（factTable + conflicts，喂 assembler buildFactTable / 质量评分）。 */
export interface ReconciliationShape {
  factTable?: Array<{
    id?: string;
    entity?: string;
    attribute?: string;
    value?: string;
    sources?: string[];
  }>;
  conflicts?: Array<{
    factIds?: string[];
    resolutionType?: "kept-both" | "preferred-one" | "flagged-unresolved";
    preferredFactId?: string;
    rationale?: string;
  }>;
}

/** 用量（算力 trail，assembler metadata 用）。 */
export interface UsageShape {
  totalTokens: number;
  totalCostCents: number;
  generationTimeMs: number;
}

/** depth → assembler lengthProfile（用户未显式选 lengthProfile 时的回退映射）。 */
function lengthProfileFor(
  depth: ProfileShape["depth"],
): AssembleInput["lengthProfile"] {
  switch (depth) {
    case "quick":
      return "brief";
    case "deep":
      return "deep";
    default:
      return "standard";
  }
}

const STYLE_PROFILES: ReadonlySet<AssembleInput["styleProfile"]> = new Set([
  "academic",
  "executive",
  "journalistic",
  "technical",
]);
const LENGTH_PROFILES: ReadonlySet<AssembleInput["lengthProfile"]> = new Set([
  "brief",
  "standard",
  "deep",
  "extended",
  "epic",
  "mega",
]);
const AUDIENCE_PROFILES: ReadonlySet<AssembleInput["audienceProfile"]> =
  new Set(["executive", "domain-expert", "general-public"]);

/** 用户档位归一：合法枚举值原样透传，非法/缺省回退到基线默认。 */
function styleProfileFrom(
  raw: string | undefined,
): AssembleInput["styleProfile"] {
  return raw && STYLE_PROFILES.has(raw as AssembleInput["styleProfile"])
    ? (raw as AssembleInput["styleProfile"])
    : "academic";
}
function lengthProfileFrom(
  raw: string | undefined,
  depth: ProfileShape["depth"],
): AssembleInput["lengthProfile"] {
  return raw && LENGTH_PROFILES.has(raw as AssembleInput["lengthProfile"])
    ? (raw as AssembleInput["lengthProfile"])
    : lengthProfileFor(depth);
}
function audienceProfileFrom(
  raw: string | undefined,
): AssembleInput["audienceProfile"] {
  return raw && AUDIENCE_PROFILES.has(raw as AssembleInput["audienceProfile"])
    ? (raw as AssembleInput["audienceProfile"])
    : "domain-expert";
}

/**
 * 把 crossStageState 产物组装成 ReportArtifactAssembler 的入参。
 * 缺字段时给安全默认（assembler 内部对空 sections/figures 已做兜底）。
 */
export function buildAssembleInput(args: {
  profile: ProfileShape;
  plan: PlanShape | undefined;
  researcherResults: ResearcherShape[];
  analyst: AnalystShape | undefined;
  writerReport: WriterReportShape | undefined;
  reconciliation: ReconciliationShape | undefined | null;
  usage: UsageShape;
  modelTrail: string[];
}): AssembleInput {
  const {
    profile,
    plan,
    researcherResults,
    analyst,
    writerReport,
    reconciliation,
    usage,
    modelTrail,
  } = args;
  const themeSummary =
    analyst?.themeSummary ?? plan?.themeSummary ?? profile.topic;

  return {
    topic: profile.topic,
    language: profile.language,
    // 用户在 Dialog 选定的档位优先透传，非法/缺省才回退基线默认（不再硬编码）。
    styleProfile: styleProfileFrom(profile.styleProfile),
    lengthProfile: lengthProfileFrom(profile.lengthProfile, profile.depth),
    audienceProfile: audienceProfileFrom(profile.audienceProfile),
    ...(profile.searchTimeRange
      ? { searchTimeRange: profile.searchTimeRange }
      : {}),
    plan: {
      themeSummary,
      dimensions: (plan?.dimensions ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        rationale: d.rationale ?? "",
      })),
    },
    researcherResults: researcherResults.map((r) => ({
      dimension: r.dimension,
      findings: (r.findings ?? []).map((f) => ({
        claim: f.claim ?? "",
        evidence: f.evidence ?? "",
        source: f.source ?? "",
        ...(f.sourceTitle ? { sourceTitle: f.sourceTitle } : {}),
        ...(f.sourceSnippet ? { sourceSnippet: f.sourceSnippet } : {}),
        ...(f.sourcePublishedAt
          ? { sourcePublishedAt: f.sourcePublishedAt }
          : {}),
      })),
      summary: r.summary ?? "",
      // per-dim chapter pipeline 产物透传（运行时存在则走 assembler fullMarkdown 优先路径，
      // 避免被压成摘要；能力轨单发 writer 暂不产此字段，缺省即省略，由 writer.sections 兜底）。
      ...(r.fullMarkdown ? { fullMarkdown: r.fullMarkdown } : {}),
      ...(r.chapters?.length ? { chapters: r.chapters } : {}),
      ...(r.figureCandidates?.length
        ? { figureCandidates: r.figureCandidates }
        : {}),
    })),
    analyst: {
      ...(analyst?.themeSummary ? { themeSummary: analyst.themeSummary } : {}),
      keyInsights: (analyst?.insights ?? []).map((i) => ({
        ...((i.headline ?? i.title) ? { title: i.headline ?? i.title } : {}),
        ...((i.oneLine ?? i.narrative)
          ? { oneLine: i.oneLine ?? i.narrative }
          : {}),
      })),
      ...(analyst?.contradictions
        ? { contradictions: analyst.contradictions }
        : {}),
      ...(analyst?.gaps ? { gaps: analyst.gaps } : {}),
      ...(analyst?.preface ? { preface: analyst.preface } : {}),
      ...(analyst?.crossDimAnalysis
        ? { crossDimAnalysis: analyst.crossDimAnalysis }
        : {}),
      ...(analyst?.riskAssessment
        ? { riskAssessment: analyst.riskAssessment }
        : {}),
      ...(analyst?.strategicRecommendations
        ? { strategicRecommendations: analyst.strategicRecommendations }
        : {}),
    },
    writerReport: {
      title: writerReport?.title ?? profile.topic,
      summary: writerReport?.summary ?? themeSummary,
      sections: (writerReport?.sections ?? []).map((s) => ({
        heading: s.heading ?? s.title ?? "",
        body: s.body ?? "",
        ...(s.sources ? { sources: s.sources } : {}),
      })),
      conclusion: writerReport?.conclusion ?? "",
      ...(writerReport?.citations ? { citations: writerReport.citations } : {}),
    },
    // S5 对账产物接入：让 assembler buildFactTable 产出事实表 + 喂质量评分；
    // factTable 缺省（reconciler 跳过/失败）则省略，assembler 内部对 undefined 返空表兜底。
    ...(reconciliation?.factTable?.length
      ? {
          reconciliationReport: {
            factTable: (reconciliation.factTable ?? []).map((f) => ({
              id: f.id ?? "",
              entity: f.entity ?? "",
              attribute: f.attribute ?? "",
              value: f.value ?? "",
              sources: f.sources ?? [],
            })),
            conflicts: (reconciliation.conflicts ?? []).map((c) => ({
              factIds: c.factIds ?? [],
              resolutionType: c.resolutionType ?? "kept-both",
              ...(c.preferredFactId
                ? { preferredFactId: c.preferredFactId }
                : {}),
              rationale: c.rationale ?? "",
            })),
          },
        }
      : {}),
    generationTimeMs: usage.generationTimeMs,
    totalTokens: {
      prompt: 0,
      completion: 0,
      total: usage.totalTokens,
    },
    costCents: usage.totalCostCents,
    // 真实模型轨迹（agent-invoke.helper 去重累积进 CS_KEY.modelTrail），
    // 不依赖 token 回报、不硬编码模型名；缺省即空数组。
    modelTrail: [...modelTrail],
  };
}

/** reportArtifact section 的最小投影（assembler 输出 ArtifactSection 子集）。 */
interface ArtifactSectionLite {
  id?: string;
  title?: string;
  heading?: string;
  content?: string;
  body?: string;
  citationIds?: unknown[];
}

export interface ReportArtifactLite {
  title?: string;
  content?: { fullMarkdown?: string; fullReportSize?: number };
  sections?: ArtifactSectionLite[];
  citations?: unknown[];
  figures?: unknown[];
  quality?: { overall?: number; dimensions?: Record<string, unknown> };
  metadata?: Record<string, unknown>;
  quickView?: { foresight?: unknown };
}

/** ArtifactSectionLite 公开（s8b 补救逐 section 读写用）。 */
export type { ArtifactSectionLite };

/** 安全把 unknown 当 reportArtifact 读。 */
export function asArtifact(raw: unknown): ReportArtifactLite | undefined {
  return raw && typeof raw === "object"
    ? (raw as ReportArtifactLite)
    : undefined;
}

/**
 * reportArtifact.sections → ReportEvaluation 的 ChapterInput[]。
 * writerModel 用占位（能力内核无逐章 model trail）；sourcesUsed 用 citationIds 数。
 */
export function buildChapterInputs(
  artifact: ReportArtifactLite | undefined,
): ChapterInput[] {
  const sections = artifact?.sections ?? [];
  return sections
    .map((s, i) => ({
      chapterId: s.id ?? `chapter-${i + 1}`,
      chapterTitle: s.title ?? s.heading ?? `章节 ${i + 1}`,
      writerModel: "",
      content: s.content ?? s.body ?? "",
      sourcesUsed: Array.isArray(s.citationIds) ? s.citationIds.length : 0,
    }))
    .filter((c) => c.content.length > 0);
}

/** reportArtifact → critic agent 的 artifactSummary（量化锚点，非全文）。 */
export function buildCriticArtifactSummary(
  artifact: ReportArtifactLite | undefined,
  topic: string,
): Record<string, unknown> {
  const sections = artifact?.sections ?? [];
  const sectionTitles = sections.map((s) => s.title ?? s.heading ?? "");
  return {
    title: artifact?.title ?? topic,
    executiveSummary: "",
    sectionCount: sectionTitles.length,
    sectionTitles,
    citationCount: artifact?.citations?.length ?? 0,
    factCount: 0,
    figureCount: artifact?.figures?.length ?? 0,
    overallQuality:
      typeof artifact?.quality?.overall === "number"
        ? artifact.quality.overall
        : 70,
    qualityDimensions: artifact?.quality?.dimensions ?? {},
  };
}
