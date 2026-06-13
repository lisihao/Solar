/**
 * 集成测试 - 完整验证从 SlidesEngineService 到事件输出的流程
 * 运行: npx ts-node -r tsconfig-paths/register test/slides/integration.spec.ts
 */

import { EventEmitter2 } from "@nestjs/event-emitter";
import { SlidesTeamOrchestrator } from "@/modules/ai-app/office/slides/orchestrator/slides-team-orchestrator";
import { SlidesTeamMember } from "@/modules/ai-app/office/slides/orchestrator/slides-team-member";
import { SlidesLeader } from "@/modules/ai-app/office/slides/orchestrator/slides-leader";
import { SkillRegistry } from "@/modules/ai-engine/skills/registry/skill-registry";
import { PagePipelineSkill } from "@/modules/ai-app/office/slides/skills/page-pipeline.skill";
import { TemplateRenderingSkill } from "@/modules/ai-app/office/slides/skills/template-rendering.skill";
import { ContentCompressionSkill } from "@/modules/ai-app/office/slides/skills/content-compression.skill";
import { ChartRendererSkill } from "@/modules/ai-app/office/slides/skills/chart-renderer.skill";
import { SlidesMissionEvent } from "@/modules/ai-app/office/slides/orchestrator/types";

/**
 * 模拟 SlidesEngineService 的事件转换逻辑
 */
function transformSlidesMissionEvent(
  event: SlidesMissionEvent,
  _sessionId: string,
): { type: string; data: unknown }[] {
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

      console.log(`  task.skillId: "${task?.skillId}"`);
      console.log(`  data.result exists: ${!!data.result}`);
      console.log(`  task.result exists: ${!!task?.result}`);

      events.push({
        type: "agent:completed",
        data: { result: `${task?.title || "unknown"} 完成` },
      });

      // ★ 关键检查：page-pipeline 任务
      if (
        task?.skillId === "slides-page-pipeline" ||
        task?.skillId === "page-pipeline"
      ) {
        console.log(`  ★ PAGE-PIPELINE DETECTED!`);
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
                status?: string;
              };
              const html = page.html;
              console.log(
                `    Page ${i}: status=${page.status}, htmlLength=${html?.length || 0}`,
              );
              if (html) {
                events.push({
                  type: "slide:generated",
                  data: {
                    pageNumber: page.pageNumber || i + 1,
                    title: page.title,
                    contentLength: html.length,
                  },
                });
                console.log(`    ✓ Created slide:generated event`);
              }
            }
          } else {
            console.log(`  ✗ No pages array in result`);
          }
        } else {
          console.log(`  ✗ taskResult is null or not object`);
        }
      }
      break;
    }

    case "page:generated": {
      const pageIndex = (data.pageIndex as number) || 0;
      const page = data.page as {
        html?: string;
        renderedHtml?: string;
        spec?: { title?: string };
      };
      const html = page?.renderedHtml || page?.html;

      console.log(`  pageIndex: ${pageIndex}`);
      console.log(`  html exists: ${!!html}, length: ${html?.length || 0}`);

      if (html) {
        events.push({
          type: "slide:generated",
          data: {
            pageNumber: pageIndex + 1,
            title: page?.spec?.title || `第 ${pageIndex + 1} 页`,
            contentLength: html.length,
          },
        });
        console.log(`  ✓ Created slide:generated event from page:generated`);
      }
      break;
    }

    case "mission:completed":
      console.log(`  Mission completed!`);
      console.log(`  pages count: ${(data.pages as unknown[])?.length || 0}`);
      break;

    default:
      break;
  }

  return events;
}

