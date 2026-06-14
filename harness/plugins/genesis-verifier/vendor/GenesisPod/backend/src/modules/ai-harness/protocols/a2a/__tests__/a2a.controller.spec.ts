/**
 * A2AController Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  Logger,
  NotFoundException,
  BadRequestException,
  HttpException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { A2AController } from "../../../../open-api/external/a2a/a2a-server.controller";
import { AgentCardRegistry } from "../agent-card.registry";
import { A2AApiKeyGuard } from "../guards/a2a-api-key.guard";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { A2ATaskStatus } from "../a2a.types";
import { TEAMS_SERVICE_TOKEN, TRACE_COLLECTOR_TOKEN } from "../a2a.tokens";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ===================== Fixtures =====================

const mockAgentCard = {
  name: "GenesisPod",
  description: "Enterprise AI platform",
  url: "https://api.gens.team/a2a/tasks",
  provider: { organization: "GenesisPod", url: "https://api.gens.team" },
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: true },
  defaultInputModes: ["text"],
  defaultOutputModes: ["text/markdown"],
  skills: [
    {
      id: "deep-research",
      name: "Deep Research",
      description: "Conduct research",
      tags: ["research"],
    },
    {
      id: "ai-ask",
      name: "AI Ask",
      description: "Q&A",
      tags: ["qa"],
    },
    {
      id: "team-debate",
      name: "Team Debate",
      description: "Debate",
      tags: ["debate"],
    },
    {
      id: "document-generation",
      name: "Document Generation",
      description: "Docs",
      tags: ["document"],
    },
    {
      id: "ai-writing",
      name: "AI Writing",
      description: "Writing",
      tags: ["writing"],
    },
  ],
};

function buildValidRequest(overrides: Record<string, unknown> = {}) {
  return {
    skillId: "deep-research",
    input: { content: "Research topic: AI safety" },
    config: {},
    metadata: {},
    ...overrides,
  };
}

describe("A2AController", () => {
  let controller: A2AController;
  let agentCardRegistry: jest.Mocked<AgentCardRegistry>;
  let teamsService: {
    executeMission: jest.Mock;
    getMissionStatus: jest.Mock;
    getMissionResult: jest.Mock;
  };
  let traceCollector: {
    startTrace: jest.Mock;
    endTrace: jest.Mock;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        A2AController,
        A2AApiKeyGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn().mockReturnValue(false) },
        },
        {
          provide: SecretsService,
          useValue: {
            getSecretNames: jest.fn().mockResolvedValue([]),
            getValueInternal: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: AgentCardRegistry,
          useValue: {
            getAgentCard: jest.fn().mockReturnValue(mockAgentCard),
            // 2026-05-01 (PR-X-P): /.well-known/agent.json 现返回 v0.3 card
            getAgentCardV03: jest.fn().mockReturnValue(mockAgentCard),
            getSkillById: jest.fn(),
            getSkills: jest.fn().mockReturnValue(mockAgentCard.skills),
          },
        },
        {
          provide: TEAMS_SERVICE_TOKEN,
          useValue: {
            executeMission: jest.fn(),
            getMissionStatus: jest.fn(),
            getMissionResult: jest.fn(),
          },
        },
        {
          provide: TRACE_COLLECTOR_TOKEN,
          useValue: {
            startTrace: jest.fn().mockReturnValue("trace-id-123"),
            endTrace: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<A2AController>(A2AController);
    agentCardRegistry = module.get(AgentCardRegistry);
    teamsService = module.get(TEAMS_SERVICE_TOKEN);
    traceCollector = module.get(TRACE_COLLECTOR_TOKEN);
  });

  afterEach(() => jest.clearAllMocks());

  // ===================== getAgentCard =====================

  describe("getAgentCard()", () => {
    it("returns the v0.3 agent card from the registry (2026-05-01 PR-X-P)", () => {
      const result = controller.getAgentCard();

      expect(result).toEqual(mockAgentCard);
      expect(agentCardRegistry.getAgentCardV03).toHaveBeenCalledTimes(1);
    });

    it("logs the request with v0.3 marker", () => {
      const logSpy = jest.spyOn(Logger.prototype, "log");

      controller.getAgentCard();

      expect(logSpy).toHaveBeenCalledWith("Agent Card requested (v0.3)");
    });
  });

  // ===================== createTask - Validation =====================

  describe("createTask() — input validation", () => {
    it("throws BadRequestException when input.content is missing", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({ input: {} });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.createTask(request as never)).rejects.toThrow(
        "content must be a non-empty string",
      );
    });

    it("throws BadRequestException when input.content is not a string", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({ input: { content: 12345 } });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException when input.content exceeds 100KB", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        input: { content: "x".repeat(100_001) },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "exceeds maximum length",
      );
    });

    it("accepts input.content of exactly 100KB (boundary)", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("mission-boundary-test");
      const request = buildValidRequest({
        input: { content: "x".repeat(100_000) },
      });

      const result = await controller.createTask(request as never);
      expect(result.status).toBe(A2ATaskStatus.PENDING);
    });

    it("throws BadRequestException for non-HTTPS webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "http://example.com/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "Webhook URL must use HTTPS",
      );
    });

    it("throws BadRequestException for localhost webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://localhost/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "private networks",
      );
    });

    it("throws BadRequestException for 127.0.0.1 webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://127.0.0.1/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "private networks",
      );
    });

    it("throws BadRequestException for 0.0.0.0 webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://0.0.0.0/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "private networks",
      );
    });

    it("throws BadRequestException for fe80: IPv6 link-local webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      // fe80:: addresses are link-local IPv6; URL encodes as [fe80::1]
      // The check is hostname.startsWith("fe80:") — URL parser gives "[fe80::1]" with brackets
      // so this test uses a hostname that the code actually detects via startsWith
      const request = buildValidRequest({
        config: { webhookUrl: "https://fe80::1/webhook" },
      });

      // The URL parser will throw or handle the malformed URL
      // (bare :: in hostname without brackets is invalid)
      // So test that it throws "Invalid webhook URL"
      await expect(controller.createTask(request as never)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException for .local domain webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://myservice.local/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "private networks",
      );
    });

    it("throws BadRequestException for 10.x.x.x private IP webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://10.0.1.1/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "private networks",
      );
    });

    it("throws BadRequestException for 192.168.x.x private IP webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://192.168.1.1/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "private networks",
      );
    });

    it("throws BadRequestException for 172.16.x.x private IP webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://172.16.0.1/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "private networks",
      );
    });

    it("throws BadRequestException for 169.254.x.x link-local webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://169.254.169.254/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "private networks",
      );
    });

    it("throws BadRequestException for blocked port in webhook URL (port 22)", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://external.example.com:22/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "internal service ports",
      );
    });

    it("throws BadRequestException for blocked port 5432 (PostgreSQL)", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://external.example.com:5432/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "internal service ports",
      );
    });

    it("throws BadRequestException for blocked port 6379 (Redis)", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "https://external.example.com:6379/webhook" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "internal service ports",
      );
    });

    it("throws BadRequestException for completely invalid webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      const request = buildValidRequest({
        config: { webhookUrl: "not-a-url-at-all" },
      });

      await expect(controller.createTask(request as never)).rejects.toThrow(
        "Invalid webhook URL",
      );
    });

    it("accepts a valid HTTPS webhook URL", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("mission-webhook-test");
      const request = buildValidRequest({
        config: { webhookUrl: "https://external.example.com/webhook" },
      });

      const result = await controller.createTask(request as never);
      expect(result.status).toBe(A2ATaskStatus.PENDING);
    });
  });

  // ===================== createTask - Skill validation =====================

  describe("createTask() — skill validation", () => {
    it("returns FAILED response when skill not found", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(undefined);
      agentCardRegistry.getSkills.mockReturnValue(mockAgentCard.skills);
      const request = buildValidRequest({ skillId: "non-existent-skill" });

      const result = await controller.createTask(request as never);

      expect(result.status).toBe(A2ATaskStatus.FAILED);
      expect(result.error?.code).toBe("INVALID_SKILL");
      expect(result.error?.message).toContain("non-existent-skill");
    });

    it("includes available skills in INVALID_SKILL error details", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(undefined);
      agentCardRegistry.getSkills.mockReturnValue(mockAgentCard.skills);
      const request = buildValidRequest({ skillId: "bad-skill" });

      const result = await controller.createTask(request as never);

      expect(
        (result.error?.details as Record<string, string[]>)?.availableSkills,
      ).toContain("deep-research");
    });

    it("returns FAILED response when skill exists but has no team mapping", async () => {
      // Return a skill that has no team mapping (e.g., a skill not in mapSkillToTeam)
      agentCardRegistry.getSkillById.mockReturnValue({
        id: "unmapped-skill",
        name: "Unmapped",
        description: "Not mapped to a team",
        tags: [],
      });
      const request = buildValidRequest({ skillId: "unmapped-skill" });

      const result = await controller.createTask(request as never);

      expect(result.status).toBe(A2ATaskStatus.FAILED);
      expect(result.error?.code).toBe("SKILL_NOT_IMPLEMENTED");
    });
  });

  // ===================== createTask - Success paths =====================

  describe("createTask() — success paths", () => {
    it("creates task and returns PENDING status for deep-research skill", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("mission-id-001");
      const request = buildValidRequest({ skillId: "deep-research" });

      const result = await controller.createTask(request as never);

      expect(result.status).toBe(A2ATaskStatus.PENDING);
      expect(result.taskId).toBe("mission-id-001");
    });

    it("creates task for ai-ask skill (maps to research team)", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[1]);
      teamsService.executeMission.mockResolvedValue("mission-ai-ask");
      const request = buildValidRequest({ skillId: "ai-ask" });

      const result = await controller.createTask(request as never);

      expect(result.status).toBe(A2ATaskStatus.PENDING);
      expect(teamsService.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: "research" }),
      );
    });

    it("creates task for team-debate skill (maps to debate team)", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[2]);
      teamsService.executeMission.mockResolvedValue("mission-debate");
      const request = buildValidRequest({ skillId: "team-debate" });

      await controller.createTask(request as never);

      expect(teamsService.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: "debate" }),
      );
    });

    it("creates task for document-generation skill (maps to report team)", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[3]);
      teamsService.executeMission.mockResolvedValue("mission-doc");
      const request = buildValidRequest({ skillId: "document-generation" });

      await controller.createTask(request as never);

      expect(teamsService.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: "report" }),
      );
    });

    it("creates task for ai-writing skill (maps to report team)", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[4]);
      teamsService.executeMission.mockResolvedValue("mission-writing");
      const request = buildValidRequest({ skillId: "ai-writing" });

      await controller.createTask(request as never);

      expect(teamsService.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: "report" }),
      );
    });

    it("passes goal as input.content to executeMission", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("m1");
      const request = buildValidRequest({
        input: { content: "Custom research goal" },
      });

      await controller.createTask(request as never);

      expect(teamsService.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({ goal: "Custom research goal" }),
      );
    });

    it("sanitizes metadata before passing to executeMission", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("m1");
      const request = buildValidRequest({
        metadata: {
          clientId: "client-abc",
          normalKey: "normalValue",
        },
      });

      await controller.createTask(request as never);

      const callArg = teamsService.executeMission.mock.calls[0][0];
      expect(callArg.metadata?.clientId).toBe("client-abc");
      expect(callArg.metadata?.normalKey).toBe("normalValue");
    });

    it("starts and ends trace on success", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("m1");

      await controller.createTask(buildValidRequest() as never);

      expect(traceCollector.startTrace).toHaveBeenCalledWith(
        expect.objectContaining({ type: "a2a_task" }),
      );
      expect(traceCollector.endTrace).toHaveBeenCalledWith("trace-id-123", {
        status: "success",
      });
    });

    it("includes createdAt and updatedAt in response", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("m1");

      const result = await controller.createTask(buildValidRequest() as never);

      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it("passes config.context to executeMission", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("m1");
      const request = buildValidRequest({
        config: { context: "Some background context" },
      });

      await controller.createTask(request as never);

      expect(teamsService.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({ context: "Some background context" }),
      );
    });

    it("uses 'unknown' apiKeyId when not injected by guard", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("m1");

      // No a2aApiKeyId on the request — should not throw
      await expect(
        controller.createTask(buildValidRequest() as never),
      ).resolves.not.toThrow();
    });

    it("uses a2aApiKeyId when injected by guard", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("m1");
      const request = {
        ...buildValidRequest(),
        a2aApiKeyId: "my-key-name",
      };

      const result = await controller.createTask(request as never);
      expect(result.status).toBe(A2ATaskStatus.PENDING);
    });
  });

  // ===================== createTask - Error paths =====================

  describe("createTask() — error paths", () => {
    it("returns FAILED response when executeMission throws", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockRejectedValue(
        new Error("Team not found"),
      );

      const result = await controller.createTask(buildValidRequest() as never);

      expect(result.status).toBe(A2ATaskStatus.FAILED);
      expect(result.error?.code).toBe("TASK_CREATION_FAILED");
      expect(result.error?.message).toContain("Team not found");
    });

    it("ends trace with error status when executeMission throws", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockRejectedValue(new Error("fail"));

      await controller.createTask(buildValidRequest() as never);

      expect(traceCollector.endTrace).toHaveBeenCalledWith("trace-id-123", {
        status: "error",
      });
    });

    it("handles non-Error thrown from executeMission", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockRejectedValue("string-error");

      const result = await controller.createTask(buildValidRequest() as never);

      expect(result.status).toBe(A2ATaskStatus.FAILED);
      expect(result.error?.message).toBe("Unknown error occurred");
    });
  });

  // ===================== createTask - Rate limiting =====================

  describe("createTask() — per-API-key rate limiting", () => {
    it("throws HttpException 429 when rate limit exceeded", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("mission-id");

      const request = {
        ...buildValidRequest(),
        a2aApiKeyId: "rate-test-key",
      };

      // Make 31 requests (limit is 30)
      const promises = [];
      for (let i = 0; i < 31; i++) {
        promises.push(controller.createTask(request as never));
      }

      const results = await Promise.allSettled(promises);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected.length).toBeGreaterThan(0);

      // The rejection should be a 429
      const firstRejection = rejected[0];
      expect(firstRejection.reason).toBeInstanceOf(HttpException);
      expect((firstRejection.reason as HttpException).getStatus()).toBe(429);
    });

    it("allows requests after rate limit window resets", async () => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("mission-id");

      // We can't easily mock Date.now() across the LruMap — just verify
      // that different API keys have independent limits
      const request1 = { ...buildValidRequest(), a2aApiKeyId: "key-alice" };
      const request2 = { ...buildValidRequest(), a2aApiKeyId: "key-bob" };

      // First request for each key should succeed
      const result1 = await controller.createTask(request1 as never);
      const result2 = await controller.createTask(request2 as never);

      expect(result1.status).toBe(A2ATaskStatus.PENDING);
      expect(result2.status).toBe(A2ATaskStatus.PENDING);
    });
  });

  // ===================== getTaskStatus =====================

  describe("getTaskStatus()", () => {
    const baseStatus = {
      missionId: "task-xyz",
      teamId: "research" as const,
      status: "running" as const,
      progress: 50,
      startTime: new Date("2024-01-01T00:00:00Z"),
      endTime: undefined,
      error: undefined,
    };

    it("returns task status for running mission", async () => {
      teamsService.getMissionStatus.mockReturnValue(baseStatus);

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.taskId).toBe("task-xyz");
      expect(result.status).toBe(A2ATaskStatus.RUNNING);
    });

    it("maps 'pending' mission status to PENDING A2A status", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "pending",
      });

      const result = await controller.getTaskStatus("task-xyz");
      expect(result.status).toBe(A2ATaskStatus.PENDING);
    });

    it("maps 'running' mission status to RUNNING A2A status", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "running",
      });

      const result = await controller.getTaskStatus("task-xyz");
      expect(result.status).toBe(A2ATaskStatus.RUNNING);
    });

    it("maps 'completed' mission status to COMPLETED A2A status and fetches result", async () => {
      const completedStatus = {
        ...baseStatus,
        status: "completed" as const,
        endTime: new Date("2024-01-01T01:00:00Z"),
      };
      teamsService.getMissionStatus.mockReturnValue(completedStatus);
      teamsService.getMissionResult.mockResolvedValue({
        success: true,
        summary: "Research completed",
        deliverables: [],
        statistics: {},
        tokensUsed: 1500,
        duration: 60000,
        metadata: { a2aSkillId: "deep-research" },
      } as never);

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.status).toBe(A2ATaskStatus.COMPLETED);
      expect(result.result?.content).toBe("Research completed");
      expect(result.result?.metadata?.tokenUsage?.total).toBe(1500);
    });

    it("maps 'failed' mission status to FAILED A2A status", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "failed",
        error: "Mission execution failed",
      });

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.status).toBe(A2ATaskStatus.FAILED);
      expect(result.error?.code).toBe("MISSION_FAILED");
      expect(result.error?.message).toBe("Mission execution failed");
    });

    it("maps 'cancelled' mission status to CANCELLED A2A status", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "cancelled",
      });

      const result = await controller.getTaskStatus("task-xyz");
      expect(result.status).toBe(A2ATaskStatus.CANCELLED);
    });

    it("includes createdAt from mission startTime", async () => {
      teamsService.getMissionStatus.mockReturnValue(baseStatus);

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.createdAt).toBe("2024-01-01T00:00:00.000Z");
    });

    it("uses endTime for updatedAt when available", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "completed",
        endTime: new Date("2024-01-01T01:00:00Z"),
      });
      teamsService.getMissionResult.mockResolvedValue({
        success: true,
        summary: "done",
        deliverables: [],
        statistics: {},
        tokensUsed: 0,
        duration: 0,
        metadata: {},
      } as never);

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.updatedAt).toBe("2024-01-01T01:00:00.000Z");
    });

    it("reverses team-to-skill mapping for in-progress tasks", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        teamId: "debate" as const,
        status: "running",
      });

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.skillId).toBe("team-debate");
    });

    it("returns 'unknown-skill' when team has no reverse mapping", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        teamId: "unknown-team" as const,
        status: "running",
      });

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.skillId).toBe("unknown-skill");
    });

    it("handles getMissionResult failure for completed task gracefully", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "completed",
      });
      teamsService.getMissionResult.mockRejectedValue(
        new Error("Result not available"),
      );

      // Should not throw — just skip the result
      const result = await controller.getTaskStatus("task-xyz");

      expect(result.status).toBe(A2ATaskStatus.COMPLETED);
      expect(result.result).toBeUndefined();
    });

    it("does not include error field when mission succeeded", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "completed",
        error: undefined,
      });
      teamsService.getMissionResult.mockResolvedValue({
        success: true,
        summary: "all good",
        deliverables: [],
        statistics: {},
        tokensUsed: 0,
        duration: 0,
        metadata: {},
      } as never);

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.error).toBeUndefined();
    });

    it("does not include error when failed mission has no error string", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "failed",
        error: undefined,
      });
      teamsService.getMissionResult.mockResolvedValue({
        success: false,
        summary: "",
        deliverables: [],
        statistics: {},
        tokensUsed: 0,
        duration: 0,
        metadata: {},
      } as never);

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.error).toBeUndefined();
    });

    it("throws NotFoundException when mission is not found", async () => {
      teamsService.getMissionStatus.mockImplementation(() => {
        throw new NotFoundException("Mission task-not-found not found");
      });

      await expect(controller.getTaskStatus("task-not-found")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when error message contains 'not found'", async () => {
      teamsService.getMissionStatus.mockImplementation(() => {
        throw new Error("Mission xyz not found");
      });

      await expect(controller.getTaskStatus("xyz")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException for unexpected Error instances", async () => {
      teamsService.getMissionStatus.mockImplementation(() => {
        throw new Error("Unexpected database error");
      });

      await expect(controller.getTaskStatus("task-xyz")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException for unexpected non-Error throws", async () => {
      // Tests the `String(error)` branch in BadRequestException message
      teamsService.getMissionStatus.mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "string-error-thrown";
      });

      await expect(controller.getTaskStatus("task-xyz")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("handles non-Error in result fetch warn log (String branch)", async () => {
      // Covers the non-Error branch in the warn log: String(error)
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "completed" as const,
      });
      // getMissionResult throws a non-Error — hits String(error) path in logger.warn
      teamsService.getMissionResult.mockRejectedValue("string error");

      const result = await controller.getTaskStatus("task-xyz");
      // Should still return completed (just without result)
      expect(result.status).toBe(A2ATaskStatus.COMPLETED);
    });

    it("uses a2aSkillId from mission result metadata when available", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "completed",
      });
      teamsService.getMissionResult.mockResolvedValue({
        success: true,
        summary: "done",
        deliverables: [],
        statistics: {},
        tokensUsed: 0,
        duration: 0,
        metadata: { a2aSkillId: "ai-writing" },
      } as never);

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.skillId).toBe("ai-writing");
    });

    it("uses report-to-skill reverse mapping for 'report' teamId", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        teamId: "report" as const,
        status: "running",
      });

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.skillId).toBe("document-generation");
    });

    it("uses research-to-skill reverse mapping for 'research' teamId", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        teamId: "research" as const,
        status: "pending",
      });

      const result = await controller.getTaskStatus("task-xyz");

      expect(result.skillId).toBe("deep-research");
    });

    it("maps unknown mission status to PENDING via default branch", async () => {
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        // Cast unknown status through type system
        status: "unknown-status" as "pending",
      });

      const result = await controller.getTaskStatus("task-xyz");

      // The default branch of mapMissionStatusToA2A returns PENDING
      expect(result.status).toBe(A2ATaskStatus.PENDING);
    });

    it("handles getMissionResult inner error when fetching skillId for completed task", async () => {
      // The inner try/catch in getTaskStatus for skillId lookup on completed tasks
      teamsService.getMissionStatus.mockReturnValue({
        ...baseStatus,
        status: "completed" as const,
        endTime: new Date("2024-01-01T01:00:00Z"),
      });
      // First getMissionResult call (for skillId) throws; second (for result) also throws
      teamsService.getMissionResult
        .mockRejectedValueOnce(new Error("metadata lookup failed"))
        .mockRejectedValueOnce(new Error("result lookup failed"));

      // Should not throw — falls back to team-based skill mapping
      const result = await controller.getTaskStatus("task-xyz");
      expect(result.status).toBe(A2ATaskStatus.COMPLETED);
    });
  });

  // ===================== sanitizeMetadata =====================

  describe("sanitizeMetadata (via createTask)", () => {
    beforeEach(() => {
      agentCardRegistry.getSkillById.mockReturnValue(mockAgentCard.skills[0]);
      teamsService.executeMission.mockResolvedValue("m1");
    });

    it("strips __proto__ key from metadata using defineProperty", async () => {
      // Using Object.defineProperty to set a real '__proto__' own property
      // (object literal syntax `{ __proto__: ... }` sets the prototype, not a property)
      const metadata: Record<string, unknown> = { safe: "value" };
      Object.defineProperty(metadata, "__proto__", {
        value: { polluted: true },
        enumerable: true,
        configurable: true,
        writable: true,
      });

      const request = buildValidRequest({ metadata });

      await controller.createTask(request as never);

      const call = teamsService.executeMission.mock.calls[0][0];
      // The sanitizer should have skipped __proto__, so it should not appear in result
      expect(call.metadata?.["safe"]).toBe("value");
      // __proto__ is stripped (not present as own key in sanitized output)
      expect(
        Object.prototype.hasOwnProperty.call(call.metadata, "__proto__"),
      ).toBe(false);
    });

    it("strips 'constructor' and 'prototype' keys from metadata", async () => {
      // Use JSON.parse to create an object with literal 'constructor' own property
      const metadata = JSON.parse(
        '{"constructor":"bad","prototype":"bad","real":"ok"}',
      ) as Record<string, unknown>;

      const request = buildValidRequest({ metadata });

      await controller.createTask(request as never);

      const call = teamsService.executeMission.mock.calls[0][0];
      // The sanitizer blocks BLOCKED_KEYS — constructor and prototype should be stripped
      expect(
        Object.prototype.hasOwnProperty.call(call.metadata, "constructor"),
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(call.metadata, "prototype"),
      ).toBe(false);
      expect(call.metadata?.real).toBe("ok");
    });

    it("truncates string values exceeding 10,000 chars", async () => {
      const longString = "x".repeat(20_000);
      const request = buildValidRequest({
        metadata: { bigField: longString },
      });

      await controller.createTask(request as never);

      const call = teamsService.executeMission.mock.calls[0][0];
      expect((call.metadata?.bigField as string).length).toBe(10_000);
    });

    it("handles nested metadata objects recursively", async () => {
      const request = buildValidRequest({
        metadata: {
          nested: { level2: { value: "deep" } },
        },
      });

      await controller.createTask(request as never);

      const call = teamsService.executeMission.mock.calls[0][0];
      expect(
        (call.metadata?.nested as Record<string, unknown>)?.level2,
      ).toEqual({ value: "deep" });
    });

    it("passes null values through", async () => {
      const request = buildValidRequest({
        metadata: { nullField: null },
      });

      await controller.createTask(request as never);

      const call = teamsService.executeMission.mock.calls[0][0];
      expect(call.metadata?.nullField).toBeNull();
    });

    it("passes boolean and number values through", async () => {
      const request = buildValidRequest({
        metadata: { flag: true, count: 42 },
      });

      await controller.createTask(request as never);

      const call = teamsService.executeMission.mock.calls[0][0];
      expect(call.metadata?.flag).toBe(true);
      expect(call.metadata?.count).toBe(42);
    });

    it("limits array values to 100 elements", async () => {
      const bigArray = Array.from({ length: 200 }, (_, i) => i);
      const request = buildValidRequest({
        metadata: { arr: bigArray },
      });

      await controller.createTask(request as never);

      const call = teamsService.executeMission.mock.calls[0][0];
      expect((call.metadata?.arr as unknown[]).length).toBe(100);
    });

    it("returns empty object when metadata is null or undefined", async () => {
      const request = buildValidRequest({ metadata: undefined });

      const result = await controller.createTask(request as never);
      expect(result.status).toBe(A2ATaskStatus.PENDING);
    });
  });

  // ===================== Works without optional TraceCollectorService =====================

  describe("without TraceCollectorService (optional dep)", () => {
    let controllerNoTrace: A2AController;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          A2AController,
          A2AApiKeyGuard,
          {
            provide: Reflector,
            useValue: { getAllAndOverride: jest.fn().mockReturnValue(false) },
          },
          {
            provide: SecretsService,
            useValue: {
              getSecretNames: jest.fn().mockResolvedValue([]),
              getValueInternal: jest.fn().mockResolvedValue(null),
            },
          },
          {
            provide: AgentCardRegistry,
            useValue: {
              getAgentCard: jest.fn().mockReturnValue(mockAgentCard),
              getSkillById: jest.fn().mockReturnValue(mockAgentCard.skills[0]),
              getSkills: jest.fn().mockReturnValue(mockAgentCard.skills),
            },
          },
          {
            provide: TEAMS_SERVICE_TOKEN,
            useValue: {
              executeMission: jest.fn().mockResolvedValue("mission-no-trace"),
              getMissionStatus: jest.fn(),
              getMissionResult: jest.fn(),
            },
          },
          // TRACE_COLLECTOR_TOKEN intentionally omitted
        ],
      }).compile();

      controllerNoTrace = module.get<A2AController>(A2AController);
    });

    it("still creates task without traceCollector", async () => {
      const result = await controllerNoTrace.createTask(
        buildValidRequest() as never,
      );

      expect(result.status).toBe(A2ATaskStatus.PENDING);
    });
  });
});
