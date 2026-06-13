/**
 * 端到端测试 - 模拟完整的 slides 生成流程
 * 验证从 orchestrator 到事件转换的整个链路
 */

import { SlidesTeamOrchestrator } from "@/modules/ai-app/office/slides/orchestrator/slides-team-orchestrator";
import { SlidesTeamMember } from "@/modules/ai-app/office/slides/orchestrator/slides-team-member";
import { SlidesLeader } from "@/modules/ai-app/office/slides/orchestrator/slides-leader";
import { SkillRegistry } from "@/modules/ai-engine/skills/registry/skill-registry";
import { PagePipelineSkill } from "@/modules/ai-app/office/slides/skills/page-pipeline.skill";
import { TemplateRenderingSkill } from "@/modules/ai-app/office/slides/skills/template-rendering.skill";
import { ContentCompressionSkill } from "@/modules/ai-app/office/slides/skills/content-compression.skill";
import { ChartRendererSkill } from "@/modules/ai-app/office/slides/skills/chart-renderer.skill";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SlidesMissionEvent } from "@/modules/ai-app/office/slides/orchestrator/types";

// 模拟 SlidesEngineService.transformSlidesMissionEvent
function transformSlidesMissionEvent(
  event: SlidesMissionEvent,
  _sessionId: string,
) {
  const events: { type: string; data: unknown }[] = [];
  const { type, data } = event;

  console.log(`\n[Transform] Event: ${type}`);

  switch (type) {
    case "task:awaiting_review":
    case "task:completed": {
      const task = data.task as {
        skillId?: string;
        title?: string;
        result?: unknown;
      };

      console.log(`  task.skillId: ${task?.skillId}`);
      console.log(`  data.result exists: ${!!data.result}`);
      console.log(`  task.result exists: ${!!task?.result}`);

      events.push({
        type: "agent:completed",
        data: { result: `${task?.title || "unknown"} 完成` },
      });

      // 只有 page-pipeline 任务才提取 HTML
      if (
        task?.skillId === "slides-page-pipeline" ||
        task?.skillId === "page-pipeline"
      ) {
        console.log(`  ★ 检测到 page-pipeline 任务，提取 HTML...`);
        const taskResult = data.result || task?.result;

        if (taskResult && typeof taskResult === "object") {
          const resultObj = taskResult as Record<string, unknown>;
          console.log(`  result keys: ${Object.keys(resultObj).join(", ")}`);

          const pages = resultObj.pages as unknown[];
          if (pages && Array.isArray(pages)) {
            console.log(`  pages count: ${pages.length}`);
            for (let i = 0; i < pages.length; i++) {
              const page = pages[i] as {
                html?: string;
                pageNumber?: number;
                title?: string;
              };
              const html = page.html;
              if (html) {
                events.push({
                  type: "slide:generated",
                  data: {
                    pageNumber: page.pageNumber || i + 1,
                    title: page.title,
                    contentLength: html.length,
                  },
                });
                console.log(
                  `    ✓ Page ${page.pageNumber}: ${page.title} (${html.length} chars)`,
                );
              } else {
                console.log(`    ✗ Page ${i}: no HTML`);
              }
            }
          } else {
            console.log(`  ✗ No pages array!`);
          }
        } else {
          console.log(`  ✗ taskResult is null or not object!`);
        }
      }
      break;
    }

    case "mission:started":
    case "mission:phase_changed":
    case "mission:completed":
      events.push({ type, data: {} });
      break;
  }

  return events;
}

