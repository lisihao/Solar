/**
 * Unit tests for mission-graph.analysis.ts — pure functions, no DB/LLM.
 */

import {
  keyNodes,
  relatedness,
  competitive,
  community,
  supplyChain,
  runGraphAnalyses,
} from "../mission-graph.analysis";
import type { MissionGraph } from "../mission-graph.types";

// ─── Test graph fixture ───────────────────────────────────────────────────────
//
// Nodes: A, B, C, D, E, F
//
// Edges:
//   A ─COMPETES_WITH─ B          (undirected competitive)
//   A ─COMPETES_WITH─ C          (undirected competitive)
//   B ─COMPETES_WITH─ C          (undirected competitive: cluster {A,B,C})
//   D ─COMPETES_WITH─ E          (separate cluster {D,E})
//   A ─SUPPLIES──────► B        (supply chain: A(0) → B(1))
//   B ─PRODUCES──────► C        (supply chain: B(1) → C(2))
//   D ─DEPENDS_ON────► C        (supply chain: D(0) → C(1), but C already at 2 via longer)
//   A ─RELATED_TO────► D        (general relatedness)
//   A ─RELATED_TO────► E        (general relatedness)
//   F ─INFLUENCES────► A        (F has low degree)

const graph: MissionGraph = {
  nodes: [
    { id: "A", label: "Alpha", type: "ORGANIZATION" },
    { id: "B", label: "Beta", type: "ORGANIZATION" },
    { id: "C", label: "Gamma", type: "TECHNOLOGY" },
    { id: "D", label: "Delta", type: "PRODUCT" },
    { id: "E", label: "Epsilon", type: "ORGANIZATION" },
    { id: "F", label: "Zeta", type: "PERSON" },
  ],
  edges: [
    { source: "A", target: "B", type: "COMPETES_WITH", weight: 2 },
    { source: "A", target: "C", type: "COMPETES_WITH" },
    { source: "B", target: "C", type: "COMPETES_WITH" },
    { source: "D", target: "E", type: "COMPETES_WITH" },
    { source: "A", target: "B", type: "SUPPLIES" },
    { source: "B", target: "C", type: "PRODUCES" },
    { source: "D", target: "C", type: "DEPENDS_ON" },
    { source: "A", target: "D", type: "RELATED_TO" },
    { source: "A", target: "E", type: "RELATED_TO" },
    { source: "F", target: "A", type: "INFLUENCES" },
  ],
  stats: { totalNodes: 6, totalEdges: 10 },
};

// ─── keyNodes ─────────────────────────────────────────────────────────────────

describe("keyNodes", () => {
  it("returns items sorted by degree descending", () => {
    const result = keyNodes(graph);
    expect(result.summary).toBe("");
    expect(result.items.length).toBeGreaterThan(0);

    // A has the highest degree: appears in A-B(competes), A-C(competes), A-B(supplies),
    // A-D(related), A-E(related), F-A(influences) = 6 incident edges
    expect(result.items[0].id).toBe("A");
    expect(result.items[0].score).toBe(1); // max degree node => score 1
    expect(result.items[0].degree).toBeGreaterThan(result.items[1].degree);
  });

  it("scores are normalized to [0,1]", () => {
    const result = keyNodes(graph);
    for (const item of result.items) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
    }
  });

  it("returns at most 12 items", () => {
    const result = keyNodes(graph);
    expect(result.items.length).toBeLessThanOrEqual(12);
  });

  it("handles empty graph", () => {
    const empty: MissionGraph = {
      nodes: [],
      edges: [],
      stats: { totalNodes: 0, totalEdges: 0 },
    };
    const result = keyNodes(empty);
    expect(result.items).toHaveLength(0);
  });
});

// ─── relatedness ─────────────────────────────────────────────────────────────

describe("relatedness", () => {
  it("returns pairs with summary empty string", () => {
    const result = relatedness(graph);
    expect(result.summary).toBe("");
    expect(Array.isArray(result.pairs)).toBe(true);
  });

  it("ranks Alpha-Beta as strongest pair (weight 2 from two edges)", () => {
    const result = relatedness(graph);
    // A(Alpha)-B(Beta) appears twice: COMPETES_WITH(weight 2) + SUPPLIES(weight 1) = 3.
    // pairs return human-readable labels, not node ids.
    const abPair = result.pairs.find(
      (p) =>
        (p.a === "Alpha" && p.b === "Beta") ||
        (p.a === "Beta" && p.b === "Alpha"),
    );
    expect(abPair).toBeDefined();
    expect(abPair!.strength).toBeGreaterThan(1);
  });

  it("pair strength values are positive", () => {
    const result = relatedness(graph);
    for (const pair of result.pairs) {
      expect(pair.strength).toBeGreaterThan(0);
    }
  });

  it("returns at most 12 pairs", () => {
    const result = relatedness(graph);
    expect(result.pairs.length).toBeLessThanOrEqual(12);
  });

  it("handles graph with no edges", () => {
    const noEdge: MissionGraph = {
      nodes: [{ id: "X", label: "X", type: "OTHER" }],
      edges: [],
      stats: { totalNodes: 1, totalEdges: 0 },
    };
    const result = relatedness(noEdge);
    expect(result.pairs).toHaveLength(0);
  });
});

