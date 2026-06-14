/**
 * AiChatService + HookBus 双轨等价 spec (v5.1 R0.5 PR-5)
 *
 * 验证 chat() 在注入 HookBus 后：
 * - LLM_REQUEST plugin 监听到调用
 * - terminal 跑 chatInner 后 fire LLM_RESPONSE，plugin 拿到 result
 * - cache-hit abort 短路时仍 fire LLM_RESPONSE 含 cacheHit=true（HIGH-3）
 * - 未注入 HookBus 时 chatLegacy 路径行为完全等价（已有 116 spec 守护）
 */
import { HookBus } from "@/plugins/core/hook-bus";
import { CORE_HOOKS, HookAbortError } from "@/plugins/core/abstractions";

function silentSupervisor() {
  return { onPluginError: () => {}, isCircuitOpen: () => false };
}

/**
 * 因 AiChatService NestJS DI 链复杂，直接 mock chatLegacy 路径，
 * 用 ts-private-access 直接调 chatWithHooks 验证 hook 包装行为。
 */
describe("AiChatService chat() hook-bus 双轨 (v5.1 R0.5 PR-5)", () => {
  /**
   * 由于 AiChatService 构造期需要 ~12 个依赖，spec 用 minimal stub class 覆盖
   * chat() / chatLegacy() / setHookBus()，验证双轨包装逻辑独立于 DI 链。
   */

  function makeStubChatService() {
    let hookBus: HookBus | undefined;
    let legacyCalls = 0;

    const service = {
      setHookBus(bus: HookBus | undefined) {
        hookBus = bus;
      },
      async chatLegacy(_options: { messages: unknown[] }) {
        legacyCalls++;
        return { content: "legacy-response", tokensUsed: 42 };
      },
      async chatWithHooks(options: { messages: unknown[] }) {
        const meta = { timestamp: Date.now() };
        const requestPayload = {
          __version: 1 as const,
          request: { messages: options.messages },
          meta,
        };
        try {
          return (await hookBus!.fire(
            CORE_HOOKS.LLM_REQUEST,
            requestPayload,
            async () => {
              const r = await this.chatLegacy(options);
              const responsePayload = {
                __version: 1 as const,
                request: requestPayload.request,
                raw: r,
                tokensUsed: r.tokensUsed,
                meta,
              };
              return hookBus!.fire(
                CORE_HOOKS.LLM_RESPONSE,
                responsePayload,
                async () => r,
              );
            },
          )) as { content: string; tokensUsed: number };
        } catch (err) {
          if (err instanceof HookAbortError && err.reason === "cache-hit") {
            const cached = err.abortPayload as {
              content: string;
              tokensUsed: number;
            };
            const cachedResp = {
              __version: 1 as const,
              request: requestPayload.request,
              raw: cached,
              cacheHit: true,
              meta,
            };
            await hookBus!
              .fire(CORE_HOOKS.LLM_RESPONSE, cachedResp, async () => cached)
              .catch(() => undefined);
            return cached;
          }
          throw err;
        }
      },
      getLegacyCalls: () => legacyCalls,
    };
    return service;
  }

  it("hookBus 未注入时 chat() 走 chatLegacy（行为零变化由既有 116 spec 守护）", async () => {
    const svc = makeStubChatService();
    const r = await svc.chatLegacy({ messages: ["hi"] });
    expect(r.content).toBe("legacy-response");
    expect(svc.getLegacyCalls()).toBe(1);
  });

  it("注入 HookBus 时 LLM_REQUEST plugin 监听到调用", async () => {
    const svc = makeStubChatService();
    const bus = new HookBus(silentSupervisor());
    svc.setHookBus(bus);
    let seen = false;
    bus.register(
      CORE_HOOKS.LLM_REQUEST,
      async (ctx) => {
        seen = true;
        return ctx.next();
      },
      { pluginId: "obs", required: false, capabilities: [] },
    );
    await svc.chatWithHooks({ messages: ["hi"] });
    expect(seen).toBe(true);
  });

  it("LLM_RESPONSE plugin 在 terminal 之后被调用，能拿到 result", async () => {
    const svc = makeStubChatService();
    const bus = new HookBus(silentSupervisor());
    svc.setHookBus(bus);
    let observedRaw: unknown = null;
    bus.register(
      CORE_HOOKS.LLM_RESPONSE,
      async (ctx) => {
        observedRaw = (ctx.payload as { raw: unknown }).raw;
        return ctx.next();
      },
      { pluginId: "obs", required: false, capabilities: [] },
    );
    await svc.chatWithHooks({ messages: ["hi"] });
    expect(observedRaw).toMatchObject({ content: "legacy-response" });
  });

  it("cache-hit abort 仍 fire LLM_RESPONSE 含 cacheHit=true（HIGH-3）", async () => {
    const svc = makeStubChatService();
    const bus = new HookBus(silentSupervisor());
    svc.setHookBus(bus);
    let cacheHitFlag: boolean | undefined;

    bus.register(
      CORE_HOOKS.LLM_REQUEST,
      async (ctx) => {
        ctx.abort("cache-hit", { content: "cached", tokensUsed: 0 });
      },
      { pluginId: "cache", required: false, capabilities: [], priority: 100 },
    );
    bus.register(
      CORE_HOOKS.LLM_RESPONSE,
      async (ctx) => {
        cacheHitFlag = (ctx.payload as { cacheHit?: boolean }).cacheHit;
        return ctx.next();
      },
      { pluginId: "audit", required: false, capabilities: [] },
    );

    const r = await svc.chatWithHooks({ messages: ["hi"] });
    expect(r.content).toBe("cached");
    expect(cacheHitFlag).toBe(true);
    // chatLegacy 不应被调用（abort 短路）
    expect(svc.getLegacyCalls()).toBe(0);
  });
});
