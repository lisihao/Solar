import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { AIModelType, ModelRecommendation } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  DEFAULT_RECOMMENDATIONS,
  MODEL_TYPE_ALIASES,
} from "./default-recommendations.config";

export interface ResolvedRecommendation {
  provider: string;
  modelType: AIModelType;
  patterns: string[];
  priority: number;
  source: "db" | "default";
}

/**
 * 推荐矩阵的统一读/写入口。
 *
 * 数据流：
 *   1. onModuleInit: 首次启动若表空 → seed DEFAULT_RECOMMENDATIONS
 *   2. 运行时: getForProvider/getAll 先查 DB；DB 没有该 (provider, modelType) 条目
 *      才回落到硬编码默认（保证代码里新加的 provider 不需要先 seed）
 *   3. 管理员编辑: update/create/remove + resetToDefaults 重置
 *
 * User Auto-Configure 和 Admin Auto-Configure 都通过本服务拿 patterns。
 */
@Injectable()
export class ModelRecommendationsService implements OnModuleInit {
  private readonly logger = new Logger(ModelRecommendationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const count = await this.prisma.modelRecommendation.count();
      if (count === 0) {
        await this.seedDefaults();
        this.logger.log(
          `Seeded ${DEFAULT_RECOMMENDATIONS.length} default recommendations`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Skipping seed (table may not exist yet): ${(error as Error).message}`,
      );
    }
  }

  /**
   * 获取某个 provider 的全部 (modelType -> patterns)。
   * DB 优先，DB 未覆盖的 modelType 用默认值补。
   */
  async getForProvider(provider: string): Promise<ResolvedRecommendation[]> {
    const normalized = provider.toLowerCase();
    const dbRows = await this.prisma.modelRecommendation.findMany({
      where: { provider: normalized },
      orderBy: { priority: "asc" },
    });

    const covered = new Set(dbRows.map((r) => r.modelType));
    const fallbacks = DEFAULT_RECOMMENDATIONS.filter(
      (d) => d.provider === normalized && !covered.has(d.modelType),
    );
    const fallbackCovered = new Set(fallbacks.map((f) => f.modelType));

    // ★ 别名：没 DB 也没硬编码时，借用被映射类型的 patterns
    //   （EVALUATOR → CHAT 仅对 whitelist provider 生效，避免中等 CHAT 模型
    //    被误装成 evaluator）
    const aliased: ResolvedRecommendation[] = [];
    for (const [typeStr, alias] of Object.entries(MODEL_TYPE_ALIASES)) {
      const modelType = typeStr as AIModelType;
      if (!alias) continue;
      if (covered.has(modelType)) continue;
      if (fallbackCovered.has(modelType)) continue;
      if (
        alias.applyToProviders &&
        !alias.applyToProviders.includes(normalized)
      ) {
        continue;
      }

      // 找被映射类型的 patterns（优先 DB，fallback 默认）
      const srcDb = dbRows.find((r) => r.modelType === alias.aliasTo);
      if (srcDb) {
        aliased.push({
          provider: normalized,
          modelType,
          patterns: this.parsePatterns(srcDb.patterns),
          priority: srcDb.priority,
          source: "default",
        });
        continue;
      }
      const srcDefault = DEFAULT_RECOMMENDATIONS.find(
        (d) => d.provider === normalized && d.modelType === alias.aliasTo,
      );
      if (srcDefault) {
        aliased.push({
          provider: normalized,
          modelType,
          patterns: srcDefault.patterns,
          priority: srcDefault.priority,
          source: "default",
        });
      }
    }

    return [
      ...dbRows.map(
        (r): ResolvedRecommendation => ({
          provider: r.provider,
          modelType: r.modelType,
          patterns: this.parsePatterns(r.patterns),
          priority: r.priority,
          source: "db",
        }),
      ),
      ...fallbacks.map(
        (d): ResolvedRecommendation => ({
          provider: d.provider,
          modelType: d.modelType,
          patterns: d.patterns,
          priority: d.priority,
          source: "default",
        }),
      ),
      ...aliased,
    ];
  }

  /**
   * 列出所有条目（管理员后台用）。DB 和硬编码合并，DB 优先覆盖。
   */
  async listAll(): Promise<ResolvedRecommendation[]> {
    const dbRows = await this.prisma.modelRecommendation.findMany({
      orderBy: [{ provider: "asc" }, { priority: "asc" }],
    });
    const covered = new Set(dbRows.map((r) => `${r.provider}:${r.modelType}`));

    const fallbacks = DEFAULT_RECOMMENDATIONS.filter(
      (d) => !covered.has(`${d.provider}:${d.modelType}`),
    );
    const fallbackCovered = new Set(
      fallbacks.map((f) => `${f.provider}:${f.modelType}`),
    );

    // 别名补齐（同 getForProvider 的 EVALUATOR → CHAT 逻辑，但是遍历全 provider）
    const providers = new Set([
      ...dbRows.map((r) => r.provider),
      ...DEFAULT_RECOMMENDATIONS.map((d) => d.provider),
    ]);
    const aliased: ResolvedRecommendation[] = [];
    for (const provider of providers) {
      for (const [typeStr, alias] of Object.entries(MODEL_TYPE_ALIASES)) {
        const modelType = typeStr as AIModelType;
        if (!alias) continue;
        if (
          alias.applyToProviders &&
          !alias.applyToProviders.includes(provider)
        ) {
          continue;
        }
        const key = `${provider}:${modelType}`;
        if (covered.has(key) || fallbackCovered.has(key)) continue;

        const srcDb = dbRows.find(
          (r) => r.provider === provider && r.modelType === alias.aliasTo,
        );
        const src =
          srcDb ??
          DEFAULT_RECOMMENDATIONS.find(
            (d) => d.provider === provider && d.modelType === alias.aliasTo,
          );
        if (!src) continue;

        aliased.push({
          provider,
          modelType,
          patterns:
            "patterns" in src &&
            Array.isArray((src as { patterns: unknown }).patterns)
              ? ((src as { patterns: unknown }).patterns as string[]).filter(
                  (p): p is string => typeof p === "string",
                )
              : this.parsePatterns((src as { patterns: unknown }).patterns),
          priority: src.priority,
          source: "default",
        });
      }
    }

    const merged: ResolvedRecommendation[] = [
      ...dbRows.map(
        (r): ResolvedRecommendation => ({
          provider: r.provider,
          modelType: r.modelType,
          patterns: this.parsePatterns(r.patterns),
          priority: r.priority,
          source: "db",
        }),
      ),
      ...fallbacks.map(
        (d): ResolvedRecommendation => ({
          provider: d.provider,
          modelType: d.modelType,
          patterns: d.patterns,
          priority: d.priority,
          source: "default",
        }),
      ),
      ...aliased,
    ];

    merged.sort((a, b) => {
      const byProvider = a.provider.localeCompare(b.provider);
      if (byProvider !== 0) return byProvider;
      return a.modelType.localeCompare(b.modelType);
    });
    return merged;
  }

  /**
   * DB 全量数据（管理员后台编辑用），不含 fallback。
   * 返回原始行供前端渲染编辑表。
   */
  async listDbRows(): Promise<ModelRecommendation[]> {
    return this.prisma.modelRecommendation.findMany({
      orderBy: [{ provider: "asc" }, { modelType: "asc" }],
    });
  }

  async create(
    dto: {
      provider: string;
      modelType: AIModelType;
      patterns: string[];
      priority?: number;
      note?: string;
    },
    updatedBy: string | null,
  ): Promise<ModelRecommendation> {
    const normalized = dto.provider.trim().toLowerCase();
    if (!normalized) throw new BadRequestException("provider required");
    this.validatePatterns(dto.patterns);

    const existing = await this.prisma.modelRecommendation.findUnique({
      where: {
        provider_modelType: {
          provider: normalized,
          modelType: dto.modelType,
        },
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Recommendation already exists for ${normalized}/${dto.modelType}. Use PATCH to update.`,
      );
    }

    return this.prisma.modelRecommendation.create({
      data: {
        provider: normalized,
        modelType: dto.modelType,
        patterns: dto.patterns,
        priority: dto.priority ?? 50,
        note: dto.note ?? null,
        updatedBy,
      },
    });
  }

