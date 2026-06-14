/**
 * PluginRegistry + PluginResolver spec (v5.1 R0.5 PR-3)
 */
import { PluginRegistry } from "../plugin-registry.service";
import {
  PluginResolver,
  PluginCircularDependencyError,
  PluginMissingDependencyError,
  PluginReplacesConflictError,
} from "../plugin-resolver";
import type {
  IPlugin,
  IPluginManifest,
} from "../../abstractions/plugin.interface";

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

function plugin(m: IPluginManifest): IPlugin {
  return {
    manifest: m,
    init: async () => {},
  };
}

describe("PluginRegistry (v5.1 R0.5 PR-3)", () => {
  it("register / get / has / size", () => {
    const reg = new PluginRegistry();
    const p1 = plugin(manifest("p1"));
    reg.register(p1);
    expect(reg.has("p1")).toBe(true);
    expect(reg.get("p1")).toBe(p1);
    expect(reg.size()).toBe(1);
  });

  it("duplicate id 抛 Error", () => {
    const reg = new PluginRegistry();
    reg.register(plugin(manifest("p1")));
    expect(() => reg.register(plugin(manifest("p1")))).toThrow(/duplicate/);
  });

  it("listByCategory 过滤", () => {
    const reg = new PluginRegistry();
    reg.register(plugin(manifest("a", { category: "observability" })));
    reg.register(plugin(manifest("b", { category: "observability" })));
    reg.register(plugin(manifest("c", { category: "resilience" })));
    expect(
      reg.listByCategory("observability").map((p) => p.manifest.id),
    ).toEqual(["a", "b"]);
  });

  it("listByReplaces / listByHook", () => {
    const reg = new PluginRegistry();
    reg.register(plugin(manifest("vm2", { replaces: "sandbox" })));
    reg.register(
      plugin(
        manifest("hookful", {
          hooks: ["engine.llm.request", "engine.tool.before"],
        }),
      ),
    );
    expect(reg.listByReplaces("sandbox").map((p) => p.manifest.id)).toEqual([
      "vm2",
    ]);
    expect(
      reg.listByHook("engine.llm.request").map((p) => p.manifest.id),
    ).toEqual(["hookful"]);
  });

  it("unregister 删除", () => {
    const reg = new PluginRegistry();
    reg.register(plugin(manifest("p1")));
    expect(reg.unregister("p1")).toBe(true);
    expect(reg.has("p1")).toBe(false);
  });
});

describe("PluginResolver (v5.1 R0.5 PR-3)", () => {
  describe("拓扑排序", () => {
    it("无依赖：按字典序输出", () => {
      const r = new PluginResolver();
      const sorted = r.resolve([manifest("c"), manifest("a"), manifest("b")]);
      expect(sorted.map((m) => m.id)).toEqual(["a", "b", "c"]);
    });

    it("有依赖：依赖在前", () => {
      const r = new PluginResolver();
      const sorted = r.resolve([
        manifest("b", { dependencies: ["a"] }),
        manifest("a"),
        manifest("c", { dependencies: ["b"] }),
      ]);
      expect(sorted.map((m) => m.id)).toEqual(["a", "b", "c"]);
    });

    it("链式 + 多依赖", () => {
      const r = new PluginResolver();
      const sorted = r.resolve([
        manifest("d", { dependencies: ["b", "c"] }),
        manifest("c", { dependencies: ["a"] }),
        manifest("b", { dependencies: ["a"] }),
        manifest("a"),
      ]);
      const ids = sorted.map((m) => m.id);
      expect(ids[0]).toBe("a");
      expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("d"));
      expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("d"));
    });
  });

  describe("循环依赖检测", () => {
    it("a → b → a 抛 PluginCircularDependencyError", () => {
      const r = new PluginResolver();
      expect(() =>
        r.resolve([
          manifest("a", { dependencies: ["b"] }),
          manifest("b", { dependencies: ["a"] }),
        ]),
      ).toThrow(PluginCircularDependencyError);
    });

    it("自环 a → a 抛错", () => {
      const r = new PluginResolver();
      expect(() => r.resolve([manifest("a", { dependencies: ["a"] })])).toThrow(
        PluginCircularDependencyError,
      );
    });
  });

  describe("缺失依赖检测", () => {
    it("依赖未声明的 plugin id 抛 PluginMissingDependencyError", () => {
      const r = new PluginResolver();
      expect(() =>
        r.resolve([manifest("a", { dependencies: ["nonexistent"] })]),
      ).toThrow(PluginMissingDependencyError);
    });
  });

  describe("replaces 互斥", () => {
    it("同 replaces 值有 2+ plugin 抛 PluginReplacesConflictError", () => {
      const r = new PluginResolver();
      expect(() =>
        r.resolve([
          manifest("vm2", { replaces: "sandbox" }),
          manifest("isolated-vm", { replaces: "sandbox" }),
        ]),
      ).toThrow(PluginReplacesConflictError);
    });

    it("同 replaces 值仅 1 个 plugin 通过", () => {
      const r = new PluginResolver();
      const sorted = r.resolve([
        manifest("vm2", { replaces: "sandbox" }),
        manifest("other"),
      ]);
      expect(sorted.map((m) => m.id)).toEqual(["other", "vm2"]);
    });
  });
});
