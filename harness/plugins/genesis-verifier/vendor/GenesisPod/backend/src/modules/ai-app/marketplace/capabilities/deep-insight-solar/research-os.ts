export const RESEARCH_OS_SCHEMA_VERSION = "deep-insight-solar.research-os.v1";

export const RESEARCH_OS_ASSET_TYPES = [
  "evidenceCard",
  "evolutionEvent",
  "stackNode",
  "interfaceEdge",
  "actorCard",
  "sotaFinding",
  "bottleneckCard",
  "contradiction",
  "weakSignal",
  "opportunityHypothesis",
] as const;

export type ResearchOsAssetType = (typeof RESEARCH_OS_ASSET_TYPES)[number];

export interface TechnologyInsightPlan {
  schemaVersion: typeof RESEARCH_OS_SCHEMA_VERSION;
  centralQuestion: string;
  initialTheses: string[];
  researchQuestions: string[];
  workstreams: Array<{
    id: string;
    name: string;
    objective: string;
    assetTypes: ResearchOsAssetType[];
  }>;
  mandatoryArtifacts: ResearchOsAssetType[];
  sourcePolicy: Record<string, unknown>;
  coverageRequirements: Record<string, unknown>;
  falsificationQuestions: string[];
}

export interface ResearchAsset {
  id: string;
  type: ResearchOsAssetType;
  title: string;
  summary: string;
  evidenceIds: string[];
  sourceUrls: string[];
  workstreamId?: string;
  confidence?: "verified" | "inferred" | "hypothesis" | "gap";
  payload?: Record<string, unknown>;
}

export interface ResearchAssetLedger {
  schemaVersion: typeof RESEARCH_OS_SCHEMA_VERSION;
  assets: ResearchAsset[];
  evidenceCards: ResearchAsset[];
  sourceCount: number;
  assetTypeCounts: Record<ResearchOsAssetType, number>;
}

export interface CoverageReport {
  schemaVersion: typeof RESEARCH_OS_SCHEMA_VERSION;
  ok: boolean;
  missingAssetTypes: ResearchOsAssetType[];
  blockers: string[];
  warnings: string[];
  repairPackets: RepairPacket[];
}

export interface RepairPacket {
  id: string;
  reason: string;
  targetAssetTypes: ResearchOsAssetType[];
  prompt: string;
}

export interface ThesisGraph {
  schemaVersion: typeof RESEARCH_OS_SCHEMA_VERSION;
  theses: Array<{
    id: string;
    statement: string;
    mechanism: string;
    evidenceIds: string[];
    counterEvidenceIds: string[];
    limitations: string[];
    architectureImplications: string[];
    opportunityImplications: string[];
  }>;
  claimEdges: Array<Record<string, unknown>>;
  evidenceBindings: Array<Record<string, unknown>>;
  counterEvidence: Array<Record<string, unknown>>;
  openQuestions: string[];
  reportOutline: Array<{ id: string; title: string; thesisIds: string[] }>;
}

export interface EvidenceBook {
  evidenceCards: ResearchAsset[];
  assets: ResearchAsset[];
  sourceCount: number;
}

export interface ReportPackage {
  schemaVersion: typeof RESEARCH_OS_SCHEMA_VERSION;
  executiveBriefMarkdown: string;
  standardReportMarkdown: string;
  evidenceBook: EvidenceBook;
}

export interface InsightRubricResult {
  schemaVersion: typeof RESEARCH_OS_SCHEMA_VERSION;
  ok: boolean;
  blockers: string[];
  warnings: string[];
  checks: Array<{
    id: string;
    status: "passed" | "failed" | "warn";
    message: string;
  }>;
}

const DEFAULT_MANDATORY_ASSETS: ResearchOsAssetType[] = [
  "evidenceCard",
  "evolutionEvent",
  "stackNode",
  "actorCard",
  "sotaFinding",
  "bottleneckCard",
  "contradiction",
  "weakSignal",
  "opportunityHypothesis",
];

