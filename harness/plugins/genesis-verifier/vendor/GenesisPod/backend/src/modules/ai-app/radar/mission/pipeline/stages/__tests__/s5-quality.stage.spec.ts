/**
 * RadarS5QualityStage — 质量评分阶段
 *
 * 锁定行为：
 *  - 仅对 relevanceScore >= RADAR_PIPELINE_DEFAULTS.relevanceThreshold 的 item 跑 LLM
 *  - 批量 10 个一批，整批兜底 score=30 summary="LLM 失败兜底"
 *  - LLM 漏评分（返回的 items 不包含某 id）兜底 score=30 summary="LLM 漏评分兜底"
 *  - score 越界 / 非数 → clamp 到 [0,100] 或 fallback 30
 *  - aiSummary 截断到 80 字
 *  - 持久化：每个 item 一次 prisma.radarItem.update，包在单 $transaction
 *  - abort signal：批次间检查，触发抛 "aborted_during_quality_scoring"
 */

import { Test } from "@nestjs/testing";
import { AiChatService } from "@/modules/ai-engine/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RadarS5QualityStage } from "../s5-quality.stage";
import { RADAR_PIPELINE_DEFAULTS } from "../../../../runtime/radar.constants";
import type {
  RadarMissionContext,
  RadarStageHookArgs,
} from "../radar-stage-types";

