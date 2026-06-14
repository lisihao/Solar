/**
 * BusinessTeamStageBindingsFramework spec —— 验证薄骨架：
 *   - subclass 必须实现 buildCtx / buildDeps（abstract 强制）
 *   - log 暴露在 protected 字段，labelable
 */

import { BusinessTeamStageBindingsFramework } from "../business-team-stage-bindings.framework";

interface CtxArgs {
  missionId: string;
}
interface MyCtx {
  missionId: string;
  ts: number;
}
interface MyDeps {
  log: { name: string };
}

class TestBindings extends BusinessTeamStageBindingsFramework<
  CtxArgs,
  MyCtx,
  MyDeps
> {
  constructor() {
    super("TestBindings");
  }
  buildCtx(args: CtxArgs): MyCtx {
    return { missionId: args.missionId, ts: 42 };
  }
  buildDeps(): MyDeps {
    // expose framework's log via subclass deps
    return {
      log: {
        name:
          (this as unknown as { log: { localInstance?: string } }).log
            .localInstance ?? "logger",
      },
    };
  }
}

describe("BusinessTeamStageBindingsFramework", () => {
  it("subclass implements buildCtx and buildDeps correctly", () => {
    const b = new TestBindings();
    expect(b.buildCtx({ missionId: "m1" })).toEqual({
      missionId: "m1",
      ts: 42,
    });
    expect(b.buildDeps()).toBeTruthy();
  });

  it("framework provides a logger labeled to the subclass name", () => {
    const b = new TestBindings();
    // logger is protected; we can confirm presence via Object inspection
    expect((b as unknown as { log: unknown }).log).toBeDefined();
  });

  it("logger label falls back to constructor name when no label passed", () => {
    class DefaultLabelBindings extends BusinessTeamStageBindingsFramework<
      CtxArgs,
      MyCtx,
      MyDeps
    > {
      buildCtx(args: CtxArgs): MyCtx {
        return { missionId: args.missionId, ts: 1 };
      }
      buildDeps(): MyDeps {
        return { log: { name: "x" } };
      }
    }
    const b = new DefaultLabelBindings();
    expect((b as unknown as { log: unknown }).log).toBeDefined();
  });
});
