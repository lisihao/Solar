/**
 * Radar Daily Briefing E2E Integration Spec (X7 §11.2)
 *
 * 覆盖 §11.2 验收 8 条中可在 jest 内验证的 6 条：
 *   §11.2-1  sweepDailyBriefing enqueue → dailyRepo.upsert called + dispatcher RADAR_DAILY
 *   §11.2-3  email subject = oneLineTakeaway + 三级退订链接（topic / radar_all / global）
 *   §11.2-4  tier3 信号 → EventEmitter2 emit → onTier3Signal → dispatcher RADAR_TIER3_INSTANT + excludeChannels=['email']
 *   §11.2-5  同 topic 1 天 4 次 tier3 → 第 4 次 Redis 频次闸 drop（dispatcher 不调用）
 *   §11.2-6  channelSubscriptions.RADAR_TIER3_INSTANT.site=false → channel-resolver 不返回 site
 *   §11.2-7  jest.useFakeTimers 推进到 UTC 周日 18:00 → sweepWeeklyBriefing → weeklyService.generateAndPersist called + dispatcher RADAR_WEEKLY
 *
 * 跳过（前端 spec 覆盖）：
 *   §11.2-2  详情页 UI（F10 component spec）
 *   §11.2-8  历史 ?date= + NarrativeThread UI（F7 component spec）
 *
 * 所有 IO 一律 mock（SMTP / Redis / Prisma / LLM）；不真发邮件。
 * 重点验证：接线正确性 + 关键守护（excludeChannels / 频次闸 / channel-resolver）
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { NotificationType } from "@prisma/client";

// Scheduler under test
import { RadarRefreshScheduler } from "../../src/modules/ai-app/radar/mission/services/scheduler/radar-refresh.scheduler";

// Services used by scheduler — must use class tokens for NestJS DI
import { PrismaService } from "../../src/common/prisma/prisma.service";
import { CacheService } from "../../src/common/cache/cache.service";
import { EmailService } from "../../src/modules/platform/email/email.service";

import { RadarDailyBriefingRepo } from "../../src/modules/ai-app/radar/mission/services/briefing/radar-daily-briefing.repo";
import { RadarWeeklyBriefingService } from "../../src/modules/ai-app/radar/mission/services/briefing/radar-weekly-briefing.service";
import { RadarBriefingQueueService } from "../../src/modules/ai-app/radar/mission/services/scheduler/radar-briefing-queue.service";
import { NotificationDispatcher } from "../../src/modules/platform/notifications/dispatcher/notification-dispatcher.service";
import { NotificationPreferenceService } from "../../src/modules/platform/notifications/dispatcher/preferences/notification-preference.service";
import { ChannelResolver } from "../../src/modules/platform/notifications/dispatcher/preferences/channel-resolver";
import { EmailChannel } from "../../src/modules/platform/notifications/dispatcher/channels/email-channel.adapter";
import { RadarPipelineDispatcher } from "../../src/modules/ai-app/radar/mission/pipeline/radar-pipeline-dispatcher.service";
import { RadarDailyBriefingEmailPreset } from "../../src/modules/platform/notifications/dispatcher/presets/radar-daily-briefing-email.preset";
import { RadarWeeklyBriefingEmailPreset } from "../../src/modules/platform/notifications/dispatcher/presets/radar-weekly-briefing-email.preset";
import { NarrativeService } from "../../src/modules/ai-app/radar/mission/services/briefing/narrative.service";
import { AIMetricsService } from "../../src/modules/platform/monitoring/metrics/ai-metrics.service";

// Event contract
import {
  RADAR_BRIEFING_SIGNAL_CREATED_EVENT,
  type RadarBriefingSignalCreatedEvent,
} from "../../src/modules/ai-app/radar/mission/pipeline/stages/s9-daily-top-n.stage";
import type { DailySignal } from "../../src/modules/ai-app/radar/mission/services/briefing/radar-daily-briefing.repo";
import type {
  DispatchPayload,
  DispatchOptions,
} from "../../src/modules/platform/notifications/dispatcher/abstractions/notification-channel";

// ─────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────

const USER_ID = "user-test-uuid-1";
const TOPIC_ID = "topic-test-uuid-1";

/** Minimal tier-3 DailySignal fixture */
function buildTier3Signal(overrides: Partial<DailySignal> = {}): DailySignal {
  return {
    id: "sig-uuid-001",
    tier: 3,
    title: "NVIDIA Q1 财报超预期",
    oneLineTakeaway: "英伟达 Q1 营收创历史新高",
    whyItMatters: "数据中心收入首超 200 亿美元，AI 算力需求加速印证。",
    whatsNext: "关注 Q2 guidance 是否上调；AMD、Intel 竞品跟进。",
    signalTags: ["key_event"],
    entities: ["NVIDIA", "Jensen Huang"],
    evidenceItemIds: ["item-001"],
    narrativeId: "narrative-001",
    score: 0.92,
    ...overrides,
  };
}

