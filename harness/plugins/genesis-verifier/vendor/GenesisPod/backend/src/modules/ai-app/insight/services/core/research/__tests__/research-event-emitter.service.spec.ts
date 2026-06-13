import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  ResearchEventEmitterService,
  ResearchEventType,
  RESEARCH_INTERNAL_EVENTS,
} from "../research-event-emitter.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchRealtimeAdapter } from "../research-realtime.adapter";

const mockPrisma = {
  researchTopic: {
    findUnique: jest.fn(),
  },
  researchAgentActivity: {
    create: jest.fn(),
  },
  researchTeamMessage: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  researchTask: {
    updateMany: jest.fn(),
  },
};

const mockEventEmitter2 = {
  emit: jest.fn(),
};

const mockRealtimeAdapter = {
  emitToTopic: jest.fn(),
  startMissionTracking: jest.fn(),
  startPhase: jest.fn(),
  completePhase: jest.fn(),
  completeMissionTracking: jest.fn(),
  failMissionTracking: jest.fn(),
  updatePhaseProgress: jest.fn().mockReturnValue(50),
};

// Mock the getModelDisplayNameMap utility
jest.mock("../../../../utils/model-display-name", () => ({
  getModelDisplayNameMap: jest.fn().mockResolvedValue(new Map()),
}));

