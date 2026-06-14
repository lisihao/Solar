/**
 * C5/C6 app 接入看护 spec —— §0.8 评审共识补的守护(2026-05-22)。
 *
 * 锁住 playground 已落地的 config-snapshot 单一真源,防回退:
 *   1. rerun/hydrate 重建 input 必须读 configSnapshot,不得回退读 userProfile(防双读)。
 *   2. 改预算(updateBudgetByUser)必须经 applyInputPatch 派生新 snapshot(G2,否则 rerun 用 stale)。
 *   3. snapshot 派生只能经 rebuilder/applyInputPatch(不得手赋 snapshotId 断谱系)。
 */

import { readFileSync } from "fs";
import { join } from "path";

const APP = join(__dirname, "../../../modules/ai-app/playground");
const read = (rel: string): string => readFileSync(join(APP, rel), "utf8");

describe("C5/C6 config-snapshot 接入看护 (§0.8)", () => {
  it("ctx-hydrator 从 configSnapshot 重建 input,不再用 userProfile 拼 RunMissionInput", () => {
    const src = read("mission/rerun/ctx-hydrator.service.ts");
    expect(src).toMatch(/configSnapshot|PlaygroundConfigSnapshot/);
    expect(src).toContain("snap.businessInput");
    // 旧的 userProfile→input 重建 cast 必须已删(否则双源重建)
    expect(src).not.toMatch(/userProfile as Partial<RunMissionInput>/);
  });

  it("mission-rerun-orchestrator.cloneInputFromMission 读 configSnapshot 而非 userProfile", () => {
    const src = read("mission/rerun/mission-rerun-orchestrator.service.ts");
    expect(src).toMatch(/configSnapshot|PlaygroundConfigSnapshot/);
    expect(src).not.toMatch(/userProfile as Partial<RunMissionInput>/);
  });

  it("改预算 updateBudgetByUser 经 applyInputPatch 派生新 snapshot(G2)", () => {
    const src = read("mission/lifecycle/mission-update.helper.ts");
    expect(src).toContain("applyInputPatch");
    expect(src).toContain("configSnapshot");
  });

  it("rebuilder 用 harness applyInputPatch 派生(不手赋 snapshotId 断谱系)", () => {
    const src = read("runtime/playground.input-rebuilder.ts");
    expect(src).toContain("applyInputPatch");
    expect(src).toContain("buildForFreshRun");
  });
});