describe("RadarS5QualityStage", () => {
  let stage: RadarS5QualityStage;
  let chat: { chat: jest.Mock };
  let prisma: { $transaction: jest.Mock; radarItem: { update: jest.Mock } };

  beforeEach(async () => {
    chat = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          items: [
            { id: "A", qualityScore: 80, aiSummary: "good A" },
            { id: "B", qualityScore: 60, aiSummary: "ok B" },
          ],
        }),
      }),
    };
    prisma = {
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      radarItem: { update: jest.fn().mockResolvedValue({}) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RadarS5QualityStage,
        { provide: AiChatService, useValue: chat },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    stage = moduleRef.get(RadarS5QualityStage);
  });

  afterEach(() => jest.restoreAllMocks());

  function makeCtx(
    relevanceScores: Map<string, { score: number; reason?: string }>,
    items: { id: string; title?: string; content?: string; url?: string }[] = [
      { id: "A", title: "Title A", content: "Body A" },
      { id: "B", title: "Title B", content: "Body B" },
    ],
  ): RadarMissionContext {
    return {
      missionId: "m-1",
      userId: "u-1",
      signal: { aborted: false } as AbortSignal,
      input: { topicId: "topic-1" },
      state: {
        newItemIds: items.map((x) => x.id),
        uniqueItems: items.map((x) => ({
          title: x.title ?? "",
          content: x.content ?? "",
          url: x.url ?? "",
          sourceId: "s1",
        })),
        relevanceScores,
        metrics: {},
      },
    } as unknown as RadarMissionContext;
  }

  const args = {} as RadarStageHookArgs;
  const T = RADAR_PIPELINE_DEFAULTS.relevanceThreshold;

  describe("filtering by relevanceThreshold", () => {
    it("跳过 relevanceScore < threshold 的 item", async () => {
      const ctx = makeCtx(
        new Map([
          ["A", { score: T + 10 }],
          ["B", { score: T - 10 }],
        ]),
      );
      await stage.run(args, ctx);
      const scored = ctx.state.qualityScores!;
      expect(scored.has("A")).toBe(true);
      expect(scored.has("B")).toBe(false);
    });

    it("全部低于阈值时空 map + 不调 LLM", async () => {
      const ctx = makeCtx(
        new Map([
          ["A", { score: T - 1 }],
          ["B", { score: T - 5 }],
        ]),
      );
      await stage.run(args, ctx);
      expect(ctx.state.qualityScores!.size).toBe(0);
      expect(chat.chat).not.toHaveBeenCalled();
    });

    it("uniqueItems 空时空 map + 不调 LLM", async () => {
      const ctx = makeCtx(new Map(), []);
      await stage.run(args, ctx);
      expect(ctx.state.qualityScores!.size).toBe(0);
      expect(chat.chat).not.toHaveBeenCalled();
    });
  });

  describe("LLM 失败 / 解析 / 边界", () => {
    it("LLM 返回无法解析 → 整批兜底 30 + LLM 失败兜底", async () => {
      chat.chat.mockResolvedValueOnce({ content: "not json" });
      const ctx = makeCtx(
        new Map([
          ["A", { score: T + 10 }],
          ["B", { score: T + 10 }],
        ]),
      );
      await stage.run(args, ctx);
      const m = ctx.state.qualityScores!;
      expect(m.get("A")?.score).toBe(30);
      expect(m.get("B")?.score).toBe(30);
      expect(m.get("A")?.summary).toBe("LLM 失败兜底");
    });

    it("LLM throw → 整批兜底 30 + LLM 失败兜底", async () => {
      chat.chat.mockRejectedValueOnce(new Error("network"));
      const ctx = makeCtx(new Map([["A", { score: T + 10 }]]));
      await stage.run(args, ctx);
      expect(ctx.state.qualityScores!.get("A")?.score).toBe(30);
    });

    it("LLM 漏评某条 (items 不含 B) → B 兜底 30 + LLM 漏评分兜底", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          items: [{ id: "A", qualityScore: 90, aiSummary: "x" }],
        }),
      });
      const ctx = makeCtx(
        new Map([
          ["A", { score: T + 10 }],
          ["B", { score: T + 10 }],
        ]),
      );
      await stage.run(args, ctx);
      const m = ctx.state.qualityScores!;
      expect(m.get("A")?.score).toBe(90);
      expect(m.get("B")?.score).toBe(30);
      expect(m.get("B")?.summary).toBe("LLM 漏评分兜底");
    });

    it("score 越界 → clamp 到 [0,100]", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            { id: "A", qualityScore: 1000, aiSummary: "x" },
            { id: "B", qualityScore: -10, aiSummary: "y" },
          ],
        }),
      });
      const ctx = makeCtx(
        new Map([
          ["A", { score: T + 10 }],
          ["B", { score: T + 10 }],
        ]),
      );
      await stage.run(args, ctx);
      expect(ctx.state.qualityScores!.get("A")?.score).toBe(100);
      expect(ctx.state.qualityScores!.get("B")?.score).toBe(0);
    });

    it("score 非数 → fallback 30", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          items: [{ id: "A", qualityScore: "x", aiSummary: "s" }],
        }),
      });
      const ctx = makeCtx(new Map([["A", { score: T + 10 }]]));
      await stage.run(args, ctx);
      expect(ctx.state.qualityScores!.get("A")?.score).toBe(30);
    });

    it("aiSummary 超过 80 字 → 截断（含 ...）", async () => {
      const long = "字".repeat(200);
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          items: [{ id: "A", qualityScore: 70, aiSummary: long }],
        }),
      });
      const ctx = makeCtx(new Map([["A", { score: T + 10 }]]));
      await stage.run(args, ctx);
      const s = ctx.state.qualityScores!.get("A")!;
      expect(s.summary.length).toBe(80);
      expect(s.summary.endsWith("...")).toBe(true);
    });
  });

  describe("持久化", () => {
    it("调 prisma.radarItem.update 每条一次，包在 $transaction", async () => {
      const ctx = makeCtx(
        new Map([
          ["A", { score: T + 10 }],
          ["B", { score: T + 10 }],
        ]),
      );
      await stage.run(args, ctx);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.radarItem.update).toHaveBeenCalledTimes(2);
      const updateArgsA = prisma.radarItem.update.mock.calls.find(
        (c: any[]) => c[0].where.id === "A",
      );
      expect(updateArgsA[0].data).toEqual(
        expect.objectContaining({ qualityScore: 80, aiSummary: "good A" }),
      );
    });

    it("无可评分 item → 不调 $transaction", async () => {
      const ctx = makeCtx(new Map([["A", { score: T - 1 }]]));
      await stage.run(args, ctx);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("abort signal", () => {
    it("批次间检查 signal.aborted → 抛 'aborted_during_quality_scoring'", async () => {
      // 多于 BATCH_SIZE 个 item，使两个批次都跑
      const N = RADAR_PIPELINE_DEFAULTS.qualityBatchSize + 2;
      const ids = Array.from({ length: N }, (_, i) => `ID${i}`);
      const items = ids.map((id) => ({ id, title: id, content: "" }));
      const rels = new Map(ids.map((id) => [id, { score: T + 10 }]));
      const ctx = makeCtx(rels, items);

      let calls = 0;
      chat.chat.mockImplementation(() => {
        calls += 1;
        if (calls === 1) {
          (ctx.signal as any) = { aborted: true } as AbortSignal;
        }
        return Promise.resolve({
          content: JSON.stringify({ items: [] }),
        });
      });

      await expect(stage.run(args, ctx)).rejects.toThrow(
        "aborted_during_quality_scoring",
      );
    });
  });

  describe("systemPrompt fallback", () => {
    it("args.systemPrompt 为 undefined 时使用内置默认 prompt", async () => {
      const ctx = makeCtx(new Map([["A", { score: T + 10 }]]));
      await stage.run({} as RadarStageHookArgs, ctx);
      expect(chat.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("AI 雷达"),
        }),
      );
    });

    it("args.systemPrompt 提供时优先使用", async () => {
      const ctx = makeCtx(new Map([["A", { score: T + 10 }]]));
      await stage.run(
        { systemPrompt: "custom-prompt" } as RadarStageHookArgs,
        ctx,
      );
      expect(chat.chat).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: "custom-prompt" }),
      );
    });
  });
});
