/**
 * 架构债周期审计脚本（2026-05-04 落地）
 *
 * 用途：每周/每日自动扫架构债，输出可读报告。与 layer-boundaries.spec 互补：
 *   - spec 拦"新增"违规（每个 PR 阻断回归）
 *   - 本脚本扫"存量"违规（god class / shim / 死代码 / TODO 长尾），
 *     给出指标 + 趋势，让架构债可量化、可追踪。
 *
 * 用法：
 *   npm run audit:debt              # 输出表格到 stdout
 *   npm run audit:debt -- --json    # JSON 输出（CI 用）
 *   npm run audit:debt -- --strict  # 任一指标超 SLO 即 exit 1
 *
 * SLO（架构债红线）：
 *   - god class（≥ 2500 行）≤ 5 个
 *   - shim 文件（行数 < 5 + 全 export-from）≤ 0
 *   - business-name 残留 ALLOWLIST 条目 ≤ 5
 *   - any 类型业务代码 ≤ 30
 *   - TODO / FIXME / HACK 长尾 ≤ 400
 */

import * as fs from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../src");

interface AuditMetric {
  readonly name: string;
  readonly value: number;
  readonly slo: number;
  readonly samples?: ReadonlyArray<string>;
}

// ────────────────────────────────────────────────────────────
// 1. God class 扫描（≥ 2500 行）
// ────────────────────────────────────────────────────────────

function scanGodClasses(): AuditMetric {
  const GOD_CLASS_THRESHOLD = 2500;
  const samples: Array<{ path: string; lines: number }> = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !["__tests__", "node_modules", "dist", "_archive"].includes(entry.name)
      ) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        const text = fs.readFileSync(full, "utf-8");
        const lines = text.split("\n").length;
        if (lines >= GOD_CLASS_THRESHOLD) {
          samples.push({
            path: path.relative(SRC_ROOT, full).replace(/\\/g, "/"),
            lines,
          });
        }
      }
    }
  }
  walk(path.join(SRC_ROOT, "modules"));
  samples.sort((a, b) => b.lines - a.lines);

  return {
    name: "god-class (≥2500 lines)",
    value: samples.length,
    slo: 5,
    samples: samples.slice(0, 10).map((s) => `${s.lines}行 ${s.path}`),
  };
}

// ────────────────────────────────────────────────────────────
// 2. Shim 文件扫描（< 5 行 + 全是 export-from）
// ────────────────────────────────────────────────────────────

function scanShimFiles(): AuditMetric {
  const samples: string[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !["__tests__", "node_modules", "dist", "_archive"].includes(entry.name)
      ) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".d.ts") &&
        entry.name !== "index.ts" && // index barrel 不算 shim
        !entry.name.endsWith(".exports.ts") // exports/*.exports.ts SDK barrel 不算
      ) {
        const text = fs.readFileSync(full, "utf-8").trim();
        const lines = text.split("\n").filter((l) => l.trim().length > 0);
        // 形如：单行 `export * from "./xxx"` 的 shim
        if (
          lines.length <= 2 &&
          lines.every(
            (l) =>
              /^export\s+\*\s+from\s+["'].+["'];?$/.test(l) ||
              /^export\s+\{[^}]*\}\s+from\s+["'].+["'];?$/.test(l),
          )
        ) {
          samples.push(path.relative(SRC_ROOT, full).replace(/\\/g, "/"));
        }
      }
    }
  }
  walk(path.join(SRC_ROOT, "modules"));
  walk(path.join(SRC_ROOT, "plugins"));

  return {
    name: "shim 文件（≤2 行 export-from）",
    value: samples.length,
    slo: 0,
    samples: samples.slice(0, 10),
  };
}

// ────────────────────────────────────────────────────────────
// 3. business-name 残留扫描（base-layer 中提及具体 ai-app 名）
// ────────────────────────────────────────────────────────────

