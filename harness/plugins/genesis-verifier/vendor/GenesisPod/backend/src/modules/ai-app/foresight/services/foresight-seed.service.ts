import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  SEED_CARDS,
  SEED_CONCLUSIONS,
  SEED_CONF_LOGS,
  SEED_EDGES,
  SEED_SIGNALS,
} from "../seed/foresight-seed.data";

/**
 * ForesightSeedService —— 为当前用户写入「下一代算力底座」示例判断资产。
 * 幂等：用户已有任何前瞻卡片时直接跳过（不覆盖用户数据）。
 */
@Injectable()
export class ForesightSeedService {
  private readonly logger = new Logger(ForesightSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  static readonly SEED_TOPIC_NAME = "下一代算力底座";
  static readonly SEED_TOPIC_LAYERS = [
    { id: "L0", name: "业务负载", en: "WORKLOAD" },
    { id: "L1", name: "模型架构", en: "MODEL ARCH" },
    { id: "L2", name: "系统软件", en: "SYSTEM SW" },
    { id: "L3", name: "系统级硬件", en: "SYSTEMS" },
    { id: "L4", name: "芯片", en: "SILICON" },
    { id: "L5", name: "物理底座", en: "PHYSICAL" },
  ];

  async seed(userId: string) {
    const existing = await this.prisma.foresightTopic.findFirst({
      where: { userId, name: ForesightSeedService.SEED_TOPIC_NAME },
    });
    if (existing) {
      return {
        seeded: false,
        topicId: existing.id,
        reason: "seed topic already exists",
      };
    }

    const topic = await this.prisma.foresightTopic.create({
      data: {
        userId,
        name: ForesightSeedService.SEED_TOPIC_NAME,
        description: "2028–2030 算力底座判断资产（示例主题，可整体删除）",
        layers:
          ForesightSeedService.SEED_TOPIC_LAYERS as unknown as Prisma.InputJsonValue,
      },
    });

    const idByKey = new Map<string, string>();
    for (const c of SEED_CARDS) {
      const created = await this.prisma.foresightCard.create({
        data: {
          userId,
          topicId: topic.id,
          cardKey: c.cardKey,
          layer: c.layer,
          title: c.title,
          claim: c.claim,
          conf: c.conf,
          sens: c.sens,
          horizon: c.horizon,
          stage: c.stage,
          evidence: c.evidence as unknown as Prisma.InputJsonValue,
          falsifiers: c.falsifiers as unknown as Prisma.InputJsonValue,
          sources: c.sources as unknown as Prisma.InputJsonValue,
          scenarios: c.scenarios
            ? (c.scenarios as unknown as Prisma.InputJsonValue)
            : undefined,
          originType: "manual",
        },
        select: { id: true, cardKey: true },
      });
      idByKey.set(created.cardKey, created.id);
    }

    await this.prisma.foresightEdge.createMany({
      data: SEED_EDGES.map((e) => ({
        userId,
        topicId: topic.id,
        fromCardId: idByKey.get(e.fromKey)!,
        toCardId: idByKey.get(e.toKey)!,
        metric: e.metric,
        type: e.type ?? "flow",
        weight: e.weight,
      })),
    });

    await this.prisma.foresightSignal.createMany({
      data: SEED_SIGNALS.map((s) => ({
        userId,
        topicId: topic.id,
        name: s.name,
        targetCardId: idByKey.get(s.targetKey)!,
        direction: s.direction,
        targetConf: s.targetConf,
        effect: s.effect,
        grade: s.grade,
        basis: s.basis as Prisma.InputJsonValue,
      })),
    });

    await this.prisma.foresightConclusion.createMany({
      data: SEED_CONCLUSIONS.map((c) => ({
        userId,
        topicId: topic.id,
        conclKey: c.conclKey,
        title: c.title,
        body: c.body,
        decisions: c.decisions as unknown as Prisma.InputJsonValue,
        trigger: c.trigger,
        upstreamKeys: c.upstreamKeys,
        conf: c.conf,
        horizon: c.horizon,
      })),
    });

    const now = Date.now();
    await this.prisma.foresightConfLog.createMany({
      data: SEED_CONF_LOGS.map((l) => ({
        userId,
        cardId: idByKey.get(l.cardKey)!,
        fromConf: l.fromConf,
        toConf: l.toConf,
        actor: l.actor,
        reason: l.reason,
        createdAt: new Date(now - l.daysAgo * 24 * 3600 * 1000),
      })),
    });

    this.logger.log(
      `foresight seed: user=${userId} cards=${SEED_CARDS.length} edges=${SEED_EDGES.length}`,
    );
    return {
      seeded: true,
      topicId: topic.id,
      cards: SEED_CARDS.length,
      edges: SEED_EDGES.length,
      signals: SEED_SIGNALS.length,
      conclusions: SEED_CONCLUSIONS.length,
    };
  }
}
