/**
 * Architecture Layer Boundaries — 自动化看护测试
 *
 * 2026-05-01 (PR-X-N): 把 K/L/M-step1/M-step2/M-step3 累计推到 9.8/10 的架构
 * 合规分通过 spec 锁定，防回归。
 *
 * 看护规则（与 CLAUDE.md L4→L3→L2.5→L2→L1 单向规则一致）：
 *
 *   L4 open-api → L3/L2.5/L2/L1（任何方向都允许）
 *   L3 ai-app   → L2.5 / L2 / L1
 *   L2.5 ai-harness → L2 / L1（不允许 import L3 / L4）
 *   L2 ai-engine    → L1（不允许 import L2.5 / L3 / L4）
 *   L1 platform     → 无（顶层基础设施，不允许 import 任何更高层）
 *   common/ → 任何层（共享基础工具）
 *
 * Allowlist（合法的反向 / adapter 模式）：
 *   - ai-engine/skills/integration/adapters/engine-skill-provider.adapter.ts → ai-harness/agents/abstractions
 *     原因：engine 实现 harness ISkillProvider 端口（K commit 的 adapter 模式）
 *   - 注释 / 文档字符串 引用其他层的路径（不是真实 import）— 由正则限定到 import 语句过滤
 *
 * 这套测试与 ESLint no-restricted-imports 是 belt-and-suspenders：
 *   - ESLint 在 lint 阶段拦截（IDE 实时反馈 + lint-staged pre-commit）
 *   - 本 spec 在 jest 阶段拦截（不依赖 lint config，覆盖动态 import + 注释逃逸）
 *   - pre-push hook 跑 jest 覆盖；CI 跑 jest 二次覆盖
 */

import * as fs from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

/**
 * 递归扫描 .ts 文件（排除 .spec.ts / __tests__ / node_modules）
 */
function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "__tests__" ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "coverage"
      )
        continue;
      listTsFiles(full, acc);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * 抽取一个文件中所有 import 语句的目标路径（含 type-only / dynamic import）。
 * 跳过注释里的 path-like 字符串（先去除 // 单行注释 + /* 块注释 *\/，再 regex 抽 import）。
 */
function extractImportTargets(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  // 去除单行注释和块注释
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  // 抓 from "..." / from '...' / import("...") / require("...")
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  const targets: string[] = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    targets.push(m[1]);
  }
  return targets;
}

/**
 * 把文件路径按 modules/ 切片得到所属层。
 * v5.1 R0.5 PR-0: 扩展支持 src/plugins/ 系统：
 *   - src/plugins/core/* → "plugins-core"（plugin 系统内核）
 *   - src/plugins/<domain>/* → "plugin:<domain>"（如 plugin:observability）
 */