export function normalizeTechnologyInsightPlan(
  structured: unknown,
  fallback: { topic: string; markdown?: string },
): TechnologyInsightPlan {
  const obj = asRecord(structured);
  const centralQuestion =
    asText(obj?.centralQuestion) ??
    asText(obj?.coreQuestion) ??
    asText(obj?.themeSummary) ??
    fallback.topic;
  const mandatoryArtifacts = normalizeAssetTypes(
    obj?.mandatoryArtifacts,
    DEFAULT_MANDATORY_ASSETS,
  );
  const workstreams = normalizeWorkstreams(obj, mandatoryArtifacts, fallback.topic);
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    centralQuestion,
    initialTheses: asTextArray(obj?.initialTheses ?? obj?.theses),
    researchQuestions: asTextArray(obj?.researchQuestions ?? obj?.questions),
    workstreams,
    mandatoryArtifacts,
    sourcePolicy: asRecord(obj?.sourcePolicy) ?? {},
    coverageRequirements: asRecord(obj?.coverageRequirements) ?? {},
    falsificationQuestions: asTextArray(obj?.falsificationQuestions),
  };
}

export function buildLegacyPlanFromTechnologyInsightPlan(
  plan: TechnologyInsightPlan,
): {
  themeSummary: string;
  dimensions: Array<{ id: string; name: string; rationale: string }>;
} {
  return {
    themeSummary: plan.centralQuestion,
    dimensions: plan.workstreams.map((workstream) => ({
      id: workstream.id,
      name: workstream.name,
      rationale: workstream.objective,
    })),
  };
}

export function normalizeResearchAssetLedger(
  structured: unknown,
  fallback: { workstreamId?: string; workstreamName?: string; markdown?: string },
): ResearchAssetLedger {
  const obj = asRecord(structured);
  const rawAssets = [
    ...asArray(obj?.assets),
    ...asArray(obj?.researchAssets),
    ...asArray(obj?.evidenceCards).map((item) => ({ type: "evidenceCard", ...asRecord(item) })),
    ...asArray(obj?.evolutionLedger ?? obj?.evolutionEvents).map((item) => ({
      type: "evolutionEvent",
      ...asRecord(item),
    })),
    ...asArray(obj?.architectureStackMap ?? obj?.stackNodes).map((item) => ({
      type: "stackNode",
      ...asRecord(item),
    })),
    ...asArray(obj?.interfaceEdges).map((item) => ({
      type: "interfaceEdge",
      ...asRecord(item),
    })),
    ...asArray(obj?.actorGraph ?? obj?.actorCards).map((item) => ({
      type: "actorCard",
      ...asRecord(item),
    })),
    ...asArray(obj?.sotaRouteMap ?? obj?.sotaFindings).map((item) => ({
      type: "sotaFinding",
      ...asRecord(item),
    })),
    ...asArray(obj?.bottleneckLedger ?? obj?.bottleneckCards).map((item) => ({
      type: "bottleneckCard",
      ...asRecord(item),
    })),
    ...asArray(obj?.contradictionMatrix ?? obj?.contradictions).map((item) => ({
      type: "contradiction",
      ...asRecord(item),
    })),
    ...asArray(obj?.weakSignalLedger ?? obj?.weakSignals).map((item) => ({
      type: "weakSignal",
      ...asRecord(item),
    })),
    ...asArray(obj?.opportunityMap ?? obj?.opportunityHypotheses).map((item) => ({
      type: "opportunityHypothesis",
      ...asRecord(item),
    })),
  ];
  const assets = rawAssets
    .map((raw, index) =>
      normalizeResearchAsset(raw, index, {
        workstreamId: fallback.workstreamId,
        workstreamName: fallback.workstreamName,
      }),
    )
    .filter((asset): asset is ResearchAsset => !!asset);
  const markdownEvidence = extractEvidenceAssetsFromMarkdown(
    fallback.markdown,
    fallback.workstreamId,
    fallback.workstreamName,
  );
  return buildResearchAssetLedger([...assets, ...markdownEvidence]);
}

