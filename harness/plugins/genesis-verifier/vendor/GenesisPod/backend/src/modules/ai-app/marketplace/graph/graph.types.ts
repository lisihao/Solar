import { z } from "zod";

// ─── String-literal unions (shared contract) ────────────────────────────────

export type EntityType =
  | "ORGANIZATION"
  | "PERSON"
  | "TECHNOLOGY"
  | "PRODUCT"
  | "CONCEPT"
  | "EVENT"
  | "LOCATION"
  | "TREND"
  | "METRIC"
  | "OTHER";

export type RelationType =
  | "SUPPLIES"
  | "DEPENDS_ON"
  | "PRODUCES"
  | "USES"
  | "COMPETES_WITH"
  | "PARTNERS_WITH"
  | "BELONGS_TO"
  | "INFLUENCES"
  | "RELATED_TO"
  | "OTHER";

// ─── Zod schemas for LLM extraction output ──────────────────────────────────

const EntityTypeValues = [
  "ORGANIZATION",
  "PERSON",
  "TECHNOLOGY",
  "PRODUCT",
  "CONCEPT",
  "EVENT",
  "LOCATION",
  "TREND",
  "METRIC",
  "OTHER",
] as const;

const RelationTypeValues = [
  "SUPPLIES",
  "DEPENDS_ON",
  "PRODUCES",
  "USES",
  "COMPETES_WITH",
  "PARTNERS_WITH",
  "BELONGS_TO",
  "INFLUENCES",
  "RELATED_TO",
  "OTHER",
] as const;

export const LlmExtractionSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(EntityTypeValues).default("OTHER"),
    }),
  ),
  relations: z.array(
    z.object({
      source: z.string().min(1),
      target: z.string().min(1),
      type: z.enum(RelationTypeValues).default("RELATED_TO"),
    }),
  ),
});

export type LlmExtractionOutput = z.infer<typeof LlmExtractionSchema>;

// ─── Core graph interfaces ───────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  label: string;
  type: EntityType;
}

export interface GraphEdge {
  source: string; // node id
  target: string; // node id
  type: RelationType;
  weight?: number;
}

export interface MissionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
  };
}

// ─── Analyses interface ──────────────────────────────────────────────────────

export interface Analyses {
  keyNodes: {
    items: { id: string; label: string; degree: number; score: number }[];
    summary: string;
  };
  relatedness: {
    pairs: { a: string; b: string; strength: number }[];
    summary: string;
  };
  competitive: {
    clusters: { members: string[] }[];
    summary: string;
  };
  community: {
    communities: { id: number; members: string[] }[];
    summary: string;
  };
  supplyChain: {
    /** description：每层的中文段落说明（LLM 生成，可空，前端按层展示）。 */
    layers: { order: number; members: string[]; description?: string }[];
    summary: string;
  };
}

/**
 * 单个图谱节点的"实体画像"——点击节点时按需用 engine 工具（web-search 等）
 * 抓取并由 LLM 综合，丰富详情面板。不持久化（前端按 session 缓存）。
 */
export interface NodeEnrichment {
  nodeId: string;
  label: string;
  type: string;
  /** 2-4 句中文简介 */
  description: string;
  /** 关键事实（成立/规模/产品/财务/融资/地位…） */
  facts: { label: string; value: string }[];
  /** 引用来源 */
  sources: { title: string; url: string }[];
}

// ─── API response artifact ───────────────────────────────────────────────────

export type MissionGraphStatus = "READY" | "BUILDING" | "FAILED" | "NONE";

export interface MissionGraphArtifact {
  status: MissionGraphStatus;
  graph: MissionGraph | null;
  analyses: Analyses | null;
  generatedAt: string | null;
}
