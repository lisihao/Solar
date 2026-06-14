/**
 * CompanyHeroService —— 一人公司 "Hero" 模型。
 *
 * 一个 hero = 用户采用的市场能力（capabilityId，如 "deep-insight"）+ 模型槽（models）。
 * 向 hero 派发 mission 即运行该能力（squad 自动成军）。
 *
 * Responsibilities:
 *   - listHeroes(userId)            列出用户的 heroes（零 hero 时自动配置一个默认 deep-insight hero）。
 *   - adoptHero(userId, capId)      采用一个市场能力为 hero。
 *   - updateHero(userId, id, patch) 更新 hero 名称 / 模型槽 / autoFallback（按 userId 归属校验）。
 *   - deleteHero(userId, id)        删除 hero（按 userId 归属校验）。
 *   - createHeroMission(...)        派发 mission——委托 CompanyMissionService 跑能力路径。
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { CompanyHero, CompanyMission } from "@prisma/client";
import { CompanyMissionService } from "./company-mission.service";
import { CapabilityRegistry } from "@/modules/ai-app/marketplace/capability";

/** 零 hero 时自动配置的默认能力。 */
const DEFAULT_CAPABILITY_ID = "deep-insight";

export interface UpdateHeroInput {
  name?: string;
  models?: string[];
  autoFallback?: boolean;
  /** cosmetic 头像预设 key（纯展示，不入 prompt）。 */
  avatar?: string;
  /** cosmetic 一句话人设（纯展示，不入 prompt）。 */
  tagline?: string;
}

@Injectable()
export class CompanyHeroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly missionService: CompanyMissionService,
    private readonly capabilityRegistry: CapabilityRegistry,
  ) {}

  /**
   * 列出用户的 heroes。若零 hero → 自动配置一个默认 deep-insight hero 并返回。
   * 默认名 = deep-insight 能力 manifest 标题（不可解析则用 "深度研究官"）。
   * 默认 models = []（空 → 引擎自动择优，0-config 可用）。
   */
  async listHeroes(userId: string): Promise<CompanyHero[]> {
    const heroes = await this.prisma.companyHero.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (heroes.length > 0) return heroes;

    const provisioned = await this.adoptHero(userId, DEFAULT_CAPABILITY_ID);
    return [provisioned];
  }

  /**
   * 采用一个市场能力为 hero。
   * 默认名 = 能力 manifest 职能标题（解析不到则用 capabilityId 兜底）；
   * 同名（同前缀）已存在则追加序号，保证可区分。用户后续可手动改名。
   */
  async adoptHero(userId: string, capabilityId: string): Promise<CompanyHero> {
    const baseName =
      this.capabilityRegistry.resolve(capabilityId)?.manifest.title ??
      capabilityId;
    const sameName = await this.prisma.companyHero.count({
      where: { userId, name: { startsWith: baseName } },
    });
    const name = sameName === 0 ? baseName : `${baseName} ${sameName + 1}`;
    return this.prisma.companyHero.create({
      data: { userId, capabilityId, name, models: [], autoFallback: true },
    });
  }

  /** 更新 hero 配置（按 userId 归属校验，防越权改他人 hero）。 */
  async updateHero(
    userId: string,
    id: string,
    patch: UpdateHeroInput,
  ): Promise<CompanyHero> {
    const existing = await this.prisma.companyHero.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException("Hero not found");

    return this.prisma.companyHero.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.models !== undefined ? { models: patch.models } : {}),
        ...(patch.autoFallback !== undefined
          ? { autoFallback: patch.autoFallback }
          : {}),
        ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
        ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
      },
    });
  }

  /** 删除 hero（按 userId 归属校验）。 */
  async deleteHero(userId: string, id: string): Promise<void> {
    await this.prisma.companyHero.deleteMany({ where: { id, userId } });
  }

  /**
   * 向 hero 派发 mission：解析 hero.capabilityId 到能力 runner，以
   * preferredModelId = hero.models[0]（无则空串）真跑，复用团队能力路径的
   * run/bridge/persist 机器 + 同一套事件。返回创建的 CompanyMission 行。
   */
  async createHeroMission(
    userId: string,
    heroId: string,
    title: string,
    extra?: {
      description?: string;
      depth?: "quick" | "standard" | "deep";
      language?: "zh-CN" | "en-US";
      withFigures?: boolean;
      knowledgeBaseIds?: string[];
      searchTimeRange?: "30d" | "90d" | "180d" | "365d" | "730d" | "all";
      styleProfile?: "executive" | "academic" | "journalistic" | "technical";
      lengthProfile?:
        | "brief"
        | "standard"
        | "deep"
        | "extended"
        | "epic"
        | "mega";
      audienceProfile?: "executive" | "domain-expert" | "general-public";
      auditLayers?: "minimal" | "default" | "thorough" | "thorough+";
    },
  ): Promise<CompanyMission> {
    const hero = await this.prisma.companyHero.findFirst({
      where: { id: heroId, userId },
    });
    if (!hero) throw new NotFoundException("Hero not found");

    const preferredModelId = hero.models[0] ?? "";
    return this.missionService.createHeroMission(
      userId,
      hero.id,
      hero.capabilityId,
      title,
      preferredModelId,
      extra,
    );
  }
}
