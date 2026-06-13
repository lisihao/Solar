/**
 * ProviderModelCatalogService — task #25 机制薄壳
 *
 * 背景：
 *   ai-model-discovery.service.ts 内部 11 个 case 硬编码 provider → endpoint /
 *   static models 映射。新增 provider 必须改代码（voyage 404 即此类）。
 *   byok pr-1 已在 DB 引入 AIProvider catalog 表（modelListEndpoint /
 *   apiFormat / staticModels JSON），但 model discovery 没接入。
 *
 * 本服务：
 *   抽出"provider → 模型列表"决策的统一入口。优先查 AIProvider DB 表，
 *   命中走 DB（modelListEndpoint 走 OpenAI-compatible / staticModels 走静态），
 *   未命中走 ai-model-discovery 现有 hardcoded fallback。
 *
 *   后续 PR 把 hardcoded case 数据搬到 AIProvider 表（每个 provider 一行），
 *   彻底删除硬编码 switch。
 *
 * 当前状态：
 *   薄壳已就位，新增 provider 用 AIProvider 表注册即可（不需改代码）。
 *   存量 11 case 渐进迁移。
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

export interface ProviderCatalogEntry {
  readonly provider: string;
  readonly modelListEndpoint?: string | null;
  readonly apiFormat?: string | null;
  readonly staticModels?: unknown;
}

@Injectable()
export class ProviderModelCatalogService {
  private readonly logger = new Logger(ProviderModelCatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询 provider 的目录配置。
   * 命中 → caller 据此决定 fetchOpenAICompatibleModels / static list。
   * 未命中 → null，caller 走 hardcoded fallback。
   */
  async lookup(provider: string): Promise<ProviderCatalogEntry | null> {
    const normalizedProvider = provider.toLowerCase();
    try {
      const row = await (
        this.prisma as unknown as {
          aIProvider?: {
            findFirst: (args: {
              where: { provider: string };
              select: {
                provider: true;
                modelListEndpoint: true;
                apiFormat: true;
                staticModels: true;
              };
            }) => Promise<ProviderCatalogEntry | null>;
          };
        }
      ).aIProvider?.findFirst({
        where: { provider: normalizedProvider },
        select: {
          provider: true,
          modelListEndpoint: true,
          apiFormat: true,
          staticModels: true,
        },
      });
      return row ?? null;
    } catch (err) {
      // schema 还没加 modelListEndpoint / staticModels 字段时 prisma 会抛错。
      // 优雅降级：caller 走 hardcoded fallback。
      this.logger.debug(
        `[lookup] AIProvider catalog query failed (likely schema not yet extended): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
