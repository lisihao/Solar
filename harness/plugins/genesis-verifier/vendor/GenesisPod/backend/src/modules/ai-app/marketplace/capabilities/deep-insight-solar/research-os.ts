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
  "canonicalEntityCard",
  "sourceFigureCandidate",
  "sourceTableCandidate",
  "diagramBriefSeed",
  "benchmarkClaim",
  "primarySourceClaim",
] as const;

export type ResearchOsAssetType = (typeof RESEARCH_OS_ASSET_TYPES)[number];

export interface TechnologyInsightPlan {
  schemaVersion: typeof RESEARCH_OS_SCHEMA_VERSION;
  centralQuestion: string;
  userIntentAnalysis: {
    originalAsk: string;
    decisionNeed: string;
    audienceUse: string;
    successCriteria: string[];
  };
  initialTheses: string[];
  researchQuestions: string[];
  workstreams: Array<{
    id: string;
    name: string;
    objective: string;
    assetTypes: ResearchOsAssetType[];
  }>;
  entityContract: {
    canonicalEntities: Array<Record<string, unknown>>;
    confusableEntities: string[];
    requiredPrimarySources: string[];
    mustNotAssume: string[];
  };
  mandatoryArtifacts: ResearchOsAssetType[];
  visualContract: {
    requiredFigures: Array<Record<string, unknown>>;
    sourceFigurePolicy: string;
  };
  citationContract: {
    showConfidenceTable: boolean;
    hideInternalEvidenceIds: boolean;
    sourceTableColumns: string[];
  };
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
  "canonicalEntityCard",
  "primarySourceClaim",
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
  const userIntentAnalysis = normalizeUserIntentAnalysis(
    obj?.userIntentAnalysis ?? obj?.userIntent ?? obj?.intentAnalysis,
    fallback.topic,
    centralQuestion,
  );
  const hasV3ResearchTracks = asArray(obj?.researchTracks).length > 0;
  const mandatoryArtifacts =
    obj?.mandatoryArtifacts !== undefined
      ? normalizeAssetTypes(obj?.mandatoryArtifacts, DEFAULT_MANDATORY_ASSETS)
      : hasV3ResearchTracks
        ? (["evidenceCard"] as ResearchOsAssetType[])
        : DEFAULT_MANDATORY_ASSETS;
  const workstreams = normalizeWorkstreams(obj, mandatoryArtifacts, fallback.topic);
  const entityContract = normalizeEntityContract(obj?.entityContract, fallback.topic);
  const visualContract = normalizeVisualContract(obj?.visualContract, fallback.topic);
  const citationContract = normalizeCitationContract(obj?.citationContract);
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    centralQuestion,
    userIntentAnalysis,
    initialTheses: asTextArray(obj?.initialTheses ?? obj?.theses).concat(
      asRecordArray(obj?.candidateConclusions)
        .map((item) => asText(item.claim))
        .filter((item): item is string => !!item),
    ),
    researchQuestions: asTextArray(obj?.researchQuestions ?? obj?.questions),
    workstreams,
    entityContract,
    mandatoryArtifacts,
    visualContract,
    citationContract,
    sourcePolicy: asRecord(obj?.sourcePolicy) ?? {},
    coverageRequirements: asRecord(obj?.coverageRequirements) ?? {},
    falsificationQuestions: asTextArray(obj?.falsificationQuestions),
  };
}

function normalizeEntityContract(
  value: unknown,
  topic: string,
): TechnologyInsightPlan["entityContract"] {
  const obj = asRecord(value);
  const canonicalEntities = asRecordArray(obj?.canonicalEntities);
  return {
    canonicalEntities:
      canonicalEntities.length > 0
        ? canonicalEntities
        : [
            {
              name: topic,
              entityType: "topic_or_entity_to_resolve",
              primarySourcesRequired: true,
            },
          ],
    confusableEntities: asTextArray(obj?.confusableEntities),
    requiredPrimarySources: asTextArray(obj?.requiredPrimarySources),
    mustNotAssume: asTextArray(obj?.mustNotAssume),
  };
}

function normalizeVisualContract(
  value: unknown,
  topic: string,
): TechnologyInsightPlan["visualContract"] {
  const obj = asRecord(value);
  const requiredFigures = asRecordArray(obj?.requiredFigures);
  return {
    requiredFigures:
      requiredFigures.length > 0
        ? requiredFigures
        : [
            {
              figureId: "fig-technology-evolution",
              type: "technology-timeline",
              purpose: `说明 ${topic} 的技术演进路径。`,
              source: "generated_by_technologydiagram",
            },
            {
              figureId: "fig-architecture-stack",
              type: "architecture-stack",
              purpose: `说明 ${topic} 的系统层次、控制点和瓶颈。`,
              source: "generated_by_technologydiagram",
            },
            {
              figureId: "fig-actor-opportunity-map",
              type: "actor-opportunity-map",
              purpose: `说明 ${topic} 的参与者位置和机会地图。`,
              source: "generated_by_technologydiagram",
            },
          ],
    sourceFigurePolicy:
      asText(obj?.sourceFigurePolicy) ??
      "extract_if_source_has_chart_or_arch_diagram; redraw when license/style/quality is uncertain",
  };
}

