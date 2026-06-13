/**
 * 阶段 0 contract / v3.1 文档 §0.5 §6.D6 / 演进策略说明
 *
 * 锁住"现状只有有限几处读 `.structuredOutputStrategy / .fallbackStrategies`"
 * 的不变量；同时锁住"5 个 supports_* bool 字段零业务读者"。
 *
 * 用 TypeScript Compiler API 扫所有 .ts 源文件，**三路合并**统计读者：
 *   - PropertyAccessExpression：`cfg.structuredOutputStrategy`
 *   - ElementAccessExpression（字符串字面量索引）：`cfg["structuredOutputStrategy"]`
 *   - ObjectBindingPattern 解构：`const { structuredOutputStrategy } = cfg`
 *
 * 这三种是 TS 中读取对象字段的合法形式。任何一种都计入"读者"，防止用字符串
 * 索引或解构绕过 PropertyAccess 扫描。
 *
 * **范围声明**：仅 `backend/src` 运行时（排除 .spec/.test/.d.ts/node_modules/
 *   dist/coverage/__tests__）。前端 admin UI、Prisma schema、测试 fixture 另计，
 *   不进入本基线。
 *
 * **structuredOutputStrategy 读者基线（运行时代码，非 .spec / .test 文件）**：
 *   - structured-output-router.service.ts ：派生视图（v3.1 §A 后变成薄壳，
 *                                            透传给 ModelCapabilityService）
 *   - ai-model-config.service.ts          ：buildModelConfig 把 raw Prisma row 字段
 *                                            映射到 AIModelConfig（纯转译）
 *   - llm-executor.ts                     ：把 AIModelConfig 上的两字段透传给
 *                                            router.resolveChain（不做决策）
 *   - admin.service.ts                    ：admin 写入路径，把请求 DTO 透传给
 *                                            prisma update（写流，非读决策）
 *   - ai-chat.service.ts                  ：chat() 入口对 options 做解构透传，
 *                                            下沉给 provider routes / executor
 *                                            （纯透传，无业务决策）—— 2026-05-23
 *                                            element-access + 解构扫描新发现的
 *                                            读者，纳入基线
 *   - capability/model-capability.service.ts: v3.1 §A 新增——deriveFromConfig
 *                                            从 AIModelConfig 派生 capability，
 *                                            admin 显式 structuredOutputStrategy
 *                                            覆盖 catalog 默认 nativeMode
 *
 * **fallbackStrategies 读者基线**：与 structuredOutputStrategy 同上读者集，且
 *   capability service 也读（admin 配置 fallback chain 走派生路径）；
 *   ai-chat.service.ts 当前不透传该字段，只读 structuredOutputStrategy。
 *
 * **supports_json_schema_strict / supports_json_schema / supports_tool_use /
 *   supports_json_mode / supports_gbnf_grammar 读者基线**：
 *   仅 ai-model-config.service.ts 的 buildModelConfig 做了 raw row → AIModelConfig
 *   字段映射（机械转译，无任何业务消费）。**这是 v3.1 §D6 决定删除这 5 个
 *   bool 字段的关键事实依据** —— 任何 PR 引入新读者必须重审 D6 计划。
 *
 * 演进策略：
 *   D6 阶段删除 5 个 supports_* bool 字段时本 spec 必须红 → 同步更新或删除。
 *   D 阶段把 fallback / strategy 读取下沉时 structured-output 部分也同步更新。
 *
 * 性能：listTsFiles + AST 解析在 beforeAll 中完成一次性预扫描，缓存所有字段名
 *   的读者集合；各 `it` 仅从缓存读取，单文件耗时从 ~14s 降到 ~3s。
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const SRC_ROOT = path.resolve(__dirname, "../../..");

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

/** 我们关心的全部字段名（一次解析、多字段并行统计，避免重复 AST 遍历）。 */
const TARGET_FIELDS = [
  "structuredOutputStrategy",
  "fallbackStrategies",
  "supportsJsonSchemaStrict",
  "supportsJsonSchema",
  "supportsToolUse",
  "supportsJsonMode",
  "supportsGbnfGrammar",
] as const;
type TargetField = (typeof TARGET_FIELDS)[number];

const TARGET_SET: ReadonlySet<string> = new Set(TARGET_FIELDS);

/**
 * 收集单文件中三类读取形式的命中字段：
 *   - PropertyAccessExpression(name.text ∈ TARGET_SET)
 *   - ElementAccessExpression（argument 是 StringLiteral，且 text ∈ TARGET_SET）
 *   - ObjectBindingPattern 元素的 propertyName/name（标识符 ∈ TARGET_SET）
 *
 * 关键：不收 PropertyAssignment（{ structuredOutputStrategy: ... }）的 key——
 * 那是写入/声明，不是读取。
 */
