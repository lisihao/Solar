/**
 * Unit tests for SkillContentService
 *
 * Direct instantiation pattern — no NestJS DI.
 * PrismaService is fully mocked with nested jest.fn() for every model method used.
 * parseSkillMd from the loader is mocked at the module level.
 */

import { NotFoundException, BadRequestException } from "@nestjs/common";
import { SkillContentService } from "../skill-content.service";
import { SkillMdDefinition } from "../../types/skill-md.types";

// ---------------------------------------------------------------------------
// Module-level mock — must be hoisted before any imports that use the module
// ---------------------------------------------------------------------------

jest.mock("../../loader/parsing/skill-parser", () => ({
  parseSkillMd: jest.fn(),
}));

// Import the mocked function after the jest.mock call
import { parseSkillMd } from "../../loader/parsing/skill-parser";

// ---------------------------------------------------------------------------
// Helpers — build mock Prisma service
// ---------------------------------------------------------------------------

function buildPrismaMock() {
  const txMock = {
    skillVersion: {
      create: jest.fn(),
    },
    skillConfig: {
      update: jest.fn(),
    },
  };

  const prisma = {
    skillConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    skillVersion: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => {
          return cb(txMock);
        },
      ),
    _txMock: txMock,
  };

  return prisma;
}

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeSkillDefinition(
  overrides: Partial<SkillMdDefinition> = {},
): SkillMdDefinition {
  return {
    metadata: {
      id: "test-skill",
      name: "Test Skill",
      description: "A test skill",
      domain: "general",
      version: "1.0.0",
      tags: ["test"],
      taskTypes: [],
      priority: 5,
      source: "local",
      enabled: true,
      layer: "content",
    } as any,
    content: "You are a helpful assistant.",
    filePath: "/skills/test-skill/SKILL.md",
    loadedAt: new Date("2025-01-01T00:00:00Z"),
    contentHash: "abc123",
    ...overrides,
  };
}

function makeDbSkillConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-id-001",
    skillId: "test-skill",
    displayName: "Test Skill",
    description: "A test skill",
    enabled: true,
    layer: "content",
    domain: "general",
    tags: ["test"],
    version: "1.0.0",
    source: "local",
    promptContent: "You are a helpful assistant.",
    frontmatter: { id: "test-skill", name: "Test Skill" },
    contentHash: "abc123",
    filePath: "/skills/test-skill/SKILL.md",
    taskProfileJson: null,
    inputSchemaJson: null,
    outputSchemaJson: null,
    lastUsedAt: null,
    usageCount: 0,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeVersionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-id-001",
    skillId: "test-skill",
    version: "1.0.0",
    promptContent: "Old prompt content.",
    frontmatter: { id: "test-skill" },
    contentHash: "oldhash123",
    changeNote: "Initial version",
    changedBy: "user-001",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillContentService", () => {
  let service: SkillContentService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new SkillContentService(prisma as any);
    jest.clearAllMocks();
  });

  // =========================================================================
  // syncFilesystemToDb
  // =========================================================================

  describe("syncFilesystemToDb()", () => {
    it("syncs a new skill that has no existing DB record", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(null);
      prisma.skillConfig.upsert.mockResolvedValue({});

      const skill = makeSkillDefinition();
      const result = await service.syncFilesystemToDb([skill]);

      expect(prisma.skillConfig.upsert).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ synced: 1, skipped: 0 });
    });

    it("upsert payload contains correct create fields for new skill", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(null);
      prisma.skillConfig.upsert.mockResolvedValue({});

      const skill = makeSkillDefinition({
        metadata: {
          id: "new-skill",
          name: "New Skill",
          description: "Desc",
          domain: "writing",
          version: "2.0.0",
          tags: ["a", "b"],
          priority: 10,
          source: "local",
          enabled: true,
          layer: "planning",
          taskProfile: { creativity: "high", outputLength: "long" },
        } as any,
        content: "prompt text",
        contentHash: "hash-new",
      });

      await service.syncFilesystemToDb([skill]);

      const upsertCall = prisma.skillConfig.upsert.mock.calls[0][0];
      expect(upsertCall.create).toMatchObject({
        skillId: "new-skill",
        displayName: "New Skill",
        description: "Desc",
        enabled: true,
        layer: "planning",
        domain: "writing",
        tags: ["a", "b"],
        promptContent: "prompt text",
        version: "2.0.0",
        source: "local",
        contentHash: "hash-new",
      });
    });

    it('skips a skill whose source is "db" (user-edited)', async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({ source: "db" }),
      );

      const skill = makeSkillDefinition();
      const result = await service.syncFilesystemToDb([skill]);

      expect(prisma.skillConfig.upsert).not.toHaveBeenCalled();
      expect(result).toEqual({ synced: 0, skipped: 1 });
    });

    it("skips a skill whose contentHash is unchanged", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({ source: "local", contentHash: "abc123" }),
      );

      const skill = makeSkillDefinition({ contentHash: "abc123" });
      const result = await service.syncFilesystemToDb([skill]);

      expect(prisma.skillConfig.upsert).not.toHaveBeenCalled();
      expect(result).toEqual({ synced: 0, skipped: 1 });
    });

    it("syncs a local skill whose contentHash changed", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({ source: "local", contentHash: "oldhash" }),
      );
      prisma.skillConfig.upsert.mockResolvedValue({});

      const skill = makeSkillDefinition({ contentHash: "newhash" });
      const result = await service.syncFilesystemToDb([skill]);

      expect(prisma.skillConfig.upsert).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ synced: 1, skipped: 0 });
    });

    it("computes contentHash via md5 when skill.contentHash is missing", async () => {
      // Existing record with a known hash so the service does not skip on hash equality
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({ source: "local", contentHash: "old-hash-differs" }),
      );
      prisma.skillConfig.upsert.mockResolvedValue({});

      // skill has no contentHash — service must compute it from content
      const skill = makeSkillDefinition({
        contentHash: undefined,
        content: "hello world",
      });
      await service.syncFilesystemToDb([skill]);

      const upsertCall = prisma.skillConfig.upsert.mock.calls[0][0];
      // Should be a non-empty md5 hex string derived from 'hello world'
      expect(upsertCall.create.contentHash).toMatch(/^[0-9a-f]{32}$/);
    });

    it("sets taskProfileJson, inputSchemaJson, outputSchemaJson to Prisma.JsonNull when absent from metadata", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(null);
      prisma.skillConfig.upsert.mockResolvedValue({});

      const skill = makeSkillDefinition({
        metadata: {
          id: "no-schema-skill",
          name: "No Schema",
          description: "Desc",
          domain: "general",
          version: "1.0.0",
          tags: [],
          priority: 5,
          source: "local",
          enabled: true,
          // taskProfile, inputSchema, outputSchema intentionally absent
        } as any,
        content: "prompt",
        contentHash: "hash-no-schema",
      });

      await service.syncFilesystemToDb([skill]);

      const upsertCall = prisma.skillConfig.upsert.mock.calls[0][0];
      // When metadata fields are absent the service uses Prisma.JsonNull
      const { Prisma: PrismaImport } = require("@prisma/client");
      expect(upsertCall.create.taskProfileJson).toBe(PrismaImport.JsonNull);
      expect(upsertCall.update.taskProfileJson).toBe(PrismaImport.JsonNull);
    });

    it("passes taskProfileJson, inputSchemaJson, outputSchemaJson when present in metadata", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(null);
      prisma.skillConfig.upsert.mockResolvedValue({});

      const skill = makeSkillDefinition({
        metadata: {
          id: "schema-skill",
          name: "Schema Skill",
          description: "Desc",
          domain: "general",
          version: "1.0.0",
          tags: [],
          priority: 5,
          source: "local",
          enabled: true,
          taskProfile: { creativity: "low", outputLength: "short" },
          inputSchema: { type: "object" },
          outputSchema: { type: "string" },
        } as any,
        content: "prompt",
        contentHash: "hash-schema",
      });

      await service.syncFilesystemToDb([skill]);

      const upsertCall = prisma.skillConfig.upsert.mock.calls[0][0];
      expect(upsertCall.create.taskProfileJson).toEqual({
        creativity: "low",
        outputLength: "short",
      });
      expect(upsertCall.create.inputSchemaJson).toEqual({ type: "object" });
      expect(upsertCall.create.outputSchemaJson).toEqual({ type: "string" });
    });

    it("uses Prisma.JsonNull for taskProfileJson in update when metadata field is absent", async () => {
      // Existing local record with a different hash so update branch is taken
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({ source: "local", contentHash: "old" }),
      );
      prisma.skillConfig.upsert.mockResolvedValue({});

      const skill = makeSkillDefinition({
        metadata: {
          id: "test-skill",
          name: "Test",
          description: "Desc",
          domain: "general",
          version: "1.0.0",
          tags: [],
          priority: 5,
          source: "local",
          enabled: true,
          // No taskProfile / inputSchema / outputSchema
        } as any,
        contentHash: "new-hash",
        content: "updated prompt",
      });

      await service.syncFilesystemToDb([skill]);

      const upsertCall = prisma.skillConfig.upsert.mock.calls[0][0];
      // Prisma.JsonNull is a special object, verify the update path also uses it
      const { Prisma: PrismaImport2 } = require("@prisma/client");
      expect(upsertCall.update.taskProfileJson).toBe(PrismaImport2.JsonNull);
    });

    it("handles multiple skills and returns correct aggregated counts", async () => {
      prisma.skillConfig.findUnique
        .mockResolvedValueOnce(null) // skill1 → synced
        .mockResolvedValueOnce(makeDbSkillConfig({ source: "db" })) // skill2 → skipped (db)
        .mockResolvedValueOnce(
          makeDbSkillConfig({ source: "local", contentHash: "same" }),
        ); // skill3 → skipped (hash)

      prisma.skillConfig.upsert.mockResolvedValue({});

      const skills = [
        makeSkillDefinition({
          metadata: { ...makeSkillDefinition().metadata, id: "skill-1" } as any,
        }),
        makeSkillDefinition({
          metadata: { ...makeSkillDefinition().metadata, id: "skill-2" } as any,
        }),
        makeSkillDefinition({
          metadata: { ...makeSkillDefinition().metadata, id: "skill-3" } as any,
          contentHash: "same",
        }),
      ];

      const result = await service.syncFilesystemToDb(skills);

      expect(result).toEqual({ synced: 1, skipped: 2 });
    });

    it("handles errors per skill gracefully without aborting the loop", async () => {
      prisma.skillConfig.findUnique
        .mockRejectedValueOnce(new Error("DB connection error"))
        .mockResolvedValueOnce(null);

      prisma.skillConfig.upsert.mockResolvedValue({});

      const skills = [
        makeSkillDefinition({
          metadata: {
            ...makeSkillDefinition().metadata,
            id: "bad-skill",
          } as any,
        }),
        makeSkillDefinition({
          metadata: {
            ...makeSkillDefinition().metadata,
            id: "good-skill",
          } as any,
        }),
      ];

      const result = await service.syncFilesystemToDb(skills);

      // bad-skill errored (neither synced nor skipped counted, loop continues)
      // good-skill upserted successfully
      expect(result).toEqual({ synced: 1, skipped: 0 });
    });

    it("returns zero counts for empty input", async () => {
      const result = await service.syncFilesystemToDb([]);
      expect(result).toEqual({ synced: 0, skipped: 0 });
    });
  });

  // =========================================================================
  // getEffectiveContent
  // =========================================================================

  describe("getEffectiveContent()", () => {
    it("returns promptContent and source when config is found", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue({
        promptContent: "You are an assistant.",
        source: "db",
      });

      const result = await service.getEffectiveContent("test-skill");

      expect(result).toEqual({
        promptContent: "You are an assistant.",
        source: "db",
      });
    });

    it("returns null when no config found", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(null);

      const result = await service.getEffectiveContent("unknown-skill");

      expect(result).toBeNull();
    });

    it("queries by skillId correctly", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue({
        promptContent: null,
        source: "local",
      });

      await service.getEffectiveContent("my-skill-id");

      expect(prisma.skillConfig.findUnique).toHaveBeenCalledWith({
        where: { skillId: "my-skill-id" },
        select: { promptContent: true, source: true },
      });
    });

    it("returns config with null promptContent when content is absent", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue({
        promptContent: null,
        source: "local",
      });

      const result = await service.getEffectiveContent("test-skill");

      expect(result).toEqual({ promptContent: null, source: "local" });
    });
  });

  // =========================================================================
  // savePromptContent
  // =========================================================================

  describe("savePromptContent()", () => {
    it("throws NotFoundException when skill does not exist", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(null);

      await expect(
        service.savePromptContent("unknown-skill", "new content", null),
      ).rejects.toThrow(NotFoundException);
    });

    it("uses a transaction to atomically snapshot and update", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old content",
          version: "1.0.0",
          contentHash: "oldhash",
          frontmatter: { id: "test-skill" },
        }),
      );

      prisma.skillVersion.count.mockResolvedValue(0);

      await service.savePromptContent("test-skill", "new content", null);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("creates a version snapshot for the old content inside the transaction", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old prompt",
          version: "1.2.3",
          contentHash: "oldhash",
          frontmatter: { id: "test-skill" },
        }),
      );

      prisma.skillVersion.count.mockResolvedValue(0);

      await service.savePromptContent(
        "test-skill",
        "new prompt",
        null,
        "My change note",
        "user-abc",
      );

      const txMock = prisma._txMock;
      expect(txMock.skillVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          skillId: "test-skill",
          version: "1.2.3",
          promptContent: "old prompt",
          contentHash: "oldhash",
          changeNote: "My change note",
          changedBy: "user-abc",
        }),
      });
    });

    it("does NOT create a version snapshot when existing promptContent is null", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: null,
          version: "1.0.0",
          contentHash: null,
          frontmatter: null,
        }),
      );

      // pruneOldVersions should NOT be called either because existing.promptContent is null
      prisma.skillVersion.count.mockResolvedValue(0);

      await service.savePromptContent("test-skill", "brand new content", null);

      const txMock = prisma._txMock;
      expect(txMock.skillVersion.create).not.toHaveBeenCalled();
    });

    it("updates skillConfig with new content, hash and incremented version inside transaction", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old",
          version: "1.0.0",
          contentHash: "oldhash",
          frontmatter: null,
        }),
      );

      prisma.skillVersion.count.mockResolvedValue(0);

      await service.savePromptContent("test-skill", "new content here", {
        key: "val",
      });

      const txMock = prisma._txMock;
      expect(txMock.skillConfig.update).toHaveBeenCalledWith({
        where: { skillId: "test-skill" },
        data: expect.objectContaining({
          promptContent: "new content here",
          version: "1.0.1",
          source: "db",
        }),
      });
    });

    it('sets source to "db" after save', async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old",
          version: "2.0.0",
          contentHash: "h",
        }),
      );
      prisma.skillVersion.count.mockResolvedValue(0);

      await service.savePromptContent("test-skill", "updated", null);

      const txMock = prisma._txMock;
      const updateData = txMock.skillConfig.update.mock.calls[0][0].data;
      expect(updateData.source).toBe("db");
    });

    it("returns the new incremented version string", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old",
          version: "3.1.4",
          contentHash: "h",
        }),
      );
      prisma.skillVersion.count.mockResolvedValue(0);

      const result = await service.savePromptContent("test-skill", "new", null);

      expect(result).toEqual({ version: "3.1.5" });
    });

    it("calls pruneOldVersions after transaction when existing content was present", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old",
          version: "1.0.0",
          contentHash: "h",
        }),
      );
      // Simulate being over the limit
      prisma.skillVersion.count.mockResolvedValue(52);
      prisma.skillVersion.findMany.mockResolvedValue([
        { id: "v-1" },
        { id: "v-2" },
      ]);
      prisma.skillVersion.deleteMany.mockResolvedValue({ count: 2 });

      await service.savePromptContent("test-skill", "new", null);

      expect(prisma.skillVersion.count).toHaveBeenCalled();
      expect(prisma.skillVersion.deleteMany).toHaveBeenCalled();
    });

    it("does NOT call pruneOldVersions when existing content was null", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: null,
          version: "1.0.0",
          contentHash: null,
        }),
      );

      await service.savePromptContent("test-skill", "first content", null);

      expect(prisma.skillVersion.count).not.toHaveBeenCalled();
    });

    it('falls back to version "1.0.0" when existing.version is null (incrementVersion receives "1.0.0")', async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old",
          version: null,
          contentHash: "h",
        }),
      );
      prisma.skillVersion.count.mockResolvedValue(0);

      const result = await service.savePromptContent(
        "test-skill",
        "new content",
        null,
      );

      // null version → fallback "1.0.0" → increment to "1.0.1"
      expect(result.version).toBe("1.0.1");
    });

    it('uses "1.0.0" as the snapshot version when existing.version is null', async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old",
          version: null,
          contentHash: "h",
          frontmatter: null,
        }),
      );
      prisma.skillVersion.count.mockResolvedValue(0);

      await service.savePromptContent("test-skill", "new", null);

      const txMock = prisma._txMock;
      expect(txMock.skillVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: "1.0.0" }),
      });
    });

    it("uses empty string for contentHash in snapshot when existing.contentHash is null", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old",
          version: "1.0.0",
          contentHash: null,
        }),
      );
      prisma.skillVersion.count.mockResolvedValue(0);

      await service.savePromptContent("test-skill", "new", null);

      const txMock = prisma._txMock;
      expect(txMock.skillVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ contentHash: "" }),
      });
    });
  });

  // =========================================================================
  // getVersionHistory
  // =========================================================================

  describe("getVersionHistory()", () => {
    it("returns versions mapped to SkillVersionRecord shape", async () => {
      const now = new Date("2025-06-01T12:00:00Z");
      prisma.skillVersion.findMany.mockResolvedValue([
        makeVersionRecord({ createdAt: now }),
      ]);

      const result = await service.getVersionHistory("test-skill");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "version-id-001",
        skillId: "test-skill",
        version: "1.0.0",
        promptContent: "Old prompt content.",
        contentHash: "oldhash123",
        changeNote: "Initial version",
        changedBy: "user-001",
        createdAt: now,
      });
    });

    it("queries in descending createdAt order", async () => {
      prisma.skillVersion.findMany.mockResolvedValue([]);

      await service.getVersionHistory("test-skill");

      expect(prisma.skillVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("respects the limit parameter (default 20)", async () => {
      prisma.skillVersion.findMany.mockResolvedValue([]);

      await service.getVersionHistory("test-skill");

      expect(prisma.skillVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });

    it("respects a custom limit parameter", async () => {
      prisma.skillVersion.findMany.mockResolvedValue([]);

      await service.getVersionHistory("test-skill", 5);

      expect(prisma.skillVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it("returns empty array when no versions exist", async () => {
      prisma.skillVersion.findMany.mockResolvedValue([]);

      const result = await service.getVersionHistory("test-skill");

      expect(result).toEqual([]);
    });

    it("casts frontmatter as Record<string, unknown> | null", async () => {
      prisma.skillVersion.findMany.mockResolvedValue([
        makeVersionRecord({ frontmatter: { id: "test-skill", level: 3 } }),
      ]);

      const result = await service.getVersionHistory("test-skill");

      expect(result[0].frontmatter).toEqual({ id: "test-skill", level: 3 });
    });

    it("maps null frontmatter correctly", async () => {
      prisma.skillVersion.findMany.mockResolvedValue([
        makeVersionRecord({ frontmatter: null }),
      ]);

      const result = await service.getVersionHistory("test-skill");

      expect(result[0].frontmatter).toBeNull();
    });
  });

  // =========================================================================
  // restoreVersion
  // =========================================================================

  describe("restoreVersion()", () => {
    it("throws an error when versionId is not found for the skill", async () => {
      prisma.skillVersion.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreVersion("test-skill", "nonexistent-version-id"),
      ).rejects.toThrow(
        "Version not found: nonexistent-version-id for skill test-skill",
      );
    });

    it('calls savePromptContent with the version content and a "Restored from" note', async () => {
      const targetVersion = makeVersionRecord({
        id: "version-id-001",
        version: "1.0.2",
        promptContent: "restored content",
        frontmatter: { id: "test-skill" },
      });

      prisma.skillVersion.findFirst.mockResolvedValue(targetVersion);

      // savePromptContent needs the skill to exist
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "current",
          version: "1.0.5",
          contentHash: "cur-hash",
        }),
      );
      prisma.skillVersion.count.mockResolvedValue(0);

      const result = await service.restoreVersion(
        "test-skill",
        "version-id-001",
      );

      // Verify it returned an incremented version
      expect(result).toHaveProperty("version");

      // Verify the snapshot was made with "Restored from" note
      const txMock = prisma._txMock;
      expect(txMock.skillVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changeNote: "Restored from v1.0.2",
        }),
      });
    });

    it("queries skillVersion.findFirst with correct id and skillId filter", async () => {
      prisma.skillVersion.findFirst.mockResolvedValue(null);

      await expect(
        service.restoreVersion("my-skill", "ver-id-999"),
      ).rejects.toThrow();

      expect(prisma.skillVersion.findFirst).toHaveBeenCalledWith({
        where: { id: "ver-id-999", skillId: "my-skill" },
      });
    });

    it("restores content from the target version record", async () => {
      const targetVersion = makeVersionRecord({
        id: "ver-restore",
        version: "1.0.1",
        promptContent: "the old good content",
        frontmatter: { id: "test-skill", tag: "restore" },
      });

      prisma.skillVersion.findFirst.mockResolvedValue(targetVersion);
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "bad content",
          version: "1.0.3",
          contentHash: "bad",
        }),
      );
      prisma.skillVersion.count.mockResolvedValue(0);

      await service.restoreVersion("test-skill", "ver-restore");

      const txMock = prisma._txMock;
      const updateCall = txMock.skillConfig.update.mock.calls[0][0];
      expect(updateCall.data.promptContent).toBe("the old good content");
    });
  });

  // =========================================================================
  // getFullSkillDefinition
  // =========================================================================

  describe("getFullSkillDefinition()", () => {
    it("returns null when skill is not found", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(null);

      const result = await service.getFullSkillDefinition("unknown-skill");

      expect(result).toBeNull();
    });

    it("returns a FullSkillDefinition when skill is found", async () => {
      const dbConfig = makeDbSkillConfig({
        taskProfileJson: { creativity: "medium", outputLength: "medium" },
        inputSchemaJson: { type: "object" },
        outputSchemaJson: { type: "string" },
        lastUsedAt: new Date("2025-05-01T00:00:00Z"),
        usageCount: 42,
      });

      prisma.skillConfig.findUnique.mockResolvedValue(dbConfig);

      const result = await service.getFullSkillDefinition("test-skill");

      expect(result).not.toBeNull();
      expect(result!.skillId).toBe("test-skill");
      expect(result!.displayName).toBe("Test Skill");
      expect(result!.description).toBe("A test skill");
      expect(result!.enabled).toBe(true);
      expect(result!.layer).toBe("content");
      expect(result!.domain).toBe("general");
      expect(result!.tags).toEqual(["test"]);
      expect(result!.version).toBe("1.0.0");
      expect(result!.source).toBe("local");
      expect(result!.promptContent).toBe("You are a helpful assistant.");
      expect(result!.contentHash).toBe("abc123");
      expect(result!.usageCount).toBe(42);
    });

    it("maps all JSON fields (taskProfileJson, inputSchemaJson, outputSchemaJson)", async () => {
      const dbConfig = makeDbSkillConfig({
        taskProfileJson: { creativity: "high", outputLength: "long" },
        inputSchemaJson: { type: "object", properties: {} },
        outputSchemaJson: { type: "array" },
      });

      prisma.skillConfig.findUnique.mockResolvedValue(dbConfig);

      const result = await service.getFullSkillDefinition("test-skill");

      expect(result!.taskProfileJson).toEqual({
        creativity: "high",
        outputLength: "long",
      });
      expect(result!.inputSchemaJson).toEqual({
        type: "object",
        properties: {},
      });
      expect(result!.outputSchemaJson).toEqual({ type: "array" });
    });

    it("maps frontmatter as Record<string, unknown> | null", async () => {
      const dbConfig = makeDbSkillConfig({
        frontmatter: { id: "test-skill", level: 5 },
      });

      prisma.skillConfig.findUnique.mockResolvedValue(dbConfig);

      const result = await service.getFullSkillDefinition("test-skill");

      expect(result!.frontmatter).toEqual({ id: "test-skill", level: 5 });
    });

    it("maps null optional fields correctly", async () => {
      const dbConfig = makeDbSkillConfig({
        taskProfileJson: null,
        inputSchemaJson: null,
        outputSchemaJson: null,
        lastUsedAt: null,
        filePath: null,
      });

      prisma.skillConfig.findUnique.mockResolvedValue(dbConfig);

      const result = await service.getFullSkillDefinition("test-skill");

      expect(result!.taskProfileJson).toBeNull();
      expect(result!.inputSchemaJson).toBeNull();
      expect(result!.outputSchemaJson).toBeNull();
      expect(result!.lastUsedAt).toBeNull();
      expect(result!.filePath).toBeNull();
    });

    it("queries by skillId without select (full record)", async () => {
      prisma.skillConfig.findUnique.mockResolvedValue(makeDbSkillConfig());

      await service.getFullSkillDefinition("test-skill");

      expect(prisma.skillConfig.findUnique).toHaveBeenCalledWith({
        where: { skillId: "test-skill" },
      });
    });
  });

  // =========================================================================
  // createSkillFromUI
  // =========================================================================

  describe("createSkillFromUI()", () => {
    it("throws BadRequestException for an invalid skillId (empty string)", async () => {
      await expect(
        service.createSkillFromUI({
          skillId: "",
          displayName: "My Skill",
          description: "Desc",
          promptContent: "Content",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for skillId starting with a special char", async () => {
      await expect(
        service.createSkillFromUI({
          skillId: "-invalid-start",
          displayName: "My Skill",
          description: "Desc",
          promptContent: "Content",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for skillId with spaces", async () => {
      await expect(
        service.createSkillFromUI({
          skillId: "my skill",
          displayName: "My Skill",
          description: "Desc",
          promptContent: "Content",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates skill with correct data including defaults", async () => {
      const createdConfig = makeDbSkillConfig({
        skillId: "new-ui-skill",
        source: "db",
        version: "1.0.0",
      });
      prisma.skillConfig.create.mockResolvedValue(createdConfig);
      prisma.skillConfig.findUnique.mockResolvedValue(createdConfig);

      await service.createSkillFromUI({
        skillId: "new-ui-skill",
        displayName: "New UI Skill",
        description: "Created from UI",
        promptContent: "Be helpful.",
      });

      expect(prisma.skillConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          skillId: "new-ui-skill",
          displayName: "New UI Skill",
          description: "Created from UI",
          promptContent: "Be helpful.",
          enabled: true,
          layer: "content",
          domain: "general",
          tags: [],
          version: "1.0.0",
          source: "db",
        }),
      });
    });

    it('sets source to "db" and version to "1.0.0" always', async () => {
      const createdConfig = makeDbSkillConfig({
        skillId: "some-skill",
        source: "db",
        version: "1.0.0",
      });
      prisma.skillConfig.create.mockResolvedValue(createdConfig);
      prisma.skillConfig.findUnique.mockResolvedValue(createdConfig);

      await service.createSkillFromUI({
        skillId: "some-skill",
        displayName: "Some",
        description: "Some skill",
        promptContent: "text",
      });

      const createData = prisma.skillConfig.create.mock.calls[0][0].data;
      expect(createData.source).toBe("db");
      expect(createData.version).toBe("1.0.0");
    });

    it("uses provided layer and domain when given", async () => {
      const createdConfig = makeDbSkillConfig({ skillId: "custom-skill" });
      prisma.skillConfig.create.mockResolvedValue(createdConfig);
      prisma.skillConfig.findUnique.mockResolvedValue(createdConfig);

      await service.createSkillFromUI({
        skillId: "custom-skill",
        displayName: "Custom",
        description: "A custom skill",
        promptContent: "text",
        layer: "planning",
        domain: "research",
        tags: ["r&d", "analysis"],
      });

      const createData = prisma.skillConfig.create.mock.calls[0][0].data;
      expect(createData.layer).toBe("planning");
      expect(createData.domain).toBe("research");
      expect(createData.tags).toEqual(["r&d", "analysis"]);
    });

    it("computes contentHash from promptContent", async () => {
      const createdConfig = makeDbSkillConfig({ skillId: "hash-skill" });
      prisma.skillConfig.create.mockResolvedValue(createdConfig);
      prisma.skillConfig.findUnique.mockResolvedValue(createdConfig);

      await service.createSkillFromUI({
        skillId: "hash-skill",
        displayName: "Hash Skill",
        description: "Desc",
        promptContent: "deterministic content",
      });

      const createData = prisma.skillConfig.create.mock.calls[0][0].data;
      expect(createData.contentHash).toMatch(/^[0-9a-f]{32}$/);
    });

    it("returns the full skill definition after creation", async () => {
      const fullConfig = makeDbSkillConfig({
        skillId: "return-skill",
        source: "db",
      });
      prisma.skillConfig.create.mockResolvedValue(fullConfig);
      prisma.skillConfig.findUnique.mockResolvedValue(fullConfig);

      const result = await service.createSkillFromUI({
        skillId: "return-skill",
        displayName: "Return Skill",
        description: "Desc",
        promptContent: "text",
      });

      expect(result).not.toBeNull();
      expect(result.skillId).toBe("return-skill");
    });

    it("accepts valid skillIds with alphanumeric, hyphens, underscores, dots", async () => {
      const validIds = [
        "abc",
        "my-skill",
        "my_skill",
        "my.skill",
        "Skill123",
        "A1",
      ];
      for (const skillId of validIds) {
        const createdConfig = makeDbSkillConfig({ skillId });
        prisma.skillConfig.create.mockResolvedValue(createdConfig);
        prisma.skillConfig.findUnique.mockResolvedValue(createdConfig);

        await expect(
          service.createSkillFromUI({
            skillId,
            displayName: "D",
            description: "D",
            promptContent: "p",
          }),
        ).resolves.not.toThrow();
      }
    });
  });

  // =========================================================================
  // parseDbContentToDefinition
  // =========================================================================

  describe("parseDbContentToDefinition()", () => {
    it("returns a SkillMdDefinition when frontmatter is provided", () => {
      const frontmatter = {
        id: "test-skill",
        name: "Test Skill",
        version: "1.0.0",
      };
      const promptContent = "You are a helpful assistant.";

      const result = service.parseDbContentToDefinition(
        "test-skill",
        promptContent,
        frontmatter as any,
      );

      expect(result).not.toBeNull();
      expect(result!.content).toBe(promptContent);
      expect(result!.metadata).toEqual(frontmatter);
    });

    it("sets loadedAt to a current Date when frontmatter is provided", () => {
      const before = Date.now();
      const result = service.parseDbContentToDefinition(
        "test-skill",
        "content",
        { id: "test-skill" } as any,
      );
      const after = Date.now();

      expect(result!.loadedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(result!.loadedAt.getTime()).toBeLessThanOrEqual(after);
    });

    it("computes contentHash via md5 when frontmatter is provided", () => {
      const result = service.parseDbContentToDefinition(
        "test-skill",
        "some content",
        { id: "test-skill" } as any,
      );

      expect(result!.contentHash).toMatch(/^[0-9a-f]{32}$/);
    });

    it("falls back to parseSkillMd when frontmatter is null", () => {
      const mockDefinition = makeSkillDefinition();
      (parseSkillMd as jest.Mock).mockReturnValue(mockDefinition);

      const result = service.parseDbContentToDefinition(
        "test-skill",
        "---\nid: test-skill\n---\nContent",
        null,
      );

      expect(parseSkillMd).toHaveBeenCalledWith(
        "---\nid: test-skill\n---\nContent",
      );
      expect(result).toEqual(mockDefinition);
    });

    it("returns null when parseSkillMd throws (no frontmatter path)", () => {
      (parseSkillMd as jest.Mock).mockImplementation(() => {
        throw new Error("Invalid SKILL.md format");
      });

      const result = service.parseDbContentToDefinition(
        "test-skill",
        "invalid content without frontmatter",
        null,
      );

      expect(result).toBeNull();
    });

    it("returns null when an unexpected error occurs with frontmatter path", () => {
      // Force an error by passing a circular reference for frontmatter
      // (crypto.createHash will throw on serializing it via content — we test an artificial case)
      const badFrontmatter = {} as any;
      // Make the crypto call indirectly fail by using a spy
      const cryptoSpy = jest
        .spyOn(require("crypto"), "createHash")
        .mockImplementationOnce(() => {
          throw new Error("crypto error");
        });

      const result = service.parseDbContentToDefinition(
        "test-skill",
        "content",
        badFrontmatter,
      );

      expect(result).toBeNull();
      cryptoSpy.mockRestore();
    });
  });

  // =========================================================================
  // recordUsage
  // =========================================================================

  describe("recordUsage()", () => {
    it("updates lastUsedAt and increments usageCount", async () => {
      prisma.skillConfig.updateMany.mockResolvedValue({ count: 1 });

      await service.recordUsage("test-skill");

      expect(prisma.skillConfig.updateMany).toHaveBeenCalledWith({
        where: { skillId: "test-skill" },
        data: {
          lastUsedAt: expect.any(Date),
          usageCount: { increment: 1 },
        },
      });
    });

    it("silently handles errors without throwing", async () => {
      prisma.skillConfig.updateMany.mockRejectedValue(new Error("DB error"));

      await expect(service.recordUsage("test-skill")).resolves.not.toThrow();
    });

    it("does not throw even if skillId does not exist (updateMany affects 0 rows)", async () => {
      prisma.skillConfig.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.recordUsage("nonexistent-skill"),
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // incrementVersion — tested indirectly via savePromptContent
  // =========================================================================

  describe("incrementVersion (via savePromptContent)", () => {
    async function callSaveAndGetVersion(
      currentVersion: string,
    ): Promise<string> {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old",
          version: currentVersion,
          contentHash: "h",
        }),
      );
      prisma.skillVersion.count.mockResolvedValue(0);

      const result = await service.savePromptContent("test-skill", "new", null);
      return result.version;
    }

    it("increments patch segment: 1.0.0 → 1.0.1", async () => {
      const version = await callSaveAndGetVersion("1.0.0");
      expect(version).toBe("1.0.1");
    });

    it("increments patch segment: 2.3.9 → 2.3.10", async () => {
      const version = await callSaveAndGetVersion("2.3.9");
      expect(version).toBe("2.3.10");
    });

    it("increments patch segment: 1.0.4 → 1.0.5", async () => {
      const version = await callSaveAndGetVersion("1.0.4");
      expect(version).toBe("1.0.5");
    });

    it("falls back to 1.0.1 for non-standard (non-semver) version strings", async () => {
      const version = await callSaveAndGetVersion("invalid");
      expect(version).toBe("1.0.1");
    });

    it("falls back to 1.0.1 for two-part versions", async () => {
      const version = await callSaveAndGetVersion("1.0");
      expect(version).toBe("1.0.1");
    });
  });

  // =========================================================================
  // pruneOldVersions — tested indirectly via savePromptContent
  // =========================================================================

  describe("pruneOldVersions (via savePromptContent)", () => {
    beforeEach(() => {
      prisma.skillConfig.findUnique.mockResolvedValue(
        makeDbSkillConfig({
          promptContent: "old content",
          version: "1.0.0",
          contentHash: "h",
        }),
      );
    });

    it("does NOT delete versions when count is at or below the limit (50)", async () => {
      prisma.skillVersion.count.mockResolvedValue(50);

      await service.savePromptContent("test-skill", "new", null);

      expect(prisma.skillVersion.deleteMany).not.toHaveBeenCalled();
    });

    it("deletes oldest versions when count exceeds 50", async () => {
      prisma.skillVersion.count.mockResolvedValue(53);
      prisma.skillVersion.findMany.mockResolvedValue([
        { id: "oldest-1" },
        { id: "oldest-2" },
        { id: "oldest-3" },
      ]);
      prisma.skillVersion.deleteMany.mockResolvedValue({ count: 3 });

      await service.savePromptContent("test-skill", "new", null);

      expect(prisma.skillVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { skillId: "test-skill" },
          orderBy: { createdAt: "asc" },
          take: 3, // 53 - 50 = 3
          select: { id: true },
        }),
      );

      expect(prisma.skillVersion.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["oldest-1", "oldest-2", "oldest-3"] } },
      });
    });

    it("does NOT call deleteMany when findMany returns empty array", async () => {
      prisma.skillVersion.count.mockResolvedValue(51);
      prisma.skillVersion.findMany.mockResolvedValue([]);

      await service.savePromptContent("test-skill", "new", null);

      expect(prisma.skillVersion.deleteMany).not.toHaveBeenCalled();
    });
  });
});
