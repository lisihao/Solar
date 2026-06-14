/**
 * P6 spec: BusinessTeamUpdateHelperFramework via FakeMarsUpdateHelper.
 */
import {
  FakeMarsUpdateHelper,
  makeFakeMarsUpdateHooks,
} from "./__fixtures__/p6-fake-team-mocks";

describe("BusinessTeamUpdateHelperFramework (FakeMars)", () => {
  it("runUpdate: userId present → updateManyByOwner", async () => {
    const hooks = makeFakeMarsUpdateHooks();
    const u = new FakeMarsUpdateHelper(hooks);
    await u.testRunUpdate("m1", "u1", { topic: "Mars" }, "label");
    expect(hooks.updateManyByOwner).toHaveBeenCalledWith("m1", "u1", {
      topic: "Mars",
    });
    expect(hooks.updateAnyById).not.toHaveBeenCalled();
  });

  it("runUpdate: userId missing → updateAnyById fallback", async () => {
    const hooks = makeFakeMarsUpdateHooks();
    const u = new FakeMarsUpdateHelper(hooks);
    await u.testRunUpdate("m1", undefined, { topic: "Mars" }, "label");
    expect(hooks.updateAnyById).toHaveBeenCalledWith("m1", {
      topic: "Mars",
    });
  });

  it("runUpdate: DB error → swallowed (log warn)", async () => {
    const hooks = makeFakeMarsUpdateHooks();
    (hooks.updateManyByOwner as jest.Mock).mockRejectedValue(new Error("db"));
    const u = new FakeMarsUpdateHelper(hooks);
    await expect(
      u.testRunUpdate("m1", "u1", { topic: "Mars" }, "label"),
    ).resolves.toBeUndefined();
  });

  it("resetFieldsFrameworkCore: snake→camel + status skip + null values", async () => {
    const hooks = makeFakeMarsUpdateHooks();
    const u = new FakeMarsUpdateHelper(hooks);
    await u.testResetFields(
      "m1",
      ["status", "report_full", "final_score", "unmapped_field"],
      { report_full: "reportFull", final_score: "finalScore" },
      "u1",
    );
    expect(hooks.updateManyByOwner).toHaveBeenCalledWith("m1", "u1", {
      reportFull: null,
      finalScore: null,
    });
  });

  it("resetFieldsFrameworkCore: empty fields → no update call", async () => {
    const hooks = makeFakeMarsUpdateHooks();
    const u = new FakeMarsUpdateHelper(hooks);
    await u.testResetFields("m1", [], {}, "u1");
    expect(hooks.updateManyByOwner).not.toHaveBeenCalled();
  });

  it("resetFieldsFrameworkCore: only unmapped fields → no update call", async () => {
    const hooks = makeFakeMarsUpdateHooks();
    const u = new FakeMarsUpdateHelper(hooks);
    await u.testResetFields("m1", ["xxx", "yyy"], { foo: "bar" }, "u1");
    expect(hooks.updateManyByOwner).not.toHaveBeenCalled();
  });
});