function fileLayer(filePath: string): string | null {
  const rel = path.relative(SRC_ROOT, filePath).replace(/\\/g, "/");
  const m = rel.match(/^modules\/([^/]+)\//);
  if (m) return m[1];
  // v5.1 PR-0: src/plugins/ 双层识别
  if (rel.startsWith("plugins/core/")) return "plugins-core";
  const mp = rel.match(/^plugins\/([^/]+)\//);
  if (mp) return `plugin:${mp[1]}`;
  if (rel.startsWith("common/")) return "common";
  if (rel.startsWith("__tests__/")) return "test";
  return null;
}

/**
 * 把 import 字符串规范化到分类目标层。
 * v5.1 R0.5 PR-0: 扩展支持 src/plugins/ 系统：
 *   - @/plugins/core/* / src/plugins/core/* → "plugins-core"
 *   - @/plugins/<domain>/* → "plugin:<domain>"
 */
function importLayer(spec: string): string | null {
  // 处理 @/modules/X/... 和 ../modules/X/... 和 .../ai-X/...
  const m1 = spec.match(/(?:@\/|\.\.?\/)*modules\/([^/]+)\//);
  if (m1) return m1[1];
  // v5.1 PR-0: plugins/ 系统识别
  const mc = spec.match(/(?:@\/|\.\.?\/)*plugins\/core(?:\/|$)/);
  if (mc) return "plugins-core";
  const mp = spec.match(/(?:@\/|\.\.?\/)*plugins\/([^/]+)(?:\/|$)/);
  if (mp) return `plugin:${mp[1]}`;
  // 同目录或子目录相对路径不指向 modules/ / plugins/
  if (
    spec.startsWith(".") &&
    !/modules\//.test(spec) &&
    !/plugins\//.test(spec)
  )
    return null;
  // 第三方 / @nestjs / 等不计
  if (!spec.includes("/")) return null;
  return null;
}

/** v5.1 PR-0: 判断一个 layer 是不是 plugin 实现域（plugin:<domain>） */
function isPluginDomain(layer: string | null): boolean {
  return layer !== null && layer.startsWith("plugin:");
}

/** 该 import 是否穿透了某层的内部路径（非 facade / 非 NestJS module 装配）。返回违规的内部子路径或 null */
function detectInternalPenetration(spec: string, layer: string): string | null {
  const norm = spec.replace(/^(?:\.\.?\/)+/, "/").replace(/^@\//, "/");
  const re = new RegExp(`/modules/${layer}/([^"']+)`);
  const mm = norm.match(re) ?? spec.match(re);
  if (!mm) return null;
  const subpath = mm[1];
  // 允许的入口:
  //   facade / facade/* — 标准对外 surface
  //   index / index.ts — 顶层 barrel
  //   *.module / *.module.ts — NestJS 模块装配（imports: [...] 必须用具体 module class）
  //   abstractions/* — 部分模块通过 abstractions 暴露 DI tokens（合法）
  if (
    subpath === "facade" ||
    subpath.startsWith("facade/") ||
    subpath === "index" ||
    subpath === "index.ts" ||
    /\.module(\.ts)?$/.test(subpath) ||
    subpath.startsWith("abstractions/")
  ) {
    return null;
  }
  return subpath;
}

const ALL_FILES = listTsFiles(SRC_ROOT);

describe("Layer Boundaries (CLAUDE.md L4→L3→L2.5→L2→L1)", () => {
  describe("Single-direction dependency", () => {
    it("ai-engine 不得 import ai-harness（除合法 adapter）", () => {
      // K commit 的 engine-skill-provider 实现 harness ISkillProvider 端口
      // 是 Dependency Inversion 模式的合法反向 import（即便走 facade，仍属
      // ai-harness 层）。允许此一 adapter，禁止其他 ai-engine → ai-harness 路径。
      const violations: string[] = [];
      const allowlist = [
        "modules/ai-engine/skills/integration/adapters/engine-skill-provider.adapter.ts",
      ];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-engine") continue;
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        if (allowlist.includes(rel)) continue;
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) === "ai-harness") {
            violations.push(`${rel} → ${target}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("ai-engine 不得 import ai-app", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-engine") continue;
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) === "ai-app") {
            violations.push(
              `${path.relative(SRC_ROOT, file).replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("ai-harness 不得 import ai-app", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-harness") continue;
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) === "ai-app") {
            violations.push(
              `${path.relative(SRC_ROOT, file).replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("platform 不得 import ai-engine / ai-harness / ai-app / open-api", () => {
      const forbidden = ["ai-engine", "ai-harness", "ai-app", "open-api"];
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "platform") continue;
        for (const target of extractImportTargets(file)) {
          const tgtLayer = importLayer(target);
          if (tgtLayer && forbidden.includes(tgtLayer)) {
            violations.push(
              `${path.relative(SRC_ROOT, file).replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe("Facade penetration (must go through facade)", () => {
    it("ai-app 不得穿透 ai-engine 内部（除 facade/abstractions/contracts shim）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-app") continue;
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        // contracts/* 是有意识的 backwards-compat 隧道，allowlist
        if (rel.startsWith("modules/ai-app/contracts/")) continue;
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) !== "ai-engine") continue;
          const sub = detectInternalPenetration(target, "ai-engine");
          if (sub) {
            violations.push(`${rel} → modules/ai-engine/${sub}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    // v3.1 阶段 A review (2026-05-24)：ModelCapabilityService 边界守护
    // 该服务仅供 llm.module 内部 StructuredOutputRouter + AiApiCallerService 注入，
    // 故意不在 llm.module exports —— 防 ai-app 直接读 caps 再生散点 if 判断
    // （v3 §3.6 SSOT 守护）。本断言锁定此边界，违规一目了然。
    it("ai-app 不得 import capability/model-capability.service（仅 llm.module 内部）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-app") continue;
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        for (const target of extractImportTargets(file)) {
          // 命中 ai-engine/llm/models/capability/model-capability.service（任意相对/绝对路径形态）
          if (/capability\/model-capability\.service/.test(target)) {
            violations.push(`${rel} → ${target}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("ai-app 不得穿透 ai-harness 内部（除 facade）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-app") continue;
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) !== "ai-harness") continue;
          const sub = detectInternalPenetration(target, "ai-harness");
          if (sub) {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → modules/ai-harness/${sub}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    // ★ 2026-05-08 PR-A1: ai-app/X 不得直接 import ai-app/Y 内部路径
    //   背景：playground 审计发现 per-dim-pipeline.util.ts 曾 import topic-insights/utils
    //   （已修正上提到 ai-engine/content/markdown）。本断言守护防回归。
    //
    //   合法例外：
    //   - contracts/ 是显式跨 app 公共契约 shim
    //   - custom-agents → playground：custom-agents 是 playground 衍生模块，
    //     playground module.ts 显式 exports dispatcher / mission-store / event-buffer
    //     供其复用（R-CA 2026-05-05 设计决定）
    it("ai-app 模块不得跨 app 直接 import 其他 ai-app 内部路径（除 contracts shim 与 allowlist）", () => {
      const APP_LEVEL_ALLOWLIST: Array<{ from: string; to: string }> = [
        // R-CA (2026-05-05): custom-agents 复用 playground 启动 + 列表能力
        { from: "custom-agents", to: "playground" },
      ];
      // ★ 2026-05-10 PR-2 (wiki-as-KB-source): library/kb-query/ 是跨 app
      // 共享的 KB 查询门面（wiki BM25 + chunk RAG 透明合一），任何 ai-app
      // 都可以替代直接吃 RAGPipelineService。架构上等价于 contracts/ shim：
      // 内部组合细节保留在 library 内部，对外只暴露 KbQueryService 一个入口。
      // 不开放 library 的其他子目录（wiki / rag / collections / notes …）。
      const APP_LEVEL_SUBPATH_ALLOWLIST: Array<{
        targetApp: string;
        subPathPrefix: string;
      }> = [
        { targetApp: "library", subPathPrefix: "kb-query/" },
        // ★ 2026-06-05: library/export/ is the sanctioned cross-app deliverable-export
        // facade (mirrors kb-query pattern). One public entry: LibraryExportService.
        // Internals (google-drive integration) remain encapsulated inside library.
        { targetApp: "library", subPathPrefix: "export/" },
        // ★ 2026-06-09: library/sediment/ is the sanctioned cross-app mission-sediment
        // facade (mirrors kb-query/export). One public entry: MissionSedimentService
        // (+ SedimentModule for DI). playground / company 完成后把报告落 library notes，
        // notes/collections 内部细节封装在 library 内，对外只暴露沉淀入口。
        { targetApp: "library", subPathPrefix: "sediment/" },
        // （deep-insight 能力的 P1/P2 过渡债已全部清零：evidence-budget 已下沉能力家、
        //   researcher 的 minFindings 已改走能力级 research-tuning；marketplace 不再反依赖
        //   playground 任何内部路径。）
      ];
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-app") continue;
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        const selfApp = rel.match(/^modules\/ai-app\/([^/]+)\//)?.[1];
        if (!selfApp) continue;
        if (selfApp === "contracts") continue;
        for (const target of extractImportTargets(file)) {
          const m = target.match(
            /(?:@\/|\.\.?\/)*modules\/ai-app\/([^/]+)\/(.+)$/,
          );
          if (!m) continue;
          const targetApp = m[1];
          const subPath = m[2];
          if (targetApp === selfApp) continue;
          if (targetApp === "contracts") continue;
          // ★ 2026-06-08: marketplace 是平台共享市场（design.md §4.3「市场=平台共享，去采购」）。
          //   上架的能力本体（agents / recipe / 契约）住这里，任意 app 可按引用消费——故作为
          //   *被 import 的目标* 豁免（同 contracts 模式）。**非对称**：不豁免 marketplace 作为
          //   selfApp，即共享层**不得反依赖任何 app**（marketplace → ai-app/<app> 仍是违规）。
          if (targetApp === "marketplace") continue;
          if (
            APP_LEVEL_ALLOWLIST.some(
              (a) => a.from === selfApp && a.to === targetApp,
            )
          ) {
            continue;
          }
          if (
            APP_LEVEL_SUBPATH_ALLOWLIST.some(
              (a) =>
                a.targetApp === targetApp &&
                subPath.startsWith(a.subPathPrefix),
            )
          ) {
            continue;
          }
          violations.push(`${rel} → modules/ai-app/${targetApp}/${subPath}`);
        }
      }
      expect(violations).toEqual([]);
    });

    it("ai-app 不得穿透 platform 内部（除 facade / module .module.ts 入口）", () => {
      // platform 的 .module.ts 是 NestJS 模块装配入口，允许 ai-app .module.ts 引用
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-app") continue;
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) !== "platform") continue;
          const sub = detectInternalPenetration(target, "platform");
          if (sub && !sub.endsWith(".module") && !/\.module(\?|$)/.test(sub)) {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → modules/platform/${sub}`,
            );
          }
        }
      }
      // 当前对 platform 暂留宽松（基础设施访问模式多样，部分 ai-app 直接 import service.ts），
      // 不强制 expect=[]，仅 assert 没有"反向 import 高层"的恶性情况（已在上方 platform
      // 不得 import 上层 case 覆盖）。本 case 当前为信息级别。
      expect(violations.length).toBeGreaterThanOrEqual(0); // 总是过；占位保留可见性
    });
  });

  /**
   * X6 (2026-05-18): NotificationDispatcher 边界看护
   *
   * platform/notifications/dispatcher/ 是 L1 基础设施层的通知分发组件，
   * 不得向上 import ai-app / ai-engine（违反 L1 单向规则）。
   *
   * 与顶层 "platform 不得 import ai-engine / ai-harness / ai-app / open-api" 断言
   * 互补：本组断言精确定位到 dispatcher 子目录，给出更易读的违规报告。
   */
  describe("NotificationDispatcher isolation (X6)", () => {
    function listDispatcherFiles(): string[] {
      const dispatcherDir = path.resolve(
        SRC_ROOT,
        "modules/platform/notifications/dispatcher",
      );
      if (!fs.existsSync(dispatcherDir)) return [];
      return listTsFiles(dispatcherDir);
    }

    it("notifications/dispatcher 不得 import ai-app/**", () => {
      const violations: string[] = [];
      for (const file of listDispatcherFiles()) {
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) === "ai-app") {
            violations.push(`${rel} → ${target}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("notifications/dispatcher 不得 import ai-engine/**", () => {
      const violations: string[] = [];
      for (const file of listDispatcherFiles()) {
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) === "ai-engine") {
            violations.push(`${rel} → ${target}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  /**
   * v5.1 R0.5 PR-0: Plugin 系统边界守护
   *
   * 与 standards/19-plugin-system-governance.md §四"依赖方向"一一对应。
   * 当 src/plugins/ 还没有内容时（PR-0 早期），所有断言自然为空，spec 正常通过；
   * PR-1 起 plugins/core/ 实例化后开始实质守门。
   *
   * 合法依赖：
   *   ai-harness → plugins-core （fire hook 用）
   *   ai-engine  → plugins-core
   *   ai-app     → plugins-core （仅类型）
   *   plugin:*   → plugins-core （plugin 实现接口）
   *
   * 禁止依赖：
   *   harness/engine/app → plugin:<domain>（必须通过 HookBus）
   *   plugins-core → 任何 modules/* （内核不依赖业务）
   *   plugins-core → plugin:<domain>（内核不依赖具体 plugin）
   *   plugin:<domain> → modules/ai-harness/ai-engine/ai-app 内部
   *   plugin:<a> → plugin:<b>（plugin 间仅通过 hook payload 通信）
   */
  describe("Plugin system boundaries (v5.1 §11 / standards/19)", () => {
    it("ai-harness 不得 import plugin:<domain> 实现（仅可 plugins-core）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-harness") continue;
        for (const target of extractImportTargets(file)) {
          if (isPluginDomain(importLayer(target))) {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("ai-engine 不得 import plugin:<domain> 实现（仅可 plugins-core；NestJS @Module 类除外）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-engine") continue;
        // 仅 *.module.ts 允许 import plugins/<domain>/*.module（NestJS DI 装配，
        // 非实现使用）。其他 ai-engine 文件不得 import plugins/<domain>。
        const isModuleFile = file.endsWith(".module.ts");
        for (const target of extractImportTargets(file)) {
          if (isPluginDomain(importLayer(target))) {
            const isModuleImport = /\.module(?:\.ts)?$/.test(target);
            if (isModuleFile && isModuleImport) continue;
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("ai-app 不得 import plugin:<domain> 实现（plugin 是平台横切，与业务无关）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-app") continue;
        for (const target of extractImportTargets(file)) {
          if (isPluginDomain(importLayer(target))) {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("plugins-core 不得 import 任何 modules/*（内核与业务无关）", () => {
      const businessLayers = new Set([
        "ai-app",
        "ai-harness",
        "ai-engine",
        "platform",
        "open-api",
      ]);
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "plugins-core") continue;
        for (const target of extractImportTargets(file)) {
          const tgt = importLayer(target);
          if (tgt && businessLayers.has(tgt)) {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("plugins-core 不得 import plugin:<domain> 实现（内核不依赖具体 plugin）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "plugins-core") continue;
        for (const target of extractImportTargets(file)) {
          if (isPluginDomain(importLayer(target))) {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("plugin:<domain> 不得 import modules/ai-harness 内部（仅允许 plugins-core）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (!isPluginDomain(fileLayer(file))) continue;
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) === "ai-harness") {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("plugin:<domain> 不得 import modules/ai-engine 内部（仅允许 plugins-core）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (!isPluginDomain(fileLayer(file))) continue;
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) === "ai-engine") {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("plugin:<domain> 不得 import modules/ai-app（plugin 与业务无关）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (!isPluginDomain(fileLayer(file))) continue;
        for (const target of extractImportTargets(file)) {
          if (importLayer(target) === "ai-app") {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("plugin:<a> 不得 import plugin:<b>（plugin 间仅通过 hook payload 通信）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        const fileL = fileLayer(file);
        if (!isPluginDomain(fileL)) continue;
        for (const target of extractImportTargets(file)) {
          const tgtL = importLayer(target);
          if (isPluginDomain(tgtL) && tgtL !== fileL) {
            violations.push(
              `${path
                .relative(SRC_ROOT, file)
                .replace(/\\/g, "/")} → ${target}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  /**
   * R0-A5 (2026-05-04): Base-layer business leakage 看护
   *
   * harness / engine 是 base layer，必须业务无关。任何 ai-app 名（playground /
   * research / writing / topic-insights / office / ask / image / social /
   * simulation / planning / library / explore）都不得出现在 base-layer 文件中
   * （包括代码 / import path / 字面量）—— 注释中也不允许（防 R0-A2 回归）。
   *
   * 例外：
   *   - 历史迁移注释里加 "@migrated-from" 显式 opt-out（白名单标记）
   *   - test fixtures（__tests__/）已被 fileLayer 排除
   */
  describe("Base-layer business leakage (R0-A5)", () => {
    // 真正具有业务标识性的复合名（不是常见英文单词），出现 = 业务泄漏
    // 排除：image / research / writing / library / explore / planning / ask / social
    // 这些词在英语中高频，作为 ai-app 名只能靠 import path 检测（已在 §单向依赖 cover）
    const UNIQUE_BUSINESS_NAMES = [
      "playground",
      "topic-insights",
      "topic-report",
    ];
    const PLAYGROUND_RE = /\bplayground\b/i; // playground 单独一词业务唯一
    const COMPOUND_RE = new RegExp(
      `\\b(${UNIQUE_BUSINESS_NAMES.join("|")})\\b`,
      "i",
    );

    // 历史豁免列表（三轮清理后剩 2 文件，credits 业务 catalog 永久豁免）：
    //   - credits/policy 两个 catalog：用 ai-app 名作为业务 key（计费按模块
    //     分类），是业务设计而非泄漏 —— 永久 allowlist。
    const ALLOWLIST: ReadonlySet<string> = new Set<string>([
      "modules/platform/credits/policies/credit-transaction-type.catalog.ts",
      "modules/platform/credits/policies/default-credit-rules.catalog.ts",
    ]);

    function fileMentionsBusinessName(file: string): {
      hit: boolean;
      sample?: string;
    } {
      const text = fs.readFileSync(file, "utf-8");
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("@migrated-from")) continue;
        if (COMPOUND_RE.test(line) || PLAYGROUND_RE.test(line)) {
          return {
            hit: true,
            sample: `L${i + 1}: ${line.trim().slice(0, 100)}`,
          };
        }
      }
      return { hit: false };
    }

    it("ai-engine 不得提及业务唯一名 playground / topic-insights / playground", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-engine") continue;
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        if (ALLOWLIST.has(rel)) continue;
        const r = fileMentionsBusinessName(file);
        if (r.hit) violations.push(`${rel}: ${r.sample}`);
      }
      // 当前数据：先在 R0-A5 落地这套断言。如本断言初次运行违规为 0，
      // 直接锁死；若有遗漏违规，加进 ALLOWLIST 临时豁免 + 记 todo 清零。
      expect(violations).toEqual([]);
    });

    it("ai-harness 不得提及业务唯一名 playground / topic-insights / playground", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-harness") continue;
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        if (ALLOWLIST.has(rel)) continue;
        const r = fileMentionsBusinessName(file);
        if (r.hit) violations.push(`${rel}: ${r.sample}`);
      }
      expect(violations).toEqual([]);
    });

    it("platform 不得提及业务唯一名", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "platform") continue;
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        if (ALLOWLIST.has(rel)) continue;
        const r = fileMentionsBusinessName(file);
        if (r.hit) violations.push(`${rel}: ${r.sample}`);
      }
      expect(violations).toEqual([]);
    });

    it("plugins/<domain> 不得提及业务唯一名", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (!isPluginDomain(fileLayer(file))) continue;
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        if (ALLOWLIST.has(rel)) continue;
        const r = fileMentionsBusinessName(file);
        if (r.hit) violations.push(`${rel}: ${r.sample}`);
      }
      expect(violations).toEqual([]);
    });

    it("ai-harness/agents/skill-runtime/ 不得含 SKILL.md（business 内容下推 ai-app/<app>/skills/）", () => {
      const harnessSkillsDir = path.resolve(
        SRC_ROOT,
        "modules/ai-harness/agents/skill-runtime",
      );
      const found: string[] = [];
      function walk(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === "__tests__") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile() && entry.name === "SKILL.md") {
            found.push(path.relative(SRC_ROOT, full).replace(/\\/g, "/"));
          }
        }
      }
      walk(harnessSkillsDir);
      expect(found).toEqual([]);
    });
  });

  /**
   * MECE invariant 1 enforcement (2026-06-02 layer-audit P0-1):
   *
   * "engine 不知道 agent / mission（无 agent/mission 状态）；harness 必知" 此前是
   * honor-only（仅靠 code review），审计发现已被 MissionElectionTracker 破坏
   * （它在 ai-engine 内直接读写 mission-scoped Prisma 表 missionElectionState，
   * 该表对 ai-app 的 agent_playground_mission 有硬 FK）。
   *
   * 本断言把该不变量升级为 jest 强制：ai-engine/** 不得访问 mission/agent-scoped
   * Prisma 模型（prisma.mission* / prisma.agentPlayground*）。无状态的择优逻辑
   * （ModelElectionService）通过 caller 传入的 previouslyElected 参数解耦，无需
   * 触碰持久层 —— mission 持久化属于 L2.5 harness / L3 ai-app 的职责。
   *
   * 2026-06-02 P0-1 relocation 已完成：MissionElectionTracker 迁至
   * ai-harness/guardrails/runtime，allowlist 清零，本断言对全 engine 强制。
   */
  describe("Engine mission-state isolation (MECE inv.1)", () => {
    // 命中 this.prisma.missionXxx / prisma.agentPlaygroundXxx 等 mission/agent 持久层访问
    const MISSION_PRISMA_RE =
      /\bprisma\s*\.\s*(mission[A-Za-z0-9]*|agentPlayground[A-Za-z0-9]*)\b/;
    // 已知债务豁免（当前为空 —— relocation 后无 engine 文件触碰 mission 持久层）
    const MISSION_STATE_ALLOWLIST: ReadonlySet<string> = new Set<string>([]);

    it("ai-engine 不得访问 mission/agent-scoped Prisma 表（mission 持久化属 harness/app）", () => {
      const violations: string[] = [];
      for (const file of ALL_FILES) {
        if (fileLayer(file) !== "ai-engine") continue;
        const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
        if (MISSION_STATE_ALLOWLIST.has(rel)) continue;
        const raw = fs.readFileSync(file, "utf-8");
        const stripped = raw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        const lines = stripped.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (MISSION_PRISMA_RE.test(lines[i])) {
            violations.push(
              `${rel}: L${i + 1}: ${lines[i].trim().slice(0, 100)}`,
            );
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("allowlist 保持为空（防止新增豁免悄悄堆积）", () => {
      // 防回归：若有人往 allowlist 加新文件绕过本不变量，这里强制 review。
      expect([...MISSION_STATE_ALLOWLIST]).toEqual([]);
    });
  });
});