export function mergeResearchAssetLedgers(
  ledgers: Array<ResearchAssetLedger | undefined>,
): ResearchAssetLedger {
  const byKey = new Map<string, ResearchAsset>();
  for (const ledger of ledgers) {
    for (const asset of ledger?.assets ?? []) {
      byKey.set(`${asset.type}:${asset.id}`, asset);
    }
  }
  return buildResearchAssetLedger([...byKey.values()]);
}

export function evaluateResearchCoverage(
  plan: TechnologyInsightPlan | undefined,
  ledger: ResearchAssetLedger | undefined,
): CoverageReport {
  const mandatory = plan?.mandatoryArtifacts ?? DEFAULT_MANDATORY_ASSETS;
  const counts = ledger?.assetTypeCounts ?? emptyAssetTypeCounts();
  const missingAssetTypes = mandatory.filter((type) => (counts[type] ?? 0) <= 0);
  const blockers = missingAssetTypes.map((type) => `缺少 mandatory research asset: ${type}`);
  const warnings: string[] = [];
  const repairPackets = missingAssetTypes.map((type) => ({
    id: `repair-${type}`,
    reason: `missing-${type}`,
    targetAssetTypes: [type],
    prompt: `补齐 ${type}，必须提供 primary evidence、source URL、为什么它影响技术判断。`,
  }));
  if ((ledger?.sourceCount ?? 0) < 3) {
    warnings.push(`source diversity low: ${ledger?.sourceCount ?? 0}/3`);
  }
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    ok: blockers.length === 0,
    missingAssetTypes,
    blockers,
    warnings,
    repairPackets,
  };
}

export function normalizeThesisGraph(
  structured: unknown,
  fallback: { topic: string; ledger?: ResearchAssetLedger },
): ThesisGraph {
  const obj = asRecord(structured);
  const evidenceIds = (fallback.ledger?.evidenceCards ?? []).map((asset) => asset.id);
  const theses = asArray(obj?.theses ?? obj?.coreTheses ?? obj?.insights)
    .map((raw, index) => {
      const item = asRecord(raw);
      const statement =
        asText(item?.statement) ??
        asText(item?.headline) ??
        asText(item?.title) ??
        asText(item?.summary);
      if (!statement) return undefined;
      return {
        id: asText(item?.id) ?? `thesis-${index + 1}`,
        statement,
        mechanism: asText(item?.mechanism) ?? asText(item?.why) ?? "",
        evidenceIds: asTextArray(item?.evidenceIds ?? item?.evidence).filter(Boolean),
        counterEvidenceIds: asTextArray(item?.counterEvidenceIds),
        limitations: asTextArray(item?.limitations ?? item?.limits),
        architectureImplications: asTextArray(item?.architectureImplications),
        opportunityImplications: asTextArray(item?.opportunityImplications),
      };
    })
    .filter((item): item is ThesisGraph["theses"][number] => !!item);
  const safeTheses =
    theses.length > 0
      ? theses
      : [
          {
            id: "thesis-1",
            statement: fallback.topic,
            mechanism: "",
            evidenceIds: evidenceIds.slice(0, 3),
            counterEvidenceIds: [],
            limitations: [],
            architectureImplications: [],
            opportunityImplications: [],
          },
        ];
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    theses: safeTheses,
    claimEdges: asRecordArray(obj?.claimEdges),
    evidenceBindings: asRecordArray(obj?.evidenceBindings),
    counterEvidence: asRecordArray(obj?.counterEvidence),
    openQuestions: asTextArray(obj?.openQuestions),
    reportOutline: normalizeReportOutline(obj?.reportOutline, safeTheses),
  };
}

export function normalizeReportPackage(
  structured: unknown,
  markdown: string | undefined,
  fallback: { topic: string; ledger?: ResearchAssetLedger; thesisGraph?: ThesisGraph },
): ReportPackage {
  const obj = asRecord(structured);
  const sectionsMarkdown = renderSections(obj?.sections ?? obj?.sectionDrafts);
  const rawStandardReportMarkdown =
    asText(obj?.standardReportMarkdown) ??
    asText(obj?.standardReport) ??
    sectionsMarkdown ??
    markdown ??
    "";
  const standardReportMarkdown = ensureAssetThesisMapping(
    rawStandardReportMarkdown,
    fallback.thesisGraph,
  );
  const executiveBriefMarkdown =
    asText(obj?.executiveBriefMarkdown) ??
    asText(obj?.executiveBrief) ??
    asText(obj?.summary) ??
    firstSentences(standardReportMarkdown) ??
    fallback.topic;
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    executiveBriefMarkdown,
    standardReportMarkdown,
    evidenceBook: {
      evidenceCards: fallback.ledger?.evidenceCards ?? [],
      assets: fallback.ledger?.assets ?? [],
      sourceCount: fallback.ledger?.sourceCount ?? 0,
    },
  };
}

