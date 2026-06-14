/**
 * Unit tests for SlidesLeader
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SlidesLeader } from "../slides-leader";
import { SlidesMission, SlidesTask } from "../types";
import { ChatFacade } from "@/modules/ai-harness/facade";

const buildMission = (
  overrides: Partial<SlidesMission> = {},
): SlidesMission => ({
  id: "mission-001",
  userId: "user-1",
  sessionId: "session-1",
  sourceText:
    "This is a comprehensive market analysis report covering Q4 2024 trends.",
  userRequirement: "Create a 10-page executive summary",
  targetPages: 10,
  stylePreference: "dark",
  themeId: "genspark-dark",
  tasks: [],
  currentPhase: "planning",
  status: "planning",
  pages: [],
  totalTasks: 0,
  completedTasks: 0,
  metadata: {},
  createdAt: new Date(),
  ...overrides,
});

const buildTask = (overrides: Partial<SlidesTask> = {}): SlidesTask => ({
  id: "task-001",
  title: "Analyze Source Text",
  description: "Break down source text into sections",
  assignee: "analyst",
  skillId: "slides-task-decomposition",
  input: {},
  dependencies: [],
  status: "completed",
  priority: "high",
  revisionCount: 0,
  maxRevisions: 3,
  createdAt: new Date(),
  ...overrides,
});

describe("SlidesLeader", () => {
  let leader: SlidesLeader;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SlidesLeader, { provide: ChatFacade, useValue: mockFacade }],
    })
      .overrideProvider(SlidesLeader)
      .useFactory({ factory: () => new SlidesLeader(mockFacade as any) })
      .compile();

    leader = module.get<SlidesLeader>(SlidesLeader);
  });

  it("should be defined", () => {
    expect(leader).toBeDefined();
  });

  it("should plan tasks and parse AI response with table format", async () => {
    const aiResponse = `### 任务理解
分析源文本，生成专业 PPT。

### 任务列表
| 序号 | 任务标题 | 描述 | 负责人 | 技能ID | 优先级 | 依赖 |
|------|----------|------|--------|--------|--------|------|
| 1 | 任务分解 | 分析结构 | analyst | task-decomposition | high | - |
| 2 | 生成大纲 | 规划页面 | analyst | outline-planning | high | 1 |
| 3 | 生成页面 | 渲染 HTML | writer | page-pipeline | high | 2 |

### 执行计划
顺序执行三个任务。

### 风险提示
无重大风险。`;

    mockFacade.chat.mockResolvedValue({ content: aiResponse, tokensUsed: 200 });

    const mission = buildMission();
    const breakdown = await leader.planTasks(mission);

    expect(breakdown.tasks).toHaveLength(3);
    expect(breakdown.tasks[0].skillId).toBe("slides-task-decomposition");
    expect(breakdown.tasks[1].skillId).toBe("slides-outline-planning");
    expect(breakdown.tasks[2].skillId).toBe("slides-page-pipeline");
    expect(breakdown.understanding).toContain("分析源文本");
    expect(breakdown.executionPlan).toContain("顺序执行");
  });

  it("should create default tasks when AI returns no table", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "I cannot parse this format",
      tokensUsed: 50,
    });

    const mission = buildMission();
    const breakdown = await leader.planTasks(mission);

    expect(breakdown.tasks).toHaveLength(3);
    expect(breakdown.tasks[0].skillId).toBe("slides-task-decomposition");
    expect(breakdown.tasks[1].skillId).toBe("slides-outline-planning");
    expect(breakdown.tasks[2].skillId).toBe("slides-page-pipeline");
  });

  it("should create SlidesTask objects from breakdown", async () => {
    const defaultBreakdown = {
      understanding: "test",
      tasks: leader.createDefaultTasks(),
      executionPlan: "",
      risks: "",
    };

    const tasks = leader.createTasksFromBreakdown(defaultBreakdown);

    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBeDefined();
    expect(tasks[0].status).toBe("pending");
    expect(tasks[0].revisionCount).toBe(0);
    expect(tasks[1].dependencies).toContain(tasks[0].id);
    expect(tasks[2].dependencies).toContain(tasks[1].id);
  });

  it("should review task and parse AI decision as approved", async () => {
    const aiResponse = `### 决定
approved

### 评分
92

### 反馈
The task output is comprehensive and well-structured.

### 建议
- Add more visual elements
- Consider data visualization`;

    mockFacade.chat.mockResolvedValue({ content: aiResponse, tokensUsed: 100 });

    const mission = buildMission();
    const task = buildTask({ status: "awaiting_review" });
    const result = { pages: 10, quality: "high" };

    const reviewResult = await leader.reviewTask(mission, task, result);

    expect(reviewResult.decision).toBe("approved");
    expect(reviewResult.score).toBe(92);
    expect(reviewResult.feedback).toContain("comprehensive");
    expect(reviewResult.suggestions).toHaveLength(2);
  });

  it("should review task and parse revision_needed decision", async () => {
    const aiResponse = `### 决定
revision_needed

### 评分
65

### 反馈
Content is incomplete, missing key sections.

### 建议
- Add executive summary
- Include market data`;

    mockFacade.chat.mockResolvedValue({ content: aiResponse, tokensUsed: 80 });

    const mission = buildMission();
    const task = buildTask();
    const reviewResult = await leader.reviewTask(mission, task, {});

    expect(reviewResult.decision).toBe("revision_needed");
    expect(reviewResult.score).toBe(65);
  });

  it("should synthesize results and return summary", async () => {
    mockFacade.chat.mockResolvedValue({
      content:
        "本次 PPT 生成完成，共 10 页，质量优秀。亮点：内容丰富。待优化：可增加图表。",
      tokensUsed: 100,
    });

    const mission = buildMission({
      tasks: [
        buildTask({ status: "completed" }),
        buildTask({ id: "task-002", status: "completed" }),
      ],
      pages: [
        {
          pageNumber: 1,
          html: "<html></html>",
          templateId: "cover",
          title: "Cover",
        },
      ] as any,
      totalTasks: 2,
      completedTasks: 2,
    });

    const result = await leader.synthesizeResults(mission);

    expect(result.success).toBe(true);
    expect(result.summary).toContain("PPT");
  });

  it("should normalize skill IDs with comma-separated values", async () => {
    const aiResponse = `### 任务理解
Test.

### 任务列表
| 序号 | 任务标题 | 描述 | 负责人 | 技能ID | 优先级 | 依赖 |
|------|----------|------|--------|--------|--------|------|
| 1 | 任务 | 描述 | analyst | task-decomposition,content-analysis | high | - |

### 执行计划
Sequential.

### 风险提示
None.`;

    mockFacade.chat.mockResolvedValue({ content: aiResponse, tokensUsed: 100 });

    const mission = buildMission();
    const breakdown = await leader.planTasks(mission);

    // Should take only first skill and normalize it
    expect(breakdown.tasks[0].skillId).toBe("slides-task-decomposition");
  });

  it("should normalize assignee values correctly", async () => {
    const aiResponse = `### 任务理解
Test.

### 任务列表
| 序号 | 任务标题 | 描述 | 负责人 | 技能ID | 优先级 | 依赖 |
|------|----------|------|--------|--------|--------|------|
| 1 | Analyze | Desc | designer | page-pipeline | high | - |

### 执行计划
Sequential.

### 风险提示
None.`;

    mockFacade.chat.mockResolvedValue({ content: aiResponse, tokensUsed: 80 });

    const mission = buildMission();
    const breakdown = await leader.planTasks(mission);

    // designer → writer (default for design tasks)
    expect(breakdown.tasks[0].assignee).toBe("writer");
  });

  it("should return default tasks from createDefaultTasks", () => {
    const defaultTasks = leader.createDefaultTasks();

    expect(defaultTasks).toHaveLength(3);
    expect(defaultTasks[0].title).toBe("任务分解");
    expect(defaultTasks[1].title).toBe("生成大纲");
    expect(defaultTasks[2].title).toBe("生成页面内容");
    expect(defaultTasks[1].dependsOn).toContain(0);
    expect(defaultTasks[2].dependsOn).toContain(1);
  });
});
