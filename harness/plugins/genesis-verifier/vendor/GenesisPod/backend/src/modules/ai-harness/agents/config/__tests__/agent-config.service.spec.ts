/**
 * Tests for AgentConfigService
 * Covers CRUD operations, caching, seed logic, and error paths.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { AgentConfigService } from "../agent-config.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_CONFIG_FIXTURE = {
  id: "cfg-1",
  agentId: "test-agent",
  name: "Test Agent",
  description: "A test agent",
  agentType: "reactive",
  domain: "research",
  systemPrompt: "You are helpful.",
  tools: ["web-search"],
  skills: [],
  modelType: "chat",
  taskProfile: null,
  enabled: true,
  isBuiltIn: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const prismaMock = {
  agentConfig: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentConfigService", () => {
  let service: AgentConfigService;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, "log").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "error").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "debug").mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentConfigService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<AgentConfigService>(AgentConfigService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe("findAll", () => {
    it("returns all configs when no filters are provided", async () => {
      prismaMock.agentConfig.findMany.mockResolvedValue([AGENT_CONFIG_FIXTURE]);

      const result = await service.findAll();

      expect(prismaMock.agentConfig.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ domain: "asc" }, { name: "asc" }],
      });
      expect(result).toHaveLength(1);
    });

    it("passes domain filter when provided", async () => {
      prismaMock.agentConfig.findMany.mockResolvedValue([]);

      await service.findAll({ domain: "research" });

      expect(prismaMock.agentConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { domain: "research" } }),
      );
    });

    it("passes enabled filter when provided", async () => {
      prismaMock.agentConfig.findMany.mockResolvedValue([]);

      await service.findAll({ enabled: false });

      expect(prismaMock.agentConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enabled: false } }),
      );
    });

    it("combines both domain and enabled filters", async () => {
      prismaMock.agentConfig.findMany.mockResolvedValue([]);

      await service.findAll({ domain: "coding", enabled: true });

      expect(prismaMock.agentConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { domain: "coding", enabled: true } }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // findOne
  // -------------------------------------------------------------------------

  describe("findOne", () => {
    it("returns the config when found", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      const result = await service.findOne("cfg-1");
      expect(result).toEqual(AGENT_CONFIG_FIXTURE);
    });

    it("throws NotFoundException when not found", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(null);

      await expect(service.findOne("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // findByAgentId
  // -------------------------------------------------------------------------

  describe("findByAgentId", () => {
    it("returns config when found by agentId", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      const result = await service.findByAgentId("test-agent");
      expect(result).toEqual(AGENT_CONFIG_FIXTURE);
    });

    it("returns null when not found", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(null);

      const result = await service.findByAgentId("unknown");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe("create", () => {
    it("creates a config with isBuiltIn=false and enabled=true by default", async () => {
      prismaMock.agentConfig.create.mockResolvedValue({
        ...AGENT_CONFIG_FIXTURE,
        isBuiltIn: false,
        enabled: true,
      });

      const result = await service.create({
        agentId: "test-agent",
        name: "Test Agent",
        agentType: "reactive",
        domain: "research",
        systemPrompt: "You are helpful.",
      });

      expect(prismaMock.agentConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isBuiltIn: false,
            enabled: true,
            tools: [],
            skills: [],
          }),
        }),
      );
      expect(result.isBuiltIn).toBe(false);
    });

    it("accepts optional fields", async () => {
      prismaMock.agentConfig.create.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      await service.create({
        agentId: "a",
        name: "A",
        agentType: "reactive",
        domain: "d",
        systemPrompt: "s",
        tools: ["tool-1"],
        skills: ["skill-1"],
        enabled: false,
        modelType: "chat-fast",
        taskProfile: { creativity: "high" },
      });

      expect(prismaMock.agentConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tools: ["tool-1"],
            skills: ["skill-1"],
            enabled: false,
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe("update", () => {
    it("updates an existing config", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(AGENT_CONFIG_FIXTURE);
      prismaMock.agentConfig.update.mockResolvedValue({
        ...AGENT_CONFIG_FIXTURE,
        name: "Updated Name",
      });

      const result = await service.update("cfg-1", { name: "Updated Name" });

      expect(prismaMock.agentConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "cfg-1" } }),
      );
      expect(result.name).toBe("Updated Name");
    });

    it("throws NotFoundException when config does not exist", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(null);

      await expect(service.update("bad-id", { name: "x" })).rejects.toThrow(
        NotFoundException,
      );
    });

    it("invalidates the cache for the agentId after update", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(AGENT_CONFIG_FIXTURE);
      prismaMock.agentConfig.update.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      const invalidateSpy = jest.spyOn(service, "invalidateCache");

      await service.update("cfg-1", { name: "New Name" });

      expect(invalidateSpy).toHaveBeenCalledWith(AGENT_CONFIG_FIXTURE.agentId);
    });
  });

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  describe("delete", () => {
    it("deletes a non-built-in config", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue({
        ...AGENT_CONFIG_FIXTURE,
        isBuiltIn: false,
      });
      prismaMock.agentConfig.delete.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      const result = await service.delete("cfg-1");

      expect(prismaMock.agentConfig.delete).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
      });
      expect(result).toEqual(AGENT_CONFIG_FIXTURE);
    });

    it("throws BadRequestException when trying to delete a built-in config", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue({
        ...AGENT_CONFIG_FIXTURE,
        isBuiltIn: true,
      });

      await expect(service.delete("cfg-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws NotFoundException when config does not exist", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(null);

      await expect(service.delete("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("invalidates cache after delete", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue({
        ...AGENT_CONFIG_FIXTURE,
        isBuiltIn: false,
      });
      prismaMock.agentConfig.delete.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      const invalidateSpy = jest.spyOn(service, "invalidateCache");
      await service.delete("cfg-1");
      expect(invalidateSpy).toHaveBeenCalledWith(AGENT_CONFIG_FIXTURE.agentId);
    });
  });

  // -------------------------------------------------------------------------
  // getEffectiveConfig – caching
  // -------------------------------------------------------------------------

  describe("getEffectiveConfig", () => {
    it("returns null when no config exists for the agentId", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(null);

      const result = await service.getEffectiveConfig("unknown-agent");
      expect(result).toBeNull();
    });

    it("returns the config from the database", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      const result = await service.getEffectiveConfig("test-agent");
      expect(result).toEqual(AGENT_CONFIG_FIXTURE);
    });

    it("serves the second call from cache without hitting the database", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      await service.getEffectiveConfig("test-agent");
      await service.getEffectiveConfig("test-agent");

      // Only one DB call should have been made
      expect(prismaMock.agentConfig.findUnique).toHaveBeenCalledTimes(1);
    });

    it("re-queries the database after cache is invalidated", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      await service.getEffectiveConfig("test-agent");
      service.invalidateCache("test-agent");
      await service.getEffectiveConfig("test-agent");

      expect(prismaMock.agentConfig.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // invalidateCache
  // -------------------------------------------------------------------------

  describe("invalidateCache", () => {
    it("removes the cached entry for the given agentId", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      // Populate cache
      await service.getEffectiveConfig("test-agent");

      // Invalidate
      service.invalidateCache("test-agent");

      // Next call must hit DB again
      await service.getEffectiveConfig("test-agent");
      expect(prismaMock.agentConfig.findUnique).toHaveBeenCalledTimes(2);
    });

    it("does not throw when called for an agentId that was never cached", () => {
      expect(() => service.invalidateCache("never-cached")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // seedDefaults
  // -------------------------------------------------------------------------

  describe("seedDefaults", () => {
    it("creates missing configs and skips existing ones", async () => {
      // First agent does not exist, second does
      prismaMock.agentConfig.findUnique
        .mockResolvedValueOnce(null) // agent-1: not found → create
        .mockResolvedValueOnce(AGENT_CONFIG_FIXTURE); // agent-2: found → skip

      prismaMock.agentConfig.create.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      const count = await service.seedDefaults([
        {
          agentId: "agent-1",
          name: "Agent 1",
          agentType: "reactive",
          domain: "research",
          systemPrompt: "prompt 1",
        },
        {
          agentId: "agent-2",
          name: "Agent 2",
          agentType: "plan-based",
          domain: "writing",
          systemPrompt: "prompt 2",
        },
      ]);

      expect(count).toBe(1);
      expect(prismaMock.agentConfig.create).toHaveBeenCalledTimes(1);
    });

    it("returns 0 when all agents already exist", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      const count = await service.seedDefaults([
        {
          agentId: "existing",
          name: "Existing",
          agentType: "reactive",
          domain: "domain",
          systemPrompt: "p",
        },
      ]);

      expect(count).toBe(0);
      expect(prismaMock.agentConfig.create).not.toHaveBeenCalled();
    });

    it("sets isBuiltIn=true for seeded configs", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(null);
      prismaMock.agentConfig.create.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      await service.seedDefaults([
        {
          agentId: "new-agent",
          name: "New",
          agentType: "reactive",
          domain: "d",
          systemPrompt: "s",
        },
      ]);

      expect(prismaMock.agentConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isBuiltIn: true }),
        }),
      );
    });

    it("defaults tools and skills to empty arrays when not provided", async () => {
      prismaMock.agentConfig.findUnique.mockResolvedValue(null);
      prismaMock.agentConfig.create.mockResolvedValue(AGENT_CONFIG_FIXTURE);

      await service.seedDefaults([
        {
          agentId: "a",
          name: "A",
          agentType: "reactive",
          domain: "d",
          systemPrompt: "s",
        },
      ]);

      expect(prismaMock.agentConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tools: [], skills: [] }),
        }),
      );
    });
  });
});
