/**
 * KnowledgeGraphTool - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Line 469: traverse operation dispatch
 *  - Lines 473-477: error handling in doExecute catch block
 *  - Line 500: entityTypes filter in findEntity
 *  - Lines 564, 588-589: relationshipTypes filter + error catch in findRelationships
 *  - Lines 614-615: entity query error catch in findRelationships
 *  - Lines 656: findPath throws when entityId/targetEntityId missing
 *  - Lines 676-677: findPath relationships error catch
 *  - Lines 694-695: findPath entities error catch
 *  - Lines 753: getNeighbors throws when entityId missing
 *  - Lines 778-779: getNeighbors relationships error catch
 *  - Lines 788, 810-811: getNeighbors neighbor source path + entities error catch
 *  - Line 851: traverse delegates to getNeighbors
 */

import { Test, TestingModule } from "@nestjs/testing";
import { KnowledgeGraphTool } from "../knowledge-graph.tool";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ToolContext } from "../../../../abstractions/tool.interface";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "ext-kg-001",
    toolId: "knowledge-graph",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDbEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: "entity-1",
    name: "Test Entity",
    type: "PERSON",
    properties: { role: "researcher" },
    resource_id: "res-1",
    ...overrides,
  };
}

function makeDbRelationship(overrides: Record<string, unknown> = {}) {
  return {
    id: "rel-1",
    source_id: "entity-1",
    target_id: "entity-2",
    type: "KNOWS",
    weight: 0.8,
    properties: {},
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  };
}

