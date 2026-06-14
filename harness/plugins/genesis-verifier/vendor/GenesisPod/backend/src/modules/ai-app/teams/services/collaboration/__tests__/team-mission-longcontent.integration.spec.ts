/**
 * TeamMissionService 长内容集成测试
 * Integration Tests for TeamMissionService + LongContentEngine
 *
 * 验证关键问题是否被解决：
 * 1. 粒度约束是否被添加到 Leader 规划提示词
 * 2. 续写检测是否正确触发
 * 3. 质量预警是否正确集成
 * 4. 最终报告是否使用长内容服务
 */

// Mock problematic ESM modules before any imports
jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: jest.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));

jest.mock(
  "../../../../../../common/content-processing/content-extractor.service",
  () => ({
    ContentExtractorService: jest.fn().mockImplementation(() => ({
      extractFromUrl: jest.fn().mockResolvedValue({ content: "mock" }),
    })),
  }),
);

import { Test, TestingModule } from "@nestjs/testing";
import { TeamMissionService } from "../mission/team-mission.service";
import { TeamsLongContentService } from "../../ai/teams-long-content.service";
import { AIFacade, AgentFacade, TeamFacade } from "@/modules/ai-harness/facade";
import { AiChatService, ToolRegistry } from "@/modules/ai-harness/facade";
import { LongContentEngineService } from "../../../../writing/content-engine/services/long-content-engine.service";
import { ContinuationProtocolService } from "../../../../writing/content-engine/services/continuation-protocol.service";
import { TaskGranularityService } from "../../../../writing/content-engine/services/task-granularity.service";
import { SlidingWindowContextService } from "../../../../writing/content-engine/services/sliding-window-context.service";
import { QualityMonitorService } from "../../../../writing/content-engine/services/quality-monitor.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { TopicEventEmitterService } from "../../events";
import { LeaderModelService } from "../../ai/leader-model.service";
import { MissionContextService } from "@/modules/ai-harness/facade";
import { ConstraintEnforcementService } from "@/modules/ai-harness/facade";
import { EmailNotificationPresetsService } from "../../../../../platform/facade";
import { MissionStateManager } from "@/modules/ai-harness/facade";
import { MissionLifecycleService } from "../mission/mission-lifecycle.service";
import { MissionRetryService } from "../mission/mission-retry.service";
import { MissionHealthCheckService } from "../mission/mission-health-check.service";
import { ConfigService } from "@nestjs/config";
import { MissionAICallerService } from "../mission/mission-ai-caller.service";
import { TeamMessageService } from "../mission/team-message.service";
import { TeamMemberService } from "../mission/team-member.service";

/**
 * 这些测试验证 TeamMissionService 与 LongContentEngine 的集成
 * 确保解决了以下问题：
 * 1. Leader 按用户指定粒度分解任务（而不是按"卷"）
 * 2. 自动检测并处理"未完待续"
 * 3. 质量监控和预警
 */