function ensureAssetThesisMapping(
  markdown: string,
  thesisGraph: ThesisGraph | undefined,
): string {
  if (/研究资产到论点映射|asset.*thesis.*map/i.test(markdown)) return markdown;
  const theses = thesisGraph?.theses ?? [];
  if (theses.length === 0) return markdown;
  const rows = theses.map((thesis) => {
    const evidence = thesis.evidenceIds.length > 0 ? thesis.evidenceIds.join(", ") : "N/A";
    return `| ${thesis.id} | ${thesis.statement} | ${evidence} |`;
  });
  return [
    "## 研究资产到论点映射",
    "",
    "| Thesis | 核心判断 | Evidence IDs |",
    "|---|---|---|",
    ...rows,
    "",
    markdown,
  ].join("\n");
}

export function reportPackageToWriterReport(
  reportPackage: ReportPackage,
  fallback: { topic: string; citations?: string[] },
): {
  title: string;
  summary: string;
  sections: Array<{ heading: string; body: string; sources: string[]; sourceDimensions: string[] }>;
  conclusion: string;
  citations: string[];
} {
  const sections = splitMarkdownSections(reportPackage.standardReportMarkdown);
  return {
    title: fallback.topic,
    summary: reportPackage.executiveBriefMarkdown,
    sections:
      sections.length > 0
        ? sections
        : [{ heading: "Standard Report", body: reportPackage.standardReportMarkdown, sources: [], sourceDimensions: [] }],
    conclusion: "",
    citations:
      fallback.citations ??
      reportPackage.evidenceBook.evidenceCards.flatMap((asset) => asset.sourceUrls),
  };
}

export function evaluateInsightRubric(args: {
  plan?: TechnologyInsightPlan;
  ledger?: ResearchAssetLedger;
  thesisGraph?: ThesisGraph;
  reportPackage?: ReportPackage;
  coverage?: CoverageReport;
}): InsightRubricResult {
  const checks: InsightRubricResult["checks"] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const add = (
    id: string,
    passed: boolean,
    message: string,
    severity: "blocker" | "warn" = "blocker",
  ) => {
    const status = passed ? "passed" : severity === "blocker" ? "failed" : "warn";
    checks.push({ id, status, message });
    if (!passed && severity === "blocker") blockers.push(message);
    if (!passed && severity === "warn") warnings.push(message);
  };
  const counts = args.ledger?.assetTypeCounts ?? emptyAssetTypeCounts();
  add("evolution-completeness", (counts.evolutionEvent ?? 0) > 0, "缺少技术演进账本");
  add("architecture-depth", (counts.stackNode ?? 0) > 0, "缺少架构栈节点");
  add("ecosystem-completeness", (counts.actorCard ?? 0) > 0, "缺少 Actor Graph");
  add("counter-evidence", (counts.contradiction ?? 0) > 0, "缺少反例/矛盾矩阵");
  add("weak-signals", (counts.weakSignal ?? 0) > 0, "缺少弱信号账本", "warn");
  add("opportunity-quality", (counts.opportunityHypothesis ?? 0) > 0, "缺少机会假设", "warn");
  const theses = args.thesisGraph?.theses ?? [];
  add("thesis-graph-present", theses.length > 0, "缺少 ThesisGraph");
  add(
    "evidence-backed-theses",
    theses.length > 0 && theses.every((thesis) => thesis.evidenceIds.length > 0),
    "存在无 evidence 绑定的核心 thesis",
  );
  const reportChars =
    (args.reportPackage?.standardReportMarkdown.length ?? 0) +
    (args.reportPackage?.executiveBriefMarkdown.length ?? 0);
  add("report-not-empty", reportChars >= 1200, `报告正文过短：${reportChars}/1200 chars`);
  for (const blocker of args.coverage?.blockers ?? []) {
    add(`coverage-${checks.length + 1}`, false, blocker);
  }
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    ok: blockers.length === 0,
    blockers,
    warnings,
    checks,
  };
}

