/**
 * PluginCoreModule integration spec (v5.1 R0.5 PR-11)
 *
 * 验证 NestJS Test bed 能装配 plugin-core 全部 provider。
 */
import { Test } from "@nestjs/testing";
import {
  PluginCoreModule,
  HookBus,
  PluginRegistry,
  PluginSupervisor,
  PluginLoader,
  PluginConfigService,
  ManifestValidator,
  LifecycleHookBridge,
  CORE_HOOKS,
} from "../index";

describe("PluginCoreModule (v5.1 R0.5 PR-11)", () => {
  it("装配 NestJS module 成功，所有 provider 可注入", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PluginCoreModule],
    }).compile();

    expect(moduleRef.get(HookBus)).toBeInstanceOf(HookBus);
    expect(moduleRef.get(PluginRegistry)).toBeInstanceOf(PluginRegistry);
    expect(moduleRef.get(PluginSupervisor)).toBeInstanceOf(PluginSupervisor);
    expect(moduleRef.get(PluginLoader)).toBeInstanceOf(PluginLoader);
    expect(moduleRef.get(PluginConfigService)).toBeInstanceOf(
      PluginConfigService,
    );
    expect(moduleRef.get(ManifestValidator)).toBeInstanceOf(ManifestValidator);
    expect(moduleRef.get(LifecycleHookBridge)).toBeInstanceOf(
      LifecycleHookBridge,
    );

    await moduleRef.close();
  });

  it("HookBus 注入后可注册 + fire hook", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PluginCoreModule],
    }).compile();

    const hookBus = moduleRef.get(HookBus);
    let seen = false;
    hookBus.register(
      CORE_HOOKS.MISSION_START,
      async (ctx) => {
        seen = true;
        return ctx.next();
      },
      { pluginId: "test", required: false, capabilities: [] },
    );

    await hookBus.fire(
      CORE_HOOKS.MISSION_START,
      { __version: 1 },
      async () => undefined,
    );
    expect(seen).toBe(true);
    await moduleRef.close();
  });

  it("LifecycleHookBridge 注入后已 setHookBus（可直接 fire MISSION_START）", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PluginCoreModule],
    }).compile();

    const hookBus = moduleRef.get(HookBus);
    const bridge = moduleRef.get(LifecycleHookBridge);

    let observedMissionId: string | undefined;
    hookBus.register(
      CORE_HOOKS.MISSION_START,
      async (ctx) => {
        observedMissionId = (ctx.payload as { missionId?: string }).missionId;
        return ctx.next();
      },
      { pluginId: "obs", required: false, capabilities: [] },
    );

    await bridge.fireMissionStart({
      missionId: "m1",
      missionContext: {},
    });
    expect(observedMissionId).toBe("m1");
    await moduleRef.close();
  });

  it("Supervisor 与 HookBus 协作：errors 累计触发熔断", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PluginCoreModule],
    }).compile();

    const hookBus = moduleRef.get(HookBus);
    const supervisor = moduleRef.get(PluginSupervisor);

    // 注册一个会抛错的 plugin
    hookBus.register(
      CORE_HOOKS.MISSION_START,
      async () => {
        throw new Error("boom");
      },
      { pluginId: "buggy", required: false, capabilities: [] },
    );

    // PluginSupervisor 默认 failureThreshold=5
    for (let i = 0; i < 5; i++) {
      await hookBus.fire(
        CORE_HOOKS.MISSION_START,
        { __version: 1 },
        async () => undefined,
      );
    }
    expect(supervisor.isCircuitOpen("buggy")).toBe(true);
    await moduleRef.close();
  });

  it("PluginConfigService 默认无任何 plugin enabled（PR-11 默认配置）", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PluginCoreModule],
    }).compile();

    const cfg = moduleRef.get(PluginConfigService);
    expect(cfg.listEnabledIds()).toEqual([]);
    await moduleRef.close();
  });
});
