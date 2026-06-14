/**
 * v3.1 A0 已完成 contract / 单一源 baseline
 *
 * 历史背景（A0 之前）：
 *   - `ai-engine/llm/services/ai-chat-model-config.service.ts` export
 *     interface AIModelConfig（旧/精简版 12 字段）
 *   - `ai-engine/llm/models/config/ai-model-config.service.ts` export interface
 *     AIModelConfig（canonical 超集 19 字段，含 7 个 §3.x structured-output 字段）
 *   - 双源并存。任何"哪边添字段"决策都需 reviewer 人工把关，易漂移。
 *
 * v3.1 A0（已完成）：interface AIModelConfig **合并为单一源** ——
 *   `modules/ai-engine/llm/types/model-config.types.ts`
 *
 * 锁定不变量（防止退化回双源）：
 *   (a) 单一源文件存在且 export interface AIModelConfig
 *   (b) ai-chat-model-config.service.ts 不再 export interface（已 thin wrapper
 *       化，仅 re-export type alias，不在 TS 顶层 `export interface` 声明）
 *   (c) ai-model-config.service.ts 同样不再 export interface（也是 re-export）
 *   (d) **全 backend/src 树**只有 1 处 `export interface AIModelConfig` 声明
 *       —— 即 types/model-config.types.ts
 *   (e) canonical interface 仍带 7 个 §3.x structured-output 字段（D6 删除 5 个
 *       bool 时此断言要同步更新）
 *
 * **范围声明**：仅 `backend/src` 运行时（排除 .spec/.test/.d.ts/node_modules/
 *   dist/coverage/__tests__）。
 *
 * 演进策略：
 *   - 阶段 D6 删除 5 个 supports_json_* bool → 同步更新 §(e) 期望字段集
 *   - 阶段 G（A0 收尾后期）评估是否删整 spec（如全树已 0 处声明残留）
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const SRC_ROOT = path.resolve(__dirname, "../../..");

const FILE_SINGLE_SOURCE = path.join(
  SRC_ROOT,
  "modules/ai-engine/llm/types/model-config.types.ts",
);
const FILE_OLD_WRAPPER = path.join(
  SRC_ROOT,
  // moved into services/chat/ during llm/services MECE concern-grouping
  "modules/ai-engine/llm/chat/ai-chat-model-config.service.ts",
);
const FILE_CANONICAL_SERVICE = path.join(
  SRC_ROOT,
  "modules/ai-engine/llm/models/config/ai-model-config.service.ts",
);

/**
 * 列出 backend/src 下全部 .ts 运行时文件（与其它 contract spec 同口径排除规则）。
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
 * 全树扫描：返回所有 `export interface AIModelConfig` 声明所在的相对路径
 * （用 TS Compiler API，不用 grep，避免字符串误命中）。
 *
 * 注意：本扫描仅识别 `export interface AIModelConfig { ... }` 顶层声明形态，
 * **不**会把 `export type { AIModelConfig } from "..."` re-export 误判为新源。
 */
function findAllAIModelConfigDefinitions(): string[] {
  const found: string[] = [];
  for (const file of listTsFiles(SRC_ROOT)) {
    const sf = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf-8"),
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );
    sf.forEachChild((node) => {
      if (!ts.isInterfaceDeclaration(node)) return;
      if (node.name.text !== "AIModelConfig") return;
      const isExported =
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ??
        false;
      if (!isExported) return;
      found.push(path.relative(SRC_ROOT, file).replace(/\\/g, "/"));
    });
  }
  return found.sort((a, b) => a.localeCompare(b));
}

/**
 * 解析 TS 源文件，返回名为 `AIModelConfig` 的 exported interface 的属性名集合。
 * 找不到（不存在 / 未 export / 不是 interface）返回 null。
 */
function extractInterfaceFields(filePath: string): Set<string> | null {
  if (!fs.existsSync(filePath)) return null;
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf-8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  let result: Set<string> | null = null;
  source.forEachChild((node) => {
    if (!ts.isInterfaceDeclaration(node)) return;
    if (node.name.text !== "AIModelConfig") return;
    const isExported =
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ??
      false;
    if (!isExported) return;
    const fields = new Set<string>();
    for (const member of node.members) {
      if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
        fields.add(member.name.text);
      }
    }
    result = fields;
  });
  return result;
}

describe("Capability Contract · AIModelConfig single-source baseline (v3.1 A0 完成)", () => {
  it("types/model-config.types.ts is the single source of truth and exports interface AIModelConfig", () => {
    expect(fs.existsSync(FILE_SINGLE_SOURCE)).toBe(true);
    const fields = extractInterfaceFields(FILE_SINGLE_SOURCE);
    expect(fields).not.toBeNull();
    expect(fields!.size).toBeGreaterThan(0);
  });

  it("ai-chat-model-config.service.ts no longer declares `export interface AIModelConfig` (thin-wrapper 化，只 re-export)", () => {
    // 老文件仍存在（thin wrapper class），但顶层不能再有 `export interface
    // AIModelConfig`——type 通过 `export type { AIModelConfig }` re-export 走。
    expect(fs.existsSync(FILE_OLD_WRAPPER)).toBe(true);
    const fields = extractInterfaceFields(FILE_OLD_WRAPPER);
    expect(fields).toBeNull();
  });

  it("ai-model-config.service.ts no longer declares `export interface AIModelConfig` (re-export from types)", () => {
    expect(fs.existsSync(FILE_CANONICAL_SERVICE)).toBe(true);
    const fields = extractInterfaceFields(FILE_CANONICAL_SERVICE);
    expect(fields).toBeNull();
  });

  it("backend/src tree has exactly 1 `export interface AIModelConfig` declaration (single-source uniqueness)", () => {
    // 防止退化：任何 PR 新增第 2 处 interface 声明 → 本断言红，强制 reviewer
    // 确认"是否真的要退回双源"或"是否要正确从 types/model-config.types 引用"。
    const all = findAllAIModelConfigDefinitions();
    expect(all).toEqual(["modules/ai-engine/llm/types/model-config.types.ts"]);
  });

  it("single-source AIModelConfig still carries the v3.x structured-output extension fields (deletion gate for阶段 D6)", () => {
    // 这 7 个字段是合并前的 canonical 超集独有。D6 计划要删除 5 个 bool
    // 字段（supports_json_*）—— 删除时本断言必须同步更新。
    const newFields = extractInterfaceFields(FILE_SINGLE_SOURCE);
    expect(newFields).not.toBeNull();
    const v3xExtensionFields = [
      "structuredOutputStrategy",
      "fallbackStrategies",
      "supportsJsonSchemaStrict",
      "supportsJsonSchema",
      "supportsToolUse",
      "supportsJsonMode",
      "supportsGbnfGrammar",
    ];
    for (const f of v3xExtensionFields) {
      expect(newFields!.has(f)).toBe(true);
    }
  });
});