function scanBusinessNameLeakage(): AuditMetric {
  const PATTERN =
    /\b(agent-playground|topic-insights|topic-report|playground)\b/i;
  const samples: string[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !["__tests__", "node_modules", "dist", "_archive"].includes(entry.name)
      ) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".spec.ts")
      ) {
        const rel = path.relative(SRC_ROOT, full).replace(/\\/g, "/");
        // 仅 base layer
        if (
          !(
            rel.startsWith("modules/ai-engine/") ||
            rel.startsWith("modules/ai-harness/") ||
            rel.startsWith("modules/ai-infra/") ||
            rel.startsWith("plugins/")
          )
        )
          continue;
        const text = fs.readFileSync(full, "utf-8");
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.includes("@migrated-from")) continue;
          if (PATTERN.test(line)) {
            samples.push(rel);
            break;
          }
        }
      }
    }
  }
  walk(path.join(SRC_ROOT, "modules"));
  walk(path.join(SRC_ROOT, "plugins"));

  return {
    name: "base-layer 业务名泄漏",
    value: samples.length,
    slo: 5, // 含 credits/policy 业务设计豁免
    samples: samples.slice(0, 10),
  };
}

// ────────────────────────────────────────────────────────────
// 4. 业务代码 any 类型扫描（排除合理边界擦除）
// ────────────────────────────────────────────────────────────

function scanAnyTypes(): AuditMetric {
  const samples: string[] = [];
  // 业务代码白名单：不在边界端口 / 测试夹具
  const SKIP_PATHS = [
    "facade/abstractions/runtime-deps.tokens", // duck-typed 边界
    "abstractions/", // 端口接口允许 any
  ];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !["__tests__", "node_modules", "dist", "_archive"].includes(entry.name)
      ) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        const rel = path.relative(SRC_ROOT, full).replace(/\\/g, "/");
        if (SKIP_PATHS.some((skip) => rel.includes(skip))) continue;
        const text = fs.readFileSync(full, "utf-8");
        if (/:\s+any\b|\bas\s+any\b|<any>/.test(text)) {
          samples.push(rel);
        }
      }
    }
  }
  walk(path.join(SRC_ROOT, "modules"));

  return {
    name: "any 类型业务代码",
    value: samples.length,
    slo: 30,
    samples: samples.slice(0, 10),
  };
}

// ────────────────────────────────────────────────────────────
// 5. TODO / FIXME 长尾
// ────────────────────────────────────────────────────────────

function scanTodos(): AuditMetric {
  let count = 0;
  const samples: string[] = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !["__tests__", "node_modules", "dist", "_archive"].includes(entry.name)
      ) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        const text = fs.readFileSync(full, "utf-8");
        const matches = text.match(/\b(TODO|FIXME|XXX)\b/g);
        if (matches) {
          count += matches.length;
          if (samples.length < 5) {
            samples.push(path.relative(SRC_ROOT, full).replace(/\\/g, "/"));
          }
        }
      }
    }
  }
  walk(path.join(SRC_ROOT, "modules"));

  return {
    name: "TODO / FIXME / XXX 长尾",
    value: count,
    slo: 400,
    samples,
  };
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// 6. 散点 antipattern 扫描（task #19，2026-05-05）
// ────────────────────────────────────────────────────────────

function readAllTsFiles(): Array<{ rel: string; abs: string; text: string }> {
  const files: Array<{ rel: string; abs: string; text: string }> = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        !["__tests__", "node_modules", "dist", "_archive"].includes(entry.name)
      ) {
        walk(full);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".spec.ts") &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push({
          rel: path.relative(SRC_ROOT, full).replace(/\\/g, "/"),
          abs: full,
          text: fs.readFileSync(full, "utf-8"),
        });
      }
    }
  }
  walk(SRC_ROOT);
  return files;
}

