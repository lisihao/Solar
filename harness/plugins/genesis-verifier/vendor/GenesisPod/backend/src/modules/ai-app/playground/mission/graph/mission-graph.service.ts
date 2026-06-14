/**
 * MissionGraphService — build and retrieve knowledge-graph artifacts for a mission.
 *
 * Flow:
 *   1. Load mission report text via MissionQueryService
 *   2. LLM extraction call → entities + relations
 *   3. EntityResolutionService canonical dedup
 *   4. Build MissionGraph
 *   5. runGraphAnalyses (pure)
 *   6. LLM summary call → merge Chinese prose summaries
 *   7. Upsert to DB; return artifact
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AIModelType, Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  AiChatService,
  EntityResolutionService,
  SearchService,
} from "@/modules/ai-engine/facade";
import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";
import { MissionQueryService } from "../query/mission-query.service";
import { runGraphAnalyses } from "./mission-graph.analysis";
import {
  LlmExtractionSchema,
  type LlmExtractionOutput,
  type MissionGraph,
  type GraphNode,
  type GraphEdge,
  type Analyses,
  type MissionGraphArtifact,
  type NodeEnrichment,
} from "./mission-graph.types";
import type { ReportArtifactV2 } from "../../api/contracts/artifact.contract";

// ─── helpers ──────────────────────────────────────────────────────────────────

function isEmptySentinel(a: unknown): boolean {
  return (
    typeof a === "object" &&
    a !== null &&
    "kind" in (a as Record<string, unknown>) &&
    (a as Record<string, unknown>).kind === "empty-artifact"
  );
}

/** Collect plain text from composedArtifact or fallback reportFull V1 shape. */
function extractReportText(
  composedArtifact: unknown,
  rowReportFull: unknown,
): string {
  const parts: string[] = [];

  if (!isEmptySentinel(composedArtifact) && composedArtifact != null) {
    const artifact = composedArtifact as ReportArtifactV2;
    // Full markdown is the richest source
    if (artifact.content?.fullMarkdown) {
      return artifact.content.fullMarkdown;
    }
    // Fallback: section titles
    for (const section of artifact.sections ?? []) {
      const s = section as unknown as Record<string, unknown>;
      if (typeof s["title"] === "string") parts.push(s["title"]);
    }
    if (artifact.quickView?.executiveSummary?.markdown) {
      parts.push(artifact.quickView.executiveSummary.markdown);
    }
    for (const triple of artifact.factTable ?? []) {
      const t = triple as unknown as Record<string, unknown>;
      const pieces = [t["subject"], t["predicate"], t["object"]].filter(
        Boolean,
      );
      parts.push(pieces.join(" "));
    }
  }

  // V1 fallback
  if (parts.length === 0 && rowReportFull != null) {
    const r = rowReportFull as Record<string, unknown>;
    if (r["summary"]) parts.push(String(r["summary"]));
    for (const s of (r["sections"] as
      | Array<Record<string, unknown>>
      | undefined) ?? []) {
      if (s["body"]) parts.push(String(s["body"]));
      if (s["heading"]) parts.push(String(s["heading"]));
    }
    if (r["conclusion"]) parts.push(String(r["conclusion"]));
  }

  return parts.join("\n").trim();
}

/** Compact summary of graph + analyses for the second LLM call. */
function buildGraphSummaryForLlm(
  graph: MissionGraph,
  analyses: ReturnType<typeof runGraphAnalyses>,
): string {
  const topNodes = analyses.keyNodes.items
    .slice(0, 5)
    .map((n) => n.label)
    .join(", ");
  const topPairs = analyses.relatedness.pairs
    .slice(0, 5)
    .map((p) => `${p.a}-${p.b}`)
    .join(", ");
  // Pass actual membership (labels) so the LLM can write content-specific prose,
  // not generic boilerplate.
  const clusters = analyses.competitive.clusters
    .slice(0, 4)
    .map((c, i) => `集群${i + 1}[${c.members.slice(0, 6).join("/")}]`)
    .join("; ");
  const communities = analyses.community.communities
    .slice(0, 4)
    .map((c) => `社区${c.id}[${c.members.slice(0, 6).join("/")}]`)
    .join("; ");
  const layers = analyses.supplyChain.layers
    .map((l) => `第${l.order}层[${l.members.slice(0, 6).join("/")}]`)
    .join(" → ");
  return (
    `图谱概览: ${graph.stats.totalNodes} 个节点, ${graph.stats.totalEdges} 条边。\n` +
    `核心节点(按度): ${topNodes || "无"}。\n` +
    `最强关联对: ${topPairs || "无"}。\n` +
    `竞争集群: ${clusters || "无"}。\n` +
    `社区分组: ${communities || "无"}。\n` +
    `供应链层级: ${layers || "无"}。`
  );
}

