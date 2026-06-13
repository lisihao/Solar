// ─── String-literal unions (shared contract) ────────────────────────────────

export type EntityType =
  | 'ORGANIZATION'
  | 'PERSON'
  | 'TECHNOLOGY'
  | 'PRODUCT'
  | 'CONCEPT'
  | 'EVENT'
  | 'LOCATION'
  | 'TREND'
  | 'METRIC'
  | 'OTHER';

export type RelationType =
  | 'SUPPLIES'
  | 'DEPENDS_ON'
  | 'PRODUCES'
  | 'USES'
  | 'COMPETES_WITH'
  | 'PARTNERS_WITH'
  | 'BELONGS_TO'
  | 'INFLUENCES'
  | 'RELATED_TO'
  | 'OTHER';

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
    /** description：每层的中文段落说明（LLM 生成，可空）。 */
    layers: { order: number; members: string[]; description?: string }[];
    summary: string;
  };
}

// ─── API response artifact ───────────────────────────────────────────────────

export type MissionGraphStatus = 'READY' | 'BUILDING' | 'FAILED' | 'NONE';

export interface MissionGraphArtifact {
  status: MissionGraphStatus;
  graph: MissionGraph | null;
  analyses: Analyses | null;
  generatedAt: string | null;
}

// ─── Node enrichment (on-demand entity profile via engine tools) ─────────────

export interface NodeEnrichment {
  nodeId: string;
  label: string;
  type: string;
  description: string;
  facts: { label: string; value: string }[];
  sources: { title: string; url: string }[];
}
