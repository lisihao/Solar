/**
 * Capability Contract · PROVIDER_DEFAULT_CHAINS 收编完成（v3.1 阶段 A）
 *
 * 历史背景（A 之前）：
 *   `structured-output-router.service.ts` 内 module-level const
 *   `PROVIDER_DEFAULT_CHAINS`（17 条 + `FINAL_FALLBACK`）决定 (provider, model)
 *   的 structured-output strategy 链。
 *
 * v3.1 阶段 A 后：
 *   - 17 条规则**整体迁出**到 `capability/model-capability-catalog.ts` 的
 *     `PROVIDER_CAPABILITY_DEFAULTS`（数据驱动 catalog）
 *   - `FINAL_FALLBACK` 由 `ModelCapabilityService.deriveStructuredOutputChain()`
 *     的尾部 `'prompt'` 兜底替代
 *   - router 变成派生视图（薄壳：调 capability service）
 *
 * 锁住的不变量（防止退化回散落实现）：
 *   (a) router 源文件**不再含** `PROVIDER_DEFAULT_CHAINS` 标识符
 *   (b) router 源文件**不再含** `FINAL_FALLBACK` 标识符
 *   (c) catalog 文件存在
 *   (d) catalog `PROVIDER_CAPABILITY_DEFAULTS` 数组长度 ≥ 17 条
 *   (e) 唯一引用 catalog 的运行时文件是 `ModelCapabilityService`
 *       （contract spec / catalog 自身 / 测试 fixture 不计）
 *
 * **范围声明**：仅 `backend/src` 运行时（排除 .spec/.test/.d.ts/node_modules/
 *   dist/coverage/__tests__）。
 *
 * 演进策略：
 *   - 新增 provider catalog 条目：本 spec (d) 长度阈值自动跟随递增
 *   - 阶段 B/C：catalog 内字段可能扩展（新 capability 维度），本 spec 不变
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const SRC_ROOT = path.resolve(__dirname, "../../..");

const ROUTER_FILE = path.join(
  SRC_ROOT,
  "modules/ai-engine/llm/output/structured/structured-output-router.service.ts",
);
const CATALOG_FILE = path.join(
  SRC_ROOT,
  "modules/ai-engine/llm/models/capability/model-capability-catalog.ts",
);
const CAPABILITY_SERVICE_FILE = path.join(
  SRC_ROOT,
  "modules/ai-engine/llm/models/capability/model-capability.service.ts",
);
// v3.1 §B.6（2026-05-24）：probe daemon 合法导入 CATALOG_VERSION 用于版本检测。
// 这是 catalog 数据驱动设计的另一个允许消费方（catalog 升版 → 批量 reset self-heal）。
const CAPABILITY_PROBE_FILE = path.join(
  SRC_ROOT,
  "modules/ai-engine/llm/models/capability/capability-probe.service.ts",
);

/**
 * 在 .ts 文件 AST 中找顶层 VariableDeclaration name = identifierName 的
 * ArrayLiteralExpression 元素数量。找不到返回 null。
 */
function countArrayLiteralEntries(
  filePath: string,
  identifierName: string,
): number | null {
  if (!fs.existsSync(filePath)) return null;
  const sf = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let count: number | null = null;
  function visit(node: ts.Node): void {
    if (count !== null) return;
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === identifierName &&
          decl.initializer
        ) {
          let init: ts.Node = decl.initializer;
          if (ts.isAsExpression(init)) init = init.expression;
          if (ts.isArrayLiteralExpression(init)) {
            count = init.elements.length;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

/**
 * 在 .ts 文件**任意**位置查找标识符引用（AST 节点 kind === Identifier 且 text 匹配）。
 * 用于断言"router 不再含 PROVIDER_DEFAULT_CHAINS"——比 grep 严格（不被字符串 / 注释误命中）。
 */
function fileContainsIdentifier(
  filePath: string,
  identifierName: string,
): boolean {
  if (!fs.existsSync(filePath)) return false;
  const sf = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf-8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === identifierName) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

/** 列出 backend/src 下全部 .ts 运行时文件（与其它 contract spec 同口径排除规则）。 */
function listRuntimeTsFiles(dir: string, acc: string[] = []): string[] {
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
      listRuntimeTsFiles(full, acc);
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
 * 找出"运行时业务文件中 import 了 PROVIDER_CAPABILITY_DEFAULTS / SAFE_DEFAULTS"
 * 的全部文件（catalog 自身 + capability service 自身排除）。
 */
function findCatalogImporters(): string[] {
  const result: string[] = [];
  const CATALOG_REL =
    "modules/ai-engine/llm/models/capability/model-capability-catalog.ts";
  for (const file of listRuntimeTsFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
    if (rel === CATALOG_REL) continue;
    const sf = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf-8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let hit = false;
    function visit(node: ts.Node): void {
      if (hit) return;
      if (ts.isImportDeclaration(node)) {
        const ms = node.moduleSpecifier;
        if (
          ts.isStringLiteral(ms) &&
          ms.text.includes("model-capability-catalog")
        ) {
          hit = true;
          return;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    if (hit) result.push(rel);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

// v3.1 §A 收编完成时（2026-05-23），catalog 应有 ≥17 条规则
// （别名条目 claude / gemini / grok 包含在内；router 17 条 + 别名收编为 21 条）
const MIN_CATALOG_ENTRIES = 17;

describe("Capability Contract · PROVIDER_DEFAULT_CHAINS 收编完成 (v3.1 §A)", () => {
  it("router 源文件已删除 PROVIDER_DEFAULT_CHAINS 标识符（数据迁到 catalog）", () => {
    expect(fileContainsIdentifier(ROUTER_FILE, "PROVIDER_DEFAULT_CHAINS")).toBe(
      false,
    );
  });

  it("router 源文件已删除 FINAL_FALLBACK 标识符（兜底逻辑迁到 deriveStructuredOutputChain）", () => {
    expect(fileContainsIdentifier(ROUTER_FILE, "FINAL_FALLBACK")).toBe(false);
  });

  it("catalog 文件 model-capability-catalog.ts 存在", () => {
    expect(fs.existsSync(CATALOG_FILE)).toBe(true);
  });

  it(`catalog PROVIDER_CAPABILITY_DEFAULTS 长度 ≥ ${MIN_CATALOG_ENTRIES}`, () => {
    const n = countArrayLiteralEntries(
      CATALOG_FILE,
      "PROVIDER_CAPABILITY_DEFAULTS",
    );
    expect(n).not.toBeNull();
    expect(n!).toBeGreaterThanOrEqual(MIN_CATALOG_ENTRIES);
  });

  it("catalog 仅由 ModelCapabilityService + CapabilityProbeService 引用（运行时业务边界）", () => {
    // 防 catalog 数据被业务文件直接 import 派散点判断（v3 §3.6 边界守护）
    // 允许 importer 白名单：
    //   1. ModelCapabilityService —— 读 PROVIDER_CAPABILITY_DEFAULTS / SAFE_DEFAULTS
    //   2. CapabilityProbeService —— 读 CATALOG_VERSION（v3.1 §B.6 catalog 版本检测）
    const importers = findCatalogImporters();
    const expected = [
      path.relative(SRC_ROOT, CAPABILITY_PROBE_FILE).replace(/\\/g, "/"),
      path.relative(SRC_ROOT, CAPABILITY_SERVICE_FILE).replace(/\\/g, "/"),
    ].sort((a, b) => a.localeCompare(b));
    expect(importers).toEqual(expected);
  });
});
