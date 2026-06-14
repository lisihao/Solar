import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  CreateForesightCardDto,
  CreateForesightEdgeDto,
  CreateForesightTopicDto,
  UpdateForesightCardDto,
  UpdateForesightTopicDto,
} from "../dto/foresight.dto";
import { Prisma } from "@prisma/client";

/**
 * ForesightGraphService —— 判断资产 CRUD + 主题工作台装配。
 * 多主题模型（2026-06-12）：主题是独立洞察工作台，层级本体随主题自定义；
 * 所有查询强制 userId 行级隔离 + topicId 作用域。
 */
@Injectable()
export class ForesightGraphService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 主题 ──────────────────────────────────────────────────────────────

  async listTopics(userId: string) {
    const topics = await this.prisma.foresightTopic.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { cards: true } } },
    });
    return topics.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      layers: t.layers,
      cardCount: t._count.cards,
      createdAt: t.createdAt,
    }));
  }

  async createTopic(userId: string, dto: CreateForesightTopicDto) {
    if (!Array.isArray(dto.layers) || dto.layers.length === 0) {
      throw new BadRequestException("topic layers must be a non-empty array");
    }
    const ids = dto.layers.map((l) => l.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException("layer ids must be unique");
    }
    return this.prisma.foresightTopic.create({
      data: {
        userId,
        name: dto.name,
        description: dto.description,
        layers: dto.layers as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateTopic(userId: string, id: string, dto: UpdateForesightTopicDto) {
    await this.requireTopic(userId, id);
    return this.prisma.foresightTopic.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.layers !== undefined && {
          layers: dto.layers as unknown as Prisma.InputJsonValue,
        }),
      },
    });
  }

  async deleteTopic(userId: string, id: string) {
    await this.requireTopic(userId, id);
    await this.prisma.foresightTopic.delete({ where: { id } });
    return { deleted: true };
  }

  // ── 工作台装配 ────────────────────────────────────────────────────────

  /** 单主题工作台全量数据（主题级数据量小，单请求装配最简单可靠） */
  async overview(userId: string, topicId: string) {
    const topic = await this.requireTopic(userId, topicId);
    const [cards, edges, signals, conclusions] = await Promise.all([
      this.prisma.foresightCard.findMany({
        where: { topicId },
        orderBy: [{ layer: "asc" }, { cardKey: "asc" }],
      }),
      this.prisma.foresightEdge.findMany({ where: { topicId } }),
      this.prisma.foresightSignal.findMany({
        where: { topicId },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.foresightConclusion.findMany({
        where: { topicId },
        orderBy: { conclKey: "asc" },
      }),
    ]);
    const reviewItems = await this.prisma.foresightReviewItem.findMany({
      where: { userId, cardId: { in: cards.map((c) => c.id) } },
      orderBy: [{ status: "asc" }, { impact: "desc" }],
      take: 300,
    });
    return {
      topic: {
        id: topic.id,
        name: topic.name,
        description: topic.description,
        layers: topic.layers,
      },
      cards,
      edges,
      signals,
      reviewItems,
      conclusions,
    };
  }

  // ── 卡片 / 边 ─────────────────────────────────────────────────────────

  async createCard(userId: string, dto: CreateForesightCardDto) {
    const topic = await this.requireTopic(userId, dto.topicId);
    const layerIds = ((topic.layers as Array<{ id: string }> | null) ?? []).map(
      (l) => l.id,
    );
    if (!layerIds.includes(dto.layer)) {
      throw new BadRequestException(
        `layer "${dto.layer}" is not defined in topic layers [${layerIds.join(", ")}]`,
      );
    }
    return this.prisma.foresightCard.create({
      data: {
        userId,
        topicId: dto.topicId,
        cardKey: dto.cardKey,
        layer: dto.layer,
        title: dto.title,
        claim: dto.claim,
        conf: dto.conf,
        sens: dto.sens,
        horizon: dto.horizon,
        stage: dto.stage,
        evidence: (dto.evidence ?? []) as Prisma.InputJsonValue,
        falsifiers: (dto.falsifiers ?? []) as Prisma.InputJsonValue,
        sources: (dto.sources ?? []) as Prisma.InputJsonValue,
        scenarios: dto.scenarios
          ? (dto.scenarios as Prisma.InputJsonValue)
          : undefined,
        originType: dto.originType ?? "manual",
      },
    });
  }

  async updateCard(userId: string, id: string, dto: UpdateForesightCardDto) {
    await this.requireCard(userId, id);
    const { scenarios, evidence, falsifiers, sources, ...rest } = dto;
    return this.prisma.foresightCard.update({
      where: { id },
      data: {
        ...rest,
        ...(evidence !== undefined && {
          evidence: evidence as Prisma.InputJsonValue,
        }),
        ...(falsifiers !== undefined && {
          falsifiers: falsifiers as Prisma.InputJsonValue,
        }),
        ...(sources !== undefined && {
          sources: sources as Prisma.InputJsonValue,
        }),
        ...(scenarios !== undefined && {
          scenarios:
            scenarios === null
              ? Prisma.DbNull
              : (scenarios as Prisma.InputJsonValue),
        }),
      },
    });
  }

  async deleteCard(userId: string, id: string) {
    await this.requireCard(userId, id);
    await this.prisma.foresightCard.delete({ where: { id } });
    return { deleted: true };
  }

  async ledger(userId: string, cardId: string) {
    await this.requireCard(userId, cardId);
    return this.prisma.foresightConfLog.findMany({
      where: { cardId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async createEdge(userId: string, dto: CreateForesightEdgeDto) {
    if (dto.fromKey === dto.toKey) {
      throw new BadRequestException("edge endpoints must differ");
    }
    await this.requireTopic(userId, dto.topicId);
    const [from, to] = await Promise.all([
      this.prisma.foresightCard.findUnique({
        where: {
          topicId_cardKey: { topicId: dto.topicId, cardKey: dto.fromKey },
        },
      }),
      this.prisma.foresightCard.findUnique({
        where: {
          topicId_cardKey: { topicId: dto.topicId, cardKey: dto.toKey },
        },
      }),
    ]);
    if (!from || !to) {
      throw new NotFoundException("from/to card not found in topic");
    }
    return this.prisma.foresightEdge.create({
      data: {
        userId,
        topicId: dto.topicId,
        fromCardId: from.id,
        toCardId: to.id,
        metric: dto.metric,
        type: dto.type ?? "flow",
        weight: dto.weight ?? 0.7,
      },
    });
  }

  async deleteEdge(userId: string, id: string) {
    const edge = await this.prisma.foresightEdge.findFirst({
      where: { id, userId },
    });
    if (!edge) throw new NotFoundException("edge not found");
    await this.prisma.foresightEdge.delete({ where: { id } });
    return { deleted: true };
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async requireTopic(userId: string, id: string) {
    const topic = await this.prisma.foresightTopic.findFirst({
      where: { id, userId },
    });
    if (!topic) throw new NotFoundException("topic not found");
    return topic;
  }

  private async requireCard(userId: string, id: string) {
    const card = await this.prisma.foresightCard.findFirst({
      where: { id, userId },
    });
    if (!card) throw new NotFoundException("card not found");
    return card;
  }
}
