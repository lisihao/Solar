/**
 * 统一导出系统 - 模板种子脚本
 * 用于初始化内置模板到数据库
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { Logger } from "@nestjs/common";
import { BUILTIN_TEMPLATES } from "./builtin-templates";

const prisma = new PrismaClient();

async function seedTemplates() {
  Logger.log("Seeding export templates...", "SeedTemplates");

  for (const template of BUILTIN_TEMPLATES) {
    const existing = await prisma.exportTemplate.findFirst({
      where: {
        name: template.name,
        isBuiltIn: true,
      },
    });

    if (existing) {
      // 更新现有模板
      await prisma.exportTemplate.update({
        where: { id: existing.id },
        data: {
          description: template.description,
          category: template.category,
          themeConfig: template.themeConfig as unknown as Prisma.InputJsonValue,
          layoutConfig:
            template.layoutConfig as unknown as Prisma.InputJsonValue,
          supportedFormats: template.supportedFormats,
          supportedSources: template.supportedSources,
          isDefault: template.isDefault ?? false,
          version: { increment: 1 },
        },
      });
      Logger.log(`Updated template: ${template.name}`, "SeedTemplates");
    } else {
      // 创建新模板
      await prisma.exportTemplate.create({
        data: {
          name: template.name,
          description: template.description,
          category: template.category,
          themeConfig: template.themeConfig as unknown as Prisma.InputJsonValue,
          layoutConfig:
            template.layoutConfig as unknown as Prisma.InputJsonValue,
          supportedFormats: template.supportedFormats,
          supportedSources: template.supportedSources,
          isBuiltIn: true,
          isDefault: template.isDefault ?? false,
          isPublic: true,
        },
      });
      Logger.log(`Created template: ${template.name}`, "SeedTemplates");
    }
  }

  Logger.log("Export templates seeded successfully!", "SeedTemplates");
}

// 如果直接运行此脚本
if (require.main === module) {
  seedTemplates()
    .catch((error) => {
      Logger.error("Failed to seed templates:", error, "SeedTemplates");
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { seedTemplates };
