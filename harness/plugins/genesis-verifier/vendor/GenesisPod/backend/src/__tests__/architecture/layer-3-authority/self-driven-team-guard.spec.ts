/**
 * Self-Driven Agent Team — 能力簇机制看护
 *
 * 2026-06-04: 把"靠 prompt 写死的红线"升级为自动化拦截（jest verify:arch + pre-push + CI）。
 * 背景：self-driven 能力簇用 workflow 自驱实现，agent 两类高风险行为必须机制拦截，
 *       不能只靠 prompt 里的 honor 约定：
 *
 *   规则 1（编造工具名回归）：RoleInventory 各角色 coreTools 里的每个工具 ID
 *     必须真实注册在 ai-engine ToolRegistry（TOOL_ID_CLASS_MAP）。
 *     —— P2 曾编造 web_search/calculator/code_execute 等不存在的工具名，
 *        导致 agent 工具调用全 miss。本 spec 锁死，永不再犯。
 *
 *   规则 2（绕 facade 碰共享内核）：self-driven 目录下的文件不得深 import 共享
 *     agent/runner 内核的内部路径（react-loop / harnessed-agent / agent-factory /
 *     tool-invoker / loop-registry / ai-chat.service）。消费这些内核必须走
 *     ai-harness/facade 或 ai-engine/facade —— 否则修改内核的连带影响无法被
 *     facade 边界收口。
 *
 * 与 ESLint / 其它 arch spec 是 belt-and-suspenders：本 spec 不依赖 lint config，
 * 覆盖动态 import + 注释逃逸，pre-push hook + CI 二次拦截。
 */

import * as fs from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../..");
const SELF_DRIVEN_DIR = path.join(
  SRC_ROOT,
  "modules/ai-harness/teams/orchestrator/self-driven",
);
const ROLE_INVENTORY_FILE = path.join(
  SRC_ROOT,
  "modules/ai-harness/teams/role-inventory/role-inventory.ts",
);
const TOOLS_PROVIDER_FILE = path.join(
  SRC_ROOT,
  "modules/ai-engine/tools/tools.provider.ts",
);

/** 递归列出 .ts 源文件（排除测试 / 声明文件）。 */
function listTsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        ["__tests__", "node_modules", "dist", "coverage"].includes(entry.name)
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

/** 去注释后抽取所有 import / require / dynamic-import 的目标路径。 */
function extractImportTargets(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  const targets: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) targets.push(m[1]);
  return targets;
}

/**
 * 从 tools.provider.ts 抽取真实注册的工具 ID 池（TOOL_ID_CLASS_MAP 的 kebab-case keys）。
 * 用文件解析而非运行时 import，避免拉起 provider 的 DI 依赖图。
 */
function realToolIds(): Set<string> {
  const raw = fs.readFileSync(TOOLS_PROVIDER_FILE, "utf-8");
  const ids = new Set<string>();
  // 抽所有 `"kebab-case":` 形式的 map key（工具 ID）
  const re = /["']([a-z][a-z0-9]*(?:-[a-z0-9]+)+)["']\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) ids.add(m[1]);
  return ids;
}

/**
 * 从 role-inventory.ts 的 `const T = { ... }` 工具常量块抽取所有声明的工具 ID 字符串值。
 */
function declaredCoreToolIds(): string[] {
  const raw = fs.readFileSync(ROLE_INVENTORY_FILE, "utf-8");
  const block = raw.match(/const\s+T\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
  const scope = block ? block[1] : raw;
  const ids: string[] = [];
  const re = /:\s*["']([a-z][a-z0-9-]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) ids.push(m[1]);
  return ids;
}

describe("Self-Driven Agent Team — capability-cluster guard", () => {
  describe("规则 1：RoleInventory coreTools 必须是真实注册的工具 ID", () => {
    it("每个声明的工具 ID 都存在于 ai-engine ToolRegistry（防编造工具名回归）", () => {
      const real = realToolIds();
      // 健全性：确保我们确实抽到了工具池（否则正则失效会假绿）
      expect(real.size).toBeGreaterThan(10);
      expect(real.has("web-search")).toBe(true);

      const declared = declaredCoreToolIds();
      // 健全性：role-inventory 确实声明了工具
      expect(declared.length).toBeGreaterThan(0);

      const fabricated = declared.filter((id) => !real.has(id));
      // 失败时 fabricated 数组即诊断信息：列出编造的、不存在于 ToolRegistry 的工具 ID。
      // 编造工具名会让 agent 工具调用全 miss（见 tools.provider.ts TOOL_ID_CLASS_MAP）。
      expect(fabricated).toEqual([]);
    });
  });

  describe("规则 2：self-driven 不得绕 facade 深 import 共享内核", () => {
    // 运行循环内核的"实现文件"——self-driven 必须经 AgentFactory/facade 间接使用，
    // 不得直接 import。注意：AiChatService（canonical 深 import 模式）与 AgentFactory
    // （facade 已 export 的工厂入口）是合法 DI 入口，不在此列，避免与 harness 既有模式双标。
    const FORBIDDEN_KERNEL_FRAGMENTS = [
      "runner/loop/react-loop",
      "runner/loop/loop-registry",
      "runner/tool-invoker/",
      "runner/executor/llm-executor",
      "agents/core/harnessed-agent",
      "tools/registry/tool.registry",
    ];

    it("self-driven 目录下的文件不深 import 共享内核（必须走 ai-harness/facade 或 ai-engine/facade）", () => {
      const files = listTsFiles(SELF_DRIVEN_DIR);
      expect(files.length).toBeGreaterThan(0); // 健全性

      const violations: string[] = [];
      for (const file of files) {
        const targets = extractImportTargets(file);
        for (const t of targets) {
          if (t.includes("/facade")) continue; // facade 是合法消费入口
          const hit = FORBIDDEN_KERNEL_FRAGMENTS.find((frag) =>
            t.includes(frag),
          );
          if (hit) {
            violations.push(
              `${path.relative(SRC_ROOT, file)}  →  "${t}" (kernel: ${hit})`,
            );
          }
        }
      }
      // 失败时 violations 数组即诊断信息：列出 "文件 → import路径 (kernel)"。
      // 修复方向：改为走 ai-harness/facade 或 ai-engine/facade re-export。
      expect(violations).toEqual([]);
    });
  });
});
