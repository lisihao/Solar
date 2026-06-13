import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { AIController } from "../ai/ai.controller";
import { AIAdminService } from "../ai/ai-admin.service";
import {
  GuardrailsPipelineService,
  SkillSandboxService,
} from "../../../ai-engine/facade";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
jest.mock("../../../../common/cache/cache.module", () => ({}));
jest.mock("../../../../common/cache/cache.service", () => ({
  CacheService: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock AIAdminService
// ---------------------------------------------------------------------------
const mockAIAdminService = {
  // Tools
  batchUpdateTools: jest.fn(),
  getToolConfigs: jest.fn(),
  updateToolConfig: jest.fn(),
  testTool: jest.fn(),
  diagnoseTools: jest.fn(),
  diagnoseExternalTools: jest.fn(),
  getServiceKeyHealth: jest.fn(),
  getAvailableToolsForAgent: jest.fn(),

  // Skills
  batchUpdateSkills: jest.fn(),
  uploadSkill: jest.fn(),
  getSkillConfigs: jest.fn(),
  updateSkillConfig: jest.fn(),

  // MCP Servers
  getMCPServerConfigs: jest.fn(),
  addMCPServer: jest.fn(),
  updateMCPServer: jest.fn(),
  updateMCPServerEnv: jest.fn(),
  connectMCPServer: jest.fn(),
  disconnectMCPServer: jest.fn(),
  deleteMCPServer: jest.fn(),
  diagnoseMCPServers: jest.fn(),
  diagnoseAllCapabilities: jest.fn(),

  // Usage & Config
  getAllConfigs: jest.fn(),
  getUsageCountsByType: jest.fn(),
};

const mockGuardrailsPipeline = {
  getRegisteredGuardrails: jest.fn().mockReturnValue({
    input: [],
    output: [],
    totalRules: 0,
  }),
};

const mockSkillSandboxService = {
  testExecution: jest.fn(),
  validateSkillContent: jest.fn(),
  dryRun: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("AIController", () => {
  let controller: AIController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AIController],
      providers: [
        { provide: AIAdminService, useValue: mockAIAdminService },
        {
          provide: GuardrailsPipelineService,
          useValue: mockGuardrailsPipeline,
        },
        {
          provide: SkillSandboxService,
          useValue: mockSkillSandboxService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AIController>(AIController);
  });

  // ====================== Batch Operations ======================

  describe("batchUpdateTools()", () => {
    it("should call batchUpdateTools with the updates array", async () => {
      const updates = [
        { toolId: "tool-1", enabled: true },
        { toolId: "tool-2", enabled: false },
      ];
      mockAIAdminService.batchUpdateTools.mockResolvedValue({ updated: 2 });

      const result = await controller.batchUpdateTools({ updates });

      expect(mockAIAdminService.batchUpdateTools).toHaveBeenCalledWith(updates);
      expect(result).toEqual({ updated: 2 });
    });

    it("should handle empty updates array", async () => {
      mockAIAdminService.batchUpdateTools.mockResolvedValue({ updated: 0 });

      const result = await controller.batchUpdateTools({ updates: [] });

      expect(mockAIAdminService.batchUpdateTools).toHaveBeenCalledWith([]);
      expect(result).toEqual({ updated: 0 });
    });
  });

  describe("batchUpdateSkills()", () => {
    it("should call batchUpdateSkills with the updates array", async () => {
      const updates = [{ skillId: "skill-1", enabled: true }];
      mockAIAdminService.batchUpdateSkills.mockResolvedValue({ updated: 1 });

      const result = await controller.batchUpdateSkills({ updates });

      expect(mockAIAdminService.batchUpdateSkills).toHaveBeenCalledWith(
        updates,
      );
      expect(result).toEqual({ updated: 1 });
    });
  });

  // ====================== Tools ======================

  describe("getTools()", () => {
    it("should return all tool configurations", async () => {
      const tools = [
        { toolId: "web-search", enabled: true },
        { toolId: "calculator", enabled: false },
      ];
      mockAIAdminService.getToolConfigs.mockResolvedValue(tools);

      const result = await controller.getTools();

      expect(mockAIAdminService.getToolConfigs).toHaveBeenCalled();
      expect(result).toEqual(tools);
    });
  });

  // ★ 2026-05-07 (PR-S0a): tool aliases endpoint —— 单源真理输出给前端
  // useToolAliases() hook 替代前端硬编码 PROVIDER_TO_TOOL_ID。
  describe("getToolAliases()", () => {
    it("returns alias map + multi-provider parents from service", async () => {
      const expected = {
        aliasToRegistry: {
          tavily: "web-search",
          perplexity: "web-search",
          arxiv: "arxiv-search",
        },
        multiProviderRegistryIds: ["web-search"],
      };
      mockAIAdminService.getToolAliases = jest.fn().mockReturnValue(expected);

      const result = await controller.getToolAliases();

      expect(mockAIAdminService.getToolAliases).toHaveBeenCalled();
      expect(result).toEqual(expected);
    });

    // 看护 Sec-6（v1.4 §5）：endpoint 必须挂在 admin-guarded controller 上
    // ★ Round 2 加强：同时校验 method 级别**没有** @Public/@UseGuards override
    //   把 class 级 guard shadow 掉
    it("inherits @AdminGuard from controller AND has no method-level guard override", () => {
      // class 级 guards 存在（JwtAuthGuard + AdminGuard）
      const classGuards = Reflect.getMetadata(
        "__guards__",
        AIController,
      ) as unknown[] | undefined;
      expect(classGuards).toBeDefined();
      expect(classGuards!.length).toBeGreaterThanOrEqual(2);

      // method 级别**不应**有 override（任何方法级 @UseGuards 会 shadow class 级）
      const methodGuards = Reflect.getMetadata(
        "__guards__",
        AIController.prototype.getToolAliases,
      );
      expect(methodGuards).toBeUndefined();

      // method 级别**不应**有 @Public()（IS_PUBLIC_KEY 会让 JwtAuthGuard 跳过校验）
      const isPublic = Reflect.getMetadata(
        "isPublic",
        AIController.prototype.getToolAliases,
      );
      expect(isPublic).toBeFalsy();
    });
  });

  describe("updateTool()", () => {
    it("should update a tool configuration", async () => {
      const body = { enabled: true, displayName: "Web Search Enhanced" };
      mockAIAdminService.updateToolConfig.mockResolvedValue({
        toolId: "web-search",
        ...body,
      });

      const result = await controller.updateTool("web-search", body);

      expect(mockAIAdminService.updateToolConfig).toHaveBeenCalledWith(
        "web-search",
        body,
      );
      expect(result).toMatchObject({ toolId: "web-search" });
    });

    it("should allow updating secretKey to null", async () => {
      const body = { secretKey: null };
      mockAIAdminService.updateToolConfig.mockResolvedValue({
        toolId: "tool-1",
        secretKey: null,
      });

      const result = await controller.updateTool("tool-1", body);

      expect(mockAIAdminService.updateToolConfig).toHaveBeenCalledWith(
        "tool-1",
        body,
      );
      expect(result.secretKey).toBeNull();
    });
  });

  describe("testTool()", () => {
    it("should call testTool with toolId and input", async () => {
      const input = { query: "test query" };
      const testResult = { success: true, output: "result" };
      mockAIAdminService.testTool.mockResolvedValue(testResult);

      const result = await controller.testTool("web-search", { input });

      expect(mockAIAdminService.testTool).toHaveBeenCalledWith(
        "web-search",
        input,
      );
      expect(result).toEqual(testResult);
    });

    it("should handle missing input gracefully", async () => {
      mockAIAdminService.testTool.mockResolvedValue({ success: true });

      await controller.testTool("tool-1", {});

      expect(mockAIAdminService.testTool).toHaveBeenCalledWith(
        "tool-1",
        undefined,
      );
    });
  });

  describe("diagnoseTools()", () => {
    it("should return tool health diagnosis with summary", async () => {
      const diagnosis = {
        tools: [
          { toolId: "web-search", status: "healthy" },
          { toolId: "calculator", status: "unconfigured" },
        ],
        summary: { total: 2, healthy: 1, unhealthy: 0, unconfigured: 1 },
      };
      mockAIAdminService.diagnoseTools.mockResolvedValue(diagnosis);

      const result = await controller.diagnoseTools();

      expect(mockAIAdminService.diagnoseTools).toHaveBeenCalled();
      expect(result).toEqual(diagnosis);
    });
  });

  describe("diagnoseExternalTools()", () => {
    it("should return external tools diagnosis", async () => {
      const diagnosis = {
        tools: [{ toolId: "tavily", status: "healthy" }],
        summary: { total: 1, healthy: 1 },
      };
      mockAIAdminService.diagnoseExternalTools.mockResolvedValue(diagnosis);

      const result = await controller.diagnoseExternalTools();

      expect(mockAIAdminService.diagnoseExternalTools).toHaveBeenCalled();
      expect(result).toEqual(diagnosis);
    });
  });

  describe("getServiceKeyHealth()", () => {
    it("should return key health status for a service", async () => {
      const keyHealth = [
        { index: 0, maskedKey: "sk-****", isHealthy: true },
        { index: 1, maskedKey: "sk-****", isHealthy: false, lastError: "429" },
      ];
      mockAIAdminService.getServiceKeyHealth.mockResolvedValue(keyHealth);

      const result = await controller.getServiceKeyHealth("tavily");

      expect(mockAIAdminService.getServiceKeyHealth).toHaveBeenCalledWith(
        "tavily",
      );
      expect(result).toEqual(keyHealth);
    });
  });

  describe("getToolKeyHealth() [deprecated]", () => {
    it("should delegate to getServiceKeyHealth", async () => {
      mockAIAdminService.getServiceKeyHealth.mockResolvedValue([]);

      await controller.getToolKeyHealth("serper");

      expect(mockAIAdminService.getServiceKeyHealth).toHaveBeenCalledWith(
        "serper",
      );
    });
  });

  describe("getAvailableToolsForAgent()", () => {
    it("should return only healthy enabled tools", async () => {
      const tools = [
        { toolId: "web-search", name: "Web Search", category: "search" },
      ];
      mockAIAdminService.getAvailableToolsForAgent.mockResolvedValue(tools);

      const result = await controller.getAvailableToolsForAgent();

      expect(mockAIAdminService.getAvailableToolsForAgent).toHaveBeenCalled();
      expect(result).toEqual(tools);
    });
  });

  // ====================== Skills ======================

  describe("getSkills()", () => {
    it("should return all skill configurations", async () => {
      const skills = [{ skillId: "deep-research", enabled: true }];
      mockAIAdminService.getSkillConfigs.mockResolvedValue(skills);

      const result = await controller.getSkills();

      expect(mockAIAdminService.getSkillConfigs).toHaveBeenCalled();
      expect(result).toEqual(skills);
    });
  });

  describe("updateSkill()", () => {
    it("should update a skill configuration", async () => {
      const body = { enabled: false, displayName: "Custom Skill" };
      mockAIAdminService.updateSkillConfig.mockResolvedValue({
        skillId: "deep-research",
        ...body,
      });

      const result = await controller.updateSkill("deep-research", body);

      expect(mockAIAdminService.updateSkillConfig).toHaveBeenCalledWith(
        "deep-research",
        body,
      );
      expect(result).toMatchObject({ skillId: "deep-research" });
    });
  });

  describe("uploadSkill()", () => {
    it("should throw BadRequestException when no file is provided", async () => {
      await expect(controller.uploadSkill(undefined as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should parse JSON file and create skill", async () => {
      const skillData = {
        name: "my-skill",
        displayName: "My Skill",
        description: "A test skill",
      };
      const file = {
        originalname: "skill.json",
        buffer: Buffer.from(JSON.stringify(skillData)),
        mimetype: "application/json",
      } as Express.Multer.File;

      mockAIAdminService.uploadSkill.mockResolvedValue({
        skillId: "my-skill",
        displayName: "My Skill",
      });

      const result = await controller.uploadSkill(file);

      expect(mockAIAdminService.uploadSkill).toHaveBeenCalledWith(skillData);
      expect(result).toMatchObject({
        message: expect.stringContaining("My Skill"),
        skill: expect.objectContaining({ skillId: "my-skill" }),
      });
    });

    it("should throw BadRequestException for invalid JSON content", async () => {
      const file = {
        originalname: "skill.json",
        buffer: Buffer.from("{ invalid json }"),
        mimetype: "application/json",
      } as Express.Multer.File;

      await expect(controller.uploadSkill(file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when skill file lacks name or skillId", async () => {
      const skillData = { description: "Missing name" };
      const file = {
        originalname: "skill.json",
        buffer: Buffer.from(JSON.stringify(skillData)),
        mimetype: "application/json",
      } as Express.Multer.File;

      await expect(controller.uploadSkill(file)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should accept skill with skillId field instead of name", async () => {
      const skillData = { skillId: "my-skill", description: "A skill" };
      const file = {
        originalname: "skill.json",
        buffer: Buffer.from(JSON.stringify(skillData)),
        mimetype: "application/json",
      } as Express.Multer.File;

      mockAIAdminService.uploadSkill.mockResolvedValue({
        skillId: "my-skill",
        displayName: null,
      });

      const result = await controller.uploadSkill(file);

      expect(result).toMatchObject({
        message: expect.stringContaining("my-skill"),
        skill: expect.objectContaining({ skillId: "my-skill" }),
      });
      expect(mockAIAdminService.uploadSkill).toHaveBeenCalled();
    });
  });

  // ====================== Aggregated Config ======================

  describe("getAllConfigs()", () => {
    it("should return combined tools, skills, and MCP server configs", async () => {
      const allConfigs = {
        tools: [],
        skills: [],
        mcpServers: [],
      };
      mockAIAdminService.getAllConfigs.mockResolvedValue(allConfigs);

      const result = await controller.getAllConfigs();

      expect(mockAIAdminService.getAllConfigs).toHaveBeenCalled();
      expect(result).toEqual(allConfigs);
    });
  });

  // ====================== Usage Statistics ======================

  describe("getUsageStatistics()", () => {
    it("should aggregate usage counts for tools, skills, and mcp", async () => {
      const toolUsage = { "web-search": 100 };
      const skillUsage = { "deep-research": 50 };
      const mcpUsage = { filesystem: 20 };

      mockAIAdminService.getUsageCountsByType
        .mockResolvedValueOnce(toolUsage)
        .mockResolvedValueOnce(skillUsage)
        .mockResolvedValueOnce(mcpUsage);

      const result = await controller.getUsageStatistics();

      expect(mockAIAdminService.getUsageCountsByType).toHaveBeenCalledWith(
        "tool",
      );
      expect(mockAIAdminService.getUsageCountsByType).toHaveBeenCalledWith(
        "skill",
      );
      expect(mockAIAdminService.getUsageCountsByType).toHaveBeenCalledWith(
        "mcp",
      );
      expect(result).toEqual({
        tools: toolUsage,
        skills: skillUsage,
        mcp: mcpUsage,
      });
    });
  });

  // ====================== MCP Servers ======================

  describe("getMCPServers()", () => {
    it("should return all MCP server configurations", async () => {
      const servers = [{ serverId: "fs-server", name: "Filesystem" }];
      mockAIAdminService.getMCPServerConfigs.mockResolvedValue(servers);

      const result = await controller.getMCPServers();

      expect(mockAIAdminService.getMCPServerConfigs).toHaveBeenCalled();
      expect(result).toEqual(servers);
    });
  });

  describe("addMCPServer()", () => {
    it("should add a new MCP server", async () => {
      const body = {
        serverId: "new-server",
        name: "New MCP Server",
        transport: "sse" as const,
        url: "https://mcp.example.com",
      };
      mockAIAdminService.addMCPServer.mockResolvedValue({
        id: "db-id-1",
        ...body,
      });

      const result = await controller.addMCPServer(body);

      expect(mockAIAdminService.addMCPServer).toHaveBeenCalledWith(body);
      expect(result).toMatchObject({ serverId: "new-server" });
    });
  });

  describe("updateMCPServer()", () => {
    it("should update an existing MCP server", async () => {
      const body = { name: "Updated Server", enabled: false };
      mockAIAdminService.updateMCPServer.mockResolvedValue({
        serverId: "fs-server",
        ...body,
      });

      const result = await controller.updateMCPServer("fs-server", body);

      expect(mockAIAdminService.updateMCPServer).toHaveBeenCalledWith(
        "fs-server",
        body,
      );
      expect(result).toMatchObject({ enabled: false });
    });
  });

  describe("configureMCPServerEnv()", () => {
    it("should configure environment variables for a server", async () => {
      const env = { API_KEY: "secret", REGION: "us-east-1" };
      mockAIAdminService.updateMCPServerEnv.mockResolvedValue({
        serverId: "fs-server",
        env,
      });

      const result = await controller.configureMCPServerEnv("fs-server", {
        env,
      });

      expect(mockAIAdminService.updateMCPServerEnv).toHaveBeenCalledWith(
        "fs-server",
        env,
      );
      expect(result).toMatchObject({ env });
    });
  });

  describe("connectMCPServer()", () => {
    it("should connect to the specified MCP server", async () => {
      mockAIAdminService.connectMCPServer.mockResolvedValue({
        status: "connected",
      });

      const result = await controller.connectMCPServer("fs-server");

      expect(mockAIAdminService.connectMCPServer).toHaveBeenCalledWith(
        "fs-server",
      );
      expect(result).toEqual({ status: "connected" });
    });
  });

  describe("disconnectMCPServer()", () => {
    it("should disconnect from the specified MCP server", async () => {
      mockAIAdminService.disconnectMCPServer.mockResolvedValue({
        status: "disconnected",
      });

      const result = await controller.disconnectMCPServer("fs-server");

      expect(mockAIAdminService.disconnectMCPServer).toHaveBeenCalledWith(
        "fs-server",
      );
      expect(result).toEqual({ status: "disconnected" });
    });
  });

  describe("deleteMCPServer()", () => {
    it("should delete the specified MCP server", async () => {
      mockAIAdminService.deleteMCPServer.mockResolvedValue({ deleted: true });

      const result = await controller.deleteMCPServer("fs-server");

      expect(mockAIAdminService.deleteMCPServer).toHaveBeenCalledWith(
        "fs-server",
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  describe("diagnoseMCPServers()", () => {
    it("should return MCP server diagnostics", async () => {
      const diagnosis = {
        servers: [{ serverId: "fs-server", status: "connected" }],
        summary: { total: 1, connected: 1 },
      };
      mockAIAdminService.diagnoseMCPServers.mockResolvedValue(diagnosis);

      const result = await controller.diagnoseMCPServers();

      expect(mockAIAdminService.diagnoseMCPServers).toHaveBeenCalled();
      expect(result).toEqual(diagnosis);
    });
  });

  describe("diagnoseAllCapabilities()", () => {
    it("should return full AI capability system diagnosis", async () => {
      const fullDiagnosis = {
        breakpoints: [],
        builtinTools: { summary: { total: 10, healthy: 10 } },
        skills: { summary: { total: 5 } },
        mcpServers: { summary: { total: 2 } },
        externalTools: { summary: { total: 3, healthy: 2 } },
      };
      mockAIAdminService.diagnoseAllCapabilities.mockResolvedValue(
        fullDiagnosis,
      );

      const result = await controller.diagnoseAllCapabilities();

      expect(mockAIAdminService.diagnoseAllCapabilities).toHaveBeenCalled();
      expect(result).toEqual(fullDiagnosis);
    });
  });
});
