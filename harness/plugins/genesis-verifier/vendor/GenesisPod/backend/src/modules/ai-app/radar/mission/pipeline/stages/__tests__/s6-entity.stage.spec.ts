/**
 * RadarS6EntityStage — 实体抽取阶段
 *
 * 锁定行为：
 *  - 仅对 qualityScore >= RADAR_PIPELINE_DEFAULTS.acceptedQualityMin 的 item 跑 LLM
 *  - 批量 8 个一批，整批兜底 entities=[]
 *  - LLM 漏抽 / type 非法 / confidence 非数 → fallback
 *  - 每条最多 RADAR_MAX_ENTITIES_PER_ITEM 个实体（slice 截断）
 *  - 持久化：每 item 一次 update，包在单 $transaction
 *  - abort signal：批次间检查抛 aborted_during_entity_extraction
 */

import { Test } from "@nestjs/testing";
import { AiChatService } from "@/modules/ai-engine/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RadarS6EntityStage } from "../s6-entity.stage";
import {
  RADAR_PIPELINE_DEFAULTS,
  RADAR_MAX_ENTITIES_PER_ITEM,
} from "../../../../runtime/radar.constants";
import type {
  RadarMissionContext,
  RadarStageHookArgs,
} from "../radar-stage-types";

describe("RadarS6EntityStage", () => {
  let stage: RadarS6EntityStage;
  let chat: { chat: jest.Mock };
  let prisma: { $transaction: jest.Mock; radarItem: { update: jest.Mock } };

  beforeEach(async () => {
    chat = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          items: [
            {
              id: "A",
              entities: [
                {
                  type: "company",
                  name: "Cisco",
                  normalizedName: "cisco",
                  confidence: 0.9,
                },
              ],
            },
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
        RadarS6EntityStage,
        { provide: AiChatService, useValue: chat },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    stage = moduleRef.get(RadarS6EntityStage);
  });

  afterEach(() => jest.restoreAllMocks());

  const args = {} as RadarStageHookArgs;
  const Q = RADAR_PIPELINE_DEFAULTS.acceptedQualityMin;

  function makeCtx(
    qualityScores: Map<string, { score: number; summary?: string }>,
    items: { id: string; title?: string; content?: string }[] = [
      { id: "A", title: "Cisco UCS launch", content: "server line" },
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
          url: "",
          sourceId: "s1",
        })),
        qualityScores,
        metrics: {},
      },
    } as unknown as RadarMissionContext;
  }

  describe("filtering by acceptedQualityMin", () => {
    it("跳过 qualityScore < acceptedQualityMin 的 item", async () => {
      const ctx = makeCtx(
        new Map([
          ["A", { score: Q + 5 }],
          ["B", { score: Q - 5 }],
        ]),
        [
          { id: "A", title: "x" },
          { id: "B", title: "y" },
        ],
      );
      await stage.run(args, ctx);
      const m = ctx.state.entityMap!;
      expect(m.has("A")).toBe(true);
      expect(m.has("B")).toBe(false);
    });

    it("无可处理 item → 空 map + 不调 LLM", async () => {
      const ctx = makeCtx(new Map([["A", { score: Q - 1 }]]));
      await stage.run(args, ctx);
      expect(ctx.state.entityMap!.size).toBe(0);
      expect(chat.chat).not.toHaveBeenCalled();
    });

    it("uniqueItems 空时空 map + 不调 LLM", async () => {
      const ctx = makeCtx(new Map(), []);
      await stage.run(args, ctx);
      expect(ctx.state.entityMap!.size).toBe(0);
      expect(chat.chat).not.toHaveBeenCalled();
    });
  });

  describe("LLM 解析 / 边界", () => {
    it("LLM 返回不可解析 → 整批空实体兜底", async () => {
      chat.chat.mockResolvedValueOnce({ content: "garbage" });
      const ctx = makeCtx(new Map([["A", { score: Q + 5 }]]));
      await stage.run(args, ctx);
      expect(ctx.state.entityMap!.get("A")).toEqual([]);
    });

    it("LLM throw → 整批空实体兜底", async () => {
      chat.chat.mockRejectedValueOnce(new Error("timeout"));
      const ctx = makeCtx(new Map([["A", { score: Q + 5 }]]));
      await stage.run(args, ctx);
      expect(ctx.state.entityMap!.get("A")).toEqual([]);
    });

    it("type 非法 → fallback 'other'", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            {
              id: "A",
              entities: [
                {
                  type: "nonsense",
                  name: "X",
                  normalizedName: "x",
                  confidence: 0.5,
                },
              ],
            },
          ],
        }),
      });
      const ctx = makeCtx(new Map([["A", { score: Q + 5 }]]));
      await stage.run(args, ctx);
      expect(ctx.state.entityMap!.get("A")![0].type).toBe("other");
    });

    it("confidence 越界 / 非数 → clamp 到 [0,1] 或 0.5", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            {
              id: "A",
              entities: [
                {
                  type: "company",
                  name: "C1",
                  normalizedName: "c1",
                  confidence: 2.5,
                },
                {
                  type: "company",
                  name: "C2",
                  normalizedName: "c2",
                  confidence: -1,
                },
                {
                  type: "company",
                  name: "C3",
                  normalizedName: "c3",
                  confidence: "x",
                },
              ],
            },
          ],
        }),
      });
      const ctx = makeCtx(new Map([["A", { score: Q + 5 }]]));
      await stage.run(args, ctx);
      const es = ctx.state.entityMap!.get("A")!;
      expect(es[0].confidence).toBe(1);
      expect(es[1].confidence).toBe(0);
      expect(es[2].confidence).toBe(0.5);
    });

    it("丢空 name 实体", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            {
              id: "A",
              entities: [
                {
                  type: "company",
                  name: "",
                  normalizedName: "",
                  confidence: 0.5,
                },
                {
                  type: "company",
                  name: "Cisco",
                  normalizedName: "cisco",
                  confidence: 0.9,
                },
              ],
            },
          ],
        }),
      });
      const ctx = makeCtx(new Map([["A", { score: Q + 5 }]]));
      await stage.run(args, ctx);
      const es = ctx.state.entityMap!.get("A")!;
      expect(es).toHaveLength(1);
      expect(es[0].name).toBe("Cisco");
    });

    it("超过 RADAR_MAX_ENTITIES_PER_ITEM → slice 截断", async () => {
      const many = Array.from(
        { length: RADAR_MAX_ENTITIES_PER_ITEM + 5 },
        (_, i) => ({
          type: "company",
          name: `C${i}`,
          normalizedName: `c${i}`,
          confidence: 0.5,
        }),
      );
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({ items: [{ id: "A", entities: many }] }),
      });
      const ctx = makeCtx(new Map([["A", { score: Q + 5 }]]));
      await stage.run(args, ctx);
      expect(ctx.state.entityMap!.get("A")!).toHaveLength(
        RADAR_MAX_ENTITIES_PER_ITEM,
      );
    });

    it("LLM 漏抽某条 → 该条 entities=[]", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          items: [
            {
              id: "A",
              entities: [
                {
                  type: "company",
                  name: "Cisco",
                  normalizedName: "cisco",
                  confidence: 0.9,
                },
              ],
            },
          ],
        }),
      });
      const ctx = makeCtx(
        new Map([
          ["A", { score: Q + 5 }],
          ["B", { score: Q + 5 }],
        ]),
        [{ id: "A" }, { id: "B" }],
      );
      await stage.run(args, ctx);
      expect(ctx.state.entityMap!.get("A")).toHaveLength(1);
      expect(ctx.state.entityMap!.get("B")).toEqual([]);
    });
  });

  describe("持久化", () => {
    it("每 item 一次 update，包在 $transaction", async () => {
      const ctx = makeCtx(new Map([["A", { score: Q + 5 }]]));
      await stage.run(args, ctx);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.radarItem.update).toHaveBeenCalledTimes(1);
      const c = prisma.radarItem.update.mock.calls[0][0];
      expect(c.where.id).toBe("A");
      expect(c.data).toHaveProperty("entities");
    });

    it("无可处理 item → 不调 $transaction", async () => {
      const ctx = makeCtx(new Map([["A", { score: Q - 1 }]]));
      await stage.run(args, ctx);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("abort signal", () => {
    it("批次间触发 abort → 抛 aborted_during_entity_extraction", async () => {
      const N = RADAR_PIPELINE_DEFAULTS.entityBatchSize + 1;
      const ids = Array.from({ length: N }, (_, i) => `I${i}`);
      const items = ids.map((id) => ({ id, title: id }));
      const quals = new Map(ids.map((id) => [id, { score: Q + 5 }]));
      const ctx = makeCtx(quals, items);

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
        "aborted_during_entity_extraction",
      );
    });
  });
});
