/**
 * Agent Team App — Harness Facade Contract Spec
 *
 * 2026-05-24 night (P22/Wave 4): agent team app (playground/social/radar)
 * 的 mission/** + api/** 文件**只能**通过 `@/modules/ai-harness/facade` 或
 * `@/modules/ai-engine/facade` 访问框架能力，禁止直接走 ai-harness / ai-engine
 * 内部子路径（teams/business-team/dispatcher/* 等）。
 *
 * 2026-05-24 night (P32 审计修补):
 *   - P0-4: 扫描范围从 mission/{pipeline,lifecycle} 扩到整棵 mission/ 树 + api/
 *     （原来漏 agents/roles/services/rerun/context/api）
 *   - P1-3: 每个 app 加 files.length>0 保底断言，杜绝"目录不存在 → 空验证"
 *   - P1-4: import 命中改用 normalize（先剥 ./ ../ @/ modules/）而非要求
 *     `modules/` 字面段，纯相对路径 `../../../../ai-harness/...` 也能拦
 *
 * 为什么不光靠 ESLint？
 *   - ESLint SECTION 10 已覆盖 ai-app/** 不得 import ai-harness 内部
 *   - 但 ESLint 不查动态 `import("...")` 和注释 escape，本 spec 用 regex
 *     抽所有 import 语句（含 dynamic + require）保底
 *   - 同时本 spec 是"contract 文档"：未来 reviewer 看 spec 就知道契约
 *
 * 例外：
 *   - *.module.ts 装配 NestJS provider 可能装配具体 harness module class
 *     （facade re-export 类型不能装配） —— 排除
 *   - test 文件允许直接 mock 内部路径 —— 排除
 *   - facade / abstractions / *.module 入口 —— 合法
 */

import * as fs from "fs";
import * as path from "path";

const APP_ROOT = path.resolve(__dirname, "../../../modules/ai-app");
const AGENT_TEAM_APPS = ["playground", "social", "radar"];

/** 每个 app 内要扫的顶层目录（运行时业务 + API 边界）。 */
const SCAN_TOP_DIRS = ["mission", "api"];

function listTsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (
        e.name === "__tests__" ||
        e.name === "node_modules" ||
        e.name === "dist"
      )
        continue;
      listTsFiles(full, acc);
    } else if (
      e.isFile() &&
      e.name.endsWith(".ts") &&
      !e.name.endsWith(".spec.ts") &&
      !e.name.endsWith(".test.ts") &&
      !e.name.endsWith(".d.ts") &&
      !e.name.endsWith(".module.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/** 收集一个 app 在 SCAN_TOP_DIRS 下的全部业务 .ts 文件。 */
function collectAppFiles(app: string): string[] {
  const acc: string[] = [];
  for (const top of SCAN_TOP_DIRS) {
    listTsFiles(path.join(APP_ROOT, app, top), acc);
  }
  return acc;
}

function extractImportTargets(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  const targets: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    targets.push(m[1]);
  }
  return targets;
}

/**
 * 归一化 import target，剥掉相对前缀 / 别名前缀 / modules 段，
 * 使 `@/modules/ai-harness/x`、`../../../../ai-harness/x`、
 * `modules/ai-harness/x` 都归到 `ai-harness/x` 同一形态。
 */
function normalizeTarget(spec: string): string {
  return spec
    .replace(/^(?:\.\.?\/)+/, "") // 剥 ./ ../ ../../
    .replace(/^@\//, "") // 剥 @/
    .replace(/^modules\//, ""); // 剥 modules/
}

/** 合法入口：facade / abstractions / *.module。 */
function isAllowedEntry(sub: string): boolean {
  return (
    sub === "facade" ||
    sub.startsWith("facade/") ||
    sub.startsWith("abstractions/") ||
    /\.module(\.ts)?$/.test(sub)
  );
}

/** 命中 ai-harness 内部穿透 → 返回违规子路径或 null。 */
function detectHarnessInternalImport(spec: string): string | null {
  const norm = normalizeTarget(spec);
  if (!norm.startsWith("ai-harness/")) return null;
  const sub = norm.slice("ai-harness/".length);
  return isAllowedEntry(sub) ? null : sub;
}

/** 命中 ai-engine 内部穿透 → 返回违规子路径或 null。 */
function detectEngineInternalImport(spec: string): string | null {
  const norm = normalizeTarget(spec);
  if (!norm.startsWith("ai-engine/")) return null;
  const sub = norm.slice("ai-engine/".length);
  return isAllowedEntry(sub) ? null : sub;
}

describe("Agent Team App — Harness Facade Contract", () => {
  describe.each(AGENT_TEAM_APPS)(
    "%s mission/** + api/** 只走 facade",
    (app) => {
      const files = collectAppFiles(app);

      it("扫描到目标文件（不能 0 个，否则白验证）", () => {
        expect(files.length).toBeGreaterThan(0);
      });

      it("无 ai-harness 内部穿透 import", () => {
        const violations: string[] = [];
        for (const f of files) {
          for (const target of extractImportTargets(f)) {
            const sub = detectHarnessInternalImport(target);
            if (sub) {
              const rel = path.relative(APP_ROOT, f).replace(/\\/g, "/");
              violations.push(`${rel} → ai-harness/${sub}`);
            }
          }
        }
        expect(violations).toEqual([]);
      });

      it("无 ai-engine 内部穿透 import", () => {
        const violations: string[] = [];
        for (const f of files) {
          for (const target of extractImportTargets(f)) {
            const sub = detectEngineInternalImport(target);
            if (sub) {
              const rel = path.relative(APP_ROOT, f).replace(/\\/g, "/");
              violations.push(`${rel} → ai-engine/${sub}`);
            }
          }
        }
        expect(violations).toEqual([]);
      });
    },
  );
});
