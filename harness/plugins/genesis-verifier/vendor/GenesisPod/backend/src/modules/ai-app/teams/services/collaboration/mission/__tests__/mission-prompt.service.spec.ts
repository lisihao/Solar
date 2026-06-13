/**
 * MissionPromptService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MissionPromptService } from "../mission-prompt.service";
import { MissionContextService } from "@/modules/ai-harness/facade";
import { AgentTaskStatus } from "@prisma/client";

const mockMissionContextService = {
  buildContextPackagePromptSection: jest.fn().mockReturnValue(""),
};

const mockTeamMembers = [
  {
    id: "member-1",
    agentName: "Alice",
    displayName: "Alice Agent",
    agentIdentity: "Writer",
    roleDescription: "Writes content",
    expertiseAreas: ["writing", "storytelling"],
    workStyle: "高效",
    aiModel: "gemini-pro",
  },
  {
    id: "member-2",
    agentName: "Bob",
    displayName: "Bob Agent",
    agentIdentity: "Analyst",
    roleDescription: "Analyzes data",
    expertiseAreas: ["analysis"],
    workStyle: "严谨",
    aiModel: "gpt-4",
  },
];

describe("MissionPromptService", () => {
  let service: MissionPromptService;
  let missionContextService: jest.Mocked<MissionContextService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionPromptService,
        {
          provide: MissionContextService,
          useValue: mockMissionContextService,
        },
      ],
    }).compile();

    service = module.get<MissionPromptService>(MissionPromptService);
    missionContextService = module.get(MissionContextService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== buildLeaderPlanningPrompt ====================

  describe("buildLeaderPlanningPrompt", () => {
    it("should build a planning prompt with all fields", () => {
      const mission = {
        title: "Write a Novel",
        description: "Write a fantasy novel",
        objectives: ["Complete 10 chapters"],
        constraints: ["No violence"],
        deliverables: ["Final manuscript"],
      };
      const leader = { agentName: "Leader", displayName: "Leader Agent" };

      const result = service.buildLeaderPlanningPrompt(
        mission,
        leader,
        mockTeamMembers,
      );

      expect(result).toContain("Leader");
      expect(result).toContain("Write a Novel");
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
      expect(result).toContain("Complete 10 chapters");
      expect(result).toContain("No violence");
      expect(result).toContain("Final manuscript");
    });

    it("should use displayName when agentName is null", () => {
      const mission = { title: "Test Mission" };
      const leader = { agentName: null, displayName: "Display Leader" };

      const result = service.buildLeaderPlanningPrompt(
        mission,
        leader,
        mockTeamMembers,
      );

      expect(result).toContain("Display Leader");
    });

    it("should handle empty team members", () => {
      const mission = { title: "Test Mission" };
      const leader = { agentName: "Leader", displayName: "Leader Agent" };

      const result = service.buildLeaderPlanningPrompt(mission, leader, []);

      expect(result).toBeDefined();
      expect(result).toContain("Leader");
    });

    it("should call missionContextService.buildContextPackagePromptSection", () => {
      const mission = { title: "Test Mission" };
      const leader = { agentName: "Leader", displayName: "Leader Agent" };

      service.buildLeaderPlanningPrompt(mission, leader, mockTeamMembers);

      expect(
        missionContextService.buildContextPackagePromptSection,
      ).toHaveBeenCalledWith(expect.arrayContaining(["Alice", "Bob"]));
    });
  });

  // ==================== buildScopeGuidance ====================

  describe("buildScopeGuidance", () => {
    it("should return empty string for non-large-content task", () => {
      const result = service.buildScopeGuidance({
        title: "Write a report",
        description: "Simple report",
      });
      expect(result).toBe("");
    });

    it("should return guidance for large content task with 小说", () => {
      const result = service.buildScopeGuidance({
        title: "写一部小说 3卷",
        description: "写一部有3卷的玄幻小说",
      });
      expect(result).toContain("极其重要");
      expect(result).toContain("3 卷");
    });

    it("should detect quantity pattern", () => {
      const result = service.buildScopeGuidance({
        title: "写10章的教程",
        description: "",
      });
      expect(result).toContain("极其重要");
    });
  });

  // ==================== detectLargeContentTask ====================

  describe("detectLargeContentTask", () => {
    it("should detect novel with chapter structure", () => {
      expect(service.detectLargeContentTask("写一部玄幻小说，共8卷")).toBe(
        true,
      );
    });

    it("should detect content keyword + structure keyword", () => {
      expect(service.detectLargeContentTask("这是一部连载故事，分5篇")).toBe(
        true,
      );
    });

    it("should detect numeric quantity pattern", () => {
      expect(service.detectLargeContentTask("写10章内容")).toBe(true);
    });

    it("should not detect non-content tasks", () => {
      expect(service.detectLargeContentTask("写一份技术报告")).toBe(false);
    });

    it("should not detect empty text", () => {
      expect(service.detectLargeContentTask("")).toBe(false);
    });
  });

  // ==================== extractStructureHint ====================

  describe("extractStructureHint", () => {
    it("should extract numeric volume count", () => {
      const result = service.extractStructureHint("写8卷的小说");
      expect(result).toContain("8 卷");
    });

    it("should extract chinese volume count", () => {
      const result = service.extractStructureHint("写三卷的故事");
      expect(result).toContain("三 卷");
    });

    it("should return empty string when no volume info", () => {
      const result = service.extractStructureHint("写一个故事");
      expect(result).toBe("");
    });
  });

  // ==================== buildTaskExecutionPrompt ====================

  describe("buildTaskExecutionPrompt", () => {
    it("should build execution prompt with search context", () => {
      const result = service.buildTaskExecutionPrompt(
        { title: "Research AI", description: "AI research task" },
        {
          title: "Chapter 1",
          description: "Write chapter",
          taskType: "writing",
        },
        "Search results here",
      );

      expect(result).toContain("Research AI");
      expect(result).toContain("Chapter 1");
      expect(result).toContain("Search results here");
      expect(result).toContain("参考资料");
    });

    it("should build execution prompt without search context", () => {
      const result = service.buildTaskExecutionPrompt(
        { title: "Task" },
        { title: "Sub Task" },
      );

      expect(result).toContain("Task");
      expect(result).toContain("Sub Task");
      expect(result).not.toContain("联网搜索");
    });

    it("should truncate long search context", () => {
      const longContext = "a".repeat(5000);
      const result = service.buildTaskExecutionPrompt(
        { title: "Task" },
        { title: "Sub Task" },
        longContext,
      );

      expect(result).toContain("截断");
    });
  });

  // ==================== needsWebSearch ====================

  describe("needsWebSearch", () => {
    it("should return true for realtime keyword 最新", () => {
      expect(service.needsWebSearch("", "最新市场分析", "", "")).toBe(true);
    });

    it("should return true for 2025年", () => {
      expect(service.needsWebSearch("2025年行业报告", "", "", "")).toBe(true);
    });

    it("should return false for regular task", () => {
      expect(
        service.needsWebSearch(
          "Write a story",
          "",
          "Chapter 1",
          "Write introduction",
        ),
      ).toBe(false);
    });

    it("should return true for research keyword", () => {
      expect(
        service.needsWebSearch("", "", "行业调研报告", "调研最新数据"),
      ).toBe(true);
    });
  });

  // ==================== buildSearchQuery ====================

  describe("buildSearchQuery", () => {
    it("should build search query from task title", () => {
      const result = service.buildSearchQuery(
        "AI Trends",
        "Latest Models",
        "Compare models",
      );
      expect(result).toContain("Latest Models");
    });

    it("should include mission title when short", () => {
      const result = service.buildSearchQuery("AI", "Models", "Details");
      expect(result).toContain("AI");
      expect(result).toContain("Models");
    });

    it("should not exceed 100 chars", () => {
      const result = service.buildSearchQuery(
        "a".repeat(60),
        "b".repeat(60),
        "c".repeat(60),
      );
      expect(result.length).toBeLessThanOrEqual(100);
    });
  });

  // ==================== buildLeaderReviewPrompt ====================

  describe("buildLeaderReviewPrompt", () => {
    it("should build review prompt with task result", () => {
      const mission = {
        title: "Write Novel",
        description: "Fantasy novel",
        tasks: [
          {
            id: "task-2",
            status: AgentTaskStatus.COMPLETED,
            title: "Chapter 1",
            result: "Chapter content here",
            assignedTo: { agentName: "Alice", displayName: "Alice Agent" },
          },
        ],
      };
      const task = {
        id: "task-1",
        title: "Chapter 2",
        description: "Write chapter 2",
        assignedTo: { agentName: "Bob", displayName: "Bob Agent" },
      };

      const result = service.buildLeaderReviewPrompt(
        mission,
        task,
        "Chapter 2 content",
      );

      expect(result).toContain("Write Novel");
      expect(result).toContain("Chapter 2");
      expect(result).toContain("Chapter 2 content");
      expect(result).toContain("审核");
    });

    it("should truncate long task result", () => {
      const mission = { title: "Test" };
      const task = {
        id: "task-1",
        title: "Task",
        assignedTo: { agentName: "Alice", displayName: "Alice" },
      };
      const longResult = "x".repeat(5000);

      const result = service.buildLeaderReviewPrompt(mission, task, longResult);

      expect(result).toContain("省略");
    });
  });

  // ==================== buildTaskRevisionPrompt ====================

  describe("buildTaskRevisionPrompt", () => {
    it("should build revision prompt", () => {
      const task = {
        title: "Chapter 1",
        description: "Write chapter 1",
        result: "Previous content here",
      };

      const result = service.buildTaskRevisionPrompt(
        task,
        "Please improve the beginning",
      );

      expect(result).toContain("Chapter 1");
      expect(result).toContain("Previous content here");
      expect(result).toContain("Please improve the beginning");
    });

    it("should handle null task result", () => {
      const task = { title: "Task", result: null };

      const result = service.buildTaskRevisionPrompt(task, "Feedback");

      expect(result).toContain("无记录");
    });
  });

  // ==================== buildFinalReportWithFullContent ====================

  describe("buildFinalReportWithFullContent", () => {
    it("should build final report from completed tasks", () => {
      const mission = {
        title: "Novel Project",
        description: "Fantasy novel",
        deliverables: ["Manuscript"],
        tasks: [
          {
            status: AgentTaskStatus.COMPLETED,
            title: "Chapter 1",
            result: "Chapter 1 content here",
            assignedTo: { agentName: "Alice", displayName: "Alice" },
          },
          {
            status: AgentTaskStatus.PENDING,
            title: "Chapter 2",
            result: null,
            assignedTo: null,
          },
        ],
      };

      const { fullContent, summaryPrompt } =
        service.buildFinalReportWithFullContent(mission);

      expect(fullContent).toContain("Novel Project");
      expect(fullContent).toContain("Chapter 1 content here");
      expect(summaryPrompt).toContain("Novel Project");
      expect(summaryPrompt).toContain("Manuscript");
    });

    it("should handle empty tasks", () => {
      const mission = { title: "Empty Mission", tasks: [] };

      const { fullContent, summaryPrompt } =
        service.buildFinalReportWithFullContent(mission);

      expect(fullContent).toContain("Empty Mission");
      expect(summaryPrompt).toContain("0 个子任务");
    });
  });

  // ==================== getLeaderSystemPrompt ====================

  describe("getLeaderSystemPrompt", () => {
    it("should build leader system prompt", () => {
      const leader = {
        agentName: "Commander",
        displayName: "Commander Agent",
        agentIdentity: "军事指挥官",
        roleDescription: "Leads the team",
      };

      const result = service.getLeaderSystemPrompt(leader);

      expect(result).toContain("Commander");
      expect(result).toContain("军事指挥官");
    });

    it("should use roleDescription when agentIdentity is null", () => {
      const leader = {
        agentName: null,
        displayName: "Leader",
        agentIdentity: null,
        roleDescription: "Team leader",
      };

      const result = service.getLeaderSystemPrompt(leader);

      expect(result).toContain("Leader");
      expect(result).toContain("Team leader");
    });
  });

  // ==================== getAgentSystemPrompt ====================

  describe("getAgentSystemPrompt", () => {
    it("should build agent system prompt", () => {
      const agent = {
        agentName: "Alice",
        displayName: "Alice Agent",
        agentIdentity: "作家",
        roleDescription: "Writer",
        expertiseAreas: ["writing", "storytelling"],
      };
      const task = { title: "Write Chapter 1" };

      const result = service.getAgentSystemPrompt(agent, task);

      expect(result).toContain("Alice");
      expect(result).toContain("作家");
      expect(result).toContain("writing");
      expect(result).toContain("Write Chapter 1");
    });

    it("should handle null expertise areas", () => {
      const agent = {
        agentName: "Alice",
        displayName: "Alice Agent",
        expertiseAreas: undefined,
      };
      const task = { title: "Task" };

      const result = service.getAgentSystemPrompt(agent, task);

      expect(result).toContain("多个领域");
    });
  });

  // ==================== parseTaskBreakdown ====================

  describe("parseTaskBreakdown", () => {
    it("should parse task breakdown from table format", () => {
      const content = `## 任务理解
这是一个小说写作任务

## 任务分解
| # | 任务名称 | 负责人 | 分配理由 | 优先级 | 依赖 |
|---|----------|--------|----------|--------|------|
| 1 | 写第一章 | @Alice | 擅长写作 | 高 | 无 |
| 2 | 写第二章 | @Bob | 擅长分析 | 中 | 任务1 |

## 执行计划
- 第一阶段：并行执行

## 风险提示
无明显风险`;

      const result = service.parseTaskBreakdown(content, mockTeamMembers);

      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.understanding).toContain("小说写作任务");
      expect(result.executionPlan).toContain("第一阶段");
    });

    it("should create default task when no tasks parsed", () => {
      const result = service.parseTaskBreakdown("No table", mockTeamMembers);

      expect(result.tasks.length).toBe(1);
      expect(result.tasks[0].assigneeId).toBe("member-1");
    });

    it("should return empty tasks when no team members", () => {
      const result = service.parseTaskBreakdown("No table", []);

      expect(result.tasks.length).toBe(0);
    });

    it("should parse HIGH priority correctly", () => {
      const content = `## 任务分解
| # | 任务名称 | 负责人 | 分配理由 | 优先级 | 依赖 |
|---|----------|--------|----------|--------|------|
| 1 | Task 1 | @Alice | reason | 高 | 无 |`;

      const result = service.parseTaskBreakdown(content, mockTeamMembers);

      if (result.tasks.length > 0) {
        expect(result.tasks[0].priority).toBe("HIGH");
      }
    });

    it("should parse CRITICAL priority correctly", () => {
      const content = `## 任务分解
| # | 任务名称 | 负责人 | 分配理由 | 优先级 | 依赖 |
|---|----------|--------|----------|--------|------|
| 1 | Task 1 | @Alice | reason | 关键 | 无 |`;

      const result = service.parseTaskBreakdown(content, mockTeamMembers);

      if (result.tasks.length > 0) {
        expect(result.tasks[0].priority).toBe("CRITICAL");
      }
    });
  });

  // ==================== parseReviewResult ====================

  describe("parseReviewResult", () => {
    it("should return true for 审核通过", () => {
      expect(service.parseReviewResult("审核通过，内容很好")).toBe(true);
    });

    it("should return true for approved", () => {
      expect(service.parseReviewResult("Content is approved")).toBe(true);
    });

    it("should return false for 需要修改", () => {
      expect(service.parseReviewResult("内容需要修改，请改进")).toBe(false);
    });

    it("should return false for rejected", () => {
      expect(service.parseReviewResult("This is rejected")).toBe(false);
    });

    it("should return false for 不通过", () => {
      expect(service.parseReviewResult("审核不通过")).toBe(false);
    });

    it("should handle 通过 with negative prefix", () => {
      expect(service.parseReviewResult("未能通过审核")).toBe(false);
    });

    it("should return false when no clear result", () => {
      expect(service.parseReviewResult("内容写得很好，有一些小问题")).toBe(
        false,
      );
    });

    it("should return false for ❌ emoji", () => {
      expect(service.parseReviewResult("❌ 不符合要求")).toBe(false);
    });
  });

  // ==================== extractKeyExcerpts ====================

  describe("extractKeyExcerpts", () => {
    it("should extract head and tail excerpts", () => {
      const content = "A".repeat(100) + "middle" + "B".repeat(100);

      const result = service.extractKeyExcerpts(content);

      expect(result).toContain("开篇");
      expect(result).toContain("结尾");
    });
  });

  // ==================== buildSummarizeForReviewPrompt ====================

  describe("buildSummarizeForReviewPrompt", () => {
    it("should build summarize prompt", () => {
      const result = service.buildSummarizeForReviewPrompt(
        "Long content here",
        "Chapter 1",
      );

      expect(result).toContain("Chapter 1");
      expect(result).toContain("Long content here");
      expect(result).toContain("内容概要");
    });

    it("should truncate content longer than 8000 chars", () => {
      const longContent = "x".repeat(10000);
      const result = service.buildSummarizeForReviewPrompt(longContent, "Task");

      expect(result).toContain("后续内容省略");
    });
  });
});
