/**
 * IMissionStore + IMissionEventStore in-memory adapter spec (v5.1 R1-C)
 */
import {
  InMemoryMissionStore,
  InMemoryMissionEventStore,
} from "../../in-memory";

describe("InMemoryMissionStore (v5.1 R1-C)", () => {
  it("create + getById 往返", async () => {
    const s = new InMemoryMissionStore();
    const r = await s.create({
      missionId: "m1",
      userId: "u1",
      pipelineId: "test",
      input: { topic: "x" },
    });
    expect(r.status).toBe("running");
    expect(r.crossStageState).toEqual({});
    expect(r.roleDecisions).toEqual({});

    const fetched = await s.getById("m1");
    expect(fetched?.input).toEqual({ topic: "x" });
  });

  it("create 重复 missionId 抛错", async () => {
    const s = new InMemoryMissionStore();
    await s.create({
      missionId: "m1",
      pipelineId: "p",
      input: {},
    });
    await expect(
      s.create({ missionId: "m1", pipelineId: "p", input: {} }),
    ).rejects.toThrow(/already exists/);
  });

  it("listByUser：按 userId 过滤 + startedAt 降序", async () => {
    const s = new InMemoryMissionStore();
    await s.create({
      missionId: "m1",
      userId: "u1",
      pipelineId: "p",
      input: {},
    });
    await new Promise((r) => setTimeout(r, 5));
    await s.create({
      missionId: "m2",
      userId: "u1",
      pipelineId: "p",
      input: {},
    });
    await s.create({
      missionId: "m3",
      userId: "u2",
      pipelineId: "p",
      input: {},
    });
    const list = await s.listByUser("u1");
    expect(list.map((m) => m.missionId)).toEqual(["m2", "m1"]); // 新→旧
  });

  it("updateStatus → completed + result", async () => {
    const s = new InMemoryMissionStore();
    await s.create({ missionId: "m1", pipelineId: "p", input: {} });
    await s.updateStatus("m1", {
      status: "completed",
      completedAt: new Date(),
      result: { score: 0.9 },
    });
    const m = await s.getById("m1");
    expect(m?.status).toBe("completed");
    expect(m?.result).toEqual({ score: 0.9 });
  });

  it("setLastCompletedStepId：resume 起点持久化", async () => {
    const s = new InMemoryMissionStore();
    await s.create({ missionId: "m1", pipelineId: "p", input: {} });
    await s.setLastCompletedStepId("m1", "s3-research");
    const m = await s.getById("m1");
    expect(m?.lastCompletedStepId).toBe("s3-research");
  });

  it("appendDecision + getDecisions：stateful role 跨 stage 累计", async () => {
    const s = new InMemoryMissionStore();
    await s.create({ missionId: "m1", pipelineId: "p", input: {} });
    await s.appendDecision("m1", "leader", {
      phase: "plan",
      decision: "split into 3 dimensions",
      timestamp: 1000,
    });
    await s.appendDecision("m1", "leader", {
      phase: "assess",
      decision: "continue",
      timestamp: 2000,
    });
    const d = await s.getDecisions("m1", "leader");
    expect(d).toHaveLength(2);
    expect(d[0].phase).toBe("plan");
    expect(d[1].phase).toBe("assess");
  });

  it("saveCrossStageState + getCrossStageState：跨 stage 副作用持久化", async () => {
    const s = new InMemoryMissionStore();
    await s.create({ missionId: "m1", pipelineId: "p", input: {} });
    await s.saveCrossStageState("m1", {
      "playground.s4PatchFailures": ["dim-2"],
      "playground.s4PatchRound": 1,
    });
    const state = await s.getCrossStageState("m1");
    expect(state["playground.s4PatchFailures"]).toEqual(["dim-2"]);
    expect(state["playground.s4PatchRound"]).toBe(1);
  });

  it("getById nonexistent → null（fail-soft）", async () => {
    const s = new InMemoryMissionStore();
    expect(await s.getById("missing")).toBeNull();
  });

  it("getDecisions nonexistent → empty array", async () => {
    const s = new InMemoryMissionStore();
    expect(await s.getDecisions("missing", "leader")).toEqual([]);
  });
});

describe("InMemoryMissionEventStore (v5.1 R1-C)", () => {
  it("append + listByMission 往返", async () => {
    const s = new InMemoryMissionEventStore();
    await s.append({
      missionId: "m1",
      eventId: "e1",
      type: "stage:started",
      payload: {},
      ts: 1000,
    });
    const events = await s.listByMission("m1");
    expect(events).toHaveLength(1);
  });

  it("listByMission：ts 升序", async () => {
    const s = new InMemoryMissionEventStore();
    await s.append({
      missionId: "m1",
      eventId: "e2",
      type: "y",
      payload: {},
      ts: 2000,
    });
    await s.append({
      missionId: "m1",
      eventId: "e1",
      type: "x",
      payload: {},
      ts: 1000,
    });
    const events = await s.listByMission("m1");
    expect(events.map((e) => e.eventId)).toEqual(["e1", "e2"]);
  });

  it("appendBatch", async () => {
    const s = new InMemoryMissionEventStore();
    await s.appendBatch([
      { missionId: "m1", eventId: "1", type: "a", payload: {}, ts: 1 },
      { missionId: "m1", eventId: "2", type: "b", payload: {}, ts: 2 },
      { missionId: "m1", eventId: "3", type: "c", payload: {}, ts: 3 },
    ]);
    expect(await s.listByMission("m1")).toHaveLength(3);
  });

  it("listByMission limit / sinceTs 过滤", async () => {
    const s = new InMemoryMissionEventStore();
    await s.appendBatch([
      { missionId: "m1", eventId: "1", type: "a", payload: {}, ts: 1 },
      { missionId: "m1", eventId: "2", type: "b", payload: {}, ts: 2 },
      { missionId: "m1", eventId: "3", type: "c", payload: {}, ts: 3 },
    ]);
    expect(await s.listByMission("m1", { limit: 2 })).toHaveLength(2);
    expect(await s.listByMission("m1", { sinceTs: 1 })).toHaveLength(2); // 严格 > 1
  });

  it("deleteByMission", async () => {
    const s = new InMemoryMissionEventStore();
    await s.append({
      missionId: "m1",
      eventId: "1",
      type: "x",
      payload: {},
      ts: 1,
    });
    await s.deleteByMission("m1");
    expect(await s.listByMission("m1")).toEqual([]);
  });

  it("nonexistent mission → empty array", async () => {
    const s = new InMemoryMissionEventStore();
    expect(await s.listByMission("missing")).toEqual([]);
  });
});
