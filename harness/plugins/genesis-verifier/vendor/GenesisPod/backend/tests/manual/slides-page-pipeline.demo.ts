/**
 * 本地测试脚本 - 验证 slides 生成流程
 * 运行: npx ts-node -r tsconfig-paths/register test/slides/page-pipeline.spec.ts
 */

import {
  PagePipelineSkill,
  PagePipelineOutput,
} from "@/modules/ai-app/office/slides/skills/page-pipeline.skill";
import { TemplateRenderingSkill } from "@/modules/ai-app/office/slides/skills/template-rendering.skill";
import { ContentCompressionSkill } from "@/modules/ai-app/office/slides/skills/content-compression.skill";
import { ChartRendererSkill } from "@/modules/ai-app/office/slides/skills/chart-renderer.skill";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { OutlinePlan } from "@/modules/ai-app/office/slides/checkpoint/checkpoint.types";

// Mock 数据
const mockOutlinePlan: OutlinePlan = {
  title: "测试演示文稿",
  pages: [
    {
      pageNumber: 1,
      title: "封面页",
      subtitle: "副标题",
      templateType: "cover",
      logicType: "narrative",
      contentBrief: "封面页内容",
      keyElements: ["标题", "副标题", "日期"],
      layoutHints: [],
    },
    {
      pageNumber: 2,
      title: "目录",
      subtitle: "CONTENTS",
      templateType: "toc",
      logicType: "narrative",
      contentBrief: "目录页",
      keyElements: ["章节1", "章节2", "章节3"],
      layoutHints: [],
    },
    {
      pageNumber: 3,
      title: "核心内容",
      subtitle: "要点",
      templateType: "pillars",
      logicType: "parallel",
      contentBrief: "三个核心支柱",
      keyElements: ["支柱1", "支柱2", "支柱3"],
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
    fontFamily: "Noto Sans SC, sans-serif",
    canvasWidth: 1280,
    canvasHeight: 720,
    pagePadding: "50px 80px 80px 80px",
    bottomSafeZone: 80,
  },
  contentFlow: {
    narrativeArc: "problem-solution",
    keyTransitions: [],
    conclusionStyle: "summary",
  },
};

async function testPagePipeline() {
  console.log("=== 开始测试 PagePipelineSkill ===\n");

  // 创建依赖
  const eventEmitter = new EventEmitter2();
  const chartRenderer = new ChartRendererSkill();
  const templateRendering = new TemplateRenderingSkill(chartRenderer);
  const contentCompression = {
    execute: async () => ({
      success: false,
      error: { code: "MOCK", message: "跳过内容压缩" },
    }),
  } as unknown as ContentCompressionSkill;

  const pagePipeline = new PagePipelineSkill(
    templateRendering,
    contentCompression,
    eventEmitter,
  );

  // 监听事件
  eventEmitter.on("slides.page.generated", (event) => {
    console.log(
      `[EVENT] page:generated - Page ${event.pageNumber}, HTML length: ${event.html?.length || 0}`,
    );
  });

  // 构造输入 - 模拟 buildSkillInput 的输出
  const input = {
    outline: mockOutlinePlan,
    sourceText: "这是测试源文本内容",
    themeId: "genspark-dark",
    task: "生成页面内容",
    context: {
      input: {
        sourceText: "这是测试源文本内容",
        themeId: "genspark-dark",
      },
    },
    previousOutputs: {
      "slides-outline-planning": mockOutlinePlan,
    },
  };

  console.log("输入结构:");
  console.log(`  - input.outline: ${!!input.outline}`);
  console.log(`  - input.outline.pages: ${input.outline?.pages?.length}`);
  console.log(
    `  - input.previousOutputs keys: ${Object.keys(input.previousOutputs).join(", ")}`,
  );
  console.log("");

  // 执行
  const context = {
    executionId: "test-execution",
    skillId: "slides-page-pipeline",
    sessionId: "test-session",
    userId: "test-user",
    createdAt: new Date(),
  };

  try {
    const result = await pagePipeline.execute(input, context);

    console.log("\n=== 执行结果 ===");
    console.log(`success: ${result.success}`);

    if (result.success && result.data) {
      const data = result.data as PagePipelineOutput;
      console.log(`totalPages: ${data.totalPages}`);
      console.log(`completedPages: ${data.completedPages}`);
      console.log(`failedPages: ${data.failedPages}`);
      console.log(`totalDuration: ${data.totalDuration}ms`);

      console.log("\n页面详情:");
      for (const page of data.pages) {
        console.log(`  Page ${page.pageNumber}: ${page.title}`);
        console.log(`    status: ${page.status}`);
        console.log(`    templateId: ${page.templateId}`);
        console.log(`    html length: ${page.html?.length || 0}`);
        if (page.error) {
          console.log(`    error: ${page.error}`);
        }
        if (page.html && page.html.length > 0) {
          console.log(`    html preview: ${page.html.substring(0, 100)}...`);
        }
      }
    } else {
      console.log(`error: ${JSON.stringify(result.error)}`);
    }
  } catch (error) {
    console.error("执行异常:", error);
  }
}

// 运行测试
testPagePipeline()
  .then(() => {
    console.log("\n=== 测试完成 ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error("测试失败:", err);
    process.exit(1);
  });