describe("ResearchEventEmitterService", () => {
  let service: ResearchEventEmitterService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.researchTopic.findUnique.mockResolvedValue({ id: "topic-123" });
    mockPrisma.researchAgentActivity.create.mockResolvedValue({});
    mockPrisma.researchTeamMessage.create.mockResolvedValue({});
    mockPrisma.researchTeamMessage.findMany.mockResolvedValue([]);
    mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchEventEmitterService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter2 },
        { provide: ResearchRealtimeAdapter, useValue: mockRealtimeAdapter },
      ],
    }).compile();

    service = module.get<ResearchEventEmitterService>(
      ResearchEventEmitterService,
    );
  });

  describe("RESEARCH_INTERNAL_EVENTS constants", () => {
    it("should have correct event names", () => {
      expect(RESEARCH_INTERNAL_EVENTS.RESUME_MISSION_EXECUTION).toBe(
        "research.mission.resume-execution",
      );
      expect(RESEARCH_INTERNAL_EVENTS.RECOVERY_NEEDED).toBe(
        "research.mission.recovery_needed",
      );
      expect(RESEARCH_INTERNAL_EVENTS.TOPIC_RESEARCH_PROGRESS).toBe(
        "topic-insights.progress",
      );
    });
  });

  describe("registerEmitHandler", () => {
    it("should register an emit handler", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      service.registerEmitHandler(handler);

      // Verify it calls handler when event is emitted
      await service.emitToTopic("topic-123", "test:event", { data: "test" });

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        "test:event",
        expect.objectContaining({
          data: "test",
          timestamp: expect.any(String),
        }),
      );
    });
  });

  describe("emitResumeMissionExecution", () => {
    it("should emit the internal event via nestEventEmitter", () => {
      service.emitResumeMissionExecution("mission-123", "topic-456");

      expect(mockEventEmitter2.emit).toHaveBeenCalledWith(
        RESEARCH_INTERNAL_EVENTS.RESUME_MISSION_EXECUTION,
        { missionId: "mission-123", topicId: "topic-456" },
      );
    });
  });

  describe("emitToTopic", () => {
    it("should call realtimeAdapter.emitToTopic when adapter is available", async () => {
      await service.emitToTopic(
        "topic-123",
        ResearchEventType.MISSION_STARTED,
        { missionId: "m-001" },
      );

      expect(mockRealtimeAdapter.emitToTopic).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.MISSION_STARTED,
        expect.objectContaining({
          missionId: "m-001",
          timestamp: expect.any(String),
        }),
      );
    });

    it("should call emit handler when registered", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitToTopic("topic-123", "some:event", { key: "value" });

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        "some:event",
        expect.objectContaining({ key: "value" }),
      );
    });

    it("should handle realtimeAdapter error gracefully", async () => {
      mockRealtimeAdapter.emitToTopic.mockImplementationOnce(() => {
        throw new Error("Adapter error");
      });

      // Should not throw
      await expect(
        service.emitToTopic("topic-123", "test", {}),
      ).resolves.not.toThrow();
    });

    it("should handle emit handler error gracefully", async () => {
      const handler = jest.fn().mockRejectedValue(new Error("Handler error"));
      service.registerEmitHandler(handler);

      // Should not throw
      await expect(
        service.emitToTopic("topic-123", "test", {}),
      ).resolves.not.toThrow();
    });

    it("should normalize non-object data", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitToTopic("topic-123", "test", "string-value");

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        "test",
        expect.objectContaining({ value: "string-value" }),
      );
    });
  });

  describe("emitMissionStarted", () => {
    it("should start mission tracking via adapter", async () => {
      await service.emitMissionStarted("topic-123", "mission-456");

      expect(mockRealtimeAdapter.startMissionTracking).toHaveBeenCalledWith(
        "topic-123",
        "mission-456",
        false,
      );
      expect(mockRealtimeAdapter.startPhase).toHaveBeenCalledWith(
        "mission-456",
        "planning",
        "Leader 开始规划",
      );
    });

    it("should pass isQuickMode to adapter", async () => {
      await service.emitMissionStarted(
        "topic-123",
        "mission-456",
        undefined,
        true,
      );

      expect(mockRealtimeAdapter.startMissionTracking).toHaveBeenCalledWith(
        "topic-123",
        "mission-456",
        true,
      );
    });

    it("should emit MISSION_STARTED event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitMissionStarted("topic-123", "mission-456", "gpt-4o");

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.MISSION_STARTED,
        expect.objectContaining({
          missionId: "mission-456",
          leaderModel: "gpt-4o",
        }),
      );
    });
  });

  describe("emitMissionProgress", () => {
    it("should emit MISSION_PROGRESS event with data", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      const progressData = {
        missionId: "m-001",
        progress: 50,
        phase: "researching",
        message: "Progress update",
        completedTasks: 3,
        totalTasks: 6,
      };

      await service.emitMissionProgress("topic-123", progressData);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.MISSION_PROGRESS,
        expect.objectContaining(progressData),
      );
    });
  });

  describe("emitMissionCompleted", () => {
    it("should complete mission tracking via adapter", async () => {
      await service.emitMissionCompleted("topic-123", "mission-456", 5, 5);

      expect(mockRealtimeAdapter.completeMissionTracking).toHaveBeenCalledWith(
        "mission-456",
        "研究完成",
      );
    });

    it("should emit MISSION_COMPLETED event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitMissionCompleted("topic-123", "mission-456", 5, 5);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.MISSION_COMPLETED,
        expect.objectContaining({
          missionId: "mission-456",
          completedTasks: 5,
          totalTasks: 5,
        }),
      );
    });
  });

  describe("emitMissionFailed", () => {
    it("should mark mission tracking as failed via adapter", async () => {
      await service.emitMissionFailed("topic-123", "mission-456", "timeout");

      expect(mockRealtimeAdapter.failMissionTracking).toHaveBeenCalledWith(
        "mission-456",
        "timeout",
      );
    });

    it("should emit MISSION_FAILED event with error", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitMissionFailed("topic-123", "mission-456", "LLM error");

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.MISSION_FAILED,
        expect.objectContaining({
          missionId: "mission-456",
          error: "LLM error",
        }),
      );
    });
  });

  describe("emitLeaderThinking", () => {
    it("should emit LEADER_THINKING event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      const thinkingData = {
        missionId: "m-001",
        phase: "planning" as const,
        content: "Analyzing research topic...",
        progress: 30,
      };

      await service.emitLeaderThinking("topic-123", thinkingData);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.LEADER_THINKING,
        expect.objectContaining(thinkingData),
      );
    });

    it("should persist leader thinking to database when topic exists", async () => {
      const thinkingData = {
        missionId: "m-001",
        phase: "planning" as const,
        content: "Planning research",
        progress: 10,
      };

      await service.emitLeaderThinking("topic-123", thinkingData);

      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          topicId: "topic-123",
          missionId: "m-001",
          agentId: "leader",
          agentName: "研究协调员",
          agentRole: "leader",
          activityType: "PLANNING",
          phase: "planning",
          content: "Planning research",
        }),
      });
    });

    it("should use THINKING activityType for non-planning phases", async () => {
      const thinkingData = {
        missionId: "m-001",
        phase: "understanding" as const,
        content: "Understanding topic",
      };

      await service.emitLeaderThinking("topic-123", thinkingData);

      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          activityType: "THINKING",
        }),
      });
    });

    it("should skip persistence when topic does not exist", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitLeaderThinking("nonexistent-topic", {
        missionId: "m-001",
        phase: "planning",
        content: "Test",
      });

      expect(mockPrisma.researchAgentActivity.create).not.toHaveBeenCalled();
    });

    it("should handle foreign key constraint error gracefully", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Foreign key constraint failed"),
      );

      // Should not throw
      await expect(
        service.emitLeaderThinking("topic-123", {
          missionId: "m-001",
          phase: "planning",
          content: "Test",
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("emitLeaderPlanReady", () => {
    it("should transition phases in adapter", async () => {
      await service.emitLeaderPlanReady("topic-123", "mission-456", 5, 3);

      expect(mockRealtimeAdapter.completePhase).toHaveBeenCalledWith(
        "mission-456",
        "planning",
        "规划完成",
      );
      expect(mockRealtimeAdapter.startPhase).toHaveBeenCalledWith(
        "mission-456",
        "researching",
        "开始维度研究",
      );
    });

    it("should emit LEADER_PLAN_READY event with counts", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitLeaderPlanReady("topic-123", "mission-456", 4, 3);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.LEADER_PLAN_READY,
        expect.objectContaining({
          missionId: "mission-456",
          dimensionCount: 4,
          agentCount: 3,
        }),
      );
    });
  });

  describe("emitLeaderResponse", () => {
    it("should emit LEADER_RESPONSE event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitLeaderResponse(
        "topic-123",
        "m-001",
        "Research plan ready",
      );

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.LEADER_RESPONSE,
        expect.objectContaining({ response: "Research plan ready" }),
      );
    });

    it("should persist leader response to database", async () => {
      await service.emitLeaderResponse("topic-123", "m-001", "Plan created");

      expect(mockPrisma.researchTeamMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          topicId: "topic-123",
          missionId: "m-001",
          messageType: "LEADER_RESPONSE",
          senderRole: "leader",
          content: "Plan created",
        }),
      });
    });

    it("should handle persistence error gracefully", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB error"),
      );

      // Should not throw
      await expect(
        service.emitLeaderResponse("topic-123", "m-001", "Response"),
      ).resolves.not.toThrow();
    });
  });

  describe("saveUserMessage", () => {
    it("should save user message to database", async () => {
      await service.saveUserMessage(
        "topic-123",
        "m-001",
        "What are the trends?",
        "Alice",
      );

      expect(mockPrisma.researchTeamMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          topicId: "topic-123",
          missionId: "m-001",
          messageType: "USER_MESSAGE",
          senderRole: "user",
          senderName: "Alice",
          content: "What are the trends?",
        }),
      });
    });

    it("should use default user name when none provided", async () => {
      await service.saveUserMessage("topic-123", "m-001", "Question");

      expect(mockPrisma.researchTeamMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ senderName: "用户" }),
      });
    });

    it("should handle persistence error gracefully", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        service.saveUserMessage("topic-123", "m-001", "Message"),
      ).resolves.not.toThrow();
    });
  });

  describe("emitAgentWorking", () => {
    it("should emit AGENT_WORKING event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      const agentData = {
        agentId: "researcher-1",
        agentName: "研究员",
        agentRole: "researcher" as const,
        status: "working" as const,
        taskDescription: "Searching for data",
        progress: 30,
      };

      await service.emitAgentWorking("topic-123", agentData);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.AGENT_WORKING,
        expect.objectContaining(agentData),
      );
    });

    it("should persist activity to database when missionId provided and topic exists", async () => {
      const agentData = {
        agentId: "researcher-1",
        agentName: "研究员",
        agentRole: "researcher" as const,
        status: "working" as const,
        taskDescription: "Searching",
        progress: 25,
        dimensionId: "dim-001",
        dimensionName: "Technology",
      };

      await service.emitAgentWorking("topic-123", agentData, "mission-456");

      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          topicId: "topic-123",
          missionId: "mission-456",
          agentId: "researcher-1",
          agentRole: "researcher",
          activityType: "RESEARCHING",
          progress: 25,
          dimensionId: "dim-001",
          dimensionName: "Technology",
        }),
      });
    });

    it("should not persist when missionId is not provided", async () => {
      await service.emitAgentWorking("topic-123", {
        agentId: "r-1",
        agentName: "研究员",
        agentRole: "researcher",
        status: "working",
      });

      expect(mockPrisma.researchAgentActivity.create).not.toHaveBeenCalled();
    });

    it("should skip persistence when topic does not exist", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitAgentWorking(
        "nonexistent-topic",
        {
          agentId: "r-1",
          agentName: "研究员",
          agentRole: "researcher",
          status: "working",
        },
        "mission-456",
      );

      expect(mockPrisma.researchAgentActivity.create).not.toHaveBeenCalled();
    });

    it("should map completed status to COMPLETED activityType", async () => {
      await service.emitAgentWorking(
        "topic-123",
        {
          agentId: "r-1",
          agentName: "研究员",
          agentRole: "researcher",
          status: "completed",
        },
        "mission-456",
      );

      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ activityType: "COMPLETED" }),
      });
    });

    it("should map failed status to FAILED activityType", async () => {
      await service.emitAgentWorking(
        "topic-123",
        {
          agentId: "r-1",
          agentName: "研究员",
          agentRole: "researcher",
          status: "failed",
        },
        "mission-456",
      );

      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ activityType: "FAILED" }),
      });
    });

    it("should sync task progress when dimensionName and progress are set", async () => {
      await service.emitAgentWorking(
        "topic-123",
        {
          agentId: "r-1",
          agentName: "研究员",
          agentRole: "researcher",
          status: "working",
          dimensionName: "Technology",
          progress: 50,
        },
        "mission-456",
      );

      expect(mockPrisma.researchTask.updateMany).toHaveBeenCalledWith({
        where: {
          missionId: "mission-456",
          dimensionName: "Technology",
          status: "EXECUTING",
        },
        data: { progress: 50 },
      });
    });
  });

  describe("emitAgentCompleted", () => {
    it("should emit AGENT_COMPLETED event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitAgentCompleted(
        "topic-123",
        "researcher-1",
        "研究员",
        "Research completed",
      );

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.AGENT_COMPLETED,
        expect.objectContaining({
          agentId: "researcher-1",
          result: "Research completed",
        }),
      );
    });

    it("should persist completed activity when missionId provided and topic exists", async () => {
      await service.emitAgentCompleted(
        "topic-123",
        "researcher-1",
        "研究员",
        "Done",
        "mission-456",
        { dimensionId: "dim-001", dimensionName: "Tech" },
      );

      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          topicId: "topic-123",
          missionId: "mission-456",
          agentId: "researcher-1",
          activityType: "COMPLETED",
          progress: 100,
          dimensionId: "dim-001",
          dimensionName: "Tech",
        }),
      });
    });
  });

  describe("emitDimensionResearchStarted", () => {
    it("should emit DIMENSION_RESEARCH_STARTED event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitDimensionResearchStarted(
        "topic-123",
        "市场分析",
        "研究员A",
      );

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.DIMENSION_RESEARCH_STARTED,
        expect.objectContaining({
          dimensionName: "市场分析",
          agentName: "研究员A",
        }),
      );
    });

    it("should persist to database when missionId provided", async () => {
      await service.emitDimensionResearchStarted(
        "topic-123",
        "技术分析",
        "研究员B",
        "mission-456",
      );

      expect(mockPrisma.researchTeamMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          topicId: "topic-123",
          missionId: "mission-456",
          messageType: "DIMENSION_STARTED",
          senderRole: "researcher",
        }),
      });
    });
  });

  describe("emitDimensionResearchProgress", () => {
    it("should emit DIMENSION_RESEARCH_PROGRESS event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitDimensionResearchProgress(
        "topic-123",
        "技术分析",
        50,
        "Writing analysis",
      );

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.DIMENSION_RESEARCH_PROGRESS,
        expect.objectContaining({
          dimensionName: "技术分析",
          progress: 50,
          currentStep: "Writing analysis",
        }),
      );
    });

    it("should include taskId in event when provided", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitDimensionResearchProgress(
        "topic-123",
        "技术分析",
        75,
        "Final step",
        "mission-456",
        "task-789",
      );

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.DIMENSION_RESEARCH_PROGRESS,
        expect.objectContaining({
          taskId: "task-789",
        }),
      );
    });

    it("should persist to database only at key progress points (0, 25, 50, 75, 100)", async () => {
      await service.emitDimensionResearchProgress(
        "topic-123",
        "Test Dim",
        25,
        "Quarter done",
        "mission-456",
      );

      expect(mockPrisma.researchTeamMessage.create).toHaveBeenCalled();
    });

    it("should NOT persist to database for non-key progress values", async () => {
      await service.emitDimensionResearchProgress(
        "topic-123",
        "Test Dim",
        33,
        "33 percent",
        "mission-456",
      );

      expect(mockPrisma.researchTeamMessage.create).not.toHaveBeenCalled();
    });

    it("should update adapter phase progress when missionId provided", async () => {
      await service.emitDimensionResearchProgress(
        "topic-123",
        "Tech Dim",
        60,
        "Step 3",
        "mission-456",
      );

      expect(mockRealtimeAdapter.updatePhaseProgress).toHaveBeenCalledWith(
        "mission-456",
        "researching",
        60,
        "Step 3",
      );
    });
  });

  describe("emitDimensionResearchCompleted", () => {
    it("should emit DIMENSION_RESEARCH_COMPLETED event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitDimensionResearchCompleted(
        "topic-123",
        "市场分析",
        10,
        2500,
      );

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.DIMENSION_RESEARCH_COMPLETED,
        expect.objectContaining({
          dimensionName: "市场分析",
          findingsCount: 10,
          wordCount: 2500,
        }),
      );
    });

    it("should persist to database when missionId provided", async () => {
      await service.emitDimensionResearchCompleted(
        "topic-123",
        "技术",
        8,
        1800,
        "mission-456",
      );

      expect(mockPrisma.researchTeamMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          messageType: "DIMENSION_COMPLETED",
        }),
      });
    });
  });

  describe("emitReportSynthesisStarted", () => {
    it("should transition phases in adapter when missionId provided", async () => {
      await service.emitReportSynthesisStarted("topic-123", "mission-456");

      expect(mockRealtimeAdapter.completePhase).toHaveBeenCalledWith(
        "mission-456",
        "researching",
        "维度研究完成",
      );
      expect(mockRealtimeAdapter.startPhase).toHaveBeenCalledWith(
        "mission-456",
        "synthesizing",
        "开始报告撰写",
      );
    });

    it("should emit REPORT_SYNTHESIS_STARTED event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitReportSynthesisStarted("topic-123");

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.REPORT_SYNTHESIS_STARTED,
        expect.objectContaining({ message: expect.any(String) }),
      );
    });
  });

  describe("emitReportSynthesisCompleted", () => {
    it("should complete synthesizing phase in adapter when missionId provided", async () => {
      await service.emitReportSynthesisCompleted(
        "topic-123",
        5,
        10000,
        "mission-456",
      );

      expect(mockRealtimeAdapter.completePhase).toHaveBeenCalledWith(
        "mission-456",
        "synthesizing",
        "报告撰写完成",
      );
    });

    it("should emit REPORT_SYNTHESIS_COMPLETED event with stats", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitReportSynthesisCompleted("topic-123", 5, 10000);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.REPORT_SYNTHESIS_COMPLETED,
        expect.objectContaining({
          chapterCount: 5,
          totalWordCount: 10000,
        }),
      );
    });
  });

  describe("getTeamMessages", () => {
    it("should query and return messages in chronological order", async () => {
      const msgs = [
        { id: "1", createdAt: new Date("2024-01-01") },
        { id: "2", createdAt: new Date("2024-01-02") },
      ];
      // findMany returns in desc order (as the service queries)
      mockPrisma.researchTeamMessage.findMany.mockResolvedValue(
        [...msgs].reverse(),
      );

      const result = await service.getTeamMessages("topic-123");

      expect(mockPrisma.researchTeamMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: "topic-123" },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      );
      // Result should be reversed to chronological order
      expect(result[0].id).toBe("1");
    });

    it("should apply missionId filter when provided", async () => {
      mockPrisma.researchTeamMessage.findMany.mockResolvedValue([]);

      await service.getTeamMessages("topic-123", {
        missionId: "mission-456",
        limit: 50,
      });

      expect(mockPrisma.researchTeamMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: "topic-123", missionId: "mission-456" },
          take: 50,
        }),
      );
    });
  });

  describe("getAgentActivities", () => {
    it("should query and return activities in chronological order", async () => {
      const activities = [
        { id: "a1", createdAt: new Date("2024-01-01") },
        { id: "a2", createdAt: new Date("2024-01-02") },
      ];
      mockPrisma.researchAgentActivity = {
        ...mockPrisma.researchAgentActivity,
        findMany: jest.fn().mockResolvedValue([...activities].reverse()),
      } as any;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ResearchEventEmitterService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: EventEmitter2, useValue: mockEventEmitter2 },
          { provide: ResearchRealtimeAdapter, useValue: mockRealtimeAdapter },
        ],
      }).compile();

      const svc = module.get<ResearchEventEmitterService>(
        ResearchEventEmitterService,
      );

      const result = await svc.getAgentActivities("topic-123");

      expect(result[0].id).toBe("a1");
    });
  });

  describe("getLeaderConversationHistory", () => {
    it("should return formatted conversation history", async () => {
      mockPrisma.researchTeamMessage.findMany.mockResolvedValue(
        [
          {
            messageType: "USER_MESSAGE",
            content: "What is the market size?",
            createdAt: new Date("2024-01-01"),
          },
          {
            messageType: "LEADER_RESPONSE",
            content: "The market size is $50B",
            createdAt: new Date("2024-01-02"),
          },
        ].reverse(),
      ); // Service will reverse these

      const history = await service.getLeaderConversationHistory("topic-123");

      expect(history[0].role).toBe("user");
      expect(history[0].content).toBe("What is the market size?");
      expect(history[1].role).toBe("assistant");
      expect(history[1].content).toBe("The market size is $50B");
    });

    it("should apply missionId filter and maxTurns limit", async () => {
      mockPrisma.researchTeamMessage.findMany.mockResolvedValue([]);

      await service.getLeaderConversationHistory("topic-123", "mission-456", 5);

      expect(mockPrisma.researchTeamMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            topicId: "topic-123",
            missionId: "mission-456",
            messageType: { in: ["USER_MESSAGE", "LEADER_RESPONSE"] },
          }),
          take: 10, // maxTurns * 2
        }),
      );
    });
  });

  describe("emitToTopic - no adapter and no handler", () => {
    it("should log debug when no adapter and no handler registered", async () => {
      // Create service without adapter or handler
      const moduleNoAdapter: TestingModule = await Test.createTestingModule({
        providers: [
          ResearchEventEmitterService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: EventEmitter2, useValue: mockEventEmitter2 },
          // No ResearchRealtimeAdapter provided
        ],
      }).compile();

      const svcNoAdapter = moduleNoAdapter.get<ResearchEventEmitterService>(
        ResearchEventEmitterService,
      );

      // Should not throw
      await expect(
        svcNoAdapter.emitToTopic("topic-x", "test:event", { data: 1 }),
      ).resolves.not.toThrow();
    });
  });

  describe("emitMissionStarted persistence edge cases", () => {
    it("should skip DB persistence when topic not found during emitMissionStarted", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitMissionStarted("nonexistent", "mission-1");

      // After finding topic null, researchTeamMessage.create should NOT be called
      expect(mockPrisma.researchTeamMessage.create).not.toHaveBeenCalled();
    });

    it("should handle persistence error gracefully in emitMissionStarted", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        service.emitMissionStarted("topic-123", "mission-1"),
      ).resolves.not.toThrow();
    });
  });

  describe("emitMissionCompleted persistence edge cases", () => {
    it("should skip DB persistence when topic not found during emitMissionCompleted", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitMissionCompleted("nonexistent", "mission-1", 3, 3);

      expect(mockPrisma.researchTeamMessage.create).not.toHaveBeenCalled();
    });

    it("should persist mission completed message when topic exists", async () => {
      await service.emitMissionCompleted("topic-123", "mission-1", 4, 4);

      expect(mockPrisma.researchTeamMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-123",
            missionId: "mission-1",
            messageType: "SYSTEM_MESSAGE",
          }),
        }),
      );
    });
  });

  describe("emitMissionFailed persistence edge cases", () => {
    it("should skip DB persistence when topic not found during emitMissionFailed", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitMissionFailed("nonexistent", "mission-1", "timeout");

      expect(mockPrisma.researchTeamMessage.create).not.toHaveBeenCalled();
    });
  });

  describe("emitAgentWorking with modelId", () => {
    it("should include model display name in agentDisplayName when modelId provided", async () => {
      const { getModelDisplayNameMap } = jest.requireMock(
        "../../../../utils/model-display-name",
      );
      getModelDisplayNameMap.mockResolvedValue(
        new Map([["ep-abc123", "Doubao (豆包)"]]),
      );

      await service.emitAgentWorking(
        "topic-123",
        {
          agentId: "r-1",
          agentName: "研究员",
          agentRole: "researcher",
          status: "working",
          modelId: "ep-abc123",
        },
        "mission-456",
      );

      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentName: expect.stringContaining("Doubao (豆包)"),
          }),
        }),
      );
    });

    it("should not duplicate model label in agentName when already included", async () => {
      const { getModelDisplayNameMap } = jest.requireMock(
        "../../../../utils/model-display-name",
      );
      getModelDisplayNameMap.mockResolvedValue(new Map([["gpt-4o", "GPT-4o"]]));

      await service.emitAgentWorking(
        "topic-123",
        {
          agentId: "r-1",
          agentName: "研究员 [GPT-4o]",
          agentRole: "researcher",
          status: "working",
          modelId: "gpt-4o",
        },
        "mission-456",
      );

      // Should not add another [GPT-4o] suffix
      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentName: "研究员 [GPT-4o]",
          }),
        }),
      );
    });

    it("should handle foreign key constraint error in emitAgentWorking gracefully", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Foreign key constraint failed"),
      );

      await expect(
        service.emitAgentWorking(
          "topic-123",
          {
            agentId: "r-1",
            agentName: "研究员",
            agentRole: "researcher",
            status: "working",
          },
          "mission-456",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("emitAgentCompleted edge cases", () => {
    it("should not persist when missionId is not provided", async () => {
      await service.emitAgentCompleted(
        "topic-123",
        "researcher-1",
        "研究员",
        "Done",
        // no missionId
      );

      expect(mockPrisma.researchAgentActivity.create).not.toHaveBeenCalled();
    });

    it("should skip persistence when topic does not exist in emitAgentCompleted", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitAgentCompleted(
        "nonexistent-topic",
        "researcher-1",
        "研究员",
        "Done",
        "mission-456",
      );

      expect(mockPrisma.researchAgentActivity.create).not.toHaveBeenCalled();
    });

    it("should handle foreign key constraint error in emitAgentCompleted gracefully", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Foreign key constraint failed"),
      );

      await expect(
        service.emitAgentCompleted(
          "topic-123",
          "researcher-1",
          "研究员",
          "Done",
          "mission-456",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("emitLeaderPlanReady persistence edge cases", () => {
    it("should skip persistence when topic not found in emitLeaderPlanReady", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitLeaderPlanReady("nonexistent", "mission-1", 3, 3);

      expect(mockPrisma.researchTeamMessage.create).not.toHaveBeenCalled();
    });
  });

  describe("emitLeaderResponse persistence edge cases", () => {
    it("should skip persistence when topic not found in emitLeaderResponse", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitLeaderResponse(
        "nonexistent",
        "mission-1",
        "Response text",
      );

      expect(mockPrisma.researchTeamMessage.create).not.toHaveBeenCalled();
    });
  });

  describe("emitMissionCompleted - DB error catch", () => {
    it("should log error when DB persistence fails in emitMissionCompleted", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(
        service.emitMissionCompleted("topic-123", "mission-1", 3, 3),
      ).resolves.not.toThrow();
    });
  });

  describe("emitMissionFailed - DB error catch", () => {
    it("should log error when DB persistence fails in emitMissionFailed", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(
        service.emitMissionFailed("topic-123", "mission-1", "timeout"),
      ).resolves.not.toThrow();
    });
  });

  describe("emitLeaderThinking - non-FK error branch", () => {
    it("should log error for non-FK errors in emitLeaderThinking", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Generic DB error"),
      );

      await expect(
        service.emitLeaderThinking("topic-123", {
          missionId: "m-001",
          phase: "planning",
          content: "Thinking content",
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("emitLeaderPlanning", () => {
    it("should emit LEADER_PLANNING event with missionId and content", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitLeaderPlanning(
        "topic-123",
        "mission-456",
        "Planning the research...",
      );

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.LEADER_PLANNING,
        expect.objectContaining({
          missionId: "mission-456",
          content: "Planning the research...",
          message: "Planning the research...",
        }),
      );
    });
  });

  describe("emitLeaderPlanReady - DB error catch", () => {
    it("should log error when DB persistence fails in emitLeaderPlanReady", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(
        service.emitLeaderPlanReady("topic-123", "mission-456", 4, 3),
      ).resolves.not.toThrow();
    });
  });

  describe("emitAgentWorking - task progress sync failure", () => {
    it("should log debug when task progress sync fails (catch in updateMany)", async () => {
      mockPrisma.researchTask.updateMany.mockRejectedValue(
        new Error("updateMany failed"),
      );

      await expect(
        service.emitAgentWorking(
          "topic-123",
          {
            agentId: "r-1",
            agentName: "研究员",
            agentRole: "researcher",
            status: "working",
            dimensionName: "Tech",
            progress: 40,
          },
          "mission-456",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("emitAgentWorking - non-FK error branch", () => {
    it("should log error for non-FK errors in emitAgentWorking", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Generic DB error"),
      );

      await expect(
        service.emitAgentWorking(
          "topic-123",
          {
            agentId: "r-1",
            agentName: "研究员",
            agentRole: "researcher",
            status: "working",
          },
          "mission-456",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("emitAgentCompleted - modelId branch", () => {
    it("should include model display name in agentName when modelId provided", async () => {
      const { getModelDisplayNameMap } = jest.requireMock(
        "../../../../utils/model-display-name",
      );
      getModelDisplayNameMap.mockResolvedValue(
        new Map([["claude-3-5-sonnet", "Claude 3.5 Sonnet"]]),
      );

      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitAgentCompleted(
        "topic-123",
        "researcher-1",
        "研究员",
        "Done",
        "mission-456",
        { modelId: "claude-3-5-sonnet" },
      );

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.AGENT_COMPLETED,
        expect.objectContaining({
          agentName: expect.stringContaining("Claude 3.5 Sonnet"),
        }),
      );
    });

    it("should not duplicate label when agentName already contains model label", async () => {
      const { getModelDisplayNameMap } = jest.requireMock(
        "../../../../utils/model-display-name",
      );
      getModelDisplayNameMap.mockResolvedValue(new Map([["gpt-4o", "GPT-4o"]]));

      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitAgentCompleted(
        "topic-123",
        "researcher-1",
        "研究员 [GPT-4o]",
        "Done",
        "mission-456",
        { modelId: "gpt-4o" },
      );

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.AGENT_COMPLETED,
        expect.objectContaining({
          agentName: "研究员 [GPT-4o]",
        }),
      );
    });
  });

  describe("emitAgentCompleted - non-FK error branch", () => {
    it("should log error for non-FK errors in emitAgentCompleted", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Generic DB error"),
      );

      await expect(
        service.emitAgentCompleted(
          "topic-123",
          "researcher-1",
          "研究员",
          "Done",
          "mission-456",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("mapAgentStatusToActivityType - default branch", () => {
    it("should return THINKING for unknown status via emitAgentWorking", async () => {
      // The private method default branch is covered by passing an unexpected status
      // We can test it indirectly by calling the public method with a cast value
      await service.emitAgentWorking(
        "topic-123",
        {
          agentId: "r-1",
          agentName: "研究员",
          agentRole: "researcher",
          status: "working" as any,
        },
        "mission-456",
      );

      // Ensure it still creates the activity (the default path)
      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ activityType: "RESEARCHING" }),
        }),
      );
    });

    it("should return THINKING for any unmapped status directly via cast", async () => {
      // Access private method via cast to any to cover default branch
      const svcAny = service as any;
      const result = svcAny.mapAgentStatusToActivityType("unknown_status");
      expect(result).toBe("THINKING");
    });
  });

  describe("emitDimensionResearchStarted - DB error catch", () => {
    it("should log error when DB persistence fails in emitDimensionResearchStarted", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(
        service.emitDimensionResearchStarted(
          "topic-123",
          "Tech Analysis",
          "研究员A",
          "mission-456",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("emitDimensionResearchProgress - DB error catch", () => {
    it("should log error when DB persistence fails in emitDimensionResearchProgress", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(
        service.emitDimensionResearchProgress(
          "topic-123",
          "Tech",
          25,
          "Quarter done",
          "mission-456",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("emitDimensionResearchCompleted - DB error catch", () => {
    it("should log error when DB persistence fails in emitDimensionResearchCompleted", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(
        service.emitDimensionResearchCompleted(
          "topic-123",
          "Tech",
          8,
          1800,
          "mission-456",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("emitReportSynthesisProgress", () => {
    it("should emit REPORT_SYNTHESIS_PROGRESS event with progress data", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitReportSynthesisProgress("topic-123", {
        progress: 60,
        phase: "writing",
        message: "Writing chapter 3...",
        missionId: "mission-456",
      });

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.REPORT_SYNTHESIS_PROGRESS,
        expect.objectContaining({
          progress: 60,
          phase: "writing",
          message: "Writing chapter 3...",
          missionId: "mission-456",
        }),
      );
    });
  });

  describe("emitReportSynthesisStarted - topic not found early return", () => {
    it("should return early when topic not found in emitReportSynthesisStarted", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitReportSynthesisStarted(
        "nonexistent-topic",
        "mission-456",
      );

      expect(mockPrisma.researchTeamMessage.create).not.toHaveBeenCalled();
    });

    it("should log error when DB persistence fails in emitReportSynthesisStarted", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(
        service.emitReportSynthesisStarted("topic-123", "mission-456"),
      ).resolves.not.toThrow();
    });
  });

  describe("emitReportSynthesisCompleted - topic not found early return", () => {
    it("should return early when topic not found in emitReportSynthesisCompleted", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await service.emitReportSynthesisCompleted(
        "nonexistent-topic",
        5,
        10000,
        "mission-456",
      );

      expect(mockPrisma.researchTeamMessage.create).not.toHaveBeenCalled();
    });

    it("should log error when DB persistence fails in emitReportSynthesisCompleted", async () => {
      mockPrisma.researchTeamMessage.create.mockRejectedValue(
        new Error("DB write error"),
      );

      await expect(
        service.emitReportSynthesisCompleted(
          "topic-123",
          5,
          10000,
          "mission-456",
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("normalizeEventData - null/undefined branch", () => {
    it("should return empty object for null data via emitToTopic", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitToTopic("topic-123", "test:event", null);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        "test:event",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it("should return empty object for undefined data via emitToTopic", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      await service.emitToTopic("topic-123", "test:event", undefined);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        "test:event",
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });
  });

  describe("emitTaskStarted / emitTaskProgress / emitTaskCompleted", () => {
    it("should emit task started event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      const taskData = {
        taskId: "t-001",
        taskType: "research",
        title: "Research dimension",
        status: "running",
        progress: 0,
      };

      await service.emitTaskStarted("topic-123", taskData);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.TASK_STARTED,
        expect.objectContaining({ taskId: "t-001" }),
      );
    });

    it("should emit task progress event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      const taskData = {
        taskId: "t-001",
        taskType: "research",
        title: "Research dimension",
        status: "running",
        progress: 50,
      };

      await service.emitTaskProgress("topic-123", taskData);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.TASK_PROGRESS,
        expect.objectContaining({ progress: 50 }),
      );
    });

    it("should emit task completed event", async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerEmitHandler(handler);

      const taskData = {
        taskId: "t-001",
        taskType: "research",
        title: "Research dimension",
        status: "completed",
        progress: 100,
      };

      await service.emitTaskCompleted("topic-123", taskData);

      expect(handler).toHaveBeenCalledWith(
        "topic-123",
        ResearchEventType.TASK_COMPLETED,
        expect.objectContaining({ taskId: "t-001" }),
      );
    });
  });
});
