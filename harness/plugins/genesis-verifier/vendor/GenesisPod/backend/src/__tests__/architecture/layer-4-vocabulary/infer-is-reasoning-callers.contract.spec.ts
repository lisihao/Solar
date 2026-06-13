/**
 * 阶段 0 contract / v3.1 文档 §0.5 §6.D / 演进策略说明
 *
 * 锁住 `inferIsReasoning` 共享纯函数（ai-engine/llm/types/model.utils.ts）
 * 在 backend/src/ 下的真实调用方清单（按"文件 + 命中次数"，不锁行号）。
 *
 * 调用方定义：**直接调用** `inferIsReasoning(...)` 标识符（非 `this.inferIsReasoning`
 * 等同名方法）—— 这是从 model.utils 导入的纯函数的真实使用点。
 *
 * 用 TypeScript Compiler API 扫每个 .ts 源文件的 CallExpression：
 *   - 表达式为单一 Identifier `inferIsReasoning`（排除 PropertyAccess `this.x`）
 *   - 按文件聚合命中次数，与 EXPECTED_CALLERS 基线比对
 *
 * **范围声明**：仅 `backend/src` 运行时（排除 .spec/.test/.d.ts/node_modules/
 *   dist/coverage/__tests__）。前端 admin UI、Prisma schema、测试 fixture 另计。
 *
 * **已知绕过形式（本扫描不覆盖，需 reviewer 人工把关）**：
 *   - 别名形式：`const fn = inferIsReasoning; fn(...)`（CallExpression 的 expr
 *     变成局部 Identifier `fn`，与基函数 ID 不同）
 *   - 重命名 import：`import { inferIsReasoning as foo } from ...; foo(...)`
 *     （别名 `foo` 不匹配 'inferIsReasoning'）
 *   - 间接传递：作为 callback / higher-order argument（`map(inferIsReasoning)`
 *     仍是 Identifier 调用，能命中；但 `.bind()` / wrapper 则不命中）
 *
 * 演进策略：
 *   阶段 D（P1 fallback 化、能力推断收口）会改变这个清单。任何 PR 增/减
 *   调用方 → 本 spec 红 → 强制 PR 同步更新 EXPECTED_CALLERS（reviewer 可见
 *   能力推断使用面的全部变更点）。
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const SRC_ROOT = path.resolve(__dirname, "../../..");

/**
 * 2026-05-23 baseline（按 `<src 相对路径>`: 命中次数；不锁行号，让 import 排序 /
 * 空行 / 注释变更不会假红）。运行 spec 时若违例会打印实际 vs 期望 diff，按需
 * 更新这里 + 在 PR 描述里解释变更（标注阶段 + 责任人 + 期限，见
 * CONTRACT_README.md）。
 *
 * Spec / 测试文件本身不计入（只盯运行时业务代码）。
 */
const EXPECTED_CALLERS: ReadonlyArray<readonly [string, number]> = [
  ["modules/ai-app/insight/services/dimension/section-writer.service.ts", 2],
  // v3.1 A0：ai-chat-model-config.service.ts 已 thin-wrapper 化，
  // 原 2 处 `inferIsReasoning(...)` 调用随 buildModelConfig / isReasoningModel
  // 委托给 canonical AiModelConfigService 而被消除。
  // 1（#4 reasoning tokenParam helper）+ 1（2026-06-10 Gemini thinking 预算判断：
  //   隐藏 CoT 吃光小预算 → 按 thinking 给更大 maxOutputTokens）= 2。
  //   OpenAI 走 this.inferIsReasoning（method，不计直接调用）。
  ["modules/ai-engine/llm/byok/ai-connection-test.service.ts", 2],
  // 2026-06-10 reasoning tokenParam 全仓兜底（gpt-5.4 P0）：以下 token 决策点 /
  // 数据层保存点新增直接 inferIsReasoning 兜底——DB isReasoning 列是
  // Boolean @default(false) NOT NULL，漏标的 reasoning 模型会被发 max_tokens
  // 触发 OpenAI INVALID_REQUEST，故在这些点 || 启发式兜底。
  ["modules/ai-engine/llm/chat/ai-chat-failover-caller.service.ts", 1],
  ["modules/ai-engine/llm/chat/ai-chat-token.service.ts", 1],
  ["modules/ai-engine/llm/chat/ai-chat.service.ts", 2],
  ["modules/ai-engine/llm/models/config/ai-model-config.service.ts", 3],
  ["modules/ai-engine/llm/models/selection/model-fallback.service.ts", 1],
  ["modules/ai-harness/tracing/observability/ai-observability.service.ts", 1],
  ["modules/open-api/admin/admin.service.ts", 2],
  [
    "modules/platform/credentials/user-owned/user-model-configs/user-model-configs.service.ts",
    1,
  ],
];

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
 * 收集一个源文件中所有 `inferIsReasoning(...)` 形态的调用次数：
 *   - CallExpression 的表达式是单纯 Identifier 'inferIsReasoning'
 *   - 排除 `this.inferIsReasoning(...)` / `obj.inferIsReasoning(...)`（同名 method）
 */
function countSharedFunctionCalls(filePath: string): number {
  const text = fs.readFileSync(filePath, "utf-8");
  const sf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  let count = 0;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr) && expr.text === "inferIsReasoning") {
        count++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

let ACTUAL_BY_FILE: Map<string, number>;

beforeAll(() => {
  ACTUAL_BY_FILE = new Map();
  for (const file of listTsFiles(SRC_ROOT)) {
    const count = countSharedFunctionCalls(file);
    if (count === 0) continue;
    const rel = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
    ACTUAL_BY_FILE.set(rel, count);
  }
});

describe("Capability Contract · inferIsReasoning callers baseline (v3.1 §6.D)", () => {
  it("model.utils.ts continues to export inferIsReasoning (shared canonical implementation)", () => {
    const utilsFile = path.join(
      SRC_ROOT,
      "modules/ai-engine/llm/types/model.utils.ts",
    );
    expect(fs.existsSync(utilsFile)).toBe(true);
    const src = fs.readFileSync(utilsFile, "utf-8");
    expect(src).toMatch(/export\s+function\s+inferIsReasoning\s*\(/);
  });

  it("the per-file counts of direct `inferIsReasoning(...)` calls match the documented baseline", () => {
    const actualEntries: Array<[string, number]> = [
      ...ACTUAL_BY_FILE.entries(),
    ].sort((a, b) => a[0].localeCompare(b[0]));
    const expectedEntries: Array<[string, number]> = [...EXPECTED_CALLERS]
      .map(([f, n]) => [f, n] as [string, number])
      .sort((a, b) => a[0].localeCompare(b[0]));
    expect(actualEntries).toEqual(expectedEntries);
  });
});
