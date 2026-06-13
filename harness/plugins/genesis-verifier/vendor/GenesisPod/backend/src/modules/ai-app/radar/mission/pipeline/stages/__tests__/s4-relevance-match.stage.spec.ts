/**
 * RadarS4RelevanceStage — 关键词匹配模式（semantic / literal / hybrid）
 *
 * 锁定 2026-05-21 新增的字面/精确匹配语义：
 *  - semantic：行为不变，全部走 LLM 评分
 *  - literal ：标题+正文未含任一关键词 → 判 0 分淘汰 + 跳过 LLM（省 token）
 *  - hybrid  ：字面命中 → LLM 分上加 LITERAL_MATCH_BOOST（上限 100），不淘汰未命中
 *  - 子串大小写不敏感；空关键词时 literal 不淘汰任何条目（避免清空结果）
 */

import { Test } from "@nestjs/testing";
import { AiChatService } from "@/modules/ai-engine/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RadarS4RelevanceStage } from "../s4-relevance.stage";
import { RADAR_LITERAL_MISS_REASON } from "../../../../runtime/radar.constants";
import type {
  RadarMissionContext,
  RadarStageHookArgs,
} from "../radar-stage-types";

describe("RadarS4RelevanceStage — 关键词匹配模式", () => {
  let stage: RadarS4RelevanceStage;
  let chat: { chat: jest.Mock };
  let prisma: { $transaction: jest.Mock; radarItem: { update: jest.Mock } };

  beforeEach(async () => {
    // LLM 对收到的任何条目都回 70 分（超集返回也安全：scoreBatch 只取 batch 内 id）
    chat = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          items: [
            { id: "A", relevanceScore: 70, reason: "ok" },
            { id: "B", relevanceScore: 70, reason: "ok" },
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
        RadarS4RelevanceStage,
        { provide: AiChatService, useValue: chat },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    stage = moduleRef.get(RadarS4RelevanceStage);
  });

  afterEach(() => jest.restoreAllMocks());

  // A = 命中（标题含 Cisco），B = 未命中
  function makeCtx(matchMode: string, keywords: string[]): RadarMissionContext {
    return {
      missionId: "m-1",
      userId: "u-1",
      signal: { aborted: false } as AbortSignal,
      input: { topicId: "topic-1" },
      state: {
        topic: {
          id: "topic-1",
          name: "Cisco",
          description: null,
          entityType: null,
          keywords,
          matchMode,
        },
        newItemIds: ["A", "B"],
        uniqueItems: [
          {
            title: "Cisco UCS launch",
            content: "new server line",
            url: "",
            sourceId: "s1",
          },
          {
            title: "Unrelated networking news",
            content: "nothing here",
            url: "",
            sourceId: "s1",
          },
        ],
        metrics: {},
      },
    } as unknown as RadarMissionContext;
  }

  const args = {} as RadarStageHookArgs;

  it("semantic：两条都走 LLM 评分，不淘汰不加分", async () => {
    const ctx = makeCtx("semantic", ["Cisco"]);
    await stage.run(args, ctx);
    const scores = ctx.state.relevanceScores!;
    expect(scores.get("A")?.score).toBe(70);
    expect(scores.get("B")?.score).toBe(70);
    expect(chat.chat).toHaveBeenCalledTimes(1);
  });

  it("literal：未命中关键词的条目判 0 分淘汰，且不进 LLM", async () => {
    const ctx = makeCtx("literal", ["Cisco"]);
    await stage.run(args, ctx);
    const scores = ctx.state.relevanceScores!;
    expect(scores.get("A")?.score).toBe(70); // 命中 → LLM 分
    expect(scores.get("B")?.score).toBe(0); // 未命中 → 0（若进了 LLM 会是 70）
    expect(scores.get("B")?.reason).toBe(RADAR_LITERAL_MISS_REASON);
  });

  it("literal：命中判断对标题+正文大小写不敏感", async () => {
    const ctx = makeCtx("literal", ["cisco"]); // 小写关键词命中 "Cisco UCS launch"
    await stage.run(args, ctx);
    expect(ctx.state.relevanceScores!.get("A")?.score).toBe(70);
  });

  it("hybrid：命中条目 LLM 分 +20（上限 100），未命中保留 LLM 分不淘汰", async () => {
    const ctx = makeCtx("hybrid", ["Cisco"]);
    await stage.run(args, ctx);
    const scores = ctx.state.relevanceScores!;
    expect(scores.get("A")?.score).toBe(90); // 70 + 20
    expect(scores.get("B")?.score).toBe(70); // 未命中不淘汰
  });

  it("literal + 空关键词：不淘汰任何条目（避免清空结果）", async () => {
    const ctx = makeCtx("literal", []);
    await stage.run(args, ctx);
    const scores = ctx.state.relevanceScores!;
    expect(scores.get("A")?.score).toBe(70);
    expect(scores.get("B")?.score).toBe(70);
  });
});
