/**
 * PluginLoader + ManifestValidator + PluginConfigService spec (v5.1 R0.5 PR-3)
 */
import {
  ManifestValidator,
  ManifestValidationError,
} from "../manifest-validator";
import { PluginConfigService } from "../plugin-config.service";
import { PluginLoader } from "../plugin-loader.service";
import { PluginRegistry } from "../../registry/plugin-registry.service";
import { PluginResolver } from "../../registry/plugin-resolver";
import { PluginSupervisor } from "../../lifecycle/plugin-supervisor.service";
import {
  PluginBootError,
  PluginIncompatibleCoreError,
} from "../../abstractions/hook-context.interface";
import type {
  IPlugin,
  IPluginContext,
  IPluginManifest,
} from "../../abstractions/plugin.interface";

const CORE_VERSION = "1.2.3";

function silent() {
  return { log: () => {}, warn: () => {}, error: () => {} };
}

function manifest(
  id: string,
  overrides: Partial<IPluginManifest> = {},
): IPluginManifest {
  return {
    id,
    version: "1.0.0",
    coreVersionRange: "^1.0.0",
    description: id,
    category: "experimental",
    stability: "internal",
    hooks: [],
    capabilities: [],
    phase: "bootstrap",
    required: false,
    ...overrides,
  };
}

function plugin(
  m: IPluginManifest,
  init?: (ctx: IPluginContext, cfg: unknown) => Promise<void>,
): IPlugin {
  return {
    manifest: m,
    init: init ?? (async () => {}),
  };
}

function fakeContext(id: string): IPluginContext {
  return {
    manifest: manifest(id),
    logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    config: { value: {}, profile: "test" } as IPluginContext["config"],
    hooks: { register: () => {} } as IPluginContext["hooks"],
    metrics: {
      counter: () => {},
      gauge: () => {},
      histogram: () => {},
    },
    events: {
      publish: () => {},
      subscribe: () => () => {},
    },
    getService: () => {
      throw new Error("getService not stubbed in test");
    },
  };
}

function makeLoader(opts: {
  configEntries?: Array<{
    id: string;
    enabled: boolean;
    required?: boolean;
    config?: unknown;
  }>;
}): {
  loader: PluginLoader;
  registry: PluginRegistry;
  supervisor: PluginSupervisor;
} {
  const registry = new PluginRegistry();
  const supervisor = new PluginSupervisor({}, { logger: silent() });
  const validator = new ManifestValidator();
  const configService = new PluginConfigService({
    plugins: opts.configEntries ?? [],
  });
  const loader = new PluginLoader({
    registry,
    resolver: new PluginResolver(),
    validator,
    configService,
    supervisor,
    coreVersion: CORE_VERSION,
    contextFactory: fakeContext,
    logger: silent(),
  });
  return { loader, registry, supervisor };
}

describe("ManifestValidator (v5.1 R0.5 PR-3)", () => {
  const v = new ManifestValidator();

  it("合法 manifest 通过", () => {
    expect(() => v.validate(manifest("a"), CORE_VERSION)).not.toThrow();
  });

  it("缺 id / 错误 stability 抛 ManifestValidationError", () => {
    expect(() =>
      v.validate(manifest("", { stability: "bogus" as never }), CORE_VERSION),
    ).toThrow(ManifestValidationError);
  });

  it("category 非法抛错", () => {
    expect(() =>
      v.validate(
        manifest("a", { category: "weird-category" as never }),
        CORE_VERSION,
      ),
    ).toThrow(ManifestValidationError);
  });

  it("hooks 中的 hook 必须在 capabilities 声明 hook:<id>", () => {
    expect(() =>
      v.validate(
        manifest("a", {
          hooks: ["engine.llm.request"],
          capabilities: [], // 缺 hook:engine.llm.request
        }),
        CORE_VERSION,
      ),
    ).toThrow(/missing capability declaration "hook:engine.llm.request"/);
  });

  it("capabilities 含 hook:<id> 时通过", () => {
    expect(() =>
      v.validate(
        manifest("a", {
          hooks: ["engine.llm.request"],
          capabilities: ["hook:engine.llm.request"],
        }),
        CORE_VERSION,
      ),
    ).not.toThrow();
  });

  it("coreVersionRange 不兼容抛 PluginIncompatibleCoreError（v5.1 MED-2）", () => {
    expect(() =>
      v.validate(manifest("a", { coreVersionRange: "^2.0.0" }), CORE_VERSION),
    ).toThrow(PluginIncompatibleCoreError);
  });

  it("coreVersionRange ~1.2.0 兼容 1.2.3", () => {
    expect(() =>
      v.validate(manifest("a", { coreVersionRange: "~1.2.0" }), CORE_VERSION),
    ).not.toThrow();
  });

  it("coreVersionRange ~1.2.0 不兼容 1.3.0", () => {
    expect(() =>
      v.validate(manifest("a", { coreVersionRange: "~1.2.0" }), "1.3.0"),
    ).toThrow(PluginIncompatibleCoreError);
  });
});

