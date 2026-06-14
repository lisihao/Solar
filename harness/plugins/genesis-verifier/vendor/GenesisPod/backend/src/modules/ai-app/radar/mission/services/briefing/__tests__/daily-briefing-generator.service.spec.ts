/**
 * DailyBriefingGeneratorService 单元测试
 *
 * 重点锁 R13 P0 BUG（2026-05-19）：
 * - 双除 100 → score 永远 < 0.01 → candidatePool 永远空 → 全 topic
 *   全用户 daily briefing 永远 no_signals。本测试用 rel=80/qual=70 真实
 *   值，断言 signal-editor 被调用（=item 通过 Stage A 阈值）。修前任何
 *   item 都过不去 0.55，本测试在修前必然 fail。
 *
 * - force=true / false 的幂等控制：手动 rerun 必须 force=true 绕过；
 *   BullMQ 自动调度默认 force=false 保留幂等防 worker 重复跑。
 */

import { Test } from "@nestjs/testing";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DailyBriefingGeneratorService } from "../daily-briefing-generator.service";
import { RadarDailyBriefingRepo } from "../radar-daily-briefing.repo";
import { SignalEditorService } from "../signal-editor.service";

describe("DailyBriefingGeneratorService", () => {
  let svc: DailyBriefingGeneratorService;
  let prisma: {
    radarTopic: { findUnique: jest.Mock };
    radarItem: { findMany: jest.Mock };
  };
  let dailyRepo: {
    findByTopicAndDate: jest.Mock;
    getYesterdayEntities: jest.Mock;
    upsert: jest.Mock;
  };
  let signalEditor: { edit: jest.Mock };
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      radarTopic: {
        findUnique: jest.fn().mockResolvedValue({
          id: "topic-1",
          name: "Test Topic",
          description: null,
          keywords: ["AI"],
          signalTypes: ["turning_point", "trend_acceleration"],
          outputLanguage: "zh-CN",
        }),
      },
      radarItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    dailyRepo = {
      findByTopicAndDate: jest.fn().mockResolvedValue(null),
      getYesterdayEntities: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    };
    signalEditor = { edit: jest.fn().mockResolvedValue([]) };
    eventEmitter = { emit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DailyBriefingGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: RadarDailyBriefingRepo, useValue: dailyRepo },
        { provide: SignalEditorService, useValue: signalEditor },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();
    svc = moduleRef.get(DailyBriefingGeneratorService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeItem(over?: Partial<Record<string, unknown>>) {
    return {
      id: "item-1",
      title: "Cisco announces new Catalyst switch",
      content: "Long content...",
      url: "https://blogs.cisco.com/foo",
      publishedAt: new Date(), // now → freshness ≈ 1.0
      sourceId: "src-1",
      relevanceScore: 80,
      qualityScore: 70,
      metrics: null,
      source: {
        id: "src-1",
        label: "Cisco Blogs",
        identifier: "https://blogs.cisco.com/feed",
        authorityWeight: 3,
      },
      ...over,
    };
  }

  // ── R13 P0 BUG 回归 ────────────────────────────────────────────────

  describe("R13 P0: double-divide 100 regression", () => {
    it("item with stored rel=80 qual=70 enters Stage A and reaches signal-editor (would FAIL before R13 fix)", async () => {
      prisma.radarItem.findMany.mockResolvedValue([makeItem()]);
      // signal-editor 假装出一条信号（不为空 → 走到 completed 路径）
      signalEditor.edit.mockResolvedValue([
        {
          id: "sig-1",
          tier: 3,
          title: "T",
          oneLineTakeaway: "x",
          whyItMatters: "y",
          whatsNext: "z",
          signalTags: [],
          entities: [],
          evidenceItemIds: ["item-1"],
        },
      ]);

      const result = await svc.generateForTopic({
        topicId: "topic-1",
        userId: "user-1",
        briefingDate: "2026-05-19",
        missionId: "m-1",
      });

      // 修复前：score ≈ 0.35*0.008 + ... ≈ 0.005 < 0.55 → candidatePool=0
      //         → signal-editor.edit 不会被调用 → selectedCount=0
      // 修复后：score ≈ 0.35*0.8 + 0.25*0.7 + 0.15*0.6 + 0.15*1 ≈ 0.7 > 0.55
      //         → candidatePool=1 → signal-editor.edit 被调用
      expect(signalEditor.edit).toHaveBeenCalledTimes(1);
      expect(result.candidatesCount).toBe(1);
      expect(result.status).toBe("completed");
      expect(result.selectedCount).toBe(1);
    });

    it("item with very low scores (rel=10 qual=10) correctly filtered by relevanceThreshold gate", async () => {
      prisma.radarItem.findMany.mockResolvedValue([
        makeItem({ relevanceScore: 10, qualityScore: 10 }),
      ]);

      const result = await svc.generateForTopic({
        topicId: "topic-1",
        userId: "user-1",
        briefingDate: "2026-05-19",
        missionId: "m-1",
      });

      // rel=10 < relevanceThreshold=40 → 直接被 if-continue 过滤
      // signal-editor 不应被调用
      expect(signalEditor.edit).not.toHaveBeenCalled();
      expect(result.status).toBe("no_signals");
    });
  });

  // ── R13 force=true 幂等控制 ────────────────────────────────────────

  describe("R13 force flag", () => {
    it("force=false (default) preserves idempotency: skips regen when briefing already exists", async () => {
      dailyRepo.findByTopicAndDate.mockResolvedValue({
        status: "no_signals",
        signals: [],
      });

      const result = await svc.generateForTopic({
        topicId: "topic-1",
        userId: "user-1",
        briefingDate: "2026-05-19",
        missionId: "m-1",
        // force omitted → default false
      });

      // early return → 没去查 radarItem 没调 signal-editor
      expect(prisma.radarItem.findMany).not.toHaveBeenCalled();
      expect(signalEditor.edit).not.toHaveBeenCalled();
      expect(result.status).toBe("no_signals");
    });

    it("force=true bypasses idempotency: regenerates even when briefing exists with no_signals", async () => {
      dailyRepo.findByTopicAndDate.mockResolvedValue({
        status: "no_signals",
        signals: [],
      });
      prisma.radarItem.findMany.mockResolvedValue([makeItem()]);
      signalEditor.edit.mockResolvedValue([
        {
          id: "sig-1",
          tier: 3,
          title: "T",
          oneLineTakeaway: "x",
          whyItMatters: "y",
          whatsNext: "z",
          signalTags: [],
          entities: [],
          evidenceItemIds: ["item-1"],
        },
      ]);

      const result = await svc.generateForTopic({
        topicId: "topic-1",
        userId: "user-1",
        briefingDate: "2026-05-19",
        missionId: "m-1",
        force: true,
      });

      // force=true → 即使 briefing 存在也走完整流程
      expect(prisma.radarItem.findMany).toHaveBeenCalledTimes(1);
      expect(signalEditor.edit).toHaveBeenCalledTimes(1);
      expect(dailyRepo.upsert).toHaveBeenCalledTimes(1);
      // upsert 用 completed 状态覆盖原 no_signals
      const upsertArg = dailyRepo.upsert.mock.calls[0]?.[0];
      expect(upsertArg.status).toBe("completed");
      expect(result.selectedCount).toBe(1);
    });

    it("no existing briefing: behaves the same regardless of force", async () => {
      dailyRepo.findByTopicAndDate.mockResolvedValue(null);
      prisma.radarItem.findMany.mockResolvedValue([]);

      const result = await svc.generateForTopic({
        topicId: "topic-1",
        userId: "user-1",
        briefingDate: "2026-05-19",
        missionId: "m-1",
      });

      expect(prisma.radarItem.findMany).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("no_signals");
    });
  });
});
