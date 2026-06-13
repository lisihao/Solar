/**
 * RateLimitService spec（v5.1 R0.5-E rate-limit 回归 ai-engine 核心 service）
 */
import { RateLimitService } from "../rate-limit.service";
import {
  InMemoryTokenBucketStore,
  RedisTokenBucketStore,
} from "@/modules/platform/resilience";
import type { CacheService } from "@/common/cache/cache.service";

// 内存仿 CacheService（深拷贝模拟 Redis 序列化边界）
class FakeCacheService {
  private readonly store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.store.get(key);
    return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }
}

describe("RateLimitService (v5.1 R0.5-E core service)", () => {
  let svc: RateLimitService;
  let store: InMemoryTokenBucketStore;

  beforeEach(() => {
    svc = new RateLimitService();
    store = new InMemoryTokenBucketStore();
    svc.setStore(store);
  });

  it("default RPM：quota 内透传 allowed=true", async () => {
    svc.configure({ globalRpm: 60 });
    const r = await svc.checkAndConsume("tool", {});
    expect(r.allowed).toBe(true);
  });

  it("global quota 耗尽 → allowed=false + scope=global", async () => {
    svc.configure({ globalRpm: 60 });
    store.setForTest("global:tool", 0);
    const r = await svc.checkAndConsume("tool", {});
    expect(r.allowed).toBe(false);
    expect(r.scope).toBe("global");
    expect(r.retryAfterMs).toBe(1000);
  });

  it("per-tenant：tenantA 耗尽不影响 tenantB", async () => {
    svc.configure({ globalRpm: 1000, perTenantRpm: 60 });
    store.setForTest("tenant:tenantA:tool", 0);

    const a = await svc.checkAndConsume("tool", { tenantId: "tenantA" });
    const b = await svc.checkAndConsume("tool", { tenantId: "tenantB" });
    expect(a.allowed).toBe(false);
    expect(a.scope).toBe("tenant");
    expect(a.tenantId).toBe("tenantA");
    expect(b.allowed).toBe(true);
  });

  it("per-agentType：业务无关标签限流", async () => {
    svc.configure({
      globalRpm: 1000,
      perAgentTypeRpm: { "research-style": 30 },
    });
    store.setForTest("agentType:research-style:tool", 0);

    const r = await svc.checkAndConsume("tool", {
      agentType: "research-style",
    });
    expect(r.allowed).toBe(false);
    expect(r.scope).toBe("agentType");
    expect(r.agentType).toBe("research-style");
  });

  it("defaultAgentTypeRpm：未列出的 agentType 走默认", async () => {
    svc.configure({
      globalRpm: 1000,
      defaultAgentTypeRpm: 30,
    });
    store.setForTest("agentType:other:tool", 0);

    const r = await svc.checkAndConsume("tool", { agentType: "other" });
    expect(r.allowed).toBe(false);
    expect(r.scope).toBe("agentType");
  });

  it("store 故障 → fail-open（不阻塞主流程）", async () => {
    const broken = {
      tryConsume: async () => {
        throw new Error("redis down");
      },
    };
    svc.setStore(broken);
    svc.configure({ globalRpm: 60 });
    const r = await svc.checkAndConsume("tool", {});
    expect(r.allowed).toBe(true);
  });

  it("M6: global 默认关闭 — 未 configure globalRpm 时不消耗 global 桶（防噪声邻居）", async () => {
    // 不调 configure（global 保持 undefined=off）；即便把 global 桶设为 0 也应放行
    store.setForTest("global:tool", 0);
    const r = await svc.checkAndConsume("tool", {});
    expect(r.allowed).toBe(true);
    expect(r.scope).toBeUndefined();
  });

  it("M6: retryAfterMs 按 RPM 折算（不再硬编 1000ms）", async () => {
    svc.configure({ perTenantRpm: 120 }); // 120/min → 补 1 token = 500ms
    store.setForTest("tenant:t1:tool", 0);
    const r = await svc.checkAndConsume("tool", { tenantId: "t1" });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(500);
  });

  it("H1: RedisTokenBucketStore 跨 service 实例共享 quota（多 pod 一致）", async () => {
    const shared = new FakeCacheService() as unknown as CacheService;
    const pod1 = new RateLimitService();
    const pod2 = new RateLimitService();
    pod1.setStore(new RedisTokenBucketStore(shared));
    pod2.setStore(new RedisTokenBucketStore(shared));
    pod1.configure({ perTenantRpm: 2 });
    pod2.configure({ perTenantRpm: 2 });

    // capacity=2：pod1 消 1 + pod2 消 1 → 第 3 次（pod1）应被共享状态拒绝
    expect((await pod1.checkAndConsume("llm", { tenantId: "u" })).allowed).toBe(
      true,
    );
    expect((await pod2.checkAndConsume("llm", { tenantId: "u" })).allowed).toBe(
      true,
    );
    expect((await pod1.checkAndConsume("llm", { tenantId: "u" })).allowed).toBe(
      false,
    );
  });

  it("严禁在 manifest/console output 出现 ai-app 名（业务无关）", () => {
    const j = JSON.stringify(svc);
    expect(j).not.toMatch(/playground|research|writing|topic-insights|office/i);
  });
});
