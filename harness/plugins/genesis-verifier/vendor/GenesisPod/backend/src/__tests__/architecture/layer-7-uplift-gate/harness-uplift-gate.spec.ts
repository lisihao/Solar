/**
 * harness-uplift-gate.spec.ts —— Harness uplift gate（ARCHITECTURE_RULES §4 / 硬规则 #7）
 *
 * 规则：harness/teams/business-team/ 下的 framework / helper / contract 文件，
 * 必须有 ≥2 个 mission app 实际 import（playground / social / radar / future）。
 *
 * 防止：
 *   - 把单一 app 的逻辑 "提前" 上提到 harness 形成空壳
 *   - 形成 0 consumer 的死代码（如 handoffs/ 这种 — 见 E008 例外）
 *
 * 例外：登记在 EXCEPTIONS.md（E008 等），通过 EXEMPT_PATHS 路径白名单豁免。
 *
 * 检查方式：
 *   1. 遍历 business-team/ 下所有 .ts （排除 __tests__/ / bindings/ / abstractions/）
 *   2. 对每个文件 grep ai-app/<app>/ 路径下的 import 出现次数
 *   3. 统计 distinct app 数；< 2 标记 violation
 */

import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..", "..");
const HARNESS_KERNEL = path.join(
  PROJECT_ROOT,
  "src/modules/ai-harness/teams/business-team",
);
const AI_APP_ROOT = path.join(PROJECT_ROOT, "src/modules/ai-app");

/**
 * 例外白名单：登记在 EXCEPTIONS.md（E013 = 当前 B6 baseline）。
 *
 * 现状：B6 把 ~19 个 framework 从 playground 上提到 harness/business-team/。
 * 当前 social / radar 还没全部接入，导致 single-consumer。
 * 不算 regression（B6 提议刚落地），但**新增**文件必须 ≥2 consumer。
 *
 * 改动需配套修改 EXCEPTIONS.md E013。
 */
const EXEMPT_PATHS: ReadonlySet<string> = new Set<string>([
  // E013 baseline (B6 uplift completed but social/radar adoption pending)
  "src/modules/ai-harness/teams/business-team/state/business-team-cross-stage-state.framework.ts",
  "src/modules/ai-harness/teams/business-team/span/business-team-mission-span.framework.ts",
  "src/modules/ai-harness/teams/business-team/rerun/business-team-ctx-hydrator.framework.ts",
  "src/modules/ai-harness/teams/business-team/rerun/business-team-rerun-guard.framework.ts",
  "src/modules/ai-harness/teams/business-team/rerun/business-team-rerun-orchestrator.framework.ts",
  "src/modules/ai-harness/teams/business-team/rerun/business-team-rerun-runtime-builder.framework.ts",
  "src/modules/ai-harness/teams/business-team/rerun/business-team-stage-rerun-dispatcher.framework.ts",
  "src/modules/ai-harness/teams/business-team/rerun/heartbeat-decision.ts",
  "src/modules/ai-harness/teams/business-team/lifecycle/business-team-checkpoint-store.framework.ts",
  "src/modules/ai-harness/teams/business-team/lifecycle/business-team-event-categories.ts",
  "src/modules/ai-harness/teams/business-team/lifecycle/business-team-lifecycle-transitions.framework.ts",
  "src/modules/ai-harness/teams/business-team/lifecycle/business-team-mission-store.framework.ts",
  "src/modules/ai-harness/teams/business-team/lifecycle/business-team-postmortem-helper.framework.ts",
  "src/modules/ai-harness/teams/business-team/lifecycle/business-team-report-helper.framework.ts",
  "src/modules/ai-harness/teams/business-team/lifecycle/business-team-update-helper.framework.ts",
  "src/modules/ai-harness/teams/business-team/invocation/business-team-dag-concurrency.ts",
  "src/modules/ai-harness/teams/business-team/helpers/business-team-axis-grade-grounding.helper.ts",
  "src/modules/ai-harness/teams/business-team/helpers/business-team-batch-executor.helper.ts",
  "src/modules/ai-harness/teams/business-team/helpers/business-team-supply-budget.helper.ts",
]);

/**
 * 已知 mission app 名 —— 用于识别 consumer 所属 app。
 * 新 app 加进来后此处也要扩展。
 */
const MISSION_APPS = ["playground", "social", "radar"] as const;

