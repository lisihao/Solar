#!/usr/bin/env node
/**
 * v3.1 阶段 F · Capability anti-pattern baseline audit
 *
 * 目的（baseline-lock 防新增）：
 *   - 全仓扫 ai-engine / ai-harness / ai-app 三层运行时代码（spec/test 豁免）
 *   - 用 TypeScript Compiler API 识别 provider/model substring 启发式 +
 *     `provider === '<name>'` 字面量判定（与 capability-provider-string-match
 *     .contract.spec.ts 同款 AST 形态 + 同款共享 normalize 求值器）
 *   - 输出当前命中数 + file:line 清单，与 .audit-baselines/capability-anti-patterns
 *     .json 基线对比
 *   - 命中数 > baseline.count 或 newKeys 非空（出现 baseline 没记录的新 file:line）
 *     → EXIT 1 拒推
 *   - 命中数 ≤ baseline.count 且无新增 key → EXIT 0
 *
 * 用法：
 *   node scripts/audit-capability-anti-patterns.cjs           # 对比 baseline
 *   node scripts/audit-capability-anti-patterns.cjs --print   # 仅打印命中清单
 *   node scripts/audit-capability-anti-patterns.cjs --write   # 写当前命中为新 baseline（首次/批量清扫后用）
 *   node scripts/audit-capability-anti-patterns.cjs --json    # 输出 JSON
 *
 * 与 contract spec 的分工：
 *   - contract spec（capability-provider-string-match.contract.spec.ts）：硬锁
 *     3 个 C/D 已清的决策文件零命中；ESLint AST 规则的 jest 兜底
 *   - 本 audit script：广扫全仓（含 TYPE B/C），baseline lock 防"新代码引入新启
 *     发式"。TYPE B/C 既有命中作为 baseline 入档，存量许可，新增即拒
 */

"use strict";

const fs = require("fs");
const path = require("path");

// 用 esbuild-register 临时跑 .ts 太重，直接用 typescript 包（dev dep 已装）
const ts = require("typescript");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.join(BACKEND_ROOT, "src");
const SCAN_ROOTS = [
  path.join(SRC_ROOT, "modules", "ai-engine"),
  path.join(SRC_ROOT, "modules", "ai-harness"),
  path.join(SRC_ROOT, "modules", "ai-app"),
];
const BASELINE_DIR = path.join(BACKEND_ROOT, ".audit-baselines");
const BASELINE_FILE = path.join(BASELINE_DIR, "capability-anti-patterns.json");

// ────────────────────────────────────────────────────────────────────────────
// FORBIDDEN_NAMES（与 capability-provider-string-match.contract.spec.ts 同步）
// 加宽到 v3.1 §5.5 第一档（最常见 14 个），覆盖 audit 范围
// ────────────────────────────────────────────────────────────────────────────
const FORBIDDEN_NAMES = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "gpt",
  "gpt-3",
  "gpt-4",
  "gpt-5",
  "claude",
  "gemini",
  "grok",
  "o1",
  "o3",
  "o4",
  "deepseek-reasoner",
  "deepseek-chat",
  "qwen",
  "llama",
  "imagen",
];

const HEURISTIC_METHODS = new Set([
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "search",
  "match",
]);

const EQ_OPERATORS = new Set(["===", "==", "!==", "!="]);

function normalize(s) {
  return s.toLowerCase().replace(/[-_.\s]/g, "");
}

const FORBIDDEN_NORMALIZED = new Set(FORBIDDEN_NAMES.map(normalize));

// normalize 后精确匹配 OR forbidden 是前缀且接 digit（与 capability-provider
// -string-match.contract.spec.ts 同款评估器，防 `gpt-4`/`Gpt_4O`/`Claude-3`
// 变形绕过的同时避免误伤 `gemini_response_schema` 类结构化输出枚举字面量）
function literalIsForbidden(value) {
  const n = normalize(value);
  for (const fb of FORBIDDEN_NORMALIZED) {
    if (n === fb) return true;
    if (n.startsWith(fb)) {
      const next = n.charCodeAt(fb.length);
      if (next >= 48 && next <= 57) return true;
    }
  }
  return false;
}

