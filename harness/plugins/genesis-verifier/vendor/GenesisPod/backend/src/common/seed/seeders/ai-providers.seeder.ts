import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ISeeder, SeederResult } from "./seeder.interface";
import { AI_PROVIDER_CATALOG } from "../data/ai-provider-catalog";

/**
 * AiProvidersSeeder —— 幂等同步 system scope 的 AI Provider 目录。
 *
 * 单一来源：`../data/ai-provider-catalog.ts`。取代此前散落在 SQL 迁移
 * （20260505b / 20260510b）+ seed-catalog.sql 的一次性 INSERT，让「新增内置
 * 供应商」从「再写一条迁移」变成「往 catalog 数组加一项，重启自动补齐」。
 *
 * 【create-only】只在「该 slug 的 system 行不存在」时 create，绝不 update 已存在行，
 * 因此不会覆盖 admin 在 /admin/ai-providers 改过的 endpoint / 启停状态
 * （与 SimulationProvidersSeeder 的「保留用户改动」语义一致）。
 */
@Injectable()
export class AiProvidersSeeder implements ISeeder {
  readonly name = "ai-providers";
  private readonly logger = new Logger(AiProvidersSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async sync(): Promise<SeederResult> {
    // 一次性取出全部 system scope slug，避免逐行查询。
    const existing = await this.prisma.aIProvider.findMany({
      where: { scope: "system", ownerUserId: null },
      select: { slug: true },
    });
    const existingSlugs = new Set(existing.map((p) => p.slug));

    let created = 0;
    for (const p of AI_PROVIDER_CATALOG) {
      if (existingSlugs.has(p.slug)) continue;
      await this.prisma.aIProvider.create({
        data: {
          slug: p.slug,
          name: p.name,
          endpoint: p.endpoint,
          apiFormat: p.apiFormat,
          testModel: p.testModel,
          capabilities: p.capabilities,
          displayOrder: p.displayOrder,
          docUrl: p.docUrl ?? null,
          freeTierNote: p.freeTierNote ?? null,
          description: p.description ?? null,
          isEnabled: true,
          scope: "system",
          ownerUserId: null,
        },
      });
      created++;
    }

    const skipped = AI_PROVIDER_CATALOG.length - created;
    if (created > 0) {
      this.logger.log(
        `Seeded ${created} new system AI provider(s); ${skipped} already present`,
      );
    }
    // create-only：不更新已存在行，故 updated 恒为 0。
    return { created, updated: 0, skipped };
  }
}
