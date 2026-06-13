import { PrismaClient } from "@prisma/client";
import { PdfThumbnailService } from "../modules/resources/pdf-thumbnail.service";
import axios from "axios";
import * as cheerio from "cheerio";

/**
 * 批量生成所有类型资源的缩略图
 * - PAPER/REPORT/POLICY: 从PDF生成缩略图
 * - BLOG/NEWS: 从og:image或文章首图提取
 * - YOUTUBE: 使用YouTube缩略图URL
 */
async function generateAllThumbnails() {
  const prisma = new PrismaClient();
  const pdfThumbnailService = new PdfThumbnailService();

  const stats = {
    paper: { total: 0, success: 0, failed: 0, skipped: 0 },
    blog: { total: 0, success: 0, failed: 0, skipped: 0 },
    news: { total: 0, success: 0, failed: 0, skipped: 0 },
    youtube: { total: 0, success: 0, failed: 0, skipped: 0 },
  };

  try {
    console.log(
      "================================================================================",
    );
    console.log("📸 批量生成所有类型资源缩略图");
    console.log(
      "================================================================================\n",
    );

    // ==================== 1. 处理 PAPER/REPORT/POLICY (PDF) ====================
    console.log("📄 处理 PAPER/REPORT/POLICY 类型资源 (PDF缩略图)...\n");

    const pdfResources = await prisma.resource.findMany({
      where: {
        type: { in: ["PAPER", "REPORT", "POLICY"] },
        pdfUrl: { not: null },
        thumbnailUrl: null,
      },
      select: {
        id: true,
        title: true,
        pdfUrl: true,
        type: true,
      },
      take: 100, // 限制每批处理数量
    });

    stats.paper.total = pdfResources.length;
    console.log(`  找到 ${pdfResources.length} 个PDF资源需要生成缩略图\n`);

    for (const resource of pdfResources) {
      try {
        console.log(`  处理: ${resource.title?.substring(0, 50)}...`);
        const thumbnailUrl = await pdfThumbnailService.generateThumbnail(
          resource.pdfUrl!,
          resource.id,
        );

        if (thumbnailUrl) {
          await prisma.resource.update({
            where: { id: resource.id },
            data: { thumbnailUrl },
          });
          stats.paper.success++;
          console.log(`    ✅ 成功: ${thumbnailUrl}`);
        } else {
          stats.paper.failed++;
          console.log(`    ❌ 失败`);
        }
      } catch (error) {
        stats.paper.failed++;
        console.log(`    ❌ 错误: ${(error as Error).message}`);
      }

      // 添加延迟避免过快请求
      await sleep(500);
    }

    // ==================== 2. 处理 BLOG/NEWS (OG Image) ====================
    console.log("\n📰 处理 BLOG/NEWS 类型资源 (OG Image)...\n");

    const webResources = await prisma.resource.findMany({
      where: {
        type: { in: ["BLOG", "NEWS"] },
        thumbnailUrl: null,
      },
      select: {
        id: true,
        title: true,
        sourceUrl: true,
        type: true,
      },
      take: 100,
    });

    const blogCount = webResources.filter((r) => r.type === "BLOG").length;
    const newsCount = webResources.filter((r) => r.type === "NEWS").length;
    stats.blog.total = blogCount;
    stats.news.total = newsCount;

    console.log(
      `  找到 ${blogCount} 个BLOG, ${newsCount} 个NEWS 需要提取封面图\n`,
    );

    for (const resource of webResources) {
      try {
        console.log(`  处理: ${resource.title?.substring(0, 50)}...`);
        const imageUrl = await extractOgImage(resource.sourceUrl);

        if (imageUrl) {
          await prisma.resource.update({
            where: { id: resource.id },
            data: { thumbnailUrl: imageUrl },
          });

          if (resource.type === "BLOG") {
            stats.blog.success++;
          } else {
            stats.news.success++;
          }
          console.log(`    ✅ 成功: ${imageUrl.substring(0, 80)}...`);
        } else {
          if (resource.type === "BLOG") {
            stats.blog.failed++;
          } else {
            stats.news.failed++;
          }
          console.log(`    ⚠️ 未找到封面图`);
        }
      } catch (error) {
        if (resource.type === "BLOG") {
          stats.blog.failed++;
        } else {
          stats.news.failed++;
        }
        console.log(`    ❌ 错误: ${(error as Error).message}`);
      }

      await sleep(300);
    }

    // ==================== 3. 处理 YOUTUBE (缩略图URL) ====================
    console.log("\n🎬 处理 YOUTUBE 类型资源 (YouTube缩略图)...\n");

    const youtubeResources = await prisma.resource.findMany({
      where: {
        type: "YOUTUBE_VIDEO",
        thumbnailUrl: null,
      },
      select: {
        id: true,
        title: true,
        sourceUrl: true,
        metadata: true,
      },
      take: 100,
    });

    stats.youtube.total = youtubeResources.length;
    console.log(
      `  找到 ${youtubeResources.length} 个YouTube视频需要提取缩略图\n`,
    );

    for (const resource of youtubeResources) {
      try {
        console.log(`  处理: ${resource.title?.substring(0, 50)}...`);
        const videoId = extractYouTubeVideoId(resource.sourceUrl);

        if (videoId) {
          // YouTube缩略图URL格式
          const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

          await prisma.resource.update({
            where: { id: resource.id },
            data: { thumbnailUrl },
          });
          stats.youtube.success++;
          console.log(`    ✅ 成功: ${thumbnailUrl}`);
        } else {
          stats.youtube.failed++;
          console.log(`    ⚠️ 无法提取视频ID`);
        }
      } catch (error) {
        stats.youtube.failed++;
        console.log(`    ❌ 错误: ${(error as Error).message}`);
      }
    }

    // ==================== 统计结果 ====================
    console.log(
      "\n================================================================================",
    );
    console.log("📊 生成统计:");
    console.log(
      `  📄 PAPER/REPORT/POLICY: ${stats.paper.success}/${stats.paper.total} 成功`,
    );
    console.log(`  📰 BLOG: ${stats.blog.success}/${stats.blog.total} 成功`);
    console.log(`  📰 NEWS: ${stats.news.success}/${stats.news.total} 成功`);
    console.log(
      `  🎬 YOUTUBE: ${stats.youtube.success}/${stats.youtube.total} 成功`,
    );
    console.log(
      "================================================================================\n",
    );
  } catch (error) {
    console.error("❌ 批量生成失败:", error);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 从URL提取OG Image
 */
async function extractOgImage(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    // 尝试多种方式获取封面图
    const ogImage =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="og:image"]').attr("content") ||
      $('meta[property="twitter:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('meta[name="thumbnail"]').attr("content") ||
      $('link[rel="image_src"]').attr("href");

    if (ogImage) {
      // 处理相对路径
      if (ogImage.startsWith("//")) {
        return `https:${ogImage}`;
      } else if (ogImage.startsWith("/")) {
        const urlObj = new URL(url);
        return `${urlObj.origin}${ogImage}`;
      }
      return ogImage;
    }

    // 如果没有OG Image，尝试获取文章中的第一张图片
    const firstImage =
      $("article img").first().attr("src") ||
      $(".post-content img").first().attr("src") ||
      $(".entry-content img").first().attr("src") ||
      $("main img").first().attr("src");

    if (firstImage) {
      if (firstImage.startsWith("//")) {
        return `https:${firstImage}`;
      } else if (firstImage.startsWith("/")) {
        const urlObj = new URL(url);
        return `${urlObj.origin}${firstImage}`;
      }
      return firstImage;
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 从YouTube URL提取视频ID
 */
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void generateAllThumbnails();