function normalizeCitationContract(
  value: unknown,
): TechnologyInsightPlan["citationContract"] {
  const obj = asRecord(value);
  const sourceTableColumns = asTextArray(obj?.sourceTableColumns);
  return {
    showConfidenceTable: obj?.showConfidenceTable !== false,
    hideInternalEvidenceIds: obj?.hideInternalEvidenceIds !== false,
    sourceTableColumns:
      sourceTableColumns.length > 0
        ? sourceTableColumns
        : ["source", "type", "confidence", "supports", "url"],
  };
}

function normalizeUserIntentAnalysis(
  value: unknown,
  topic: string,
  centralQuestion: string,
): TechnologyInsightPlan["userIntentAnalysis"] {
  const obj = asRecord(value);
  const explicitCriteria = asTextArray(obj?.successCriteria ?? obj?.acceptanceCriteria);
  return {
    originalAsk: asText(obj?.originalAsk) ?? topic,
    decisionNeed:
      asText(obj?.decisionNeed) ??
      asText(obj?.jobToBeDone) ??
      `判断 ${centralQuestion} 对技术方向、产业机会和投资热点的含义。`,
    audienceUse:
      asText(obj?.audienceUse) ??
      asText(obj?.useCase) ??
      "用于对外汇报、研讨会组织、投资讨论或技术战略判断。",
    successCriteria:
      explicitCriteria.length > 0
        ? explicitCriteria
        : [
            "先解释用户真正要解决的判断问题",
            "给出清晰内容规划和分析路径",
            "逐步展开技术、产业、投资含义",
            "形成可复述、可汇报的结论和行动建议",
          ],
  };
}

export function buildLegacyPlanFromTechnologyInsightPlan(
  plan: TechnologyInsightPlan,
): {
  themeSummary: string;
  dimensions: Array<{
    id: string;
    name: string;
    rationale: string;
    assetTypes?: ResearchOsAssetType[];
  }>;
} {
  return {
    themeSummary: plan.centralQuestion,
    dimensions: plan.workstreams.map((workstream) => ({
      id: workstream.id,
      name: workstream.name,
      rationale: workstream.objective,
      assetTypes: workstream.assetTypes,
    })),
  };
}

