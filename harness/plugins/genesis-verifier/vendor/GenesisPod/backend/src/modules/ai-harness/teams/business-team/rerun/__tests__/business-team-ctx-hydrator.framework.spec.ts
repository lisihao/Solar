/**
 * Framework spec：BusinessTeamCtxHydratorFramework
 *
 * 验证 framework 真可被复用：fake MarsTeam schemaProvider 提供 fetchDetail / assertSnapshot /
 * buildHydrated，framework 应正确编排 NotFound 短路 + size guard + snapshot 校验。
 */

import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  FakeMarsCtxHydrator,
  makeFakeHydratorSchema,
} from "./__fixtures__/p5-fake-team-mocks";

describe("BusinessTeamCtxHydratorFramework (fake MarsTeam)", () => {
  it("fetchDetail null → NotFoundException", async () => {
    const h = new FakeMarsCtxHydrator(makeFakeHydratorSchema({}), "mars");
    await expect(h.hydrate("m1", "u1")).rejects.toThrow(NotFoundException);
  });

  it("snapshot missing → BadRequestException with reason", async () => {
    const h = new FakeMarsCtxHydrator(
      makeFakeHydratorSchema({
        detail: { id: "m1", configSnapshot: null, marsTopic: "t" },
        snapshotOk: false,
        snapshotReason: "legacy snapshot",
      }),
      "mars",
    );
    await expect(h.hydrate("m1", "u1")).rejects.toThrow(/legacy snapshot/);
  });

  it("report_full > maxBytes → BadRequestException DoS guard", async () => {
    const bigPayload = { data: "x".repeat(10_000) };
    const schema = makeFakeHydratorSchema({
      detail: {
        id: "m1",
        configSnapshot: {},
        reportFull: bigPayload,
        marsTopic: "t",
      },
      maxReportFullBytes: 1_000,
    });
    const h = new FakeMarsCtxHydrator(schema, "mars");
    await expect(h.hydrate("m1", "u1")).rejects.toThrow(/DoS 防护/);
  });

  it("happy path: snapshot ok + size ok → buildHydrated invoked", async () => {
    const schema = makeFakeHydratorSchema({
      detail: { id: "m1", configSnapshot: { v: 1 }, marsTopic: "mars-rover" },
    });
    const r = await new FakeMarsCtxHydrator(schema, "mars").hydrate("m1", "u1");
    expect(r).toEqual({
      missionId: "m1",
      userId: "u1",
      marsTopic: "mars-rover",
      __hydrated: true,
    });
    expect(schema.buildHydrated).toHaveBeenCalledWith({
      detail: expect.objectContaining({ id: "m1" }),
      missionId: "m1",
      userId: "u1",
    });
  });

  it("buildHydrated throw propagates (business 决定具体异常类型)", async () => {
    const err = new BadRequestException("report parse fail");
    const schema = makeFakeHydratorSchema({
      detail: { id: "m1", configSnapshot: { v: 1 }, marsTopic: "t" },
      buildHydratedThrow: err,
    });
    await expect(
      new FakeMarsCtxHydrator(schema, "mars").hydrate("m1", "u1"),
    ).rejects.toBe(err);
  });

  it("no reportFull field → size guard skipped (business can omit reportFull)", async () => {
    const schema = makeFakeHydratorSchema({
      detail: { id: "m1", configSnapshot: { v: 1 }, marsTopic: "t" },
    });
    await expect(
      new FakeMarsCtxHydrator(schema, "mars").hydrate("m1", "u1"),
    ).resolves.toBeDefined();
  });

  it("uses default maxReportFullBytes=2MB when schemaProvider omits override", async () => {
    const payload = { data: "x".repeat(100) }; // small, under 2MB
    const schema = makeFakeHydratorSchema({
      detail: {
        id: "m1",
        configSnapshot: { v: 1 },
        reportFull: payload,
        marsTopic: "t",
      },
    });
    // should NOT throw
    await expect(
      new FakeMarsCtxHydrator(schema, "mars").hydrate("m1", "u1"),
    ).resolves.toBeDefined();
  });
});