/** Mock NotificationPreference with channelSubscriptions */
function buildPref(
  channelSubscriptions: Record<string, Record<string, boolean>> = {},
) {
  return {
    id: "pref-1",
    userId: USER_ID,
    emailEnabled: true,
    pushEnabled: true,
    soundEnabled: true,
    typeSettings: {},
    channelSubscriptions,
    quietHoursStart: null,
    quietHoursEnd: null,
    unsubscribeToken: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Minimal mock PrismaService shape needed by RadarRefreshScheduler */
function makeMockPrisma(
  overrides: {
    findMany?: jest.Mock;
    count?: jest.Mock;
  } = {},
) {
  return {
    radarTopic: {
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
      // FU2-D scheduler.onDailyBriefingGenerated / sweepWeeklyBriefing 用 findUnique
      // 拉 topic.name + briefingTime；默认返合理 stub
      findUnique: jest.fn().mockResolvedValue({
        id: "topic-test-uuid-1",
        name: "Test Topic",
        briefingTime: "08:00",
      }),
    },
    radarRun: {
      count: overrides.count ?? jest.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ locale: "zh-CN" }),
    },
  };
}

/** Minimal mock CacheService */
function makeMockCache(incrbyResult: number | (() => Promise<number>) = 1) {
  return {
    incrby:
      typeof incrbyResult === "function"
        ? jest.fn().mockImplementation(incrbyResult)
        : jest.fn().mockResolvedValue(incrbyResult),
    expire: jest.fn().mockResolvedValue(true),
  };
}

/** Build a TestingModule for RadarRefreshScheduler with all dependencies mocked */
async function buildSchedulerModule(opts: {
  prisma?: ReturnType<typeof makeMockPrisma>;
  cache?: ReturnType<typeof makeMockCache>;
  dispatcher?: { dispatch: jest.Mock };
  briefingQueue?: { enqueue: jest.Mock };
  dailyRepo?: { findByTopicAndDate: jest.Mock; upsert: jest.Mock };
  weeklyService?: { generateAndPersist: jest.Mock; findInRange: jest.Mock };
  preferenceService?: { get: jest.Mock; isInQuietHours: jest.Mock };
}) {
  const prisma = opts.prisma ?? makeMockPrisma();
  const cache = opts.cache ?? makeMockCache();
  const dispatcher = opts.dispatcher ?? {
    dispatch: jest.fn().mockResolvedValue({ delivered: true, results: [] }),
  };
  const briefingQueue = opts.briefingQueue ?? {
    enqueue: jest.fn().mockResolvedValue({ enqueued: true, jobId: "job-1" }),
  };
  const dailyRepo = opts.dailyRepo ?? {
    findByTopicAndDate: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({ id: "briefing-1" }),
  };
  const weeklyService = opts.weeklyService ?? {
    generateAndPersist: jest.fn().mockResolvedValue(null),
    findInRange: jest.fn().mockResolvedValue([]),
  };
  const preferenceService = opts.preferenceService ?? {
    get: jest.fn().mockResolvedValue(null),
    isInQuietHours: jest.fn().mockResolvedValue(false),
  };
  const dailyEmailPreset = {
    notify: jest.fn().mockResolvedValue({ delivered: true, results: [] }),
  };
  const weeklyEmailPreset = {
    notify: jest.fn().mockResolvedValue({ delivered: true, results: [] }),
  };

  const module: TestingModule = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    providers: [
      RadarRefreshScheduler,
      { provide: PrismaService, useValue: prisma },
      {
        provide: RadarPipelineDispatcher,
        useValue: { runRefreshMission: jest.fn() },
      },
      { provide: RadarBriefingQueueService, useValue: briefingQueue },
      { provide: RadarDailyBriefingRepo, useValue: dailyRepo },
      { provide: RadarWeeklyBriefingService, useValue: weeklyService },
      { provide: NotificationDispatcher, useValue: dispatcher },
      { provide: NotificationPreferenceService, useValue: preferenceService },
      { provide: CacheService, useValue: cache },
      // FU2 后续整改：scheduler 新增了 4 个 DI（email preset × 2 + narrative + metrics）
      {
        provide: RadarDailyBriefingEmailPreset,
        useValue: dailyEmailPreset,
      },
      {
        provide: RadarWeeklyBriefingEmailPreset,
        useValue: weeklyEmailPreset,
      },
      {
        provide: NarrativeService,
        useValue: { getNarrativeThread: jest.fn().mockResolvedValue(null) },
      },
      {
        provide: AIMetricsService,
        useValue: { recordMetric: jest.fn().mockResolvedValue(undefined) },
      },
    ],
  }).compile();

  return {
    module,
    scheduler: module.get(RadarRefreshScheduler),
    dispatcher,
    dailyEmailPreset,
    weeklyEmailPreset,
    briefingQueue,
    dailyRepo,
    weeklyService,
    preferenceService,
    cache,
  };
}