describe("KnowledgeGraphTool (extended coverage)", () => {
  let tool: KnowledgeGraphTool;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    mockPrisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeGraphTool,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    tool = module.get(KnowledgeGraphTool);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Line 500: entityTypes filter in findEntity
  // =========================================================================

  describe("findEntity with entityTypes filter (line 500)", () => {
    it("applies entityTypes filter when provided", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([makeDbEntity()]);

      const result = await tool.execute(
        {
          queryType: "find_entity",
          entityName: "Test",
          entityTypes: ["PERSON", "ORGANIZATION"],
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.nodes).toHaveLength(1);
    });
  });

  // =========================================================================
  // Lines 564, 588-589: findRelationships with relationshipTypes + error
  // =========================================================================

  describe("findRelationships with filters and errors (lines 564, 588-589)", () => {
    it("applies relationshipTypes filter (line 564)", async () => {
      // First call: relationships query returns data
      // Second call: entities query
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeDbRelationship()])
        .mockResolvedValueOnce([
          makeDbEntity(),
          makeDbEntity({ id: "entity-2" }),
        ]);

      const result = await tool.execute(
        {
          queryType: "find_relationships",
          entityId: "entity-1",
          relationshipTypes: ["KNOWS", "COLLABORATES"],
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
    });

    it("handles relationship query error gracefully (lines 588-589)", async () => {
      // Simulate DB error for relationships query
      mockPrisma.$queryRaw
        .mockRejectedValueOnce(new Error("relation does not exist"))
        .mockResolvedValueOnce([]);

      const result = await tool.execute(
        {
          queryType: "find_relationships",
          entityId: "entity-1",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.edges).toHaveLength(0);
    });

    it("handles entity query error in findRelationships (lines 614-615)", async () => {
      // First: relationships succeed; Second: entity query fails
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeDbRelationship()])
        .mockRejectedValueOnce(new Error("entity table error"));

      const result = await tool.execute(
        {
          queryType: "find_relationships",
          entityId: "entity-1",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      // Entities failed → nodes empty but edges still present
      expect(result.data?.nodes).toHaveLength(0);
    });
  });

  // =========================================================================
  // Line 656: findPath throws when missing entityId or targetEntityId
  // =========================================================================

  describe("findPath error cases (line 656)", () => {
    it("returns failure when entityId is missing for find_path", async () => {
      const result = await tool.execute(
        {
          queryType: "find_path",
          targetEntityId: "entity-2",
          // entityId missing
        },
        makeContext(),
      );

      // The tool should catch the error and return failure
      expect(result.success).toBe(false);
    });

    it("handles relationship query error in findPath (lines 676-677)", async () => {
      mockPrisma.$queryRaw
        .mockRejectedValueOnce(new Error("relationships table missing"))
        .mockResolvedValueOnce([
          makeDbEntity(),
          makeDbEntity({ id: "entity-2" }),
        ]);

      const result = await tool.execute(
        {
          queryType: "find_path",
          entityId: "entity-1",
          targetEntityId: "entity-2",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.edges).toHaveLength(0);
    });

    it("handles entity query error in findPath (lines 694-695)", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeDbRelationship()])
        .mockRejectedValueOnce(new Error("entity query failed"));

      const result = await tool.execute(
        {
          queryType: "find_path",
          entityId: "entity-1",
          targetEntityId: "entity-2",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.nodes).toHaveLength(0);
    });
  });

  // =========================================================================
  // Line 753: getNeighbors throws when entityId is missing
  // =========================================================================

  describe("getNeighbors error cases (line 753)", () => {
    it("returns failure when entityId is missing for get_neighbors", async () => {
      const result = await tool.execute(
        { queryType: "get_neighbors" },
        makeContext(),
      );

      expect(result.success).toBe(false);
    });

    it("handles relationship query error in getNeighbors (lines 778-779)", async () => {
      mockPrisma.$queryRaw
        .mockRejectedValueOnce(new Error("DB unavailable"))
        .mockResolvedValueOnce([]);

      const result = await tool.execute(
        {
          queryType: "get_neighbors",
          entityId: "entity-center",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.edges).toHaveLength(0);
    });

    it("counts neighbor as source entity when entity IS the source (line 788)", async () => {
      // relationship where entity-center is the TARGET, not source
      // → triggers neighborIds.add(r.source_id) branch at line 788
      const rel = makeDbRelationship({
        source_id: "other-entity",
        target_id: "entity-center",
      });
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([rel])
        .mockResolvedValueOnce([
          makeDbEntity({ id: "entity-center" }),
          makeDbEntity({ id: "other-entity" }),
        ]);

      const result = await tool.execute(
        {
          queryType: "get_neighbors",
          entityId: "entity-center",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBeGreaterThan(0);
    });

    it("handles entity query error in getNeighbors (lines 810-811)", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          makeDbRelationship({ source_id: "entity-1", target_id: "entity-2" }),
        ])
        .mockRejectedValueOnce(new Error("entity table gone"));

      const result = await tool.execute(
        {
          queryType: "get_neighbors",
          entityId: "entity-1",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.nodes).toHaveLength(0);
    });

    it("handles getNeighbors with relationshipTypes filter", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeDbRelationship()])
        .mockResolvedValueOnce([
          makeDbEntity(),
          makeDbEntity({ id: "entity-2" }),
        ]);

      const result = await tool.execute(
        {
          queryType: "get_neighbors",
          entityId: "entity-1",
          relationshipTypes: ["KNOWS"],
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // Lines 469, 851: traverse operation delegates to getNeighbors
  // =========================================================================

  describe("traverse operation (lines 469, 851)", () => {
    it("executes traverse operation (delegates to getNeighbors)", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeDbRelationship()])
        .mockResolvedValueOnce([
          makeDbEntity(),
          makeDbEntity({ id: "entity-2" }),
        ]);

      const result = await tool.execute(
        {
          queryType: "traverse",
          entityId: "entity-1",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.nodes).toBeDefined();
    });
  });

  // =========================================================================
  // Lines 473-477: unsupported queryType returns graceful empty graph
  // (changed by commit 0481e2bcf: LLM-hallucinated queryType aliases are
  // normalized + genuinely-unknown types return empty result instead of throw)
  // =========================================================================

  describe("doExecute graceful unknown queryType handling", () => {
    it("returns success with empty graph for unsupported queryType (no throw)", async () => {
      const result = await tool.execute(
        { queryType: "unsupported_type" as "find_entity" },
        makeContext(),
      );

      // 0481e2bcf: graceful empty graph instead of throw → success:true, nodes:[]
      expect(result.success).toBe(true);
      expect(result.data?.nodes).toEqual([]);
    });
  });
});