async function runE2ETest() {
  console.log("=== 端到端 Orchestrator 测试 ===\n");

  // 1. 创建依赖
  const eventEmitter = new EventEmitter2();
  const chartRenderer = new ChartRendererSkill();
  const templateRendering = new TemplateRenderingSkill(chartRenderer);

  // Mock ContentCompression
  const contentCompression = {
    execute: async () => ({
      success: false,
      error: { code: "MOCK", message: "跳过" },
    }),
  } as unknown as ContentCompressionSkill;

  const pagePipeline = new PagePipelineSkill(
    templateRendering,
    contentCompression,
    eventEmitter,
  );

  // Mock 其他 skills
  const mockTaskDecomposition = {
    id: "slides-task-decomposition",
    execute: async () => ({
      success: true,
      data: {
        totalPages: 3,
        chapters: [
          { id: "ch1", title: "测试章节", pageRange: [1, 3], keyPoints: [] },
        ],
        todoList: [],
        designStrategy: { colorScheme: "dark", accentColor: "#D4AF37" },
        sourceAnalysis: { totalWords: 100, language: "zh-CN", topics: [] },
      },
      metadata: {
        executionId: "test",
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
      },
    }),
  };

  const mockOutlinePlanning = {
    id: "slides-outline-planning",
    execute: async () => ({
      success: true,
      data: {
        title: "测试PPT",
        pages: [
          {
            pageNumber: 1,
            title: "封面",
            templateType: "cover",
            logicType: "narrative",
            contentBrief: "",
            keyElements: ["标题"],
            layoutHints: [],
          },
          {
            pageNumber: 2,
            title: "目录",
            templateType: "toc",
            logicType: "narrative",
            contentBrief: "",
            keyElements: ["章节1"],
            layoutHints: [],
          },
          {
            pageNumber: 3,
            title: "内容",
            templateType: "pillars",
            logicType: "parallel",
            contentBrief: "",
            keyElements: ["要点1", "要点2"],
            layoutHints: [],
          },
        ],
        globalStyles: {
          backgroundColor: "#0F172A",
          cardBackground: "#1E293B",
          borderColor: "#334155",
          accentColor: "#D4AF37",
          secondaryAccent: "#3B82F6",
          textPrimary: "#F8FAFC",
          textSecondary: "#94A3B8",
          fontFamily: "Noto Sans SC",
          canvasWidth: 1280,
          canvasHeight: 720,
          pagePadding: "50px",
          bottomSafeZone: 80,
        },
        contentFlow: {
          narrativeArc: "problem-solution",
          keyTransitions: [],
          conclusionStyle: "summary",
        },
      },
      metadata: {
        executionId: "test",
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
      },
    }),
  };

  const mockQualityAudit = {
    id: "slides-quality-audit",
    execute: async () => ({
      success: true,
      data: { overallScore: 85, issues: [], recommendations: [] },
      metadata: {
        executionId: "test",
        startTime: new Date(),
        endTime: new Date(),
        duration: 100,
      },
    }),
  };

  // 2. 创建 SkillRegistry
  const skillRegistry = new SkillRegistry();
  skillRegistry.register(mockTaskDecomposition as any);
  skillRegistry.register(mockOutlinePlanning as any);
  skillRegistry.register(pagePipeline);
  skillRegistry.register(mockQualityAudit as any);

  console.log(
    "Registered skills:",
    skillRegistry
      .getAll()
      .map((s) => s.id)
      .join(", "),
  );

  // 3. 创建 SlidesTeamMember
  const teamMember = new SlidesTeamMember(skillRegistry, null as any);

  // 4. 创建 SlidesLeader (mock aiChatService and prisma)
  const leader = new SlidesLeader(null as any, null as any);

  // Mock planTasks to return default tasks without calling AI
  leader.planTasks = async () => ({
    understanding: "测试任务",
    tasks: [
      {
        title: "任务分解",
        description: "分析源文本，分解为章节和页面任务",
        assignee: "analyst" as const,
        skillId: "slides-task-decomposition",
        priority: "high" as const,
        dependsOn: [],
        inputSpec: {},
      },
      {
        title: "生成大纲",
        description: "基于任务分解生成详细的页面大纲",
        assignee: "analyst" as const,
        skillId: "slides-outline-planning",
        priority: "high" as const,
        dependsOn: [0],
        inputSpec: {},
      },
      {
        title: "生成页面内容",
        description: "根据大纲逐页生成 HTML 内容",
        assignee: "writer" as const,
        skillId: "slides-page-pipeline",
        priority: "high" as const,
        dependsOn: [1],
        inputSpec: {},
      },
      {
        title: "质量审计",
        description: "检查整体质量和一致性",
        assignee: "reviewer" as const,
        skillId: "slides-quality-audit",
        priority: "medium" as const,
        dependsOn: [2],
        inputSpec: {},
      },
    ],
    executionPlan: "测试计划",
    risks: "",
  });

  // Mock reviewTask to auto-approve
  leader.reviewTask = async () => ({
    decision: "approved" as const,
    feedback: "测试通过",
    score: 95,
  });

  // 5. 创建 Orchestrator (leader, teamMember, repository?)
  const orchestrator = new SlidesTeamOrchestrator(leader, teamMember);

  // 6. 执行
  const input = {
    userId: "test-user",
    sessionId: "test-session",
    sourceText: "这是测试源文本内容，用于生成PPT。",
    userRequirement: "生成3页测试PPT",
    targetPages: 3,
    stylePreference: "dark" as const,
    themeId: "genspark-dark",
  };

  console.log("\n开始执行 orchestrator...\n");

  const allTransformedEvents: { type: string; data: unknown }[] = [];

  try {
    for await (const event of orchestrator.executeMission(input)) {
      const transformed = transformSlidesMissionEvent(event, input.sessionId);
      allTransformedEvents.push(...transformed);
    }
  } catch (error) {
    console.error("执行错误:", error);
  }

  console.log("\n=== 最终输出事件汇总 ===");
  console.log(`总事件数: ${allTransformedEvents.length}`);

  const slideEvents = allTransformedEvents.filter(
    (e) => e.type === "slide:generated",
  );
  console.log(`slide:generated 事件数: ${slideEvents.length}`);

  for (const e of slideEvents) {
    const d = e.data as {
      pageNumber: number;
      title: string;
      contentLength: number;
    };
    console.log(
      `  Page ${d.pageNumber}: ${d.title} (${d.contentLength} chars)`,
    );
  }

  if (slideEvents.length === 0) {
    console.log("\n❌ 没有生成 slide:generated 事件！");
  } else {
    console.log("\n✓ slide:generated 事件正常生成！");
  }
}

runE2ETest()
  .then(() => {
    console.log("\n=== 测试完成 ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("测试失败:", err);
    process.exit(1);
  });
