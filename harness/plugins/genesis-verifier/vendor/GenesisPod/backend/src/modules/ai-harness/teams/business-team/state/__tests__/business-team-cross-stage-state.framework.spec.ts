/**
 * BusinessTeamCrossStageStateFramework spec —— 验证：
 *   - subclass typed getter/setter 通过 read/write 转发到底座
 *   - append / incr 经底座 CrossStageState
 *   - toJSON / has 转发到底座
 *   - constructor(initial?) 接 CrossStageState 注入实现 fromJSON pattern
 */

import { CrossStageState } from "../../../services/stages/abstractions/cross-stage-state";
import { BusinessTeamCrossStageStateFramework } from "../business-team-cross-stage-state.framework";

interface Plan {
  themeSummary: string;
  dims: number;
}

class TestSubclass extends BusinessTeamCrossStageStateFramework {
  get plan(): Plan | undefined {
    return this.read<Plan>("plan");
  }
  set plan(v: Plan | undefined) {
    this.write("plan", v);
  }
  appendFailure(reason: string): void {
    this.append("failures", reason);
  }
  bumpCount(): number {
    return this.incr("counter");
  }
  readFailures(): string[] | undefined {
    return this.read<string[]>("failures");
  }
  static fromJSON(data: Record<string, unknown>): TestSubclass {
    return new TestSubclass(CrossStageState.fromJSON(data));
  }
}

describe("BusinessTeamCrossStageStateFramework", () => {
  it("subclass getter/setter round-trip through read/write", () => {
    const s = new TestSubclass();
    expect(s.plan).toBeUndefined();
    s.plan = { themeSummary: "abc", dims: 5 };
    expect(s.plan).toEqual({ themeSummary: "abc", dims: 5 });
  });

  it("supports append accumulator via base CrossStageState", () => {
    const s = new TestSubclass();
    s.appendFailure("e1");
    s.appendFailure("e2");
    expect(s.readFailures()).toEqual(["e1", "e2"]);
  });

  it("supports incr counter via base CrossStageState", () => {
    const s = new TestSubclass();
    expect(s.bumpCount()).toBe(1);
    expect(s.bumpCount()).toBe(2);
  });

  it("has() reflects key presence", () => {
    const s = new TestSubclass();
    expect(s.has("plan")).toBe(false);
    s.plan = { themeSummary: "x", dims: 1 };
    expect(s.has("plan")).toBe(true);
  });

  it("toJSON serializes inner store; fromJSON rebuilds subclass with same data", () => {
    const s = new TestSubclass();
    s.plan = { themeSummary: "save-me", dims: 4 };
    s.appendFailure("oops");
    const json = s.toJSON();
    expect(json).toEqual({
      plan: { themeSummary: "save-me", dims: 4 },
      failures: ["oops"],
    });

    const restored = TestSubclass.fromJSON(json);
    expect(restored.plan).toEqual({ themeSummary: "save-me", dims: 4 });
    expect(restored.readFailures()).toEqual(["oops"]);
  });

  it("accepts an existing CrossStageState in constructor (fromJSON pattern)", () => {
    const inner = new CrossStageState({
      plan: { themeSummary: "ext", dims: 7 },
    });
    const s = new TestSubclass(inner);
    expect(s.plan).toEqual({ themeSummary: "ext", dims: 7 });
  });
});
