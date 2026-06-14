import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * ForesightPropagationService —— 信号注入与衰减传播。
 *
 * 冲击度模型（demo v0.4 同款，防告警风暴）：
 *   impact(node) = 沿路径边权连乘的最大值（源卡 = 1.0）
 *   impact >= IMPACT_THRESH 才生成复核项；低于阈值仅返回观察列表，不打扰。
 */
@Injectable()
export class ForesightPropagationService {
  private readonly logger = new Logger(ForesightPropagationService.name);
  static readonly IMPACT_THRESH = 0.3;
  static readonly OBSERVE_THRESH = 0.15;

  constructor(private readonly prisma: PrismaService) {}

  async inject(userId: string, signalId: string) {
    const signal = await this.prisma.foresightSignal.findFirst({
      where: { id: signalId, userId },
    });
    if (!signal) throw new NotFoundException("signal not found");
    if (signal.grade !== "strong") {
      throw new ConflictException(
        "only strong signals can be injected (weak = watch-only)",
      );
    }
    if (signal.status === "injected") {
      throw new ConflictException("signal already injected");
    }

    /* 传播严格限定在信号所属主题的子图内 —— 多主题互不串扰 */
    const edges = await this.prisma.foresightEdge.findMany({
      where: { userId, topicId: signal.topicId },
      select: { fromCardId: true, toCardId: true, weight: true },
    });

    const impact = this.computeImpact(signal.targetCardId, edges);
    const depth = this.computeDepth(signal.targetCardId, edges);
    const thresh = ForesightPropagationService.IMPACT_THRESH;

    const marked = Object.entries(impact)
      .filter(([id, v]) => id !== signal.targetCardId && v >= thresh)
      .map(([id, v]) => ({ cardId: id, impact: v, depth: depth[id] ?? 1 }));
    const observed = Object.entries(impact)
      .filter(
        ([id, v]) =>
          id !== signal.targetCardId &&
          v >= ForesightPropagationService.OBSERVE_THRESH &&
          v < thresh,
      )
      .map(([id, v]) => ({ cardId: id, impact: +v.toFixed(3) }));

    await this.prisma.$transaction([
      this.prisma.foresightReviewItem.create({
        data: {
          userId,
          signalId: signal.id,
          cardId: signal.targetCardId,
          impact: 1,
          depth: 0,
          isSource: true,
        },
      }),
      ...marked.map((m) =>
        this.prisma.foresightReviewItem.create({
          data: {
            userId,
            signalId: signal.id,
            cardId: m.cardId,
            impact: +m.impact.toFixed(3),
            depth: m.depth,
          },
        }),
      ),
      this.prisma.foresightSignal.update({
        where: { id: signal.id },
        data: { status: "injected", injectedAt: new Date() },
      }),
    ]);

    this.logger.log(
      `foresight inject: signal=${signal.id} marked=${marked.length} observed=${observed.length}`,
    );
    return {
      signalId: signal.id,
      markedCount: marked.length + 1,
      observed,
      impact: Object.fromEntries(
        Object.entries(impact).map(([k, v]) => [k, +v.toFixed(3)]),
      ),
    };
  }

  /** 最大路径乘积：小图（<10^3 边）迭代松弛即可，环路因乘积 <1 必然收敛 */
  private computeImpact(
    srcCardId: string,
    edges: Array<{ fromCardId: string; toCardId: string; weight: number }>,
  ): Record<string, number> {
    const impact: Record<string, number> = { [srcCardId]: 1 };
    for (let k = 0; k < 16; k++) {
      let changed = false;
      for (const e of edges) {
        const base = impact[e.fromCardId];
        if (base === undefined) continue;
        const v = base * e.weight;
        if (v > (impact[e.toCardId] ?? 0) + 1e-9) {
          impact[e.toCardId] = v;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return impact;
  }

  private computeDepth(
    srcCardId: string,
    edges: Array<{ fromCardId: string; toCardId: string }>,
  ): Record<string, number> {
    const out: Record<string, string[]> = {};
    for (const e of edges) (out[e.fromCardId] ??= []).push(e.toCardId);
    const depth: Record<string, number> = { [srcCardId]: 0 };
    let frontier = [srcCardId];
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of out[id] ?? []) {
          if (depth[n] === undefined) {
            depth[n] = depth[id] + 1;
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    return depth;
  }
}