function tryEvalStaticString(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node) && node.templateSpans.length === 0) {
    return node.head.text;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const l = tryEvalStaticString(node.left);
    const r = tryEvalStaticString(node.right);
    if (l !== null && r !== null) return l + r;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 文件遍历（与 backend contract spec 同口径排除规则）
// ────────────────────────────────────────────────────────────────────────────
function listTsFiles(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "__tests__" ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "coverage" ||
        entry.name === "fixtures"
      ) {
        continue;
      }
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

// ────────────────────────────────────────────────────────────────────────────
// AST 扫描
// ────────────────────────────────────────────────────────────────────────────
function scanFile(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  const sf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const hits = [];
  const rel = path.relative(SRC_ROOT, filePath).replace(/\\/g, "/");

  function getLineCol(pos) {
    const lc = sf.getLineAndCharacterOfPosition(pos);
    return { line: lc.line + 1, column: lc.character + 1 };
  }

  function snippet(node) {
    const start = node.getStart(sf);
    const end = Math.min(node.getEnd(), start + 80);
    return text.slice(start, end).replace(/\s+/g, " ");
  }

  function visit(node) {
    // 反模式 1: x.includes("gpt") / x.startsWith("o1") / ...
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      HEURISTIC_METHODS.has(node.expression.name.text) &&
      node.arguments.length >= 1
    ) {
      const arg = node.arguments[0];
      if (ts.isRegularExpressionLiteral(arg)) {
        const inner = arg.text.replace(/^\/(.*)\/[a-z]*$/, "$1");
        if (literalIsForbidden(inner)) {
          const lc = getLineCol(node.getStart(sf));
          hits.push({
            file: rel,
            line: lc.line,
            column: lc.column,
            kind: "method-call",
            snippet: snippet(node),
          });
        }
      } else {
        const val = tryEvalStaticString(arg);
        if (val !== null && literalIsForbidden(val)) {
          const lc = getLineCol(node.getStart(sf));
          hits.push({
            file: rel,
            line: lc.line,
            column: lc.column,
            kind: "method-call",
            snippet: snippet(node),
          });
        }
      }
    }

    // 反模式 2: x === "openai" / x !== "claude"
    if (
      ts.isBinaryExpression(node) &&
      EQ_OPERATORS.has(node.operatorToken.getText(sf))
    ) {
      for (const side of [node.left, node.right]) {
        const val = tryEvalStaticString(side);
        if (val !== null && literalIsForbidden(val)) {
          const lc = getLineCol(node.getStart(sf));
          hits.push({
            file: rel,
            line: lc.line,
            column: lc.column,
            kind: "binary-eq",
            snippet: snippet(node),
          });
          break;
        }
      }
    }

    // 反模式 3: /gpt/.test(x)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isRegularExpressionLiteral(node.expression.expression) &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === "test"
    ) {
      const inner = node.expression.expression.text.replace(
        /^\/(.*)\/[a-z]*$/,
        "$1",
      );
      if (literalIsForbidden(inner)) {
        const lc = getLineCol(node.getStart(sf));
        hits.push({
          file: rel,
          line: lc.line,
          column: lc.column,
          kind: "regex-test",
          snippet: snippet(node),
        });
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}

function scanAll() {
  const files = [];
  for (const root of SCAN_ROOTS) listTsFiles(root, files);
  const allHits = [];
  for (const f of files) allHits.push(...scanFile(f));
  return allHits.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.kind.localeCompare(b.kind),
  );
}

function hitKey(h) {
  // 2026-06-10 治本：key 不含 line/column —— 行号漂移（增删行）/ lint 格式化不再
  //   被误报为"新违规"（此前每次无关改动都让既有命中行号下移 → newKeys 假阳 →
  //   反复手动 update baseline 的恶性循环）。只认 file + 违规类型 + 规范化代码片段。
  //   真新增仍被拦：新片段 → newKeys 非空；同片段多一处 → 总 count 上涨（见 main 的
  //   count > baseline.count 检查）。snippet 规范化掉多余空白，免格式化误判。
  const normSnippet = String(h.snippet ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return `${h.file}:${h.kind}:${normSnippet}`;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { version: 1, count: 0, generatedAt: null, hits: [] };
  }
  const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8"));
  return raw;
}

function writeBaseline(hits) {
  if (!fs.existsSync(BASELINE_DIR)) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
  }
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: hits.length,
    note:
      "v3.1 F baseline (TYPE B routing + TYPE C decoration). C/D 已清的真 P0 决策文件由 capability-provider-string-match.contract.spec.ts 锁零；本基线许可的是 §0 D5 路由 / 装饰类既有命中，新代码不得让总数上涨。",
    hits: hits.map((h) => ({
      file: h.file,
      line: h.line,
      column: h.column,
      kind: h.kind,
      snippet: h.snippet,
    })),
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + "\n");
}

