/**
 * RadarS7InsightStage — 信号洞察合成
 *
 * 锁定行为：
 *  - 输入要求 ctx.state.topic 存在；缺失时抛 "S7 insight: ctx.state.topic 缺失"
 *  - 只用 accepted 条件（relevance >= acceptedRelevanceMin && quality >= acceptedQualityMin）
 *  - acceptedItems 空时跳过 LLM，不写 insightPayload
 *  - 查上期 RadarInsight（按 topicId / periodTo desc）
 *  - LLM 不可解析 / throw → buildFallbackInsight（summary + 空 highlights/signals/topEntities）
 *  - highlights / signals 越界 → slice(5)
 *  - highlight type 非法 → 'trend'
 *  - signal magnitude 越界/非数 → clamp [0,10] / 5
 *  - topEntities 空时由 entityFreq 兜底（最多 8 个）
 *  - abort signal：进入前 + 计算 entityFreq 后两个 checkpoint 抛 aborted_during_insight_synthesis
 */

import { Test } from "@nestjs/testing";
import { AiChatService } from "@/modules/ai-engine/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RadarS7InsightStage } from "../s7-insight.stage";
import { RADAR_PIPELINE_DEFAULTS } from "../../../../runtime/radar.constants";
import type {
  RadarMissionContext,
  RadarStageHookArgs,
} from "../radar-stage-types";

