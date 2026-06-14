/**
 * CapabilityFeatureFlagsService spec — v3.1 §B.7 feature flag 体系
 *
 * 覆盖优先级链：Redis → env → 默认 true
 *   - Redis 'true'/'1' → 开
 *   - Redis 'false'/'0' → 关
 *   - Redis 不命中 + env 命中 → env 决定
 *   - Redis 不命中 + env 不命中 → 默认 true
 *   - Redis 异常 → fallback env / 默认（不抛错）
 *   - 三个 flag 名独立解析
 */

import { CapabilityFeatureFlagsService } from "../capability-feature-flags.service";

describe("CapabilityFeatureFlagsService — v3.1 §B.7", () => {
  let cache: { get: jest.Mock };
  let svc: CapabilityFeatureFlagsService;
  const envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    cache = { get: jest.fn().mockResolvedValue(undefined) };
    svc = new CapabilityFeatureFlagsService(cache as never);
    // 保存原 env
    envSnapshot.ENABLE_CAPABILITY_SELF_HEAL =
      process.env.ENABLE_CAPABILITY_SELF_HEAL;
    envSnapshot.ENABLE_CAPABILITY_PROBE = process.env.ENABLE_CAPABILITY_PROBE;
    envSnapshot.ENABLE_CAPABILITY_OVERRIDES_WRITE =
      process.env.ENABLE_CAPABILITY_OVERRIDES_WRITE;
    delete process.env.ENABLE_CAPABILITY_SELF_HEAL;
    delete process.env.ENABLE_CAPABILITY_PROBE;
    delete process.env.ENABLE_CAPABILITY_OVERRIDES_WRITE;
  });

  afterEach(() => {
    for (const k of Object.keys(envSnapshot)) {
      if (envSnapshot[k] === undefined) delete process.env[k];
      else process.env[k] = envSnapshot[k];
    }
  });

  // ─────────── Redis 优先级 ───────────

  it("uses Redis 'true' to enable (overrides env)", async () => {
    cache.get.mockResolvedValue("true");
    process.env.ENABLE_CAPABILITY_SELF_HEAL = "false"; // env 想关
    expect(await svc.isSelfHealEnabled()).toBe(true); // Redis 赢
  });

  it("uses Redis 'false'/'0' to disable", async () => {
    cache.get.mockResolvedValue("false");
    expect(await svc.isSelfHealEnabled()).toBe(false);
    cache.get.mockResolvedValue("0");
    expect(await svc.isSelfHealEnabled()).toBe(false);
  });

  // ─────────── env fallback ───────────

  it("falls back to env when Redis empty", async () => {
    cache.get.mockResolvedValue(undefined);
    process.env.ENABLE_CAPABILITY_PROBE = "false";
    expect(await svc.isProbeEnabled()).toBe(false);
  });

  it("falls back to default true when both Redis and env empty", async () => {
    cache.get.mockResolvedValue(undefined);
    expect(await svc.isSelfHealEnabled()).toBe(true);
    expect(await svc.isProbeEnabled()).toBe(true);
    expect(await svc.isOverridesWriteEnabled()).toBe(true);
  });

  // ─────────── Redis 异常 fail-open ───────────

  it("fails open to env when Redis throws", async () => {
    cache.get.mockRejectedValue(new Error("redis connection refused"));
    process.env.ENABLE_CAPABILITY_OVERRIDES_WRITE = "false";
    expect(await svc.isOverridesWriteEnabled()).toBe(false); // env 接力
  });

  // ─────────── 各 flag 独立 ───────────

  it("each flag resolved independently (queries distinct Redis keys)", async () => {
    cache.get.mockImplementation((key: string) => {
      if (key.endsWith("ENABLE_CAPABILITY_SELF_HEAL")) return "false";
      if (key.endsWith("ENABLE_CAPABILITY_PROBE")) return "true";
      return undefined;
    });
    expect(await svc.isSelfHealEnabled()).toBe(false);
    expect(await svc.isProbeEnabled()).toBe(true);
    // overrides-write 无 Redis 值 + 无 env → 默认 true
    expect(await svc.isOverridesWriteEnabled()).toBe(true);
  });

  // ─────────── 无 cache（@Optional 缺失）───────────

  it("works without cache service (Optional injection)", async () => {
    const noCache = new CapabilityFeatureFlagsService();
    process.env.ENABLE_CAPABILITY_PROBE = "false";
    expect(await noCache.isProbeEnabled()).toBe(false);
    delete process.env.ENABLE_CAPABILITY_PROBE;
    expect(await noCache.isProbeEnabled()).toBe(true); // 默认
  });
});
