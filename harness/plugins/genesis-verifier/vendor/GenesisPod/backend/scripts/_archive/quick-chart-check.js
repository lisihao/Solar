const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const topicId = process.argv[2] || "8e28c9d6-b156-4df7-9bb0-56a54f5dafae";

async function main() {
  console.log("\n=== 图表数据诊断 ===");
  console.log("Topic ID:", topicId);

  // 1. 检查报告 charts
  const report = await prisma.topicReport.findFirst({
    where: { topicId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, charts: true },
  });

  console.log("\n--- 1. 报告 charts 字段 ---");
  console.log("报告ID:", report?.id);
  console.log("版本:", report?.version);
  const chartsCount = Array.isArray(report?.charts) ? report.charts.length : 0;
  console.log("charts 数量:", chartsCount);

  if (chartsCount > 0) {
    console.log(
      "charts 预览:",
      JSON.stringify(report.charts.slice(0, 2), null, 2),
    );
  }

  // 2. 检查维度 dataPoints
  console.log("\n--- 2. 维度 figureReferences & generatedCharts ---");
  const dims = await prisma.dimensionAnalysis.findMany({
    where: { reportId: report?.id },
    select: {
      dimension: { select: { name: true } },
      dataPoints: true,
    },
  });

  let totalFigRefs = 0;
  let totalGenCharts = 0;

  for (const d of dims) {
    const dp = d.dataPoints || {};
    const figRefs = dp.figureReferences?.length || 0;
    const genCharts = dp.generatedCharts?.length || 0;
    totalFigRefs += figRefs;
    totalGenCharts += genCharts;
    console.log(
      `${d.dimension.name}: figureRefs=${figRefs}, generatedCharts=${genCharts}`,
    );
  }

  console.log(
    `\n总计: figureReferences=${totalFigRefs}, generatedCharts=${totalGenCharts}`,
  );

  // 3. 检查 topic 配置
  console.log("\n--- 3. Topic 配置 ---");
  const topic = await prisma.researchTopic.findUnique({
    where: { id: topicId },
    select: { name: true, topicConfig: true },
  });

  const config = topic?.topicConfig || {};
  console.log("Topic:", topic?.name);
  console.log(
    "enableFigures:",
    config.enableFigures !== false ? "true (启用)" : "false (禁用)",
  );

  console.log("\n=== 诊断结论 ===");
  if (chartsCount === 0 && totalFigRefs === 0 && totalGenCharts === 0) {
    console.log("❌ 问题定位: AI 研究员未生成任何图表引用");
    console.log("可能原因:");
    console.log("  1. 数据源网页中未提取到图表 (extractedFigures 为空)");
    console.log("  2. AI 未在输出中包含 figureReferences 字段");
    console.log("  3. AI 认为没有适合引用的图表");
  } else if (chartsCount === 0 && (totalFigRefs > 0 || totalGenCharts > 0)) {
    console.log("❌ 问题定位: 维度有图表数据，但未合并到报告");
    console.log("需要检查 ReportSynthesisService.collectAllCharts()");
  } else {
    console.log("✓ 图表数据正常，问题可能在前端渲染");
  }

  console.log("\n");
}

main()
  .catch((e) => console.error("Error:", e.message))
  .finally(() => prisma.$disconnect());
