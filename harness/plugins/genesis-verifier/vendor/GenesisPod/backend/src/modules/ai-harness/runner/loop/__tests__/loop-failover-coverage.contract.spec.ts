/**
 * Loop failover coverage — regression contract
 *
 * 防止"新增/修改 loop 时漏接模型级 failover"再次发生（本轮根因）。规则：
 *   任何**直接调用** chatService.chat(...) 的 loop 实现，必须接入模型级 failover
 *   —— 即引用 executeWithModelFailover（simple/plan-act 共享 helper）或
 *   isModelLevelFailoverError（react-loop 自带 inline #66 实现）。
 *
 * 委托型 loop（reflexion → react、leader-worker → spawn subagent）不直调 chat，
 * 自动豁免：failover 由它们委托的下游 loop 继承。
 *
 * 一个未来的新 loop 若直调 chat 却不接 failover，这条测试立刻变红 —— CI 拦住。
 */

import * as fs from "fs";
import * as path from "path";

const LOOP_DIR = path.resolve(__dirname, "..");

const loopFiles = fs
  .readdirSync(LOOP_DIR)
  .filter((f) => f.endsWith("-loop.ts") && !f.endsWith(".spec.ts"));

describe("loop failover coverage contract", () => {
  it("discovers the loop implementations (react/reflexion/simple/plan-act/leader-worker)", () => {
    // Guards against the test silently passing because globbing broke.
    expect(loopFiles.length).toBeGreaterThanOrEqual(5);
  });

  it.each(loopFiles)(
    "%s — if it calls chatService.chat directly, it must wire model failover",
    (file) => {
      const src = fs.readFileSync(path.join(LOOP_DIR, file), "utf8");
      const callsChatDirectly = /chatService\.chat\s*\(/.test(src);
      if (!callsChatDirectly) {
        // Delegating loop (no direct LLM call) — failover inherited downstream.
        return;
      }
      const hasFailover =
        /executeWithModelFailover/.test(src) ||
        /isModelLevelFailoverError/.test(src);
      expect(hasFailover).toBe(true);
    },
  );
});
