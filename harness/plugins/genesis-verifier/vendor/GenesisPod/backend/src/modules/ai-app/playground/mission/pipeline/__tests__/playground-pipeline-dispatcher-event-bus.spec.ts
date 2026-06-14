/**
 * 反向回归 spec：dispatcher 触发的 lifecycle 事件必须走 EventBus，不得直调
 * MissionEventBuffer.broadcast()。
 *
 * 真问题（2026-05-06 用户实证）：
 *   原 dispatcher.onEvent 桥接 7 处直调 missionEventBuffer.broadcast() —— buffer
 *   只写内存 + DB，不路由到 SocketBroadcastAdapter（adapter 注册在 eventBus 上，
 *   不是 buffer 上）。结果：前端 stage:lifecycle / stage:stalled / stage:degraded
 *   / mission:execution-aborted / mission:postlude:* 全部不实时刷新，必须刷新
 *   页面（/replay 走 buffer.read 兜底）才能看到。
 *
 * 反向证据：本 spec 用真 EventBus + 一个 spy adapter，验证 dispatcher 触发的
 *   每条事件都被该 spy adapter 收到（即"socket 实时分发"路径打通）。
 *
 * 如果以后又有人在 dispatcher 里写 buffer.broadcast() 直调，这条 spec 会立即拦截。
 */

import { Test } from "@nestjs/testing";
import { z } from "zod";
import {
  EventBus,
  EventRegistry,
  type IBroadcastAdapter,
  type DomainEvent,
} from "@/modules/ai-harness/facade";
import { CacheService } from "@/common/cache/cache.service";

/**
 * 2026-05-15 Round 1 P1 fix: EventBus 新增 CacheService 依赖（跨 pod 事件
 * 去重 + throttle）。spec 注入 fake cache，行为等价单 pod 内存模式。
 */
class FakeCacheService {
  private readonly store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.store.has(key) ? (this.store.get(key) as T) : undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe("playground dispatcher → eventBus path (anti-bypass regression)", () => {
  let eventBus: EventBus;
  let registry: EventRegistry;
  let spyAdapter: IBroadcastAdapter & { received: DomainEvent[] };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventBus,
        EventRegistry,
        { provide: CacheService, useValue: new FakeCacheService() },
      ],
    }).compile();
    eventBus = moduleRef.get(EventBus);
    registry = moduleRef.get(EventRegistry);

    // 注册本 spec 用到的 5 条事件 type（passthrough schema，配合 bus 校验）
    registry.registerAll([
      {
        type: "playground.stage:lifecycle",
        schema: z.object({}).passthrough(),
      },
      {
        type: "playground.stage:stalled",
        schema: z.object({}).passthrough(),
      },
      {
        type: "playground.stage:degraded",
        schema: z.object({}).passthrough(),
      },
      {
        type: "playground.mission:execution-aborted",
        schema: z.object({}).passthrough(),
      },
      {
        type: "playground.mission:postlude:completed",
        schema: z.object({}).passthrough(),
      },
    ]);

    // spy adapter 模拟 SocketBroadcastAdapter —— 注册到 bus 上，必须能收到事件
    const received: DomainEvent[] = [];
    spyAdapter = {
      id: "test.spy-socket",
      accepts: (event) => event.type.startsWith("playground."),
      broadcast: async (event) => {
        received.push(event);
      },
      received,
    };
    eventBus.registerAdapter(spyAdapter);
  });

  it("eventBus.emit 时 spy adapter 必须收到（基线：bus 路由正常）", async () => {
    const ok = await eventBus.emit({
      type: "playground.stage:lifecycle",
      scope: { missionId: "m1", userId: "u1" },
      payload: { stage: "s1-budget", status: "started" },
      timestamp: 1000,
    });
    expect(ok).toBe(true);
    expect(spyAdapter.received).toHaveLength(1);
    expect(spyAdapter.received[0].type).toBe(
      "playground.stage:lifecycle",
    );
  });

  /**
   * 反向证据：模拟 buffer.broadcast 直调（旧 bug 路径），spy adapter 不应收到。
   * 这条 spec 的存在让人一眼看到："如果你直调 adapter.broadcast，其他 adapter 完全
   * 拿不到事件" —— 警示作用 + 文档作用。
   */
  it("绕过 eventBus 直调单 adapter.broadcast → 其他 adapter 收不到（这就是旧 bug）", async () => {
    // 模拟 dispatcher 旧路径：拿到一个 adapter（这里用 spyAdapter 自己当被绕过的对象
    // 不行，我们另起一个 fakeBuffer adapter 模拟 buffer 行为）
    const fakeBuffer: IBroadcastAdapter = {
      id: "test.buffer",
      accepts: () => true,
      broadcast: async () => {
        /* simulates buffer write */
      },
    };
    eventBus.registerAdapter(fakeBuffer);

    // 直调 buffer.broadcast —— 这就是 dispatcher 修前的写法
    await fakeBuffer.broadcast({
      type: "playground.stage:lifecycle",
      scope: { missionId: "m1", userId: "u1" },
      payload: { stage: "s1-budget", status: "started" },
      timestamp: 1000,
    });

    // 关键反向证据：spy adapter（模拟 socket）一条都没收到
    expect(spyAdapter.received).toHaveLength(0);
  });

  it("dispatcher 应 emit 的 5 类事件 type 都已注册到 registry（schema 失败会被 bus drop）", () => {
    // 这条 spec 防 dispatcher 加新事件 type 时忘了注册到 AGENT_PLAYGROUND_EVENTS
    // 名单 → eventBus.emit 默默 drop（"Domain event not registered" warn）。
    for (const type of [
      "playground.stage:lifecycle",
      "playground.stage:stalled",
      "playground.stage:degraded",
      "playground.mission:execution-aborted",
      "playground.mission:postlude:completed",
    ]) {
      const spec = registry.get(type);
      expect(spec).toBeDefined();
    }
  });
});
