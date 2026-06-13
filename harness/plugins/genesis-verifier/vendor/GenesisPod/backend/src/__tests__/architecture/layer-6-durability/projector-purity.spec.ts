/**
 * projector-purity.spec.ts —— Projector 纯函数（ARCHITECTURE_RULES §3 + §6 + 硬规则 #6）
 *
 * 规则：projector 文件必须是纯函数。
 *   - 禁止 import 任何 `*Service` （会引入 DI → 副作用）
 *   - 禁止 import nestjs Injectable / Module （上述同源）
 *   - 禁止 import prisma （直接读库）
 *   - 禁止 emit events / 调 narrate
 *
 * 输入：events readonly array + persisted row
 * 输出：view object
 * 不写库、不发事件、不调外部服务。
 */

import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..", "..");

/**
 * 受规则约束的 projector 文件清单。
 * 任何 ai-app/<app>/mission/projectors/<name>.projector.ts 都进列表（自动发现）。
 */
function findProjectorFiles(): string[] {
  const root = path.join(PROJECT_ROOT, "src/modules/ai-app");
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const stack: string[] = [root];
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
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        stack.push(full);
      } else if (
        e.isFile() &&
        full.endsWith(".projector.ts") &&
        !full.endsWith(".spec.ts")
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * 例外：合法允许 import 的 *Service（type-only 用例）。
 * 检测方式：行首是 `import type {` 或 `import { ... } from` 后的内容不参与运行时。
 *
 * 禁忌清单（内联在 describe 块中）：
 *  - `*Service` import — DI 注入 = 副作用风险（type-only `import type` 例外）
 *  - `@nestjs/common` — Projector 不该 @Injectable
 *  - `PrismaService` import — projector 不该直读库
 *  - body 内 `prisma.` 写、`emit(`、`narrate(` — projector 无副作用
 */
function stripCommentsAndStrings(src: string): string {
  let out = src.replace(/^\s*\/\/.*$/gm, "");
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  return out;
}

function importLines(src: string): string[] {
  const stripped = stripCommentsAndStrings(src);
  const lines = stripped.split(/\r?\n/);
  const collected: string[] = [];
  let buffer = "";
  let inImport = false;
  for (const line of lines) {
    if (/^import\s/.test(line)) {
      inImport = true;
      buffer = line;
    } else if (inImport) {
      buffer += " " + line;
    }
    if (inImport && /;\s*$/.test(line)) {
      collected.push(buffer);
      buffer = "";
      inImport = false;
    }
  }
  return collected;
}

/**
 * type-only import 不算副作用风险 (TS 编译后 erased)。
 */
function isTypeOnlyImport(line: string): boolean {
  return /^import\s+type\s/.test(line.trim());
}

describe("§ projector purity (ARCHITECTURE_RULES §3 + §6 / 硬规则 #6)", () => {
  const projectorFiles = findProjectorFiles();

  it("发现至少 1 个 projector 文件（防 spec 自身退化）", () => {
    expect(projectorFiles.length).toBeGreaterThan(0);
  });

  for (const file of projectorFiles) {
    const rel = path.relative(PROJECT_ROOT, file);

    describe(`${rel}`, () => {
      let src = "";
      let imports: string[] = [];
      let body = "";
      try {
        src = fs.readFileSync(file, "utf-8");
        imports = importLines(src);
        body = stripCommentsAndStrings(src);
      } catch {
        // 读不到 file
      }

      it("不 import 任何 *Service（除 type-only）", () => {
        const violations = imports.filter((line) => {
          if (isTypeOnlyImport(line)) return false;
          // 把命名导入列表抠出来检查
          const m = line.match(/import\s+\{([^}]+)\}/);
          if (!m) return false;
          const names = m[1].split(",").map((n) => n.trim());
          return names.some(
            (n) =>
              /Service$/.test(n.replace(/\s+as\s+\w+/, "")) &&
              // 例外：ArtifactComposerService 是 query.service 调用的 service，但 projector 不直接 import；
              //       这里保持严格。如果未来确实需要某 Service，用 type-only import + 在 service 层包装。
              true,
          );
        });
        expect(violations).toEqual([]);
      });

      it("不 import @nestjs/common（projector 不该 @Injectable）", () => {
        const offender = imports.find((line) =>
          /from\s+["']@nestjs\/common["']/.test(line),
        );
        expect(offender).toBeUndefined();
      });

      it("不 import prisma.service（projector 不直接读库）", () => {
        const offender = imports.find((line) =>
          /\/prisma\/prisma\.service/.test(line),
        );
        expect(offender).toBeUndefined();
      });

      it("body 不调 prisma. / .emit( / narrate(（无副作用）", () => {
        const callsPrisma =
          /this\.prisma\.|new PrismaService|prisma\.\w+\.(create|update|delete|upsert)/.test(
            body,
          );
        const callsEmit = /\bdeps?\.emit\(|\.emit\s*\(/.test(body);
        const callsNarrate = /\bnarrate\s*\(/.test(body);
        const issues: string[] = [];
        if (callsPrisma) issues.push("prisma 写操作");
        if (callsEmit) issues.push("emit() 事件");
        if (callsNarrate) issues.push("narrate()");
        expect(issues).toEqual([]);
      });
    });
  }
});