  async update(
    id: string,
    patch: {
      patterns?: string[];
      priority?: number;
      note?: string | null;
    },
    updatedBy: string | null,
  ): Promise<ModelRecommendation> {
    const existing = await this.prisma.modelRecommendation.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Recommendation ${id} not found`);
    }
    if (patch.patterns) this.validatePatterns(patch.patterns);

    return this.prisma.modelRecommendation.update({
      where: { id },
      data: {
        ...(patch.patterns !== undefined ? { patterns: patch.patterns } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        updatedBy,
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.modelRecommendation
      .delete({ where: { id } })
      .catch(() => {
        throw new NotFoundException(`Recommendation ${id} not found`);
      });
  }

  /**
   * 用硬编码默认值**完全重置** DB 表。
   * 已有 DB 行会被清空并用最新默认覆盖——适合发布新版本后同步最新默认矩阵。
   */
  async resetToDefaults(updatedBy: string | null): Promise<{ seeded: number }> {
    await this.prisma.$transaction([
      this.prisma.modelRecommendation.deleteMany({}),
    ]);
    const seeded = await this.seedDefaults(updatedBy);
    return { seeded };
  }

  /**
   * 仅 seed **缺失**的默认条目（不会覆盖管理员改过的 DB 行）。
   * 用于新增默认条目后的平滑补齐。
   */
  async seedMissingDefaults(
    updatedBy: string | null,
  ): Promise<{ seeded: number }> {
    const dbRows = await this.prisma.modelRecommendation.findMany({
      select: { provider: true, modelType: true },
    });
    const covered = new Set(dbRows.map((r) => `${r.provider}:${r.modelType}`));
    const missing = DEFAULT_RECOMMENDATIONS.filter(
      (d) => !covered.has(`${d.provider}:${d.modelType}`),
    );
    if (missing.length === 0) return { seeded: 0 };

    await this.prisma.modelRecommendation.createMany({
      data: missing.map((d) => ({
        provider: d.provider,
        modelType: d.modelType,
        patterns: d.patterns,
        priority: d.priority,
        note: d.note ?? null,
        updatedBy,
      })),
      skipDuplicates: true,
    });
    return { seeded: missing.length };
  }

  private async seedDefaults(updatedBy: string | null = null): Promise<number> {
    await this.prisma.modelRecommendation.createMany({
      data: DEFAULT_RECOMMENDATIONS.map((d) => ({
        provider: d.provider,
        modelType: d.modelType,
        patterns: d.patterns,
        priority: d.priority,
        note: d.note ?? null,
        updatedBy,
      })),
      skipDuplicates: true,
    });
    return DEFAULT_RECOMMENDATIONS.length;
  }

  /**
   * patterns 字段在 DB 里是 Json，实际存的是 string[]。
   * 兼容旧数据/手动写入非数组的情况。
   */
  private parsePatterns(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw.filter((p): p is string => typeof p === "string");
    }
    return [];
  }

  private validatePatterns(patterns: string[]): void {
    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new BadRequestException(
        "patterns must be a non-empty array of regex strings",
      );
    }
    for (const p of patterns) {
      if (typeof p !== "string" || !p.trim()) {
        throw new BadRequestException("All patterns must be non-empty strings");
      }
      try {
        new RegExp(p);
      } catch (error) {
        throw new BadRequestException(
          `Invalid regex pattern "${p}": ${(error as Error).message}`,
        );
      }
    }
  }
}

