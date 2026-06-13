/**
 * 修复无效模型配置
 * 删除带有 # 后缀的无效 modelId
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Querying models with # suffix...");

  // 查询带 # 的模型
  const invalidModels = await prisma.aIModel.findMany({
    where: {
      modelId: {
        contains: "#",
      },
    },
    select: {
      id: true,
      name: true,
      modelId: true,
      provider: true,
      isEnabled: true,
    },
  });

  console.log(`Found ${invalidModels.length} models with # suffix:`);
  for (const model of invalidModels) {
    console.log(
      `  - ${model.modelId} (${model.provider}, enabled=${model.isEnabled})`,
    );
  }

  if (invalidModels.length === 0) {
    console.log("No invalid models found.");
    return;
  }

  // 删除这些模型
  console.log("\nDeleting invalid models...");
  const result = await prisma.aIModel.deleteMany({
    where: {
      modelId: {
        contains: "#",
      },
    },
  });

  console.log(`Deleted ${result.count} invalid models.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