/** Safe fallback summary when LLM summary call fails. */
function fallbackSummary(key: string): string {
  const map: Record<string, string> = {
    keyNodes: "节点度中心性分析完成，已识别关键枢纽节点。",
    relatedness: "实体关联强度分析完成。",
    competitive: "竞争格局分析完成。",
    community: "社区结构分析完成。",
    supplyChain: "供应链层级分析完成。",
  };
  return map[key] ?? "分析完成。";
}

/**
 * 把 LLM 返回的 per-layer 描述按 order 合并进结构化 layers。
 * LLM 漏写/格式异常时该层 description 留空（前端有客户端兜底文案）。
 */
function mergeLayerDescriptions(
  layers: { order: number; members: string[] }[],
  raw: unknown,
): { order: number; members: string[]; description?: string }[] {
  const byOrder = new Map<number, string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        if (typeof o.order === "number" && typeof o.description === "string") {
          byOrder.set(o.order, o.description.trim());
        }
      }
    }
  }
  return layers.map((l) => {
    const desc = byOrder.get(l.order);
    return desc ? { ...l, description: desc } : { ...l };
  });
}

// ─── service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MissionGraphService {
  private readonly logger = new Logger(MissionGraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly missionQuery: MissionQueryService,
    private readonly chat: AiChatService,
    private readonly entityResolution: EntityResolutionService,
    private readonly search: SearchService,
  ) {}

  // ---------------------------------------------------------------------------
  // enrichNode —— 点击节点时按需用 web-search + LLM 综合实体画像
  // ---------------------------------------------------------------------------

  async enrichNode(
    userId: string,
    missionId: string,
    nodeId: string,
  ): Promise<NodeEnrichment> {
    const artifact = await this.getArtifact(userId, missionId); // 内含 ownership 校验
    const node = (artifact.graph?.nodes ?? []).find((n) => n.id === nodeId);
    if (!node) {
      throw new NotFoundException(`graph node ${nodeId} not found`);
    }

    const typeHint: Record<string, string> = {
      ORGANIZATION: "公司 机构 背景 业务 规模 财务 融资 地位",
      PRODUCT: "产品 用途 厂商 定位",
      TECHNOLOGY: "技术 原理 应用 代表厂商",
      PERSON: "人物 背景 任职",
      EVENT: "事件 时间 影响",
      METRIC: "指标 含义 数值",
      TREND: "趋势 驱动 影响",
    };
    const query = `${node.label} ${typeHint[node.type] ?? ""}`.trim();

    let results: { title: string; url: string; content: string }[] = [];
    try {
      const r = await this.search.search(query, 6);
      results = r.results ?? [];
    } catch (err: unknown) {
      this.logger.warn(
        `[graph:enrich] search failed for "${node.label}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const ctx = results
      .map(
        (x, i) =>
          `[${i + 1}] ${x.title}\n${(x.content || "").slice(0, 400)}\nURL: ${x.url}`,
      )
      .join("\n\n");

    const fallback: NodeEnrichment = {
      nodeId,
      label: node.label,
      type: node.type,
      description: "",
      facts: [],
      sources: results.slice(0, 5).map((x) => ({ title: x.title, url: x.url })),
    };

    if (!ctx) return fallback;

    const sysPrompt = `你是商业分析师。根据搜索结果为实体"${node.label}"（类型：${node.type}）写一份结构化画像。返回纯JSON，不要prose：
{
  "description": "2-4句中文简介",
  "facts": [{"label": "字段名", "value": "值"}],
  "sources": [{"title": "", "url": ""}]
}
facts 聚焦关键事实（成立时间/规模/主营/产品/财务/融资轮次/市场地位等），最多 6 条；sources 从搜索结果选最相关的，最多 5 条。只用搜索结果中的信息，无依据的不要编造。`;

    try {
      const res = await this.chat.chat({
        messages: [{ role: "user", content: ctx }],
        systemPrompt: sysPrompt,
        taskProfile: { creativity: "low", outputLength: "short" },
        modelType: AIModelType.CHAT,
        userId,
        operationName: "playground.mission-graph.enrich-node",
      });
      if (res.content) {
        const parsed = extractJsonFromAIResponse<Record<string, unknown>>(
          res.content,
          { requiredKey: "description" },
        );
        if (parsed.success && parsed.data) {
          const d = parsed.data;
          const facts = Array.isArray(d.facts)
            ? (d.facts as unknown[])
                .filter(
                  (f): f is { label: string; value: string } =>
                    !!f &&
                    typeof f === "object" &&
                    typeof (f as Record<string, unknown>).label === "string" &&
                    typeof (f as Record<string, unknown>).value === "string",
                )
                .slice(0, 6)
            : [];
          const sources = Array.isArray(d.sources)
            ? (d.sources as unknown[])
                .filter(
                  (s): s is { title: string; url: string } =>
                    !!s &&
                    typeof s === "object" &&
                    typeof (s as Record<string, unknown>).url === "string",
                )
                .slice(0, 5)
            : fallback.sources;
          return {
            nodeId,
            label: node.label,
            type: node.type,
            description: String(d.description ?? ""),
            facts,
            sources: sources.length > 0 ? sources : fallback.sources,
          };
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `[graph:enrich] LLM synth failed for "${node.label}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return fallback;
  }

  // ---------------------------------------------------------------------------
  // getArtifact
  // ---------------------------------------------------------------------------

  async getArtifact(
    userId: string,
    missionId: string,
  ): Promise<MissionGraphArtifact> {
    // Ownership check: will throw ForbiddenException if not authorized
    await this.missionQuery.loadInputs(missionId, userId);

    const row = await this.prisma.playgroundMissionGraph.findUnique({
      where: { missionId },
    });

    if (!row) {
      return { status: "NONE", graph: null, analyses: null, generatedAt: null };
    }

    return {
      status: row.status as MissionGraphArtifact["status"],
      graph: row.graph as unknown as MissionGraph,
      analyses: row.analyses as unknown as Analyses,
      generatedAt: row.generatedAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // build
  // ---------------------------------------------------------------------------

  async build(
    userId: string,
    missionId: string,
  ): Promise<MissionGraphArtifact> {
    try {
      return await this._build(userId, missionId);
    } catch (err: unknown) {
      this.logger.warn(
        `[graph:build] unexpected error mission=${missionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this._persistFailed(missionId, userId);
    }
  }

  // ---------------------------------------------------------------------------
  // internal build pipeline
  // ---------------------------------------------------------------------------

  private async _build(
    userId: string,
    missionId: string,
  ): Promise<MissionGraphArtifact> {
    // Step 1: load report text
    const inputs = await this.missionQuery.loadInputs(missionId, userId);
    const row = inputs.row;

    const reportText = extractReportText(
      inputs.composedArtifact,
      row?.reportFull ?? null,
    );

    if (!reportText) {
      this.logger.warn(
        `[graph:build] empty report text for mission=${missionId}`,
      );
      return this._persistFailed(missionId, userId);
    }

    // Step 2: LLM extraction
    const extractionResult = await this._extractEntitiesAndRelations(
      missionId,
      userId,
      reportText,
    );

    if (!extractionResult) {
      return this._persistFailed(missionId, userId);
    }

    // Step 3: Entity resolution + canonical dedup
    const rawEntityNames = extractionResult.entities.map((e) => e.name);
    let canonicalOf: Record<string, string>;
    try {
      const resolution = await this.entityResolution.resolve(rawEntityNames, {
        threshold: 0.85,
      });
      canonicalOf = resolution.canonicalOf;
    } catch (err: unknown) {
      this.logger.warn(
        `[graph:build] entity resolution failed for mission=${missionId}, falling back to identity: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Fallback: identity mapping
      canonicalOf = {};
      for (const n of rawEntityNames) canonicalOf[n] = n;
    }

    // Build canonical name → type map (first entity type wins)
    const typeOf = new Map<string, string>();
    for (const entity of extractionResult.entities) {
      const canonical = canonicalOf[entity.name] ?? entity.name;
      if (!typeOf.has(canonical)) typeOf.set(canonical, entity.type);
    }

    // Deduplicate nodes by canonical label
    const nodeMap = new Map<string, GraphNode>();
    let nodeIdx = 0;
    const labelToId = new Map<string, string>();

    for (const [canonical, type] of typeOf.entries()) {
      if (!labelToId.has(canonical)) {
        const id = `n${nodeIdx++}`;
        labelToId.set(canonical, id);
        nodeMap.set(id, {
          id,
          label: canonical,
          type: type as GraphNode["type"],
        });
      }
    }

    // Remap + dedup edges; drop self-loops and dangling
    const edgeSet = new Set<string>();
    const edges: GraphEdge[] = [];

    for (const rel of extractionResult.relations) {
      const srcCanon = canonicalOf[rel.source] ?? rel.source;
      const tgtCanon = canonicalOf[rel.target] ?? rel.target;

      const srcId = labelToId.get(srcCanon);
      const tgtId = labelToId.get(tgtCanon);

      if (!srcId || !tgtId) continue; // dangling
      if (srcId === tgtId) continue; // self-loop

      const edgeKey = `${srcId}|${rel.type}|${tgtId}`;
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);

      edges.push({
        source: srcId,
        target: tgtId,
        type: rel.type as GraphEdge["type"],
        weight: 1,
      });
    }

    const nodes = [...nodeMap.values()];
    const graph: MissionGraph = {
      nodes,
      edges,
      stats: { totalNodes: nodes.length, totalEdges: edges.length },
    };

    // Step 4: Run pure analyses
    const rawAnalyses = runGraphAnalyses(graph);

    // Step 5: LLM summary call
    const analyses = await this._enrichWithSummaries(
      missionId,
      userId,
      graph,
      rawAnalyses,
    );

    // Step 6: Upsert
    const now = new Date();
    await this.prisma.playgroundMissionGraph.upsert({
      where: { missionId },
      create: {
        missionId,
        ownerId: userId,
        status: "READY",
        graph: graph as unknown as Prisma.InputJsonValue,
        analyses: analyses as unknown as Prisma.InputJsonValue,
        generatedAt: now,
      },
      update: {
        ownerId: userId,
        status: "READY",
        graph: graph as unknown as Prisma.InputJsonValue,
        analyses: analyses as unknown as Prisma.InputJsonValue,
        generatedAt: now,
      },
    });

    return {
      status: "READY",
      graph,
      analyses,
      generatedAt: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // LLM extraction
  // ---------------------------------------------------------------------------

  private async _extractEntitiesAndRelations(
    missionId: string,
    userId: string,
    reportText: string,
  ): Promise<LlmExtractionOutput | null> {
    const maxText = reportText.slice(0, 12000); // cap to avoid token overflow

    const systemPrompt = `You are a knowledge-graph extractor. Extract entities and relations from the given report text.
Return ONLY valid JSON in this exact shape, no prose:
{
  "entities": [{"name": "string", "type": "ORGANIZATION|PERSON|TECHNOLOGY|PRODUCT|CONCEPT|EVENT|LOCATION|TREND|METRIC|OTHER"}],
  "relations": [{"source": "entity name", "target": "entity name", "type": "SUPPLIES|DEPENDS_ON|PRODUCES|USES|COMPETES_WITH|PARTNERS_WITH|BELONGS_TO|INFLUENCES|RELATED_TO|OTHER"}]
}
Be concise. Extract up to 50 entities and 80 relations. Names must match exactly across entities and relations.`;

    const tryExtract = async (): Promise<LlmExtractionOutput | null> => {
      const chatResult = await this.chat.chat({
        messages: [{ role: "user", content: maxText }],
        systemPrompt,
        taskProfile: { creativity: "low", outputLength: "long" },
        modelType: AIModelType.CHAT,
        userId,
        operationName: "playground.mission-graph.extract",
      });

      if (!chatResult.content) return null;

      const parsed = extractJsonFromAIResponse<unknown>(chatResult.content, {
        requiredKey: "entities",
      });
      if (!parsed.success || !parsed.data) return null;

      const validated = LlmExtractionSchema.safeParse(parsed.data);
      if (!validated.success) {
        this.logger.warn(
          `[graph:extract] zod validation failed mission=${missionId}: ${validated.error.message}`,
        );
        return null;
      }

      if (
        validated.data.entities.length === 0 &&
        validated.data.relations.length === 0
      ) {
        return null;
      }

      return validated.data;
    };

    let extraction = await tryExtract();
    if (!extraction) {
      this.logger.warn(
        `[graph:extract] first attempt failed for mission=${missionId}, retrying once`,
      );
      extraction = await tryExtract();
    }

    if (!extraction) {
      this.logger.warn(
        `[graph:extract] both attempts failed for mission=${missionId}`,
      );
    }

    return extraction;
  }

  // ---------------------------------------------------------------------------
  // LLM summaries
  // ---------------------------------------------------------------------------

  private async _enrichWithSummaries(
    missionId: string,
    userId: string,
    graph: MissionGraph,
    rawAnalyses: ReturnType<typeof runGraphAnalyses>,
  ): Promise<Analyses> {
    const graphSummary = buildGraphSummaryForLlm(graph, rawAnalyses);

    const chainOrders = rawAnalyses.supplyChain.layers
      .map((l) => l.order)
      .sort((a, b) => a - b);
    const summaryPrompt = `你是一位商业分析专家。根据以下知识图谱分析结果，为每项分析写一段简短的中文专业解读（1-3句，聚焦商业洞察）。
对 supplyChain（产业链）：除整体 summary 外，还要为**每一层级**单独写一段说明（每段 1-2 句，说明该层在产业链中的定位/角色与代表实体的作用）。
返回纯JSON，不要prose：
{
  "keyNodes": "...",
  "relatedness": "...",
  "competitive": "...",
  "community": "...",
  "supplyChain": "...",
  "supplyChainLayers": [${chainOrders.map((o) => `{"order": ${o}, "description": "..."}`).join(", ")}]
}`;

    try {
      const result = await this.chat.chat({
        messages: [{ role: "user", content: graphSummary }],
        systemPrompt: summaryPrompt,
        taskProfile: { creativity: "low", outputLength: "short" },
        modelType: AIModelType.CHAT,
        userId,
        operationName: "playground.mission-graph.summarize",
      });

      if (result.content) {
        const parsed = extractJsonFromAIResponse<Record<string, unknown>>(
          result.content,
          {
            requiredKey: "keyNodes",
          },
        );

        if (parsed.success && parsed.data) {
          const d = parsed.data;
          return {
            keyNodes: {
              ...rawAnalyses.keyNodes,
              summary: String(d["keyNodes"] ?? fallbackSummary("keyNodes")),
            },
            relatedness: {
              ...rawAnalyses.relatedness,
              summary: String(
                d["relatedness"] ?? fallbackSummary("relatedness"),
              ),
            },
            competitive: {
              ...rawAnalyses.competitive,
              summary: String(
                d["competitive"] ?? fallbackSummary("competitive"),
              ),
            },
            community: {
              ...rawAnalyses.community,
              summary: String(d["community"] ?? fallbackSummary("community")),
            },
            supplyChain: {
              ...rawAnalyses.supplyChain,
              layers: mergeLayerDescriptions(
                rawAnalyses.supplyChain.layers,
                d["supplyChainLayers"],
              ),
              summary: String(
                d["supplyChain"] ?? fallbackSummary("supplyChain"),
              ),
            },
          };
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `[graph:summarize] LLM summary failed for mission=${missionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Fallback: use default summary strings
    return {
      keyNodes: {
        ...rawAnalyses.keyNodes,
        summary: fallbackSummary("keyNodes"),
      },
      relatedness: {
        ...rawAnalyses.relatedness,
        summary: fallbackSummary("relatedness"),
      },
      competitive: {
        ...rawAnalyses.competitive,
        summary: fallbackSummary("competitive"),
      },
      community: {
        ...rawAnalyses.community,
        summary: fallbackSummary("community"),
      },
      supplyChain: {
        ...rawAnalyses.supplyChain,
        summary: fallbackSummary("supplyChain"),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // persist FAILED
  // ---------------------------------------------------------------------------

  private async _persistFailed(
    missionId: string,
    userId: string,
  ): Promise<MissionGraphArtifact> {
    const emptyGraph: MissionGraph = {
      nodes: [],
      edges: [],
      stats: { totalNodes: 0, totalEdges: 0 },
    };
    const emptyAnalyses: Analyses = {
      keyNodes: { items: [], summary: "" },
      relatedness: { pairs: [], summary: "" },
      competitive: { clusters: [], summary: "" },
      community: { communities: [], summary: "" },
      supplyChain: { layers: [], summary: "" },
    };

    try {
      await this.prisma.playgroundMissionGraph.upsert({
        where: { missionId },
        create: {
          missionId,
          ownerId: userId,
          status: "FAILED",
          graph: emptyGraph as unknown as Prisma.InputJsonValue,
          analyses: emptyAnalyses as unknown as Prisma.InputJsonValue,
          generatedAt: new Date(),
        },
        update: {
          status: "FAILED",
          graph: emptyGraph as unknown as Prisma.InputJsonValue,
          analyses: emptyAnalyses as unknown as Prisma.InputJsonValue,
          generatedAt: new Date(),
        },
      });
    } catch (persistErr: unknown) {
      this.logger.warn(
        `[graph:persistFailed] upsert failed for mission=${missionId}: ${
          persistErr instanceof Error ? persistErr.message : String(persistErr)
        }`,
      );
    }

    return { status: "FAILED", graph: null, analyses: null, generatedAt: null };
  }
}
