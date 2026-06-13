/**
 * CapabilityGuardService Unit Tests
 *
 * Covers: checkToolAccess(), checkSkillAccess(), checkDataAccess(), getCapabilities()
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { CapabilityGuardService } from "../capability-guard.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockAgentProcess {
  grantedTools?: string[];
  grantedSkills?: string[];
  dataScope?: Record<string, unknown> | null;
  userId?: string;
}

function makeMockPrisma() {
  return {
    agentProcess: {
      findUnique: jest.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CapabilityGuardService", () => {
  let service: CapabilityGuardService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapabilityGuardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CapabilityGuardService>(CapabilityGuardService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // checkToolAccess()
  // -------------------------------------------------------------------------

  describe("checkToolAccess()", () => {
    it("should allow access when grantedTools is empty (unrestricted)", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedTools: [],
      });

      const result = await service.checkToolAccess("proc-1", "web-search");

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should allow access when the specific tool is in the granted list", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedTools: ["web-search", "calculator"],
      });

      const result = await service.checkToolAccess("proc-1", "calculator");

      expect(result.allowed).toBe(true);
    });

    it("should allow access when granted list contains the wildcard '*'", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedTools: ["*"],
      });

      const result = await service.checkToolAccess("proc-1", "any-tool-name");

      expect(result.allowed).toBe(true);
    });

    it("should deny access when tool is not in the granted list (no wildcard)", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedTools: ["web-search"],
      });

      const result = await service.checkToolAccess("proc-1", "code-executor");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("code-executor");
    });

    it("should allow access when process does not exist (cleaned up)", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue(null);

      const result = await service.checkToolAccess(
        "proc-missing",
        "web-search",
      );

      expect(result.allowed).toBe(true);
    });

    it("should query by the correct processId", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedTools: [],
      });

      await service.checkToolAccess("proc-abc", "some-tool");

      expect(mockPrisma.agentProcess.findUnique).toHaveBeenCalledWith({
        where: { id: "proc-abc" },
        select: { grantedTools: true },
      });
    });
  });

  // -------------------------------------------------------------------------
  // checkSkillAccess()
  // -------------------------------------------------------------------------

  describe("checkSkillAccess()", () => {
    it("should allow access when grantedSkills is empty (unrestricted)", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedSkills: [],
      });

      const result = await service.checkSkillAccess("proc-1", "summarise");

      expect(result.allowed).toBe(true);
    });

    it("should allow access when the skill is in the granted list", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedSkills: ["summarise", "translate"],
      });

      const result = await service.checkSkillAccess("proc-1", "translate");

      expect(result.allowed).toBe(true);
    });

    it("should allow access when granted list contains the wildcard '*'", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedSkills: ["*"],
      });

      const result = await service.checkSkillAccess("proc-1", "any-skill");

      expect(result.allowed).toBe(true);
    });

    it("should deny access when skill is not in the granted list", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedSkills: ["summarise"],
      });

      const result = await service.checkSkillAccess("proc-1", "code-review");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("code-review");
    });

    it("should deny access when process is not found", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue(null);

      const result = await service.checkSkillAccess("proc-gone", "summarise");

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Process not found");
    });

    it("should query by correct processId with grantedSkills select", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedSkills: [],
      });

      await service.checkSkillAccess("proc-xyz", "my-skill");

      expect(mockPrisma.agentProcess.findUnique).toHaveBeenCalledWith({
        where: { id: "proc-xyz" },
        select: { grantedSkills: true },
      });
    });
  });

  // -------------------------------------------------------------------------
  // checkDataAccess()
  // -------------------------------------------------------------------------

  describe("checkDataAccess()", () => {
    it("should allow access when dataScope is null (no restrictions)", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        dataScope: null,
        userId: "user-1",
      });

      const result = await service.checkDataAccess(
        "proc-1",
        "document",
        "doc-123",
      );

      expect(result.allowed).toBe(true);
    });

    it("should allow access when dataScope does not contain the resource type key", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        dataScope: { images: ["img-1"] },
        userId: "user-1",
      });

      // 'document' type is not restricted in scope
      const result = await service.checkDataAccess(
        "proc-1",
        "document",
        "doc-999",
      );

      expect(result.allowed).toBe(true);
    });

    it("should allow access when the resourceId is explicitly listed in scope", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        dataScope: { document: ["doc-123", "doc-456"] },
        userId: "user-1",
      });

      const result = await service.checkDataAccess(
        "proc-1",
        "document",
        "doc-123",
      );

      expect(result.allowed).toBe(true);
    });

    it("should allow access when scope contains wildcard '*' for the resource type", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        dataScope: { document: ["*"] },
        userId: "user-1",
      });

      const result = await service.checkDataAccess(
        "proc-1",
        "document",
        "any-doc-id",
      );

      expect(result.allowed).toBe(true);
    });

    it("should deny access when resourceId is not in the scope list and no wildcard", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        dataScope: { document: ["doc-123"] },
        userId: "user-1",
      });

      const result = await service.checkDataAccess(
        "proc-1",
        "document",
        "doc-999",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("document:doc-999");
    });

    it("should deny access when process is not found", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue(null);

      const result = await service.checkDataAccess(
        "proc-missing",
        "document",
        "doc-1",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Process not found");
    });

    it("should query with dataScope and userId selected", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        dataScope: null,
        userId: "user-1",
      });

      await service.checkDataAccess("proc-1", "image", "img-1");

      expect(mockPrisma.agentProcess.findUnique).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        select: { dataScope: true, userId: true },
      });
    });
  });

  // -------------------------------------------------------------------------
  // getCapabilities()
  // -------------------------------------------------------------------------

  describe("getCapabilities()", () => {
    it("should return the full capabilities object when process exists", async () => {
      const processData: MockAgentProcess = {
        grantedTools: ["web-search", "calculator"],
        grantedSkills: ["summarise"],
        dataScope: {
          allowedTypes: ["document", "image"],
          deniedResources: ["secret-doc"],
          meta: { source: "admin" },
        },
      };
      mockPrisma.agentProcess.findUnique.mockResolvedValue(processData);

      const result = await service.getCapabilities("proc-1");

      expect(result).not.toBeNull();
      expect(result!.grantedTools).toEqual(["web-search", "calculator"]);
      expect(result!.grantedSkills).toEqual(["summarise"]);
      expect(result!.dataScope).toEqual({
        allowedTypes: ["document", "image"],
        deniedResources: ["secret-doc"],
      });
      expect(result!.meta).toEqual({ source: "admin" });
    });

    it("should return null when process does not exist", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue(null);

      const result = await service.getCapabilities("proc-missing");

      expect(result).toBeNull();
    });

    it("should return default dataScope when dataScope is null on the process", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedTools: [],
        grantedSkills: [],
        dataScope: null,
      });

      const result = await service.getCapabilities("proc-1");

      expect(result).not.toBeNull();
      expect(result!.dataScope).toEqual({
        allowedTypes: [],
        deniedResources: [],
      });
      expect(result!.meta).toEqual({});
    });

    it("should query with the correct select fields", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedTools: [],
        grantedSkills: [],
        dataScope: null,
      });

      await service.getCapabilities("proc-abc");

      expect(mockPrisma.agentProcess.findUnique).toHaveBeenCalledWith({
        where: { id: "proc-abc" },
        select: { grantedTools: true, grantedSkills: true, dataScope: true },
      });
    });

    it("should return empty arrays when both grantedTools and grantedSkills are empty", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue({
        grantedTools: [],
        grantedSkills: [],
        dataScope: null,
      });

      const result = await service.getCapabilities("proc-1");

      expect(result!.grantedTools).toEqual([]);
      expect(result!.grantedSkills).toEqual([]);
    });
  });
});
