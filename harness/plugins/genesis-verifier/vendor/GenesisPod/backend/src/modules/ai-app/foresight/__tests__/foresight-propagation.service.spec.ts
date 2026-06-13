import { ForesightPropagationService } from "../services/foresight-propagation.service";
import type { PrismaService } from "../../../../common/prisma/prisma.service";

describe("ForesightPropagationService", () => {
  const signalFindFirst = jest.fn();
  const edgeFindMany = jest.fn();
  const reviewCreate = jest.fn().mockReturnValue({ kind: "create" });
  const signalUpdate = jest.fn().mockReturnValue({ kind: "update" });
  const tx = jest.fn().mockResolvedValue([]);
  const prisma = {
    foresightSignal: { findFirst: signalFindFirst, update: signalUpdate },
    foresightEdge: { findMany: edgeFindMany },
    foresightReviewItem: { create: reviewCreate },
    $transaction: tx,
  } as unknown as PrismaService;
  const svc = new ForesightPropagationService(prisma);

  /* 链: src -(0.8)-> B -(0.8)-> C -(0.6)-> D ; D 冲击 0.384 ≥ 0.3 入列;
     再 D -(0.6)-> E : 0.23 < 0.3 截止（仅观察） */
  const edges = [
    { fromCardId: "src", toCardId: "B", weight: 0.8 },
    { fromCardId: "B", toCardId: "C", weight: 0.8 },
    { fromCardId: "C", toCardId: "D", weight: 0.6 },
    { fromCardId: "D", toCardId: "E", weight: 0.6 },
  ];

  beforeEach(() => {
    signalFindFirst.mockReset();
    edgeFindMany.mockReset();
    reviewCreate.mockClear();
    tx.mockClear();
  });

  const strongSignal = {
    id: "sig-1",
    targetCardId: "src",
    grade: "strong",
    status: "candidate",
  };

  it("冲击度沿边权连乘衰减，低于阈值的节点不生成复核项", async () => {
    signalFindFirst.mockResolvedValue(strongSignal);
    edgeFindMany.mockResolvedValue(edges);
    const res = await svc.inject("user-1", "sig-1");

    /* src(源) + B(0.8) + C(0.64) + D(0.384) = 4 项; E(0.23) 截止 */
    expect(res.markedCount).toBe(4);
    expect(res.observed).toEqual([{ cardId: "E", impact: 0.23 }]);
    expect(res.impact.B).toBeCloseTo(0.8, 3);
    expect(res.impact.C).toBeCloseTo(0.64, 3);
    expect(res.impact.D).toBeCloseTo(0.384, 3);
    /* 复核项: 1 源 + 3 传播 */
    expect(reviewCreate).toHaveBeenCalledTimes(4);
    const srcItem = reviewCreate.mock.calls[0][0].data;
    expect(srcItem.isSource).toBe(true);
    expect(srcItem.impact).toBe(1);
    expect(srcItem.depth).toBe(0);
  });

  it("环路因乘积 < 1 收敛，不会死循环", async () => {
    signalFindFirst.mockResolvedValue(strongSignal);
    edgeFindMany.mockResolvedValue([
      { fromCardId: "src", toCardId: "B", weight: 0.8 },
      { fromCardId: "B", toCardId: "src", weight: 0.8 },
    ]);
    const res = await svc.inject("user-1", "sig-1");
    expect(res.impact.B).toBeCloseTo(0.8, 3);
    expect(res.impact.src).toBe(1); /* 源不被自身回路抬升 */
  });

  it("弱信号拒绝注入（仅关注，不触发传播）", async () => {
    signalFindFirst.mockResolvedValue({ ...strongSignal, grade: "weak" });
    await expect(svc.inject("user-1", "sig-1")).rejects.toThrow(
      /only strong signals/,
    );
  });

  it("已注入的信号拒绝重复注入", async () => {
    signalFindFirst.mockResolvedValue({ ...strongSignal, status: "injected" });
    await expect(svc.inject("user-1", "sig-1")).rejects.toThrow(
      /already injected/,
    );
  });

  it("信号不属于该用户时 404（行级隔离）", async () => {
    signalFindFirst.mockResolvedValue(null);
    await expect(svc.inject("user-2", "sig-1")).rejects.toThrow(/not found/);
    expect(signalFindFirst.mock.calls[0][0].where.userId).toBe("user-2");
  });
});