describe("RadarS7InsightStage", () => {
  let stage: RadarS7InsightStage;
  let chat: { chat: jest.Mock };
  let prisma: { radarInsight: { findFirst: jest.Mock } };

  beforeEach(async () => {
    chat = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          summary: "本期主要看到 Cisco UCS 新品发布",
          highlights: [
            {
              title: "Cisco UCS",
              itemIds: ["A"],
              type: "key-event",
            },
          ],
          signals: [
            { kind: "硬件发布", magnitude: 7, evidence: "Cisco 发布新服务器" },
          ],
          topEntities: [
            { type: "company", name: "Cisco", mentions: 3, delta: 1 },
          ],
        }),
      }),
    };
    prisma = {
      radarInsight: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RadarS7InsightStage,
        { provide: AiChatService, useValue: chat },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    stage = moduleRef.get(RadarS7InsightStage);
  });

  afterEach(() => jest.restoreAllMocks());

  const args = {} as RadarStageHookArgs;
  const R = RADAR_PIPELINE_DEFAULTS.acceptedRelevanceMin;
  const Q = RADAR_PIPELINE_DEFAULTS.acceptedQualityMin;

  function makeCtx(
    opts: {
      items?: { id: string; title?: string; content?: string }[];
      relevanceScores?: Map<string, { score: number }>;
      qualityScores?: Map<string, { score: number; summary?: string }>;
      entityMap?: Map<
        string,
        {
          type: string;
          name: string;
          normalizedName: string;
          confidence: number;
        }[]
      >;
      topic?: any;
    } = {},
  ): RadarMissionContext {
    const items = opts.items ?? [
      { id: "A", title: "Cisco UCS launch", content: "server line" },
    ];
    return {
      missionId: "m-1",
      userId: "u-1",
      signal: { aborted: false } as AbortSignal,
      input: { topicId: "topic-1" },
      state: {
        // 不能用 ?? 兜底：null 会被 ?? 替成默认 topic，导致传 null 不生效
        topic:
          "topic" in opts
            ? opts.topic
            : {
                id: "topic-1",
                name: "Cisco",
                description: null,
                entityType: null,
                keywords: ["Cisco"],
                matchMode: "semantic",
              },
        newItemIds: items.map((x) => x.id),
        uniqueItems: items.map((x) => ({
          title: x.title ?? "",
          content: x.content ?? "",
          url: "",
          publishedAt: new Date("2026-05-20T00:00:00Z"),
          sourceId: "s1",
        })),
        relevanceScores:
          opts.relevanceScores ??
          new Map(items.map((x) => [x.id, { score: R + 10 }])),
        qualityScores:
          opts.qualityScores ??
          new Map(items.map((x) => [x.id, { score: Q + 10, summary: "ok" }])),
        entityMap: opts.entityMap ?? new Map(),
        metrics: {},
      },
    } as unknown as RadarMissionContext;
  }

  describe("guards", () => {
    it("topic 缺失 → 抛 'S7 insight: ctx.state.topic 缺失'", async () => {
      const ctx = makeCtx({ topic: null });
      await expect(stage.run(args, ctx)).rejects.toThrow(
        "S7 insight: ctx.state.topic 缺失",
      );
    });

    it("acceptedItems=0 → 跳过 LLM，insightPayload 不写", async () => {
      const ctx = makeCtx({
        relevanceScores: new Map([["A", { score: R - 5 }]]),
      });
      await stage.run(args, ctx);
      expect(chat.chat).not.toHaveBeenCalled();
      expect(ctx.state.insightPayload).toBeUndefined();
    });

    it("进入前 signal.aborted → 抛 aborted_during_insight_synthesis", async () => {
      const ctx = makeCtx();
      (ctx.signal as any) = { aborted: true } as AbortSignal;
      await expect(stage.run(args, ctx)).rejects.toThrow(
        "aborted_during_insight_synthesis",
      );
    });
  });

  describe("LLM 正常路径", () => {
    it("写 insightPayload 并按 LLM 输出归一", async () => {
      const ctx = makeCtx();
      await stage.run(args, ctx);
      const p = ctx.state.insightPayload!;
      expect(p.summary).toContain("Cisco UCS");
      expect(p.highlights).toHaveLength(1);
      expect(p.highlights[0].type).toBe("key-event");
      expect(p.signals[0].magnitude).toBe(7);
      expect(p.topEntities[0].name).toBe("Cisco");
    });

    it("查上期 insight 用于对照（findFirst 调用一次）", async () => {
      const ctx = makeCtx();
      await stage.run(args, ctx);
      expect(prisma.radarInsight.findFirst).toHaveBeenCalledWith({
        where: { topicId: "topic-1" },
        orderBy: { periodTo: "desc" },
      });
    });

    it("highlight type 非法 → fallback 'trend'", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          summary: "x",
          highlights: [{ title: "h1", itemIds: ["A"], type: "WILD" }],
          signals: [],
          topEntities: [],
        }),
      });
      const ctx = makeCtx();
      await stage.run(args, ctx);
      expect(ctx.state.insightPayload!.highlights[0].type).toBe("trend");
    });

    it("highlights / signals 越界 → slice(5)", async () => {
      const manyH = Array.from({ length: 10 }, (_, i) => ({
        title: `h${i}`,
        itemIds: [],
        type: "trend",
      }));
      const manyS = Array.from({ length: 10 }, (_, i) => ({
        kind: `k${i}`,
        magnitude: 5,
        evidence: "e",
      }));
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          summary: "x",
          highlights: manyH,
          signals: manyS,
          topEntities: [],
        }),
      });
      const ctx = makeCtx();
      await stage.run(args, ctx);
      expect(ctx.state.insightPayload!.highlights).toHaveLength(5);
      expect(ctx.state.insightPayload!.signals).toHaveLength(5);
    });

    it("signal magnitude 越界 / 非数 → clamp [0,10] / 5", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          summary: "x",
          highlights: [],
          signals: [
            { kind: "k1", magnitude: 50, evidence: "e" },
            { kind: "k2", magnitude: -3, evidence: "e" },
            { kind: "k3", magnitude: "x", evidence: "e" },
          ],
          topEntities: [],
        }),
      });
      const ctx = makeCtx();
      await stage.run(args, ctx);
      const sigs = ctx.state.insightPayload!.signals;
      expect(sigs[0].magnitude).toBe(10);
      expect(sigs[1].magnitude).toBe(0);
      expect(sigs[2].magnitude).toBe(5);
    });

    it("topEntities 空 → 由 entityMap 频率兜底（最多 8 个）", async () => {
      const eMap = new Map();
      const buildEntities = (...names: string[]) =>
        names.map((n) => ({
          type: "company",
          name: n,
          normalizedName: n.toLowerCase(),
          confidence: 0.8,
        }));
      // 给 A 加多个实体，制造频率分布
      eMap.set(
        "A",
        buildEntities("Cisco", "Cisco", "Nvidia", "Apple", "Intel"),
      );

      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          summary: "x",
          highlights: [],
          signals: [],
          topEntities: [],
        }),
      });
      const ctx = makeCtx({ entityMap: eMap });
      await stage.run(args, ctx);
      const top = ctx.state.insightPayload!.topEntities;
      expect(top.length).toBeGreaterThan(0);
      expect(top.length).toBeLessThanOrEqual(8);
      // 频率最高的应该是 Cisco（出现 2 次）
      expect(top[0].name).toBe("Cisco");
      expect(top[0].mentions).toBe(2);
    });
  });

  describe("LLM 失败兜底", () => {
    it("LLM 返回不可解析 → fallback insight（summary 含 'LLM 洞察生成失败'）", async () => {
      chat.chat.mockResolvedValueOnce({ content: "not json" });
      const ctx = makeCtx();
      await stage.run(args, ctx);
      expect(ctx.state.insightPayload!.summary).toContain("LLM 洞察生成失败");
    });

    it("LLM throw → fallback insight", async () => {
      chat.chat.mockRejectedValueOnce(new Error("upstream"));
      const ctx = makeCtx();
      await stage.run(args, ctx);
      expect(ctx.state.insightPayload!.summary).toContain("LLM 洞察生成失败");
      expect(ctx.state.insightPayload!.highlights).toEqual([]);
    });

    it("LLM 返回 summary 不是 string → fallback", async () => {
      chat.chat.mockResolvedValueOnce({
        content: JSON.stringify({ summary: 123, highlights: [] }),
      });
      const ctx = makeCtx();
      await stage.run(args, ctx);
      expect(ctx.state.insightPayload!.summary).toContain("LLM 洞察生成失败");
    });
  });
});
