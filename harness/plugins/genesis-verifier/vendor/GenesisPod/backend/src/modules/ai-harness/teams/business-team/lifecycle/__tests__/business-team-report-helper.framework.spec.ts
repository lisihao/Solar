/**
 * P6 spec: BusinessTeamReportHelperFramework via FakeMarsReportHelper.
 */
import {
  FakeMarsReportHelper,
  makeFakeMarsReportHooks,
  type MarsReportRow,
} from "./__fixtures__/p6-fake-team-mocks";

describe("BusinessTeamReportHelperFramework (FakeMars)", () => {
  it("saveReportVersion: aggregate max +1; uses default label", async () => {
    const hooks = makeFakeMarsReportHooks({ maxVersion: 2 });
    const r = new FakeMarsReportHelper(hooks);
    const v = await r.saveReportVersion({
      missionId: "m1",
      triggerType: "complete",
      report: { title: "T", summary: "S" },
    });
    expect(v).toBe(3);
    expect(hooks.createVersion).toHaveBeenCalledTimes(1);
    const args = (hooks.createVersion as jest.Mock).mock.calls[0][0];
    expect(args.version).toBe(3);
    expect(args.versionLabel).toMatch(/^complete-\d{4}-\d{2}-\d{2}$/);
  });

  it("saveReportVersion: uses provided versionLabel override", async () => {
    const hooks = makeFakeMarsReportHooks({ maxVersion: 0 });
    const r = new FakeMarsReportHelper(hooks);
    await r.saveReportVersion({
      missionId: "m1",
      triggerType: "rerun",
      versionLabel: "custom-v2",
    });
    const args = (hooks.createVersion as jest.Mock).mock.calls[0][0];
    expect(args.versionLabel).toBe("custom-v2");
  });

  it("saveReportVersion: title sliced to 500 chars", async () => {
    const hooks = makeFakeMarsReportHooks({ maxVersion: 0 });
    const r = new FakeMarsReportHelper(hooks);
    const longTitle = "x".repeat(800);
    await r.saveReportVersion({
      missionId: "m1",
      triggerType: "complete",
      report: { title: longTitle, summary: "s" },
    });
    const args = (hooks.createVersion as jest.Mock).mock.calls[0][0];
    expect(args.reportTitle?.length).toBe(500);
  });

  it("saveReportVersion: transaction throw → returns 0", async () => {
    const hooks = makeFakeMarsReportHooks();
    (hooks.runSerializable as jest.Mock).mockRejectedValue(new Error("db"));
    const r = new FakeMarsReportHelper(hooks);
    expect(
      await r.saveReportVersion({
        missionId: "m1",
        triggerType: "x",
      }),
    ).toBe(0);
  });

  it("listReportVersions delegates", async () => {
    const rows: MarsReportRow[] = [
      {
        id: "v1",
        version: 1,
        versionLabel: "v1",
        reportTitle: "t",
        reportSummary: "s",
        triggerType: "x",
        generatedAt: new Date(),
        mission: "m1",
      },
    ];
    const hooks = makeFakeMarsReportHooks({ rows });
    const r = new FakeMarsReportHelper(hooks);
    expect(await r.listReportVersions("m1")).toEqual(rows);
  });

  it("listReportVersions: error → empty array", async () => {
    const hooks = makeFakeMarsReportHooks();
    (hooks.listVersions as jest.Mock).mockRejectedValue(new Error("db"));
    const r = new FakeMarsReportHelper(hooks);
    expect(await r.listReportVersions("m1")).toEqual([]);
  });

  it("getReportVersion: found version delegates", async () => {
    const rows: MarsReportRow[] = [
      {
        id: "v3",
        version: 3,
        versionLabel: "label3",
        reportTitle: null,
        reportSummary: null,
        triggerType: "complete",
        generatedAt: new Date(),
        mission: "m1",
      },
    ];
    const hooks = makeFakeMarsReportHooks({ rows });
    const r = new FakeMarsReportHelper(hooks);
    const got = await r.getReportVersion("m1", 3);
    expect(got?.version).toBe(3);
  });

  it("getReportVersion: error → null", async () => {
    const hooks = makeFakeMarsReportHooks();
    (hooks.findVersion as jest.Mock).mockRejectedValue(new Error("db"));
    const r = new FakeMarsReportHelper(hooks);
    expect(await r.getReportVersion("m1", 3)).toBeNull();
  });
});
