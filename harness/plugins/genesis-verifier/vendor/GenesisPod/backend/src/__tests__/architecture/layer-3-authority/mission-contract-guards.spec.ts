/**
 * Mission 契约看护 spec —— G10 / RM1（2026-05-22）。
 *
 * L1 类型是主防线(值对象私有构造 / abort enum / patch 白名单 —— 编译期);本 spec 是 L3
 * **补充**守护(grep 级,收窄到具体目录,避免全仓误伤,见 §0.5 RM1)。只锁两条机械不变量:
 *   1. credits→usd/tokens 换算只在 ResolvedBudgetCaps 一处(guardrails/budget 目录内扫散落)。
 *   2. C2 failure category 只能由 codeToCategory 派生(mission-failure.ts 不得出现独立 category 字面量赋值)。
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const BUDGET_DIR = join(
  __dirname,
  "../../../modules/ai-harness/guardrails/budget",
);

/** 已切换到 C0 finalize 单入口的 mission app（终态写必须经 finalize，禁旁路）。 */
const CUTOVER_MISSION_APPS = ["playground", "social", "radar"] as const;

function appDir(app: string): string {
  return join(__dirname, "../../../modules/ai-app", app);
}

/** 收集目录下所有非 spec 的 .ts 生产文件。 */
function collectProdTsFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "__tests__" && ent.name !== "__mocks__") walk(p);
        continue;
      }
      if (!ent.name.endsWith(".ts") || ent.name.endsWith(".spec.ts")) continue;
      out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** 是否注释行（跳过 JSDoc / 行注释里对方法名的文字提及，避免误报）。 */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** 在生产代码非注释行里找匹配 pattern 的 file:line（用于 grep 级守护）。 */
function findOffenders(files: string[], pattern: RegExp): string[] {
  const offenders: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      if (pattern.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  return offenders;
}

describe("mission 契约看护 (G10/L3，补充层)", () => {
  it("credits 换算字面量(× 0.002 / × 1000)只允许出现在 resolved-budget-caps.ts", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name !== "__tests__") walk(p);
          continue;
        }
        if (!ent.name.endsWith(".ts") || ent.name.endsWith(".spec.ts"))
          continue;
        if (ent.name === "resolved-budget-caps.ts") continue; // 唯一换算处(白名单)
        const src = readFileSync(p, "utf8");
        // 词边界:* 0.002 / * 1000(credits 换算)。budget 目录内别处不得散落。
        if (/\*\s*0\.002\b/.test(src) || /\*\s*1000\b/.test(src)) {
          offenders.push(p);
        }
      }
    };
    walk(BUDGET_DIR);
    expect(offenders).toEqual([]);
  });

  it("mission-failure.ts:category 由 codeToCategory 派生(buildMissionFailure 不独立赋 category)", () => {
    const src = readFileSync(
      join(
        __dirname,
        "../../../modules/ai-harness/lifecycle/mission-lifecycle/abstractions/mission-failure.ts",
      ),
      "utf8",
    );
    // buildMissionFailure 必须用 codeToCategory(code) 产出 category,不得写死 FailureCategory.xxx
    expect(src).toContain("category: codeToCategory(code)");
  });
});

/**
 * ★ C0/G1 终态写收口看护（2026-05-22，#4）。
 *
 * 设计契约：mission 终态（completed/failed/cancelled）唯一经
 * `MissionLifecycleManager.finalize → arbiter.applyTerminalIfRunning` 单入口仲裁
 * （条件写 WHERE status='running' 首写赢）。已切换 app（playground/social/radar）的
 * 生产代码**禁止**：① 直调 store 旧终态写 markCompleted/markFailed/markCancelled/
 * markFailedByLiveness；② 直调 arbiter `applyTerminalIfRunning`（必须走 finalize）。
 * 并要求 finalize 漏斗**真被使用**（防把终态写整体退回旧路径而前两条仍为 0）。
 *
 * baseline=0 焊死（2026-05-22 social+playground+radar 均已无旁路）。新旁路即红，合不进。
 */
describe("C0 终态写收口看护 (#4，baseline=0 焊死)", () => {
  it.each(CUTOVER_MISSION_APPS)(
    "%s：禁止直调 store 旧终态写 markX/markFailedByLiveness（须经 finalize）",
    (app) => {
      const files = collectProdTsFiles(appDir(app));
      const offenders = findOffenders(
        files,
        /\.(markCompleted|markFailed|markCancelled|markFailedByLiveness)\(/,
      );
      expect(offenders).toEqual([]);
    },
  );

  it.each(CUTOVER_MISSION_APPS)(
    "%s：禁止直调 arbiter applyTerminalIfRunning（须经 lifecycleManager.finalize）",
    (app) => {
      const files = collectProdTsFiles(appDir(app));
      // arbiter 定义本身是 `async applyTerminalIfRunning(`（无前导点），不被此 pattern 命中。
      const offenders = findOffenders(files, /\.applyTerminalIfRunning\(/);
      expect(offenders).toEqual([]);
    },
  );

  it.each(CUTOVER_MISSION_APPS)(
    "%s：finalize 中央漏斗真被使用（终态写未退回旧路径）",
    (app) => {
      const files = collectProdTsFiles(appDir(app));
      const usesFinalize = files.some((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .some(
            (line) =>
              !isCommentLine(line) && /lifecycleManager\.finalize/.test(line),
          ),
      );
      expect(usesFinalize).toBe(true);
    },
  );
});
