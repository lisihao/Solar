import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { CreditRule, Prisma } from "@prisma/client";

import { DEFAULT_CREDIT_RULES } from "./default-credit-rules.catalog";

@Injectable()
export class CreditRulesService implements OnModuleInit {
  private readonly logger = new Logger(CreditRulesService.name);
  private rulesCache: Map<string, CreditRule> = new Map();

  constructor(private prisma: PrismaService) {}

  /**
   * 模块初始化时加载规则
   */
  async onModuleInit() {
    await this.initializeDefaultRules();
    await this.loadRulesIntoCache();
  }

  /**
   * 初始化默认规则
   * 使用并发执行提升启动性能
   */
  private async initializeDefaultRules() {
    try {
      // 并发执行所有 upsert 操作，而不是顺序执行
      const BATCH_SIZE = 10; // 每批 10 个，避免数据库连接池压力
      const batches: Array<(typeof DEFAULT_CREDIT_RULES)[number][]> = [];

      for (let i = 0; i < DEFAULT_CREDIT_RULES.length; i += BATCH_SIZE) {
        batches.push(DEFAULT_CREDIT_RULES.slice(i, i + BATCH_SIZE));
      }

      for (const batch of batches) {
        await Promise.all(
          batch.map((rule) =>
            this.prisma.creditRule.upsert({
              where: {
                moduleType_operationType: {
                  moduleType: rule.moduleType,
                  operationType: rule.operationType,
                },
              },
              update: {},
              create: {
                ...rule,
                tokenMultiplier: 2.0, // Token 消耗 × 2 计算积分
                modelMultipliers: {},
              },
            }),
          ),
        );
      }
      this.logger.log("Default credit rules initialized");
    } catch (error) {
      this.logger.warn(
        "Failed to initialize default rules, will retry on first access",
      );
    }
  }

  /**
   * 加载规则到缓存
   */
  private async loadRulesIntoCache() {
    try {
      const rules = await this.prisma.creditRule.findMany({
        where: { isActive: true },
      });
      this.rulesCache.clear();
      for (const rule of rules) {
        const key = `${rule.moduleType}:${rule.operationType}`;
        this.rulesCache.set(key, rule);
      }
      this.logger.log(`Loaded ${rules.length} credit rules into cache`);
    } catch (error) {
      this.logger.warn("Failed to load rules into cache");
    }
  }

  /**
   * 获取规则
   */
  async getRule(
    moduleType: string,
    operationType: string,
  ): Promise<CreditRule | null> {
    const key = `${moduleType}:${operationType}`;

    // 先从缓存获取
    if (this.rulesCache.has(key)) {
      return this.rulesCache.get(key)!;
    }

    // 缓存未命中，从数据库获取
    const rule = await this.prisma.creditRule.findUnique({
      where: {
        moduleType_operationType: {
          moduleType,
          operationType,
        },
      },
    });

    if (rule && rule.isActive) {
      this.rulesCache.set(key, rule);
      return rule;
    }

    return null;
  }

  /**
   * 计算积分消耗
   */
  async calculateCredits(
    moduleType: string,
    operationType: string,
    tokenCount?: number,
    modelName?: string,
  ): Promise<number> {
    const rule = await this.getRule(moduleType, operationType);

    if (!rule) {
      // 未找到规则，使用默认值
      this.logger.warn(
        `No rule found for ${moduleType}:${operationType}, using default`,
      );
      return 10;
    }

    let credits = rule.baseCredits;

    // 应用 token 乘数
    if (tokenCount && rule.tokenMultiplier > 0) {
      // 每1000 tokens 按 baseCredits * tokenMultiplier 计算
      const tokenCredits = Math.ceil(
        (tokenCount / 1000) * rule.baseCredits * rule.tokenMultiplier,
      );
      credits = Math.max(credits, tokenCredits);
    }

    // 应用模型乘数
    if (modelName && rule.modelMultipliers) {
      const multipliers = rule.modelMultipliers as Record<string, number>;
      const modelMultiplier = multipliers[modelName] || 1.0;
      credits = Math.ceil(credits * modelMultiplier);
    }

    return credits;
  }

  /**
   * 刷新规则缓存
   */
  async refreshCache() {
    await this.loadRulesIntoCache();
  }

  /**
   * 获取所有规则
   */
  async getAllRules(): Promise<CreditRule[]> {
    return this.prisma.creditRule.findMany({
      orderBy: [{ moduleType: "asc" }, { operationType: "asc" }],
    });
  }

  /**
   * 更新规则
   */
  async updateRule(
    moduleType: string,
    operationType: string,
    data: Partial<
      Pick<
        CreditRule,
        "baseCredits" | "tokenMultiplier" | "modelMultipliers" | "isActive"
      >
    >,
  ): Promise<CreditRule> {
    const rule = await this.prisma.creditRule.update({
      where: {
        moduleType_operationType: {
          moduleType,
          operationType,
        },
      },
      data: data as Prisma.CreditRuleUpdateInput,
    });

    // 更新缓存
    const key = `${moduleType}:${operationType}`;
    if (rule.isActive) {
      this.rulesCache.set(key, rule);
    } else {
      this.rulesCache.delete(key);
    }

    return rule;
  }
}
