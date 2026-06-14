import { PrismaClient } from "@prisma/client";

/**
 * 为 arXiv 论文更新缩略图URL
 * arXiv 提供官方的预览图服务
 */
async function updateArxivThumbnails() {
  const prisma = new PrismaClient();

  try {
    console.log(
      "================================================================================",
    );
    console.log("📸 更新 arXiv 论文缩略图");
    console.log(
      "================================================================================\n",
    );

    // 获取所有 arXiv 论文
    const papers = await prisma.resource.findMany({
      where: {
        type: "PAPER",
        sourceUrl: {
          contains: "arxiv.org",
        },
      },
      select: {
        id: true,
        title: true,
        sourceUrl: true,
        pdfUrl: true,
        thumbnailUrl: true,
        metadata: true,
      },
    });

    console.log(`📊 找到 ${papers.length} 篇 arXiv 论文\n`);

    if (papers.length === 0) {
      console.log("✅ 没有 arXiv 论文需要处理");
      return;
    }

    let updateCount = 0;
    let skipCount = 0;

    for (const paper of papers) {
      // 跳过已有缩略图的
      if (paper.thumbnailUrl) {
        skipCount++;
        continue;
      }

      // 从 metadata 或 URL 中提取 arxiv ID
      let arxivId: string | null = null;

      // 尝试从 metadata 获取
      if (paper.metadata && typeof paper.metadata === "object") {
        const metadata = paper.metadata as any;
        arxivId = metadata.arxivId;
      }

      // 如果 metadata 中没有，尝试从 URL 中提取
      if (!arxivId && paper.pdfUrl) {
        const match = paper.pdfUrl.match(/arxiv\.org\/(?:pdf|abs)\/(\d+\.\d+)/);
        if (match) {
          arxivId = match[1];
        }
      }

      if (!arxivId) {
        console.log(
          `⚠️  无法提取 arXiv ID: ${paper.title.substring(0, 50)}...`,
        );
        continue;
      }

      // 生成缩略图 URL
      // 使用 arXiv PDF URL，前端会使用 PDF.js 渲染缩略图
      const thumbnailUrl =
        paper.pdfUrl || `https://arxiv.org/pdf/${arxivId}.pdf`;

      // 更新数据库
      await prisma.resource.update({
        where: { id: paper.id },
        data: { thumbnailUrl },
      });

      console.log(`✅ ${paper.title.substring(0, 60)}...`);
      console.log(`   arXiv ID: ${arxivId}`);
      console.log(`   thumbnailUrl: ${thumbnailUrl}\n`);
      updateCount++;
    }

    console.log(
      "================================================================================",
    );
    console.log("📊 更新统计:");
    console.log(`  ✅ 更新: ${updateCount}`);
    console.log(`  ⏭️  跳过: ${skipCount}`);
    console.log(
      "================================================================================\n",
    );
  } catch (error) {
    console.error("❌ 更新失败:", error);
  } finally {
    await prisma.$disconnect();
  }
}

void updateArxivThumbnails();
