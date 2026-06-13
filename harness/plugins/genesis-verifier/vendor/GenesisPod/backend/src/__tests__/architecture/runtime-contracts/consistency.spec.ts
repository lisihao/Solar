/**
 * 架构一致性 spec — task #18 看护机制
 *
 * 目的：在 CI 阶段拦截"散点散乱"反模式，杜绝以下问题再次发生：
 *   1. agent spec 缺 budget 配置（→ 无 wall-time / token / iteration 限制 → mission hang）
 *   2. 直接 return process.env.*_API_KEY / SECRET / TOKEN / PASSWORD（S1 漏洞）
 *   3. 裸 addEventListener("abort", ...) 不走 AbortableScope（listener leak）
 *   4. ai-api-caller 调用未配 timeout
 *
 * 与 ESLint 看护规则互补：
 *   - ESLint = 写代码时拦截（pre-commit lint-staged）
 *   - 这里 = CI 阶段全量扫描（pre-push verify:arch）
 */

import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../../../");

function* walkTs(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "__tests__" ||
        entry.name === "tests"
      ) {
        continue;
      }
      yield* walkTs(full);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      yield full;
    }
  }
}

describe("Architecture consistency", () => {
  describe("[task #18] agent spec 必有 budget 配置", () => {
    it("所有 ai-app/playground/agents 下的 *.agent.ts 必须 @Spec({ budget: ... })", () => {
      const agentsDir = path.resolve(
        SRC,
        "modules/ai-app/playground/agents",
      );
      const violations: string[] = [];
      for (const file of walkTs(agentsDir)) {
        if (!file.endsWith(".agent.ts")) continue;
        const content = fs.readFileSync(file, "utf-8");
        // @Spec({ ... budget: { ... } ... }) 必须存在
        if (
          /@Spec\s*\(\s*\{[\s\S]*?\}\s*\)/.test(content) &&
          !/budget\s*:/.test(content)
        ) {
          violations.push(path.relative(SRC, file));
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe("[task #18] 禁止 controller 直接 return process.env.*_API_KEY / SECRET / TOKEN / PASSWORD", () => {
    it("*.controller.ts 不得直接 return 敏感环境变量原值（防 S1 漏洞复发）", () => {
      const SENSITIVE_PATTERN =
        /return\s+process\.env\.[A-Z_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z_]*\s*(?:\|\|[^;\n]+)?\s*[;\n]/;
      const violations: string[] = [];
      for (const file of walkTs(SRC)) {
        // 仅扫描 controller —— endpoint 暴露的真实入口
        if (!file.endsWith(".controller.ts")) continue;
        const content = fs.readFileSync(file, "utf-8");
        if (SENSITIVE_PATTERN.test(content)) {
          violations.push(path.relative(SRC, file));
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe("[task #18] AbortSignal listener leak 检测", () => {
    it("非 AbortableScope 内部代码不得裸 addEventListener('abort', ...)", () => {
      const violations: string[] = [];
      for (const file of walkTs(SRC)) {
        // AbortableScope 自身实现允许
        if (file.endsWith("abortable-scope.ts")) continue;
        const content = fs.readFileSync(file, "utf-8");
        // 简化检测：addEventListener("abort"| 'abort')
        if (/\.addEventListener\s*\(\s*['"]abort['"]/.test(content)) {
          // 但若同文件内有 removeEventListener 配对调用，可豁免（caller 显式管理）
          const hasRemove = /\.removeEventListener\s*\(\s*['"]abort['"]/.test(
            content,
          );
          if (!hasRemove) {
            violations.push(path.relative(SRC, file));
          }
        }
      }
      // 已知豁免：harnessed-agent.ts 已配对，llm-reranker (×2) 已配对
      // 规则：只检测无配对的；新增违规会被本测试拦截
      expect(violations).toEqual([]);
    });
  });
});
