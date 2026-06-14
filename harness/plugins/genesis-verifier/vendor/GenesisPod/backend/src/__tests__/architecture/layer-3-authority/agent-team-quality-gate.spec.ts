/**
 * Agent-team quality gate —— standards/23 §5.2（2026-05-29）。
 *
 * 把"标杆质量纪律"从人工自觉变成机器门禁。本 spec 只锁**尚未被其它 spec 覆盖**的 3 条：
 *   - 规则 1：mission app 测试比 ≥ 35%（playground 41% / radar 实测来源）
 *   - 规则 5：每个 stage 文件 ≤ 1 个 stage runner class（一 step 一文件）
 *   - 规则 6：role.skillSpec.outputSchema 用真 zod，禁伪造 always-success 对象（lying assertion）
 *
 * 已由其它 spec 覆盖、本 spec 不重复（反过度抽象）：
 *   - facade 穿透 → agent-team-facade-contract.spec / playground-as-template.spec(T6)
 *   - any/console.log → ESLint
 *   - 终态写收口 → mission-contract-guards.spec(C0)
 *
 * ★ 单一真源：mission app 清单复用 mission-app-conformance.spec 的不变量风格——新增 mission
 *   app 时同步加进 MISSION_APP_DIRS，缺质量门即红。
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const APP_ROOT = join(__dirname, "../../../modules/ai-app");

/** mission 型 app 的目录名（新增 mission app 必须登记到此）。 */
const MISSION_APP_DIRS = ["playground", "radar", "social"];

/** 测试比阈值（playground 实测 ~41%，radar 达标；35% 为最低基线）。 */
const MIN_TEST_RATIO = 0.35;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const isSpec = (f: string): boolean =>
  f.includes("__tests__") || f.endsWith(".spec.ts");

describe("Agent-team quality gate — standards/23 §5.2", () => {
  // ── 规则 1：测试比 ≥ 35% ────────────────────────────────────────────────
  it.each(MISSION_APP_DIRS)("规则1: %s 测试比 ≥ 35%%", (appDir) => {
    const files = walkTsFiles(join(APP_ROOT, appDir));
    const specCount = files.filter(isSpec).length;
    const prodCount = files.filter((f) => !isSpec(f)).length;
    const ratio = prodCount === 0 ? 0 : specCount / prodCount;
    expect(ratio).toBeGreaterThanOrEqual(MIN_TEST_RATIO);
  });

  // ── 规则 5：一个 stage 文件最多一个 stage runner class ─────────────────────
  it.each(MISSION_APP_DIRS)(
    "规则5: %s 的 stages/ 下每个文件 ≤ 1 个 stage runner class",
    (appDir) => {
      const stagesDir = join(APP_ROOT, appDir, "mission/pipeline/stages");
      let files: string[];
      try {
        files = walkTsFiles(stagesDir).filter((f) => !isSpec(f));
      } catch {
        // app 可能未用 stages/ 子目录（最小骨架允许 inline），跳过即可。
        return;
      }
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        // 只统计实现 *StageRunner / *Stage 的具体 class，排除 type/interface。
        const stageClasses = (
          src.match(/export\s+class\s+\w*Stage\w*\s+implements/g) ?? []
        ).length;
        expect(stageClasses).toBeLessThanOrEqual(1);
      }
    },
  );

  // ── 规则 6：outputSchema 不得是伪造 always-success 对象 ──────────────────────
  it.each(MISSION_APP_DIRS)(
    "规则6: %s 禁用伪造 outputSchema(lying assertion)",
    (appDir) => {
      const files = walkTsFiles(join(APP_ROOT, appDir)).filter(
        (f) => !isSpec(f),
      );
      const offenders: string[] = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        // 伪造 schema 字面对象：outputSchema: { parse: (...) => ... } —— 真 zod 用 z.xxx()。
        if (/outputSchema\s*:\s*\{\s*parse\s*:/.test(src)) {
          offenders.push(f.replace(APP_ROOT, "ai-app"));
        }
      }
      expect(offenders).toEqual([]);
    },
  );

  it("登记的 mission app 集合非空(对注册项的不变量)", () => {
    expect(MISSION_APP_DIRS.length).toBeGreaterThan(0);
  });
});
