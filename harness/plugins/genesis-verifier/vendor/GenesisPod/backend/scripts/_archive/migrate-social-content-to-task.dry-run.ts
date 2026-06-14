/**
 * 干跑：连数据库但不执行 INSERT。
 * 仅 SELECT 统计 SocialContent 行数，估算迁移影响面。
 *
 * 使用：cd backend && npx ts-node scripts/migrate-social-content-to-task.dry-run.ts
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const total = await prisma.socialContent.count();
    const byStatus = await prisma.socialContent.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const byContentType = await prisma.socialContent.groupBy({
      by: ["contentType"],
      _count: { _all: true },
    });
    const bySourceType = await prisma.socialContent.groupBy({
      by: ["sourceType"],
      _count: { _all: true },
    });
    const withSource = await prisma.socialContent.count({
      where: { sourceId: { not: null } },
    });
    const withTitle = await prisma.socialContent.count({
      where: { title: { not: null } },
    });

    console.log("=== Migration dry-run: SocialContent → SocialContentTask ===");
    console.log(`Total SocialContent rows : ${total}`);
    console.log("By status       :", JSON.stringify(byStatus, null, 2));
    console.log("By contentType  :", JSON.stringify(byContentType, null, 2));
    console.log("By sourceType   :", JSON.stringify(bySourceType, null, 2));
    console.log(`With sourceId   : ${withSource}`);
    console.log(`With title      : ${withTitle}`);
    console.log("");
    console.log("Expected migration output:");
    console.log(`  SocialContentTask rows        : ${total}`);
    console.log(`  SocialContentTaskSource rows  : ${withSource}`);
    console.log(
      `  SocialContentTaskVersion rows : ${total}  (one per content row)`,
    );
    console.log("=== End ===");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
