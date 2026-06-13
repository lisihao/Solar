/**
 * CapabilityProbeService spec — v3.1 §B.6 probe daemon
 *
 * 覆盖矩阵：
 *   - 分布式锁：拿到 → 主流程；拿不到 → 早 return
 *   - feature flag 关 → 早 return（拿锁后立即检查）
 *   - catalog version 缺失 → 初始化到代码版本（不触发 reset）
 *   - catalog version 相等 → 无 reset
 *   - 代码版本 > Redis 版本 → 批量 reset + AuditLog + 更新 Redis
 *   - 代码版本 < Redis 版本 → 仅 warn，不动 Redis
 *   - 异常吞错 + 释放锁
 *   - 被动反向探测打标记
 */

import { Logger } from "@nestjs/common";
import { CapabilityProbeService } from "../capability-probe.service";

// mock catalog version
jest.mock("../model-capability-catalog", () => ({
  CATALOG_VERSION: 2, // 测试用 2，模拟"代码已升 1 版"
}));

describe("CapabilityProbeService — v3.1 §B.6", () => {
  // 用 store 模拟 stateful cache（lock 拿锁后 release 时需读到自己写入的 instanceId）
  let store: Map<string, unknown>;
  let cache: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let prisma: {
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    capabilityOverrideAuditLog: { findMany: jest.Mock };
    userModelConfig: { findMany: jest.Mock };
  };
  let flags: { isProbeEnabled: jest.Mock };
  let svc: CapabilityProbeService;
  // probe 的 lock 走 in-memory fallback（无 cacheManager 注入）

  beforeEach(() => {
    store = new Map();
    cache = {
      get: jest.fn(async (key: string) => store.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    };
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
        const tx = {
          userModelConfig: { update: jest.fn().mockResolvedValue({}) },
          capabilityOverrideAuditLog: {
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return cb(tx);
      }),
      capabilityOverrideAuditLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      userModelConfig: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    flags = { isProbeEnabled: jest.fn().mockResolvedValue(true) };

    svc = new CapabilityProbeService(
      cache as never,
      prisma as never,
      flags as never,
    );
  });

  // ─────────── lock 行为 ───────────

  it("acquires lock then releases at end", async () => {
    // in-memory fallback：cache.get 返 undefined 表示无人持锁 → 可以拿
    await svc.runPeriodicProbe();
    expect(cache.set).toHaveBeenCalledWith(
      "capability:probe:lock",
      expect.any(String),
      expect.any(Number),
    );
    expect(cache.del).toHaveBeenCalledWith("capability:probe:lock");
  });

  it("skips when lock already held by another pod (in-memory)", async () => {
    // 预先在 store 写入"别人持有的锁"
    store.set("capability:probe:lock", "other-pod-uuid");
    await svc.runPeriodicProbe();
    // 没拿到锁 → 应该没调 flag / catalog version 检测
    expect(flags.isProbeEnabled).not.toHaveBeenCalled();
    // 别人的锁不应被误删
    expect(store.get("capability:probe:lock")).toBe("other-pod-uuid");
  });

  // ─────────── feature flag 关 ───────────

  it("skips main flow when feature flag disabled (lock acquired and released)", async () => {
    flags.isProbeEnabled.mockResolvedValue(false);
    await svc.runPeriodicProbe();
    expect(flags.isProbeEnabled).toHaveBeenCalled();
    // catalog version 检测 / passive markers 不应跑
    expect(cache.set).toHaveBeenCalledWith(
      "capability:probe:lock",
      expect.any(String),
      expect.any(Number),
    );
    // 锁被释放
    expect(cache.del).toHaveBeenCalledWith("capability:probe:lock");
  });

  // ─────────── catalog version 检测 ───────────

  it("initializes Redis catalog version when missing (no reset)", async () => {
    // VERSION_KEY 未预置 → 初始化
    await svc.runPeriodicProbe();
    // 找 capability:catalog:version 的 set 调用
    const versionSetCalls = cache.set.mock.calls.filter(
      (c: unknown[]) => c[0] === "capability:catalog:version",
    );
    expect(versionSetCalls).toHaveLength(1);
    expect(versionSetCalls[0][1]).toBe(2); // 代码版本
    // 没触发批量 reset（$queryRaw 不应被调）
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("does nothing when code version equals Redis version", async () => {
    store.set("capability:catalog:version", 2);
    cache.set.mockClear();
    await svc.runPeriodicProbe();
    const versionSetCalls = cache.set.mock.calls.filter(
      (c: unknown[]) => c[0] === "capability:catalog:version",
    );
    // 不应更新 Redis 版本
    expect(versionSetCalls).toHaveLength(0);
    // 不触发批量 reset
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("triggers batch reset when code version > Redis version", async () => {
    store.set("capability:catalog:version", 1);
    // 模拟 2 行命中 __meta.autoDowngraded=true
    prisma.$queryRaw.mockResolvedValue([
      { id: "config-1", userId: "user-1", capability_overrides: { foo: 1 } },
      { id: "config-2", userId: "user-2", capability_overrides: { foo: 2 } },
    ]);
    cache.set.mockClear();
    await svc.runPeriodicProbe();
    // 触发 $transaction
    expect(prisma.$transaction).toHaveBeenCalled();
    // 更新 Redis 到代码版本
    const versionSetCalls = cache.set.mock.calls.filter(
      (c: unknown[]) => c[0] === "capability:catalog:version",
    );
    expect(versionSetCalls).toHaveLength(1);
    expect(versionSetCalls[0][1]).toBe(2);
  });

  it("does not update Redis when code version < Redis version (rollback)", async () => {
    store.set("capability:catalog:version", 5);
    cache.set.mockClear();
    await svc.runPeriodicProbe();
    const versionSetCalls = cache.set.mock.calls.filter(
      (c: unknown[]) => c[0] === "capability:catalog:version",
    );
    expect(versionSetCalls).toHaveLength(0);
  });

  // ─────────── 异常吞错 ───────────

  it("swallows exception and still releases lock", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("DB outage"));
    store.set("capability:catalog:version", 1); // 触发 reset 路径
    await expect(svc.runPeriodicProbe()).resolves.toBeUndefined();
    // 锁被释放
    expect(cache.del).toHaveBeenCalledWith("capability:probe:lock");
  });

  // ─────────── 被动反向探测打标记 ───────────

  it("marks passive retry flags for self-heal entries older than 24h", async () => {
    prisma.capabilityOverrideAuditLog.findMany.mockResolvedValue([
      { scopeKey: "user:u1:user_model_config:c1", field: "<root>" },
      { scopeKey: "user:u2:user_model_config:c2", field: "<root>" },
    ]);
    store.set("capability:catalog:version", 2); // 不触发 catalog reset
    cache.set.mockClear();
    await svc.runPeriodicProbe();
    // 应该写入 2 个 retry flag
    const retryFlagCalls = cache.set.mock.calls.filter((c: unknown[]) =>
      String(c[0]).startsWith("capability:probe:retry:"),
    );
    expect(retryFlagCalls).toHaveLength(2);
  });

  // ─────────── F8(b) catalog staleness 检测 ───────────

  it("warns when ≥2 distinct BYOK configs auto-downgrade the same model's nativeMode", async () => {
    store.set("capability:catalog:version", 2); // 不触发 catalog reset
    // detectCatalogStaleness 专属查询（field=structuredOutput.nativeMode）返 4 条；
    // markPassiveRetries 的查询（无该 field）返 []。
    prisma.capabilityOverrideAuditLog.findMany.mockImplementation(
      async (args: { where?: { field?: string } }) => {
        if (args?.where?.field === "structuredOutput.nativeMode") {
          return [
            { userModelConfigId: "c1" },
            { userModelConfigId: "c2" },
            { userModelConfigId: "c3" },
            { userModelConfigId: "c4" },
          ];
        }
        return [];
      },
    );
    prisma.userModelConfig.findMany.mockResolvedValue([
      { id: "c1", provider: "anthropic", modelId: "claude-x" },
      { id: "c2", provider: "anthropic", modelId: "claude-x" },
      { id: "c3", provider: "anthropic", modelId: "claude-x" },
      { id: "c4", provider: "openai", modelId: "gpt-x" }, // 仅 1 个 → 不报
    ]);
    const warnSpy = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);

    await svc.runPeriodicProbe();

    const staleWarn = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes("catalog-staleness"),
    );
    expect(staleWarn).toBeDefined();
    expect(String(staleWarn?.[0])).toContain("claude-x");
    expect(String(staleWarn?.[0])).toContain("3 distinct");
    // gpt-x 只有 1 个 config（< 阈值 2）→ 不应单独报 staleness
    const gptStale = warnSpy.mock.calls.find(
      (c) =>
        String(c[0]).includes("catalog-staleness") &&
        String(c[0]).includes("gpt-x"),
    );
    expect(gptStale).toBeUndefined();

    warnSpy.mockRestore();
  });

  it("does not warn staleness when distinct configs below threshold", async () => {
    store.set("capability:catalog:version", 2);
    prisma.capabilityOverrideAuditLog.findMany.mockImplementation(
      async (args: { where?: { field?: string } }) => {
        if (args?.where?.field === "structuredOutput.nativeMode") {
          return [{ userModelConfigId: "c1" }];
        }
        return [];
      },
    );
    prisma.userModelConfig.findMany.mockResolvedValue([
      { id: "c1", provider: "anthropic", modelId: "claude-x" },
    ]);
    const warnSpy = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);

    await svc.runPeriodicProbe();

    const staleWarn = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes("catalog-staleness"),
    );
    expect(staleWarn).toBeUndefined();
    warnSpy.mockRestore();
  });
});
