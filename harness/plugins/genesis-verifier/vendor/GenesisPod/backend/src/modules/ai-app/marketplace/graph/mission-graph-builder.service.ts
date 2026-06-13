/**
 * MissionGraphBuilderService —— 平台共享的「报告正文 → 知识图谱」构建器。
 *
 * 定位（design.md §4.3「市场=平台共享，去采购」）：
 *   - 纯能力，**零 app/mission 耦合**：入参只有 userId（计费归属）+ reportText，
 *     产出 {graph, analyses}；**不读任何 mission 库、不持久化**——加载报告与落库归消费方。
 *   - 任意消费方（playground / company / 未来 app）复用同一构建器，避免重复造图谱。
 *
 * 抽取自 playground MissionGraphService 的核心 pipeline（步骤 2-6）+ enrichNode：
 *   2. LLM 抽取实体 + 关系
 *   3. EntityResolutionService canonical 去重
 *   4. 组装 MissionGraph
 *   5. runGraphAnalyses（纯）
 *   6. LLM 合并中文摘要
 */

import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import {
  AiChatService,
  EntityResolutionService,
  SearchService,
} from "@/modules/ai-engine/facade";
import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";
import { runGraphAnalyses } from "./graph-analyses";
import {
  LlmExtractionSchema,
  type LlmExtractionOutput,
  type MissionGraph,
  type GraphNode,
  type GraphEdge,
  type Analyses,
  type NodeEnrichment,
} from "./graph.types";

// ─── helpers（从 playground MissionGraphService 平移）──────────────────────────

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

/** 消费方传入的遥测命名空间（保持各 app 自己的 operationName 前缀不漂移）。 */
export interface GraphBuildOptions {
  /** operationName 前缀，如 "playground.mission-graph" / "company.mission-graph"。 */
  readonly operationPrefix?: string;
}

// ─── service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MissionGraphBuilderService {
  private readonly logger = new Logger(MissionGraphBuilderService.name);

  constructor(
    private readonly chat: AiChatService,
    private readonly entityResolution: EntityResolutionService,
    private readonly search: SearchService,
  ) {}

  /**
   * 报告正文 → {graph, analyses}。抽取/去重/分析/摘要全失败时返回 null（消费方据此落 FAILED）。
   */
  async build(
    userId: string,
    reportText: string,
    opts: GraphBuildOptions = {},
  ): Promise<{ graph: MissionGraph; analyses: Analyses } | null> {
    const prefix = opts.operationPrefix ?? "marketplace.mission-graph";

    if (!reportText.trim()) return null;

    // Step 2: LLM extraction
    const extractionResult = await this._extractEntitiesAndRelations(
      userId,
      reportText,
      prefix,
    );
    if (!extractionResult) return null;

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
        `[graph:build] entity resolution failed, falling back to identity: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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

    // Step 4 + 5: pure analyses + LLM summaries
    const rawAnalyses = runGraphAnalyses(graph);
    const analyses = await this._enrichWithSummaries(
      userId,
      graph,
      rawAnalyses,
      prefix,
    );

    return { graph, analyses };
  }

  /**
   * 单节点实体画像（web-search + LLM 综合）。无持久化；消费方拿到 node 后调用。
   * search/LLM 失败时降级返回基础 fallback。
   */
  async enrichNode(
    userId: string,
    node: { id: string; label: string; type: string },
    opts: GraphBuildOptions = {},
  ): Promise<NodeEnrichment> {
    const prefix = opts.operationPrefix ?? "marketplace.mission-graph";
    const nodeId = node.id;

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
        operationName: `${prefix}.enrich-node`,
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

  // ─── internal: LLM extraction ───────────────────────────────────────────────

  private async _extractEntitiesAndRelations(
    userId: string,
    reportText: string,
    prefix: string,
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
        operationName: `${prefix}.extract`,
      });

      if (!chatResult.content) return null;

      const parsed = extractJsonFromAIResponse<unknown>(chatResult.content, {
        requiredKey: "entities",
      });
      if (!parsed.success || !parsed.data) return null;

      const validated = LlmExtractionSchema.safeParse(parsed.data);
      if (!validated.success) {
        this.logger.warn(
          `[graph:extract] zod validation failed: ${validated.error.message}`,
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
      this.logger.warn(`[graph:extract] first attempt failed, retrying once`);
      extraction = await tryExtract();
    }
    if (!extraction) {
      this.logger.warn(`[graph:extract] both attempts failed`);
    }
    return extraction;
  }

  // ─── internal: LLM summaries ────────────────────────────────────────────────

  private async _enrichWithSummaries(
    userId: string,
    graph: MissionGraph,
    rawAnalyses: ReturnType<typeof runGraphAnalyses>,
    prefix: string,
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
        operationName: `${prefix}.summarize`,
      });

      if (result.content) {
        const parsed = extractJsonFromAIResponse<Record<string, unknown>>(
          result.content,
          { requiredKey: "keyNodes" },
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
        `[graph:summarize] LLM summary failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Fallback: default summary strings
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
}
