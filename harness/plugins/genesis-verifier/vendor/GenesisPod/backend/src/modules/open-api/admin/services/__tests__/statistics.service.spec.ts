import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { StatisticsService } from "../statistics.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KernelApiService } from "../../../../ai-harness/facade";
import { MCPServerService } from "../../../../open-api/external/mcp/mcp-server.service";
import { GuardrailsPipelineService } from "../../../../ai-engine/facade";

describe("StatisticsService", () => {
  let service: StatisticsService;
  let mockPrisma: {
    resource: { count: jest.Mock; groupBy: jest.Mock };
    researchMission: { count: jest.Mock };
    officeDocument: { count: jest.Mock };
    topic: { count: jest.Mock };
    debateSession: { count: jest.Mock };
    simulationScenario: { count: jest.Mock };
    simulationRun: { count: jest.Mock };
    writingProject: { count: jest.Mock };
    socialContent: { count: jest.Mock };
    toolConfig: { count: jest.Mock };
    skillConfig: { count: jest.Mock };
    aIModel: { count: jest.Mock };
    user: { count: jest.Mock };
    secret: { count: jest.Mock };
    agentProcess: { count: jest.Mock };
    processEvent: { count: jest.Mock };
    processMemory: { count: jest.Mock };
    creditAccount: { count: jest.Mock };
    creditTransaction: { count: jest.Mock };
    notification: { count: jest.Mock };
    systemSetting: { count: jest.Mock };
    systemErrorLog: { count: jest.Mock };
    loginHistory: { count: jest.Mock };
    mCPServerConfig: { count: jest.Mock };
    askSession: { count: jest.Mock };
    agentTrace: { count: jest.Mock };
    webhookSubscription: { count: jest.Mock };
    knowledgeBase: { count: jest.Mock };
    feedback: { count: jest.Mock };
    agentConfig: { count: jest.Mock };
    collectionItem: { count: jest.Mock };
    aIEngineMetric: { count: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let mockKernelApi: {
    getEventBusStats: jest.Mock;
    getCircuitBreakerMetrics: jest.Mock;
    getDashboard: jest.Mock;
  };

  beforeEach(async () => {
    mockPrisma = {
      resource: { count: jest.fn(), groupBy: jest.fn() },
      researchMission: { count: jest.fn() },
      officeDocument: { count: jest.fn() },
      topic: { count: jest.fn() },
      debateSession: { count: jest.fn() },
      simulationScenario: { count: jest.fn() },
      simulationRun: { count: jest.fn() },
      writingProject: { count: jest.fn() },
      socialContent: { count: jest.fn() },
      toolConfig: { count: jest.fn() },
      skillConfig: { count: jest.fn() },
      aIModel: { count: jest.fn() },
      user: { count: jest.fn() },
      secret: { count: jest.fn() },
      agentProcess: { count: jest.fn().mockResolvedValue(0) },
      processEvent: { count: jest.fn().mockResolvedValue(0) },
      processMemory: { count: jest.fn().mockResolvedValue(0) },
      creditAccount: { count: jest.fn().mockResolvedValue(0) },
      creditTransaction: { count: jest.fn().mockResolvedValue(0) },
      notification: { count: jest.fn().mockResolvedValue(0) },
      systemSetting: { count: jest.fn().mockResolvedValue(0) },
      systemErrorLog: { count: jest.fn().mockResolvedValue(0) },
      loginHistory: { count: jest.fn().mockResolvedValue(0) },
      mCPServerConfig: { count: jest.fn().mockResolvedValue(0) },
      askSession: { count: jest.fn().mockResolvedValue(0) },
      agentTrace: { count: jest.fn().mockResolvedValue(0) },
      webhookSubscription: { count: jest.fn().mockResolvedValue(0) },
      knowledgeBase: { count: jest.fn().mockResolvedValue(0) },
      feedback: { count: jest.fn().mockResolvedValue(0) },
      agentConfig: { count: jest.fn().mockResolvedValue(0) },
      collectionItem: { count: jest.fn().mockResolvedValue(0) },
      aIEngineMetric: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([{ count: BigInt(42) }]),
    };

    mockKernelApi = {
      getEventBusStats: jest.fn().mockReturnValue({ activeSubscriptions: 5 }),
      getCircuitBreakerMetrics: jest
        .fn()
        .mockReturnValue([{ entityId: "gpt-4" }, { entityId: "claude" }]),
      getDashboard: jest.fn().mockReturnValue({ totalCalls: 42 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatisticsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KernelApiService, useValue: mockKernelApi },
      ],
    }).compile();

    service = module.get<StatisticsService>(StatisticsService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== getOverviewStats ====================

  describe("getOverviewStats", () => {
    const mockAllCounts = (value = 0) => {
      mockPrisma.resource.count.mockResolvedValue(value + 1);
      mockPrisma.researchMission.count.mockResolvedValue(value + 2);
      mockPrisma.officeDocument.count.mockResolvedValue(value + 3);
      mockPrisma.topic.count.mockResolvedValue(value + 4);
      mockPrisma.debateSession.count.mockResolvedValue(value + 5);
      mockPrisma.simulationScenario.count.mockResolvedValue(value + 6);
      mockPrisma.simulationRun.count.mockResolvedValue(value + 7);
      mockPrisma.writingProject.count.mockResolvedValue(value + 8);
      mockPrisma.socialContent.count.mockResolvedValue(value + 9);
      mockPrisma.toolConfig.count.mockResolvedValue(value + 10);
      mockPrisma.skillConfig.count.mockResolvedValue(value + 11);
      mockPrisma.aIModel.count.mockResolvedValue(value + 12);
      // user.count is called 3 times: totalUsers, activeUsers, adminUsers
      mockPrisma.user.count
        .mockResolvedValueOnce(value + 13)
        .mockResolvedValueOnce(value + 14)
        .mockResolvedValueOnce(value + 16);
      mockPrisma.secret.count.mockResolvedValue(value + 15);
      // L1 Infrastructure stats
      mockPrisma.agentProcess.count.mockResolvedValue(value);
      mockPrisma.processEvent.count.mockResolvedValue(value);
      mockPrisma.processMemory.count.mockResolvedValue(value);
      mockPrisma.creditAccount.count.mockResolvedValue(value + 17);
      mockPrisma.creditTransaction.count.mockResolvedValue(value + 18);
      mockPrisma.notification.count.mockResolvedValue(value + 19);
      mockPrisma.systemSetting.count.mockResolvedValue(value + 20);
      mockPrisma.systemErrorLog.count.mockResolvedValue(value + 21);
      mockPrisma.loginHistory.count.mockResolvedValue(value);
      mockPrisma.mCPServerConfig.count.mockResolvedValue(value + 22);
      mockPrisma.askSession.count.mockResolvedValue(value + 23);
      mockPrisma.agentTrace.count.mockResolvedValue(value + 24);
      mockPrisma.webhookSubscription.count.mockResolvedValue(value + 25);
      mockPrisma.knowledgeBase.count.mockResolvedValue(value + 26);
      mockPrisma.feedback.count.mockResolvedValue(value + 27);
      mockPrisma.agentConfig.count.mockResolvedValue(value + 28);
      mockPrisma.collectionItem.count.mockResolvedValue(value);
      mockPrisma.aIEngineMetric.count.mockResolvedValue(value);
      mockPrisma.$queryRaw.mockResolvedValue([{ count: BigInt(42) }]);
    };

    it("should return all stat keys including kernel in-memory stats", async () => {
      // Arrange
      mockAllCounts();

      // Act
      const result = await service.getOverviewStats();

      // Assert
      const expectedKeys = [
        "resources",
        "researchMissions",
        "officeDocuments",
        "topics",
        "debateSessions",
        "simScenarios",
        "simRuns",
        "writingProjects",
        "socialContent",
        "tools",
        "skills",
        "aiModels",
        "totalUsers",
        "activeUsers",
        "secrets",
        "kernelProcesses",
        "kernelRunning",
        "kernelEvents",
        "kernelMemories",
        "kernelSubscriptions",
        "kernelBreakers",
        "kernelLLMCalls",
        // L1 Infrastructure
        "adminUsers",
        "creditAccounts",
        "creditTransactions",
        "notifications",
        "dbTables",
        "storageProviders",
        "systemSettings",
        "totalLogins",
        "monitoringErrors",
        // L3 Engine
        "mcpServers",
        "agents",
        "knowledgeBases",
        "guardrailRules",
        // L5 Open API
        "webhookSubscriptions",
        "mcpRegisteredTools",
        // L6 Gateway
        "askSessions",
        "agentTraces",
        // L4 Apps
        "feedbackCount",
        "bookmarkedResources",
      ];
      expectedKeys.forEach((key) => {
        expect(result).toHaveProperty(key);
      });
    });

    it("should include kernel in-memory stats from KernelApiService", async () => {
      // Arrange
      mockAllCounts();

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.kernelSubscriptions).toBe(5);
      expect(result.kernelBreakers).toBe(2);
      expect(result.kernelLLMCalls).toBe(42);
    });

    it("should return correct count values for each key", async () => {
      // Arrange
      mockPrisma.resource.count.mockResolvedValue(100);
      mockPrisma.researchMission.count.mockResolvedValue(50);
      mockPrisma.officeDocument.count.mockResolvedValue(30);
      mockPrisma.topic.count.mockResolvedValue(20);
      mockPrisma.debateSession.count.mockResolvedValue(15);
      mockPrisma.simulationScenario.count.mockResolvedValue(10);
      mockPrisma.simulationRun.count.mockResolvedValue(200);
      mockPrisma.writingProject.count.mockResolvedValue(40);
      mockPrisma.socialContent.count.mockResolvedValue(60);
      mockPrisma.toolConfig.count.mockResolvedValue(150);
      mockPrisma.skillConfig.count.mockResolvedValue(75);
      mockPrisma.aIModel.count.mockResolvedValue(8);
      mockPrisma.user.count
        .mockResolvedValueOnce(500) // totalUsers
        .mockResolvedValueOnce(400); // activeUsers
      mockPrisma.secret.count.mockResolvedValue(25);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.resources).toBe(100);
      expect(result.researchMissions).toBe(50);
      expect(result.officeDocuments).toBe(30);
      expect(result.totalUsers).toBe(500);
      expect(result.activeUsers).toBe(400);
      expect(result.secrets).toBe(25);
    });

    it("should return zeros for DB stats when all tables are empty", async () => {
      // Arrange
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);
      mockPrisma.agentProcess.count.mockResolvedValue(0);
      mockPrisma.processEvent.count.mockResolvedValue(0);
      mockPrisma.processMemory.count.mockResolvedValue(0);
      mockPrisma.creditAccount.count.mockResolvedValue(0);
      mockPrisma.creditTransaction.count.mockResolvedValue(0);
      mockPrisma.notification.count.mockResolvedValue(0);
      mockPrisma.systemSetting.count.mockResolvedValue(0);
      mockPrisma.systemErrorLog.count.mockResolvedValue(0);
      mockPrisma.loginHistory.count.mockResolvedValue(0);
      mockPrisma.mCPServerConfig.count.mockResolvedValue(0);
      mockPrisma.askSession.count.mockResolvedValue(0);
      mockPrisma.agentTrace.count.mockResolvedValue(0);
      mockPrisma.webhookSubscription.count.mockResolvedValue(0);
      mockPrisma.knowledgeBase.count.mockResolvedValue(0);
      mockPrisma.feedback.count.mockResolvedValue(0);
      mockPrisma.agentConfig.count.mockResolvedValue(0);
      mockPrisma.collectionItem.count.mockResolvedValue(0);
      mockPrisma.aIEngineMetric.count.mockResolvedValue(0);
      mockPrisma.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
      mockKernelApi.getEventBusStats.mockReturnValue({
        activeSubscriptions: 0,
      });
      mockKernelApi.getCircuitBreakerMetrics.mockReturnValue([]);
      mockKernelApi.getDashboard.mockReturnValue({ totalCalls: 0 });

      // Act
      const result = await service.getOverviewStats();

      // Assert — storageProviders is static (5), everything else is 0
      const staticKeys: Record<string, number> = {
        storageProviders: 5,
      };
      Object.entries(result).forEach(([key, v]) => {
        if (key in staticKeys) {
          expect(v).toBe(staticKeys[key]);
        } else {
          expect(v).toBe(0);
        }
      });
    });

    it("should query activeUsers with isActive=true filter", async () => {
      // Arrange
      mockAllCounts();

      // Act
      await service.getOverviewStats();

      // Assert: one of the user.count calls includes isActive filter
      const calls = mockPrisma.user.count.mock.calls;
      const activeCall = calls.find((c) => c[0]?.where?.isActive === true);
      expect(activeCall).toBeDefined();
    });
  });

  // ==================== getSystemStats ====================

  describe("getSystemStats", () => {
    it("should return users and resources sections", async () => {
      // Arrange
      mockPrisma.user.count
        .mockResolvedValueOnce(300) // totalUsers
        .mockResolvedValueOnce(250) // activeUsers
        .mockResolvedValueOnce(10); // recentUsers
      mockPrisma.resource.count.mockResolvedValue(400);
      mockPrisma.resource.groupBy.mockResolvedValue([
        { type: "ARTICLE", _count: { type: 200 } },
        { type: "VIDEO", _count: { type: 200 } },
      ]);

      // Act
      const result = await service.getSystemStats();

      // Assert
      expect(result.users.total).toBe(300);
      expect(result.users.active).toBe(250);
      expect(result.users.newLast7Days).toBe(10);
      expect(result.resources.total).toBe(400);
    });

    it("should build byType map from groupBy result", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.resource.count.mockResolvedValue(300);
      mockPrisma.resource.groupBy.mockResolvedValue([
        { type: "ARTICLE", _count: { type: 150 } },
        { type: "PDF", _count: { type: 100 } },
        { type: "VIDEO", _count: { type: 50 } },
      ]);

      // Act
      const result = await service.getSystemStats();

      // Assert
      expect(result.resources.byType).toEqual({
        ARTICLE: 150,
        PDF: 100,
        VIDEO: 50,
      });
    });

    it("should return empty byType when no resources exist", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.resource.groupBy.mockResolvedValue([]);

      // Act
      const result = await service.getSystemStats();

      // Assert
      expect(result.resources.byType).toEqual({});
    });

    it("should compute recentUsers using a 7-day date filter", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.resource.groupBy.mockResolvedValue([]);

      const before = Date.now();

      // Act
      await service.getSystemStats();

      const after = Date.now();

      // Assert: find the count call with createdAt filter
      const recentCall = mockPrisma.user.count.mock.calls.find(
        (c) => c[0]?.where?.createdAt?.gte !== undefined,
      );
      expect(recentCall).toBeDefined();
      const gteDate = recentCall![0].where.createdAt.gte as Date;
      const expectedLower = before - 7 * 24 * 60 * 60 * 1000;
      const expectedUpper = after - 7 * 24 * 60 * 60 * 1000;
      expect(gteDate.getTime()).toBeGreaterThanOrEqual(expectedLower);
      expect(gteDate.getTime()).toBeLessThanOrEqual(expectedUpper);
    });

    it("should call resource.groupBy with type field", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.resource.groupBy.mockResolvedValue([]);

      // Act
      await service.getSystemStats();

      // Assert
      const groupByCall = mockPrisma.resource.groupBy.mock.calls[0][0];
      expect(groupByCall.by).toContain("type");
    });

    it("should propagate error when user.count throws", async () => {
      // Arrange
      mockPrisma.user.count.mockRejectedValue(new Error("DB connection lost"));
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.resource.groupBy.mockResolvedValue([]);

      // Act & Assert
      await expect(service.getSystemStats()).rejects.toThrow(
        "DB connection lost",
      );
    });

    it("should return empty byType when resource.groupBy returns empty array", async () => {
      // Arrange
      mockPrisma.user.count.mockResolvedValue(10);
      mockPrisma.resource.count.mockResolvedValue(5);
      mockPrisma.resource.groupBy.mockResolvedValue([]);

      // Act
      const result = await service.getSystemStats();

      // Assert
      expect(result.resources.byType).toEqual({});
    });
  });

  // ==================== getOverviewStats - without KernelApiService ====================

  describe("getOverviewStats - without KernelApiService", () => {
    let serviceNoKernel: StatisticsService;

    beforeEach(async () => {
      const moduleNoKernel: TestingModule = await Test.createTestingModule({
        providers: [
          StatisticsService,
          { provide: PrismaService, useValue: mockPrisma },
          // KernelApiService intentionally omitted — @Optional() should handle it
        ],
      }).compile();

      serviceNoKernel =
        moduleNoKernel.get<StatisticsService>(StatisticsService);

      jest.spyOn(Logger.prototype, "log").mockImplementation();
      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(Logger.prototype, "error").mockImplementation();
    });

    it("should return kernelSubscriptions, kernelBreakers, kernelLLMCalls as 0 when KernelApiService is not provided", async () => {
      // Arrange — all Prisma counts return 0 by default from mockPrisma setup
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await serviceNoKernel.getOverviewStats();

      // Assert
      expect(result.kernelSubscriptions).toBe(0);
      expect(result.kernelBreakers).toBe(0);
      expect(result.kernelLLMCalls).toBe(0);
    });

    it("should still return all required stat keys even without KernelApiService", async () => {
      // Arrange
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await serviceNoKernel.getOverviewStats();

      // Assert — all three kernel in-memory keys must be present
      expect(result).toHaveProperty("kernelSubscriptions");
      expect(result).toHaveProperty("kernelBreakers");
      expect(result).toHaveProperty("kernelLLMCalls");
    });
  });

  // ==================== getOverviewStats - KernelApiService throws ====================

  describe("getOverviewStats - KernelApiService throws", () => {
    it("should gracefully fall back to 0 when getEventBusStats throws", async () => {
      // Arrange
      mockKernelApi.getEventBusStats.mockImplementation(() => {
        throw new Error("IPC unavailable");
      });
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.kernelSubscriptions).toBe(0);
      expect(result.kernelBreakers).toBe(0);
      expect(result.kernelLLMCalls).toBe(0);
    });

    it("should gracefully fall back to 0 when getCircuitBreakerMetrics throws", async () => {
      // Arrange
      mockKernelApi.getCircuitBreakerMetrics.mockImplementation(() => {
        throw new Error("Circuit breaker service down");
      });
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert — entire in-memory block returns zeros on any throw
      expect(result.kernelSubscriptions).toBe(0);
      expect(result.kernelBreakers).toBe(0);
    });

    it("should gracefully fall back to 0 when getDashboard throws", async () => {
      // Arrange
      mockKernelApi.getDashboard.mockImplementation(() => {
        throw new Error("Dashboard service unavailable");
      });
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.kernelLLMCalls).toBe(0);
    });
  });

  // ==================== getGuardrailRulesCount ====================

  describe("getGuardrailRulesCount (via getOverviewStats)", () => {
    it("should return guardrailRules from GuardrailsPipelineService", async () => {
      // Arrange
      const mockGuardrails = {
        getRegisteredGuardrails: jest.fn().mockReturnValue({ totalRules: 5 }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          StatisticsService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: KernelApiService, useValue: mockKernelApi },
          {
            provide: GuardrailsPipelineService,
            useValue: mockGuardrails,
          },
        ],
      }).compile();

      jest.spyOn(Logger.prototype, "log").mockImplementation();
      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(Logger.prototype, "error").mockImplementation();

      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      const svc = mod.get<StatisticsService>(StatisticsService);

      // Act
      const result = await svc.getOverviewStats();

      // Assert
      expect(result.guardrailRules).toBe(5);
    });

    it("should return guardrailRules 0 when GuardrailsPipelineService is not provided", async () => {
      // Arrange — default service fixture has no guardrailsPipeline
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.guardrailRules).toBe(0);
    });

    it("should return guardrailRules 0 when GuardrailsPipelineService throws", async () => {
      // Arrange
      const mockGuardrailsThrowing = {
        getRegisteredGuardrails: jest.fn().mockImplementation(() => {
          throw new Error("Pipeline not ready");
        }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          StatisticsService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: KernelApiService, useValue: mockKernelApi },
          {
            provide: GuardrailsPipelineService,
            useValue: mockGuardrailsThrowing,
          },
        ],
      }).compile();

      jest.spyOn(Logger.prototype, "log").mockImplementation();
      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(Logger.prototype, "error").mockImplementation();

      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      const svc = mod.get<StatisticsService>(StatisticsService);

      // Act
      const result = await svc.getOverviewStats();

      // Assert
      expect(result.guardrailRules).toBe(0);
    });
  });

  // ==================== getMcpRegisteredTools ====================

  describe("getMcpRegisteredTools (via getOverviewStats)", () => {
    it("should return mcpRegisteredTools from MCPServerService", async () => {
      // Arrange
      const mockMcpServer = {
        getDetailedStatus: jest.fn().mockReturnValue({ totalToolCount: 12 }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          StatisticsService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: KernelApiService, useValue: mockKernelApi },
          { provide: MCPServerService, useValue: mockMcpServer },
        ],
      }).compile();

      jest.spyOn(Logger.prototype, "log").mockImplementation();
      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(Logger.prototype, "error").mockImplementation();

      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      const svc = mod.get<StatisticsService>(StatisticsService);

      // Act
      const result = await svc.getOverviewStats();

      // Assert
      expect(result.mcpRegisteredTools).toBe(12);
    });

    it("should return mcpRegisteredTools 0 when MCPServerService is not provided", async () => {
      // Arrange — default service fixture has no mcpServer
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.mcpRegisteredTools).toBe(0);
    });

    it("should return mcpRegisteredTools 0 when MCPServerService throws", async () => {
      // Arrange
      const mockMcpServerThrowing = {
        getDetailedStatus: jest.fn().mockImplementation(() => {
          throw new Error("MCP server not initialized");
        }),
      };
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          StatisticsService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: KernelApiService, useValue: mockKernelApi },
          { provide: MCPServerService, useValue: mockMcpServerThrowing },
        ],
      }).compile();

      jest.spyOn(Logger.prototype, "log").mockImplementation();
      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(Logger.prototype, "error").mockImplementation();

      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      const svc = mod.get<StatisticsService>(StatisticsService);

      // Act
      const result = await svc.getOverviewStats();

      // Assert
      expect(result.mcpRegisteredTools).toBe(0);
    });
  });

  // ==================== getDbTableCount ====================

  describe("getDbTableCount (via getOverviewStats)", () => {
    it("should return dbTables as the BigInt count from $queryRaw", async () => {
      // Arrange
      mockPrisma.$queryRaw.mockResolvedValue([{ count: BigInt(42) }]);
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.dbTables).toBe(42);
    });

    it("should return dbTables 0 when $queryRaw throws", async () => {
      // Arrange
      mockPrisma.$queryRaw.mockRejectedValue(
        new Error("information_schema unavailable"),
      );
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.dbTables).toBe(0);
    });

    it("should return dbTables 0 when $queryRaw returns count of BigInt(0)", async () => {
      // Arrange
      mockPrisma.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.dbTables).toBe(0);
    });
  });

  // ==================== safeCount edge cases ====================

  describe("safeCount edge cases (via getOverviewStats)", () => {
    it("should return 0 for a safeCount field when that table count throws", async () => {
      // Arrange: make agentProcess.count throw to simulate missing table
      mockPrisma.agentProcess.count.mockRejectedValue(
        new Error("relation does not exist"),
      );
      mockPrisma.resource.count.mockResolvedValue(10);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert — safeCount catches the error, kernelProcesses becomes 0
      expect(result.kernelProcesses).toBe(0);
      // Other fields are unaffected
      expect(result.resources).toBe(10);
    });

    it("should return correct values for non-throwing fields when multiple safeCount calls fail", async () => {
      // Arrange: several safeCount-wrapped tables throw
      mockPrisma.agentProcess.count.mockRejectedValue(new Error("no table"));
      mockPrisma.processEvent.count.mockRejectedValue(new Error("no table"));
      mockPrisma.processMemory.count.mockRejectedValue(new Error("no table"));
      mockPrisma.resource.count.mockResolvedValue(99);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert — failed tables are 0, healthy field is intact
      expect(result.kernelProcesses).toBe(0);
      expect(result.kernelEvents).toBe(0);
      expect(result.kernelMemories).toBe(0);
      expect(result.resources).toBe(99);
    });
  });

  // ==================== kernelLLMCalls DB fallback ====================

  describe("kernelLLMCalls DB fallback", () => {
    it("should use in-memory kernelLLMCalls when kernel totalCalls > 0", async () => {
      // Arrange
      mockKernelApi.getDashboard.mockReturnValue({ totalCalls: 77 });
      mockPrisma.aIEngineMetric.count.mockResolvedValue(200); // DB value should be ignored
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.kernelLLMCalls).toBe(77);
    });

    it("should fall back to DB aIEngineMetric count when kernel in-memory totalCalls is 0", async () => {
      // Arrange
      mockKernelApi.getDashboard.mockReturnValue({ totalCalls: 0 });
      mockPrisma.aIEngineMetric.count.mockResolvedValue(55);
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.kernelLLMCalls).toBe(55);
    });

    it("should use DB value of 0 when both in-memory and DB return 0", async () => {
      // Arrange
      mockKernelApi.getDashboard.mockReturnValue({ totalCalls: 0 });
      mockPrisma.aIEngineMetric.count.mockResolvedValue(0);
      mockPrisma.resource.count.mockResolvedValue(0);
      mockPrisma.researchMission.count.mockResolvedValue(0);
      mockPrisma.officeDocument.count.mockResolvedValue(0);
      mockPrisma.topic.count.mockResolvedValue(0);
      mockPrisma.debateSession.count.mockResolvedValue(0);
      mockPrisma.simulationScenario.count.mockResolvedValue(0);
      mockPrisma.simulationRun.count.mockResolvedValue(0);
      mockPrisma.writingProject.count.mockResolvedValue(0);
      mockPrisma.socialContent.count.mockResolvedValue(0);
      mockPrisma.toolConfig.count.mockResolvedValue(0);
      mockPrisma.skillConfig.count.mockResolvedValue(0);
      mockPrisma.aIModel.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.secret.count.mockResolvedValue(0);

      // Act
      const result = await service.getOverviewStats();

      // Assert
      expect(result.kernelLLMCalls).toBe(0);
    });
  });
});
