/**
 * Plugin System invariants spec (v5.1 R0.5 PR-12)
 *
 * 与 layer-boundaries.spec.ts (路径 + import 边界) 互补，本 spec 锁定 plugin
 * 系统的运行时不变量：
 *
 *   1. 所有 plugin manifest 通过 ManifestValidator 校验（schema + capability ↔ hooks）
 *   2. plugin id 形态合法（domain/plugin-name 命名）
 *   3. plugin id 全局唯一
 *   4. replaces 值跨 plugin 互斥（同 replaces 最多 1）
 *   5. capability ↔ hooks 一致（监听 hook 必声明 hook:<id>）
 *   6. coreVersionRange 与当前 plugin-core 兼容
 *   7. plugin manifest 不含任何 ai-app 业务名（business-agnostic 红线）
 *   8. CORE_HOOKS 命名规范：<layer>.<aggregate>.<action> 全 lowercase
 *   9. PluginResolver.resolve 拒绝循环依赖
 *  10. 所有 plugin 的 hooks 数组均在 CORE_HOOKS 或 EXTENDED_HOOKS 列表中（避免笔误）
 *
 * 凡是新增 plugin 都自动被这个 spec 覆盖（无 import side effects；
 * 仅依赖各 plugin 自己导出的 manifest 常量）。
 */
import { TELEMETRY_OTEL_MANIFEST } from "@/plugins/observability/telemetry-otel";
import { TOOL_CACHE_REDIS_MANIFEST } from "@/plugins/storage/tool-cache-redis";
import { SANDBOX_ISOLATED_VM_MANIFEST } from "@/plugins/security/sandbox-isolated-vm";
import {
  ManifestValidator,
  PluginResolver,
  PLUGIN_CORE_VERSION,
} from "@/plugins/core";
import { CORE_HOOKS } from "@/plugins/core/abstractions";
import type { IPluginManifest } from "@/plugins/core/abstractions";

// rate-limit / circuit-breaker 已撤销 plugin 形态（标准实现归 ai-engine 核心 service）
const ALL_PLUGINS: IPluginManifest[] = [
  TELEMETRY_OTEL_MANIFEST,
  TOOL_CACHE_REDIS_MANIFEST,
  SANDBOX_ISOLATED_VM_MANIFEST,
];

const VALID_HOOK_IDS = new Set<string>(Object.values(CORE_HOOKS));

const ALLOWED_DOMAINS = new Set([
  "plugin-core",
  "observability",
  "resilience",
  "security",
  "storage",
  "rag-backend",
  "llm-augment",
  "tool-augment",
  "experimental",
]);

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

const HOOK_ID_PATTERN = /^[a-z]+\.[a-z]+\.[a-z]+$/;

// 业务名黑名单（standards/19 §四 + §0 业务无关红线）
const AI_APP_BUSINESS_TERMS = [
  "playground",
  "playground",
  "research",
  "topic-insights",
  "writing",
  "office",
  "ask",
  "library",
  "image",
  "social",
  "simulation",
  "planning",
  "debate",
  "slides",
];

