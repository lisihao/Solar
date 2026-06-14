import { ForesightReviewService } from "../services/foresight-review.service";
import type { PrismaService } from "../../../../common/prisma/prisma.service";

describe("ForesightReviewService", () => {
  const itemFindFirst = jest.fn();
  const itemUpdate = jest.fn((args: unknown) => ({ op: "item", args }));
  const cardUpdate = jest.fn((args: unknown) => ({ op: "card", args }));
  const logCreate = jest.fn((args: unknown) => ({ op: "log", args }));
  const tx = jest.fn(async (ops: unknown[]) => ops);
  const prisma = {
    foresightReviewItem: { findFirst: itemFindFirst, update: itemUpdate },
    foresightCard: { update: cardUpdate },
    foresightConfLog: { create: logCreate },
    $transaction: tx,
  } as unknown as PrismaService;
  const svc = new ForesightReviewService(prisma);

  const baseItem = {
    id: "item-1",
    cardId: "card-1",
    impact: 0.64,
    isSource: false,
    status: "pending",
    card: { id: "card-1", conf: 0.7 },
    signal: { name: "HBM4 延期", targetConf: 0.35 },
  };

  beforeEach(() => {
    itemFindFirst.mockReset();
    itemUpdate.mockClear();
    cardUpdate.mockClear();
    logCreate.mockClear();
    tx.mockClear();
  });

  it("keep 维持原判：仅关闭复核项，不动置信度、不写账本", async () => {
    itemFindFirst.mockResolvedValue(baseItem);
    await svc.resolve("user-1", "item-1", "keep");
    expect(itemUpdate.mock.calls[0][0].data.decision).toBe("keep");
    expect(cardUpdate).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("adjust 传播项：按冲击度比例下调（conf - impact×0.15）并写账本", async () => {
    itemFindFirst.mockResolvedValue(baseItem);
    await svc.resolve("user-1", "item-1", "adjust");
    /* 0.70 - 0.64×0.15 = 0.70 - 0.096 → 0.60 */
    expect(cardUpdate.mock.calls[0][0].data.conf).toBeCloseTo(0.6, 2);
    const log = logCreate.mock.calls[0][0].data;
    expect(log.fromConf).toBe(0.7);
    expect(log.toConf).toBeCloseTo(0.6, 2);
    expect(log.reason).toContain("HBM4 延期");
  });

  it("adjust 源卡片：直接修订到信号 targetConf", async () => {
    itemFindFirst.mockResolvedValue({
      ...baseItem,
      isSource: true,
      impact: 1,
      card: { id: "card-1", conf: 0.6 },
    });
    await svc.resolve("user-1", "item-1", "adjust");
    expect(cardUpdate.mock.calls[0][0].data.conf).toBe(0.35);
  });

  it("已裁定的项拒绝重复裁定", async () => {
    itemFindFirst.mockResolvedValue({ ...baseItem, status: "resolved" });
    await expect(svc.resolve("user-1", "item-1", "keep")).rejects.toThrow(
      /already resolved/,
    );
  });
});
