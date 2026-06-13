import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { UserEventListener } from "../user-event.listener";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  MODULE,
  ACTION,
  resolveAction,
  type UserEventPayload,
} from "../user-event.types";

function makeEvent(over: Partial<UserEventPayload> = {}): UserEventPayload {
  return {
    userId: "u1",
    module: MODULE.AI_RESEARCH,
    action: ACTION.COMPLETED,
    resourceId: "r1",
    success: true,
    ...over,
  };
}

describe("UserEventListener", () => {
  let listener: UserEventListener;
  let createMany: jest.Mock;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    createMany = jest.fn().mockResolvedValue({ count: 0 });
    const prismaMock = {
      userEvent: { createMany },
    } as unknown as PrismaService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserEventListener,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    listener = module.get(UserEventListener);
    listener.onModuleInit();
  });

  afterEach(async () => {
    await listener.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("buffers events then flushes to DB on interval", async () => {
    listener.handle(makeEvent());
    listener.handle(makeEvent({ userId: "u2" }));
    expect(listener.getPendingCount()).toBe(2);
    expect(createMany).not.toHaveBeenCalled();

    await listener.flush();

    expect(createMany).toHaveBeenCalledTimes(1);
    const arg = createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(2);
    // 不使用 skipDuplicates（随机 uuid 主键上 no-op）
    expect(arg.skipDuplicates).toBeUndefined();
    expect(listener.getPendingCount()).toBe(0);
  });

  it("maps payload fields, defaulting optional fields to null", async () => {
    listener.handle(
      makeEvent({
        resourceType: "report",
        topicKey: "ai",
        success: undefined,
        resourceId: undefined,
      }),
    );
    await listener.flush();

    const row = createMany.mock.calls[0][0].data[0];
    expect(row.resourceType).toBe("report");
    expect(row.topicKey).toBe("ai");
    expect(row.resourceId).toBeNull();
    expect(row.success).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("auto-flushes when buffer reaches batch size (500)", async () => {
    for (let i = 0; i < 500; i++) {
      listener.handle(makeEvent({ userId: `u${i}` }));
    }
    // 达 500 触发的是异步 flush
    await Promise.resolve();
    await jest.runOnlyPendingTimersAsync?.();

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0].data).toHaveLength(500);
  });

  it("drops oldest when buffer exceeds 5000 cap (backpressure #1)", () => {
    // 不触发 flush 的情况下灌满：用一个永不 resolve 的 createMany 让 flush 占住 flushing 锁会干扰，
    // 这里直接灌 5001 条但每次 push 后立即清掉自动 flush 影响——改为让 createMany 挂起。
    createMany.mockReturnValue(new Promise(() => undefined)); // never resolves

    const warnSpy = Logger.prototype.warn as unknown as jest.Mock;
    for (let i = 0; i < 5600; i++) {
      listener.handle(makeEvent({ userId: `u${i}` }));
    }
    // 第一次达 500 触发 flush 取走 500（挂起 in-flight，splice 已移出 buffer）。
    // 之后 handle 仍持续，buffer 永不超过 MAX_BUFFER_SIZE(5000)。
    expect(listener.getPendingCount()).toBeLessThanOrEqual(5000);
    // 直接断言丢弃逻辑真触发（不只看 buffer 上限）：超限时按计数 warn "buffer full"。
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("buffer full")),
    ).toBe(true);
  });

  it("re-queues batch within retry limit, drops after exceeding (backpressure #2)", async () => {
    createMany.mockRejectedValue(new Error("db down"));

    listener.handle(makeEvent());
    listener.handle(makeEvent({ userId: "u2" }));

    // 重试上限 3 次内：失败后 unshift 回缓冲，count 保持。
    await listener.flush();
    expect(listener.getPendingCount()).toBe(2);
    await listener.flush();
    expect(listener.getPendingCount()).toBe(2);
    await listener.flush();
    expect(listener.getPendingCount()).toBe(2);

    // 第 4 次超过上限：丢弃当前批，不无限增长。
    await listener.flush();
    expect(listener.getPendingCount()).toBe(0);
  });

  it("flushes remaining buffer on module destroy", async () => {
    listener.handle(makeEvent());
    await listener.onModuleDestroy();
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(listener.getPendingCount()).toBe(0);
  });

  it("flush failure only warns, never throws", async () => {
    createMany.mockRejectedValue(new Error("boom"));
    listener.handle(makeEvent());
    await expect(listener.flush()).resolves.toBe(0);
  });
});

// W2 全模块埋点依赖这张映射表，一个 typo 会在 W2 静默丢事件 → 漏斗/北极星数据缺口。
// 纯函数，单独测，不走 listener 的 fake timers。
describe("resolveAction (status→action 映射表)", () => {
  it("标准三态模块映射正确", () => {
    expect(resolveAction(MODULE.AI_RESEARCH, "EXECUTING")).toBe(ACTION.STARTED);
    expect(resolveAction(MODULE.AI_RESEARCH, "COMPLETED")).toBe(
      ACTION.COMPLETED,
    );
    expect(resolveAction(MODULE.AI_RESEARCH, "FAILED")).toBe(ACTION.FAILED);
    expect(resolveAction(MODULE.AI_TEAMS, "IN_PROGRESS")).toBe(ACTION.STARTED);
    expect(resolveAction(MODULE.AI_WRITING, "IN_PROGRESS")).toBe(
      ACTION.STARTED,
    );
    expect(resolveAction(MODULE.TOPIC_INSIGHTS, "EXECUTING")).toBe(
      ACTION.STARTED,
    );
  });

  it("例外模块映射正确", () => {
    expect(resolveAction(MODULE.AI_OFFICE, "GENERATING")).toBe(ACTION.STARTED);
    expect(resolveAction(MODULE.AI_OFFICE, "COMPLETED")).toBe(ACTION.COMPLETED);
    // office 无 FAILED 状态 → 失败率不适用
    expect(resolveAction(MODULE.AI_OFFICE, "FAILED")).toBeUndefined();
    expect(resolveAction(MODULE.AI_IMAGE, "CREATED")).toBe(ACTION.COMPLETED);
    expect(resolveAction(MODULE.AI_ASK, "MESSAGE_CREATED")).toBe(
      ACTION.STARTED,
    );
    expect(resolveAction(MODULE.AI_SOCIAL, "PUBLISHED")).toBe(ACTION.PUBLISHED);
    expect(resolveAction(MODULE.AI_SOCIAL, "FAILED")).toBe(ACTION.FAILED);
    expect(resolveAction(MODULE.LIBRARY, "CREATED")).toBe(ACTION.SAVED);
  });

  it("大小写归一（explore ActivityType 是大写枚举）", () => {
    expect(resolveAction(MODULE.EXPLORE, "VIEW")).toBe(ACTION.VIEWED);
    expect(resolveAction(MODULE.EXPLORE, "view")).toBe(ACTION.VIEWED);
    expect(resolveAction(MODULE.EXPLORE, "SHARE")).toBe(ACTION.SHARED);
  });

  it("未知 status 返回 undefined（调用方据此跳过 emit，防分母虚高）", () => {
    // 防 PENDING「已创建未跑」被当 started
    expect(resolveAction(MODULE.AI_RESEARCH, "PLANNING")).toBeUndefined();
    expect(resolveAction(MODULE.AI_TEAMS, "PENDING")).toBeUndefined();
    expect(resolveAction(MODULE.AI_RESEARCH, "BOGUS")).toBeUndefined();
  });
});