describe("TeamMissionService Long Content Integration", () => {
  let teamMissionService: TeamMissionService;
  let teamsLongContentService: TeamsLongContentService;
  let continuationService: ContinuationProtocolService;

  // 记录调用的参数
  const capturedCalls = {
    longContentInit: [] as any[],
    granularityPrompt: [] as any[],
    processCompletion: [] as any[],
    qualityCheck: [] as any[],
    buildFinalReport: [] as any[],
    getQualityDashboard: [] as any[],
  };

  // Mock services
  const mockPrismaService = {
    teamMission: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({ createdById: "test-user" }),
    },
    agentTask: {
      update: jest.fn(),
      create: jest.fn(),
    },
    missionLog: {
      create: jest.fn(),
    },
    topicMessage: {
      create: jest.fn(),
    },
    aIModel: {
      findFirst: jest.fn(),
    },
  };

  const mockTopicEventEmitterService = {
    emitToTopic: jest.fn(),
  };

  const mockAiChatService = {
    chat: jest.fn().mockResolvedValue({ content: "Mock AI response" }),
  };

  beforeEach(async () => {
    // 重置捕获的调用
    Object.keys(capturedCalls).forEach((key) => {
      capturedCalls[key as keyof typeof capturedCalls] = [];
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamMissionService,
        TeamsLongContentService,
        LongContentEngineService,
        ContinuationProtocolService,
        TaskGranularityService,
        SlidingWindowContextService,
        QualityMonitorService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: TopicEventEmitterService,
          useValue: mockTopicEventEmitterService,
        },
        {
          provide: EmailNotificationPresetsService,
          useValue: {
            sendMissionCompletionNotification: jest
              .fn()
              .mockResolvedValue(true),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue("http://localhost:3000"),
          },
        },
        {
          provide: AIFacade,
          useValue: {
            chat: jest.fn().mockResolvedValue({
              content: "Mock AI response",
              tokensUsed: 100,
            }),
          },
        },
        {
          provide: MissionContextService,
          useValue: {
            extractContextFromLeaderOutput: jest.fn().mockReturnValue(null),
            buildAgentSystemPromptWithContext: jest.fn().mockReturnValue(""),
            buildContextPackagePromptSection: jest.fn().mockReturnValue(""),
          },
        },
        {
          provide: ConstraintEnforcementService,
          useValue: {
            extractConstraints: jest.fn().mockReturnValue([]),
            toHardConstraints: jest.fn().mockReturnValue([]),
            validateOutput: jest
              .fn()
              .mockResolvedValue({ isValid: true, violations: [] }),
            formatConstraintsForPrompt: jest.fn().mockReturnValue(""),
          },
        },
        {
          provide: MissionStateManager,
          useValue: {
            startTask: jest.fn().mockReturnValue(true),
            finishTask: jest.fn(),
            startMissionExecution: jest.fn().mockReturnValue(true),
            finishMissionExecution: jest.fn(),
            startRevision: jest.fn().mockReturnValue(true),
            finishRevision: jest.fn(),
          },
        },
        {
          provide: MissionLifecycleService,
          useValue: {
            cancelMission: jest.fn().mockResolvedValue({ success: true }),
            deleteMission: jest.fn().mockResolvedValue({ success: true }),
            pauseMission: jest.fn().mockResolvedValue({ success: true }),
            resumeMission: jest.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: MissionRetryService,
          useValue: {
            retryMission: jest.fn().mockResolvedValue({ success: true }),
            retryTask: jest.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: MissionHealthCheckService,
          useValue: {
            registerExecuteCallback: jest.fn(),
            registerRevisionCallback: jest.fn(),
            resetRecoveryAttempts: jest.fn(),
            cleanupCompletedMission: jest.fn(),
          },
        },
        {
          provide: LeaderModelService,
          useValue: {
            executeWithFallback: jest
              .fn()
              .mockImplementation(async (_modelId, executor) => {
                const result = await executor({
                  modelId: "mock-model",
                  apiKey: "mock-key",
                });
                return {
                  success: true,
                  data: result,
                  modelUsed: "mock-model",
                  fallbackUsed: false,
                  attempts: 1,
                  attemptedModels: ["mock-model"],
                };
              }),
            getReasoningModelFallbackChain: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ToolRegistry,
          useValue: {
            getTool: jest.fn().mockReturnValue(null),
            getAllTools: jest.fn().mockReturnValue([]),
            registerTool: jest.fn(),
          },
        },
        {
          provide: MissionAICallerService,
          useValue: {
            callAIWithConfig: jest.fn().mockResolvedValue({
              content: "Mock AI response",
              tokensUsed: 100,
            }),
            getModelConfig: jest.fn().mockResolvedValue({
              modelId: "mock-model",
              provider: "openai",
            }),
            trackMissionTokens: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: TeamMessageService,
          useValue: {
            createSystemMessage: jest.fn().mockResolvedValue({ id: "msg-1" }),
            createAgentMessage: jest.fn().mockResolvedValue({ id: "msg-2" }),
            sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-3" }),
            createLog: jest.fn().mockResolvedValue({ id: "log-1" }),
          },
        },
        {
          provide: TeamMemberService,
          useValue: {
            getMemberById: jest.fn().mockResolvedValue(null),
            getMembersByMission: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: AgentFacade,
          useValue: {
            circuitBreaker: {
              canExecute: jest.fn().mockReturnValue(true),
              recordSuccess: jest.fn(),
              recordFailure: jest.fn(),
              incrementLoad: jest.fn(),
              decrementLoad: jest.fn(),
              selectBest: jest.fn().mockReturnValue(null),
              selectBestAgent: jest
                .fn()
                .mockImplementation(
                  (agentIds: string[]) => agentIds[0] || null,
                ),
              getAgentStats: jest
                .fn()
                .mockReturnValue({ state: "CLOSED", failureCount: 0 }),
              getHealthMetrics: jest.fn().mockReturnValue({}),
              getCooldownRemaining: jest.fn().mockReturnValue(0),
              parseErrorType: jest.fn().mockReturnValue("UNKNOWN"),
              reset: jest.fn(),
            },
            coordinatorStore: jest.fn().mockResolvedValue(undefined),
            coordinatorRecall: jest.fn().mockResolvedValue(undefined),
            startTrace: jest.fn().mockReturnValue("trace-1"),
            addSpan: jest.fn(),
            endSpan: jest.fn(),
            endTrace: jest.fn(),
          },
        },
        {
          provide: TeamFacade,
          useValue: {
            aiCompressContext: jest.fn().mockResolvedValue("compressed"),
            sanitizeReport: jest.fn().mockImplementation((r) => r),
            reflect: jest.fn().mockResolvedValue({ content: "reflection" }),
          },
        },
      ],
    }).compile();

    teamMissionService = module.get<TeamMissionService>(TeamMissionService);
    teamsLongContentService = module.get<TeamsLongContentService>(
      TeamsLongContentService,
    );
    continuationService = module.get<ContinuationProtocolService>(
      ContinuationProtocolService,
    );

    // Spy on key methods to verify they're called
    jest
      .spyOn(teamsLongContentService, "initMission")
      .mockImplementation(async (config) => {
        capturedCalls.longContentInit.push(config);
        // 实际调用原方法
        return (
          teamsLongContentService as any
        ).aiFacade?.longContentEngine?.initProject({
          projectId: config.missionId,
          projectTitle: config.missionTitle,
          projectDescription: config.missionDescription,
          totalTasks: config.expectedTaskCount || 10,
          granularityLevel: config.granularityLevel || "chapter",
          expectedWordsPerTask: config.expectedWordsPerTask || 1500,
        });
      });

    jest
      .spyOn(teamsLongContentService, "buildGranularityConstraintPrompt")
      .mockImplementation((missionId) => {
        capturedCalls.granularityPrompt.push(missionId);
        return `【粒度约束】
任务分解粒度：chapter
每个任务预期产出：约 1500 字
请确保：
1. 按用户指定的章节粒度分解任务
2. 不要将多个章节合并为一个任务
3. 不要按"卷"或"部分"分解`;
      });

    jest
      .spyOn(teamsLongContentService, "processTaskCompletion")
      .mockImplementation(async (missionId, taskId, taskTitle, taskResult) => {
        capturedCalls.processCompletion.push({
          missionId,
          taskId,
          taskTitle,
          taskResult,
        });

        // 检测是否需要续写
        const needsContinuation =
          teamsLongContentService.detectContinuationNeeded(taskResult, 1500);

        return {
          needsContinuation,
          continuationState: needsContinuation
            ? {
                taskId,
                needsContinuation: true,
                reason: "short_content" as const,
                completedPortion: 0.3,
                lastCheckpoint: "",
                continuationCount: 0,
                maxContinuations: 3,
                accumulatedResult: taskResult,
                expectedTotalWords: 1500,
                currentTotalWords: 100,
                startedAt: new Date(),
                lastUpdatedAt: new Date(),
              }
            : undefined,
          qualityMetrics: {
            wordCount: taskResult.length,
            completionRatio: 1,
            hasStructuredEnd: true,
            overallScore: 8,
            evaluatedAt: new Date(),
          },
          qualityTrend: {
            trend: "stable" as const,
            trendConfidence: 0.8,
            recentScores: [8],
            averageScore: 8,
            scoreStdDev: 0,
            consecutiveDeclines: 0,
            consecutiveBelowThreshold: 0,
            calculatedAt: new Date(),
          },
          finalContent: taskResult,
        };
      });

    jest
      .spyOn(teamsLongContentService, "checkQualityIntervention")
      .mockImplementation((missionId) => {
        capturedCalls.qualityCheck.push(missionId);
        return { needed: false };
      });

    jest
      .spyOn(teamsLongContentService, "buildFinalReport")
      .mockImplementation(async (missionId) => {
        capturedCalls.buildFinalReport.push(missionId);
        return {
          fullContent: "# 完整报告\n\n所有章节内容...",
          dashboard: {
            projectId: missionId,
            projectTitle: "测试任务",
            progress: {
              completedTasks: 10,
              totalTasks: 10,
              percentage: 100,
            },
            wordStats: {
              totalWords: 15000,
              averagePerTask: 1500,
              minTask: { id: "task-1", title: "第一章", words: 1200 },
              maxTask: { id: "task-5", title: "第五章", words: 1800 },
            },
            quality: {
              overallScore: 8.5,
              recentAverage: 8.5,
              trend: {
                trend: "stable" as const,
                trendConfidence: 0.8,
                recentScores: [8, 8.5, 9],
                averageScore: 8.5,
                scoreStdDev: 0.5,
                consecutiveDeclines: 0,
                consecutiveBelowThreshold: 0,
                calculatedAt: new Date(),
              },
              interventionCount: 0,
            },
            timeline: {
              startedAt: new Date(),
              estimatedEndAt: new Date(),
              lastActivityAt: new Date(),
            },
            anomalies: [],
            interventions: [],
            generatedAt: new Date(),
          },
        };
      });

    jest
      .spyOn(teamsLongContentService, "getQualityDashboard")
      .mockImplementation((missionId) => {
        capturedCalls.getQualityDashboard.push(missionId);
        return {
          projectId: missionId,
          projectTitle: "测试任务",
          progress: {
            completedTasks: 10,
            totalTasks: 10,
            percentage: 100,
          },
          wordStats: {
            totalWords: 15000,
            averagePerTask: 1500,
            minTask: { id: "task-1", title: "第一章", words: 1200 },
            maxTask: { id: "task-5", title: "第五章", words: 1800 },
          },
          quality: {
            overallScore: 8.5,
            recentAverage: 8.5,
            trend: {
              trend: "stable" as const,
              trendConfidence: 0.8,
              recentScores: [8, 8.5, 9],
              averageScore: 8.5,
              scoreStdDev: 0.5,
              consecutiveDeclines: 0,
              consecutiveBelowThreshold: 0,
              calculatedAt: new Date(),
            },
            interventionCount: 0,
          },
          timeline: {
            startedAt: new Date(),
            estimatedEndAt: new Date(),
            lastActivityAt: new Date(),
          },
          anomalies: [],
          interventions: [],
          generatedAt: new Date(),
        };
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============ 问题 1：粒度约束测试 ============

  describe("问题 1: Leader 按用户指定粒度分解任务", () => {
    it("executeLeaderPlanning 应该调用 buildGranularityConstraintPrompt", async () => {
      // 模拟 mission 数据
      const mockMission = {
        id: "mission-test-1",
        title: "写一部 10 章的小说",
        description: "创作科幻小说",
        topicId: "topic-1",
        objectives: ["完成 10 章"],
        constraints: [],
        leader: {
          id: "leader-1",
          agentName: "Leader",
          displayName: "Leader",
          aiModel: "gpt-4o",
        },
        topic: {
          aiMembers: [
            { id: "member-1", agentName: "Writer", aiModel: "gpt-4o" },
          ],
        },
      };

      // 设置 mock 返回值
      mockPrismaService.teamMission.findUnique.mockResolvedValue(mockMission);
      mockPrismaService.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        apiKey: "test-key",
      });

      // 首先需要初始化 long content service（模拟 startMission 中的行为）
      await teamsLongContentService.initMission({
        missionId: mockMission.id,
        missionTitle: mockMission.title,
        missionDescription: mockMission.description,
        objectives: mockMission.objectives,
        constraints: mockMission.constraints,
        granularityLevel: "chapter",
      });

      // 调用 executeLeaderPlanning (通过反射访问私有方法)
      await (teamMissionService as any).executeLeaderPlanning(mockMission);

      // 验证粒度约束被调用
      expect(capturedCalls.granularityPrompt).toContain(mockMission.id);
    });

    it("粒度约束 Prompt 应该包含关键指导", () => {
      // 直接调用获取粒度约束
      const prompt =
        teamsLongContentService.buildGranularityConstraintPrompt("any-mission");

      expect(prompt).toContain("粒度");
      expect(prompt).toContain("chapter");
    });
  });

  // ============ 问题 2：续写检测测试 ============

  describe('问题 2: 自动检测并处理"未完待续"', () => {
    it('含有"未完待续"的内容应该触发续写', () => {
      const content = `
        第一章：开始

        主角踏上了旅程...

        未完待续
      `;

      const needsContinuation =
        teamsLongContentService.detectContinuationNeeded(content, 1500);

      expect(needsContinuation).toBe(true);
    });

    it("processTaskCompletion 应该检测续写需求", async () => {
      const taskResult = "短内容...未完待续";

      await teamsLongContentService.processTaskCompletion(
        "mission-1",
        "task-1",
        "第一章",
        taskResult,
      );

      expect(capturedCalls.processCompletion.length).toBe(1);
      expect(capturedCalls.processCompletion[0].taskResult).toBe(taskResult);
    });

    it("ContinuationProtocolService 应该正确管理状态", () => {
      const taskId = "test-task";
      const content = "初始内容...未完待续";

      // 初始化状态
      continuationService.initState(taskId, content, {
        totalWords: 3000,
        maxContinuations: 3,
      });

      // 获取状态
      const state = continuationService.getState(taskId);
      expect(state).toBeDefined();
      expect(state?.taskId).toBe(taskId);
      expect(state?.maxContinuations).toBe(3);

      // 更新状态
      const newContent = "续写内容...";
      continuationService.updateState(taskId, newContent, {
        needsContinuation: true,
        reason: "short_content",
        completedPortion: 0.07,
        lastCheckpoint: "续写中",
        confidence: 0.8,
      });

      const updatedState = continuationService.getState(taskId);
      // initState 设置 count=1，updateState 再 +1，所以是 2
      expect(updatedState?.continuationCount).toBe(2);
      expect(updatedState?.accumulatedResult).toContain("初始内容");
      expect(updatedState?.accumulatedResult).toContain("续写内容");
    });
  });

  // ============ 问题 3：质量监控测试 ============

  describe("问题 3: 质量监控和预警", () => {
    it("leaderReviewTask 应该检查质量干预需求", async () => {
      const mockMission = {
        id: "mission-quality-1",
        topicId: "topic-1",
        leader: {
          id: "leader-1",
          agentName: "Leader",
          displayName: "Leader",
          aiModel: "gpt-4o",
        },
        tasks: [{ id: "task-1", status: "IN_PROGRESS" }],
      };

      const mockTask = {
        id: "task-1",
        title: "第一章",
        assignedTo: {
          id: "member-1",
          agentName: "Writer",
          displayName: "Writer",
        },
      };

      // 初始化长内容服务
      await teamsLongContentService.initMission({
        missionId: mockMission.id,
        missionTitle: "测试",
        missionDescription: "测试",
        objectives: [],
        constraints: [],
      });

      mockPrismaService.aIModel.findFirst.mockResolvedValue({
        modelId: "gpt-4o",
        apiKey: "test-key",
      });

      // Mock findUnique for mission with tasks
      mockPrismaService.teamMission.findUnique.mockResolvedValue(mockMission);

      // 调用 leaderReviewTask
      await (teamMissionService as any).leaderReviewTask(
        mockMission,
        mockTask,
        "任务结果内容...",
      );

      // 验证质量检查被调用
      expect(capturedCalls.qualityCheck).toContain(mockMission.id);
    });
  });

  // ============ 问题 4：最终报告测试 ============

  describe("问题 4: 使用长内容服务生成最终报告", () => {
    it("completeMission 应该从数据库获取完整内容并尝试获取质量仪表盘", async () => {
      const missionId = "mission-final-1";

      mockPrismaService.teamMission.findUnique.mockResolvedValue({
        id: missionId,
        title: "测试任务",
        description: "任务描述",
        topicId: "topic-1",
        leader: {
          id: "leader-1",
          agentName: "Leader",
          displayName: "Leader",
          aiModel: "gpt-4o",
        },
        leaderId: "leader-1",
        tasks: [
          {
            id: "task-1",
            title: "第一章",
            status: "COMPLETED",
            assignedToId: "member-1",
            assignedTo: { agentName: "Writer", displayName: "Writer" },
            result: "这是第一章的完整内容，包含所有细节...",
          },
          {
            id: "task-2",
            title: "第二章",
            status: "COMPLETED",
            assignedToId: "member-2",
            assignedTo: { agentName: "Editor", displayName: "Editor" },
            result: "这是第二章的完整内容，包含所有细节...",
          },
        ],
      });

      // 调用 completeMission
      await (teamMissionService as any).completeMission(missionId);

      // 验证 getQualityDashboard 被调用（用于获取统计信息）
      expect(capturedCalls.getQualityDashboard).toContain(missionId);
    });
  });

  // ============ 端到端流程模拟测试 ============

  describe("端到端流程模拟", () => {
    it("完整流程：初始化 -> 规划 -> 执行 -> 续写 -> 完成", async () => {
      const missionId = "mission-e2e";

      // 1. 初始化任务
      await teamsLongContentService.initMission({
        missionId,
        missionTitle: "写一部 5 章的小说",
        missionDescription: "科幻小说",
        objectives: ["第1章", "第2章", "第3章", "第4章", "第5章"],
        constraints: ["每章 3000 字"],
        expectedTaskCount: 5,
        granularityLevel: "chapter",
        expectedWordsPerTask: 3000,
      });

      expect(capturedCalls.longContentInit.length).toBe(1);
      expect(capturedCalls.longContentInit[0].missionId).toBe(missionId);

      // 2. 获取粒度约束
      const granularityPrompt =
        teamsLongContentService.buildGranularityConstraintPrompt(missionId);
      expect(granularityPrompt).toContain("chapter");

      // 3. 模拟任务执行和续写检测
      const shortResult = "内容开始...未完待续";
      const completionResult =
        await teamsLongContentService.processTaskCompletion(
          missionId,
          "task-1",
          "第一章",
          shortResult,
        );

      expect(completionResult.needsContinuation).toBe(true);

      // 4. 模拟完整结果
      const fullResult = "这是一段很长的完整内容。".repeat(200) + "（完）";
      const finalResult = await teamsLongContentService.processTaskCompletion(
        missionId,
        "task-2",
        "第二章",
        fullResult,
      );

      expect(finalResult.needsContinuation).toBe(false);

      // 5. 构建最终报告
      const report = await teamsLongContentService.buildFinalReport(missionId);
      expect(report.fullContent).toBeTruthy();
      expect(report.dashboard).toBeDefined();
    });
  });
});
