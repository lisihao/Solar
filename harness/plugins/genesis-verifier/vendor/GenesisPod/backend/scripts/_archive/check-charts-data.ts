/**
 * Diagnostic script to check chart data in database
 *
 * 在生产环境运行:
 * railway run npx ts-node scripts/check-charts-data.ts <topicId>
 *
 * 或在本地连接生产数据库:
 * DATABASE_URL="postgresql://..." npx ts-node scripts/check-charts-data.ts <topicId>
 */

import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const topicId = process.argv[2] || "8e28c9d6-b156-4df7-9bb0-56a54f5dafae";

  console.log("\n=== 检查图表数据 ===");
  console.log(`Topic ID: ${topicId}\n`);

  // 1. 检查报告的 charts 字段
  console.log("--- 1. 报告 charts 字段 ---");
  const report = await prisma.topicReport.findFirst({
    where: { topicId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      charts: true,
    },
  });

  if (!report) {
    console.log("❌ 未找到报告");
  } else {
    const charts = report.charts as unknown[];
    console.log(`报告 ID: ${report.id}`);
    console.log(`版本: ${report.version}`);
    console.log(`图表数量: ${Array.isArray(charts) ? charts.length : 0}`);
    if (Array.isArray(charts) && charts.length > 0) {
      console.log("图表预览:", JSON.stringify(charts.slice(0, 2), null, 2));
    }
  }

  // 2. 检查维度分析的 dataPoints 中的图表引用
  console.log(
    "\n--- 2. 维度分析 dataPoints (figureReferences & generatedCharts) ---",
  );
  const dimensionAnalyses = await prisma.dimensionAnalysis.findMany({
    where: { reportId: report?.id },
    select: {
      id: true,
      dimension: { select: { name: true } },
      dataPoints: true,
    },
  });

  for (const da of dimensionAnalyses) {
    const dataPoints = da.dataPoints as Record<string, unknown> | null;
    const figureRefs = (dataPoints?.figureReferences as unknown[]) || [];
    const generatedCharts = (dataPoints?.generatedCharts as unknown[]) || [];
    console.log(`\n维度: ${da.dimension.name}`);
    console.log(`  figureReferences: ${figureRefs.length} 个`);
    console.log(`  generatedCharts: ${generatedCharts.length} 个`);
    if (figureRefs.length > 0) {
      console.log(
        "  figureReferences 预览:",
        JSON.stringify(figureRefs[0], null, 2),
      );
    }
    if (generatedCharts.length > 0) {
      console.log(
        "  generatedCharts 预览:",
        JSON.stringify(generatedCharts[0], null, 2),
      );
    }
  }

  // 3. 检查证据的 extractedFigures（存储在元数据中）
  console.log("\n--- 3. 证据 extractedFigures (如存储) ---");
  const evidences = await prisma.topicEvidence.findMany({
    where: { reportId: report?.id },
    take: 5,
    select: {
      id: true,
      title: true,
      url: true,
    },
  });
  console.log(`证据总数: ${evidences.length} 条（显示前5条）`);
  // Note: extractedFigures 可能存储在不同位置，需要检查

  // 4. 检查 topic 的 enableFigures 配置
  console.log("\n--- 4. Topic 配置 (enableFigures) ---");
  const topic = await prisma.researchTopic.findUnique({
    where: { id: topicId },
    select: {
      id: true,
      name: true,
      topicConfig: true,
    },
  });

  if (topic) {
    const config = topic.topicConfig as Record<string, unknown> | null;
    console.log(`Topic: ${topic.name}`);
    console.log(
      `enableFigures: ${config?.enableFigures !== false ? "true (默认)" : "false (已禁用)"}`,
    );
    if (config) {
      console.log("完整配置:", JSON.stringify(config, null, 2));
    }
  }

  console.log("\n=== 检查完成 ===\n");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