// ────────────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────────────
function main() {
  const args = new Set(process.argv.slice(2));
  const wantJson = args.has("--json");
  const wantWrite = args.has("--write");
  const wantPrint = args.has("--print");

  const hits = scanAll();

  if (wantWrite) {
    writeBaseline(hits);
    console.log(
      `[audit:capability] baseline written: ${hits.length} hits → ${path.relative(BACKEND_ROOT, BASELINE_FILE)}`,
    );
    process.exit(0);
  }

  if (wantPrint || wantJson) {
    if (wantJson) {
      console.log(JSON.stringify({ count: hits.length, hits }, null, 2));
    } else {
      console.log(`[audit:capability] ${hits.length} hits:`);
      for (const h of hits) {
        console.log(`  ${h.file}:${h.line}:${h.column}  [${h.kind}]  ${h.snippet}`);
      }
    }
    process.exit(0);
  }

  // 默认行为：对比 baseline
  const baseline = loadBaseline();
  const baselineKeys = new Set(baseline.hits.map(hitKey));
  const currentKeys = new Set(hits.map(hitKey));

  // 新增违规（baseline 未记录的 file:line:col:kind）
  const added = [];
  for (const h of hits) {
    if (!baselineKeys.has(hitKey(h))) added.push(h);
  }

  // 总数是否上涨
  const grew = hits.length > baseline.count;

  if (added.length === 0 && !grew) {
    console.log(
      `[audit:capability] OK  current=${hits.length}  baseline=${baseline.count}  (no new keys, no growth)`,
    );
    process.exit(0);
  }

  console.error("");
  console.error("============================================================");
  console.error("  audit:capability VIOLATION (v3.1 §F baseline lock)");
  console.error("============================================================");
  if (grew) {
    console.error(
      `  total grew: ${baseline.count} → ${hits.length} (+${hits.length - baseline.count})`,
    );
  }
  if (added.length > 0) {
    console.error(`  new violations (not in baseline): ${added.length}`);
    for (const h of added) {
      console.error(
        `    ${h.file}:${h.line}:${h.column}  [${h.kind}]  ${h.snippet}`,
      );
    }
  }
  console.error("");
  console.error("  修复路径:");
  console.error("    1. 把启发式改用 ModelCapabilityService.resolveCapabilities(config)");
  console.error("       读 capability 结构化字段（v3.1 §3.2 / §3.4）");
  console.error("    2. 若属 TYPE B 路由 / TYPE C 装饰（v3.1 §0 D5 注释清单），");
  console.error(
      "       需 reviewer 在 PR 描述里说明并跑 `npm run audit:capability:update` 入档",
  );
  console.error("");
  process.exit(1);
}

main();
