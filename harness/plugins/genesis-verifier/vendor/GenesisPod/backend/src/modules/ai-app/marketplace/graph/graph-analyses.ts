/**
 * mission-graph.analysis.ts — Pure (no IO) graph analysis functions
 *
 * 5 analyses on a MissionGraph:
 *   keyNodes     — degree centrality, top ~12
 *   relatedness  — top ~12 entity pairs by edge weight + Jaccard tiebreak
 *   competitive  — connected components in COMPETES_WITH undirected subgraph
 *   community    — label propagation on full undirected graph (up to 5 passes)
 *   supplyChain  — Kahn-style longest-path layering on SUPPLIES|PRODUCES|DEPENDS_ON subgraph
 */

import type { MissionGraph, GraphNode, Analyses } from "./graph.types";

// ─── Key Nodes ────────────────────────────────────────────────────────────────

export function keyNodes(graph: MissionGraph): Analyses["keyNodes"] {
  const degree = new Map<string, number>();
  for (const node of graph.nodes) degree.set(node.id, 0);
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const maxDegree = Math.max(0, ...degree.values());

  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  const sorted = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  const items = sorted.map(([id, deg]) => ({
    id,
    label: nodeMap.get(id)?.label ?? id,
    degree: deg,
    score: maxDegree > 0 ? deg / maxDegree : 0,
  }));

  return { items, summary: "" };
}

// ─── Relatedness ──────────────────────────────────────────────────────────────

export function relatedness(graph: MissionGraph): Analyses["relatedness"] {
  // Build adjacency sets for Jaccard
  const neighbors = new Map<string, Set<string>>();
  for (const node of graph.nodes) neighbors.set(node.id, new Set());
  for (const edge of graph.edges) {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }

  // Aggregate edge weights between unique pairs
  const pairWeights = new Map<string, number>();
  for (const edge of graph.edges) {
    const a = edge.source < edge.target ? edge.source : edge.target;
    const b = edge.source < edge.target ? edge.target : edge.source;
    if (a === b) continue;
    const key = `${a}|||${b}`;
    pairWeights.set(key, (pairWeights.get(key) ?? 0) + (edge.weight ?? 1));
  }

  if (pairWeights.size === 0) return { pairs: [], summary: "" };

  const jaccardOf = (a: string, b: string): number => {
    const na = neighbors.get(a) ?? new Set<string>();
    const nb = neighbors.get(b) ?? new Set<string>();
    let intersection = 0;
    for (const x of na) if (nb.has(x)) intersection++;
    const union = na.size + nb.size - intersection;
    return union === 0 ? 0 : intersection / union;
  };

  const entries = [...pairWeights.entries()].map(([key, w]) => {
    const [a, b] = key.split("|||");
    return { a, b, strength: w, jaccard: jaccardOf(a, b) };
  });

  entries.sort((x, y) => {
    if (y.strength !== x.strength) return y.strength - x.strength;
    return y.jaccard - x.jaccard;
  });

  // Resolve node ids → human-readable labels for display + LLM context.
  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const labelOf = (id: string): string => nodeMap.get(id)?.label ?? id;

  const pairs = entries
    .slice(0, 12)
    .map(({ a, b, strength }) => ({ a: labelOf(a), b: labelOf(b), strength }));
  return { pairs, summary: "" };
}

// ─── Competitive ──────────────────────────────────────────────────────────────

export function competitive(graph: MissionGraph): Analyses["competitive"] {
  const compEdges = graph.edges.filter((e) => e.type === "COMPETES_WITH");
  if (compEdges.length === 0) return { clusters: [], summary: "" };

  // Build undirected adjacency from COMPETES_WITH edges
  const adj = new Map<string, Set<string>>();
  const addNode = (id: string) => {
    if (!adj.has(id)) adj.set(id, new Set());
  };

  for (const edge of compEdges) {
    addNode(edge.source);
    addNode(edge.target);
    adj.get(edge.source)!.add(edge.target);
    adj.get(edge.target)!.add(edge.source);
  }

  // BFS connected components
  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const labelOf = (id: string): string => nodeMap.get(id)?.label ?? id;
  const visited = new Set<string>();
  const clusters: { members: string[] }[] = [];

  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (const nb of adj.get(curr) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    if (component.length >= 2) {
      clusters.push({ members: component.map(labelOf).sort() });
    }
  }

  return { clusters, summary: "" };
}

// ─── Community ────────────────────────────────────────────────────────────────

