/**
 * v3.1 阶段 F · Capability Contract · 禁止 provider/modelId 字符串匹配决定能力
 *
 * **目的（锁住 C/D 清零的 P0 反模式）**：
 *   v3.1 D5 反模式清单（§0 D5）规定：能力决策代码不得用 `modelId.includes('gpt')`
 *   / `provider === 'openai'` 类启发式短路径决定 LLM 行为（response_format /
 *   maxTokens / isReasoning 等）。C 阶段（commit 325afdeef）+ D 阶段（commit
 *   4e95fdba5）已把 3 个真 P0 决策路径清零：
 *     - ai-engine/llm/providers/ai-api-caller.service.ts        （能力决策入口）
 *     - ai-engine/llm/services/ai-response.service.ts 不存在 → 真实位置：
 *       ai-app/teams/services/ai/ai-response.service.ts        （teams AI 出口）
 *     - ai-harness/runner/executor/agent-executor.service.ts   （runner 执行器）
 *
 *   本 spec 用 TypeScript Compiler API 锁这 3 个文件 **能力决策 AST 形态**
 *   零反模式，未来 PR 引入新启发式 → spec 红 → 强制 reviewer 看是否真的要绕开
 *   ModelCapabilityService。覆盖 ESLint AST 规则可能漏掉的：动态 import / 注释
 *   逃逸 / 模板字符串拼接 / 静态求值兜底。
 *
 * **范围声明 / 不查的位置**：
 *   1. TYPE B 配置路由（getDefaultEndpoint / inferProvider / getRequiredApiKeyName
 *      / getDefaultModelId / inferApiFormat / image-generation provider 路由）
 *      —— 它们决定"打哪个 endpoint / 用哪个 adapter"，不是能力决策；C/D 阶段
 *      明示保留。本 spec 不扫这些文件。
 *   2. TYPE C 装饰（getIconUrl / formatModelDisplayName / OTEL span attribution
 *      / error-signal detectProvider URL 反解 / credibility 评分）—— 纯 UI /
 *      日志 / 审计，没有运行时业务决策。本 spec 不扫这些文件。
 *   3. 注释字符串 / spec / test fixture / catalog 数据（catalog 内 Property
 *      value 的字面量是数据声明，不是决策）—— TS Compiler API 天然不含注释；
 *      catalog/fixture 不在扫描清单内。
 *
 * **决策 vs 路由的精确判定**（reviewer 增删 ENFORCED_DECISION_FILES 时参考）：
 *   - 决策（必清）：if (lower.includes('claude')) return BIG_MAX_TOKENS;
 *   - 路由（豁免）：if (lower.includes('claude')) return 'ANTHROPIC_API_KEY';
 *   - 装饰（豁免）：if (lower.includes('claude')) return '/icons/claude.svg';
 *
 * **演进策略**：
 *   - 任何新文件接入 ModelCapabilityService.resolveCapabilities → 把该文件加入
 *     ENFORCED_DECISION_FILES，spec 即守住
 *   - F 阶段 baseline 清零（audit:capability EXITCODE=0 且 baseline = 0）后可
 *     考虑把扫描范围扩大到全 ai-engine + ai-harness + ai-app
 *
 * **与 ESLint AST 规则的分工**：
 *   - ESLint（lint-staged pre-commit + IDE）：实时反馈 + 阻断 commit，覆盖所有
 *     C/D 已清的 capability-decision 文件
 *   - 本 spec（jest pre-push + CI）：覆盖 ESLint 漏的动态 / 注释逃逸 / 共享
 *     静态求值（与 infer-is-reasoning-callers.contract.spec.ts 同款架构）
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const SRC_ROOT = path.resolve(__dirname, "../../..");

/**
 * v3.1 C/D 阶段清零的 P0 决策文件 —— 本 spec 锁这 3 个文件的能力决策 AST
 * 形态零反模式（注：路径必须用正斜杠，与 src 相对路径一致）。
 */