describe("PluginConfigService (v5.1 R0.5 PR-3)", () => {
  it("isEnabled 默认 false（不潜行加载）", () => {
    const cs = new PluginConfigService({ plugins: [] });
    expect(cs.isEnabled("any")).toBe(false);
  });

  it("enabled=true 时启用", () => {
    const cs = new PluginConfigService({
      plugins: [{ id: "p1", enabled: true }],
    });
    expect(cs.isEnabled("p1")).toBe(true);
    expect(cs.listEnabledIds()).toEqual(["p1"]);
  });

  it("entry.required 覆盖 manifest.required", () => {
    const cs = new PluginConfigService({
      plugins: [{ id: "p1", enabled: true, required: true }],
    });
    expect(cs.isRequired("p1", false)).toBe(true);
    expect(cs.isRequired("p2", true)).toBe(true);
    expect(cs.isRequired("p2", false)).toBe(false);
  });

  it("buildView 构造只读视图", () => {
    const cs = new PluginConfigService({
      profile: "production",
      plugins: [{ id: "p1", enabled: true, config: { ttl: 60 } }],
    });
    const view = cs.buildView<{ ttl: number }>("p1");
    expect(view.value.ttl).toBe(60);
    expect(view.profile).toBe("production");
    expect(Object.isFrozen(view)).toBe(true);
  });
});

describe("PluginLoader (v5.1 R0.5 PR-3)", () => {
  it("跳过未启用 plugin（plugins.config.yaml 没列出）", async () => {
    const { loader, registry } = makeLoader({ configEntries: [] });
    const r = await loader.load([plugin(manifest("p1"))]);
    expect(r.loaded).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(registry.size()).toBe(0);
  });

  it("加载 enabled plugin → registry + supervisor 注册", async () => {
    const initCalls: string[] = [];
    const { loader, registry, supervisor } = makeLoader({
      configEntries: [{ id: "p1", enabled: true }],
    });
    const r = await loader.load([
      plugin(manifest("p1"), async () => {
        initCalls.push("p1-init");
      }),
    ]);
    expect(r.loaded).toEqual(["p1"]);
    expect(initCalls).toEqual(["p1-init"]);
    expect(registry.has("p1")).toBe(true);
    expect(supervisor.describe()["p1"]?.state).toBe("closed");
  });

  it("依赖顺序：依赖在前 init", async () => {
    const order: string[] = [];
    const { loader } = makeLoader({
      configEntries: [
        { id: "a", enabled: true },
        { id: "b", enabled: true },
      ],
    });
    await loader.load([
      plugin(manifest("b", { dependencies: ["a"] }), async () => {
        order.push("b");
      }),
      plugin(manifest("a"), async () => {
        order.push("a");
      }),
    ]);
    expect(order).toEqual(["a", "b"]);
  });

  it("required plugin init 失败 → 抛 PluginBootError 致命", async () => {
    const { loader } = makeLoader({
      configEntries: [{ id: "p1", enabled: true, required: true }],
    });
    await expect(
      loader.load([
        plugin(manifest("p1"), async () => {
          throw new Error("init boom");
        }),
      ]),
    ).rejects.toBeInstanceOf(PluginBootError);
  });

  it("optional plugin init 失败 → skip 后继续", async () => {
    const { loader, registry } = makeLoader({
      configEntries: [
        { id: "bad", enabled: true, required: false },
        { id: "good", enabled: true },
      ],
    });
    const r = await loader.load([
      plugin(manifest("bad"), async () => {
        throw new Error("boom");
      }),
      plugin(manifest("good")),
    ]);
    expect(r.loaded).toEqual(["good"]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].pluginId).toBe("bad");
    expect(registry.has("good")).toBe(true);
    expect(registry.has("bad")).toBe(false);
  });

  it("manifest 校验失败 + required → 致命 PluginBootError", async () => {
    const { loader } = makeLoader({
      configEntries: [{ id: "x", enabled: true, required: true }],
    });
    await expect(
      loader.load([plugin(manifest("x", { stability: "weird" as never }))]),
    ).rejects.toBeInstanceOf(PluginBootError);
  });
});