export function community(graph: MissionGraph): Analyses["community"] {
  if (graph.nodes.length === 0) return { communities: [], summary: "" };

  // Build undirected adjacency on full graph
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    adj.get(edge.source)?.push(edge.target);
    adj.get(edge.target)?.push(edge.source);
  }

  // Init labels: each node is its own label
  const label = new Map<string, string>();
  for (const node of graph.nodes) label.set(node.id, node.id);

  // Label propagation: up to 5 passes
  const nodeIds = graph.nodes.map((n) => n.id);

  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    // Deterministic order: sort node ids
    const sortedIds = [...nodeIds].sort();
    for (const id of sortedIds) {
      const nbs = adj.get(id) ?? [];
      if (nbs.length === 0) continue;

      // Count label frequencies among neighbors
      const freq = new Map<string, number>();
      for (const nb of nbs) {
        const lbl = label.get(nb)!;
        freq.set(lbl, (freq.get(lbl) ?? 0) + 1);
      }

      // Find max frequency, tiebreak by smallest label string
      let bestLabel = "";
      let bestCount = -1;
      for (const [lbl, cnt] of freq.entries()) {
        if (cnt > bestCount || (cnt === bestCount && lbl < bestLabel)) {
          bestLabel = lbl;
          bestCount = cnt;
        }
      }

      if (bestLabel && bestLabel !== label.get(id)) {
        label.set(id, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group by final label
  const groups = new Map<string, string[]>();
  for (const id of nodeIds) {
    const lbl = label.get(id)!;
    if (!groups.has(lbl)) groups.set(lbl, []);
    groups.get(lbl)!.push(id);
  }

  // Keep groups with >= 2 members, assign sequential numeric ids.
  // Resolve node ids → labels for display + LLM context.
  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const labelOf = (id: string): string => nodeMap.get(id)?.label ?? id;
  let commId = 0;
  const communities: { id: number; members: string[] }[] = [];
  for (const members of groups.values()) {
    if (members.length >= 2) {
      communities.push({ id: commId++, members: members.map(labelOf).sort() });
    }
  }

  return { communities, summary: "" };
}

// ─── Supply Chain ─────────────────────────────────────────────────────────────

export function supplyChain(graph: MissionGraph): Analyses["supplyChain"] {
  const SUPPLY_TYPES = new Set(["SUPPLIES", "PRODUCES", "DEPENDS_ON"]);

  const supplyEdges = graph.edges.filter((e) => SUPPLY_TYPES.has(e.type));
  if (supplyEdges.length === 0) return { layers: [], summary: "" };

  // Collect nodes that appear in supply subgraph
  const nodeSet = new Set<string>();
  for (const edge of supplyEdges) {
    nodeSet.add(edge.source);
    nodeSet.add(edge.target);
  }

  // Build directed adjacency: source → [targets] and in-degree
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const id of nodeSet) {
    outEdges.set(id, []);
    inDegree.set(id, 0);
  }
  for (const edge of supplyEdges) {
    if (edge.source === edge.target) continue;
    outEdges.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Kahn-style longest-path level assignment
  const layerOf = new Map<string, number>();
  const queue: string[] = [];

  // Start with nodes that have no incoming edges
  for (const id of nodeSet) {
    if ((inDegree.get(id) ?? 0) === 0) {
      layerOf.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLayer = layerOf.get(curr) ?? 0;
    for (const next of outEdges.get(curr) ?? []) {
      const proposedLayer = currLayer + 1;
      const existingLayer = layerOf.get(next);
      if (existingLayer === undefined || proposedLayer > existingLayer) {
        layerOf.set(next, proposedLayer);
      }
      inDegree.set(next, (inDegree.get(next) ?? 1) - 1);
      if ((inDegree.get(next) ?? 0) <= 0) {
        queue.push(next);
      }
    }
  }

  // Handle nodes in cycles (not yet assigned a layer): put them at current max
  const assignedMax = layerOf.size > 0 ? Math.max(...layerOf.values()) : 0;
  for (const id of nodeSet) {
    if (!layerOf.has(id)) {
      layerOf.set(id, assignedMax);
    }
  }

  // Build node label map for display
  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  // Group by layer
  const layerGroups = new Map<number, string[]>();
  for (const [id, layer] of layerOf.entries()) {
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(nodeMap.get(id)?.label ?? id);
  }

  const layers = [...layerGroups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([order, members]) => ({ order, members: members.sort() }));

  return { layers, summary: "" };
}

// ─── Combined runner ──────────────────────────────────────────────────────────

export interface GraphAnalysesResult {
  keyNodes: Analyses["keyNodes"];
  relatedness: Analyses["relatedness"];
  competitive: Analyses["competitive"];
  community: Analyses["community"];
  supplyChain: Analyses["supplyChain"];
}

export function runGraphAnalyses(graph: MissionGraph): GraphAnalysesResult {
  return {
    keyNodes: keyNodes(graph),
    relatedness: relatedness(graph),
    competitive: competitive(graph),
    community: community(graph),
    supplyChain: supplyChain(graph),
  };
}