async function runIntegrationTest() {
  console.log("=== 集成测试：完整流程验证 ===\n");

  // 1. 创建依赖
  const eventEmitter = new EventEmitter2();
  const chartRenderer = new ChartRendererSkill();
  const templateRendering = new TemplateRenderingSkill(chartRenderer);

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

  // Mock 技能
  const mockTaskDecomposition = {
    id: "slides-task-decomposition",
    name: "任务分解",
    description: "分解任务",
    layer: "domain",
    domain: "slides",
    execute: async () => ({
      success: true,
      data: {
        totalPages: 3,
        chapters: [
          { id: "ch1", title: "测试", pageRange: [1, 3], keyPoints: [] },
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
    name: "大纲规划",
    description: "规划大纲",
    layer: "domain",
    domain: "slides",
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
    name: "质量审计",
    description: "审计质量",
    layer: "domain",
    domain: "slides",
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

  // 2. 创建 SkillRegistry 并注册技能
  const skillRegistry = new SkillRegistry();
  skillRegistry.register(mockTaskDecomposition as any);
  skillRegistry.register(mockOutlinePlanning as any);
  skillRegistry.register(pagePipeline);
  skillRegistry.register(mockQualityAudit as any);

  console.log("已注册技能:");
  skillRegistry.getAll().forEach((s) => {
    console.log(`  - ${s.id}`);
  });

  // 3. 验证技能查找
  console.log("\n技能查找测试:");
  const testIds = [
    "slides-page-pipeline",
    "page-pipeline",
    "slides-task-decomposition",
    "task-decomposition",
  ];
  for (const id of testIds) {
    const skill = skillRegistry.tryGet(id);
    console.log(
      `  skillRegistry.tryGet("${id}"): ${skill ? "✓ 找到" : "✗ 未找到"}`,
    );
  }

  // 4. 创建 TeamMember
  const teamMember = new SlidesTeamMember(skillRegistry, null as any);

  // 5. 创建 Leader (mock)
  const leader = new SlidesLeader(null as any, null as any);

  // Mock planTasks 返回使用 slides-page-pipeline
  leader.planTasks = async () => ({
    understanding: "测试任务",
    tasks: [
      {
        title: "任务分解",
        description: "分析源文本",
        assignee: "analyst" as const,
        skillId: "slides-task-decomposition",
        priority: "high" as const,
        dependsOn: [],
        inputSpec: {},
      },
      {
        title: "生成大纲",
        description: "生成详细大纲",
        assignee: "analyst" as const,
        skillId: "slides-outline-planning",
        priority: "high" as const,
        dependsOn: [0],
        inputSpec: {},
      },
      {
        title: "生成页面",
        description: "生成页面HTML",
        assignee: "writer" as const,
        skillId: "slides-page-pipeline", // ★ 关键：使用 slides-page-pipeline
        priority: "high" as const,
        dependsOn: [1],
        inputSpec: {},
      },
      {
        title: "质量审计",
        description: "检查质量",
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

  leader.reviewTask = async () => ({
    decision: "approved" as const,
    feedback: "测试通过",
    score: 95,
  });

  // 6. 创建 Orchestrator
  const orchestrator = new SlidesTeamOrchestrator(leader, teamMember);

  // 7. 执行并收集所有事件
  const input = {
    userId: "test-user",
    sessionId: "test-session-" + Date.now(),
    sourceText: "这是测试源文本内容",
    userRequirement: "生成3页测试PPT",
    targetPages: 3,
    stylePreference: "dark" as const,
    themeId: "genspark-dark",
  };

  console.log("\n开始执行...\n");

  const allEvents: { type: string; data: unknown }[] = [];
  const slideGeneratedEvents: { type: string; data: unknown }[] = [];

  try {
    for await (const event of orchestrator.executeMission(input)) {
      const transformed = transformSlidesMissionEvent(event, input.sessionId);
      allEvents.push(...transformed);

      // 收集 slide:generated 事件
      const slideEvents = transformed.filter(
        (e) => e.type === "slide:generated",
      );
      slideGeneratedEvents.push(...slideEvents);
    }
  } catch (error) {
    console.error("\n执行错误:", error);
  }

  // 8. 输出结果
  console.log("\n" + "=".repeat(50));
  console.log("测试结果汇总");
  console.log("=".repeat(50));

  console.log(`\n总事件数: ${allEvents.length}`);
  console.log(`slide:generated 事件数: ${slideGeneratedEvents.length}`);

  if (slideGeneratedEvents.length > 0) {
    console.log("\n生成的幻灯片:");
    for (const e of slideGeneratedEvents) {
      const d = e.data as {
        pageNumber: number;
        title: string;
        contentLength: number;
      };
      console.log(
        `  Page ${d.pageNumber}: ${d.title} (${d.contentLength} chars)`,
      );
    }
    console.log("\n✓ 测试通过！slide:generated 事件正常生成");
  } else {
    console.log("\n✗ 测试失败！没有生成 slide:generated 事件");

    // 诊断信息
    console.log("\n诊断信息:");
    console.log("检查以下可能的问题:");
    console.log("1. PagePipelineSkill 是否成功执行并返回 pages 数组?");
    console.log(
      "2. task.skillId 是否匹配 'slides-page-pipeline' 或 'page-pipeline'?",
    );
    console.log("3. 事件数据结构是否正确 (data.result 或 task.result)?");
  }
}

// 运行
runIntegrationTest()
  .then(() => {
    console.log("\n=== 测试完成 ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n测试失败:", err);
    process.exit(1);
  });
