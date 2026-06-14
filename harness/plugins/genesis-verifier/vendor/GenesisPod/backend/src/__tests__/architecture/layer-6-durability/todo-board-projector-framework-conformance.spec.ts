/**
 * todo-board-projector-framework-conformance.spec.ts —— Anti-regression
 *
 * Per projector-framework-lift-plan §4 "看护机制":
 *   "任何 ai-app/<app>/mission/projectors/*-todo-board.projector.ts 必须
 *    extends BusinessTeamTodoBoardProjectorFramework"
 *
 * 防止：将来有人在新 ai-app 加 todo-board projector 时绕开 framework 直接写，导致
 * 三套实现重新分叉。读源码（grep）+ 简单 AST 启发式判定。
 */

import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..", "..");

/**
 * 例外白名单 —— 当前为空。
 * 所有 mission app 的 todo-board projector 都已真正 extends framework 并使用其
 * helpers（this.upsert / this.evSuffix / this.getStepId / this.getString /
 * this.getNumber）。playground 因业务深度高 override 了 project() 顶层流，但仍在
 * 1620-LOC method body 内大量调用 framework 的 helper 方法 —— 这是 honest
 * extends，不是 cosmetic wrapper。
 */
const EXEMPT_PATHS: ReadonlySet<string> = new Set<string>([]);

// Discover all todo-board projector files in ai-app/.
function findTodoBoardProjectors(): string[] {
  const root = path.join(PROJECT_ROOT, "src/modules/ai-app");
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
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
      } else if (e.isFile() && full.endsWith("-todo-board.projector.ts")) {
        out.push(full);
      } else if (
        e.isFile() &&
        // Playground uses bare "todo-board.projector.ts" (no app prefix).
        full.endsWith("/todo-board.projector.ts")
      ) {
        out.push(full);
      } else if (
        e.isFile() &&
        full.endsWith("\\todo-board.projector.ts") // Windows path
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

describe("§ todo-board projector framework conformance", () => {
  const files = findTodoBoardProjectors();

  it("发现 ≥ 3 个 todo-board projector（防 spec 自身退化）", () => {
    // playground / social / radar
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const f of files) {
    const rel = path.relative(PROJECT_ROOT, f).replace(/\\/g, "/");
    if (EXEMPT_PATHS.has(rel)) continue;

    it(`${rel} extends BusinessTeamTodoBoardProjectorFramework`, () => {
      const src = fs.readFileSync(f, "utf-8");
      // 必须 import framework symbol
      const importsFramework = /BusinessTeamTodoBoardProjectorFramework/.test(
        src,
      );
      expect(importsFramework).toBe(true);

      // 必须有 class ... extends BusinessTeamTodoBoardProjectorFramework
      const extendsFramework =
        /class\s+\w+\s+extends\s+BusinessTeamTodoBoardProjectorFramework/.test(
          src,
        );
      expect(extendsFramework).toBe(true);

      // 必须通过 facade 导入（不得穿透 harness 内部路径）
      const directInternalImport =
        /from\s+["']@\/modules\/ai-harness\/teams\/business-team\//.test(src);
      expect(directInternalImport).toBe(false);
    });
  }
});
