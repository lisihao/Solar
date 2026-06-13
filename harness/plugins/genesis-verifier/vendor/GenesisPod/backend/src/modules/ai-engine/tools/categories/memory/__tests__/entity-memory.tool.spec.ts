import {
  EntityMemoryTool,
  EntityOperation,
  EntityType,
  RelationType,
  Entity,
  EntityRelation,
} from "../entity-memory.tool";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock factory
// ============================================================================

const mockPrisma = {
  $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
  longTermMemory: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  },
};

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "entity-memory",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEntityRecord(entityData: Partial<Entity> = {}) {
  const entity: Entity = {
    id: "entity-albert-einstein-123",
    name: "Albert Einstein",
    type: EntityType.PERSON,
    properties: { occupation: "Physicist" },
    mentionCount: 1,
    lastMentionedAt: new Date("2025-01-01"),
    contexts: ["Discussed in relativity context"],
    ...entityData,
  };
  return {
    id: "db-record-id",
    userId: "system",
    key: entity.id,
    type: "entity",
    value: entity as unknown as object,
    tags: [entity.type],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeRelationRecord(relationData: Partial<EntityRelation> = {}) {
  const relation: EntityRelation = {
    id: "rel-entity-a-RELATED_TO-entity-b",
    fromEntityId: "entity-a",
    toEntityId: "entity-b",
    relationType: RelationType.RELATED_TO,
    properties: {},
    createdAt: new Date("2025-01-01"),
    ...relationData,
  };
  return {
    id: "db-relation-id",
    userId: "system",
    key: relation.id,
    type: "entity_relation",
    value: relation as unknown as object,
    tags: [relation.relationType],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("EntityMemoryTool", () => {
  let tool: EntityMemoryTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new EntityMemoryTool(mockPrisma as unknown as PrismaService);
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return false for an invalid operation string", () => {
      expect(
        tool.validateInput({ operation: "INVALID" as EntityOperation }),
      ).toBe(false);
    });

    it("should return true for STORE with name and type", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.STORE,
          entity: { name: "Einstein", type: EntityType.PERSON },
        }),
      ).toBe(true);
    });

    it("should return false for STORE without entity", () => {
      expect(tool.validateInput({ operation: EntityOperation.STORE })).toBe(
        false,
      );
    });

    it("should return false for STORE without entity name", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.STORE,
          entity: { name: "", type: EntityType.PERSON },
        }),
      ).toBe(false);
    });

    it("should return true for RETRIEVE with entityId", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.RETRIEVE,
          entityId: "entity-abc",
        }),
      ).toBe(true);
    });

    it("should return false for RETRIEVE without entityId", () => {
      expect(tool.validateInput({ operation: EntityOperation.RETRIEVE })).toBe(
        false,
      );
    });

    it("should return true for UPDATE with entityId", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.UPDATE,
          entityId: "entity-abc",
        }),
      ).toBe(true);
    });

    it("should return false for UPDATE without entityId", () => {
      expect(tool.validateInput({ operation: EntityOperation.UPDATE })).toBe(
        false,
      );
    });

    it("should return true for DELETE with entityId", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.DELETE,
          entityId: "entity-abc",
        }),
      ).toBe(true);
    });

    it("should return false for DELETE without entityId", () => {
      expect(tool.validateInput({ operation: EntityOperation.DELETE })).toBe(
        false,
      );
    });

    it("should return true for ADD_RELATION with all required fields", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.ADD_RELATION,
          entityId: "entity-a",
          relation: {
            toEntityId: "entity-b",
            relationType: RelationType.KNOWS,
          },
        }),
      ).toBe(true);
    });

    it("should return false for ADD_RELATION without entityId", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.ADD_RELATION,
          relation: {
            toEntityId: "entity-b",
            relationType: RelationType.KNOWS,
          },
        }),
      ).toBe(false);
    });

    it("should return false for ADD_RELATION without relation data", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.ADD_RELATION,
          entityId: "entity-a",
        }),
      ).toBe(false);
    });

    it("should return true for QUERY_RELATIONS with entityId", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.QUERY_RELATIONS,
          entityId: "entity-abc",
        }),
      ).toBe(true);
    });

    it("should return false for QUERY_RELATIONS without entityId", () => {
      expect(
        tool.validateInput({ operation: EntityOperation.QUERY_RELATIONS }),
      ).toBe(false);
    });

    it("should return true for SEARCH with query", () => {
      expect(
        tool.validateInput({
          operation: EntityOperation.SEARCH,
          query: "Einstein",
        }),
      ).toBe(true);
    });

    it("should return false for SEARCH without query", () => {
      expect(tool.validateInput({ operation: EntityOperation.SEARCH })).toBe(
        false,
      );
    });
  });

  // --------------------------------------------------------------------------
  // STORE operation
  // --------------------------------------------------------------------------

  describe("STORE operation - new entity", () => {
    it("should create a new entity when it does not exist", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);
      mockPrisma.longTermMemory.create.mockResolvedValueOnce({});
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: EntityOperation.STORE,
          entity: {
            name: "Albert Einstein",
            type: EntityType.PERSON,
            properties: { occupation: "Physicist" },
          },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(EntityOperation.STORE);
      expect(result.data?.entity?.name).toBe("Albert Einstein");
      expect(result.data?.entity?.type).toBe(EntityType.PERSON);
      expect(result.data?.entity?.mentionCount).toBe(1);
      expect(mockPrisma.longTermMemory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "system",
            type: "entity",
          }),
        }),
      );
    });

    it("should include context in entity contexts array when provided", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);
      mockPrisma.longTermMemory.create.mockResolvedValueOnce({});
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: EntityOperation.STORE,
          entity: {
            name: "Marie Curie",
            type: EntityType.PERSON,
            context: "Pioneer in radioactivity research",
          },
        },
        context,
      );

      expect(result.data?.entity?.contexts).toContain(
        "Pioneer in radioactivity research",
      );
    });

    it("should create entity with empty contexts when no context provided", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);
      mockPrisma.longTermMemory.create.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: EntityOperation.STORE,
          entity: { name: "Test Entity", type: EntityType.CONCEPT },
        },
        createMockContext(),
      );

      expect(result.data?.entity?.contexts).toEqual([]);
    });
  });

  describe("STORE operation - existing entity", () => {
    it("should update mentionCount and call update when entity exists", async () => {
      const existingRecord = makeEntityRecord({ mentionCount: 3 });
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(
        existingRecord,
      );
      mockPrisma.longTermMemory.update.mockResolvedValueOnce({});
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: EntityOperation.STORE,
          entity: {
            name: "Albert Einstein",
            type: EntityType.PERSON,
          },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.entity?.mentionCount).toBe(4);
      expect(mockPrisma.longTermMemory.update).toHaveBeenCalled();
      expect(mockPrisma.longTermMemory.create).not.toHaveBeenCalled();
    });

    it("should append context to existing entity contexts array", async () => {
      const existingRecord = makeEntityRecord({
        contexts: ["Initial context"],
        mentionCount: 1,
      });
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(
        existingRecord,
      );
      mockPrisma.longTermMemory.update.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: EntityOperation.STORE,
          entity: {
            name: "Albert Einstein",
            type: EntityType.PERSON,
            context: "New context",
          },
        },
        createMockContext(),
      );

      expect(result.data?.entity?.contexts).toContain("Initial context");
      expect(result.data?.entity?.contexts).toContain("New context");
    });

    it("should merge properties with existing entity properties", async () => {
      const existingRecord = makeEntityRecord({
        properties: { occupation: "Physicist" },
        mentionCount: 1,
      });
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(
        existingRecord,
      );
      mockPrisma.longTermMemory.update.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: EntityOperation.STORE,
          entity: {
            name: "Albert Einstein",
            type: EntityType.PERSON,
            properties: { birthYear: 1879 },
          },
        },
        createMockContext(),
      );

      expect(result.data?.entity?.properties).toMatchObject({
        occupation: "Physicist",
        birthYear: 1879,
      });
    });
  });

  // --------------------------------------------------------------------------
  // RETRIEVE operation
  // --------------------------------------------------------------------------

  describe("RETRIEVE operation", () => {
    it("should return the entity when found", async () => {
      const record = makeEntityRecord();
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(record);

      const result = await tool.execute(
        {
          operation: EntityOperation.RETRIEVE,
          entityId: "entity-albert-einstein-123",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(EntityOperation.RETRIEVE);
      expect(result.data?.entity?.name).toBe("Albert Einstein");
    });

    it("should return error when entity not found", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);

      const result = await tool.execute(
        {
          operation: EntityOperation.RETRIEVE,
          entityId: "nonexistent-entity",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("nonexistent-entity");
    });

    it("should return error when record type is not entity", async () => {
      const record = makeEntityRecord();
      (record as unknown as Record<string, unknown>).type = "entity_relation";
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(record);

      const result = await tool.execute(
        {
          operation: EntityOperation.RETRIEVE,
          entityId: "some-id",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // UPDATE operation
  // --------------------------------------------------------------------------

  describe("UPDATE operation", () => {
    it("should update entity properties when entity exists", async () => {
      const record = makeEntityRecord({
        properties: { occupation: "Physicist" },
        contexts: [],
      });
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(record);
      mockPrisma.longTermMemory.update.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: EntityOperation.UPDATE,
          entityId: "entity-albert-einstein-123",
          entity: {
            name: "Albert Einstein",
            type: EntityType.PERSON,
            properties: { birthYear: 1879, nationality: "German" },
          },
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(EntityOperation.UPDATE);
      expect(result.data?.entity?.properties).toMatchObject({
        occupation: "Physicist",
        birthYear: 1879,
        nationality: "German",
      });
      expect(mockPrisma.longTermMemory.update).toHaveBeenCalled();
    });

    it("should append context on update when context provided", async () => {
      const record = makeEntityRecord({ contexts: ["Original context"] });
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(record);
      mockPrisma.longTermMemory.update.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: EntityOperation.UPDATE,
          entityId: "entity-albert-einstein-123",
          entity: {
            name: "Albert Einstein",
            type: EntityType.PERSON,
            context: "Updated context",
          },
        },
        createMockContext(),
      );

      expect(result.data?.entity?.contexts).toContain("Original context");
      expect(result.data?.entity?.contexts).toContain("Updated context");
    });

    it("should return error when entity not found for update", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);

      const result = await tool.execute(
        {
          operation: EntityOperation.UPDATE,
          entityId: "nonexistent-entity",
          entity: { name: "Test", type: EntityType.CONCEPT },
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("nonexistent-entity");
    });
  });

  // --------------------------------------------------------------------------
  // DELETE operation
  // --------------------------------------------------------------------------

  describe("DELETE operation", () => {
    it("should delete entity and related relations", async () => {
      const entityRecord = makeEntityRecord();
      const relRecord = makeRelationRecord({
        fromEntityId: "entity-albert-einstein-123",
      });
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(entityRecord);
      mockPrisma.longTermMemory.delete.mockResolvedValueOnce({});
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([relRecord]);
      mockPrisma.longTermMemory.deleteMany.mockResolvedValueOnce({ count: 1 });

      const result = await tool.execute(
        {
          operation: EntityOperation.DELETE,
          entityId: "entity-albert-einstein-123",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(EntityOperation.DELETE);
      expect(result.data?.entity?.name).toBe("Albert Einstein");
      expect(mockPrisma.longTermMemory.delete).toHaveBeenCalled();
      expect(mockPrisma.longTermMemory.deleteMany).toHaveBeenCalled();
    });

    it("should delete entity without calling deleteMany when no related relations", async () => {
      const entityRecord = makeEntityRecord();
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(entityRecord);
      mockPrisma.longTermMemory.delete.mockResolvedValueOnce({});
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([]);

      const result = await tool.execute(
        {
          operation: EntityOperation.DELETE,
          entityId: "entity-albert-einstein-123",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(mockPrisma.longTermMemory.deleteMany).not.toHaveBeenCalled();
    });

    it("should return error when entity not found for delete", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);

      const result = await tool.execute(
        {
          operation: EntityOperation.DELETE,
          entityId: "nonexistent-entity",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("nonexistent-entity");
    });
  });

  // --------------------------------------------------------------------------
  // ADD_RELATION operation
  // --------------------------------------------------------------------------

  describe("ADD_RELATION operation", () => {
    it("should create a relation when both entities exist", async () => {
      const sourceRecord = makeEntityRecord({
        id: "entity-a",
        name: "Entity A",
      });
      const targetRecord = makeEntityRecord({
        id: "entity-b",
        name: "Entity B",
      });
      mockPrisma.longTermMemory.findUnique
        .mockResolvedValueOnce(sourceRecord)
        .mockResolvedValueOnce(targetRecord);
      mockPrisma.longTermMemory.upsert.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: EntityOperation.ADD_RELATION,
          entityId: "entity-a",
          relation: {
            toEntityId: "entity-b",
            relationType: RelationType.KNOWS,
            properties: { since: 1905 },
          },
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(EntityOperation.ADD_RELATION);
      expect(result.data?.relation?.fromEntityId).toBe("entity-a");
      expect(result.data?.relation?.toEntityId).toBe("entity-b");
      expect(result.data?.relation?.relationType).toBe(RelationType.KNOWS);
      expect(mockPrisma.longTermMemory.upsert).toHaveBeenCalled();
    });

    it("should return error when source entity not found", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);

      const result = await tool.execute(
        {
          operation: EntityOperation.ADD_RELATION,
          entityId: "nonexistent-source",
          relation: {
            toEntityId: "entity-b",
            relationType: RelationType.KNOWS,
          },
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Source entity not found");
      expect(result.data?.error).toContain("nonexistent-source");
    });

    it("should return error when target entity not found", async () => {
      const sourceRecord = makeEntityRecord({
        id: "entity-a",
        name: "Entity A",
      });
      mockPrisma.longTermMemory.findUnique
        .mockResolvedValueOnce(sourceRecord)
        .mockResolvedValueOnce(null);

      const result = await tool.execute(
        {
          operation: EntityOperation.ADD_RELATION,
          entityId: "entity-a",
          relation: {
            toEntityId: "nonexistent-target",
            relationType: RelationType.KNOWS,
          },
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Target entity not found");
      expect(result.data?.error).toContain("nonexistent-target");
    });
  });

  // --------------------------------------------------------------------------
  // QUERY_RELATIONS operation
  // --------------------------------------------------------------------------

  describe("QUERY_RELATIONS operation", () => {
    it("should return all relations where entity is source or target", async () => {
      const entityRecord = makeEntityRecord({ id: "entity-a" });
      const relFromA = makeRelationRecord({
        id: "rel-1",
        fromEntityId: "entity-a",
        toEntityId: "entity-b",
        relationType: RelationType.KNOWS,
      });
      const relToA = makeRelationRecord({
        id: "rel-2",
        fromEntityId: "entity-c",
        toEntityId: "entity-a",
        relationType: RelationType.RELATED_TO,
      });
      const unrelated = makeRelationRecord({
        id: "rel-3",
        fromEntityId: "entity-b",
        toEntityId: "entity-c",
        relationType: RelationType.PART_OF,
      });

      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(entityRecord);
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        relFromA,
        relToA,
        unrelated,
      ]);

      const result = await tool.execute(
        {
          operation: EntityOperation.QUERY_RELATIONS,
          entityId: "entity-a",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.relations).toHaveLength(2);
      expect(result.data?.metadata?.totalCount).toBe(2);
    });

    it("should filter relations by relationType when filter provided", async () => {
      const entityRecord = makeEntityRecord({ id: "entity-a" });
      const knowsRel = makeRelationRecord({
        id: "rel-1",
        fromEntityId: "entity-a",
        toEntityId: "entity-b",
        relationType: RelationType.KNOWS,
      });
      const relatedRel = makeRelationRecord({
        id: "rel-2",
        fromEntityId: "entity-a",
        toEntityId: "entity-c",
        relationType: RelationType.RELATED_TO,
      });

      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(entityRecord);
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        knowsRel,
        relatedRel,
      ]);

      const result = await tool.execute(
        {
          operation: EntityOperation.QUERY_RELATIONS,
          entityId: "entity-a",
          filter: { relationType: RelationType.KNOWS },
        },
        createMockContext(),
      );

      expect(result.data?.relations).toHaveLength(1);
      expect(result.data?.relations?.[0].relationType).toBe(RelationType.KNOWS);
    });

    it("should apply limit filter to relations", async () => {
      const entityRecord = makeEntityRecord({ id: "entity-a" });
      const relations = Array.from({ length: 5 }, (_, i) =>
        makeRelationRecord({
          id: `rel-${i}`,
          fromEntityId: "entity-a",
          toEntityId: `entity-${i}`,
          relationType: RelationType.RELATED_TO,
        }),
      );

      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(entityRecord);
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce(relations);

      const result = await tool.execute(
        {
          operation: EntityOperation.QUERY_RELATIONS,
          entityId: "entity-a",
          filter: { limit: 2 },
        },
        createMockContext(),
      );

      expect(result.data?.relations).toHaveLength(2);
    });

    it("should return error when entity not found for query_relations", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);

      const result = await tool.execute(
        {
          operation: EntityOperation.QUERY_RELATIONS,
          entityId: "nonexistent-entity",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("nonexistent-entity");
    });
  });

  // --------------------------------------------------------------------------
  // SEARCH operation
  // --------------------------------------------------------------------------

  describe("SEARCH operation", () => {
    it("should return entities matching the query by name (case-insensitive)", async () => {
      const einsteinRecord = makeEntityRecord({
        name: "Albert Einstein",
        mentionCount: 5,
      });
      const curieRecord = makeEntityRecord({
        id: "entity-curie",
        name: "Marie Curie",
        type: EntityType.PERSON,
        mentionCount: 3,
        contexts: [],
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        einsteinRecord,
        curieRecord,
      ]);

      const result = await tool.execute(
        {
          operation: EntityOperation.SEARCH,
          query: "einstein",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(EntityOperation.SEARCH);
      expect(result.data?.entities).toHaveLength(1);
      expect(result.data?.entities?.[0].name).toBe("Albert Einstein");
    });

    it("should return entities matching the query in contexts", async () => {
      const einsteinRecord = makeEntityRecord({
        name: "Albert Einstein",
        contexts: ["Pioneer of relativity theory"],
        mentionCount: 2,
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        einsteinRecord,
      ]);

      const result = await tool.execute(
        {
          operation: EntityOperation.SEARCH,
          query: "relativity",
        },
        createMockContext(),
      );

      expect(result.data?.entities).toHaveLength(1);
    });

    it("should filter entities by entityType when filter provided", async () => {
      const personRecord = makeEntityRecord({
        name: "Test Scientist",
        type: EntityType.PERSON,
        mentionCount: 5,
        contexts: [],
      });
      const placeRecord = makeEntityRecord({
        id: "entity-test-place",
        name: "Test City",
        type: EntityType.PLACE,
        mentionCount: 2,
        contexts: [],
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        personRecord,
        placeRecord,
      ]);

      const result = await tool.execute(
        {
          operation: EntityOperation.SEARCH,
          query: "test",
          filter: { entityType: EntityType.PERSON },
        },
        createMockContext(),
      );

      expect(result.data?.entities).toHaveLength(1);
      expect(result.data?.entities?.[0].type).toBe(EntityType.PERSON);
    });

    it("should respect limit filter in search results", async () => {
      const records = Array.from({ length: 5 }, (_, i) =>
        makeEntityRecord({
          id: `entity-${i}`,
          name: `Test Entity ${i}`,
          type: EntityType.CONCEPT,
          mentionCount: i + 1,
          contexts: [],
        }),
      );
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce(records);

      const result = await tool.execute(
        {
          operation: EntityOperation.SEARCH,
          query: "test",
          filter: { limit: 3 },
        },
        createMockContext(),
      );

      expect(result.data?.entities).toHaveLength(3);
    });

    it("should return empty entities array when no match found", async () => {
      const record = makeEntityRecord({
        name: "Albert Einstein",
        contexts: [],
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([record]);

      const result = await tool.execute(
        {
          operation: EntityOperation.SEARCH,
          query: "quantum mechanics xyz",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.entities).toHaveLength(0);
    });

    it("should sort search results by mentionCount descending", async () => {
      const lowMention = makeEntityRecord({
        id: "entity-low",
        name: "Test Low",
        type: EntityType.CONCEPT,
        mentionCount: 1,
        contexts: [],
      });
      const highMention = makeEntityRecord({
        id: "entity-high",
        name: "Test High",
        type: EntityType.CONCEPT,
        mentionCount: 10,
        contexts: [],
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        lowMention,
        highMention,
      ]);

      const result = await tool.execute(
        { operation: EntityOperation.SEARCH, query: "test" },
        createMockContext(),
      );

      expect(result.data?.entities?.[0].mentionCount).toBe(10);
      expect(result.data?.entities?.[1].mentionCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return error output when Prisma throws", async () => {
      mockPrisma.longTermMemory.findUnique.mockRejectedValueOnce(
        new Error("Database connection failed"),
      );

      const result = await tool.execute(
        {
          operation: EntityOperation.RETRIEVE,
          entityId: "entity-abc",
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("Database connection failed");
    });
  });
});