function scanNakedAbortListeners(): AuditMetric {
  const samples: string[] = [];
  for (const f of readAllTsFiles()) {
    if (f.rel.endsWith("abortable-scope.ts")) continue;
    const hasAdd = /\.addEventListener\s*\(\s*['"]abort['"]/.test(f.text);
    if (!hasAdd) continue;
    const hasRemove = /\.removeEventListener\s*\(\s*['"]abort['"]/.test(f.text);
    if (!hasRemove) samples.push(f.rel);
  }
  return {
    name: "AbortSignal listener 无配对 cleanup",
    value: samples.length,
    slo: 0,
    samples,
  };
}

function scanRawAxiosImports(): AuditMetric {
  const samples: string[] = [];
  for (const f of readAllTsFiles()) {
    if (
      /import\s+(?:[^;]+from\s+)?['"]axios['"]/.test(f.text) ||
      /from\s+['"]axios['"]/.test(f.text)
    ) {
      samples.push(f.rel);
    }
  }
  return {
    name: "axios 直接 import (应走 HttpService)",
    value: samples.length,
    slo: 30, // 当前基线，不允许新增
    samples: samples.slice(0, 5),
  };
}

function scanProcessEnvSecretReturn(): AuditMetric {
  const SENSITIVE =
    /return\s+process\.env\.[A-Z_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z_]*\s*(?:\|\|[^;\n]+)?\s*[;\n]/;
  const samples: string[] = [];
  for (const f of readAllTsFiles()) {
    if (!f.rel.endsWith(".controller.ts")) continue;
    if (SENSITIVE.test(f.text)) samples.push(f.rel);
  }
  return {
    name: "controller 直接 return 敏感 env (S1)",
    value: samples.length,
    slo: 0,
    samples,
  };
}

function scanAgentSpecMissingBudget(): AuditMetric {
  const samples: string[] = [];
  for (const f of readAllTsFiles()) {
    if (!f.rel.endsWith(".agent.ts")) continue;
    const hasSpec = /@Spec\s*\(\s*\{[\s\S]*?\}\s*\)/.test(f.text);
    if (!hasSpec) continue;
    if (!/budget\s*:/.test(f.text)) samples.push(f.rel);
  }
  return {
    name: "agent spec 缺 budget 配置",
    value: samples.length,
    slo: 0,
    samples,
  };
}

function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const isStrict = args.includes("--strict");

  const metrics = [
    scanGodClasses(),
    scanShimFiles(),
    scanBusinessNameLeakage(),
    scanAnyTypes(),
    scanTodos(),
    // ★ 2026-05-05 [task #19] 散点 antipattern 维度
    scanNakedAbortListeners(),
    scanRawAxiosImports(),
    scanProcessEnvSecretReturn(),
    scanAgentSpecMissingBudget(),
  ];

  if (isJson) {
    console.log(
      JSON.stringify({ timestamp: new Date().toISOString(), metrics }, null, 2),
    );
  } else {
    console.log(
      "\n架构债审计报告（" + new Date().toISOString().slice(0, 10) + "）\n",
    );
    console.log("┌─────────────────────────────────────┬──────┬──────┬──────┐");
    console.log("│ 指标                                │ 实际 │ SLO  │ 状态 │");
    console.log("├─────────────────────────────────────┼──────┼──────┼──────┤");
    for (const m of metrics) {
      const status = m.value <= m.slo ? "✓ 绿" : "✗ 红";
      const namePadded = m.name.padEnd(35);
      console.log(
        `│ ${namePadded} │ ${String(m.value).padStart(4)} │ ${String(m.slo).padStart(4)} │ ${status}  │`,
      );
    }
    console.log(
      "└─────────────────────────────────────┴──────┴──────┴──────┘\n",
    );

    for (const m of metrics) {
      if (m.value > m.slo && m.samples && m.samples.length > 0) {
        console.log(`违规样本（${m.name}）:`);
        for (const s of m.samples) console.log(`  - ${s}`);
        console.log("");
      }
    }
  }

  if (isStrict) {
    const violations = metrics.filter((m) => m.value > m.slo);
    if (violations.length > 0) {
      process.exit(1);
    }
  }
}

main();
