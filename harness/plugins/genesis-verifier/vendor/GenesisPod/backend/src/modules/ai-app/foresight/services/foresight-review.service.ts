import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * ForesightReviewService —— 复核裁定。
 *
 * adjust 确认调整：真实修订卡片置信度并写入置信度账本（校准回看的数据基础）
 *   - 源卡片：置信度修订到信号的 targetConf（证伪下调 / 约束收紧上调）
 *   - 传播卡片：按冲击度比例下调（impact × 0.15，clamp [0.05, 0.95]）
 * keep 维持原判：仅关闭复核项，置信度不动。
 */
@Injectable()
export class ForesightReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, itemId: string, decision: "adjust" | "keep") {
    const item = await this.prisma.foresightReviewItem.findFirst({
      where: { id: itemId, userId },
      include: { card: true, signal: true },
    });
    if (!item) throw new NotFoundException("review item not found");
    if (item.status === "resolved") {
      throw new ConflictException("review item already resolved");
    }

    if (decision === "keep") {
      const updated = await this.prisma.foresightReviewItem.update({
        where: { id: item.id },
        data: { status: "resolved", decision: "keep", resolvedAt: new Date() },
      });
      return { item: updated, card: item.card };
    }

    const from = item.card.conf;
    const to = item.isSource
      ? item.signal.targetConf
      : Math.min(0.95, Math.max(0.05, +(from - item.impact * 0.15).toFixed(2)));

    const [updatedItem, updatedCard] = await this.prisma
      .$transaction([
        this.prisma.foresightReviewItem.update({
          where: { id: item.id },
          data: {
            status: "resolved",
            decision: "adjust",
            confFrom: from,
            confTo: to,
            resolvedAt: new Date(),
          },
        }),
        this.prisma.foresightCard.update({
          where: { id: item.cardId },
          data: { conf: to },
        }),
        this.prisma.foresightConfLog.create({
          data: {
            userId,
            cardId: item.cardId,
            fromConf: from,
            toConf: to,
            actor: "Owner 裁定",
            reason: `${item.signal.name} 复核确认调整（冲击度 ${item.impact.toFixed(2)}）`,
          },
        }),
      ])
      .then((r) => [r[0], r[1]] as const);

    return { item: updatedItem, card: updatedCard };
  }
}