function listHarnessFiles(): string[] {
  if (!fs.existsSync(HARNESS_KERNEL)) return [];
  const out: string[] = [];
  const stack: string[] = [HARNESS_KERNEL];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        // 排除 __tests__ / bindings / abstractions（contract / interface 不算 uplift 实质代码）
        if (
          e.name === "__tests__" ||
          e.name === "bindings" ||
          e.name === "abstractions"
        )
          continue;
        if (e.name === "node_modules") continue;
        stack.push(full);
      } else if (e.isFile() && full.endsWith(".ts")) {
        if (full.endsWith(".spec.ts") || full.endsWith(".test.ts")) continue;
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * 列出 ai-app/<app>/ 下所有 .ts 文件，按 app 分组（spec/test 除外）。
 */
function listAppFilesByApp(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const app of MISSION_APPS) {
    const root = path.join(AI_APP_ROOT, app);
    if (!fs.existsSync(root)) continue;
    const collected: string[] = [];
    const stack: string[] = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(cur, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "__tests__") continue;
          stack.push(full);
        } else if (e.isFile() && full.endsWith(".ts")) {
          if (full.endsWith(".spec.ts") || full.endsWith(".test.ts")) continue;
          collected.push(full);
        }
      }
    }
    m.set(app, collected);
  }
  return m;
}

/**
 * harness file → exported symbol 名清单（class / function / type / const）。
 * App consumer 一定是用 `import { Foo } from '...harness/...'` 的 Foo 名字。
 * 所以 grep symbol 名比 grep 文件路径准确（DI / re-export 都能命中）。
 */
function extractExportedSymbols(filePath: string): string[] {
  let src: string;
  try {
    src = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  // 去注释
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const symbols = new Set<string>();
  // export class Foo / export abstract class Foo
  for (const m of stripped.matchAll(
    /\bexport\s+(?:abstract\s+)?class\s+(\w+)/g,
  )) {
    symbols.add(m[1]);
  }
  // export function foo / export async function foo
  for (const m of stripped.matchAll(
    /\bexport\s+(?:async\s+)?function\s+(\w+)/g,
  )) {
    symbols.add(m[1]);
  }
  // export interface Foo / export type Foo
  for (const m of stripped.matchAll(/\bexport\s+(?:interface|type)\s+(\w+)/g)) {
    symbols.add(m[1]);
  }
  // export const Foo / export enum Foo
  for (const m of stripped.matchAll(
    /\bexport\s+(?:const|enum|let|var)\s+(\w+)/g,
  )) {
    symbols.add(m[1]);
  }
  // export default class Foo
  for (const m of stripped.matchAll(
    /\bexport\s+default\s+(?:class|function)\s+(\w+)/g,
  )) {
    symbols.add(m[1]);
  }
  return Array.from(symbols);
}

function fileImportsAnySymbol(
  filePath: string,
  symbols: ReadonlyArray<string>,
): boolean {
  if (symbols.length === 0) return false;
  let src: string;
  try {
    src = fs.readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }
  for (const sym of symbols) {
    // 必须是 word boundary（避免 Foo 误命中 FooBar）
    const re = new RegExp(`\\b${sym}\\b`);
    if (re.test(src)) return true;
  }
  return false;
}

describe("§ harness uplift gate —— business-team kernel ≥ 2 mission app consumers", () => {
  const harnessFiles = listHarnessFiles();
  const appFilesByApp = listAppFilesByApp();

  it("发现至少 1 个 harness business-team 文件（防 spec 自身退化）", () => {
    expect(harnessFiles.length).toBeGreaterThan(0);
  });

  it("已知 mission app 至少 2 个（防 spec 自身退化）", () => {
    expect([...appFilesByApp.keys()].length).toBeGreaterThanOrEqual(2);
  });

  it("所有 harness business-team 文件至少有 2 个 mission app consumer（或登记 EXCEPTIONS.md）", () => {
    const violations: Array<{
      file: string;
      consumers: string[];
      symbols: string[];
    }> = [];
    for (const f of harnessFiles) {
      const rel = path.relative(PROJECT_ROOT, f).replace(/\\/g, "/");
      if (EXEMPT_PATHS.has(rel)) continue;
      const symbols = extractExportedSymbols(f);
      if (symbols.length === 0) continue; // 无 public export → 私有文件，不构成 uplift surface
      const consumers: string[] = [];
      for (const [app, files] of appFilesByApp.entries()) {
        const hit = files.some((appFile) =>
          fileImportsAnySymbol(appFile, symbols),
        );
        if (hit) consumers.push(app);
      }
      if (consumers.length < 2) {
        violations.push({ file: rel, consumers, symbols });
      }
    }
    if (violations.length > 0) {
      const msg = [
        `${violations.length} 个 harness business-team 文件 consumer < 2：`,
        ...violations.map(
          (v) =>
            `  - ${v.file}\n      consumers: ${v.consumers.join(",") || "(none)"}\n      symbols : ${v.symbols.slice(0, 3).join(",")}${v.symbols.length > 3 ? "..." : ""}`,
        ),
        ``,
        `策略：harness 只允许容纳 ≥2 app 共享的机制。如果文件仅被 1 个 app 用：`,
        `  (a) 改回该 app 自己的目录；或`,
        `  (b) 在 EXCEPTIONS.md 登记理由（多数应是 "待第二个 app 接入"），并加 EXEMPT_PATHS。`,
      ].join("\n");
      throw new Error(msg);
    }
    expect(violations).toEqual([]);
  });
});