export function normalizeResearchAssetLedger(
  structured: unknown,
  fallback: {
    workstreamId?: string;
    workstreamName?: string;
    markdown?: string;
    assetTypes?: ResearchOsAssetType[];
  },
): ResearchAssetLedger {
  const obj = asRecord(structured);
  const observations = asArray(obj?.observations);
  const rawAssets = [
    ...asArray(obj?.assets),
    ...asArray(obj?.assets).flatMap((item) => {
      const asset = asRecord(item);
      if (normalizeAssetType(asset?.type) !== "evidenceCard") return [];
      return [
        {
          type: "primarySourceClaim",
          title: asText(asset?.title) ?? asText(asset?.claim),
          summary:
            asText(asset?.summary) ??
            asText(asset?.evidence) ??
            asText(asset?.supportedClaim),
          sourceUrls:
            asset?.sourceUrls ??
            asset?.sources ??
            asset?.url ??
            asset?.sourceUrl ??
            asset?.source,
          confidence: asText(asset?.confidence),
          payload: asset,
        },
      ];
    }),
    ...asArray(obj?.researchAssets),
    ...asArray(obj?.evidenceCards).map((item) => ({ type: "evidenceCard", ...asRecord(item) })),
    ...asArray(obj?.evidenceCards).map((item) => ({
      type: "primarySourceClaim",
      title: asText(asRecord(item)?.title) ?? asText(asRecord(item)?.claim),
      summary:
        asText(asRecord(item)?.summary) ??
        asText(asRecord(item)?.evidence) ??
        asText(asRecord(item)?.supportedClaim),
      sourceUrls:
        asText(asRecord(item)?.url) ??
        asText(asRecord(item)?.sourceUrl) ??
        asText(asRecord(item)?.source),
      confidence: asText(asRecord(item)?.confidence),
      payload: asRecord(item),
    })),
    ...asArray(obj?.sourceNotes).map((item) => ({
      type: "evidenceCard",
      title: asText(asRecord(item)?.sourceTitle) ?? asText(asRecord(item)?.title),
      summary:
        asText(asRecord(item)?.relevantFact) ??
        asText(asRecord(item)?.supportedClaim) ??
        asText(asRecord(item)?.summary),
      sourceUrls: asText(asRecord(item)?.url),
      confidence: asText(asRecord(item)?.confidence),
      payload: asRecord(item),
    })),
    ...asArray(obj?.sourceNotes).map((item) => ({
      type: "primarySourceClaim",
      title:
        asText(asRecord(item)?.supportedClaim) ??
        asText(asRecord(item)?.relevantFact) ??
        asText(asRecord(item)?.sourceTitle),
      summary:
        asText(asRecord(item)?.supportedClaim) ??
        asText(asRecord(item)?.relevantFact) ??
        asText(asRecord(item)?.limitation),
      sourceUrls: asText(asRecord(item)?.url),
      confidence: asText(asRecord(item)?.confidence),
      payload: asRecord(item),
    })),
    ...observations.map((item) => ({
      type: "sotaFinding",
      title: asText(asRecord(item)?.claim),
      summary:
        asText(asRecord(item)?.mechanism) ??
        asText(asRecord(item)?.counterpointOrLimit),
      evidenceIds: asTextArray(asRecord(item)?.supportingSourceKeys),
      payload: asRecord(item),
    })),
    ...observations.flatMap((item, index) =>
      observationToTypedAssets(item, index, fallback),
    ),
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
    ...asArray(obj?.canonicalEntityCards ?? obj?.canonicalEntities).map((item) => ({
      type: "canonicalEntityCard",
      ...asRecord(item),
    })),
    ...asArray(obj?.sourceFigureCandidates ?? obj?.figureCandidates).map((item) => ({
      type: "sourceFigureCandidate",
      ...asRecord(item),
      summary:
        asText(asRecord(item)?.caption) ??
        asText(asRecord(item)?.usedFor) ??
        asText(asRecord(item)?.summary),
      sourceUrls:
        asText(asRecord(item)?.sourceUrl) ??
        asText(asRecord(item)?.imageUrl) ??
        asText(asRecord(item)?.screenshotUrl),
    })),
    ...asArray(obj?.sourceTableCandidates).map((item) => ({
      type: "sourceTableCandidate",
      ...asRecord(item),
    })),
    ...asArray(obj?.diagramBriefSeeds ?? obj?.diagramBriefs).map((item) => ({
      type: "diagramBriefSeed",
      ...asRecord(item),
      summary:
        asText(asRecord(item)?.purpose) ??
        asText(asRecord(item)?.caption) ??
        asText(asRecord(item)?.summary),
    })),
    ...asArray(obj?.benchmarkClaims).map((item) => ({
      type: "benchmarkClaim",
      ...asRecord(item),
    })),
    ...asArray(obj?.primarySourceClaims).map((item) => ({
      type: "primarySourceClaim",
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

export function enrichResearchAssetLedgerFromLegacyFindings(
  ledger: ResearchAssetLedger | undefined,
  researcherResults: ReadonlyArray<{
    readonly dimension?: string;
    readonly findings?: ReadonlyArray<{
      readonly claim?: string;
      readonly evidence?: string;
      readonly source?: string;
      readonly sourceTitle?: string;
    }>;
  }> | undefined,
): ResearchAssetLedger {
  const backfilled = (researcherResults ?? []).flatMap((result, resultIndex) => {
    const inferredTypes = inferAssetTypesFromWorkstreamText(result.dimension);
    if (inferredTypes.length === 0) return [];
    return (result.findings ?? []).flatMap((finding, findingIndex) =>
      [
        ...inferredTypes,
        ...(finding.source ? (["primarySourceClaim"] as ResearchOsAssetType[]) : []),
      ].map((type, typeIndex) => ({
        id: `legacy-${resultIndex + 1}-${findingIndex + 1}-${typeIndex + 1}`,
        type,
        title: finding.claim ?? finding.sourceTitle ?? result.dimension ?? type,
        summary: finding.evidence ?? finding.claim ?? result.dimension ?? type,
        evidenceIds: [],
        sourceUrls: finding.source ? [finding.source] : [],
        workstreamId: result.dimension ? slugId(result.dimension, `legacy-${resultIndex + 1}`) : undefined,
        confidence: "inferred" as const,
        payload: { ...finding, dimension: result.dimension },
      })),
    );
  });
  return mergeResearchAssetLedgers([
    ledger,
    buildResearchAssetLedger(backfilled.filter(hasRequiredAssetFields)),
  ]);
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
  const hasEntityContract = (plan?.entityContract?.canonicalEntities.length ?? 0) > 0;
  const missingAssetTypes = mandatory.filter((type) => {
    if (type === "canonicalEntityCard" && hasEntityContract) return false;
    return (counts[type] ?? 0) <= 0;
  });
  const blockers = missingAssetTypes.map((type) => `缺少 mandatory research asset: ${type}`);
  const warnings: string[] = [];
  if (!hasEntityContract && (counts.canonicalEntityCard ?? 0) <= 0) {
    blockers.push("S4-A entity gate failed: 缺少 canonicalEntityCard，不能进入成稿。");
  }
  if ((counts.primarySourceClaim ?? 0) <= 0) {
    blockers.push("S4-C thesis support gate failed: 缺少 primarySourceClaim，核心判断不能只靠二手材料或模型推断。");
  }
  const requiredFigureCount = plan?.visualContract?.requiredFigures.length ?? 0;
  if (requiredFigureCount > 0 && (counts.diagramBriefSeed ?? 0) <= 0 && (counts.sourceFigureCandidate ?? 0) <= 0) {
    warnings.push("S7 visual gate pending: 尚未形成 diagramBriefSeed/sourceFigureCandidate，报告可能缺图。");
  }
  if (plan?.citationContract?.showConfidenceTable !== false && (ledger?.sourceCount ?? 0) <= 0) {
    blockers.push("S10 citation gate failed: 引用置信度表没有可外显来源。");
  }
  const repairPackets = missingAssetTypes.map((type) => ({
    id: `repair-${type}`,
    reason: `missing-${type}`,
    targetAssetTypes: [type],
    prompt: `补齐 ${type}，必须提供 primary evidence、source URL、为什么它影响技术判断。`,
  })).concat(
    !hasEntityContract && (counts.canonicalEntityCard ?? 0) <= 0
      ? [
          {
            id: "repair-entity-gate",
            reason: "entity_confusion_or_missing_canonical_entity",
            targetAssetTypes: ["canonicalEntityCard" as ResearchOsAssetType],
            prompt: "重建 canonicalEntityCard：确认研究对象、版本/年份、混淆实体、mustNotAssume、primary source URL。",
          },
        ]
      : [],
    (counts.primarySourceClaim ?? 0) <= 0
      ? [
          {
            id: "repair-primary-source-claim",
            reason: "missing_primary_source_claim",
            targetAssetTypes: ["primarySourceClaim" as ResearchOsAssetType],
            prompt: "为摘要级核心判断补 primarySourceClaim；若找不到 primary source，则降级或删除该 thesis。",
          },
        ]
      : [],
    requiredFigureCount > 0 && (counts.diagramBriefSeed ?? 0) <= 0 && (counts.sourceFigureCandidate ?? 0) <= 0
      ? [
          {
            id: "repair-visual-plan",
            reason: "missing_visual_plan",
            targetAssetTypes: ["diagramBriefSeed" as ResearchOsAssetType, "sourceFigureCandidate" as ResearchOsAssetType],
            prompt: "补齐 visual plan：至少给出技术演进图、架构栈图、Actor/Opportunity 图的 diagram brief 或来源图候选。",
          },
        ]
      : [],
  );
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
  const writerBrief = asRecord(obj?.writerBrief);
  const writerBriefSections = asArray(writerBrief?.sections);
  const theses = asArray(
    obj?.theses ??
      obj?.coreTheses ??
      obj?.insights ??
      writerBriefSections.map((section, index) => ({
        id: `thesis-${index + 1}`,
        statement: asRecord(section)?.coreClaim ?? asRecord(section)?.heading,
        mechanism: asRecord(section)?.mechanism,
        limitations: asText(asRecord(section)?.limitToPreserve),
        architectureImplications: asText(asRecord(section)?.implication),
        evidenceIds: evidenceIds.slice(index, index + 3),
      })),
  )
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
    reportOutline: normalizeReportOutline(obj?.reportOutline ?? writerBriefSections, safeTheses),
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
  const evidenceBook = {
    evidenceCards: fallback.ledger?.evidenceCards ?? [],
    assets: fallback.ledger?.assets ?? [],
    sourceCount: fallback.ledger?.sourceCount ?? 0,
  };
  const standardReportMarkdown = ensureEvidenceConfidenceTable(
    sanitizePublicReportMarkdown(rawStandardReportMarkdown),
    evidenceBook,
  );
  const executiveBriefMarkdown = sanitizePublicReportMarkdown(
    asText(obj?.executiveBriefMarkdown) ??
      asText(obj?.executiveBrief) ??
      asText(obj?.summary) ??
      firstSentences(standardReportMarkdown) ??
      fallback.topic,
  );
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    executiveBriefMarkdown,
    standardReportMarkdown,
    evidenceBook,
  };
}

export function ensureEvidenceConfidenceTable(
  markdown: string,
  evidenceBook: EvidenceBook,
): string {
  if (/^##\s*引用资料与置信度\s*$/m.test(markdown)) return markdown.trim();
  const table = buildEvidenceConfidenceTable(evidenceBook);
  if (!table) return markdown.trim();
  return `${markdown.trim()}\n\n${table}`.trim();
}

export function buildEvidenceConfidenceTable(evidenceBook: EvidenceBook): string | undefined {
  const rows = collectEvidenceRows(evidenceBook).slice(0, 18);
  if (rows.length === 0) return undefined;
  const body = rows
    .map(
      (row, index) =>
        `| ${index + 1} | ${escapeMarkdownTableCell(row.title)} | ${escapeMarkdownTableCell(row.type)} | ${escapeMarkdownTableCell(row.confidence)} | ${escapeMarkdownTableCell(row.support)} | ${escapeMarkdownTableCell(row.source)} |`,
    )
    .join("\n");
  return [
    "## 引用资料与置信度",
    "",
    "| # | 资料 | 类型 | 置信度 | 支撑判断 | 来源 |",
    "|---:|---|---|---|---|---|",
    body,
  ].join("\n");
}

function collectEvidenceRows(
  evidenceBook: EvidenceBook,
): Array<{
  title: string;
  type: string;
  confidence: string;
  support: string;
  source: string;
}> {
  const seen = new Set<string>();
  const assets = [
    ...(evidenceBook.evidenceCards ?? []),
    ...(evidenceBook.assets ?? []),
  ];
  return assets
    .flatMap((asset) => {
      const urls = asset.sourceUrls.length > 0 ? asset.sourceUrls : [""];
      return urls.map((url) => ({ asset, url }));
    })
    .map(({ asset, url }) => {
      const key = `${asset.title}::${url || asset.summary}`;
      if (seen.has(key)) return undefined;
      seen.add(key);
      return {
        title: compactText(asset.title, 42),
        type: publicAssetTypeLabel(asset.type),
        confidence: publicConfidenceLabel(asset.confidence),
        support: compactText(asset.summary, 68),
        source: url ? `[链接](${url})` : "N/A",
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
}

function publicAssetTypeLabel(type: ResearchOsAssetType): string {
  const labels: Record<ResearchOsAssetType, string> = {
    evidenceCard: "证据卡",
    evolutionEvent: "演进事件",
    stackNode: "架构节点",
    interfaceEdge: "接口关系",
    actorCard: "参与者",
    sotaFinding: "SOTA 线索",
    bottleneckCard: "瓶颈",
    contradiction: "反例/矛盾",
    weakSignal: "弱信号",
    opportunityHypothesis: "机会假设",
    canonicalEntityCard: "实体卡",
    sourceFigureCandidate: "来源图候选",
    sourceTableCandidate: "来源表候选",
    diagramBriefSeed: "图表计划",
    benchmarkClaim: "Benchmark 判断",
    primarySourceClaim: "一手来源判断",
  };
  return labels[type] ?? type;
}

function publicConfidenceLabel(confidence: ResearchAsset["confidence"]): string {
  switch (confidence) {
    case "verified":
      return "高";
    case "inferred":
      return "中";
    case "hypothesis":
      return "假设";
    case "gap":
      return "缺口";
    default:
      return "N/A";
  }
}

function compactText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

export function sanitizePublicReportMarkdown(markdown: string): string {
  const withoutInternalMapping = stripInternalPublicReportBlocks(markdown);
  return withoutInternalMapping
    .split(/\r?\n/)
    .map(sanitizePublicReportLine)
    .filter((line) => !isSelfReferentialProcessLine(line))
    .join("\n")
    .replace(/本报告将(“[^”]+”)?先辨析研究对象：/g, "首先需要辨析$1这一研究对象：")
    .replace(/本报告将/g, "")
    .replace(/本文将/g, "")
    .replace(/本报告/g, "这份研究")
    .replace(/本文/g, "这项分析")
    .replace(/目前不应被写成一个已核验的单一([^。；;]+?)(画像|公司画像|公司|主体)/g, "更适合被理解为一个尚待精确界定的$1谱系")
    .replace(/不应被理解为/g, "更适合理解为")
    .replace(/不应被写成/g, "更适合理解为")
    .replace(/不应把([^。；;]{1,80}?)写成/g, "$1尚不足以被视为")
    .replace(/不应把/g, "更适合避免把")
    .replace(/不应被放进/g, "更适合避免放进")
    .replace(/不应只比较/g, "仅比较")
    .replace(/不应只看/g, "仅看")
    .replace(/不宜被直接写成/g, "难以直接归为")
    .replace(/不宜写成/g, "不适合作为")
    .replace(/不宜过早承诺/g, "更适合审慎推进")
    .replace(/不应该说成/g, "更准确的表述是")
    .replace(/不要说成/g, "不宜简单归入")
    .replace(/不应按/g, "更适合避免按")
    .replace(/不应成为/g, "更适合保留为")
    .replace(/不能直接落笔为/g, "难以直接归为")
    .replace(/不是一个可直接落笔的/g, "还不是一个可直接归类的")
    .replace(/不能被简单放进/g, "难以简单放进")
    .replace(/不能自动证明/g, "尚不足以证明")
    .replace(/不能据此断言/g, "据此尚不足以断言")
    .replace(/不能直接升级为/g, "尚未直接升级为")
    .replace(/不能支撑/g, "尚不足以支撑")
    .replace(/不能替代/g, "尚不足以替代")
    .replace(/不能证明/g, "尚不足以证明")
    .replace(/不能过度外推/g, "外推空间有限")
    .replace(/评价这两类系统不能只看/g, "评价这两类系统时，仅看")
    .replace(/不能越过公开可确认事实/g, "判断最好贴近公开事实")
    .replace(/不能把([^。；;]{1,80}?)写成/g, "也尚不足以把$1视为")
    .replace(/不应被([^。；;]{1,80}?)处理为/g, "$1更适合被理解为")
    .replace(/如果没有稳定公开信息，更适合理解为强项/g, "缺少稳定公开信息时，这一维度仍属于待观察项")
    .replace(/需要验证/g, "有待公开材料支撑")
    .replace(/需要检验/g, "有待持续观察")
    .replace(/需要核验/g, "尚待明确")
    .replace(/需要确认/g, "尚待明确")
    .replace(/必须接受更长验证周期/g, "通常对应更长验证周期")
    .replace(/必须接受更长验证/g, "通常对应更长验证")
    .replace(/要看/g, "关键在于")
    .replace(/需要先做实体辨析/g, "需要先明确研究对象")
    .replace(/先做实体辨析/g, "先明确研究对象")
    .replace(/先做实体边界/g, "先明确研究对象")
    .replace(/先做实体门控/g, "先明确研究对象")
    .replace(/实体边界问题/g, "研究对象界定问题")
    .replace(/公开资料不足以支撑这些确定性陈述/g, "公开资料仍不足，相关结论需要保持审慎")
    .replace(/现有公开材料不足以支撑这些确定性陈述/g, "现有公开材料仍不足，相关结论需要保持审慎")
    .replace(/不构成护城河/g, "还不足以构成护城河")
    .replace(/ResearchAssetLedger|ThesisGraph|ReportPackage|EvidenceBook|evidenceBook/g, "")
    .replace(/research asset ledger|thesis graph|report package|evidence book/gi, "")
    .replace(/实体门控/g, "实体辨析")
    .replace(/先做实体辨析/g, "先辨析研究对象")
    .replace(/门控/g, "筛选")
    .replace(/边界条件/g, "适用限制")
    .replace(/资产账本/g, "证据材料")
    .replace(/论点图/g, "判断框架")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizePublicReportLine(line: string): string {
  return line
    .replace(
      /若把([^。；;]+?)当作([^，。；;]+?)来写，问题会变成[^。；;]+[。；;]/g,
      "从投资汇报角度看，$1的关键问题不是单点公司事实罗列，而是其背后的技术控制点、产业分工和资本定价逻辑。",
    )
    .replace(
      /若把([^。；;]+?)处理为([^，。；;]+?)，真正需要比较的对象就变成：/g,
      "$1的比较框架应转向：",
    )
    .replace(
      /这个判断会改变全文的分析单位。/g,
      "这个判断改变了分析单位。",
    );
}

function isSelfReferentialProcessLine(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  return (
    /^(下面|以下)(开始|先从|将从)/.test(text) ||
    /(?:本报告|本文|这份报告|这项分析).{0,28}(?:不应|不应该|不要|不能|将|先做|处理为|写成|落笔|称为)/.test(text) ||
    /(?:报告|正文|文章).{0,20}(?:不应|不应该|不要|不能).{0,20}(?:写成|说成|输出|出现)/.test(text) ||
    /(?:应规范化为|规范化为).{0,24}(?:谱系|范畴|对象)/.test(text)
  );
}

function stripInternalPublicReportBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isInternalMappingHeading(line)) {
      while (index + 1 < lines.length && !/^##\s+/.test(lines[index + 1] ?? "")) {
        index += 1;
      }
      continue;
    }
    if (isMarkdownTableLine(line)) {
      const tableLines: string[] = [];
      while (index < lines.length && isMarkdownTableLine(lines[index] ?? "")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }
      index -= 1;
      if (isInternalPublicReportTable(tableLines)) continue;
      kept.push(...tableLines);
      continue;
    }
    if (isInternalPublicReportLine(line)) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

function isInternalMappingHeading(line: string): boolean {
  return /^##\s*(研究资产到论点映射|核心判断与证据关系)\s*$/i.test(line.trim());
}

function isMarkdownTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isInternalPublicReportTable(lines: string[]): boolean {
  const joined = lines.join("\n");
  return (
    hasInternalPublicReportToken(joined) ||
    /相关材料(?:\s*[、,，]\s*相关材料){1,}/.test(joined) ||
    /\|\s*-{3,}\s*\|\s*-{3,}[\s\S]*相关材料/.test(joined)
  );
}

function isInternalPublicReportLine(line: string): boolean {
  return hasInternalPublicReportToken(line) || /相关材料(?:\s*[、,，]\s*相关材料){1,}/.test(line);
}

function hasInternalPublicReportToken(text: string): boolean {
  return /(?:\b(?:asset|thesis|ev|counter|claim|repair|packet)-\d+\b|evidenceIds|assetIds|thesisIds|counterEvidenceIds|thesisBindings|canonicalEntityCard|primarySourceClaim|sourceFigureCandidate|diagramBriefSeed|ResearchAssetLedger|ThesisGraph|ReportPackage|EvidenceBook|evidenceBook|coverageReport|repairPacket|研究资产到论点映射)/i.test(
    text,
  );
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
  add(
    "canonical-entity-card",
    (counts.canonicalEntityCard ?? 0) > 0 ||
      (Array.isArray(args.coverage?.blockers) &&
        !args.coverage.blockers.some((blocker) =>
          /canonicalEntityCard|entity gate/i.test(blocker),
        )),
    "缺少 canonicalEntityCard，存在实体/版本错位风险",
  );
  add(
    "primary-source-claims",
    (counts.primarySourceClaim ?? 0) > 0,
    "缺少 primarySourceClaim，核心论点缺一手来源支撑",
  );
  const reportChars =
    (args.reportPackage?.standardReportMarkdown.length ?? 0) +
    (args.reportPackage?.executiveBriefMarkdown.length ?? 0);
  add("report-not-empty", reportChars >= 1200, `报告正文过短：${reportChars}/1200 chars`);
  add(
    "publication-citation-table",
    hasCitationConfidenceTable(args.reportPackage?.standardReportMarkdown ?? ""),
    "发布报告缺少引用资料与置信度表",
  );
  add(
    "publication-figure-plan",
    hasFigurePlanOrRenderedFigure(args.reportPackage?.standardReportMarkdown ?? "") ||
      (counts.diagramBriefSeed ?? 0) > 0 ||
      (counts.sourceFigureCandidate ?? 0) > 0,
    "发布报告缺少图表规划或可渲染图位",
    "warn",
  );
  add(
    "external-briefing-structure",
    hasExternalBriefingStructure(args.reportPackage?.standardReportMarkdown ?? ""),
    "报告缺少外部汇报结构：需求理解、内容规划、分步骤洞察、综合判断/行动建议必须同时可见",
  );
  const readerFacingBlockers = publicReportLanguageBlockers(
    args.reportPackage?.standardReportMarkdown ?? "",
  );
  add(
    "reader-facing-language",
    readerFacingBlockers.length === 0,
    readerFacingBlockers.length > 0
      ? `报告仍包含内部过程/自言自语表达：${readerFacingBlockers.join("；")}`
      : "报告语言面向外部读者",
  );
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

function hasExternalBriefingStructure(markdown: string): boolean {
  const text = markdown.replace(/\s+/g, "");
  if (!text) return false;
  const needIndex = text.search(
    /需求理解|用户需求|本次分析要回答|汇报目标|决策问题|任务理解/,
  );
  const planIndex = text.search(
    /内容规划|分析框架|分析路径|报告结构|展开路径|研究路径/,
  );
  const stepwiseIndex = text.search(
    /分步骤洞察|逐步洞察|步骤一|第一步|分层洞察|分维度洞察|洞察路径/,
  );
  const synthesisIndex = text.search(
    /综合判断|核心结论|投资热点谱系|行动建议|战略启示|汇报要点/,
  );
  return (
    needIndex >= 0 &&
    planIndex > needIndex &&
    stepwiseIndex > planIndex &&
    synthesisIndex > stepwiseIndex
  );
}

function hasCitationConfidenceTable(markdown: string): boolean {
  return (
    /^##\s*引用资料与置信度\s*$/m.test(markdown) &&
    /\|\s*#\s*\|\s*(资料|来源)\s*\|[\s\S]*\|\s*(置信度|可信度)\s*\|/.test(markdown)
  );
}

function hasFigurePlanOrRenderedFigure(markdown: string): boolean {
  return (
    /!\[[^\]]+\]\([^)]+\)/.test(markdown) ||
    /^##\s*(图表与材料视图|Figure|图表计划)/m.test(markdown)
  );
}

export function publicReportLanguageBlockers(markdown: string): string[] {
  const text = markdown.replace(/\s+/g, "");
  if (!text) return [];
  const blockers: string[] = [];
  const add = (label: string, pattern: RegExp) => {
    if (pattern.test(markdown) || pattern.test(text)) blockers.push(label);
  };
  add("自指式写作框架", /(?:本报告|本文|这份报告|这项分析).{0,24}(?:将|会|拟|先做|先从|下面|以下)/);
  add(
    "指令式否定表达",
    /(?:不应|不应该|不要|不能|不宜).{0,24}(?:写成|说成|称为|落笔|输出|出现|处理为)/,
  );
  add(
    "内部验证口吻",
    /(?:需要|应当|应该|必须).{0,16}(?:检验|验证|核验|检查|确认)(?:[^，。；;]|$)/,
  );
  add("内部工程术语", /(?:\b(?:asset|thesis|ev|counter|claim|repair|packet)-\d+\b|evidenceIds|assetIds|thesisIds|counterEvidenceIds|thesisBindings|canonicalEntityCard|primarySourceClaim|sourceFigureCandidate|diagramBriefSeed|ResearchAssetLedger|ThesisGraph|ReportPackage|EvidenceBook|evidenceBook|coverageReport|repairPacket|writerBrief|sourceNotes|workstream|Research OS|研究资产到论点映射)/i);
  add("门控/闸门术语", /(?:门控|闸门|gating|\bgate\b)/i);
  return [...new Set(blockers)];
}

function normalizeWorkstreams(
  obj: Record<string, unknown> | undefined,
  mandatoryArtifacts: ResearchOsAssetType[],
  topic: string,
): TechnologyInsightPlan["workstreams"] {
  const rawWorkstreams = asArray(obj?.workstreams ?? obj?.researchTracks);
  const workstreams = rawWorkstreams
    .map((raw, index) => {
      const item = asRecord(raw);
      const name = asText(item?.name) ?? asText(item?.title);
      if (!name) return undefined;
      return {
        id: asText(item?.id) ?? asText(item?.key) ?? slugId(name, `workstream-${index + 1}`),
        name,
        objective:
          asText(item?.objective) ??
          asText(item?.rationale) ??
          asText(item?.question) ??
          name,
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
    asText(item?.supportedClaim) ??
    asText(item?.relevantFact) ??
    asText(item?.entityType) ??
    asText(item?.purpose) ??
    asText(item?.caption) ??
    asText(item?.description) ??
    asText(item?.body);
  if (!title || !summary) return undefined;
  const sourceUrls = asTextArray(
    item?.sourceUrls ??
      item?.sources ??
      item?.url ??
      item?.sourceUrl ??
      item?.primarySourceUrl ??
      item?.imageUrl ??
      item?.screenshotUrl ??
      item?.source,
  )
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

function observationToTypedAssets(
  raw: unknown,
  index: number,
  fallback: {
    workstreamId?: string;
    workstreamName?: string;
    assetTypes?: ResearchOsAssetType[];
  },
): Array<Record<string, unknown>> {
  const item = asRecord(raw);
  const claim = asText(item?.claim);
  const mechanism = asText(item?.mechanism);
  const counterpoint = asText(item?.counterpointOrLimit);
  if (!claim || (!mechanism && !counterpoint)) return [];
  const targetTypes = [
    ...new Set([
      ...(fallback.assetTypes ?? []),
      ...inferAssetTypesFromWorkstreamText(fallback.workstreamName),
      ...inferAssetTypesFromObservationText(`${claim}\n${mechanism ?? ""}\n${counterpoint ?? ""}`),
    ]),
  ].filter((type) => type !== "evidenceCard" && type !== "sotaFinding");
  return targetTypes.map((type, typeIndex) => ({
    id: `${type}-${index + 1}-${typeIndex + 1}`,
    type,
    title: claim,
    summary:
      type === "contradiction"
        ? counterpoint ?? mechanism
        : mechanism ?? counterpoint,
    evidenceIds: asTextArray(item?.supportingSourceKeys),
    ...(fallback.workstreamId ? { workstreamId: fallback.workstreamId } : {}),
    confidence: "inferred",
    payload: item,
  }));
}

function inferAssetTypesFromObservationText(text: string): ResearchOsAssetType[] {
  const haystack = text.toLowerCase();
  const types: ResearchOsAssetType[] = [];
  if (/演进|迁移|路线|代际|from |to |转向|分化|技术簇/.test(haystack)) {
    types.push("evolutionEvent");
  }
  if (/架构|stack|runtime|训练|推理|接口|平台|基础设施|算力|控制面/.test(haystack)) {
    types.push("stackNode");
  }
  if (/公司|lab|labs|openai|anthropic|google|meta|nvidia|startup|团队|生态|竞争/.test(haystack)) {
    types.push("actorCard");
  }
  if (/瓶颈|约束|成本|延迟|数据|算力|治理|风险/.test(haystack)) {
    types.push("bottleneckCard");
  }
  if (/反例|但是|不能|尚未|缺少|风险|counter|limit|failed|失败/.test(haystack)) {
    types.push("contradiction");
  }
  if (/弱信号|早期|迹象|流出|融资|估值|预期|叙事|信号/.test(haystack)) {
    types.push("weakSignal");
  }
  if (/投资|融资|机会|资本|商业化|产品|平台|market|估值/.test(haystack)) {
    types.push("opportunityHypothesis");
  }
  return [...new Set(types)];
}

function inferAssetTypesFromWorkstreamText(text: string | undefined): ResearchOsAssetType[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const types: ResearchOsAssetType[] = [];
  if (/演进|evolution|技术路线|路线分簇|route|代际/.test(haystack)) {
    types.push("evolutionEvent", "stackNode");
  }
  if (/架构|stack|基础设施|runtime|系统|算力/.test(haystack)) {
    types.push("stackNode", "interfaceEdge", "bottleneckCard");
  }
  if (/竞争|谱系|actor|生态|公司|lab|labs|替代路径/.test(haystack)) {
    types.push("actorCard", "contradiction");
  }
  if (/反例|矛盾|失败|风险|弱信号|counter|weak|failure/.test(haystack)) {
    types.push("contradiction", "weakSignal", "bottleneckCard");
  }
  if (/投资|融资|机会|资本|热点|估值/.test(haystack)) {
    types.push("opportunityHypothesis", "weakSignal", "actorCard");
  }
  return [...new Set(types)];
}

function hasRequiredAssetFields(asset: ResearchAsset): boolean {
  return !!asset.title && !!asset.summary;
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
  const raw = value.trim();
  if (!raw) return undefined;
  const direct = RESEARCH_OS_ASSET_TYPES.find((type) => type === raw);
  if (direct) return direct;
  const normalized = normalizeAssetTypeToken(raw);
  const alias = RESEARCH_OS_ASSET_TYPE_ALIASES[normalized];
  if (alias) return alias;
  return RESEARCH_OS_ASSET_TYPES.find((type) => {
    const canonical = normalizeAssetTypeToken(type);
    return normalized === canonical || normalized === `${canonical}s`;
  });
}

const RESEARCH_OS_ASSET_TYPE_ALIASES: Record<string, ResearchOsAssetType> = {
  entitycard: "canonicalEntityCard",
  canonicalentity: "canonicalEntityCard",
  canonicalentitycards: "canonicalEntityCard",
  entitycontract: "canonicalEntityCard",
  实体卡: "canonicalEntityCard",
  实体定义: "canonicalEntityCard",
  实体辨析: "canonicalEntityCard",
  primaryclaim: "primarySourceClaim",
  primaryclaims: "primarySourceClaim",
  sourceclaim: "primarySourceClaim",
  sourceclaims: "primarySourceClaim",
  primarysourceclaims: "primarySourceClaim",
  一手来源: "primarySourceClaim",
  一手来源判断: "primarySourceClaim",
  一手证据: "primarySourceClaim",
  evidence: "evidenceCard",
  evidencecards: "evidenceCard",
  evidenceclaim: "evidenceCard",
  证据卡: "evidenceCard",
  sourcefigure: "sourceFigureCandidate",
  sourcefigures: "sourceFigureCandidate",
  figurecandidate: "sourceFigureCandidate",
  figurecandidates: "sourceFigureCandidate",
  来源图候选: "sourceFigureCandidate",
  diagrambrief: "diagramBriefSeed",
  diagrambriefs: "diagramBriefSeed",
  diagramseed: "diagramBriefSeed",
  diagramseeds: "diagramBriefSeed",
  图表计划: "diagramBriefSeed",
};

function normalizeAssetTypeToken(value: string): string {
  return value.toLowerCase().replace(/[\s_\-./:]+/g, "");
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
