/**
 * SystemModelInventoryService — 系统模型全景
 *
 * 给管理员面板 /admin/ai/models 顶部的"系统模型"卡片用。
 * 聚合三类数据：
 * 1. 按 modelType / provider 分组的模型数
 * 2. 用户配置分布（user_model_configs 里每个模型被多少用户配了）
 * 3. 最近 24h LLM 调用量（ai_engine_metrics）+ 错误率
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

export interface SystemModelInventory {
  summary: {
    totalModels: number;
    enabledModels: number;
    distinctProviders: number;
    userConfiguredModels: number;
  };
  byType: Array<{
    modelType: string;
    total: number;
    enabled: number;
    providers: string[];
  }>;
  byProvider: Array<{
    provider: string;
    total: number;
    enabled: number;
    types: string[];
  }>;
  topModels: Array<{
    modelId: string;
    provider: string;
    modelType: string;
    userConfigCount: number;
    callsLast24h: number;
    errorsLast24h: number;
  }>;
  generatedAt: string;
}

@Injectable()
export class SystemModelInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getInventory(): Promise<SystemModelInventory> {
    const [
      totalModels,
      enabledModels,
      providersList,
      userConfiguredCount,
      byTypeRaw,
      byProviderRaw,
      topModelsRaw,
    ] = await Promise.all([
      this.prisma.aIModel.count(),
      this.prisma.aIModel.count({ where: { isEnabled: true } }),
      this.prisma.aIModel.findMany({
        distinct: ["provider"],
        select: { provider: true },
      }),
      this.prisma.userModelConfig.count({
        where: { isEnabled: true },
      }),
      this.prisma.$queryRawUnsafe<
        Array<{
          model_type: string;
          total: bigint;
          enabled: bigint;
          providers: string[];
        }>
      >(
        `SELECT model_type, COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE is_enabled)::bigint AS enabled,
                ARRAY_AGG(DISTINCT provider) AS providers
         FROM ai_models GROUP BY model_type ORDER BY COUNT(*) DESC`,
      ),
      this.prisma.$queryRawUnsafe<
        Array<{
          provider: string;
          total: bigint;
          enabled: bigint;
          types: string[];
        }>
      >(
        `SELECT provider, COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE is_enabled)::bigint AS enabled,
                ARRAY_AGG(DISTINCT model_type::text) AS types
         FROM ai_models GROUP BY provider ORDER BY COUNT(*) DESC`,
      ),
      this.prisma.$queryRawUnsafe<
        Array<{
          model_id: string;
          provider: string;
          model_type: string;
          user_count: bigint;
        }>
      >(
        `SELECT model_id, provider, model_type::text,
                COUNT(DISTINCT user_id)::bigint AS user_count
         FROM user_model_configs WHERE is_enabled
         GROUP BY model_id, provider, model_type
         ORDER BY user_count DESC LIMIT 10`,
      ),
    ]);

    // 24h 调用量 / 错误率（按 model_id）
    // ai_engine_metrics 用的是 `success BOOLEAN`，不是 `status` 列
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const metricsRaw = await this.prisma.$queryRawUnsafe<
      Array<{
        model_id: string;
        calls: bigint;
        errors: bigint;
      }>
    >(
      `SELECT model_id,
              COUNT(*)::bigint AS calls,
              COUNT(*) FILTER (WHERE success = false)::bigint AS errors
       FROM ai_engine_metrics
       WHERE created_at >= $1 AND model_id IS NOT NULL
       GROUP BY model_id`,
      since,
    );
    const metricsMap = new Map(
      metricsRaw.map((r) => [
        r.model_id,
        { calls: Number(r.calls), errors: Number(r.errors) },
      ]),
    );

    return {
      summary: {
        totalModels,
        enabledModels,
        distinctProviders: providersList.length,
        userConfiguredModels: userConfiguredCount,
      },
      byType: byTypeRaw.map((r) => ({
        modelType: r.model_type,
        total: Number(r.total),
        enabled: Number(r.enabled),
        providers: r.providers ?? [],
      })),
      byProvider: byProviderRaw.map((r) => ({
        provider: r.provider,
        total: Number(r.total),
        enabled: Number(r.enabled),
        types: r.types ?? [],
      })),
      topModels: topModelsRaw.map((r) => {
        const m = metricsMap.get(r.model_id) ?? { calls: 0, errors: 0 };
        return {
          modelId: r.model_id,
          provider: r.provider,
          modelType: r.model_type,
          userConfigCount: Number(r.user_count),
          callsLast24h: m.calls,
          errorsLast24h: m.errors,
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }
}
