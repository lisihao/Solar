#!/usr/bin/env tsx
/**
 * UI Token Audit — 设计 token 纪律扫描
 *
 * 检测前端绕过 Tailwind / CSS 变量 token 的违规。
 * 配套方案文档：docs/guides/testing/frontend-ui-validation.md
 * 基线日期：2026-05-18（首次扫描）
 *
 * 5 类违规：
 *   T1  text-[Npx]    任意字号（应使用 text-xs/sm/base/lg）
 *   T2  w-[*]/h-[*]   任意尺寸（白名单：含 % / vh / vw / calc / CSS var 视为动态）
 *   T3  style={{...}} 静态内联样式（动态属性如 width:{N}% 视为合理）
 *   T4  rgb/rgba/hsl( 硬编码颜色（白名单：globals.css / tailwind.config.ts）
 *   T5  gap-*.5/py-*.5 等节奏外间距（容忍 .5 但报数）
 *
 * 报告模式：默认 exit 0，--strict 时违规超基线 exit 1。
 *
 * 用法：
 *   npm run audit:ui-tokens
 *   tsx scripts/audit-ui-tokens.ts --strict
 *   tsx scripts/audit-ui-tokens.ts --update-baseline
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { existsSync } from "node:fs";

const FRONTEND_ROOT = join(process.cwd(), "frontend");
const ARGS = new Set(process.argv.slice(2));
const STRICT = ARGS.has("--strict");
const BASELINE_PATH = (() => {
  const idx = process.argv.indexOf("--baseline");
  return idx > 0
    ? process.argv[idx + 1]
    : "docs/_archive/ui-tokens-baseline.json";
})();

const EXCLUDE_PATTERNS = [
  "node_modules",
  ".next",
  "components/admin/",
  "components/ai-office/slides/", // 独立 token 域
  "__tests__",
  ".test.",
  ".spec.",
  ".stories.",
];

function shouldSkip(file: string): boolean {
  const norm = file.split(sep).join("/");
  return EXCLUDE_PATTERNS.some((p) => norm.includes(p));
}

async function walkDir(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.(tsx|jsx|ts)$/.test(e.name)) continue;
    const full = join(e.parentPath ?? dir, e.name);
    if (shouldSkip(full)) continue;
    out.push(full);
  }
  return out;
}

interface Sample {
  file: string;
  line: number;
  snippet: string;
}

interface RuleResult {
  count: number;
  samples: Sample[];
}

function scan(
  src: string,
  file: string,
  re: RegExp,
  filter?: (match: string) => boolean,
): Sample[] {
  const out: Sample[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = line.matchAll(re);
    for (const m of matches) {
      if (filter && !filter(m[0])) continue;
      out.push({
        file: relative(process.cwd(), file),
        line: i + 1,
        snippet: line.trim().slice(0, 140),
      });
    }
  }
  return out;
}

// T1: text-[Npx]
const T1_RE = /\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g;

// T2: w-[*] / h-[*] / max-w-[*] / min-w-[*] / max-h-[*] / min-h-[*]
//     白名单：含 % / vh / vw / calc / var( 视为动态合理
const T2_RE = /\b(?:max-|min-)?[wh]-\[([^\]]+)\]/g;
function T2_isStatic(match: string): boolean {
  const inner = match.replace(/^[\w-]+\[/, "").replace(/\]$/, "");
  if (/%|vh|vw|calc\(|var\(|fit-content|min-content|max-content/.test(inner))
    return false;
  return true;
}

// T3: 内联 style={{...}}
//     启发式：扫 style={{ 之后是否含字面量颜色 / size 字符串
//     白名单：width:`${N}%` / height:N / transform / 变量赋值
const T3_RE = /style\s*=\s*\{\{[^}]+\}\}/g;
function T3_isStaticLiteral(match: string): boolean {
  // 含模板字符串 / 变量引用 / 三元 / 函数调用 → 动态
  if (/\$\{|`|\?|\.|\(|\+/.test(match)) return false;
  // 全是字面量
  return /:\s*['"`]/.test(match) || /:\s*\d/.test(match);
}

// T4: rgb/rgba/hsl/hsla 硬编码（排除注释）
const T4_RE = /\b(rgb|rgba|hsl|hsla)\(\s*\d/g;

// T5: 节奏外半步刻度（py-0.5 / gap-1.5 / p-2.5 等 .5 步长）
// 注：p-5/p-7/p-9 是 Tailwind 标准刻度（非 4 倍数但合法），不算违规
const T5_RE = /\b(?:p|m|gap)[xytrlb]?-(?:0\.5|1\.5|2\.5|3\.5)\b/g;

// T6: feature 代码硬编码「模块识别色渐变」（from-/via-/to-{hue}-{400..700}）。
//     模块识别色必须走 lib/design/module-themes（侧边栏/hero/详情头部）或 --primary，
//     不得在 feature 里写死，否则切模块色系全得手改、必然漂移。
//     范围排除 canonical 层（components/ui/，允许定义色板）与 SSOT（module-themes.ts）。
//     ★ 焊死规则：超基线即拒推（不需 --strict），守住 2026-05-22 模块色系成果。
const T6_RE =
  /\b(?:from|via|to)-(?:violet|purple|fuchsia|rose|pink|indigo|blue|sky|cyan|teal|emerald|green|lime|amber|orange|red|yellow)-(?:400|500|600|700)\b/g;
function isModuleColorCanonicalLayer(file: string): boolean {
  const norm = file.split(sep).join("/");
  return (
    norm.includes("/components/ui/") ||
    norm.includes("/lib/design/module-themes") ||
    norm.includes("/lib/design/tokens")
  );
}

async function main() {
  console.log("[audit:ui-tokens] 扫描 frontend/ 设计 token 纪律违规...");

  const files = await walkDir(FRONTEND_ROOT);
  console.log(`  扫描文件数：${files.length}`);

  const results: Record<string, RuleResult> = {
    "T1-text-arbitrary": { count: 0, samples: [] },
    "T2-size-arbitrary": { count: 0, samples: [] },
    "T3-inline-style-static": { count: 0, samples: [] },
    "T4-color-hardcoded": { count: 0, samples: [] },
    "T5-spacing-off-rhythm": { count: 0, samples: [] },
    "T6-module-gradient-hardcoded": { count: 0, samples: [] },
  };

  for (const file of files) {
    let src: string;
    try {
      src = await readFile(file, "utf8");
    } catch {
      continue;
    }

    const t1 = scan(src, file, T1_RE);
    const t2 = scan(src, file, T2_RE, T2_isStatic);
    const t3 = scan(src, file, T3_RE, T3_isStaticLiteral);
    const t4 = scan(src, file, T4_RE);
    const t5 = scan(src, file, T5_RE);
    const t6 = isModuleColorCanonicalLayer(file)
      ? []
      : scan(src, file, T6_RE);

    results["T1-text-arbitrary"].count += t1.length;
    results["T1-text-arbitrary"].samples.push(...t1);
    results["T2-size-arbitrary"].count += t2.length;
    results["T2-size-arbitrary"].samples.push(...t2);
    results["T3-inline-style-static"].count += t3.length;
    results["T3-inline-style-static"].samples.push(...t3);
    results["T4-color-hardcoded"].count += t4.length;
    results["T4-color-hardcoded"].samples.push(...t4);
    results["T5-spacing-off-rhythm"].count += t5.length;
    results["T5-spacing-off-rhythm"].samples.push(...t5);
    results["T6-module-gradient-hardcoded"].count += t6.length;
    results["T6-module-gradient-hardcoded"].samples.push(...t6);
  }

  console.log("");
  console.log("── 违规汇总 ──");
  const summary: Record<string, number> = {};
  let total = 0;
  for (const [rule, r] of Object.entries(results)) {
    summary[rule] = r.count;
    total += r.count;
    console.log(`  ${rule}: ${r.count}`);
  }
  console.log(`  TOTAL: ${total}`);
  console.log("");

  // 打印 TOP 3 重灾区文件
  const fileCount = new Map<string, number>();
  for (const r of Object.values(results)) {
    for (const s of r.samples) {
      fileCount.set(s.file, (fileCount.get(s.file) ?? 0) + 1);
    }
  }
  const topFiles = [...fileCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  console.log("── 重灾区 TOP 8 文件 ──");
  for (const [f, c] of topFiles)
    console.log(`  ${c.toString().padStart(4)}  ${f}`);
  console.log("");

  // 打印每规则前 3 样本
  console.log("── 每规则样本（最多 3 条）──");
  for (const [rule, r] of Object.entries(results)) {
    if (r.samples.length === 0) continue;
    console.log(`\n  [${rule}]`);
    for (const s of r.samples.slice(0, 3)) {
      console.log(`    ${s.file}:${s.line}`);
      console.log(`      | ${s.snippet}`);
    }
  }
  console.log("");

  // 基线对比
  let baseline: Record<string, number> | null = null;
  if (existsSync(BASELINE_PATH)) {
    try {
      baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8")) as Record<
        string,
        number
      >;
    } catch {
      baseline = null;
    }
  }

  let regressions: string[] = [];
  if (baseline) {
    console.log("── 与基线对比 ──");
    for (const rule of Object.keys({ ...summary, ...baseline })) {
      const cur = summary[rule] ?? 0;
      const base = baseline[rule] ?? 0;
      const delta = cur - base;
      const tag = delta > 0 ? "↑" : delta < 0 ? "↓" : "·";
      console.log(
        `  ${tag} ${rule}: ${base} → ${cur} (${delta >= 0 ? "+" : ""}${delta})`,
      );
      if (delta > 0) regressions.push(`${rule}: ${base} → ${cur} (+${delta})`);
    }
    console.log("");
  } else {
    console.log(`(无基线文件 ${BASELINE_PATH}，本次为首次扫描)`);
    console.log("");
  }

  if (ARGS.has("--update-baseline")) {
    await writeFile(
      BASELINE_PATH,
      JSON.stringify(summary, null, 2) + "\n",
      "utf8",
    );
    console.log(`✓ 基线已更新：${BASELINE_PATH}`);
  }

  // ★ T6 焊死：模块识别色渐变只能走 module-themes / --primary，feature 新增即拒推
  //   （不依赖 --strict；--update-baseline 时不拦，那是有意接收当前存量）。
  const t6Base = baseline?.["T6-module-gradient-hardcoded"] ?? 0;
  const t6Cur = summary["T6-module-gradient-hardcoded"] ?? 0;
  if (
    !ARGS.has("--update-baseline") &&
    baseline != null &&
    t6Cur > t6Base
  ) {
    console.error(
      `✗ T6 模块识别色渐变回归（焊死规则）：${t6Base} → ${t6Cur} (+${t6Cur - t6Base})`,
    );
    console.error(
      "  feature 代码不得硬编码 from-/to-{hue}-{400..700} 渐变；",
    );
    console.error(
      "  走 lib/design/module-themes（侧边栏/hero/详情头部）或 --primary（AppShell 按路由注入）。",
    );
    process.exit(1);
  }

  if (STRICT && regressions.length > 0) {
    console.error("✗ UI tokens 回归（strict 模式）：");
    for (const r of regressions) console.error(`  ${r}`);
    process.exit(1);
  }

  console.log(
    STRICT ? "✓ 无回归" : "(T1–T5 warn-only；T6 模块识别色焊死)",
  );
}

main().catch((err) => {
  console.error("audit-ui-tokens failed:", err);
  process.exit(2);
});