describe("Plugin System invariants (v5.1 R0.5 PR-12)", () => {
  describe("manifest schema 合法性", () => {
    const validator = new ManifestValidator();

    for (const m of ALL_PLUGINS) {
      it(`${m.id}: manifest 通过 ManifestValidator + coreVersionRange 兼容`, () => {
        expect(() => validator.validate(m, PLUGIN_CORE_VERSION)).not.toThrow();
      });
    }
  });

  describe("plugin id 命名规范", () => {
    for (const m of ALL_PLUGINS) {
      it(`${m.id}: 形态符合 <domain>/<plugin-name> kebab-case`, () => {
        expect(m.id).toMatch(PLUGIN_ID_PATTERN);
      });
      it(`${m.id}: domain 在 8 个 standards/19 锁定值之内`, () => {
        const domain = m.id.split("/")[0];
        expect(ALLOWED_DOMAINS.has(domain)).toBe(true);
      });
    }
  });

  describe("plugin id 全局唯一", () => {
    it("无重复 id", () => {
      const ids = ALL_PLUGINS.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("replaces 互斥（PluginResolver）", () => {
    it("PluginResolver.resolve 接受当前所有 plugin（无 replaces 冲突）", () => {
      const resolver = new PluginResolver();
      expect(() => resolver.resolve(ALL_PLUGINS)).not.toThrow();
    });

    it("注入冲突的 replaces 值 → 抛错", () => {
      const resolver = new PluginResolver();
      const conflict: IPluginManifest = {
        ...TELEMETRY_OTEL_MANIFEST,
        id: "observability/duplicate-telemetry",
        replaces: "telemetry",
      };
      expect(() => resolver.resolve([...ALL_PLUGINS, conflict])).toThrow(
        /multiple plugins replace "telemetry"/,
      );
    });
  });

  describe("capability ↔ hooks 一致性", () => {
    for (const m of ALL_PLUGINS) {
      it(`${m.id}: 每个 hook 在 capabilities 含 hook:<id>`, () => {
        for (const hookId of m.hooks) {
          expect(m.capabilities).toContain(`hook:${hookId}`);
        }
      });
    }
  });

  describe("hook id 命名规范", () => {
    it(`CORE_HOOKS 全部符合 <layer>.<aggregate>.<action> lowercase`, () => {
      for (const id of Object.values(CORE_HOOKS)) {
        expect(id).toMatch(HOOK_ID_PATTERN);
      }
    });

    for (const m of ALL_PLUGINS) {
      it(`${m.id}: 所有声明的 hook 在 CORE_HOOKS 中（避免 typo）`, () => {
        for (const hookId of m.hooks) {
          expect(VALID_HOOK_IDS.has(hookId)).toBe(true);
        }
      });
    }
  });

  describe("payloadVersions 矩阵完整", () => {
    for (const m of ALL_PLUGINS) {
      it(`${m.id}: 每个 hook 都有 payloadVersions 条目（避免遗漏）`, () => {
        for (const hookId of m.hooks) {
          expect(m.payloadVersions?.[hookId]).toBeDefined();
          expect(Array.isArray(m.payloadVersions![hookId])).toBe(true);
          expect(m.payloadVersions![hookId].length).toBeGreaterThan(0);
        }
      });
    }
  });

  describe("base layer 业务无关红线（standards/19 §0 永久门槛）", () => {
    for (const m of ALL_PLUGINS) {
      it(`${m.id}: manifest 不含任何 ai-app 业务名`, () => {
        const json = JSON.stringify(m).toLowerCase();
        for (const term of AI_APP_BUSINESS_TERMS) {
          // 边界匹配避免误伤（如 "research-style" 是合法的 agent 标签）
          // 这里只查 plugin id / replaces / category / description 是否含完整业务词
          // 边界判定：term 前后必须是非字母数字，或 string 起止
          const wordRe = new RegExp(`(^|[^a-z0-9-])${term}([^a-z0-9-]|$)`);
          // 例外：tool-cache-redis 的 description 含 'tool-cache' —— 业务无关词
          // 实际我们对 AI_APP_BUSINESS_TERMS 的所有 14 个值都精确匹配
          expect(wordRe.test(json)).toBe(false);
        }
      });
    }
  });

  describe("PluginResolver 循环依赖检测", () => {
    it("依赖图含循环 → 抛 PluginCircularDependencyError", () => {
      const resolver = new PluginResolver();
      const cyclic1: IPluginManifest = {
        ...TELEMETRY_OTEL_MANIFEST,
        id: "experimental/cycle-a",
        replaces: undefined,
        dependencies: ["experimental/cycle-b"],
      };
      const cyclic2: IPluginManifest = {
        ...TELEMETRY_OTEL_MANIFEST,
        id: "experimental/cycle-b",
        replaces: undefined,
        dependencies: ["experimental/cycle-a"],
      };
      expect(() => resolver.resolve([cyclic1, cyclic2])).toThrow(
        /circular dependency/,
      );
    });
  });

  describe("plugin 总量 + 域分布", () => {
    it(`R0.5 stage 2 应有 3 个真 plugin（rate-limit 已撤销 → ai-engine 核心 service）`, () => {
      expect(ALL_PLUGINS).toHaveLength(3);
    });

    it("3 大域各 1 个真 plugin (observability/storage/security)", () => {
      const domainCount: Record<string, number> = {};
      for (const m of ALL_PLUGINS) {
        const d = m.id.split("/")[0];
        domainCount[d] = (domainCount[d] ?? 0) + 1;
      }
      expect(domainCount.observability).toBe(1);
      expect(domainCount.storage).toBe(1);
      expect(domainCount.security).toBe(1);
      // resilience 域已无 plugin（rate-limit / circuit-breaker 是核心 service）
      expect(domainCount.resilience).toBeUndefined();
    });
  });
});
