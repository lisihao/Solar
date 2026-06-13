/**
 * vocab-purity.spec.ts —— 词汇纯净度（ARCHITECTURE_RULES.md 第 4 层 + 8 硬规则 #2/#3）
 *
 * 规则：
 *  - harness business-team kernel 不得出现 app-specific 词汇
 *  - ai-engine production code 不得出现 app-specific 词汇
 *
 * 例外白名单见 EXCEPTIONS.md（E007 / E012 等），本 spec 内 EXEMPT_FILES 同步维护。
 *
 * 检查方式：grep 路径下的 .ts 文件（排除 .spec.ts / __tests__/ / 注释行）。
 * 第一版用 grep；漏判会在使用中逐步补到 EXEMPT_FILES。
 */

import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..", "..");

// ============================================================================
// 禁词清单
// ============================================================================

/**
 * Harness business-team kernel 禁词（app-specific 业务词）。
 * 只允许在 bindings/ / __tests__/ / 文档字符串中。
 *
 * 注：`reportArtifact` 已从禁词移出 —— MissionViewBase 上是 generic 参数化 slot
 * (`reportArtifact?: TArtifact | EmptyArtifactSentinel`)，不耦合业务 shape。
 * 真正业务化的是 artifact 内容（chapterReview / themeSummary 等），那些仍是禁词。
 */
const HARNESS_FORBIDDEN_TOKENS = [
  // app 名
  "playground",
  "playground",
  "topic-insights",
  "topicInsight",
  // 业务字段（具体业务概念，不是 generic slot）
  "chapterReview",
  "radarCluster",
  "socialPublish",
  "leaderSignoff",
  "leaderVerdict",
  "themeSummary",
  "reviewerVerdict",
] as const;

/**
 * Engine production code 禁词。
 * 只允许在 __tests__/ / 文档字符串中。
 */
const ENGINE_FORBIDDEN_TOKENS = [
  // app 名
  "playground",
  "playground",
  "topic-insights",
  "topicInsight",
  // business 概念
  "mission.status",
  "rerunStage",
  "leaderVerdict",
  "chapterReview",
  "reportArtifact",
  "themeSummary",
] as const;

// ============================================================================
// 扫描目标
// ============================================================================

const HARNESS_KERNEL_ROOT = path.join(
  PROJECT_ROOT,
  "src/modules/ai-harness/teams/business-team",
);

const ENGINE_ROOT = path.join(PROJECT_ROOT, "src/modules/ai-engine");

// ============================================================================
// 路径白名单（合法允许出现禁词的位置）
// ============================================================================

function isExemptPath(filePath: string): boolean {
  // 测试文件
  if (filePath.includes("/__tests__/")) return true;
  if (filePath.endsWith(".spec.ts")) return true;
  if (filePath.endsWith(".test.ts")) return true;
  // harness bindings 是 app 接入点，允许
  if (filePath.includes("/business-team/bindings/")) return true;
  // engine 内部 facade re-export 文件名可能含 app 名（少量合法）
  return false;
}

// ============================================================================
// 文件遍历（递归）
// ============================================================================

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        stack.push(full);
      } else if (e.isFile() && full.endsWith(".ts")) {
        out.push(full);
      }
    }
  }
  return out;
}

// ============================================================================
// grep（忽略注释 + 字符串字面量场景较粗略，第一版精度足够）
// ============================================================================

function stripCommentsAndStrings(src: string): string {
  // 去除单行 // 注释
  let out = src.replace(/^\s*\/\/.*$/gm, "");
  // 去除多行 /* ... */ 注释
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  return out;
}

function fileContainsToken(filePath: string, token: string): boolean {
  let src: string;
  try {
    src = fs.readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }
  const stripped = stripCommentsAndStrings(src);
  return stripped.includes(token);
}

// ============================================================================
// 测试
// ============================================================================

describe("§ vocab purity —— harness/engine 禁词 grep（ARCHITECTURE_RULES §4）", () => {
  describe("Harness business-team kernel 不含 app-specific 业务词", () => {
    const files = listTsFiles(HARNESS_KERNEL_ROOT).filter(
      (f) => !isExemptPath(f),
    );

    for (const token of HARNESS_FORBIDDEN_TOKENS) {
      it(`'${token}' 不出现在 harness business-team kernel 任何 production .ts`, () => {
        const violations: string[] = [];
        for (const f of files) {
          if (fileContainsToken(f, token)) {
            violations.push(path.relative(PROJECT_ROOT, f));
          }
        }
        // 输出可读错误
        if (violations.length > 0) {
          const msg = [
            `禁词 '${token}' 出现在 harness business-team kernel：`,
            ...violations.map((v) => `  - ${v}`),
            ``,
            `策略：harness 只讲机制，不讲业务。这些词应该参数化（通过 bindings/ 或 abstractions/）。`,
            `如确实需要保留，登记到 docs/architecture/EXCEPTIONS.md 并加路径白名单。`,
          ].join("\n");
          throw new Error(msg);
        }
        expect(violations).toEqual([]);
      });
    }
  });

  describe("AI Engine production code 不含 app-specific 业务词", () => {
    const files = listTsFiles(ENGINE_ROOT).filter((f) => !isExemptPath(f));

    for (const token of ENGINE_FORBIDDEN_TOKENS) {
      it(`'${token}' 不出现在 ai-engine 任何 production .ts`, () => {
        const violations: string[] = [];
        for (const f of files) {
          if (fileContainsToken(f, token)) {
            violations.push(path.relative(PROJECT_ROOT, f));
          }
        }
        if (violations.length > 0) {
          const msg = [
            `禁词 '${token}' 出现在 ai-engine production：`,
            ...violations.map((v) => `  - ${v}`),
            ``,
            `策略：engine 只讲能力（LLM / tools / rag / safety），不耦合 app 业务。`,
            `如确实需要保留，登记到 docs/architecture/EXCEPTIONS.md 并加路径白名单。`,
          ].join("\n");
          throw new Error(msg);
        }
        expect(violations).toEqual([]);
      });
    }
  });
});
