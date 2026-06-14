import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function check() {
  try {
    console.log("🔍 Checking data_sources table...");

    // Try to get raw data
    const rawData = await prisma.$queryRaw`
      SELECT id, name, type, category,
             pg_typeof(crawler_config) as crawler_config_type,
             pg_typeof(deduplication_config) as dedup_config_type
      FROM data_sources
      LIMIT 3;
    `;

    console.log("Raw data types:", rawData);

    // Try normal query
    const sources = await prisma.dataSource.findMany({
      take: 3,
    });

    console.log(`\nFound ${sources.length} data sources via Prisma`);
  } catch (error: any) {
    console.error("Error:", error.message);
    console.error("Code:", error.code);
  } finally {
    await prisma.$disconnect();
  }
}

check();