const ENFORCED_DECISION_FILES: ReadonlyArray<string> = [
  "modules/ai-engine/llm/providers/ai-api-caller.service.ts",
  "modules/ai-app/teams/services/ai/ai-response.service.ts",
  "modules/ai-harness/runner/executor/agent-executor.service.ts",
];

/**
 * 反模式 1：modelId/provider/model.toLowerCase() 等字符串变量 `.includes/.startsWith/
 *           .endsWith/.indexOf/.search/.match` 的参数是 provider/model family 名。
 *
 * 反模式 2：变量 `=== 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek'` 等
 *           直接 provider 名字面量判定。
 *
 * normalize：把字面量 toLowerCase + 去 `-_.` 空白后比对，防 `Gpt_4O` / `gpt.4-o` /
 *           `Deep Seek` 等变形绕过（与 v3.1 §5.2 共享求值器同款）。
 */
const FORBIDDEN_NAMES = [
  // 主流 provider 名（v3.1 §5.5 子集，本 spec 锁能力决策路径足够覆盖）
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  // 模型 family（C 阶段实证清掉的就是这一组）
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

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_.\s]/g, "");
}

const FORBIDDEN_NORMALIZED: ReadonlySet<string> = new Set(
  FORBIDDEN_NAMES.map(normalize),
);

const HEURISTIC_METHOD_NAMES: ReadonlySet<string> = new Set([
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "search",
  "match",
]);

const EQ_OPERATORS: ReadonlySet<string> = new Set(["===", "==", "!==", "!="]);

interface Hit {
  file: string;
  line: number;
  column: number;
  kind: "method-call" | "binary-eq" | "regex-test";
  snippet: string;
}

/**
 * TYPE B 路由 helper 函数名豁免（v3.1 §0 D5）—— 这些函数即便在能力决策文件
 * 内部，也属"路由/资源解析"语义，不决定 LLM 能力。把它们的函数体跳过。
 *
 * 命名约定：动词 + From/To/Provider/Format/Endpoint/ApiKey/Default 结尾。
 *
 * 当前已知豁免（reviewer 可在 PR 中补充新词）：
 *   - getDefaultModelId       —— shorthand→full modelId 探测
 *   - getDefaultEndpoint      —— provider→endpoint URL
 *   - getRequiredApiKeyName   —— provider→env var name
 *   - inferProvider           —— modelId→provider attribution
 *   - inferApiFormat          —— provider→API 协议
 *   - getApiFormatForProvider —— 同上
 */
const TYPE_B_ROUTING_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "getDefaultModelId",
  "getDefaultEndpoint",
  "getRequiredApiKeyName",
  "inferProvider",
  "inferApiFormat",
  "getApiFormatForProvider",
]);

/**
 * 判断节点是否处在 TYPE B routing helper 函数体内（向上查 ancestor）。
 *   - MethodDeclaration / FunctionDeclaration / FunctionExpression：直接对比 name
 *   - ArrowFunction / 匿名 FunctionExpression：找它绑定的 VariableDeclaration /
 *     PropertyAssignment / PropertyDeclaration 名（覆盖 `const inferProvider = () => {...}` 形态）
 */
function isInTypeBRoutingHelper(node: ts.Node): boolean {
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) {
      if (
        p.name &&
        ts.isIdentifier(p.name) &&
        TYPE_B_ROUTING_FUNCTION_NAMES.has(p.name.text)
      ) {
        return true;
      }
    } else if (ts.isFunctionExpression(p) || ts.isArrowFunction(p)) {
      // 找绑定名
      const owner = p.parent;
      if (owner) {
        if (
          ts.isVariableDeclaration(owner) &&
          ts.isIdentifier(owner.name) &&
          TYPE_B_ROUTING_FUNCTION_NAMES.has(owner.name.text)
        ) {
          return true;
        }
        if (
          ts.isPropertyAssignment(owner) &&
          ts.isIdentifier(owner.name) &&
          TYPE_B_ROUTING_FUNCTION_NAMES.has(owner.name.text)
        ) {
          return true;
        }
        if (
          ts.isPropertyDeclaration(owner) &&
          ts.isIdentifier(owner.name) &&
          TYPE_B_ROUTING_FUNCTION_NAMES.has(owner.name.text)
        ) {
          return true;
        }
      }
    }
    p = p.parent;
  }
  return false;
}

