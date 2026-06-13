/**
 * 数据完整性验证脚本
 * 检查MongoDB和PostgreSQL之间的数据一致性
 */

import { PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";

const prisma = new PrismaClient();

interface ValidationResult {
  mongodb: {
    totalRawData: number;
    withResourceRef: number;
    withoutResourceRef: number;
    bySources: Record<string, number>;
  };
  postgresql: {
    totalResources: number;
    withRawDataRef: number;
    withoutRawDataRef: number;
    bySourceType: Record<string, number>;
  };
  consistency: {
    orphanedRawData: number; // MongoDB有但PostgreSQL没有的
    orphanedResources: number; // PostgreSQL有但MongoDB没有的
    validReferences: number; // 双向引用正确的
  };
  deduplication: {
    totalChecks: number;
    duplicatesFound: number;
    byMethod: Record<string, number>;
  };
}

async function validateDataIntegrity(): Promise<ValidationResult> {
  console.log("🔍 Starting data integrity validation...\n");

  const result: ValidationResult = {
    mongodb: {
      totalRawData: 0,
      withResourceRef: 0,
      withoutResourceRef: 0,
      bySources: {},
    },
    postgresql: {
      totalResources: 0,
      withRawDataRef: 0,
      withoutRawDataRef: 0,
      bySourceType: {},
    },
    consistency: {
      orphanedRawData: 0,
      orphanedResources: 0,
      validReferences: 0,
    },
    deduplication: {
      totalChecks: 0,
      duplicatesFound: 0,
      byMethod: {},
    },
  };

  try {
    // 1. 验证MongoDB数据
    console.log("📊 Checking MongoDB data...");
    const mongoUrl =
      process.env.MONGO_URL || "mongodb://localhost:27017/deepdive";
    const mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    const db = mongoClient.db();
    const rawDataCollection = db.collection("data_collection_raw_data");

    // 总数
    result.mongodb.totalRawData = await rawDataCollection.countDocuments();

    // 有resourceId的
    result.mongodb.withResourceRef = await rawDataCollection.countDocuments({
      resourceId: { $ne: null, $exists: true },
    });

    // 没有resourceId的
    result.mongodb.withoutResourceRef = await rawDataCollection.countDocuments({
      $or: [{ resourceId: null }, { resourceId: { $exists: false } }],
    });

    // 按来源统计
    const sourceAgg = await rawDataCollection
      .aggregate([
        { $group: { _id: "$source", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    sourceAgg.forEach((item: any) => {
      result.mongodb.bySources[item._id] = item.count;
    });

    console.log(`  Total raw data: ${result.mongodb.totalRawData}`);
    console.log(`  With resource reference: ${result.mongodb.withResourceRef}`);
    console.log(
      `  Without resource reference: ${result.mongodb.withoutResourceRef}`,
    );
    console.log(`  By sources:`, result.mongodb.bySources);

    // 2. 验证PostgreSQL数据
    console.log("\n📊 Checking PostgreSQL data...");

    result.postgresql.totalResources = await prisma.resource.count();

    result.postgresql.withRawDataRef = await prisma.resource.count({
      where: { rawDataId: { not: null } },
    });

    result.postgresql.withoutRawDataRef = await prisma.resource.count({
      where: { OR: [{ rawDataId: null }, { rawDataId: "" }] },
    });

    // 按来源类型统计
    const typeStats = await prisma.resource.groupBy({
      by: ["sourceType"],
      _count: true,
    });

    typeStats.forEach((item) => {
      if (item.sourceType) {
        result.postgresql.bySourceType[item.sourceType] = item._count;
      }
    });

    console.log(`  Total resources: ${result.postgresql.totalResources}`);
    console.log(
      `  With raw data reference: ${result.postgresql.withRawDataRef}`,
    );
    console.log(
      `  Without raw data reference: ${result.postgresql.withoutRawDataRef}`,
    );
    console.log(`  By source type:`, result.postgresql.bySourceType);

    // 3. 验证引用一致性
    console.log("\n🔗 Checking reference consistency...");

    // 检查有rawDataId的resources，验证MongoDB中是否存在
    const resourcesWithRawDataId = await prisma.resource.findMany({
      where: { rawDataId: { not: null } },
      select: { id: true, rawDataId: true },
    });

    let validRefs = 0;
    let orphanedResources = 0;

    for (const resource of resourcesWithRawDataId) {
      if (!resource.rawDataId) continue;

      try {
        const { ObjectId } = await import("mongodb");
        const rawData = await rawDataCollection.findOne({
          _id: new ObjectId(resource.rawDataId),
        });

        if (rawData) {
          if (rawData.resourceId === resource.id) {
            validRefs++;
          } else {
            console.warn(
              `  ⚠️  Mismatch: Resource ${resource.id} → rawData ${resource.rawDataId}, but rawData.resourceId = ${rawData.resourceId}`,
            );
          }
        } else {
          orphanedResources++;
          console.warn(
            `  ⚠️  Orphaned resource ${resource.id}: rawDataId ${resource.rawDataId} not found in MongoDB`,
          );
        }
      } catch (error) {
        console.error(`  ❌ Error checking resource ${resource.id}:`, error);
      }
    }

    result.consistency.validReferences = validRefs;
    result.consistency.orphanedResources = orphanedResources;

    // 检查有resourceId的raw_data，验证PostgreSQL中是否存在
    const rawDataWithResourceId = await rawDataCollection
      .find({ resourceId: { $ne: null, $exists: true } })
      .toArray();

    let orphanedRawData = 0;
    for (const rawData of rawDataWithResourceId) {
      const resource = await prisma.resource.findUnique({
        where: { id: rawData.resourceId },
      });

      if (!resource) {
        orphanedRawData++;
        console.warn(
          `  ⚠️  Orphaned raw_data ${rawData._id}: resourceId ${rawData.resourceId} not found in PostgreSQL`,
        );
      }
    }

    result.consistency.orphanedRawData = orphanedRawData;

    console.log(`  Valid bi-directional references: ${validRefs}`);
    console.log(`  Orphaned resources (no raw_data): ${orphanedResources}`);
    console.log(`  Orphaned raw_data (no resource): ${orphanedRawData}`);

    // 4. 验证去重
    console.log("\n🔍 Checking deduplication...");

    const deduplicationRecords = await prisma.deduplicationRecord.count();
    result.deduplication.totalChecks = deduplicationRecords;

    const dedupByMethod = await prisma.deduplicationRecord.groupBy({
      by: ["method"],
      _count: true,
    });

    dedupByMethod.forEach((item) => {
      result.deduplication.byMethod[item.method] = item._count;
    });

    const duplicatesSkipped = await prisma.deduplicationRecord.count({
      where: { decision: "AUTO_SKIP" },
    });
    result.deduplication.duplicatesFound = duplicatesSkipped;

    console.log(`  Total deduplication checks: ${deduplicationRecords}`);
    console.log(`  Duplicates found and skipped: ${duplicatesSkipped}`);
    console.log(`  By method:`, result.deduplication.byMethod);

    // 关闭连接
    await mongoClient.close();

    // 5. 生成报告
    console.log("\n📋 Validation Summary:");
    console.log("=".repeat(50));

    const mongoRefPercentage =
      result.mongodb.totalRawData > 0
        ? (
            (result.mongodb.withResourceRef / result.mongodb.totalRawData) *
            100
          ).toFixed(2)
        : "0";
    const pgRefPercentage =
      result.postgresql.totalResources > 0
        ? (
            (result.postgresql.withRawDataRef /
              result.postgresql.totalResources) *
            100
          ).toFixed(2)
        : "0";

    console.log(
      `\nMongoDB Coverage: ${mongoRefPercentage}% (${result.mongodb.withResourceRef}/${result.mongodb.totalRawData})`,
    );
    console.log(
      `PostgreSQL Coverage: ${pgRefPercentage}% (${result.postgresql.withRawDataRef}/${result.postgresql.totalResources})`,
    );
    console.log(
      `\nData Consistency: ${result.consistency.validReferences} valid references`,
    );

    if (
      result.consistency.orphanedRawData > 0 ||
      result.consistency.orphanedResources > 0
    ) {
      console.log(`\n⚠️  Issues Found:`);
      if (result.consistency.orphanedRawData > 0) {
        console.log(
          `  - ${result.consistency.orphanedRawData} orphaned raw_data entries`,
        );
      }
      if (result.consistency.orphanedResources > 0) {
        console.log(
          `  - ${result.consistency.orphanedResources} orphaned resources`,
        );
      }
    } else {
      console.log(`\n✅ No consistency issues found!`);
    }

    console.log(
      `\nDeduplication: ${result.deduplication.duplicatesFound} duplicates prevented`,
    );

    return result;
  } catch (error) {
    console.error("\n❌ Validation failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 运行验证
if (require.main === module) {
  validateDataIntegrity()
    .then((result) => {
      console.log("\n✅ Validation completed successfully!");
      console.log("\nFull results:");
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Validation failed:", error);
      process.exit(1);
    });
}

export { validateDataIntegrity };