function collectReadsInFile(filePath: string): Set<TargetField> {
  const sf = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf-8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const found = new Set<TargetField>();
  function visit(node: ts.Node): void {
    // 1) cfg.structuredOutputStrategy
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      if (TARGET_SET.has(name)) found.add(name as TargetField);
    }
    // 2) cfg["structuredOutputStrategy"]
    else if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if (arg && ts.isStringLiteral(arg) && TARGET_SET.has(arg.text)) {
        found.add(arg.text as TargetField);
      }
    }
    // 3) const { structuredOutputStrategy } = cfg
    //    const { structuredOutputStrategy: x } = cfg  → propertyName 是源字段
    else if (ts.isObjectBindingPattern(node)) {
      for (const el of node.elements) {
        // propertyName 存在意味着重命名解构（{ src: dst }）；不存在时 name 即源字段
        const sourceName = el.propertyName ?? el.name;
        if (ts.isIdentifier(sourceName) && TARGET_SET.has(sourceName.text)) {
          found.add(sourceName.text as TargetField);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

/** 预扫描结果：fieldName → 排序后的 src 相对路径列表。 */
type ReaderIndex = Record<TargetField, string[]>;

let READER_INDEX: ReaderIndex;

beforeAll(() => {
  const buckets: Record<TargetField, Set<string>> = {
    structuredOutputStrategy: new Set(),
    fallbackStrategies: new Set(),
    supportsJsonSchemaStrict: new Set(),
    supportsJsonSchema: new Set(),
    supportsToolUse: new Set(),
    supportsJsonMode: new Set(),
    supportsGbnfGrammar: new Set(),
  };
  for (const file of listTsFiles(SRC_ROOT)) {
    const hits = collectReadsInFile(file);
    if (hits.size === 0) continue;
    const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
    for (const field of hits) buckets[field].add(rel);
  }
  READER_INDEX = TARGET_FIELDS.reduce((acc, f) => {
    acc[f] = [...buckets[f]].sort((a, b) => a.localeCompare(b));
    return acc;
  }, {} as ReaderIndex);
});

describe("Capability Contract · structured-output field readers baseline (v3.1 §6.D6)", () => {
  // 5 个"原始"读者（v3.1 §A 后）：
  //   router(派生薄壳) / model-config / executor / admin(写流) / capability-service(派生器)
  const EXPECTED_STRATEGY_READERS_BASE = [
    "modules/ai-engine/llm/models/capability/model-capability.service.ts",
    "modules/ai-engine/llm/models/config/ai-model-config.service.ts",
    "modules/ai-engine/llm/output/structured/structured-output-router.service.ts",
    "modules/ai-harness/runner/executor/llm-executor.ts",
    "modules/open-api/admin/admin.service.ts",
  ];

  // ai-chat.service.ts 在 chat() 入口对 options 做解构透传（无业务决策）。
  // 仅 structuredOutputStrategy 透传，不透传 fallbackStrategies。
  const EXPECTED_STRATEGY_READERS = [
    ...EXPECTED_STRATEGY_READERS_BASE,
    "modules/ai-engine/llm/chat/ai-chat.service.ts",
  ];

  it("`.structuredOutputStrategy` is read only by the documented files (PropertyAccess + element-access + destructuring 三路合集)", () => {
    expect(READER_INDEX.structuredOutputStrategy).toEqual(
      [...EXPECTED_STRATEGY_READERS].sort(),
    );
  });

  it("`.fallbackStrategies` is read only by the base documented files (PropertyAccess + element-access + destructuring 三路合集; ai-chat.service.ts 不透传此字段)", () => {
    // Note: ai-app/explore/.../ai-prompts.config.ts declares a `fallbackStrategies`
    // property on a UNRELATED prompt-best-practices config object; but it's an
    // assignment, not a PropertyAccessExpression read, so it doesn't appear here.
    const allowedNonModelConfigReaders: string[] = [
      // 当前实际数据：业务侧 PropertyAccess 唯一同名读者
      // （prompt config 内部的 fallbackStrategies 字段，与 AIModelConfig 同名巧合）
    ];
    const expected = [
      ...EXPECTED_STRATEGY_READERS_BASE,
      ...allowedNonModelConfigReaders,
    ].sort();
    expect(READER_INDEX.fallbackStrategies).toEqual(expected);
  });

  // ★★★ D6 决议关键依据：5 个 supports_* bool 字段的读者仅限 ai-model-config.service.ts
  // 内 buildModelConfig 的 raw row → AIModelConfig 字段机械映射。**没有任何业务
  // 决策代码读这 5 个字段**（PropertyAccess / element-access / destructuring 三路皆零）。
  // 任何 PR 引入新读者必须重审 D6 删除计划。

  const SUPPORTS_BOOL_FIELDS: TargetField[] = [
    "supportsJsonSchemaStrict",
    "supportsJsonSchema",
    "supportsToolUse",
    "supportsJsonMode",
    "supportsGbnfGrammar",
  ];

  it.each(SUPPORTS_BOOL_FIELDS)(
    "`.%s` has zero business runtime readers (only mechanical mapping + admin write API; 三路合集)",
    (field) => {
      // 两个允许的"读者"都是机械透传，不是业务决策：
      //   - ai-model-config.service.ts：buildModelConfig 把 raw Prisma row 字段
      //     映射到 AIModelConfig（纯转译）
      //   - admin.service.ts：admin update API 把 DTO `data.supports*` 透传给
      //     prisma update（写流，不是业务读决策）
      // **没有任何 LLM 调用 / structured output 决策代码读这 5 个字段** —— D6 决议
      // 的关键事实依据。任何 PR 引入新读者必须重审 D6 删除计划。
      expect(READER_INDEX[field]).toEqual([
        "modules/ai-engine/llm/models/config/ai-model-config.service.ts",
        "modules/open-api/admin/admin.service.ts",
      ]);
    },
  );
});
