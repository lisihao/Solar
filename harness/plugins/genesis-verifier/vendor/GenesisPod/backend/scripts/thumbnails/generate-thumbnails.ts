import { PrismaClient } from "@prisma/client";
import { PdfThumbnailService } from "../modules/resources/pdf-thumbnail.service";

/**
 * 批量生成PDF缩略图脚本
 */
async function generateThumbnails() {
  const prisma = new PrismaClient();
  const pdfThumbnailService = new PdfThumbnailService();

  try {
    console.log(
      "================================================================================",
    );
    console.log("📸 批量生成PDF缩略图");
    console.log(
      "================================================================================\n",
    );

    // 获取所有PAPER类型且有pdfUrl的资源
    const papers = await prisma.resource.findMany({
      where: {
        type: "PAPER",
        pdfUrl: {
          not: null,
        },
      },
      select: {
        id: true,
        title: true,
        pdfUrl: true,
        thumbnailUrl: true,
      },
    });

    console.log(`📊 找到 ${papers.length} 篇论文需要处理\n`);

    if (papers.length === 0) {
      console.log("✅ 没有需要生成缩略图的论文");
      return;
    }

    // 过滤掉已有缩略图的
    const papersNeedingThumbnails = papers.filter((p) => !p.thumbnailUrl);
    console.log(`🔄 其中 ${papersNeedingThumbnails.length} 篇需要生成缩略图\n`);

    if (papersNeedingThumbnails.length === 0) {
      console.log("✅ 所有论文都已有缩略图");
      return;
    }

    // 批量生成
    const resources = papersNeedingThumbnails.map((p) => ({
      id: p.id,
      pdfUrl: p.pdfUrl!,
    }));

    const stats = await pdfThumbnailService.generateBatchThumbnails(resources);

    console.log(
      "\n================================================================================",
    );
    console.log("📊 生成统计:");
    console.log(`  ✅ 成功: ${stats.success}`);
    console.log(`  ❌ 失败: ${stats.failed}`);
    console.log(`  ⏭️ 跳过: ${stats.skipped}`);
    console.log(
      "================================================================================\n",
    );

    // 更新数据库中的thumbnailUrl
    console.log("📝 更新数据库中的thumbnailUrl字段...\n");

    let updateCount = 0;
    for (const paper of papersNeedingThumbnails) {
      const thumbnailUrl = `/thumbnails/${paper.id}.jpg`;

      // 检查缩略图是否真的存在
      if (await pdfThumbnailService.thumbnailExists(paper.id)) {
        await prisma.resource.update({
          where: { id: paper.id },
          data: { thumbnailUrl },
        });

        console.log(`✅ ${paper.title}`);
        console.log(`   thumbnailUrl: ${thumbnailUrl}`);
        updateCount++;
      }
    }

    console.log(`\n✅ 数据库更新完成！共更新 ${updateCount} 条记录\n`);
    console.log(
      "================================================================================",
    );
  } catch (error) {
    console.error("❌ 批量生成失败:", error);
  } finally {
    await prisma.$disconnect();
  }
}

void generateThumbnails();
