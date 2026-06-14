#!/usr/bin/env tsx
/**
 * AI-App Docs Portal Guard —— admin AI 应用概览 与 docs 文件夹 覆盖看护
 *
 * 原则（与 tool-categories 同脉络，前后端单源 + 看护）：
 *   admin AI 应用概览（frontend/lib/features/admin/ai-app-categories.ts）是
 *   docs/architecture/ai-app/ 的策划门户。每个 ai-app 文档文件夹必须：
 *     - 被某个类目的 module.docCandidates 引用（已露出），或
 *     - 在 EXCLUDED 名单显式排除（infra/后台文档，有意不进"AI Apps"概览）。
 *   否则 = 新增了 app 文档却没人挂上去 → 概览与实际漂移 → exit 1。
 *
 * 同时校验：docCandidates 指向的文件真实存在（防死链）。
 *
 * 用法：npm run audit:ai-app-docs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, "docs/architecture/ai-app");
const FE = join(ROOT, "frontend/lib/features/admin/ai-app-categories.ts");

// 显式排除：有文档但有意不进"AI Apps"概览（infra / 后台 / 凭证类）。
// 新增排除项必须在此登记并写明理由。
const EXCLUDED = new Set<string>([
  "byok", // 凭证/密钥策略文档，归 admin 密钥管理，不属"AI Apps"
  "management", // 后台管理功能文档（features-admin），非用户向 app
]);

function topLevelDocFolders(): string[] {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR).filter((n) =>
    statSync(join(DOCS_DIR, n)).isDirectory(),
  );
}

function parseFrontend(): { docPaths: string[] } {
  const src = readFileSync(FE, "utf8");
  // 抓所有 docCandidates 字符串项
  const docPaths: string[] = [];
  const re = /docCandidates:\s*\[([^\]]*)\]/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    for (const s of m[1].match(/'[^']+'/g) || [])
      docPaths.push(s.replace(/'/g, ""));
  }
  return { docPaths };
}

function main() {
  const folders = topLevelDocFolders();
  const { docPaths } = parseFrontend();

  // 已露出的文件夹 = 任一 docCandidate 路径首段命中该文件夹
  const surfaced = new Set(docPaths.map((p) => p.split("/")[0]));

  const missing = folders.filter((f) => !surfaced.has(f) && !EXCLUDED.has(f));

  // 死链：docCandidates 指向不存在的文件
  const deadLinks = docPaths.filter((p) => !existsSync(join(DOCS_DIR, p)));

  if (missing.length === 0 && deadLinks.length === 0) {
    const surfacedCount = folders.filter((f) => surfaced.has(f)).length;
    const excludedCount = folders.filter((f) => EXCLUDED.has(f)).length;
    console.log(
      `[audit:ai-app-docs] AI 应用概览覆盖完整 ✓（${folders.length} 个文档文件夹：${surfacedCount} 露出 / ${excludedCount} 显式排除）`,
    );
    return;
  }

  console.error("============================================================");
  console.error("  [audit:ai-app-docs] AI 应用概览与 docs 文件夹不一致");
  console.error("============================================================");
  if (missing.length) {
    console.error(`  ✘ ${missing.length} 个 app 文档文件夹未露出也未排除：`);
    for (const f of missing) console.error(`      ${f}`);
    console.error("");
    console.error("    → 在 ai-app-categories.ts 给对应类目加 module（含 docCandidates），");
    console.error("      或在本看护 EXCLUDED 登记排除理由。");
  }
  if (deadLinks.length) {
    console.error(`  ✘ ${deadLinks.length} 条 docCandidates 死链（文件不存在）：`);
    for (const p of deadLinks) console.error(`      ${p}`);
  }
  console.error("============================================================");
  process.exit(1);
}

main();