function normalizeWorkstreams(
  obj: Record<string, unknown> | undefined,
  mandatoryArtifacts: ResearchOsAssetType[],
  topic: string,
): TechnologyInsightPlan["workstreams"] {
  const rawWorkstreams = asArray(obj?.workstreams);
  const workstreams = rawWorkstreams
    .map((raw, index) => {
      const item = asRecord(raw);
      const name = asText(item?.name) ?? asText(item?.title);
      if (!name) return undefined;
      return {
        id: asText(item?.id) ?? slugId(name, `workstream-${index + 1}`),
        name,
        objective: asText(item?.objective) ?? asText(item?.rationale) ?? name,
        assetTypes: normalizeAssetTypes(item?.assetTypes, mandatoryArtifacts),
      };
    })
    .filter((item): item is TechnologyInsightPlan["workstreams"][number] => !!item);
  if (workstreams.length > 0) return workstreams;
  const dimensions = asArray(obj?.dimensions)
    .map((raw, index) => {
      const item = asRecord(raw);
      const name = asText(item?.name) ?? asText(item?.title);
      if (!name) return undefined;
      return {
        id: asText(item?.id) ?? slugId(name, `workstream-${index + 1}`),
        name,
        objective: asText(item?.rationale) ?? asText(item?.description) ?? name,
        assetTypes: mandatoryArtifacts,
      };
    })
    .filter((item): item is TechnologyInsightPlan["workstreams"][number] => !!item);
  return dimensions.length > 0
    ? dimensions
    : [
        {
          id: "workstream-core",
          name: "核心问题驱动研究",
          objective: topic,
          assetTypes: mandatoryArtifacts,
        },
      ];
}

function normalizeResearchAsset(
  raw: unknown,
  index: number,
  fallback: { workstreamId?: string; workstreamName?: string },
): ResearchAsset | undefined {
  const item = asRecord(raw);
  const type = normalizeAssetType(item?.type);
  if (!type) return undefined;
  const title =
    asText(item?.title) ??
    asText(item?.headline) ??
    asText(item?.claim) ??
    asText(item?.name) ??
    fallback.workstreamName;
  const summary =
    asText(item?.summary) ??
    asText(item?.evidence) ??
    asText(item?.description) ??
    asText(item?.body);
  if (!title || !summary) return undefined;
  const sourceUrls = asTextArray(item?.sourceUrls ?? item?.sources ?? item?.url ?? item?.source)
    .filter((value) => /^https?:\/\//.test(value));
  const evidenceIds = asTextArray(item?.evidenceIds ?? item?.evidenceId);
  return {
    id: asText(item?.id) ?? `${type}-${index + 1}`,
    type,
    title,
    summary,
    evidenceIds,
    sourceUrls,
    ...(fallback.workstreamId ? { workstreamId: fallback.workstreamId } : {}),
    ...(normalizeConfidence(item?.confidence) ? { confidence: normalizeConfidence(item?.confidence) } : {}),
    payload: item,
  };
}

function buildResearchAssetLedger(assets: ResearchAsset[]): ResearchAssetLedger {
  const counts = emptyAssetTypeCounts();
  const sourceUrls = new Set<string>();
  for (const asset of assets) {
    counts[asset.type] += 1;
    asset.sourceUrls.forEach((url) => sourceUrls.add(url));
  }
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    assets,
    evidenceCards: assets.filter((asset) => asset.type === "evidenceCard"),
    sourceCount: sourceUrls.size,
    assetTypeCounts: counts,
  };
}