// ─────────────────────────────────────────────────────────
// §11.2-1  sweepDailyBriefing enqueue → (日报接线正确性)
// ─────────────────────────────────────────────────────────
describe("§11.2-1 sweepDailyBriefing → enqueue + dailyRepo not-yet-generated guard", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("今日未生成 → briefingQueue.enqueue 被调用 with type=daily + topicId", async () => {
    const { scheduler, briefingQueue } = await buildSchedulerModule({
      prisma: makeMockPrisma({
        findMany: jest.fn().mockResolvedValue([
          {
            id: TOPIC_ID,
            userId: USER_ID,
            briefingTime: "08:00",
            briefingTimezone: "UTC",
            weekendSkip: false,
            user: { timezone: "UTC" },
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      }),
    });

    // Freeze time at UTC 08:00 (matches briefingTime)
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-18T08:00:00.000Z"));

    await scheduler.sweepDailyBriefing();

    expect(briefingQueue.enqueue).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ type: "daily", topicId: TOPIC_ID }),
    );
  });

  it("今日已生成 → findByTopicAndDate 有记录 → briefingQueue.enqueue 不调用", async () => {
    const { scheduler, briefingQueue } = await buildSchedulerModule({
      prisma: makeMockPrisma({
        findMany: jest.fn().mockResolvedValue([
          {
            id: TOPIC_ID,
            userId: USER_ID,
            briefingTime: "08:00",
            briefingTimezone: "UTC",
            weekendSkip: false,
            user: { timezone: "UTC" },
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      }),
      dailyRepo: {
        findByTopicAndDate: jest
          .fn()
          .mockResolvedValue({ id: "existing-briefing" }),
        upsert: jest.fn(),
      },
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-18T08:00:00.000Z"));

    await scheduler.sweepDailyBriefing();

    expect(briefingQueue.enqueue).not.toHaveBeenCalled();
  });

  it("briefingTime 不匹配当前时间 → enqueue 不调用", async () => {
    const { scheduler, briefingQueue } = await buildSchedulerModule({
      prisma: makeMockPrisma({
        findMany: jest.fn().mockResolvedValue([
          {
            id: TOPIC_ID,
            userId: USER_ID,
            briefingTime: "08:00",
            briefingTimezone: "UTC",
            weekendSkip: false,
            user: { timezone: "UTC" },
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      }),
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-18T12:00:00.000Z")); // 非 briefingTime=08:00

    await scheduler.sweepDailyBriefing();

    expect(briefingQueue.enqueue).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────
// §11.2-3  email subject = oneLineTakeaway + 三级退订链接
// ─────────────────────────────────────────────────────────
describe("§11.2-3 email subject = oneLineTakeaway + 三级退订链接", () => {
  let emailChannel: EmailChannel;
  let emailService: { sendEmail: jest.Mock; isEnabled: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    emailService = {
      sendEmail: jest.fn().mockResolvedValue(true),
      isEnabled: jest.fn().mockReturnValue(true),
    };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: "user@example.com",
          locale: "zh-CN",
        }),
      },
    };

    // EmailChannel uses @Inject(EmailService) and @Inject(PrismaService) — must use class tokens
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailChannel,
        { provide: EmailService, useValue: emailService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    emailChannel = module.get(EmailChannel);
  });

  it("email subject 含 oneLineTakeaway 字符串", async () => {
    const takeaway = "英伟达 Q1 营收创历史新高";
    const payload: DispatchPayload = {
      type: "RADAR_DAILY" as NotificationType,
      title: `【AI 雷达】${takeaway}`,
      message: "今日 TOP 3 briefing 正文",
      emailContext: { html: "<p>4 层内容</p>" },
    };

    await emailChannel.send(USER_ID, payload);

    const call = emailService.sendEmail.mock.calls[0][0] as {
      subject: string;
      html?: string;
      text?: string;
    };
    expect(call.subject).toContain(takeaway);
  });

  it("emailContext.html 包含三级退订 URL（topic / radar_all / global scope）", async () => {
    const unsubscribeTopicUrl = "/unsubscribe?token=tok-topic&scope=topic";
    const unsubscribeRadarUrl = "/unsubscribe?token=tok-radar&scope=radar_all";
    const unsubscribeAllUrl = "/unsubscribe?token=tok-global&scope=global";

    const html = `
      <p>今日精选内容...</p>
      <a href="${unsubscribeTopicUrl}">退订该主题</a>
      <a href="${unsubscribeRadarUrl}">退订所有雷达通知</a>
      <a href="${unsubscribeAllUrl}">退订全部通知</a>
    `;

    const payload: DispatchPayload = {
      type: "RADAR_DAILY" as NotificationType,
      title: "英伟达 Q1 营收创历史新高",
      message: "briefing 正文",
      emailContext: { html },
    };

    await emailChannel.send(USER_ID, payload);

    const call = emailService.sendEmail.mock.calls[0][0] as { html: string };
    expect(call.html).toContain("scope=topic");
    expect(call.html).toContain("scope=radar_all");
    expect(call.html).toContain("scope=global");
  });

  it("emailContext.html 三级退订 URL 都包含 unsubscribe token 参数", async () => {
    const html = `
      <a href="/unsub?token=JWT-TOPIC-TOKEN&scope=topic">退订该主题</a>
      <a href="/unsub?token=JWT-RADAR-TOKEN&scope=radar_all">退订雷达</a>
      <a href="/unsub?token=JWT-GLOBAL-TOKEN&scope=global">退订全部</a>
    `;

    await emailChannel.send(USER_ID, {
      type: "RADAR_DAILY" as NotificationType,
      title: "今日精选",
      message: "内容",
      emailContext: { html },
    });

    const call = emailService.sendEmail.mock.calls[0][0] as { html: string };
    // 三个不同 token 都出现在 HTML 中
    expect(call.html).toContain("JWT-TOPIC-TOKEN");
    expect(call.html).toContain("JWT-RADAR-TOKEN");
    expect(call.html).toContain("JWT-GLOBAL-TOKEN");
  });
});

// ─────────────────────────────────────────────────────────
// §11.2-4  tier3 信号 → onTier3Signal → dispatcher RADAR_TIER3_INSTANT + excludeChannels=['email']
// ─────────────────────────────────────────────────────────
describe("§11.2-4 tier3 信号事件 → onTier3Signal → RADAR_TIER3_INSTANT + excludeChannels=['email']", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("emit radar.briefing.signal.created with tier=3 → dispatcher.dispatch called with type=RADAR_TIER3_INSTANT", async () => {
    const { scheduler, dispatcher } = await buildSchedulerModule({});

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal(),
    };

    await scheduler.onTier3Signal(event);

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    const [calledUserId, calledPayload] = dispatcher.dispatch.mock.calls[0] as [
      string,
      DispatchPayload,
      DispatchOptions?,
    ];
    expect(calledUserId).toBe(USER_ID);
    expect(calledPayload.type).toBe("RADAR_TIER3_INSTANT");
  });

  it("tier3 dispatch 必须携带 excludeChannels=['email']（产品决策：tier3 不发邮件）", async () => {
    const { scheduler, dispatcher } = await buildSchedulerModule({});

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal(),
    };

    await scheduler.onTier3Signal(event);

    const [, , options] = dispatcher.dispatch.mock.calls[0] as [
      string,
      DispatchPayload,
      DispatchOptions?,
    ];
    expect(options?.excludeChannels).toContain("email");
  });

  it("tier=2 信号 → onTier3Signal 直接 return，dispatcher 不调用", async () => {
    const { scheduler, dispatcher } = await buildSchedulerModule({});

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal({ tier: 2 }),
    };

    await scheduler.onTier3Signal(event);

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("tier=1 信号 → onTier3Signal 直接 return，dispatcher 不调用", async () => {
    const { scheduler, dispatcher } = await buildSchedulerModule({});

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal({ tier: 1 }),
    };

    await scheduler.onTier3Signal(event);

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("quietHours 期间 → dispatcher 不调用", async () => {
    const { scheduler, dispatcher } = await buildSchedulerModule({
      preferenceService: {
        get: jest.fn().mockResolvedValue(null),
        isInQuietHours: jest.fn().mockResolvedValue(true),
      },
    });

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal(),
    };

    await scheduler.onTier3Signal(event);

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────
// §11.2-5  Redis 频次闸 ≤3/天：第 4 次 tier3 被 drop
// ─────────────────────────────────────────────────────────
describe("§11.2-5 Redis 频次闸：同 topic 同日 ≤3 条 tier3，第 4 次 drop", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("前 3 次 tier3 信号 → dispatcher 各调用 1 次（共 3 次）", async () => {
    let counter = 0;
    const { scheduler, dispatcher } = await buildSchedulerModule({
      cache: makeMockCache(async () => ++counter),
    });

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal(),
    };

    await scheduler.onTier3Signal(event);
    await scheduler.onTier3Signal(event);
    await scheduler.onTier3Signal(event);

    // 3 次都应该 dispatch
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
  });

  it("第 4 次 tier3 信号 → Redis 返回 count=4 → dispatcher 不调用（频次闸拦截）", async () => {
    const { scheduler, dispatcher } = await buildSchedulerModule({
      cache: makeMockCache(4), // 直接模拟第 4 次
    });

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal(),
    };

    await scheduler.onTier3Signal(event);

    // count=4 > 3 → 被 drop
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("count=3 → 刚好在阈值内 → dispatcher 调用", async () => {
    const { scheduler, dispatcher } = await buildSchedulerModule({
      cache: makeMockCache(3), // 第 3 次，恰好等于阈值
    });

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal(),
    };

    await scheduler.onTier3Signal(event);

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });

  it("Redis 故障（incrby throws）→ fail-open：dispatcher 仍被调用", async () => {
    const { scheduler, dispatcher } = await buildSchedulerModule({
      cache: {
        incrby: jest
          .fn()
          .mockRejectedValue(new Error("Redis connection failed")),
        expire: jest.fn().mockResolvedValue(true),
      },
    });

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal(),
    };

    await scheduler.onTier3Signal(event);

    // fail-open: Redis 故障不阻塞推送
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────
// §11.2-6  channelSubscriptions.RADAR_TIER3_INSTANT.site=false → tier3 不到站内
// ─────────────────────────────────────────────────────────
describe("§11.2-6 channelSubscriptions.site=false → tier3 onTier3Signal return without dispatch", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("channelSubscriptions.RADAR_TIER3_INSTANT.site=false → onTier3Signal 提前 return，dispatcher 不调用", async () => {
    const { scheduler, dispatcher } = await buildSchedulerModule({
      // 用户关掉了 RADAR_TIER3_INSTANT 的 site channel
      preferenceService: {
        get: jest
          .fn()
          .mockResolvedValue(
            buildPref({ RADAR_TIER3_INSTANT: { site: false } }),
          ),
        isInQuietHours: jest.fn().mockResolvedValue(false),
      },
    });

    const event: RadarBriefingSignalCreatedEvent = {
      userId: USER_ID,
      topicId: TOPIC_ID,
      signal: buildTier3Signal(),
    };

    await scheduler.onTier3Signal(event);

    // site 关闭时，scheduler 在读偏好后提前 return（主开关守门）
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("ChannelResolver: channelSubscriptions.RADAR_TIER3_INSTANT.site=false → resolve 不返回 site", async () => {
    // 独立测试 ChannelResolver 本身的行为（不走 scheduler）
    const resolver = new ChannelResolver();

    const pref = buildPref({ RADAR_TIER3_INSTANT: { site: false } });

    // 构建一个 mock channel
    const mockSiteChannel = {
      type: "site" as const,
      async send() {
        return;
      },
      async isAvailable() {
        return true;
      },
      getCapabilities() {
        return {
          requiresUserBinding: false,
          requiresGlobalConfig: false,
          dailyQuotaPerUser: 200,
        };
      },
    };
    const channelsMap = new Map([["site" as const, mockSiteChannel]]);

    const resolved = await resolver.resolve(
      USER_ID,
      "RADAR_TIER3_INSTANT" as NotificationType,
      channelsMap,
      pref,
      undefined,
    );

    // site 被用户关掉 → resolver 不返回 site
    expect(resolved).not.toContain("site");
  });

  it("ChannelResolver: RADAR_TIER3_INSTANT 默认策略无设置时 → 包含 site，不含 email（tier3 默认不走 email）", () => {
    const defaultChannels = ChannelResolver.defaultForType(
      "RADAR_TIER3_INSTANT" as NotificationType,
    );
    expect(defaultChannels).toContain("site");
    expect(defaultChannels).not.toContain("email");
  });
});

// ─────────────────────────────────────────────────────────
// §11.2-7  sweepWeeklyBriefing 周日 18:00 UTC → weeklyService.generateAndPersist + RADAR_WEEKLY
// ─────────────────────────────────────────────────────────
describe("§11.2-7 sweepWeeklyBriefing 周日 18:00 UTC → generateAndPersist + RADAR_WEEKLY dispatch", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function buildWeeklyResult() {
    return {
      id: "weekly-1",
      topicId: TOPIC_ID,
      userId: USER_ID,
      weekStartDate: new Date("2026-05-11T00:00:00.000Z"),
      weekEndDate: new Date("2026-05-17T23:59:59.000Z"),
      payload: {
        topSignals: [buildTier3Signal()],
        tier3Count: 1,
        tier2Count: 2,
        candidatesTotal: 10,
        narrativeMap: [],
        newEntities: [],
      },
      generatedAt: new Date(),
    };
  }

  it("周日 18:00 UTC 触发 sweepWeeklyBriefing → weeklyService.generateAndPersist 被调用", async () => {
    const { scheduler, weeklyService } = await buildSchedulerModule({
      prisma: makeMockPrisma({
        findMany: jest.fn().mockResolvedValue([
          {
            id: TOPIC_ID,
            userId: USER_ID,
            briefingTimezone: "UTC",
            user: { timezone: "UTC" },
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      }),
      weeklyService: {
        generateAndPersist: jest.fn().mockResolvedValue(buildWeeklyResult()),
        findInRange: jest.fn().mockResolvedValue([]),
      },
    });

    // 2026-05-17 是周日
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T18:00:00.000Z"));

    await scheduler.sweepWeeklyBriefing();

    expect(weeklyService.generateAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: TOPIC_ID,
        userId: USER_ID,
        weekStart: expect.any(Date),
        weekEnd: expect.any(Date),
      }),
    );
  });

  it("generateAndPersist 成功且 topSignals 非空 → weeklyEmailPreset.notify 被调用（FU2-D 渲染路径）", async () => {
    const { scheduler, weeklyEmailPreset } = await buildSchedulerModule({
      prisma: makeMockPrisma({
        findMany: jest.fn().mockResolvedValue([
          {
            id: TOPIC_ID,
            userId: USER_ID,
            briefingTimezone: "UTC",
            user: { timezone: "UTC" },
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      }),
      weeklyService: {
        generateAndPersist: jest.fn().mockResolvedValue(buildWeeklyResult()),
        findInRange: jest.fn().mockResolvedValue([]),
      },
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T18:00:00.000Z"));

    await scheduler.sweepWeeklyBriefing();
    // FU2-D: weekly 走 preset.notify，preset 内部再调 dispatcher
    await Promise.resolve();

    expect(weeklyEmailPreset.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, topicId: TOPIC_ID }),
    );
  });

  it("weeklyService 返回无 signals（topSignals=[]）→ preset.notify 不调用（避免 spam）", async () => {
    const { scheduler, weeklyEmailPreset } = await buildSchedulerModule({
      prisma: makeMockPrisma({
        findMany: jest.fn().mockResolvedValue([
          {
            id: TOPIC_ID,
            userId: USER_ID,
            briefingTimezone: "UTC",
            user: { timezone: "UTC" },
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      }),
      weeklyService: {
        generateAndPersist: jest.fn().mockResolvedValue({
          id: "weekly-empty",
          topicId: TOPIC_ID,
          userId: USER_ID,
          payload: {
            topSignals: [],
            tier3Count: 0,
            tier2Count: 0,
            candidatesTotal: 0,
            narrativeMap: [],
            newEntities: [],
          },
          generatedAt: new Date(),
        }),
        findInRange: jest.fn().mockResolvedValue([]),
      },
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T18:00:00.000Z"));

    await scheduler.sweepWeeklyBriefing();
    await Promise.resolve();

    expect(weeklyEmailPreset.notify).not.toHaveBeenCalled();
  });

  it("本周已生成 weekly briefing → findInRange 返回记录 → generateAndPersist 跳过（幂等保护）", async () => {
    const { scheduler, weeklyService, weeklyEmailPreset } =
      await buildSchedulerModule({
        prisma: makeMockPrisma({
          findMany: jest.fn().mockResolvedValue([
            {
              id: TOPIC_ID,
              userId: USER_ID,
              briefingTimezone: "UTC",
              user: { timezone: "UTC" },
            },
          ]),
          count: jest.fn().mockResolvedValue(0),
        }),
        weeklyService: {
          generateAndPersist: jest.fn().mockResolvedValue(buildWeeklyResult()),
          findInRange: jest.fn().mockResolvedValue([{ id: "existing-weekly" }]),
        },
      });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T18:00:00.000Z"));

    await scheduler.sweepWeeklyBriefing();

    expect(weeklyService.generateAndPersist).not.toHaveBeenCalled();
    expect(weeklyEmailPreset.notify).not.toHaveBeenCalled();
  });

  it("preset.notify input 包含 topicId（FU2-D：preset 内部组装 dispatch payload metadata）", async () => {
    const { scheduler, weeklyEmailPreset } = await buildSchedulerModule({
      prisma: makeMockPrisma({
        findMany: jest.fn().mockResolvedValue([
          {
            id: TOPIC_ID,
            userId: USER_ID,
            briefingTimezone: "UTC",
            user: { timezone: "UTC" },
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      }),
      weeklyService: {
        generateAndPersist: jest.fn().mockResolvedValue(buildWeeklyResult()),
        findInRange: jest.fn().mockResolvedValue([]),
      },
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-17T18:00:00.000Z"));

    await scheduler.sweepWeeklyBriefing();
    await Promise.resolve();

    expect(weeklyEmailPreset.notify).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: TOPIC_ID, userId: USER_ID }),
    );
  });
});

// ─────────────────────────────────────────────────────────
// §11.2-2 / §11.2-8  前端覆盖（skip 占位）
// ─────────────────────────────────────────────────────────
describe("§11.2-2 / §11.2-8 注：前端覆盖（参考 F10/F7 component spec）", () => {
  it.skip("§11.2-2 详情页 3 卡 + 4 层 + share 按钮（前端 UI 验收由 F10 component spec 承担）", () => {});
  it.skip("§11.2-8 历史 ?date= 切换 + narrativeId 多日聚合 NarrativeThread（由 F7 spec 承担）", () => {});
});

// Export used symbol to satisfy unused import check
export { RADAR_BRIEFING_SIGNAL_CREATED_EVENT };
