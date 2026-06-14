/**
 * KnowledgeGraphTool Unit Tests
 *
 * Tests the knowledge-graph tool in isolation by mocking PrismaService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  KnowledgeGraphTool,
  KnowledgeGraphInput,
  KnowledgeGraphOutput,
} from "../knowledge-graph.tool";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-kg-001",
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
    properties: { since: "2020" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

function createMockPrismaService() {
  return {
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("KnowledgeGraphTool", () => {
  let tool: KnowledgeGraphTool;
  let mockPrisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeGraphTool,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    tool = module.get<KnowledgeGraphTool>(KnowledgeGraphTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'knowledge-graph'", () => {
      expect(tool.id).toBe("knowledge-graph");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for find_entity with entityName", () => {
      expect(
        tool.validateInput({ queryType: "find_entity", entityName: "Alice" }),
      ).toBe(true);
    });

    it("should return true for find_entity with entityId", () => {
      expect(
        tool.validateInput({ queryType: "find_entity", entityId: "uuid-123" }),
      ).toBe(true);
    });

    it("should return false for find_entity without entityId or entityName", () => {
      expect(tool.validateInput({ queryType: "find_entity" })).toBe(false);
    });

    it("should return false for get_neighbors without entityId", () => {
      expect(tool.validateInput({ queryType: "get_neighbors" })).toBe(false);
    });

    it("should return true for get_neighbors with entityId", () => {
      expect(
        tool.validateInput({
          queryType: "get_neighbors",
          entityId: "entity-1",
        }),
      ).toBe(true);
    });

    it("should return false for find_path without entityId or targetEntityId", () => {
      expect(
        tool.validateInput({ queryType: "find_path", entityId: "e1" }),
      ).toBe(false);
    });

    it("should return true for find_path with both entityId and targetEntityId", () => {
      expect(
        tool.validateInput({
          queryType: "find_path",
          entityId: "e1",
          targetEntityId: "e2",
        }),
      ).toBe(true);
    });

    it("should return false for invalid queryType", () => {
      expect(
        tool.validateInput({
          queryType: "unknown_type" as KnowledgeGraphInput["queryType"],
        }),
      ).toBe(false);
    });

    it("should return false for depth out of range", () => {
      expect(
        tool.validateInput({
          queryType: "find_relationships",
          depth: 5,
        }),
      ).toBe(false);
    });

    it("should return false for limit > 500", () => {
      expect(
        tool.validateInput({
          queryType: "find_relationships",
          limit: 501,
        }),
      ).toBe(false);
    });

    it("should return true for find_relationships with no extra fields", () => {
      expect(tool.validateInput({ queryType: "find_relationships" })).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // find_entity
  // -------------------------------------------------------------------------

  describe("execute() - find_entity", () => {
    it("should return nodes when entities found by name", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        makeDbEntity({ name: "Alice", type: "PERSON" }),
      ]);

      const result: ToolResult<KnowledgeGraphOutput> = await tool.execute(
        { queryType: "find_entity", entityName: "Alice" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.nodes).toHaveLength(1);
      expect(result.data?.nodes[0].name).toBe("Alice");
      expect(result.data?.edges).toHaveLength(0);
    });

    it("should return empty nodes when query returns no results", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await tool.execute(
        { queryType: "find_entity", entityName: "nonexistent" },
        makeContext(),
      );

      expect(result.data?.nodes).toHaveLength(0);
      expect(result.data?.nodeCount).toBe(0);
    });

    it("should include resourceId in nodes", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        makeDbEntity({ resource_id: "res-42" }),
      ]);

      const result = await tool.execute(
        { queryType: "find_entity", entityId: "entity-1" },
        makeContext(),
      );

      expect(result.data?.nodes[0].resourceId).toBe("res-42");
    });

    it("should return success:true with empty nodes when DB query fails gracefully", async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error("Table not found"));

      const result = await tool.execute(
        { queryType: "find_entity", entityName: "Alice" },
        makeContext(),
      );

      // The tool uses .catch(() => []) so returns success:true with empty nodes
      expect(result.success).toBe(true);
      expect(result.data?.nodes).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // find_relationships
  // -------------------------------------------------------------------------

  describe("execute() - find_relationships", () => {
    it("should return edges and associated nodes", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeDbRelationship()]) // relationships query
        .mockResolvedValueOnce([
          makeDbEntity({ id: "entity-1", name: "Alice" }),
          makeDbEntity({ id: "entity-2", name: "Bob" }),
        ]); // entities query

      const result = await tool.execute(
        { queryType: "find_relationships", entityId: "entity-1" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.edges).toHaveLength(1);
      expect(result.data?.nodes).toHaveLength(2);
      expect(result.data?.edges[0].type).toBe("KNOWS");
    });

    it("should return success with empty results when no relationships found", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await tool.execute(
        { queryType: "find_relationships" },
        makeContext(),
      );

      expect(result.data?.edges).toHaveLength(0);
      expect(result.data?.edgeCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // find_path
  // -------------------------------------------------------------------------

  describe("execute() - find_path", () => {
    it("should return paths when direct connection exists", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeDbRelationship()]) // relationships
        .mockResolvedValueOnce([
          makeDbEntity({ id: "entity-1" }),
          makeDbEntity({ id: "entity-2" }),
        ]); // entities

      const result = await tool.execute(
        {
          queryType: "find_path",
          entityId: "entity-1",
          targetEntityId: "entity-2",
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.paths).toBeDefined();
      expect(result.data?.paths?.length).toBeGreaterThan(0);
    });

    it("should return empty paths when no direct connection exists", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([]) // no relationships
        .mockResolvedValueOnce([
          makeDbEntity({ id: "entity-1" }),
          makeDbEntity({ id: "entity-2" }),
        ]);

      const result = await tool.execute(
        {
          queryType: "find_path",
          entityId: "entity-1",
          targetEntityId: "entity-3",
        },
        makeContext(),
      );

      expect(result.data?.paths).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // get_neighbors
  // -------------------------------------------------------------------------

  describe("execute() - get_neighbors", () => {
    it("should return neighbors and edges for the center entity", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeDbRelationship()]) // relationships
        .mockResolvedValueOnce([
          makeDbEntity({ id: "entity-1" }),
          makeDbEntity({ id: "entity-2", name: "Neighbor" }),
        ]); // entities

      const result = await tool.execute(
        { queryType: "get_neighbors", entityId: "entity-1" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBeGreaterThan(0);
      expect(result.data?.edges.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { queryType: "find_entity", entityName: "Alice" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
