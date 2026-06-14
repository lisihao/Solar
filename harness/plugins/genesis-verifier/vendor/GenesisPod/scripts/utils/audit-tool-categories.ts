#!/usr/bin/env tsx
/**
 * Tool Categories Guard —— 工具分类"前后台统一"看护
 *
 * 原则（与 frontend/lib/features/admin/tool-categories.ts 头部一致）：
 *   单一真源 = 后端 ToolRegistry 注册的工具集。每个真实工具必须在前端
 *   toolId→细类映射中【有且仅有一个】归属（或在 EXCLUDED 名单）。
 *
 * 本脚本双向对账，杜绝漂移：
 *   [硬错] 后端真实 toolId 未登记进前端映射且不在 EXCLUDED → 掉'其他'/归错 tab
 *   [硬错] 同一 toolId 被登记到 >1 个分类 → 违反"有且仅有一个"
 *   [提示] 前端映射里既非真实工具、又非已知 provider 别名的 id → 可能是死条目
 *
 * 真源：
 *   后端 = backend/src/modules/ai-engine/tools/categories/ ** /*.tool.ts 的 `readonly id`
 *   前端 = frontend/lib/features/admin/tool-categories.ts 的 toolIds[] + EXCLUDED
 *
 * 用法：
 *   npm run audit:tool-categories      # 违规 exit 1
 *   tsx scripts/utils/audit-tool-categories.ts
 *
 * 新增后端工具后必须在前端映射登记归属，否则 pre-push / CI 拒绝。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TOOLS_DIR = join(
  ROOT,
  "backend/src/modules/ai-engine/tools/categories",
);
const FE_MAP = join(
  ROOT,
  "frontend/lib/features/admin/tool-categories.ts",
);

// ── 1. 后端真实 toolId（唯一真源）──────────────────────────────
function walkToolFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue;
      walkToolFiles(full, acc);
    } else if (name.endsWith(".tool.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function backendToolIds(): string[] {
  const ids = new Set<string>();
  for (const file of walkToolFiles(TOOLS_DIR)) {
    const text = readFileSync(file, "utf8");
    const m = text.match(/readonly id\s*=\s*["']([^"']+)["']/);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}

// ── 2. 前端映射：toolId → category[]，+ EXCLUDED ───────────────
function frontendMapping(): {
  toolToCats: Map<string, string[]>;
  excluded: Set<string>;
  allMapped: Set<string>;
} {
  const src = readFileSync(FE_MAP, "utf8");
  const toolToCats = new Map<string, string[]>();

  // 逐个 category 对象：抓 id: '...' 与其后最近的 toolIds: [...]
  const catRe = /id:\s*'([^']+)'[\s\S]*?toolIds:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = catRe.exec(src))) {
    const catId = m[1];
    const ids = (m[2].match(/'[^']+'/g) || []).map((s) => s.replace(/'/g, ""));
    for (const id of ids) {
      const arr = toolToCats.get(id) ?? [];
      arr.push(catId);
      toolToCats.set(id, arr);
    }
  }

  // EXCLUDED_FROM_GENERAL_TABS = new Set<string>([...])
  const exM = src.match(
    /EXCLUDED_FROM_GENERAL_TABS\s*=\s*new Set<string>\(\[([^\]]*)\]\)/,
  );
  const excluded = new Set<string>(
    exM ? (exM[1].match(/'[^']+'/g) || []).map((s) => s.replace(/'/g, "")) : [],
  );

  return { toolToCats, excluded, allMapped: new Set(toolToCats.keys()) };
}

// ── 3. 对账 ───────────────────────────────────────────────────
function main() {
  const realIds = backendToolIds();
  const { toolToCats, excluded, allMapped } = frontendMapping();

  const uncategorized: string[] = [];
  const multiMapped: string[] = [];

  for (const id of realIds) {
    if (excluded.has(id)) continue;
    const cats = toolToCats.get(id);
    if (!cats || cats.length === 0) {
      uncategorized.push(id);
    } else if (cats.length > 1) {
      multiMapped.push(`${id} → [${cats.join(", ")}]`);
    }
  }

  // 同一 toolId 跨分类重复（即便不是 realId 也算违规）
  for (const [id, cats] of toolToCats) {
    if (cats.length > 1 && !multiMapped.some((x) => x.startsWith(id + " ")))
      multiMapped.push(`${id} → [${cats.join(", ")}]`);
  }

  const realSet = new Set(realIds);
  const phantom = [...allMapped].filter(
    (id) => !realSet.has(id) && !excluded.has(id),
  );

  const hardFail = uncategorized.length > 0 || multiMapped.length > 0;

  if (!hardFail) {
    console.log(
      `[audit:tool-categories] 前后台统一 ✓（后端 ${realIds.length} 个工具全部归类，无重复）`,
    );
    if (phantom.length) {
      console.log(
        `  提示：${phantom.length} 个映射条目非后端工具（多为 provider 别名，正常）：${phantom.slice(0, 12).join(", ")}${phantom.length > 12 ? " …" : ""}`,
      );
    }
    return;
  }

  console.error("============================================================");
  console.error("  [audit:tool-categories] 工具分类漂移：前端映射与后端 registry 不一致");
  console.error("============================================================");
  if (uncategorized.length) {
    console.error(`  ✘ ${uncategorized.length} 个后端工具未登记（会掉'其他'/归错 tab）：`);
    for (const id of uncategorized) console.error(`      ${id}`);
    console.error("");
    console.error("    → 在 frontend/lib/features/admin/tool-categories.ts 把每个 toolId");
    console.error("      登记到对应分类的 toolIds[]（或加进 EXCLUDED_FROM_GENERAL_TABS）。");
  }
  if (multiMapped.length) {
    console.error(`  ✘ ${multiMapped.length} 个 toolId 归属 >1 个分类（必须唯一）：`);
    for (const x of multiMapped) console.error(`      ${x}`);
  }
  console.error("============================================================");
  process.exit(1);
}

main();