/**
 * 共享静态求值器（与 v3.1 §5.2 设计一致，本地实现免外部依赖）：
 *   - StringLiteral / NoSubstitutionTemplateLiteral → 直接返回
 *   - 简单 BinaryExpression `+` 两侧可求值 → 拼接
 *   - 其它 → null
 *
 * 已知盲区（本 spec 不覆盖，由 audit:capability 全仓扫 + CODEOWNERS 兜底）：
 *   - 跨函数变量传递（`const a="gpt"; const b="-4"; foo(a+b)`）
 *   - atob / Buffer.from 反编码
 *   - eval / new Function
 */
function tryEvalStaticString(node: ts.Node): string | null {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
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

/**
 * 字面量是否命中 forbidden 名 ——
 *   normalize 后 **精确匹配 OR forbidden 是前缀且接 `digit`**。
 *
 *   - `gpt-4` (norm `gpt4`)    → 命中 forbidden `gpt`（接数字 `4`）
 *   - `Claude-3` (norm `claude3`) → 命中 forbidden `claude`（接数字 `3`）
 *   - `Gpt_4O` (norm `gpt4o`)  → 命中 forbidden `gpt`（接数字 `4`）
 *   - `o1` / `o3` / `o4`        → 精确命中
 *
 *   不命中（避免误判）：
 *   - `gemini_response_schema` (norm `geminiresponseschema`)
 *     不命中 forbidden `gemini`（后面接字母 `r`，非 digit / 末尾）
 *   - `claude-3-opus` (norm `claude3opus`) 仍命中 forbidden `claude` (`claude` 接 `3`)
 *   - `openai_format`（如果出现）不命中 `openai`（接 `f` 字母，非 digit/end）
 *
 * 防 `gpt-4`/`Gpt_4O`/`Claude-3` 等变形绕过，同时不误伤结构化输出枚举字面量。
 */
function literalIsForbidden(value: string): boolean {
  const n = normalize(value);
  for (const fb of FORBIDDEN_NORMALIZED) {
    if (n === fb) return true;
    if (n.startsWith(fb)) {
      const next = n.charCodeAt(fb.length);
      // digit 0-9 (48-57)
      if (next >= 48 && next <= 57) return true;
    }
  }
  return false;
}

function getLineCol(
  sf: ts.SourceFile,
  pos: number,
): { line: number; column: number } {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, column: lc.character + 1 };
}

