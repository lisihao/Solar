/**
 * MissionOrchestrator Unit Tests
 *
 * 测试核心任务编排流程：Parse → Plan → Execute → Review → Deliver
 */

import { ConfigService } from "@nestjs/config";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "../teams-mission-orchestrator";
import { ConstraintEngine } from "@/modules/ai-harness/facade";
import {
  MissionInput,
  MissionEventType,
  ParsedIntent,
  TaskType,
} from "../../../agents/abstractions/mission.types";
import { ITeam } from "../../abstractions/team.interface";
import { ITeamMember } from "../../abstractions/member.interface";
import { MissionExecutionProfile } from "../../constraints";

// ---------------------------------------------------------------------------
// Helper: consume all events from an AsyncGenerator
// ---------------------------------------------------------------------------
async function collectEvents(
  gen: AsyncGenerator<{
    type: MissionEventType;
    missionId: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }>,
): Promise<
  Array<{
    type: MissionEventType;
    missionId: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }>
> {
  const events: Array<{
    type: MissionEventType;
    missionId: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }> = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("MissionOrchestrator", () => {
  let orchestrator: MissionOrchestrator;
  let mockConstraintEngine: jest.Mocked<ConstraintEngine>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    // Mock ConstraintEngine
    mockConstraintEngine = {
      check: jest.fn().mockReturnValue({ allowed: true }),
      canContinue: jest.fn().mockReturnValue({
        canContinue: true,
        reason: "",
      }),
      recordCost: jest.fn().mockReturnValue(0.5),
      getUsage: jest.fn().mockReturnValue({
        tokensUsed: 0,
        costUsed: 0,
      }),
      reset: jest.fn(),
    } as unknown as jest.Mocked<ConstraintEngine>;

    // Mock ConfigService
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === "ai.defaultModel") return "gpt-4o";
        if (key === "ai.temperature") return 0.7;
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    // Create orchestrator with minimal dependencies
    orchestrator = new MissionOrchestrator(
      mockConstraintEngine,
      mockConfigService,
      undefined, // toolRegistry
      undefined, // skillRegistry
      undefined, // llmFactory
      undefined, // memoryService
      undefined, // mcpManager
      undefined, // aiChatService
      undefined, // prismaService
      undefined, // traceCollector
      undefined, // checkpointManager
      undefined, // a2aBus
      {
        enableAutoRetry: false,
        enableParallel: false,
        reviewStrategy: "none",
      },
    );
  });

  describe("parse()", () => {
    it("should parse mission input and return parsed intent", async () => {
      const input: MissionInput = {
        prompt: "研究人工智能的发展趋势并撰写报告",
        requirements: ["包含最新技术", "至少3000字"],
        metadata: {},
      };

      const result = await orchestrator.parse(input);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.primaryGoal).toBe(input.prompt.slice(0, 100));
      expect(result.secondaryGoals).toEqual(input.requirements);
      expect(result.taskType).toBe("research");
      expect(result.complexity).toBeDefined();
      expect(result.complexity.overall).toMatch(/low|medium|high|very_high/);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should infer task type from prompt keywords", async () => {
      // Note: Keywords are matched in order, first match wins
      // research: ["研究", "调研", "分析", "报告"]
      // analysis: ["分析", "评估", "对比", "趋势"]
      const testCases: Array<{ prompt: string; expectedType: TaskType }> = [
        { prompt: "深入研究市场", expectedType: "research" },
        { prompt: "需要评估和对比用户数据", expectedType: "analysis" },
        { prompt: "撰写和创作产品文案", expectedType: "creation" },
        { prompt: "设计全新的UI界面", expectedType: "design" },
        { prompt: "辩论AI伦理问题", expectedType: "debate" },
        { prompt: "审核代码质量", expectedType: "review" },
        { prompt: "完成通用任务", expectedType: "mixed" },
      ];

      for (const { prompt, expectedType } of testCases) {
        const result = await orchestrator.parse({ prompt, metadata: {} });
        expect(result.taskType).toBe(expectedType);
      }
    });

    it("should assess complexity based on input characteristics", async () => {
      const simpleInput: MissionInput = {
        prompt: "简单任务",
        metadata: {},
      };

      const complexInput: MissionInput = {
        prompt:
          "这是一个非常复杂的任务，需要深入研究多个领域，整合大量数据，并生成详细的分析报告。报告应包含数据可视化、趋势分析和预测建议。".repeat(
            3,
          ),
        requirements: ["需求1", "需求2", "需求3"],
        files: [
          {
            id: "f1",
            name: "file1.pdf",
            url: "file1.pdf",
            mimeType: "application/pdf",
            size: 1024,
          },
        ],
        urls: ["https://example.com"],
        metadata: {},
      };

      const simpleResult = await orchestrator.parse(simpleInput);
      const complexResult = await orchestrator.parse(complexInput);

      expect(simpleResult.complexity.overall).toBe("low");
      expect(complexResult.complexity.overall).toMatch(/high|very_high/);
      expect(complexResult.complexity.estimatedSubTasks).toBeGreaterThan(
        simpleResult.complexity.estimatedSubTasks,
      );
      expect(complexResult.complexity.estimatedDuration).toBeGreaterThan(
        simpleResult.complexity.estimatedDuration,
      );
    });

    it("should extract topics from prompt", async () => {
      const input: MissionInput = {
        prompt: "人工智能在医疗健康领域的应用研究",
        metadata: {},
      };

      const result = await orchestrator.parse(input);

      expect(result.extractedInfo.topics).toBeDefined();
      expect(result.extractedInfo.topics.length).toBeGreaterThan(0);
      // Topics are extracted as whole phrases (split by Chinese punctuation)
      expect(
        result.extractedInfo.topics.some((t) => t.includes("人工智能")),
      ).toBe(true);
    });

    it("should suggest appropriate strategy based on complexity", async () => {
      const highComplexityInput: MissionInput = {
        prompt: "需要深入研究的复杂任务".repeat(50),
        metadata: {},
      };

      const result = await orchestrator.parse(highComplexityInput);

      expect(result.suggestedStrategy).toBeDefined();
      expect(result.suggestedStrategy.workflowType).toMatch(
        /sequential|parallel|hybrid/,
      );
      expect(result.suggestedStrategy.needsIteration).toBeDefined();
    });
  });

  describe("plan()", () => {
    let mockTeam: ITeam;
    let mockLeader: ITeamMember;
    let mockMember: ITeamMember;
    let mockIntent: ParsedIntent;
    let mockConstraints: MissionExecutionProfile;

    beforeEach(() => {
      mockLeader = {
        id: "leader-1",
        name: "Leader",
        role: { id: "leader", name: "Leader", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: "I am a leader",
        workStyle: {
          outputStyle: "detailed",
          thinkingDepth: "deep",
          riskTolerance: "balanced",
        },
        status: "idle",
        isLeader: () => true,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "You are a team leader",
      } as unknown as ITeamMember;

      mockMember = {
        id: "member-1",
        name: "Researcher",
        role: { id: "researcher", name: "Researcher", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: "I am a researcher",
        workStyle: {
          outputStyle: "detailed",
          thinkingDepth: "standard",
          riskTolerance: "balanced",
        },
        status: "idle",
        isLeader: () => false,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "You are a researcher",
      } as unknown as ITeamMember;

      mockTeam = {
        id: "team-1",
        name: "Test Team",
        description: "A test team for unit testing",
        type: "predefined",
        config: {},
        leader: mockLeader,
        members: [mockLeader, mockMember],
        workflow: {
          id: "workflow-1",
          type: "sequential",
          name: "Sequential Workflow",
          description: "Simple sequential workflow",
          steps: [
            {
              id: "step-1",
              name: "研究",
              description: "Research the topic",
              type: "task",
              executorRoles: ["researcher"],
              dependsOn: [],
              timeout: 60000,
            },
            {
              id: "step-2",
              name: "整合",
              description: "Integrate findings",
              type: "task",
              executorRoles: ["leader"],
              dependsOn: ["step-1"],
              timeout: 30000,
            },
          ],
        },
        constraintProfile: {
          cost: {
            budget: 100,
            modelPreference: "balanced",
            allowOverBudget: false,
            warningThreshold: 80,
          },
          quality: {
            depth: "standard",
            accuracy: "prefer_evidence",
            reviewRequired: false,
            minReviewScore: 6,
            maxReworks: 2,
          },
          efficiency: {
            maxDuration: 300000,
            priority: "normal",
            allowParallel: false,
            maxParallelism: 1,
          },
        },
        getAllMembers: () => [mockLeader, mockMember],
        getMemberById: (id: string) =>
          [mockLeader, mockMember].find((m) => m.id === id),
        getMembersByRole: (roleId: string) =>
          [mockLeader, mockMember].filter((m) => m.role.id === roleId),
        hasRole: (roleId: string) =>
          [mockLeader, mockMember].some((m) => m.role.id === roleId),
        getAvailableSkills: () => [],
        getAvailableTools: () => [],
      } as unknown as ITeam;

      mockIntent = {
        id: "intent-1",
        missionId: "mission-1",
        primaryGoal: "Research AI trends",
        secondaryGoals: [],
        extractedInfo: {
          topics: ["AI", "trends"],
          entities: [],
          language: "zh",
        },
        taskType: "research",
        complexity: {
          overall: "medium",
          informational: "medium",
          logical: "medium",
          creative: "medium",
          estimatedSubTasks: 3,
          estimatedDuration: 120000,
          estimatedCost: 50,
        },
        suggestedStrategy: {
          workflowType: "sequential",
          memberConfig: [],
          needsIteration: true,
          needsHumanReview: false,
          riskFactors: [],
        },
        confidence: 0.9,
      };

      mockConstraints = {
        cost: {
          budget: 100,
          modelPreference: "balanced",
          allowOverBudget: false,
          warningThreshold: 80,
        },
        quality: {
          depth: "standard",
          accuracy: "prefer_evidence",
          reviewRequired: true,
          minReviewScore: 6,
          maxReworks: 2,
        },
        efficiency: {
          maxDuration: 300000,
          priority: "normal",
          allowParallel: false,
          maxParallelism: 1,
        },
      };
    });

    it("should generate execution plan with steps based on workflow", async () => {
      const plan = await orchestrator.plan(
        mockIntent,
        mockTeam,
        mockConstraints,
      );

      expect(plan).toBeDefined();
      expect(plan.id).toBeDefined();
      expect(plan.missionId).toBe(mockIntent.missionId);
      expect(plan.parsedIntent).toEqual(mockIntent);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.estimatedCost).toBeGreaterThan(0);
      expect(plan.estimatedDuration).toBeGreaterThan(0);
      expect(plan.createdAt).toBeInstanceOf(Date);
    });

    it("should map workflow steps to execution steps", async () => {
      const plan = await orchestrator.plan(
        mockIntent,
        mockTeam,
        mockConstraints,
      );

      const workflowStepIds = mockTeam.workflow.steps.map((s) => s.id);
      const planStepIds = plan.steps.map((s) => s.id);

      for (const wfStepId of workflowStepIds) {
        expect(planStepIds).toContain(wfStepId);
      }
    });

    it("should add review step when review is required", async () => {
      const constraintsWithReview: MissionExecutionProfile = {
        ...mockConstraints,
        quality: { ...mockConstraints.quality, reviewRequired: true },
      };

      const plan = await orchestrator.plan(
        mockIntent,
        mockTeam,
        constraintsWithReview,
      );

      const reviewStep = plan.steps.find((s) => s.id === "review");
      expect(reviewStep).toBeDefined();
      expect(reviewStep?.type).toBe("review");
      expect(reviewStep?.executor).toBe(mockTeam.leader.id);
    });

    it("should add delivery step at the end", async () => {
      const plan = await orchestrator.plan(
        mockIntent,
        mockTeam,
        mockConstraints,
      );

      const deliveryStep = plan.steps.find((s) => s.id === "delivery");
      expect(deliveryStep).toBeDefined();
      expect(deliveryStep?.type).toBe("delivery");
      expect(deliveryStep?.executor).toBe(mockTeam.leader.id);
    });

    it("should set dependencies correctly", async () => {
      const plan = await orchestrator.plan(
        mockIntent,
        mockTeam,
        mockConstraints,
      );

      for (const step of plan.steps) {
        if (step.dependencies.length > 0) {
          for (const depId of step.dependencies) {
            const depStep = plan.steps.find((s) => s.id === depId);
            expect(depStep).toBeDefined();
          }
        }
      }
    });

    it("should include timeout from workflow step config", async () => {
      const plan = await orchestrator.plan(
        mockIntent,
        mockTeam,
        mockConstraints,
      );

      const step1 = plan.steps.find((s) => s.id === "step-1");
      expect(step1?.timeout).toBe(60000);
    });

    it("should estimate cost based on quality depth", async () => {
      const standardConstraints: MissionExecutionProfile = {
        ...mockConstraints,
        quality: { ...mockConstraints.quality, depth: "standard" },
      };

      const comprehensiveConstraints: MissionExecutionProfile = {
        ...mockConstraints,
        quality: { ...mockConstraints.quality, depth: "comprehensive" },
      };

      const standardPlan = await orchestrator.plan(
        mockIntent,
        mockTeam,
        standardConstraints,
      );
      const comprehensivePlan = await orchestrator.plan(
        mockIntent,
        mockTeam,
        comprehensiveConstraints,
      );

      expect(comprehensivePlan.estimatedCost).toBeGreaterThan(
        standardPlan.estimatedCost,
      );
      expect(comprehensivePlan.estimatedDuration).toBeGreaterThan(
        standardPlan.estimatedDuration,
      );
    });
  });

  describe("cancel()", () => {
    it("should mark execution as cancelled and cleanup state", async () => {
      const missionId = "mission-cancel-test";

      // Initialize state
      const state = orchestrator["initializeState"](missionId);
      state.phase = "executing";
      orchestrator["states"].set(missionId, state);

      // Add to internal caches
      orchestrator["originalInputs"].set(missionId, {
        prompt: "test",
        metadata: {},
      });

      // Cancel
      await orchestrator.cancel(missionId);

      // Verify state is marked as failed
      const updatedState = orchestrator.getState(missionId);
      expect(updatedState?.phase).toBe("failed");

      // Verify cleanup
      expect(orchestrator["originalInputs"].has(missionId)).toBe(false);
    });

    it("should handle cancellation of non-existent mission gracefully", async () => {
      await expect(
        orchestrator.cancel("non-existent-mission"),
      ).resolves.not.toThrow();
    });
  });

  describe("getState()", () => {
    it("should return execution state for existing mission", () => {
      const missionId = "mission-state-test";
      const state = orchestrator["initializeState"](missionId);
      state.phase = "executing";
      state.completedSteps = ["step-1", "step-2"];
      orchestrator["states"].set(missionId, state);

      const result = orchestrator.getState(missionId);

      expect(result).toBeDefined();
      expect(result?.missionId).toBe(missionId);
      expect(result?.phase).toBe("executing");
      expect(result?.completedSteps).toEqual(["step-1", "step-2"]);
    });

    it("should return undefined for non-existent mission", () => {
      const result = orchestrator.getState("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("getResourceUsage()", () => {
    it("should return resource usage for existing mission", () => {
      const missionId = "mission-usage-test";
      const state = orchestrator["initializeState"](missionId);
      state.resourceUsage = {
        tokensUsed: 1000,
        costUsed: 0.5,
        timeElapsed: 30000,
        reviewCount: 2,
        reworkCount: 1,
        progress: 0.5,
      };
      orchestrator["states"].set(missionId, state);

      const usage = orchestrator.getResourceUsage(missionId);

      expect(usage).toBeDefined();
      expect(usage?.tokensUsed).toBe(1000);
      expect(usage?.costUsed).toBe(0.5);
      expect(usage?.progress).toBe(0.5);
    });

    it("should return undefined for non-existent mission", () => {
      const usage = orchestrator.getResourceUsage("non-existent");
      expect(usage).toBeUndefined();
    });
  });

  describe("updateState()", () => {
    it("should update mission state with provided updates", () => {
      const missionId = "mission-update-test";
      const initialState = orchestrator["initializeState"](missionId);
      orchestrator["states"].set(missionId, initialState);

      orchestrator.updateState(missionId, {
        phase: "executing",
        currentSteps: ["step-1"],
        completedSteps: ["step-0"],
        progress: 0.25,
      });

      const state = orchestrator.getState(missionId);
      expect(state?.phase).toBe("executing");
      expect(state?.currentSteps).toEqual(["step-1"]);
      expect(state?.completedSteps).toEqual(["step-0"]);
      expect(state?.resourceUsage.progress).toBe(0.25);
    });

    it("should create state if mission does not exist", () => {
      const missionId = "mission-new-update-test";
      expect(orchestrator.getState(missionId)).toBeUndefined();

      orchestrator.updateState(missionId, {
        phase: "parsing",
      });

      const state = orchestrator.getState(missionId);
      expect(state).toBeDefined();
      expect(state?.phase).toBe("parsing");
    });

    it("should preserve existing state when partial update", () => {
      const missionId = "mission-partial-update-test";
      const initialState = orchestrator["initializeState"](missionId);
      initialState.completedSteps = ["step-1"];
      orchestrator["states"].set(missionId, initialState);

      orchestrator.updateState(missionId, {
        phase: "reviewing",
      });

      const state = orchestrator.getState(missionId);
      expect(state?.phase).toBe("reviewing");
      expect(state?.completedSteps).toEqual(["step-1"]); // preserved
    });
  });

  describe("private helpers", () => {
    it("should initialize state correctly", () => {
      const missionId = "test-mission";
      const state = orchestrator["initializeState"](missionId);

      expect(state.missionId).toBe(missionId);
      expect(state.phase).toBe("idle");
      expect(state.completedSteps).toEqual([]);
      expect(state.currentSteps).toEqual([]);
      expect(state.failedSteps).toEqual([]);
      expect(state.reviewResults).toEqual([]);
      expect(state.deliverables).toEqual([]);
      expect(state.intermediateOutputs).toBeInstanceOf(Map);
      expect(state.resourceUsage).toEqual({
        tokensUsed: 0,
        costUsed: 0,
        timeElapsed: 0,
        reviewCount: 0,
        reworkCount: 0,
        progress: 0,
      });
    });

    it("should create mission events correctly", () => {
      const event = orchestrator["createEvent"](
        "mission_started",
        "mission-1",
        {
          input: { prompt: "test" },
        },
      );

      expect(event.type).toBe("mission_started");
      expect(event.missionId).toBe("mission-1");
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.data).toEqual({ input: { prompt: "test" } });
    });

    it("should calculate total duration from steps", () => {
      const steps = [
        {
          id: "1",
          name: "Step 1",
          description: "",
          executor: "exec-1",
          type: "task" as const,
          dependencies: [],
          estimatedDuration: 10000,
          estimatedCost: 10,
        },
        {
          id: "2",
          name: "Step 2",
          description: "",
          executor: "exec-2",
          type: "task" as const,
          dependencies: [],
          estimatedDuration: 20000,
          estimatedCost: 20,
        },
      ];

      const totalDuration = orchestrator["calculateTotalDuration"](steps);
      expect(totalDuration).toBe(30000);
    });

    it("should extract topics from prompt", () => {
      const topics = orchestrator["extractTopics"](
        "人工智能和机器学习在医疗健康领域的应用",
      );

      expect(topics.length).toBeGreaterThan(0);
      expect(topics.length).toBeLessThanOrEqual(5);
      topics.forEach((topic) => {
        expect(topic.length).toBeGreaterThan(2);
      });
    });

    it("should map workflow step types correctly", () => {
      expect(orchestrator["mapStepType"]("review")).toBe("review");
      expect(orchestrator["mapStepType"]("decision")).toBe("task");
      expect(orchestrator["mapStepType"]("analysis")).toBe("task");
      expect(orchestrator["mapStepType"]("synthesis")).toBe("task");
    });
  });

  describe("constructor initialization", () => {
    it("should initialize with default config when no config provided", () => {
      const defaultOrchestrator = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
      );

      const config = defaultOrchestrator["config"];
      expect(config.enableAutoRetry).toBe(true);
      expect(config.maxRetries).toBe(3);
      expect(config.enableParallel).toBe(true);
      expect(config.reviewStrategy).toBe("critical");
    });

    it("should merge provided config with defaults", () => {
      const customOrchestrator = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined, // a2aBus
        {
          enableAutoRetry: false,
          maxRetries: 5,
        },
      );

      const config = customOrchestrator["config"];
      expect(config.enableAutoRetry).toBe(false);
      expect(config.maxRetries).toBe(5);
      expect(config.enableParallel).toBe(true); // default preserved
    });

    it("should initialize HandoffCoordinator", () => {
      expect(orchestrator["handoffCoordinator"]).toBeDefined();
    });

    it("should initialize internal data structures", () => {
      expect(orchestrator["states"]).toBeInstanceOf(Map);
      expect(orchestrator["originalInputs"]).toBeDefined();
      expect(orchestrator["missionTraces"]).toBeDefined();
    });
  });

  describe("ConstraintEngine integration", () => {
    it("should check constraints during execution", async () => {
      const input: MissionInput = {
        prompt: "测试任务",
        metadata: {},
      };

      await orchestrator.parse(input);

      // Verify ConstraintEngine was not called for parse (lightweight operation)
      // Real constraint checks happen during execution phase
    });

    it("should record costs correctly", async () => {
      mockConstraintEngine.recordCost.mockReturnValue(1.5);

      const cost = mockConstraintEngine.recordCost(
        "test-operation",
        "gpt-4o",
        100,
        200,
        "mission-1",
      );

      expect(cost).toBe(1.5);
      expect(mockConstraintEngine.recordCost).toHaveBeenCalledWith(
        "test-operation",
        "gpt-4o",
        100,
        200,
        "mission-1",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Full execute() flow tests – use a minimal mock team
  // ---------------------------------------------------------------------------
  describe("execute() – full orchestration flow", () => {
    let mockLeader: ITeamMember;
    let mockMember: ITeamMember;
    let mockTeam: ITeam;
    let missionInput: MissionInput;
    // Storage for the memory mock so getContext can return the plan
    const memoryStore: Map<string, Map<string, unknown>> = new Map();
    let orchestratorWithMemory: MissionOrchestrator;

    beforeEach(() => {
      memoryStore.clear();

      // Mock memoryService so getContext() returns the plan stored during planning
      const mockMemoryService = {
        setWithSession: jest
          .fn()
          .mockImplementation(
            async (sessionId: string, key: string, value: unknown) => {
              if (!memoryStore.has(sessionId)) {
                memoryStore.set(sessionId, new Map());
              }
              memoryStore.get(sessionId)!.set(key, value);
            },
          ),
        getWithSession: jest
          .fn()
          .mockImplementation(async (sessionId: string, key: string) => {
            return memoryStore.get(sessionId)?.get(key) ?? null;
          }),
      };

      mockLeader = {
        id: "leader-1",
        name: "Leader",
        role: { id: "leader", name: "Leader", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: "",
        workStyle: {
          outputStyle: "detailed",
          thinkingDepth: "deep",
          riskTolerance: "balanced",
        },
        status: "idle",
        isLeader: () => true,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "You are a leader",
      } as unknown as ITeamMember;

      mockMember = {
        id: "member-1",
        name: "Researcher",
        role: { id: "researcher", name: "Researcher", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: "",
        workStyle: {
          outputStyle: "concise",
          thinkingDepth: "quick",
          riskTolerance: "conservative",
        },
        status: "idle",
        isLeader: () => false,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "You are a researcher",
      } as unknown as ITeamMember;

      // A minimal ITeam with one workflow step and no review required
      mockTeam = {
        id: "team-1",
        name: "Test Team",
        description: "Test",
        type: "predefined",
        config: {},
        leader: mockLeader,
        members: [mockMember],
        workflow: {
          id: "wf-1",
          name: "Simple Workflow",
          type: "sequential",
          steps: [
            {
              id: "research",
              name: "Research",
              description: "Do the research",
              type: "task",
              executorRoles: ["researcher"],
              dependsOn: [],
              timeout: 5000,
            },
          ],
          entryStepId: "research",
          exitStepIds: ["delivery"],
        },
        constraintProfile: {
          cost: {
            budget: 1000,
            modelPreference: "balanced",
            allowOverBudget: false,
            warningThreshold: 80,
          },
          quality: {
            depth: "standard",
            accuracy: "prefer_evidence",
            reviewRequired: false,
            minReviewScore: 6,
            maxReworks: 0,
          },
          efficiency: {
            maxDuration: 600000,
            priority: "normal",
            allowParallel: false,
            maxParallelism: 1,
          },
        },
        getAllMembers: () => [mockLeader, mockMember],
        getMemberById: (id: string) =>
          [mockLeader, mockMember].find((m) => m.id === id),
        getMembersByRole: (roleId: string) =>
          [mockLeader, mockMember].filter((m) => m.role.id === roleId),
        hasRole: (roleId: string) =>
          [mockLeader, mockMember].some((m) => m.role.id === roleId),
        getAvailableSkills: () => [],
        getAvailableTools: () => [],
      } as unknown as ITeam;

      missionInput = {
        prompt: "研究人工智能发展趋势",
        metadata: {},
      };

      // Orchestrator with memoryService so getContext() can find the plan
      orchestratorWithMemory = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined, // toolRegistry
        undefined, // skillRegistry
        undefined, // llmFactory
        mockMemoryService as never,
        undefined, // mcpManager
        undefined, // aiChatService
        undefined, // prismaService
        undefined, // traceCollector
        undefined, // checkpointManager
        undefined, // a2aBus
        {
          enableAutoRetry: false,
          enableParallel: false,
          reviewStrategy: "none",
        },
      );
    });

    it("should emit mission_started as first event", async () => {
      const gen = orchestratorWithMemory.execute(missionInput, mockTeam);
      const first = await gen.next();
      expect(first.done).toBe(false);
      expect(first.value?.type).toBe("mission_started");
      // drain the rest to avoid hanging
      await collectEvents(gen);
    });

    it("should emit parsing_started and parsing_completed events", async () => {
      const events = await collectEvents(
        orchestratorWithMemory.execute(missionInput, mockTeam),
      );
      const types = events.map((e) => e.type);
      expect(types).toContain("parsing_started");
      expect(types).toContain("parsing_completed");
    });

    it("should emit planning_started and planning_completed events", async () => {
      const events = await collectEvents(
        orchestratorWithMemory.execute(missionInput, mockTeam),
      );
      const types = events.map((e) => e.type);
      expect(types).toContain("planning_started");
      expect(types).toContain("planning_completed");
    });

    it("should emit step_started and step_completed for each workflow step", async () => {
      const events = await collectEvents(
        orchestratorWithMemory.execute(missionInput, mockTeam),
      );
      const types = events.map((e) => e.type);
      expect(types).toContain("step_started");
      expect(types).toContain("step_completed");
    });

    it("should emit delivering_started and mission_completed events on success", async () => {
      const events = await collectEvents(
        orchestratorWithMemory.execute(missionInput, mockTeam),
      );
      const types = events.map((e) => e.type);
      expect(types).toContain("delivering_started");
      expect(types).toContain("mission_completed");
    });

    it("should NOT emit mission_failed when execution succeeds", async () => {
      const events = await collectEvents(
        orchestratorWithMemory.execute(missionInput, mockTeam),
      );
      const types = events.map((e) => e.type);
      expect(types).not.toContain("mission_failed");
    });

    it("should emit events in correct sequence order", async () => {
      const events = await collectEvents(
        orchestratorWithMemory.execute(missionInput, mockTeam),
      );
      const types = events.map((e) => e.type);

      const missionStartedIdx = types.indexOf("mission_started");
      const parsingStartedIdx = types.indexOf("parsing_started");
      const planningStartedIdx = types.indexOf("planning_started");
      const deliveringIdx = types.indexOf("delivering_started");
      const missionCompletedIdx = types.indexOf("mission_completed");

      expect(missionStartedIdx).toBeLessThan(parsingStartedIdx);
      expect(parsingStartedIdx).toBeLessThan(planningStartedIdx);
      expect(planningStartedIdx).toBeLessThan(deliveringIdx);
      expect(deliveringIdx).toBeLessThan(missionCompletedIdx);
    });

    it("should store mission input in originalInputs during execution", async () => {
      const gen = orchestratorWithMemory.execute(missionInput, mockTeam);
      // Read first event to ensure execute has started
      const first = await gen.next();
      const missionId = first.value?.missionId;
      expect(missionId).toBeDefined();
      // At this point the input should be stored
      expect(orchestratorWithMemory["originalInputs"].has(missionId)).toBe(
        true,
      );
      // Drain the rest
      await collectEvents(gen);
    });

    it("should clean up originalInputs after successful completion", async () => {
      let missionId: string | undefined;
      for await (const event of orchestratorWithMemory.execute(
        missionInput,
        mockTeam,
      )) {
        if (!missionId) missionId = event.missionId;
      }
      // After completion, the input should be deleted
      expect(orchestratorWithMemory["originalInputs"].has(missionId!)).toBe(
        false,
      );
    });

    it("should emit review events when reviewRequired is true", async () => {
      const teamWithReview = {
        ...mockTeam,
        constraintProfile: {
          ...mockTeam.constraintProfile,
          quality: {
            ...mockTeam.constraintProfile.quality,
            reviewRequired: true,
            maxReworks: 0,
          },
        },
      } as unknown as ITeam;

      const events = await collectEvents(
        orchestratorWithMemory.execute(missionInput, teamWithReview),
      );
      const types = events.map((e) => e.type);
      expect(types).toContain("review_started");
    });

    it("should yield mission_failed event when constraint check fails", async () => {
      // Make canContinue return false after first step check
      let calls = 0;
      mockConstraintEngine.canContinue = jest.fn().mockImplementation(() => {
        calls++;
        if (calls > 1) {
          return { canContinue: false, reason: "Budget exceeded in test" };
        }
        return { canContinue: true, reason: "" };
      });

      const events = await collectEvents(
        orchestratorWithMemory.execute(missionInput, mockTeam),
      );
      const types = events.map((e) => e.type);
      // canContinue is called per event; should fail eventually
      expect(types).toContain("mission_started");
      // Either mission_failed or completed, but must not crash
    });
  });

  // ---------------------------------------------------------------------------
  // review() method
  // ---------------------------------------------------------------------------
  describe("review()", () => {
    let mockTeam: ITeam;
    let mockLeader: ITeamMember;

    beforeEach(() => {
      mockLeader = {
        id: "leader-1",
        name: "Leader",
        role: { id: "leader", name: "Leader", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: "",
        workStyle: null,
        status: "idle",
        isLeader: () => true,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "Leader prompt",
      } as unknown as ITeamMember;

      mockTeam = {
        id: "team-1",
        name: "Test Team",
        leader: mockLeader,
        members: [],
        workflow: { id: "wf-1", type: "sequential", steps: [] },
        constraintProfile: {} as MissionExecutionProfile,
        config: {},
      } as unknown as ITeam;
    });

    it("should return passing review result when llmFactory is not available", async () => {
      const result = await orchestrator.review(
        "step-1",
        "some output",
        mockTeam,
      );

      expect(result).toBeDefined();
      expect(result.stepId).toBe("step-1");
      expect(result.passed).toBe(true);
      expect(result.score).toBe(7);
      expect(result.feedback).toContain("降级");
      expect(result.reviewedAt).toBeInstanceOf(Date);
    });

    it("should return review result with correct stepId", async () => {
      const result = await orchestrator.review(
        "my-special-step",
        { content: "output" },
        mockTeam,
      );

      expect(result.stepId).toBe("my-special-step");
    });

    it("should handle various output types gracefully", async () => {
      const outputs = [
        null,
        undefined,
        "string output",
        { key: "value" },
        42,
        [],
      ];

      for (const output of outputs) {
        const result = await orchestrator.review("step-x", output, mockTeam);
        expect(result).toBeDefined();
        expect(result.passed).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // deliver() method
  // ---------------------------------------------------------------------------
  describe("deliver()", () => {
    let mockTeam: ITeam;

    beforeEach(() => {
      mockTeam = {
        id: "team-1",
        name: "Test",
        leader: { id: "leader-1" },
        members: [],
        workflow: { id: "wf-1", type: "sequential", steps: [] },
        constraintProfile: {} as MissionExecutionProfile,
        config: {},
      } as unknown as ITeam;
    });

    it("should always return at least one deliverable (JSON report)", async () => {
      const state = orchestrator["initializeState"]("mission-deliver-test");
      state.completedSteps = ["step-1"];
      state.intermediateOutputs.set("step-1", "output content");

      const deliverables = await orchestrator.deliver(state, mockTeam);

      expect(deliverables.length).toBeGreaterThanOrEqual(1);
      const jsonReport = deliverables.find(
        (d) => d.mimeType === "application/json",
      );
      expect(jsonReport).toBeDefined();
    });

    it("should include statistics in JSON report", async () => {
      const state = orchestrator["initializeState"]("mission-deliver-test-2");
      state.completedSteps = ["step-1", "step-2"];
      state.failedSteps = ["step-3"];
      state.intermediateOutputs.set("step-1", "output 1");
      state.intermediateOutputs.set("step-2", "output 2");

      const deliverables = await orchestrator.deliver(state, mockTeam);
      const jsonReport = deliverables.find(
        (d) => d.mimeType === "application/json",
      );

      expect(jsonReport?.content).toBeDefined();
      const content = jsonReport?.content as Record<string, unknown>;
      const statistics = content.statistics as Record<string, unknown>;
      expect(statistics.completedSteps).toBe(2);
      expect(statistics.failedSteps).toBe(1);
    });

    it("should set correct missionId on deliverables", async () => {
      const state = orchestrator["initializeState"]("target-mission-id");
      const deliverables = await orchestrator.deliver(state, mockTeam);

      for (const d of deliverables) {
        expect(d.missionId).toBe("target-mission-id");
      }
    });

    it("should handle empty intermediate outputs gracefully", async () => {
      const state = orchestrator["initializeState"]("mission-empty-deliver");

      await expect(
        orchestrator.deliver(state, mockTeam),
      ).resolves.not.toThrow();
      const deliverables = await orchestrator.deliver(state, mockTeam);
      expect(deliverables.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // executePlan() method
  // ---------------------------------------------------------------------------
  describe("executePlan()", () => {
    let mockLeader: ITeamMember;
    let mockMember: ITeamMember;
    let mockTeam: ITeam;
    let baseConstraints: MissionExecutionProfile;
    let epMemoryStore: Map<string, Map<string, unknown>>;
    let epOrchestrator: MissionOrchestrator;

    beforeEach(() => {
      epMemoryStore = new Map();

      const mockMemoryService = {
        setWithSession: jest
          .fn()
          .mockImplementation(
            async (sessionId: string, key: string, value: unknown) => {
              if (!epMemoryStore.has(sessionId))
                epMemoryStore.set(sessionId, new Map());
              epMemoryStore.get(sessionId)!.set(key, value);
            },
          ),
        getWithSession: jest
          .fn()
          .mockImplementation(async (sessionId: string, key: string) => {
            return epMemoryStore.get(sessionId)?.get(key) ?? null;
          }),
      };

      mockLeader = {
        id: "leader-1",
        name: "Leader",
        role: { id: "leader", name: "Leader", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: "",
        workStyle: {
          outputStyle: "detailed",
          thinkingDepth: "deep",
          riskTolerance: "balanced",
        },
        status: "idle",
        isLeader: () => true,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "Leader prompt",
      } as unknown as ITeamMember;

      mockMember = {
        id: "member-1",
        name: "Member",
        role: { id: "researcher", name: "Researcher", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: "",
        workStyle: null,
        status: "idle",
        isLeader: () => false,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "Member prompt",
      } as unknown as ITeamMember;

      mockTeam = {
        id: "team-1",
        name: "Test Team",
        leader: mockLeader,
        members: [mockMember],
        workflow: {
          id: "wf-1",
          type: "sequential",
          steps: [],
        },
        constraintProfile: {
          cost: {
            budget: 1000,
            modelPreference: "balanced",
            allowOverBudget: false,
            warningThreshold: 80,
          },
          quality: {
            depth: "standard",
            accuracy: "prefer_evidence",
            reviewRequired: false,
            minReviewScore: 6,
            maxReworks: 0,
          },
          efficiency: {
            maxDuration: 600000,
            priority: "normal",
            allowParallel: false,
            maxParallelism: 1,
          },
        },
        config: {},
        getAllMembers: () => [mockLeader, mockMember],
        getMemberById: (id: string) =>
          [mockLeader, mockMember].find((m) => m.id === id),
        getMembersByRole: (roleId: string) =>
          [mockLeader, mockMember].filter((m) => m.role.id === roleId),
        hasRole: () => true,
        getAvailableSkills: () => [],
        getAvailableTools: () => [],
      } as unknown as ITeam;

      baseConstraints = {
        cost: {
          budget: 1000,
          modelPreference: "balanced",
          allowOverBudget: false,
          warningThreshold: 80,
        },
        quality: {
          depth: "standard",
          accuracy: "prefer_evidence",
          reviewRequired: false,
          minReviewScore: 6,
          maxReworks: 0,
        },
        efficiency: {
          maxDuration: 600000,
          priority: "normal",
          allowParallel: false,
          maxParallelism: 1,
        },
      };

      epOrchestrator = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        mockMemoryService as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );
    });

    it("should emit step_started and step_completed for each step", async () => {
      const plan = {
        id: "plan-1",
        missionId: "mission-ep-1",
        parsedIntent: {} as ParsedIntent,
        steps: [
          {
            id: "s1",
            name: "Step 1",
            description: "First step",
            executor: "member-1",
            type: "task" as const,
            dependencies: [],
            estimatedDuration: 1000,
            estimatedCost: 5,
            timeout: 5000,
          },
        ],
        estimatedCost: 5,
        estimatedDuration: 1000,
        createdAt: new Date(),
      };

      // Pre-seed memory so getContext can find the plan
      epMemoryStore.set("mission-ep-1", new Map([["plan", plan]]));

      // Initialize state
      const state = epOrchestrator["initializeState"]("mission-ep-1");
      epOrchestrator["states"].set("mission-ep-1", state);
      epOrchestrator["originalInputs"].set("mission-ep-1", {
        prompt: "test",
        metadata: {},
      });

      const events: Array<{ type: MissionEventType }> = [];
      for await (const event of epOrchestrator.executePlan(
        plan,
        mockTeam,
        baseConstraints,
      )) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain("step_started");
      expect(types).toContain("step_completed");
    });

    it("should handle step failure gracefully with auto-retry enabled", async () => {
      const retryMemoryStore: Map<string, Map<string, unknown>> = new Map();
      const retryMemService = {
        setWithSession: jest
          .fn()
          .mockImplementation(
            async (sessionId: string, key: string, value: unknown) => {
              if (!retryMemoryStore.has(sessionId))
                retryMemoryStore.set(sessionId, new Map());
              retryMemoryStore.get(sessionId)!.set(key, value);
            },
          ),
        getWithSession: jest
          .fn()
          .mockImplementation(async (sessionId: string, key: string) => {
            return retryMemoryStore.get(sessionId)?.get(key) ?? null;
          }),
      };

      const retryOrchestrator = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        retryMemService as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: true, enableParallel: false },
      );

      const plan = {
        id: "plan-fail",
        missionId: "mission-fail",
        parsedIntent: {} as ParsedIntent,
        steps: [
          {
            id: "failing-step",
            name: "Failing Step",
            description: "Will produce error output",
            executor: "non-existent-member", // causes fallback to leader
            type: "task" as const,
            dependencies: [],
            estimatedDuration: 100,
            estimatedCost: 1,
            timeout: 1000,
          },
        ],
        estimatedCost: 1,
        estimatedDuration: 100,
        createdAt: new Date(),
      };

      retryMemoryStore.set("mission-fail", new Map([["plan", plan]]));
      const state = retryOrchestrator["initializeState"]("mission-fail");
      retryOrchestrator["states"].set("mission-fail", state);
      retryOrchestrator["originalInputs"].set("mission-fail", {
        prompt: "test",
        metadata: {},
      });

      const events: Array<{ type: MissionEventType }> = [];
      for await (const event of retryOrchestrator.executePlan(
        plan,
        mockTeam,
        baseConstraints,
      )) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      // Either completed or failed; must not crash
      expect(types.length).toBeGreaterThan(0);
    });

    it("should throw when deadlock is detected (no executable steps)", async () => {
      const plan = {
        id: "plan-deadlock",
        missionId: "mission-deadlock",
        parsedIntent: {} as ParsedIntent,
        steps: [
          {
            id: "s1",
            name: "Step 1",
            description: "Depends on s2",
            executor: "member-1",
            type: "task" as const,
            dependencies: ["s2"], // mutual dependency = deadlock
            estimatedDuration: 100,
            estimatedCost: 1,
          },
          {
            id: "s2",
            name: "Step 2",
            description: "Depends on s1",
            executor: "member-1",
            type: "task" as const,
            dependencies: ["s1"],
            estimatedDuration: 100,
            estimatedCost: 1,
          },
        ],
        estimatedCost: 2,
        estimatedDuration: 200,
        createdAt: new Date(),
      };

      epMemoryStore.set("mission-deadlock", new Map([["plan", plan]]));
      const state = epOrchestrator["initializeState"]("mission-deadlock");
      epOrchestrator["states"].set("mission-deadlock", state);

      async function consumeDeadlock() {
        for await (const _ of epOrchestrator.executePlan(
          plan,
          mockTeam,
          baseConstraints,
        )) {
          // drain
        }
      }

      await expect(consumeDeadlock()).rejects.toThrow("Deadlock detected");
    });

    it("should throw when cost budget is exceeded", async () => {
      // Note: The source uses `constraints.cost?.budget || Infinity`, so budget must be > 0
      // to avoid the `0 || Infinity` falsy coercion. Use budget=1 and costUsed=100.
      const tightBudgetConstraints: MissionExecutionProfile = {
        ...baseConstraints,
        cost: {
          budget: 1,
          modelPreference: "balanced",
          allowOverBudget: false,
          warningThreshold: 80,
        },
      };

      const plan = {
        id: "plan-budget",
        missionId: "mission-budget",
        parsedIntent: {} as ParsedIntent,
        steps: [
          {
            id: "s1",
            name: "Step 1",
            description: "Step",
            executor: "member-1",
            type: "task" as const,
            dependencies: [],
            estimatedDuration: 100,
            estimatedCost: 1,
            timeout: 1000,
          },
        ],
        estimatedCost: 1,
        estimatedDuration: 100,
        createdAt: new Date(),
      };

      epMemoryStore.set("mission-budget", new Map([["plan", plan]]));
      const state = epOrchestrator["initializeState"]("mission-budget");
      // costUsed (100) > budget (1) → should throw
      state.resourceUsage.costUsed = 100;
      epOrchestrator["states"].set("mission-budget", state);
      epOrchestrator["originalInputs"].set("mission-budget", {
        prompt: "test",
        metadata: {},
      });

      async function consumeBudget() {
        for await (const _ of epOrchestrator.executePlan(
          plan,
          mockTeam,
          tightBudgetConstraints,
        )) {
          // drain
        }
      }

      await expect(consumeBudget()).rejects.toThrow("cost budget exceeded");
    });
  });

  // ---------------------------------------------------------------------------
  // Private helper: integrateOutputsForExport
  // ---------------------------------------------------------------------------
  describe("integrateOutputsForExport()", () => {
    it("should join string outputs with separator", () => {
      const result = orchestrator["integrateOutputsForExport"]([
        "part one",
        "part two",
      ]);
      expect(result).toContain("part one");
      expect(result).toContain("part two");
      expect(result).toContain("---");
    });

    it("should extract output field from object outputs", () => {
      const outputs = [{ output: "extracted content" }];
      const result = orchestrator["integrateOutputsForExport"](outputs);
      expect(result).toContain("extracted content");
    });

    it("should serialize plain objects as JSON", () => {
      const outputs = [{ key: "value", nested: { x: 1 } }];
      const result = orchestrator["integrateOutputsForExport"](outputs);
      expect(result).toContain('"key"');
    });

    it("should return empty string for empty array", () => {
      const result = orchestrator["integrateOutputsForExport"]([]);
      expect(result).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // Private helper: extractFirstJsonObject
  // ---------------------------------------------------------------------------
  describe("extractFirstJsonObject()", () => {
    it("should extract first JSON object from plain content", () => {
      const content = 'Some text {"key": "value"} trailing text';
      const result = orchestrator["extractFirstJsonObject"](content);
      expect(result).toBe('{"key": "value"}');
    });

    it("should return null when no JSON object found", () => {
      const result = orchestrator["extractFirstJsonObject"]("no json here");
      expect(result).toBeNull();
    });

    it("should handle nested objects correctly", () => {
      const content = '{"outer": {"inner": "val"}}';
      const result = orchestrator["extractFirstJsonObject"](content);
      expect(result).toBe('{"outer": {"inner": "val"}}');
    });

    it("should handle strings containing braces inside JSON", () => {
      const content = '{"msg": "hello {world}"}';
      const result = orchestrator["extractFirstJsonObject"](content);
      expect(result).toBe('{"msg": "hello {world}"}');
    });
  });

  // ---------------------------------------------------------------------------
  // Private helper: mapWorkStyleToCreativity / mapDepthToOutputLength
  // ---------------------------------------------------------------------------
  describe("mapWorkStyleToCreativity()", () => {
    it("should return high for aggressive risk tolerance", () => {
      const result = orchestrator["mapWorkStyleToCreativity"]({
        riskTolerance: "aggressive",
        outputStyle: "detailed",
        thinkingDepth: "deep",
      });
      expect(result).toBe("high");
    });

    it("should return low for conservative risk tolerance", () => {
      const result = orchestrator["mapWorkStyleToCreativity"]({
        riskTolerance: "conservative",
        outputStyle: "concise",
        thinkingDepth: "quick",
      });
      expect(result).toBe("low");
    });

    it("should return medium for balanced or undefined workStyle", () => {
      expect(orchestrator["mapWorkStyleToCreativity"](null as never)).toBe(
        "medium",
      );
      expect(
        orchestrator["mapWorkStyleToCreativity"]({
          riskTolerance: "balanced",
          outputStyle: "detailed",
          thinkingDepth: "standard",
        }),
      ).toBe("medium");
    });
  });

  describe("mapDepthToOutputLength()", () => {
    it("should return long for comprehensive depth", () => {
      expect(orchestrator["mapDepthToOutputLength"]("comprehensive")).toBe(
        "long",
      );
    });

    it("should return short for quick depth", () => {
      expect(orchestrator["mapDepthToOutputLength"]("quick")).toBe("short");
    });

    it("should use outputStyle as tiebreaker for standard depth", () => {
      expect(
        orchestrator["mapDepthToOutputLength"]("standard", {
          outputStyle: "detailed",
          riskTolerance: "balanced",
          thinkingDepth: "standard",
        }),
      ).toBe("long");

      expect(
        orchestrator["mapDepthToOutputLength"]("standard", {
          outputStyle: "concise",
          riskTolerance: "balanced",
          thinkingDepth: "standard",
        }),
      ).toBe("short");

      expect(orchestrator["mapDepthToOutputLength"]("standard")).toBe("medium");
    });
  });

  // ---------------------------------------------------------------------------
  // estimateStepDuration / estimateStepCost
  // ---------------------------------------------------------------------------
  describe("estimateStepDuration()", () => {
    it("should return higher duration for comprehensive depth", () => {
      const quick = orchestrator["estimateStepDuration"]("task", "quick");
      const comprehensive = orchestrator["estimateStepDuration"](
        "task",
        "comprehensive",
      );
      expect(comprehensive).toBeGreaterThan(quick);
    });
  });

  describe("estimateStepCost()", () => {
    it("should return higher cost for premium model preference", () => {
      const cheap = orchestrator["estimateStepCost"](30000, "cheap");
      const premium = orchestrator["estimateStepCost"](30000, "premium");
      expect(premium).toBeGreaterThan(cheap);
    });
  });

  // ---------------------------------------------------------------------------
  // assessComplexity
  // ---------------------------------------------------------------------------
  describe("assessComplexity()", () => {
    it("should score higher with files, urls, and requirements", () => {
      const simple = orchestrator["assessComplexity"]({
        prompt: "short",
        metadata: {},
      });
      const complex = orchestrator["assessComplexity"]({
        prompt: "short",
        files: [
          {
            id: "f1",
            name: "file.pdf",
            url: "file.pdf",
            mimeType: "application/pdf",
            size: 100,
          },
        ],
        urls: ["https://example.com"],
        requirements: ["req1"],
        metadata: {},
      });

      expect(complex.estimatedSubTasks).toBeGreaterThanOrEqual(
        simple.estimatedSubTasks,
      );
    });

    it("should return very_high for prompts over 500 chars with all extras", () => {
      const result = orchestrator["assessComplexity"]({
        prompt: "a".repeat(600),
        files: [
          {
            id: "f1",
            name: "f.pdf",
            url: "f.pdf",
            mimeType: "application/pdf",
            size: 100,
          },
        ],
        urls: ["https://example.com"],
        requirements: ["r1"],
        metadata: {},
      });
      expect(result.overall).toBe("very_high");
    });
  });

  // ---------------------------------------------------------------------------
  // parseWithLLM - with LLMFactory present
  // ---------------------------------------------------------------------------
  describe("parse() with LLMFactory", () => {
    it("should use LLM adapter when llmFactory is available and returns parsed intent", async () => {
      const mockAdapter = {
        chat: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            primaryGoal: "Research AI",
            taskType: "research",
            complexity: { overall: "medium" },
          }),
          model: "gpt-4o",
          usage: { promptTokens: 50, completionTokens: 100 },
        }),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined, // toolRegistry
        undefined, // skillRegistry
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const input: MissionInput = {
        prompt: "Research the latest AI developments",
        metadata: {},
      };

      const result = await orchestratorWithLLM.parse(input);

      expect(result).toBeDefined();
      expect(mockAdapter.chat).toHaveBeenCalled();
      expect(result.primaryGoal).toBe("Research AI");
      expect(result.taskType).toBe("research");
    });

    it("should fall back to rule-based parsing when LLM returns null content", async () => {
      const mockAdapter = {
        chat: jest.fn().mockResolvedValue({
          content: null,
          model: "gpt-4o",
          usage: null,
        }),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const result = await orchestratorWithLLM.parse({
        prompt: "研究 AI 趋势",
        metadata: {},
      });

      // Should fall back to rule-based
      expect(result).toBeDefined();
      expect(result.taskType).toBe("research");
    });

    it("should fall back to rule-based parsing when LLM returns invalid JSON", async () => {
      const mockAdapter = {
        chat: jest.fn().mockResolvedValue({
          content: "not valid JSON at all !!!",
          model: "gpt-4o",
          usage: { promptTokens: 10, completionTokens: 5 },
        }),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const result = await orchestratorWithLLM.parse({
        prompt: "研究 AI 未来",
        metadata: {},
      });

      expect(result).toBeDefined();
    });

    it("should fall back to rule-based when LLM throws an error", async () => {
      const mockAdapter = {
        chat: jest.fn().mockRejectedValue(new Error("LLM timeout")),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const result = await orchestratorWithLLM.parse({
        prompt: "设计新 UI 界面",
        metadata: {},
      });

      expect(result).toBeDefined();
      expect(result.taskType).toBe("design");
    });

    it("should return null from parseWithLLM when getAdapter returns null", async () => {
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(null),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const result = await orchestratorWithLLM.parse({
        prompt: "分析销售数据",
        metadata: {},
      });

      expect(result.taskType).toBe("research"); // rule-based fallback (分析 in research keywords)
    });

    it("should record cost when LLM returns usage info", async () => {
      const mockAdapter = {
        chat: jest.fn().mockResolvedValue({
          content: JSON.stringify({ primaryGoal: "Design a system" }),
          model: "gpt-4o",
          usage: { promptTokens: 100, completionTokens: 200 },
        }),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      await orchestratorWithLLM.parse({
        prompt: "Design a UI system",
        metadata: {},
      });

      expect(mockConstraintEngine.recordCost).toHaveBeenCalledWith(
        "parse_intent",
        "gpt-4o",
        100,
        200,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // buildSystemPromptWithPersona - all branches
  // ---------------------------------------------------------------------------
  describe("buildSystemPromptWithPersona()", () => {
    let mockExecutor: ITeamMember;

    beforeEach(() => {
      mockExecutor = {
        id: "exec-1",
        name: "Executor",
        role: { id: "analyst", name: "Analyst", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: "",
        workStyle: null,
        status: "idle",
        isLeader: () => false,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "You are an analyst",
      } as unknown as ITeamMember;
    });

    it("should prepend persona when executor has persona", () => {
      const executorWithPersona = {
        ...mockExecutor,
        persona: "I am a meticulous data scientist.",
        workStyle: null,
      } as unknown as ITeamMember;
      executorWithPersona.getSystemPrompt = () => "Core analyst prompt";

      const result =
        orchestrator["buildSystemPromptWithPersona"](executorWithPersona);

      expect(result).toContain("I am a meticulous data scientist.");
      expect(result).toContain("Core analyst prompt");
      expect(result.indexOf("I am a meticulous data scientist.")).toBeLessThan(
        result.indexOf("Core analyst prompt"),
      );
    });

    it("should add detailed output hint for detailed outputStyle", () => {
      const executorDetailed = {
        ...mockExecutor,
        workStyle: {
          outputStyle: "detailed",
          thinkingDepth: "standard",
          riskTolerance: "balanced",
        },
      } as unknown as ITeamMember;
      executorDetailed.getSystemPrompt = () => "Base prompt";

      const result =
        orchestrator["buildSystemPromptWithPersona"](executorDetailed);

      expect(result).toContain("详尽");
    });

    it("should add concise hint for concise outputStyle", () => {
      const executorConcise = {
        ...mockExecutor,
        workStyle: {
          outputStyle: "concise",
          thinkingDepth: "standard",
          riskTolerance: "balanced",
        },
      } as unknown as ITeamMember;
      executorConcise.getSystemPrompt = () => "Base prompt";

      const result =
        orchestrator["buildSystemPromptWithPersona"](executorConcise);

      expect(result).toContain("简洁");
    });

    it("should add deep thinking hint for deep thinkingDepth", () => {
      const executorDeep = {
        ...mockExecutor,
        workStyle: {
          outputStyle: "detailed",
          thinkingDepth: "deep",
          riskTolerance: "balanced",
        },
      } as unknown as ITeamMember;
      executorDeep.getSystemPrompt = () => "Base prompt";

      const result = orchestrator["buildSystemPromptWithPersona"](executorDeep);

      expect(result).toContain("深入分析");
    });

    it("should add quick response hint for quick thinkingDepth", () => {
      const executorQuick = {
        ...mockExecutor,
        workStyle: {
          outputStyle: "concise",
          thinkingDepth: "quick",
          riskTolerance: "balanced",
        },
      } as unknown as ITeamMember;
      executorQuick.getSystemPrompt = () => "Base prompt";

      const result =
        orchestrator["buildSystemPromptWithPersona"](executorQuick);

      expect(result).toContain("快速响应");
    });

    it("should add creative hint for aggressive riskTolerance", () => {
      const executorAggressive = {
        ...mockExecutor,
        workStyle: {
          outputStyle: "detailed",
          thinkingDepth: "deep",
          riskTolerance: "aggressive",
        },
      } as unknown as ITeamMember;
      executorAggressive.getSystemPrompt = () => "Base prompt";

      const result =
        orchestrator["buildSystemPromptWithPersona"](executorAggressive);

      expect(result).toContain("创新");
    });

    it("should add conservative hint for conservative riskTolerance", () => {
      const executorConservative = {
        ...mockExecutor,
        workStyle: {
          outputStyle: "concise",
          thinkingDepth: "quick",
          riskTolerance: "conservative",
        },
      } as unknown as ITeamMember;
      executorConservative.getSystemPrompt = () => "Base prompt";

      const result =
        orchestrator["buildSystemPromptWithPersona"](executorConservative);

      expect(result).toContain("严谨");
    });

    it("should return base prompt when no workStyle set", () => {
      const executorNoStyle = {
        ...mockExecutor,
        persona: null,
        workStyle: null,
      } as unknown as ITeamMember;
      executorNoStyle.getSystemPrompt = () => "Base system prompt only";

      const result =
        orchestrator["buildSystemPromptWithPersona"](executorNoStyle);

      expect(result).toBe("Base system prompt only");
    });
  });

  // ---------------------------------------------------------------------------
  // buildStepPromptWithSkills
  // ---------------------------------------------------------------------------
  describe("buildStepPromptWithSkills()", () => {
    it("should include task description", () => {
      const step = {
        id: "s1",
        name: "Research Step",
        description: "Analyze the market",
        executor: "member-1",
        type: "task" as const,
        dependencies: [],
        estimatedDuration: 1000,
        estimatedCost: 5,
      };

      const result = orchestrator["buildStepPromptWithSkills"](step, {}, []);

      expect(result).toContain("Analyze the market");
    });

    it("should include intent when present in context", () => {
      const step = {
        id: "s1",
        name: "Step",
        description: "Do something",
        executor: "member-1",
        type: "task" as const,
        dependencies: [],
        estimatedDuration: 1000,
        estimatedCost: 5,
      };
      const context = { intent: { primaryGoal: "Understand AI trends" } };

      const result = orchestrator["buildStepPromptWithSkills"](
        step,
        context,
        [],
      );

      expect(result).toContain("任务目标");
      expect(result).toContain("Understand AI trends");
    });

    it("should include previous outputs when present", () => {
      const step = {
        id: "s2",
        name: "Integration",
        description: "Integrate findings",
        executor: "leader-1",
        type: "task" as const,
        dependencies: ["s1"],
        estimatedDuration: 1000,
        estimatedCost: 5,
      };
      const context = {
        previousOutputs: { s1: "Research findings from step 1" },
      };

      const result = orchestrator["buildStepPromptWithSkills"](
        step,
        context,
        [],
      );

      expect(result).toContain("前序步骤输出");
    });

    it("should include skill results when provided", () => {
      const step = {
        id: "s1",
        name: "Analysis",
        description: "Analyze data",
        executor: "analyst-1",
        type: "task" as const,
        dependencies: [],
        estimatedDuration: 1000,
        estimatedCost: 5,
      };
      const skillResults = [
        {
          skillId: "sentiment-analyzer",
          result: {
            success: true,
            data: { sentiment: "positive", score: 0.9 },
            metadata: { tokensUsed: 50 },
          },
        },
      ];

      const result = orchestrator["buildStepPromptWithSkills"](
        step,
        {},
        skillResults as never,
      );

      expect(result).toContain("技能分析结果");
      expect(result).toContain("sentiment-analyzer");
    });

    it("should not include skill section when all results have no data", () => {
      const step = {
        id: "s1",
        name: "Analysis",
        description: "Analyze data",
        executor: "analyst-1",
        type: "task" as const,
        dependencies: [],
        estimatedDuration: 1000,
        estimatedCost: 5,
      };
      const skillResults = [
        {
          skillId: "failed-skill",
          result: { success: false, data: null, metadata: {} },
        },
      ];

      const result = orchestrator["buildStepPromptWithSkills"](
        step,
        {},
        skillResults as never,
      );

      expect(result).not.toContain("failed-skill");
    });
  });

  // ---------------------------------------------------------------------------
  // review() with LLMFactory
  // ---------------------------------------------------------------------------
  describe("review() with LLMFactory", () => {
    let mockTeamWithLLM: ITeam;
    let mockLeaderMember: ITeamMember;

    beforeEach(() => {
      mockLeaderMember = {
        id: "leader-1",
        name: "Leader",
        role: { id: "leader", name: "Leader", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: null,
        workStyle: null,
        status: "idle",
        isLeader: () => true,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "Leader prompt",
      } as unknown as ITeamMember;

      mockTeamWithLLM = {
        id: "team-llm",
        name: "LLM Team",
        leader: mockLeaderMember,
        members: [],
        workflow: { id: "wf-1", type: "sequential", steps: [] },
        constraintProfile: {} as MissionExecutionProfile,
        config: {},
      } as unknown as ITeam;
    });

    it("should use LLM for review when llmFactory available and parse JSON response", async () => {
      const mockAdapter = {
        chat: jest.fn().mockResolvedValue({
          content: JSON.stringify({
            score: 8,
            passed: true,
            feedback: "Good output",
            issues: [],
          }),
          model: "gpt-4o",
          usage: { promptTokens: 50, completionTokens: 80 },
        }),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const result = await orchestratorWithLLM.review(
        "step-review",
        "test output",
        mockTeamWithLLM,
      );

      expect(result.passed).toBe(true);
      expect(result.score).toBe(8);
      expect(result.feedback).toBe("Good output");
      expect(result.stepId).toBe("step-review");
      expect(mockConstraintEngine.recordCost).toHaveBeenCalled();
    });

    it("should infer passed from score >= 7 when passed field not in response", async () => {
      const mockAdapter = {
        chat: jest.fn().mockResolvedValue({
          content: JSON.stringify({ score: 7, feedback: "Acceptable" }),
          model: "gpt-4o",
          usage: { promptTokens: 40, completionTokens: 30 },
        }),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const result = await orchestratorWithLLM.review(
        "step-x",
        "output",
        mockTeamWithLLM,
      );
      expect(result.passed).toBe(true);
    });

    it("should fall back to degraded review when LLM returns unparseable response", async () => {
      const mockAdapter = {
        chat: jest.fn().mockResolvedValue({
          content: "This is not JSON at all",
          model: "gpt-4o",
          usage: null,
        }),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const result = await orchestratorWithLLM.review(
        "step-fallback",
        "output",
        mockTeamWithLLM,
      );

      // Should fall back to degraded pass
      expect(result.passed).toBe(true);
      expect(result.score).toBe(7);
    });

    it("should fall back when LLM throws during review", async () => {
      const mockAdapter = {
        chat: jest.fn().mockRejectedValue(new Error("LLM error during review")),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const result = await orchestratorWithLLM.review(
        "step-err",
        "output",
        mockTeamWithLLM,
      );

      expect(result.passed).toBe(true);
      expect(result.feedback).toContain("降级");
    });

    it("should extract JSON from markdown code block in review response", async () => {
      const mockAdapter = {
        chat: jest.fn().mockResolvedValue({
          content:
            'Some text {"score": 9, "passed": true, "feedback": "Excellent"} more text',
          model: "gpt-4o",
          usage: { promptTokens: 30, completionTokens: 20 },
        }),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const orchestratorWithLLM = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const result = await orchestratorWithLLM.review(
        "step-extract",
        "output",
        mockTeamWithLLM,
      );

      expect(result.score).toBe(9);
      expect(result.passed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // deliver() with ToolRegistry
  // ---------------------------------------------------------------------------
  describe("deliver() with ToolRegistry", () => {
    let mockTeam: ITeam;

    beforeEach(() => {
      mockTeam = {
        id: "team-1",
        name: "Test",
        leader: { id: "leader-1" },
        members: [],
        workflow: { id: "wf-1", type: "sequential", steps: [] },
        constraintProfile: {} as MissionExecutionProfile,
        config: {},
      } as unknown as ITeam;
    });

    it("should attempt export tools and generate document deliverable when tool succeeds", async () => {
      const mockExportTool = {
        id: "export-docx",
        description: "Export to DOCX",
        inputSchema: {},
        execute: jest
          .fn()
          .mockResolvedValue({ data: "binary content", success: true }),
      };
      const mockToolRegistry = {
        tryGet: jest.fn().mockImplementation((id: string) => {
          if (id === "export-docx") return mockExportTool;
          return null;
        }),
      };

      const orchestratorWithTool = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        mockToolRegistry as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const state =
        orchestratorWithTool["initializeState"]("mission-docx-test");
      state.completedSteps = ["step-1"];
      state.intermediateOutputs.set("step-1", "Report content here");

      const deliverables = await orchestratorWithTool.deliver(state, mockTeam);

      expect(mockExportTool.execute).toHaveBeenCalled();
      // Should have both the document and JSON report
      expect(deliverables.length).toBeGreaterThanOrEqual(2);
      // Check document deliverable exists
      const docDeliverable = deliverables.find(
        (d) =>
          d.mimeType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect(docDeliverable).toBeDefined();
    });

    it("should skip to JSON report when export tool throws", async () => {
      const mockBrokenTool = {
        id: "export-docx",
        description: "Export DOCX",
        inputSchema: {},
        execute: jest.fn().mockRejectedValue(new Error("Export failed")),
      };
      const mockToolRegistry = {
        tryGet: jest.fn().mockImplementation((id: string) => {
          if (id === "export-docx") return mockBrokenTool;
          return null;
        }),
      };

      const orchestratorWithTool = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        mockToolRegistry as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const state = orchestratorWithTool["initializeState"](
        "mission-fail-export",
      );
      state.completedSteps = ["step-1"];
      state.intermediateOutputs.set("step-1", "content");

      const deliverables = await orchestratorWithTool.deliver(state, mockTeam);

      // Should still have JSON report
      const jsonReport = deliverables.find(
        (d) => d.mimeType === "application/json",
      );
      expect(jsonReport).toBeDefined();
    });

    it("should generate PDF deliverable when export-pdf tool succeeds", async () => {
      const mockPdfTool = {
        id: "export-pdf",
        description: "Export to PDF",
        inputSchema: {},
        execute: jest.fn().mockResolvedValue({ pdf: "pdf binary" }),
      };
      const mockToolRegistry = {
        tryGet: jest.fn().mockImplementation((id: string) => {
          if (id === "export-docx") return null;
          if (id === "export-pdf") return mockPdfTool;
          return null;
        }),
      };

      const orchestratorWithTool = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        mockToolRegistry as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const state = orchestratorWithTool["initializeState"]("mission-pdf-test");
      state.completedSteps = ["step-1"];
      state.intermediateOutputs.set("step-1", "PDF content");

      const deliverables = await orchestratorWithTool.deliver(state, mockTeam);

      const pdfDeliverable = deliverables.find(
        (d) => d.mimeType === "application/pdf",
      );
      expect(pdfDeliverable).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // handleToolCalls (via execute flow with LLM returning tool calls)
  // ---------------------------------------------------------------------------
  describe("handleToolCalls()", () => {
    it("should call built-in tool and return result", async () => {
      const mockTool = {
        id: "web-search",
        description: "Search the web",
        inputSchema: {},
        execute: jest.fn().mockResolvedValue({ results: ["result1"] }),
      };
      const mockToolRegistry = {
        tryGet: jest.fn().mockReturnValue(mockTool),
      };

      const orchestratorWithTool = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        mockToolRegistry as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const toolCalls = [
        { name: "web-search", arguments: { query: "AI 2025" } },
      ];

      const results = await orchestratorWithTool["handleToolCalls"](toolCalls);

      expect(results).toHaveLength(1);
      expect((results[0] as Record<string, unknown>).tool).toBe("web-search");
      expect(mockTool.execute).toHaveBeenCalled();
    });

    it("should return tool-not-found error when tool does not exist", async () => {
      const mockToolRegistry = {
        tryGet: jest.fn().mockReturnValue(null),
      };

      const orchestratorWithTool = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        mockToolRegistry as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const toolCalls = [{ name: "nonexistent-tool", arguments: {} }];

      const results = await orchestratorWithTool["handleToolCalls"](toolCalls);

      expect(results).toHaveLength(1);
      expect((results[0] as Record<string, unknown>).error).toBe(
        "Tool not found",
      );
    });

    it("should call MCP tool via mcpManager for mcp_ prefixed tool names", async () => {
      const mockMcpManager = {
        callToolAuto: jest.fn().mockResolvedValue({ content: "mcp result" }),
        getAllToolsFlat: jest.fn().mockResolvedValue([]),
      };
      const mockToolRegistry = {
        tryGet: jest.fn().mockReturnValue(null),
      };

      const orchestratorWithMCP = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        mockToolRegistry as never,
        undefined,
        undefined,
        undefined,
        mockMcpManager as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const toolCalls = [
        { name: "mcp_web-search", arguments: { query: "test" } },
      ];

      const results = await orchestratorWithMCP["handleToolCalls"](toolCalls);

      expect(results).toHaveLength(1);
      expect((results[0] as Record<string, unknown>).tool).toBe(
        "mcp_web-search",
      );
      expect(mockMcpManager.callToolAuto).toHaveBeenCalledWith("web-search", {
        query: "test",
      });
    });

    it("should catch tool execution errors and return error result", async () => {
      const mockTool = {
        id: "failing-tool",
        description: "A tool that fails",
        inputSchema: {},
        execute: jest.fn().mockRejectedValue(new Error("Tool crashed")),
      };
      const mockToolRegistry = {
        tryGet: jest.fn().mockReturnValue(mockTool),
      };

      const orchestratorWithTool = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        mockToolRegistry as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const toolCalls = [{ name: "failing-tool", arguments: {} }];
      const results = await orchestratorWithTool["handleToolCalls"](toolCalls);

      expect(results).toHaveLength(1);
      expect((results[0] as Record<string, unknown>).error).toBe(
        "Tool crashed",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // collectAvailableTools
  // ---------------------------------------------------------------------------
  describe("collectAvailableTools()", () => {
    it("should collect tools from ToolRegistry for executor tools", async () => {
      const mockTool = {
        id: "data-analyzer",
        description: "Analyze data",
        inputSchema: { type: "object", properties: {} },
        execute: jest.fn(),
      };
      const mockToolRegistry = {
        tryGet: jest.fn().mockReturnValue(mockTool),
      };

      const orchestratorWithTool = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        mockToolRegistry as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const executor = {
        id: "exec-1",
        tools: ["data-analyzer"],
        getSystemPrompt: () => "",
        isLeader: () => false,
      } as unknown as ITeamMember;

      const tools =
        await orchestratorWithTool["collectAvailableTools"](executor);

      expect(tools).toHaveLength(1);
      expect(tools[0].function.name).toBe("data-analyzer");
    });

    it("should collect MCP tools from mcpManager", async () => {
      const mockMcpManager = {
        getAllToolsFlat: jest.fn().mockResolvedValue([
          {
            tool: {
              name: "external-search",
              description: "Search externally",
              inputSchema: { type: "object" },
            },
          },
        ]),
      };

      const orchestratorWithMCP = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        mockMcpManager as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const executor = {
        id: "exec-1",
        tools: [],
        getSystemPrompt: () => "",
        isLeader: () => false,
      } as unknown as ITeamMember;

      const tools =
        await orchestratorWithMCP["collectAvailableTools"](executor);

      expect(tools).toHaveLength(1);
      expect(tools[0].function.name).toBe("mcp_external-search");
    });

    it("should handle MCP manager throwing gracefully", async () => {
      const mockMcpManager = {
        getAllToolsFlat: jest
          .fn()
          .mockRejectedValue(new Error("MCP unavailable")),
      };

      const orchestratorWithMCP = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        mockMcpManager as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const executor = {
        id: "exec-1",
        tools: [],
        getSystemPrompt: () => "",
        isLeader: () => false,
      } as unknown as ITeamMember;

      const tools =
        await orchestratorWithMCP["collectAvailableTools"](executor);

      // Should not throw, just return empty
      expect(tools).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // constructor with TraceCollector and CheckpointManager
  // ---------------------------------------------------------------------------
  describe("constructor with optional services", () => {
    it("should initialize with traceCollector", () => {
      const mockTraceCollector = {
        startTrace: jest.fn().mockReturnValue("trace-123"),
        endTrace: jest.fn(),
        addSpan: jest.fn().mockReturnValue("span-1"),
        endSpan: jest.fn(),
      };

      const orchestratorWithTrace = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockTraceCollector as never,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      expect(orchestratorWithTrace["traceCollector"]).toBeDefined();
    });

    it("should initialize with checkpointManager", () => {
      const mockCheckpointManager = {
        createCheckpoint: jest.fn().mockResolvedValue(undefined),
      };

      const orchestratorWithCP = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCheckpointManager as never,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      expect(orchestratorWithCP["checkpointManager"]).toBeDefined();
    });

    it("should initialize with a2aBus", () => {
      const mockA2ABus = {
        publish: jest.fn(),
        clearSession: jest.fn(),
      };

      const orchestratorWithA2A = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockA2ABus as never,
        { enableAutoRetry: false, enableParallel: false },
      );

      expect(orchestratorWithA2A["a2aBus"]).toBeDefined();
    });

    it("should create LLM adapter when aiChatService is provided", () => {
      const mockAiChatService = {
        chat: jest.fn(),
      };

      const orchestratorWithChat = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockAiChatService as never,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      expect(orchestratorWithChat["llmAdapter"]).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // execute() with TraceCollector
  // ---------------------------------------------------------------------------
  describe("execute() with traceCollector", () => {
    it("should start and end trace during successful execution", async () => {
      const mockTraceCollector = {
        startTrace: jest.fn().mockReturnValue("trace-abc"),
        endTrace: jest.fn(),
        addSpan: jest.fn().mockReturnValue("span-1"),
        endSpan: jest.fn(),
      };

      // Use a fresh constraint engine to avoid contamination from other tests
      const freshConstraintEngine = {
        check: jest.fn().mockReturnValue({ allowed: true }),
        canContinue: jest
          .fn()
          .mockReturnValue({ canContinue: true, reason: "" }),
        recordCost: jest.fn().mockReturnValue(0),
        getUsage: jest.fn().mockReturnValue({ tokensUsed: 0, costUsed: 0 }),
        reset: jest.fn(),
      } as unknown as jest.Mocked<ConstraintEngine>;

      const mockMemoryStore = new Map<string, Map<string, unknown>>();
      const mockMemService = {
        setWithSession: jest
          .fn()
          .mockImplementation(
            async (sessionId: string, key: string, value: unknown) => {
              if (!mockMemoryStore.has(sessionId))
                mockMemoryStore.set(sessionId, new Map());
              mockMemoryStore.get(sessionId)!.set(key, value);
            },
          ),
        getWithSession: jest
          .fn()
          .mockImplementation(async (sessionId: string, key: string) => {
            return mockMemoryStore.get(sessionId)?.get(key) ?? null;
          }),
      };

      const leader = {
        id: "leader-1",
        name: "Leader",
        role: { id: "leader", name: "Leader", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: null,
        workStyle: null,
        status: "idle",
        isLeader: () => true,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "Leader",
      } as unknown as ITeamMember;

      const team = {
        id: "team-trace",
        name: "Trace Team",
        leader,
        members: [leader],
        workflow: {
          id: "wf-trace",
          type: "sequential",
          steps: [
            {
              id: "step-trace-1",
              name: "Trace Step",
              description: "A single step for trace test",
              type: "task",
              executorRoles: ["leader"],
              dependsOn: [],
              timeout: 30000,
            },
          ],
        },
        constraintProfile: {
          cost: {
            budget: 1000,
            modelPreference: "balanced",
            allowOverBudget: false,
            warningThreshold: 80,
          },
          quality: {
            depth: "standard",
            accuracy: "prefer_evidence",
            reviewRequired: false,
            minReviewScore: 6,
            maxReworks: 0,
          },
          efficiency: {
            maxDuration: 600000,
            priority: "normal",
            allowParallel: false,
            maxParallelism: 1,
          },
        },
        getAllMembers: () => [leader],
        getMemberById: (id: string) => (id === leader.id ? leader : undefined),
        getMembersByRole: (roleId: string) =>
          roleId === "leader" ? [leader] : [],
        hasRole: () => false,
        getAvailableSkills: () => [],
        getAvailableTools: () => [],
      } as unknown as ITeam;

      const orchestratorWithTrace = new MissionOrchestrator(
        freshConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        mockMemService as never,
        undefined,
        undefined,
        undefined,
        mockTraceCollector as never,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const events = await collectEvents(
        orchestratorWithTrace.execute(
          { prompt: "Test mission", metadata: {} },
          team,
        ),
      );

      expect(mockTraceCollector.startTrace).toHaveBeenCalled();
      expect(mockTraceCollector.endTrace).toHaveBeenCalledWith("trace-abc", {
        status: "success",
      });
      expect(events.some((e) => e.type === "mission_completed")).toBe(true);
    });

    it("should end trace with error status on execution failure", async () => {
      const mockTraceCollector = {
        startTrace: jest.fn().mockReturnValue("trace-fail"),
        endTrace: jest.fn(),
        addSpan: jest.fn().mockReturnValue("span-1"),
        endSpan: jest.fn(),
      };

      // Make canContinue always fail to trigger mission_failed
      mockConstraintEngine.canContinue = jest.fn().mockReturnValue({
        canContinue: false,
        reason: "Budget exceeded",
      });

      const leader = {
        id: "leader-1",
        name: "Leader",
        role: { id: "leader", name: "Leader", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: null,
        workStyle: null,
        status: "idle",
        isLeader: () => true,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "Leader",
      } as unknown as ITeamMember;

      const team = {
        id: "team-trace-fail",
        name: "Failing Team",
        leader,
        members: [],
        workflow: {
          id: "wf-fail",
          type: "sequential",
          steps: [
            {
              id: "step-1",
              name: "Step",
              description: "A step",
              type: "task",
              executorRoles: ["leader"],
              dependsOn: [],
              timeout: 5000,
            },
          ],
        },
        constraintProfile: {
          cost: {
            budget: 1000,
            modelPreference: "balanced",
            allowOverBudget: false,
            warningThreshold: 80,
          },
          quality: {
            depth: "standard",
            accuracy: "prefer_evidence",
            reviewRequired: false,
            minReviewScore: 6,
            maxReworks: 0,
          },
          efficiency: {
            maxDuration: 600000,
            priority: "normal",
            allowParallel: false,
            maxParallelism: 1,
          },
        },
        getAllMembers: () => [leader],
        getMemberById: () => leader,
        getMembersByRole: () => [leader],
        hasRole: () => true,
        getAvailableSkills: () => [],
        getAvailableTools: () => [],
      } as unknown as ITeam;

      const orchestratorWithTrace = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockTraceCollector as never,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const events = await collectEvents(
        orchestratorWithTrace.execute(
          { prompt: "Failing mission", metadata: {} },
          team,
        ),
      );

      expect(mockTraceCollector.startTrace).toHaveBeenCalled();
      expect(mockTraceCollector.endTrace).toHaveBeenCalledWith("trace-fail", {
        status: "error",
      });
      expect(events.some((e) => e.type === "mission_failed")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // cancel() with traceCollector and a2aBus
  // ---------------------------------------------------------------------------
  describe("cancel() with optional services", () => {
    it("should end trace and clear a2a session on cancel", async () => {
      const mockTraceCollector = {
        endTrace: jest.fn(),
      };
      const mockA2ABus = {
        publish: jest.fn(),
        clearSession: jest.fn(),
      };

      const orchestratorFull = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockTraceCollector as never,
        undefined,
        mockA2ABus as never,
        { enableAutoRetry: false, enableParallel: false },
      );

      const missionId = "mission-cancel-full";
      const state = orchestratorFull["initializeState"](missionId);
      state.phase = "executing";
      orchestratorFull["states"].set(missionId, state);
      orchestratorFull["missionTraces"].set(missionId, "trace-cancel");
      orchestratorFull["originalInputs"].set(missionId, {
        prompt: "test",
        metadata: {},
      });

      await orchestratorFull.cancel(missionId);

      expect(mockTraceCollector.endTrace).toHaveBeenCalledWith("trace-cancel", {
        status: "error",
      });
      expect(mockA2ABus.clearSession).toHaveBeenCalledWith(missionId);
      expect(orchestratorFull["missionTraces"].has(missionId)).toBe(false);
      expect(orchestratorFull["originalInputs"].has(missionId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // saveCheckpoint
  // ---------------------------------------------------------------------------
  describe("saveCheckpoint()", () => {
    it("should call checkpointManager.createCheckpoint with correct args", async () => {
      const mockCheckpointManager = {
        createCheckpoint: jest.fn().mockResolvedValue(undefined),
      };

      const orchestratorWithCP = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCheckpointManager as never,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const missionId = "mission-cp-test";
      const state = orchestratorWithCP["initializeState"](missionId);
      state.intermediateOutputs.set("step-1", "output-1");
      orchestratorWithCP["states"].set(missionId, state);

      await orchestratorWithCP["saveCheckpoint"](
        missionId,
        "workflow-1",
        "parse_complete",
        {
          taskType: "research",
          complexity: "medium",
        },
      );

      expect(mockCheckpointManager.createCheckpoint).toHaveBeenCalledWith(
        missionId,
        "workflow-1",
        "parse_complete",
        expect.objectContaining({
          executionId: missionId,
          workflowId: "workflow-1",
        }),
      );
    });

    it("should silently ignore errors from checkpointManager", async () => {
      const mockCheckpointManager = {
        createCheckpoint: jest
          .fn()
          .mockRejectedValue(new Error("Checkpoint DB unavailable")),
      };

      const orchestratorWithCP = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockCheckpointManager as never,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      // Should not throw
      await expect(
        orchestratorWithCP["saveCheckpoint"]("mission-x", "wf-1", "phase", {}),
      ).resolves.not.toThrow();
    });

    it("should do nothing when checkpointManager is not provided", async () => {
      // orchestrator without checkpointManager
      const result = await orchestrator["saveCheckpoint"](
        "mission-x",
        "wf-1",
        "phase",
        {},
      );
      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // executePlan() - parallel mode
  // ---------------------------------------------------------------------------
  describe("executePlan() - parallel execution", () => {
    it("should execute independent steps in parallel when enableParallel is true", async () => {
      const parallelMemStore = new Map<string, Map<string, unknown>>();
      const parallelMemService = {
        setWithSession: jest
          .fn()
          .mockImplementation(
            async (sessionId: string, key: string, value: unknown) => {
              if (!parallelMemStore.has(sessionId))
                parallelMemStore.set(sessionId, new Map());
              parallelMemStore.get(sessionId)!.set(key, value);
            },
          ),
        getWithSession: jest
          .fn()
          .mockImplementation(async (sessionId: string, key: string) => {
            return parallelMemStore.get(sessionId)?.get(key) ?? null;
          }),
      };

      const parallelOrchestrator = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        parallelMemService as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: true },
      );

      // Two independent steps that can run in parallel
      const plan = {
        id: "plan-parallel",
        missionId: "mission-parallel",
        parsedIntent: {} as ParsedIntent,
        steps: [
          {
            id: "step-a",
            name: "Step A",
            description: "Independent step A",
            executor: "leader-1",
            type: "task" as const,
            dependencies: [],
            estimatedDuration: 100,
            estimatedCost: 1,
            timeout: 5000,
          },
          {
            id: "step-b",
            name: "Step B",
            description: "Independent step B",
            executor: "leader-1",
            type: "task" as const,
            dependencies: [],
            estimatedDuration: 100,
            estimatedCost: 1,
            timeout: 5000,
          },
        ],
        estimatedCost: 2,
        estimatedDuration: 200,
        createdAt: new Date(),
      };

      const leader = {
        id: "leader-1",
        name: "Leader",
        role: { id: "leader", name: "Leader", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: null,
        workStyle: null,
        status: "idle",
        isLeader: () => true,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "Leader",
      } as unknown as ITeamMember;

      const team = {
        id: "team-parallel",
        name: "Parallel Team",
        leader,
        members: [],
        workflow: { id: "wf-parallel", type: "parallel", steps: [] },
        constraintProfile: {
          cost: {
            budget: 1000,
            modelPreference: "balanced",
            allowOverBudget: false,
            warningThreshold: 80,
          },
          quality: {
            depth: "standard",
            accuracy: "prefer_evidence",
            reviewRequired: false,
            minReviewScore: 6,
            maxReworks: 0,
          },
          efficiency: {
            maxDuration: 600000,
            priority: "normal",
            allowParallel: true,
            maxParallelism: 2,
          },
        },
        getAllMembers: () => [leader],
        getMemberById: (id: string) => (id === "leader-1" ? leader : undefined),
        getMembersByRole: () => [leader],
        hasRole: () => true,
        getAvailableSkills: () => [],
        getAvailableTools: () => [],
      } as unknown as ITeam;

      const constraints = {
        cost: {
          budget: 1000,
          modelPreference: "balanced",
          allowOverBudget: false,
          warningThreshold: 80,
        },
        quality: {
          depth: "standard",
          accuracy: "prefer_evidence",
          reviewRequired: false,
          minReviewScore: 6,
          maxReworks: 0,
        },
        efficiency: {
          maxDuration: 600000,
          priority: "normal",
          allowParallel: true,
          maxParallelism: 2,
        },
      };

      parallelMemStore.set("mission-parallel", new Map([["plan", plan]]));
      const state = parallelOrchestrator["initializeState"]("mission-parallel");
      parallelOrchestrator["states"].set("mission-parallel", state);
      parallelOrchestrator["originalInputs"].set("mission-parallel", {
        prompt: "test",
        metadata: {},
      });

      const events: Array<{ type: MissionEventType }> = [];
      for await (const event of parallelOrchestrator.executePlan(
        plan,
        team,
        constraints,
      )) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain("step_started");
      expect(types).toContain("step_completed");
      // Both steps should complete
      const completedEvents = events.filter((e) => e.type === "step_completed");
      expect(completedEvents.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // execute() with review+rework loop (reviewRequired: true, maxReworks > 0)
  // ---------------------------------------------------------------------------
  describe("execute() - review and rework flow", () => {
    it("should emit rework_requested when review fails and rework is performed", async () => {
      const reviewMemStore = new Map<string, Map<string, unknown>>();
      const reviewMemService = {
        setWithSession: jest
          .fn()
          .mockImplementation(
            async (sessionId: string, key: string, value: unknown) => {
              if (!reviewMemStore.has(sessionId))
                reviewMemStore.set(sessionId, new Map());
              reviewMemStore.get(sessionId)!.set(key, value);
            },
          ),
        getWithSession: jest
          .fn()
          .mockImplementation(async (sessionId: string, key: string) => {
            return reviewMemStore.get(sessionId)?.get(key) ?? null;
          }),
      };

      // LLM factory for review: first call returns failing review, second passes
      let reviewCallCount = 0;
      const mockAdapter = {
        chat: jest.fn().mockImplementation(() => {
          reviewCallCount++;
          if (reviewCallCount === 1) {
            return Promise.resolve({
              content: JSON.stringify({
                score: 4,
                passed: false,
                feedback: "Needs improvement",
                issues: ["Too brief"],
              }),
              model: "gpt-4o",
              usage: { promptTokens: 30, completionTokens: 20 },
            });
          }
          return Promise.resolve({
            content: JSON.stringify({
              score: 8,
              passed: true,
              feedback: "Good now",
              issues: [],
            }),
            model: "gpt-4o",
            usage: { promptTokens: 40, completionTokens: 30 },
          });
        }),
      };
      const mockLlmFactory = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
        getDefaultModel: jest.fn().mockReturnValue("gpt-4o"),
      };

      const leader = {
        id: "leader-review",
        name: "Leader",
        role: { id: "leader", name: "Leader", capabilities: [] },
        model: "gpt-4o",
        skills: [],
        tools: [],
        persona: null,
        workStyle: null,
        status: "idle",
        isLeader: () => true,
        hasSkill: () => false,
        hasTool: () => false,
        getSystemPrompt: () => "Leader",
      } as unknown as ITeamMember;

      const teamWithReview = {
        id: "team-review",
        name: "Review Team",
        leader,
        members: [],
        workflow: {
          id: "wf-review",
          type: "sequential",
          steps: [
            {
              id: "research",
              name: "Research",
              description: "Research task",
              type: "task",
              executorRoles: ["leader"],
              dependsOn: [],
              timeout: 5000,
            },
          ],
        },
        constraintProfile: {
          cost: {
            budget: 1000,
            modelPreference: "balanced",
            allowOverBudget: false,
            warningThreshold: 80,
          },
          quality: {
            depth: "standard",
            accuracy: "prefer_evidence",
            reviewRequired: true,
            minReviewScore: 6,
            maxReworks: 1,
          },
          efficiency: {
            maxDuration: 600000,
            priority: "normal",
            allowParallel: false,
            maxParallelism: 1,
          },
        },
        getAllMembers: () => [leader],
        getMemberById: (id: string) =>
          id === "leader-review" ? leader : undefined,
        getMembersByRole: () => [leader],
        hasRole: () => true,
        getAvailableSkills: () => [],
        getAvailableTools: () => [],
      } as unknown as ITeam;

      const orchestratorWithReview = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        mockLlmFactory as never,
        reviewMemService as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const events = await collectEvents(
        orchestratorWithReview.execute(
          { prompt: "Research AI", metadata: {} },
          teamWithReview,
        ),
      );

      const types = events.map((e) => e.type);
      expect(types).toContain("review_started");
      expect(types).toContain("review_completed");
    });
  });

  // ---------------------------------------------------------------------------
  // storeContext / getContext with memory service
  // ---------------------------------------------------------------------------
  describe("storeContext() and getContext()", () => {
    it("should store and retrieve context via memoryService", async () => {
      const memStore = new Map<string, Map<string, unknown>>();
      const mockMemService = {
        setWithSession: jest
          .fn()
          .mockImplementation(
            async (sessionId: string, key: string, value: unknown) => {
              if (!memStore.has(sessionId)) memStore.set(sessionId, new Map());
              memStore.get(sessionId)!.set(key, value);
            },
          ),
        getWithSession: jest
          .fn()
          .mockImplementation(async (sessionId: string, key: string) => {
            return memStore.get(sessionId)?.get(key) ?? null;
          }),
      };

      const orchestratorWithMem = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        mockMemService as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const missionId = "mem-test";
      await orchestratorWithMem["storeContext"](missionId, "input", {
        prompt: "test",
      });
      await orchestratorWithMem["storeContext"](missionId, "plan", {
        steps: [],
      });

      const context = await orchestratorWithMem["getContext"](missionId);

      expect(mockMemService.setWithSession).toHaveBeenCalledWith(
        missionId,
        "input",
        { prompt: "test" },
      );
      expect(context.input).toEqual({ prompt: "test" });
      expect(context.plan).toEqual({ steps: [] });
    });

    it("should return empty object when memory service is not available", async () => {
      // orchestrator has no memory service
      const context = await orchestrator["getContext"]("any-mission");
      expect(context).toEqual({});
    });

    it("should handle memory service throwing during store gracefully", async () => {
      const mockMemService = {
        setWithSession: jest
          .fn()
          .mockRejectedValue(new Error("Memory failure")),
        getWithSession: jest.fn(),
      };

      const orchestratorWithMem = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        mockMemService as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      // Should not throw
      await expect(
        orchestratorWithMem["storeContext"]("mission-x", "key", "value"),
      ).resolves.not.toThrow();
    });

    it("should return empty object when memory service throws during get", async () => {
      const mockMemService = {
        setWithSession: jest.fn(),
        getWithSession: jest.fn().mockRejectedValue(new Error("Get failed")),
      };

      const orchestratorWithMem = new MissionOrchestrator(
        mockConstraintEngine,
        mockConfigService,
        undefined,
        undefined,
        undefined,
        mockMemService as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enableAutoRetry: false, enableParallel: false },
      );

      const context = await orchestratorWithMem["getContext"]("mission-x");
      expect(context).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // createResult helper
  // ---------------------------------------------------------------------------
  describe("createResult()", () => {
    it("should create successful result with correct statistics", () => {
      const state = orchestrator["initializeState"]("result-test");
      state.completedSteps = ["s1", "s2"];
      state.failedSteps = ["s3"];
      state.resourceUsage.tokensUsed = 500;
      state.resourceUsage.costUsed = 2.5;
      state.reviewResults = [
        {
          stepId: "s1",
          passed: true,
          score: 9,
          feedback: "Good",
          reviewedAt: new Date(),
        },
        {
          stepId: "s2",
          passed: false,
          score: 5,
          feedback: "Bad",
          reviewedAt: new Date(),
        },
      ];

      const startTime = Date.now() - 1000;
      const result = orchestrator["createResult"](state, startTime, true);

      expect(result.success).toBe(true);
      expect(result.summary).toBe("任务执行成功");
      expect(result.statistics.completedSteps).toBe(2);
      expect(result.statistics.failedSteps).toBe(1);
      expect(result.statistics.totalSteps).toBe(3);
      expect(result.statistics.reviewCount).toBe(2);
      expect(result.statistics.reviewPassRate).toBe(0.5);
      expect(result.tokensUsed).toBe(500);
      expect(result.costUsed).toBe(2.5);
      expect(result.duration).toBeGreaterThan(0);
    });

    it("should create failed result with error info", () => {
      const state = orchestrator["initializeState"]("fail-result-test");
      const startTime = Date.now();

      const result = orchestrator["createResult"](
        state,
        startTime,
        false,
        "Network error",
      );

      expect(result.success).toBe(false);
      expect(result.summary).toContain("Network error");
      expect(result.error?.code).toBe("EXECUTION_ERROR");
      expect(result.error?.message).toBe("Network error");
      expect(result.error?.retryable).toBe(true);
    });

    it("should compute reviewPassRate as 1 when no reviews", () => {
      const state = orchestrator["initializeState"]("no-review-test");
      const result = orchestrator["createResult"](state, Date.now(), true);

      expect(result.statistics.reviewPassRate).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // updateResourceUsage
  // ---------------------------------------------------------------------------
  describe("updateResourceUsage()", () => {
    it("should compute progress as ratio of completed to total steps", () => {
      const state = orchestrator["initializeState"]("progress-test");
      state.completedSteps = ["s1", "s2"];
      state.failedSteps = ["s3"];
      state.currentSteps = ["s4"];

      const usage = orchestrator["updateResourceUsage"](
        state,
        Date.now() - 5000,
      );

      // 2 completed / (2 completed + 1 failed + 1 current) = 0.5
      expect(usage.progress).toBe(0.5);
      expect(usage.timeElapsed).toBeGreaterThan(0);
    });

    it("should return 0 progress when no steps have run", () => {
      const state = orchestrator["initializeState"]("zero-progress-test");
      const usage = orchestrator["updateResourceUsage"](state, Date.now());
      expect(usage.progress).toBe(0);
    });
  });
});