function extractEvidenceAssetsFromMarkdown(
  markdown: string | undefined,
  workstreamId: string | undefined,
  workstreamName: string | undefined,
): ResearchAsset[] {
  if (!markdown) return [];
  const urls = [
    ...new Set(
      [...markdown.matchAll(/https?:\/\/[^\s"'，。)）\]}]+/g)].map(
        (match) => match[0],
      ),
    ),
  ];
  return urls.slice(0, 12).map((url, index) => ({
    id: `markdown-evidence-${index + 1}`,
    type: "evidenceCard",
    title: workstreamName ?? `Evidence ${index + 1}`,
    summary: `Markdown evidence recovered from ${url}`,
    evidenceIds: [],
    sourceUrls: [url],
    ...(workstreamId ? { workstreamId } : {}),
    confidence: "gap",
  }));
}

function normalizeAssetTypes(value: unknown, fallback: ResearchOsAssetType[]): ResearchOsAssetType[] {
  const types = asTextArray(value)
    .map(normalizeAssetType)
    .filter((item): item is ResearchOsAssetType => !!item);
  return types.length > 0 ? [...new Set(types)] : fallback;
}

function normalizeAssetType(value: unknown): ResearchOsAssetType | undefined {
  if (typeof value !== "string") return undefined;
  return RESEARCH_OS_ASSET_TYPES.find((type) => type === value);
}

function normalizeConfidence(value: unknown): ResearchAsset["confidence"] | undefined {
  return value === "verified" || value === "inferred" || value === "hypothesis" || value === "gap"
    ? value
    : undefined;
}

function emptyAssetTypeCounts(): Record<ResearchOsAssetType, number> {
  return Object.fromEntries(RESEARCH_OS_ASSET_TYPES.map((type) => [type, 0])) as Record<
    ResearchOsAssetType,
    number
  >;
}

function normalizeReportOutline(
  value: unknown,
  theses: ThesisGraph["theses"],
): ThesisGraph["reportOutline"] {
  const outline = asArray(value)
    .map((raw, index) => {
      const item = asRecord(raw);
      const title = asText(item?.title) ?? asText(item?.heading);
      if (!title) return undefined;
      return {
        id: asText(item?.id) ?? `section-${index + 1}`,
        title,
        thesisIds: asTextArray(item?.thesisIds ?? item?.theses),
      };
    })
    .filter((item): item is ThesisGraph["reportOutline"][number] => !!item);
  return outline.length > 0
    ? outline
    : theses.map((thesis, index) => ({
        id: `section-${index + 1}`,
        title: thesis.statement.slice(0, 80),
        thesisIds: [thesis.id],
      }));
}

function renderSections(value: unknown): string | undefined {
  const sections = asArray(value)
    .map((raw, index) => {
      const item = asRecord(raw);
      const heading = asText(item?.heading) ?? asText(item?.title) ?? `章节 ${index + 1}`;
      const body = asText(item?.body) ?? asText(item?.content);
      if (!body) return undefined;
      return `## ${heading}\n\n${body}`;
    })
    .filter((item): item is string => !!item);
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function splitMarkdownSections(
  markdown: string,
): Array<{ heading: string; body: string; sources: string[]; sourceDimensions: string[] }> {
  const chunks = markdown.split(/^##\s+/m);
  if (chunks.length <= 1) {
    return markdown.trim().length > 0
      ? [{ heading: "Research OS Report", body: markdown.trim(), sources: [], sourceDimensions: [] }]
      : [];
  }
  return chunks
    .slice(1)
    .map((chunk) => {
      const [headingLine, ...bodyLines] = chunk.split("\n");
      return {
        heading: headingLine.trim() || "Research OS Section",
        body: bodyLines.join("\n").trim(),
        sources: [],
        sourceDimensions: [],
      };
    })
    .filter((section) => section.body.length > 0);
}

function firstSentences(markdown: string): string | undefined {
  const cleaned = markdown.replace(/^#+\s+/gm, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 600) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return asArray(value).map(asRecord).filter((item): item is Record<string, unknown> => !!item);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asTextArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim().length > 0 ? [value.trim()] : [];
  return asArray(value).map(asText).filter((item): item is string => !!item);
}

function slugId(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}