// ─── competitive ─────────────────────────────────────────────────────────────

describe("competitive", () => {
  it("finds two competitive clusters", () => {
    const result = competitive(graph);
    expect(result.summary).toBe("");
    expect(result.clusters).toHaveLength(2);
  });

  it("larger cluster contains Alpha, Beta, Gamma", () => {
    const result = competitive(graph);
    // cluster members are human-readable labels, not node ids
    const bigCluster = result.clusters.find((c) => c.members.length === 3);
    expect(bigCluster).toBeDefined();
    expect(bigCluster!.members).toEqual(
      expect.arrayContaining(["Alpha", "Beta", "Gamma"]),
    );
  });

  it("smaller cluster contains Delta, Epsilon", () => {
    const result = competitive(graph);
    const smallCluster = result.clusters.find((c) => c.members.length === 2);
    expect(smallCluster).toBeDefined();
    expect(smallCluster!.members).toEqual(
      expect.arrayContaining(["Delta", "Epsilon"]),
    );
  });

  it("excludes isolated nodes (Zeta is not in any competitive edge)", () => {
    const result = competitive(graph);
    const allMembers = result.clusters.flatMap((c) => c.members);
    expect(allMembers).not.toContain("Zeta");
  });

  it("returns no clusters for graph with no COMPETES_WITH edges", () => {
    const noComp: MissionGraph = {
      nodes: [
        { id: "X", label: "X", type: "OTHER" },
        { id: "Y", label: "Y", type: "OTHER" },
      ],
      edges: [{ source: "X", target: "Y", type: "RELATED_TO" }],
      stats: { totalNodes: 2, totalEdges: 1 },
    };
    const result = competitive(noComp);
    expect(result.clusters).toHaveLength(0);
  });
});

// ─── community ────────────────────────────────────────────────────────────────

describe("community", () => {
  it("returns communities with at least 2 members each", () => {
    const result = community(graph);
    expect(result.summary).toBe("");
    for (const comm of result.communities) {
      expect(comm.members.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("assigns sequential numeric ids starting at 0", () => {
    const result = community(graph);
    const ids = result.communities.map((c) => c.id);
    ids.forEach((id, idx) => expect(id).toBe(idx));
  });

  it("handles isolated node graph", () => {
    const singleNode: MissionGraph = {
      nodes: [{ id: "Solo", label: "Solo", type: "OTHER" }],
      edges: [],
      stats: { totalNodes: 1, totalEdges: 0 },
    };
    const result = community(singleNode);
    // A single node cannot form a community of >= 2
    expect(result.communities).toHaveLength(0);
  });

  it("is deterministic across runs", () => {
    const r1 = community(graph);
    const r2 = community(graph);
    expect(
      r1.communities.map((c) => ({
        id: c.id,
        members: c.members.slice().sort(),
      })),
    ).toEqual(
      r2.communities.map((c) => ({
        id: c.id,
        members: c.members.slice().sort(),
      })),
    );
  });
});

// ─── supplyChain ─────────────────────────────────────────────────────────────

describe("supplyChain", () => {
  it("returns layers in ascending order", () => {
    const result = supplyChain(graph);
    expect(result.summary).toBe("");
    for (let i = 1; i < result.layers.length; i++) {
      expect(result.layers[i].order).toBeGreaterThan(
        result.layers[i - 1].order,
      );
    }
  });

  it("A is at layer 0 (no predecessors in supply subgraph)", () => {
    const result = supplyChain(graph);
    // A has no incoming SUPPLIES/PRODUCES/DEPENDS_ON edges → layer 0
    const layer0 = result.layers.find((l) => l.order === 0);
    expect(layer0).toBeDefined();
    expect(layer0!.members).toContain("Alpha"); // label of A
  });

  it("C is at a later layer than B (A→B→C chain)", () => {
    const result = supplyChain(graph);
    const bLayer =
      result.layers.find((l) => l.members.includes("Beta"))?.order ?? -1;
    const cLayer =
      result.layers.find((l) => l.members.includes("Gamma"))?.order ?? -1;
    expect(cLayer).toBeGreaterThan(bLayer);
  });

  it("returns no layers for graph with no supply edges", () => {
    const noSupply: MissionGraph = {
      nodes: [{ id: "X", label: "X", type: "OTHER" }],
      edges: [{ source: "X", target: "X", type: "RELATED_TO" }],
      stats: { totalNodes: 1, totalEdges: 1 },
    };
    const result = supplyChain(noSupply);
    expect(result.layers).toHaveLength(0);
  });
});

// ─── runGraphAnalyses (combined) ──────────────────────────────────────────────

describe("runGraphAnalyses", () => {
  it("returns all 5 keys with empty summary strings", () => {
    const result = runGraphAnalyses(graph);
    expect(result.keyNodes.summary).toBe("");
    expect(result.relatedness.summary).toBe("");
    expect(result.competitive.summary).toBe("");
    expect(result.community.summary).toBe("");
    expect(result.supplyChain.summary).toBe("");
  });

  it("combines results correctly", () => {
    const result = runGraphAnalyses(graph);
    expect(result.keyNodes.items.length).toBeGreaterThan(0);
    expect(result.competitive.clusters.length).toBe(2);
  });
});
