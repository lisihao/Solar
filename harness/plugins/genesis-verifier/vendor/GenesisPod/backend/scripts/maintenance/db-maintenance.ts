/**
 * 数据库维护脚本 - 诊断和优化
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log("=== 数据库诊断 ===\n");

    // 1. 数据库大小
    const sizeResult = await prisma.$queryRaw<any[]>`
      SELECT pg_database_size(current_database()) / 1024 / 1024 as size_mb
    `;
    console.log(`数据库大小: ${sizeResult[0].size_mb} MB`);

    // 2. 活跃连接数
    const connResult = await prisma.$queryRaw<any[]>`
      SELECT count(*) as active_connections 
      FROM pg_stat_activity 
      WHERE state = 'active'
    `;
    console.log(`活跃连接数: ${connResult[0].active_connections}`);

    // 3. 表大小排名
    console.log("\n=== 表大小排名 (Top 10) ===");
    const tableSize = await prisma.$queryRaw<any[]>`
      SELECT 
        relname as table_name,
        pg_size_pretty(pg_total_relation_size(relid)) as total_size,
        pg_size_pretty(pg_relation_size(relid)) as data_size,
        n_live_tup as row_count
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 10
    `;
    tableSize.forEach((t, i) => {
      console.log(
        `${i + 1}. ${t.table_name}: ${t.total_size} (${t.row_count} rows)`,
      );
    });

    // 4. 执行 VACUUM ANALYZE
    console.log("\n=== 执行 VACUUM ANALYZE ===");
    await prisma.$executeRaw`VACUUM ANALYZE`;
    console.log("VACUUM ANALYZE 完成");

    // 5. 检查索引使用情况
    console.log("\n=== 未使用的索引 ===");
    const unusedIndexes = await prisma.$queryRaw<any[]>`
      SELECT 
        schemaname || '.' || relname AS table,
        indexrelname AS index,
        pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
        idx_scan as scans
      FROM pg_stat_user_indexes ui
      JOIN pg_index i ON ui.indexrelid = i.indexrelid
      WHERE NOT indisunique AND idx_scan < 50
      ORDER BY pg_relation_size(i.indexrelid) DESC
      LIMIT 5
    `;
    if (unusedIndexes.length > 0) {
      unusedIndexes.forEach((idx) => {
        console.log(
          `  ${idx.index} on ${idx.table}: ${idx.index_size} (${idx.scans} scans)`,
        );
      });
    } else {
      console.log("  没有发现未使用的索引");
    }

    console.log("\n=== 诊断完成 ===");
  } catch (error) {
    console.error("错误:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
