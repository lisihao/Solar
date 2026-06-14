/**
 * MissionTransformerService 单元测试
 *
 * 覆盖:
 * - transform() 完整模式 + 简化模式
 * - fetchMissionWithRelations – NotFoundException
 * - calculateStatistics – 各种任务状态组合
 * - buildMetadata
 * - buildExecutiveSummary / buildObjectivesSection / buildStatisticsSection
 * - buildFinalResultSection / buildTeamExecutionSection / buildTaskDetailsSection
 * - buildAppendices / formatTaskAppendixContent
 * - parseMarkdown / parseListItems / tokenToSection
 * - helper methods: formatDuration, calcPercentage, label methods, getStatusCalloutType
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException } from "@nestjs/common";
import { MissionTransformerService } from "../mission-transformer.service";
import { PrismaService } from "../../../prisma/prisma.service";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "member-1",
    agentName: "Agent Smith",
    displayName: "Smith",
    aiModel: "gpt-4o",
    ...overrides,
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Research Task",
    description: "Do research",
    status: "COMPLETED",
    priority: "HIGH",
    taskType: "RESEARCH",
    revisionCount: 2,
    result: "The result",
    leaderFeedback: "Good work",
    startedAt: new Date("2024-01-01T10:00:00Z"),
    completedAt: new Date("2024-01-01T12:00:00Z"),
    assignedTo: makeMember(),
    ...overrides,
  };
}

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    id: "mission-1",
    title: "Test Mission",
    description: "Mission description",
    status: "COMPLETED",
    objectives: ["Obj 1", "Obj 2"],
    constraints: ["Constraint 1"],
    deliverables: ["Deliverable 1"],
    finalResult: "# Final Result\n\nConclusion text",
    summary: "Mission summary",
    startedAt: new Date("2024-01-01T08:00:00Z"),
    completedAt: new Date("2024-01-01T10:00:00Z"),
    createdAt: new Date("2024-01-01T07:00:00Z"),
    leader: makeMember(),
    tasks: [makeTask()],
    ...overrides,
  };
}

// ─── mock setup ──────────────────────────────────────────────────────────────

const mockPrisma = {
  teamMission: { findUnique: jest.fn() },
  // ★ 2026-05-02 (#7): transform() 同时支持 AgentPlaygroundMission（playground 路径），
  //   未配置返回值时默认返回 null → fallback 到 teamMission 路径，保持原 spec 行为
  agentPlaygroundMission: { findUnique: jest.fn().mockResolvedValue(null) },
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("MissionTransformerService", () => {
  let service: MissionTransformerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionTransformerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MissionTransformerService>(MissionTransformerService);
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transform() – full mode
  // ──────────────────────────────────────────────────────────────────────────

  describe("transform() full mode", () => {
    it("returns complete UnifiedContent with sections and metadata", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(makeMission());
      const result = await service.transform("mission-1");

      expect(result.metadata.title).toBe("Test Mission");
      expect(result.metadata.subtitle).toBe("AI Teams 任务执行报告");
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.cover?.showCover).toBe(true);
      expect(result.tableOfContents?.enabled).toBe(true);
    });

    it("includes appendices when tasks have results", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(makeMission());
      const result = await service.transform("mission-1");

      expect(result.appendices).toBeDefined();
      expect(result.appendices!.length).toBeGreaterThan(0);
      expect(result.appendices![0].title).toContain("任务 1:");
    });

    it("does not include appendices when tasks have no results", async () => {
      const task = makeTask({ result: null, leaderFeedback: null });
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks: [task] }),
      );
      const result = await service.transform("mission-1");
      expect(result.appendices).toBeUndefined();
    });

    it("includes objectives, constraints, deliverables sections", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(makeMission());
      const result = await service.transform("mission-1");

      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).toContain("任务目标");
      expect(allContent).toContain("约束条件");
      expect(allContent).toContain("期望交付物");
    });

    it("skips objectives section when empty", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ objectives: [], constraints: [], deliverables: [] }),
      );
      const result = await service.transform("mission-1");
      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).not.toContain("任务目标");
    });

    it("includes statistics section with table", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(makeMission());
      const result = await service.transform("mission-1");

      const tables = result.sections.filter((s) => s.type === "table");
      expect(tables.length).toBeGreaterThan(0);
    });

    it("includes member contribution table when participants present", async () => {
      const tasks = [
        makeTask({ id: "t1", assignedTo: makeMember({ id: "m1" }) }),
        makeTask({
          id: "t2",
          assignedTo: makeMember({ id: "m2", agentName: "Agent B" }),
        }),
      ];
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks }),
      );
      const result = await service.transform("mission-1");

      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).toContain("成员贡献");
    });

    it("includes task execution summary when mission has summary", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ summary: "Execution went well" }),
      );
      const result = await service.transform("mission-1");
      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).toContain("执行总结");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // transform() – simplified mode
  // ──────────────────────────────────────────────────────────────────────────

  describe("transform() simplified mode", () => {
    it("returns simplified content with only mission title + finalResult", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(makeMission());
      const result = await service.transform("mission-1", true);

      expect(result.sections.some((s) => s.content === "Test Mission")).toBe(
        true,
      );
      expect(result.sections.some((s) => s.content === "任务成果")).toBe(true);
      expect(result.appendices).toBeUndefined();
      expect(result.tableOfContents).toBeUndefined();
    });

    it("falls through to full mode when finalResult is null", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ finalResult: null }),
      );
      const result = await service.transform("mission-1", true);
      // With no finalResult, simplified mode falls through to full sections
      expect(result.sections.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // fetchMissionWithRelations
  // ──────────────────────────────────────────────────────────────────────────

  describe("fetchMissionWithRelations", () => {
    it("throws NotFoundException when mission not found", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(null);
      await expect(service.transform("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // calculateStatistics
  // ──────────────────────────────────────────────────────────────────────────

  describe("calculateStatistics", () => {
    function getAllText(result: {
      sections: Array<{ content?: string; rows?: Array<{ cells: string[] }> }>;
    }) {
      return result.sections
        .map((s) => {
          const content = s.content || "";
          const cellsText = (s.rows || [])
            .map((r) => r.cells.join(" "))
            .join(" ");
          return `${content} ${cellsText}`;
        })
        .join(" ");
    }

    it("counts IN_PROGRESS tasks", async () => {
      const task = makeTask({
        status: "IN_PROGRESS",
        result: null,
        leaderFeedback: null,
      });
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks: [task] }),
      );
      const result = await service.transform("mission-1");
      const allText = getAllText(result);
      expect(allText).toContain("进行中");
    });

    it("counts BLOCKED / AWAITING_REVIEW / REVISION_NEEDED as pending", async () => {
      const tasks = [
        makeTask({
          id: "t1",
          status: "BLOCKED",
          result: null,
          leaderFeedback: null,
        }),
        makeTask({
          id: "t2",
          status: "AWAITING_REVIEW",
          result: null,
          leaderFeedback: null,
        }),
        makeTask({
          id: "t3",
          status: "REVISION_NEEDED",
          result: null,
          leaderFeedback: null,
        }),
      ];
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks }),
      );
      const result = await service.transform("mission-1");
      // completionRate should be 0% -- appears in list items and key points
      const listItems = result.sections
        .filter((s) => s.type === "list")
        .flatMap((s) => (s.items || []).map((i) => i.content));
      expect(listItems.some((i) => i.includes("0%"))).toBe(true);
    });

    it("counts CANCELLED as failed", async () => {
      const task = makeTask({
        status: "CANCELLED",
        result: null,
        leaderFeedback: null,
      });
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks: [task] }),
      );
      const result = await service.transform("mission-1");
      // The key points list includes "有 1 项任务执行失败" entry
      const listItems = result.sections
        .filter((s) => s.type === "list")
        .flatMap((s) => (s.items || []).map((i) => i.content));
      expect(listItems.some((i) => i.includes("失败"))).toBe(true);
    });

    it("calculates duration as 0 when no startedAt", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ startedAt: null }),
      );
      const result = await service.transform("mission-1");
      // Duration appears in stats table cells
      const allText = getAllText(result);
      expect(allText).toContain("0 分钟");
    });

    it("calculates duration in hours when >= 60 minutes", async () => {
      const startedAt = new Date("2024-01-01T08:00:00Z");
      const completedAt = new Date("2024-01-01T10:30:00Z"); // 150 min
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ startedAt, completedAt }),
      );
      const result = await service.transform("mission-1");
      const allText = getAllText(result);
      expect(allText).toContain("小时");
    });

    it("handles zero tasks (empty mission)", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks: [] }),
      );
      const result = await service.transform("mission-1");
      expect(result.sections.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // buildFinalResultSection
  // ──────────────────────────────────────────────────────────────────────────

  describe("buildFinalResultSection", () => {
    it("shows callout when no finalResult", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ finalResult: null }),
      );
      const result = await service.transform("mission-1");
      const callouts = result.sections.filter((s) => s.type === "callout");
      expect(callouts.length).toBeGreaterThan(0);
    });

    it("shows 'no result' message for PENDING status", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: "PENDING", finalResult: null }),
      );
      const result = await service.transform("mission-1");
      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).toContain("尚未开始");
    });

    it("shows 'in progress' message for IN_PROGRESS status", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: "IN_PROGRESS", finalResult: null }),
      );
      const result = await service.transform("mission-1");
      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).toContain("正在执行");
    });

    it("shows 'paused' message for PAUSED status", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: "PAUSED", finalResult: null }),
      );
      const result = await service.transform("mission-1");
      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).toContain("暂停");
    });

    it("shows 'failed' message for FAILED status", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: "FAILED", finalResult: null }),
      );
      const result = await service.transform("mission-1");
      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).toContain("失败");
    });

    it("shows 'cancelled' message for CANCELLED status", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: "CANCELLED", finalResult: null }),
      );
      const result = await service.transform("mission-1");
      const allContent = result.sections.map((s) => s.content || "").join(" ");
      expect(allContent).toContain("取消");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // buildTaskDetailsSection
  // ──────────────────────────────────────────────────────────────────────────

  describe("buildTaskDetailsSection", () => {
    it("shows 'no tasks' callout when tasks array is empty", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks: [] }),
      );
      const result = await service.transform("mission-1");
      const callouts = result.sections.filter(
        (s) => s.type === "callout" && s.content?.includes("暂无子任务"),
      );
      expect(callouts.length).toBeGreaterThan(0);
    });

    it("shows task summary table when tasks present", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(makeMission());
      const result = await service.transform("mission-1");
      const tables = result.sections.filter((s) => s.type === "table");
      expect(tables.some((t) => t.headers?.includes("任务标题"))).toBe(true);
    });

    it("uses displayName when agentName is null", async () => {
      const task = makeTask({
        assignedTo: makeMember({
          agentName: null,
          displayName: "Display Name",
        }),
      });
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks: [task] }),
      );
      const result = await service.transform("mission-1");
      const allContent = result.sections
        .map((s) => (s.rows || []).map((r) => r.cells.join(" ")).join(" "))
        .join(" ");
      expect(allContent).toContain("Display Name");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getStatusCalloutType
  // ──────────────────────────────────────────────────────────────────────────

  describe("getStatusCalloutType (via callout section)", () => {
    it("uses success calloutType for COMPLETED mission", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: "COMPLETED" }),
      );
      const result = await service.transform("mission-1");
      const callouts = result.sections.filter((s) => s.type === "callout");
      expect(callouts.some((c) => c.calloutType === "success")).toBe(true);
    });

    it("uses error calloutType for FAILED mission", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: "FAILED", finalResult: null }),
      );
      const result = await service.transform("mission-1");
      const callouts = result.sections.filter((s) => s.type === "callout");
      expect(callouts.some((c) => c.calloutType === "error")).toBe(true);
    });

    it("uses warning calloutType for PAUSED mission", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: "PAUSED", finalResult: null }),
      );
      const result = await service.transform("mission-1");
      const callouts = result.sections.filter((s) => s.type === "callout");
      expect(callouts.some((c) => c.calloutType === "warning")).toBe(true);
    });

    it("uses info calloutType for IN_PROGRESS mission", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: "IN_PROGRESS", finalResult: null }),
      );
      const result = await service.transform("mission-1");
      const callouts = result.sections.filter((s) => s.type === "callout");
      expect(callouts.some((c) => c.calloutType === "info")).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // parseMarkdown – token types via finalResult field
  // ──────────────────────────────────────────────────────────────────────────

  describe("parseMarkdown via finalResult", () => {
    async function getSections(markdown: string) {
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ finalResult: markdown }),
      );
      const result = await service.transform("mission-1");
      return result.sections;
    }

    it("parses headings (offset by 1 level)", async () => {
      const sections = await getSections("# H1\n## H2");
      const headings = sections.filter((s) => s.type === "heading");
      // headings are offset +1: H1 → level 2, H2 → level 3
      expect(headings.some((h) => h.level === 2)).toBe(true);
    });

    it("parses paragraphs", async () => {
      const sections = await getSections("Paragraph text.");
      expect(sections.some((s) => s.type === "paragraph")).toBe(true);
    });

    it("parses unordered list", async () => {
      const sections = await getSections("- item a\n- item b");
      expect(
        sections.some((s) => s.type === "list" && s.ordered === false),
      ).toBe(true);
    });

    it("parses ordered list", async () => {
      const sections = await getSections("1. first\n2. second");
      expect(
        sections.some((s) => s.type === "list" && s.ordered === true),
      ).toBe(true);
    });

    it("parses table", async () => {
      const sections = await getSections("| Col | Val |\n|---|---|\n| A | 1 |");
      expect(sections.some((s) => s.type === "table")).toBe(true);
    });

    it("parses code block", async () => {
      const sections = await getSections("```js\nconsole.log('hi');\n```");
      expect(sections.some((s) => s.type === "code")).toBe(true);
    });

    it("parses blockquote", async () => {
      const sections = await getSections("> A quote");
      expect(sections.some((s) => s.type === "quote")).toBe(true);
    });

    it("parses horizontal rule", async () => {
      const sections = await getSections("---");
      expect(sections.some((s) => s.type === "divider")).toBe(true);
    });

    it("returns null for unknown token types (no crash)", async () => {
      // Images and HTML blocks are unknown – just verify no error is thrown
      const sections = await getSections("![img](http://example.com/img.png)");
      expect(Array.isArray(sections)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Label helpers
  // ──────────────────────────────────────────────────────────────────────────

  describe("label helpers in sections", () => {
    it("uses task priority labels in appendix content", async () => {
      const tasks = [
        makeTask({ id: "t1", priority: "CRITICAL" }),
        makeTask({ id: "t2", priority: "MEDIUM" }),
        makeTask({ id: "t3", priority: "LOW" }),
      ];
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks }),
      );
      const result = await service.transform("mission-1");
      const appendixContent = (result.appendices || [])
        .map((a) => a.content)
        .join(" ");
      expect(appendixContent).toContain("紧急");
    });

    it("uses task type labels in appendix content", async () => {
      const task = makeTask({ taskType: "DESIGN" });
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks: [task] }),
      );
      const result = await service.transform("mission-1");
      const appendixContent = (result.appendices || [])
        .map((a) => a.content)
        .join(" ");
      expect(appendixContent).toContain("设计规划");
    });

    it("uses getMissionStatusLabel for all statuses", async () => {
      const statuses = [
        "PENDING",
        "PLANNING",
        "IN_PROGRESS",
        "PAUSED",
        "REVIEW",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
      ] as const;
      for (const status of statuses) {
        mockPrisma.teamMission.findUnique.mockResolvedValue(
          makeMission({ status, finalResult: null }),
        );
        const result = await service.transform("mission-1");
        // tags array should contain a non-empty string for the status label
        expect(result.metadata.tags).toBeDefined();
        expect(result.metadata.tags!.length).toBeGreaterThan(0);
        expect(typeof result.metadata.tags![2]).toBe("string");
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // formatDuration helper
  // ──────────────────────────────────────────────────────────────────────────

  describe("formatDuration edge cases", () => {
    function getAllTableCellText(result: {
      sections: Array<{ rows?: Array<{ cells: string[] }> }>;
    }) {
      return result.sections
        .flatMap((s) => (s.rows || []).map((r) => r.cells.join(" ")))
        .join(" ");
    }

    it("formats exact hours without minutes", async () => {
      const startedAt = new Date("2024-01-01T08:00:00Z");
      const completedAt = new Date("2024-01-01T10:00:00Z"); // 120 min = 2 hours
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ startedAt, completedAt }),
      );
      const result = await service.transform("mission-1");
      const cellText = getAllTableCellText(result);
      expect(cellText).toContain("2 小时");
    });

    it("formats hours with remaining minutes", async () => {
      const startedAt = new Date("2024-01-01T08:00:00Z");
      const completedAt = new Date("2024-01-01T09:30:00Z"); // 90 min = 1h 30min
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ startedAt, completedAt }),
      );
      const result = await service.transform("mission-1");
      const cellText = getAllTableCellText(result);
      expect(cellText).toContain("1 小时 30 分钟");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ★ 2026-05-02 (#7): playground mission 路径
  // ──────────────────────────────────────────────────────────────────────────

  describe("transform() playground mission path", () => {
    function makePlaygroundMission(overrides: Record<string, unknown> = {}) {
      return {
        id: "pg-mission-1",
        userId: "user-1",
        topic: "AI Coding Agents",
        depth: "deep",
        language: "zh-CN",
        status: "completed",
        startedAt: new Date("2024-02-01T08:00:00Z"),
        completedAt: new Date("2024-02-01T10:00:00Z"),
        reportTitle: "AI Coding Agents 深度报告",
        reportSummary: "Summary text",
        reportFull: {
          content: {
            fullMarkdown:
              "# AI Coding Agents\n\n## 第一章\n\n这是正文内容 [1]。\n\n## 第二章\n\n更多内容 [2]。",
          },
          citations: [
            {
              index: 1,
              title: "Anthropic Blog",
              url: "https://anthropic.com/post1",
              author: "Anthropic",
              snippet: "snippet1",
              domain: "anthropic.com",
            },
            {
              index: 2,
              title: "OpenAI Blog",
              url: "https://openai.com/post2",
              domain: "openai.com",
            },
          ],
          factTable: [
            { subject: "Claude", fact: "released 2024", citations: [1] },
            { subject: "GPT-4", fact: "released 2023", citations: [2] },
          ],
        },
        ...overrides,
      };
    }

    it("transforms playground mission via reportFull.content.fullMarkdown", async () => {
      mockPrisma.agentPlaygroundMission.findUnique.mockResolvedValue(
        makePlaygroundMission(),
      );
      const result = await service.transform("pg-mission-1");

      expect(result.metadata.title).toBe("AI Coding Agents 深度报告");
      expect(result.metadata.subtitle).toBe("AI Agent Playground 任务报告");
      expect(result.metadata.author).toBe("AI Playground");
      expect(result.metadata.tags).toContain("AI Playground");
      expect(result.metadata.language).toBe("zh-CN");
      expect(result.sections.length).toBeGreaterThan(0);
      // 不会 fallback 到 teamMission 路径
      expect(mockPrisma.teamMission.findUnique).not.toHaveBeenCalled();
    });

    it("extracts references from reportFull.citations", async () => {
      mockPrisma.agentPlaygroundMission.findUnique.mockResolvedValue(
        makePlaygroundMission(),
      );
      const result = await service.transform("pg-mission-1");

      expect(result.references).toBeDefined();
      expect(result.references?.length).toBe(2);
      expect(result.references?.[0]).toMatchObject({
        id: 1,
        title: "Anthropic Blog",
        url: "https://anthropic.com/post1",
        author: "Anthropic",
        snippet: "snippet1",
        domain: "anthropic.com",
      });
    });

    it("includes factTable as appendix", async () => {
      mockPrisma.agentPlaygroundMission.findUnique.mockResolvedValue(
        makePlaygroundMission(),
      );
      const result = await service.transform("pg-mission-1");

      expect(result.appendices).toBeDefined();
      expect(result.appendices?.length).toBe(1);
      expect(result.appendices?.[0].title).toContain("事实表");
      expect(result.appendices?.[0].content).toContain("Claude");
      expect(result.appendices?.[0].content).toContain("GPT-4");
    });

    it("handles missing fullMarkdown gracefully (warning callout)", async () => {
      const mission = makePlaygroundMission({
        reportFull: { citations: [] },
        reportSummary: null,
      });
      mockPrisma.agentPlaygroundMission.findUnique.mockResolvedValue(mission);
      const result = await service.transform("pg-mission-1");

      expect(result.sections.length).toBe(1);
      expect(result.sections[0].type).toBe("callout");
      expect(result.sections[0].calloutType).toBe("warning");
    });

    it("falls back to topic when reportTitle is missing", async () => {
      mockPrisma.agentPlaygroundMission.findUnique.mockResolvedValue(
        makePlaygroundMission({ reportTitle: null }),
      );
      const result = await service.transform("pg-mission-1");

      expect(result.metadata.title).toBe("AI Coding Agents");
    });

    it("handles empty citations array", async () => {
      mockPrisma.agentPlaygroundMission.findUnique.mockResolvedValue(
        makePlaygroundMission({
          reportFull: {
            content: { fullMarkdown: "# Title\n\nbody" },
            citations: [],
          },
        }),
      );
      const result = await service.transform("pg-mission-1");

      expect(result.references).toBeUndefined();
    });

    it("handles malformed citation entries (skips non-objects)", async () => {
      mockPrisma.agentPlaygroundMission.findUnique.mockResolvedValue(
        makePlaygroundMission({
          reportFull: {
            content: { fullMarkdown: "# Title\n\nbody" },
            citations: [
              null,
              "string-not-object",
              { index: 5, title: "Valid", url: "https://x.com" },
            ],
          },
        }),
      );
      const result = await service.transform("pg-mission-1");

      expect(result.references?.length).toBe(1);
      expect(result.references?.[0].id).toBe(5);
    });

    it("falls back to legacy reportFull.fullMarkdown shape (v1)", async () => {
      mockPrisma.agentPlaygroundMission.findUnique.mockResolvedValue(
        makePlaygroundMission({
          reportFull: {
            // v1: fullMarkdown at top level (no content wrapper)
            fullMarkdown: "# Legacy v1\n\nbody",
          },
        }),
      );
      const result = await service.transform("pg-mission-1");

      expect(result.sections.length).toBeGreaterThan(0);
      // section 应包含 heading "Legacy v1"
      const headings = result.sections.filter((s) => s.type === "heading");
      expect(headings.some((h) => h.content === "Legacy v1")).toBe(true);
    });
  });
});
