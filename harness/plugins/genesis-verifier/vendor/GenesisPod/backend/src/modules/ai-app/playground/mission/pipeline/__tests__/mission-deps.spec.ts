/**
 * mission-deps.spec.ts
 *
 * mission-deps.ts is a pure type definition file (only interfaces and type aliases).
 * There is no runtime logic to test — this file is intentionally skipped per spec.
 *
 * We add a minimal smoke test to confirm the module can be imported without errors.
 */

// Importing the types to ensure the module resolves correctly
import type {
  MissionDeps,
  EmitFn,
  LifecycleFn,
} from "../../context/mission-deps";

describe("mission-deps (types only)", () => {
  it("can be imported without error", () => {
    // All exports are types; no runtime behaviour to test.
    // The type assertions below ensure TS compiles correctly.
    const emitFn: EmitFn = jest.fn().mockResolvedValue(undefined);
    const lifecycleFn: LifecycleFn = jest.fn().mockResolvedValue(undefined);
    expect(typeof emitFn).toBe("function");
    expect(typeof lifecycleFn).toBe("function");
  });

  it("EmitFn accepts the expected shape", async () => {
    const emit: EmitFn = jest.fn().mockResolvedValue(undefined);
    await emit({
      type: "test:event",
      missionId: "m1",
      userId: "u1",
      payload: { key: "value" },
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("LifecycleFn accepts the expected signature", async () => {
    const lifecycle: LifecycleFn = jest.fn().mockResolvedValue(undefined);
    await lifecycle("m1", "u1", "agent#0", "researcher", "started", {
      dimension: "Technology",
    });
    expect(lifecycle).toHaveBeenCalledWith(
      "m1",
      "u1",
      "agent#0",
      "researcher",
      "started",
      { dimension: "Technology" },
    );
  });

  it("MissionDeps shape can be satisfied by a partial mock", () => {
    const partialDeps: Partial<MissionDeps> = {
      missionId: undefined as never,
    };
    // Shape check — no runtime assertion, just ensures the type compiles
    expect(partialDeps).toBeDefined();
  });
});