function scanFile(filePath: string): Hit[] {
  const text = fs.readFileSync(filePath, "utf-8");
  const sf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];
  const relFile = path.relative(SRC_ROOT, filePath).replace(/\\/g, "/");

  function visit(node: ts.Node): void {
    // TYPE B 路由 helper 函数体内的节点跳过（语义不是能力决策）
    if (isInTypeBRoutingHelper(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    // 反模式 1: x.includes / x.startsWith / x.endsWith / x.indexOf / x.search / x.match
    //   形如：modelLower.includes("gpt")  /  model.toLowerCase().startsWith("o1")
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      HEURISTIC_METHOD_NAMES.has(node.expression.name.text) &&
      node.arguments.length >= 1
    ) {
      const arg = node.arguments[0];
      // .match(/gpt/) / .search(/gpt/) 也算
      if (ts.isRegularExpressionLiteral(arg)) {
        const reSrc = arg.text;
        const inner = reSrc.replace(/^\/(.*)\/[a-z]*$/, "$1");
        // 简单字面 substring 才扫；用 normalize 防 `gpt-?\d` 类
        if (literalIsForbidden(inner)) {
          const lc = getLineCol(sf, node.getStart(sf));
          hits.push({
            file: relFile,
            line: lc.line,
            column: lc.column,
            kind: "method-call",
            snippet: text
              .slice(
                node.getStart(sf),
                Math.min(node.getEnd(), node.getStart(sf) + 80),
              )
              .replace(/\s+/g, " "),
          });
        }
      } else {
        const val = tryEvalStaticString(arg);
        if (val !== null && literalIsForbidden(val)) {
          const lc = getLineCol(sf, node.getStart(sf));
          hits.push({
            file: relFile,
            line: lc.line,
            column: lc.column,
            kind: "method-call",
            snippet: text
              .slice(
                node.getStart(sf),
                Math.min(node.getEnd(), node.getStart(sf) + 80),
              )
              .replace(/\s+/g, " "),
          });
        }
      }
    }

    // 反模式 2: BinaryExpression `=== "openai"` / `=== "claude"` 等
    if (
      ts.isBinaryExpression(node) &&
      EQ_OPERATORS.has(node.operatorToken.getText(sf))
    ) {
      for (const side of [node.left, node.right]) {
        const val = tryEvalStaticString(side);
        if (val !== null && literalIsForbidden(val)) {
          const lc = getLineCol(sf, node.getStart(sf));
          hits.push({
            file: relFile,
            line: lc.line,
            column: lc.column,
            kind: "binary-eq",
            snippet: text
              .slice(
                node.getStart(sf),
                Math.min(node.getEnd(), node.getStart(sf) + 80),
              )
              .replace(/\s+/g, " "),
          });
          break;
        }
      }
    }

    // 反模式 3: /gpt/.test(x) 形式（callee 是 RegExpLiteral 的 PropertyAccess）
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isRegularExpressionLiteral(node.expression.expression) &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === "test"
    ) {
      const reSrc = node.expression.expression.text;
      const inner = reSrc.replace(/^\/(.*)\/[a-z]*$/, "$1");
      if (literalIsForbidden(inner)) {
        const lc = getLineCol(sf, node.getStart(sf));
        hits.push({
          file: relFile,
          line: lc.line,
          column: lc.column,
          kind: "regex-test",
          snippet: text
            .slice(
              node.getStart(sf),
              Math.min(node.getEnd(), node.getStart(sf) + 80),
            )
            .replace(/\s+/g, " "),
        });
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}

let ALL_HITS: Hit[] = [];

beforeAll(() => {
  ALL_HITS = [];
  for (const rel of ENFORCED_DECISION_FILES) {
    const abs = path.join(SRC_ROOT, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `[v3.1 F contract] Decision file not found: ${rel}. ` +
          `如 C/D 阶段重命名/迁移该文件，请同步更新 ENFORCED_DECISION_FILES`,
      );
    }
    ALL_HITS.push(...scanFile(abs));
  }
});

describe("Capability Contract · provider/model string-match anti-pattern lock (v3.1 §F)", () => {
  it("ENFORCED_DECISION_FILES 全部存在（防 C/D 后文件被改名/搬走静默漏扫）", () => {
    for (const rel of ENFORCED_DECISION_FILES) {
      const abs = path.join(SRC_ROOT, rel);
      expect(fs.existsSync(abs)).toBe(true);
    }
  });

  it("3 个 C/D 已清的能力决策文件不再出现 modelId/provider substring 启发式（method-call + regex-test + binary-eq 三路合集）", () => {
    // 期望 0。失败时打印精确 file:line:col + snippet，方便 reviewer 定位。
    const formatted = ALL_HITS.map(
      (h) => `${h.file}:${h.line}:${h.column}  [${h.kind}]  ${h.snippet}`,
    );
    expect(formatted).toEqual([]);
  });

  it("normalize 评估器对 `Gpt_4O` / `gpt.4-o` / `Deep-Seek` 等变形也算反模式（防绕过自检）", () => {
    // 单元测试：normalize 是否能识别变形写法
    expect(literalIsForbidden("Gpt_4O")).toBe(true);
    expect(literalIsForbidden("gpt.4-o")).toBe(true);
    expect(literalIsForbidden("Deep Seek")).toBe(true);
    expect(literalIsForbidden("Claude-3")).toBe(true);
    // 同时确认非 forbidden 字面量不会误命中
    expect(literalIsForbidden("hello")).toBe(false);
    expect(literalIsForbidden("response_format")).toBe(false);
    expect(literalIsForbidden("max_tokens")).toBe(false);
  });
});
