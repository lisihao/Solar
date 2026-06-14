#!/usr/bin/env tsx
/**
 * audit-i18n-placeholders.ts —— i18n 单花括号守护脚本
 *
 * 起因：2026-05-18 PR-DR2-FU 发现项目 i18n interpolate 函数（i18n-context.tsx:61）
 * 用 /\{\{(\w+)\}\}/g 双花括号匹配，但既有 keys 大量混用单花括号 `{name}`。
 * 单花括号写法下 t(key, { name: 'X' }) 不替换，文案显示 `{name}` 字面。
 *
 * 本脚本扫描 zh.json + en.json，发现任何 string value 含
 *   (?<!\{)\{[a-zA-Z_]\w*\}(?!\})
 * 模式即报错退出 1（CI 拦截），强制开发者用双花括号。
 *
 * 用法：
 *   tsx scripts/utils/audit-i18n-placeholders.ts
 *
 * 也可在 lint-staged / pre-commit 钩子中调用。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = join(
  process.cwd(),
  "frontend/lib/i18n/locales",
);
const FILES = ["zh.json", "en.json"];
const SINGLE_BRACE_RE = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g;

interface Finding {
  file: string;
  path: string;
  value: string;
  matches: string[];
}

function walk(
  obj: unknown,
  pathParts: string[],
  findings: Finding[],
  file: string,
): void {
  if (typeof obj === "string") {
    const matches = obj.match(SINGLE_BRACE_RE);
    if (matches && matches.length > 0) {
      findings.push({
        file,
        path: pathParts.join("."),
        value: obj,
        matches,
      });
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walk(v, [...pathParts, String(i)], findings, file));
    return;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      walk(v, [...pathParts, k], findings, file);
    }
  }
}

const findings: Finding[] = [];
for (const f of FILES) {
  const fp = join(LOCALES_DIR, f);
  const json: unknown = JSON.parse(readFileSync(fp, "utf8"));
  walk(json, [], findings, f);
}

if (findings.length === 0) {
  console.log("[i18n-audit] 0 single-brace placeholders found");
  process.exit(0);
}

console.error(
  `[i18n-audit] FAIL — ${findings.length} keys still use single-brace placeholders:\n`,
);
for (const f of findings) {
  console.error(`  ${f.file} :: ${f.path}`);
  console.error(`    value: ${f.value}`);
  console.error(`    matches: ${f.matches.join(", ")}`);
  console.error(`    fix: change ${f.matches.join(",")} → ${f.matches.map((m) => `{${m}}`).join(",")}`);
  console.error("");
}
console.error(
  "How to fix: change `{xxx}` to `{{xxx}}` (project i18n uses double-brace). " +
    "See frontend/lib/i18n/i18n-context.tsx:61",
);
process.exit(1);
