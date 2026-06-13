import { Test, TestingModule } from "@nestjs/testing";
import { AgentController } from "../agent/agent.controller";
import { AgentConfigService } from "../../../ai-harness/facade";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  CreateAgentConfigDto,
  UpdateAgentConfigDto,
} from "../dto/agent-config-admin.dto";

// Mock the entire ai-engine facade to avoid pulling in heavy dependencies
jest.mock("../../../ai-engine/facade", () => ({
  AgentConfigService: jest.fn(),
}));
jest.mock("../../../ai-harness/facade", () => ({
  AgentConfigService: jest.fn(),
}));

describe("AgentController", () => {
  let controller: AgentController;
  let agentConfigService: jest.Mocked<AgentConfigService>;

  const mockAgentConfig = {
    id: "agent-1",
    agentId: "research-lead",
    name: "Research Lead",
    description: "Leads research tasks",
    agentType: "plan-based",
    domain: "research",
    systemPrompt: "You are a research lead...",
    tools: ["web_search"],
    skills: [],
    modelType: "CHAT",
    taskProfile: { creativity: "medium" },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAgentConfigService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        { provide: AgentConfigService, useValue: mockAgentConfigService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AgentController);
    agentConfigService = module.get(AgentConfigService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("should return all agent configs with no filters", async () => {
      mockAgentConfigService.findAll.mockResolvedValue([mockAgentConfig]);

      const result = await controller.findAll();

      expect(agentConfigService.findAll).toHaveBeenCalledWith({
        domain: undefined,
        enabled: undefined,
      });
      expect(result).toEqual([mockAgentConfig]);
    });

    it("should pass domain filter to service when provided", async () => {
      mockAgentConfigService.findAll.mockResolvedValue([mockAgentConfig]);

      await controller.findAll("research");

      expect(agentConfigService.findAll).toHaveBeenCalledWith({
        domain: "research",
        enabled: undefined,
      });
    });

    it('should convert enabled="true" to boolean true', async () => {
      mockAgentConfigService.findAll.mockResolvedValue([]);

      await controller.findAll(undefined, "true");

      expect(agentConfigService.findAll).toHaveBeenCalledWith({
        domain: undefined,
        enabled: true,
      });
    });

    it('should convert enabled="false" to boolean false', async () => {
      mockAgentConfigService.findAll.mockResolvedValue([]);

      await controller.findAll(undefined, "false");

      expect(agentConfigService.findAll).toHaveBeenCalledWith({
        domain: undefined,
        enabled: false,
      });
    });

    it("should set enabled=undefined when enabled param is not provided", async () => {
      mockAgentConfigService.findAll.mockResolvedValue([]);

      await controller.findAll("research", undefined);

      expect(agentConfigService.findAll).toHaveBeenCalledWith({
        domain: "research",
        enabled: undefined,
      });
    });

    it("should propagate errors from service", async () => {
      mockAgentConfigService.findAll.mockRejectedValue(new Error("DB error"));

      await expect(controller.findAll()).rejects.toThrow("DB error");
    });
  });

  describe("findOne", () => {
    it("should return agent config by id", async () => {
      mockAgentConfigService.findOne.mockResolvedValue(mockAgentConfig);

      const result = await controller.findOne("agent-1");

      expect(agentConfigService.findOne).toHaveBeenCalledWith("agent-1");
      expect(result).toEqual(mockAgentConfig);
    });

    it("should propagate NotFoundException from service", async () => {
      const error = new Error("Not found");
      mockAgentConfigService.findOne.mockRejectedValue(error);

      await expect(controller.findOne("nonexistent")).rejects.toThrow(
        "Not found",
      );
    });
  });

  describe("create", () => {
    it("should create an agent config and return it", async () => {
      const dto: CreateAgentConfigDto = {
        agentId: "new-agent",
        name: "New Agent",
        agentType: "plan-based",
        domain: "research",
        systemPrompt: "You are...",
      };
      mockAgentConfigService.create.mockResolvedValue({
        ...mockAgentConfig,
        agentId: "new-agent",
      });

      const result = await controller.create(dto);

      expect(agentConfigService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "new-agent",
          name: "New Agent",
        }),
      );
      expect(result.agentId).toBe("new-agent");
    });

    it("should pass taskProfile to service", async () => {
      const dto: CreateAgentConfigDto = {
        agentId: "agent-with-profile",
        name: "Profiled Agent",
        agentType: "plan-based",
        domain: "research",
        systemPrompt: "You are...",
        taskProfile: { creativity: "high" },
      };
      mockAgentConfigService.create.mockResolvedValue(mockAgentConfig);

      await controller.create(dto);

      const call = mockAgentConfigService.create.mock.calls[0][0];
      expect(call.taskProfile).toEqual({ creativity: "high" });
    });

    it("should propagate errors from service", async () => {
      const dto: CreateAgentConfigDto = {
        agentId: "fail-agent",
        name: "Fail",
        agentType: "plan-based",
        domain: "test",
        systemPrompt: "You are...",
      };
      mockAgentConfigService.create.mockRejectedValue(
        new Error("Create failed"),
      );

      await expect(controller.create(dto)).rejects.toThrow("Create failed");
    });
  });

  describe("update", () => {
    it("should update agent config and return updated record", async () => {
      const dto: UpdateAgentConfigDto = { name: "Updated Agent" };
      const updated = { ...mockAgentConfig, name: "Updated Agent" };
      mockAgentConfigService.update.mockResolvedValue(updated);

      const result = await controller.update("agent-1", dto);

      expect(agentConfigService.update).toHaveBeenCalledWith(
        "agent-1",
        expect.objectContaining({ name: "Updated Agent" }),
      );
      expect(result.name).toBe("Updated Agent");
    });

    it("should pass updated taskProfile to service", async () => {
      const dto: UpdateAgentConfigDto = { taskProfile: { creativity: "low" } };
      mockAgentConfigService.update.mockResolvedValue(mockAgentConfig);

      await controller.update("agent-1", dto);

      const call = mockAgentConfigService.update.mock.calls[0][0];
      expect(call).toBe("agent-1");
      const updateArg = mockAgentConfigService.update.mock.calls[0][1];
      expect(updateArg.taskProfile).toEqual({ creativity: "low" });
    });

    it("should propagate errors from service", async () => {
      mockAgentConfigService.update.mockRejectedValue(
        new Error("Update failed"),
      );

      await expect(controller.update("agent-1", {})).rejects.toThrow(
        "Update failed",
      );
    });
  });

  describe("delete", () => {
    it("should delete agent config and return result", async () => {
      mockAgentConfigService.delete.mockResolvedValue({ success: true });

      const result = await controller.delete("agent-1");

      expect(agentConfigService.delete).toHaveBeenCalledWith("agent-1");
      expect(result).toEqual({ success: true });
    });

    it("should propagate errors from service", async () => {
      mockAgentConfigService.delete.mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(controller.delete("agent-1")).rejects.toThrow(
        "Delete failed",
      );
    });
  });
});
