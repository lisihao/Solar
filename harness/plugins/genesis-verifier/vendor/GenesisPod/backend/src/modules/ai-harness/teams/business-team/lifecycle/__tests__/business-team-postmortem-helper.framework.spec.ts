/**
 * P6 spec: BusinessTeamPostmortemHelperFramework via FakeMarsPostmortemHelper.
 */
import {
  FakeMarsPostmortemHelper,
  makeFakeMarsPostmortemHooks,
  type MarsPostmortemListItem,
} from "./__fixtures__/p6-fake-team-mocks";

describe("BusinessTeamPostmortemHelperFramework (FakeMars)", () => {
  it("recordMissionPostmortem: no embeddingPort → empty embedding + delegates create", async () => {
    const hooks = makeFakeMarsPostmortemHooks();
    const p = new FakeMarsPostmortemHelper(hooks);
    await p.recordMissionPostmortem({
      missionId: "m1",
      userId: "u1",
      topic: "Mars exploration",
      summary: "summary",
      leaderSigned: true,
    });
    expect(hooks.createVectorMemory).toHaveBeenCalledTimes(1);
    const args = (hooks.createVectorMemory as jest.Mock).mock.calls[0][0];
    expect(args.embedding).toEqual([]);
  });

  it("recordMissionPostmortem: embeddingPort returns embedding → forwarded", async () => {
    const hooks = makeFakeMarsPostmortemHooks({ embedding: [0.1, 0.2] });
    const p = new FakeMarsPostmortemHelper(hooks);
    await p.recordMissionPostmortem({
      missionId: "m1",
      userId: "u1",
      topic: "T",
      summary: "S",
      leaderSigned: null,
    });
    const args = (hooks.createVectorMemory as jest.Mock).mock.calls[0][0];
    expect(args.embedding).toEqual([0.1, 0.2]);
  });

  it("recordMissionPostmortem: embedding throws → fall back to empty (log warn)", async () => {
    const hooks = makeFakeMarsPostmortemHooks({ embedding: "throw" });
    const p = new FakeMarsPostmortemHelper(hooks);
    await p.recordMissionPostmortem({
      missionId: "m1",
      userId: "u1",
      topic: "T",
      summary: "S",
      leaderSigned: null,
    });
    const args = (hooks.createVectorMemory as jest.Mock).mock.calls[0][0];
    expect(args.embedding).toEqual([]);
  });

  it("recordMissionPostmortem: createVectorMemory error swallowed (warn)", async () => {
    const hooks = makeFakeMarsPostmortemHooks();
    (hooks.createVectorMemory as jest.Mock).mockRejectedValue(new Error("x"));
    const p = new FakeMarsPostmortemHelper(hooks);
    await expect(
      p.recordMissionPostmortem({
        missionId: "m1",
        userId: "u1",
        topic: "T",
        summary: "S",
        leaderSigned: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("listRecentPostmortems: no recent mission → single fetch, no race wait", async () => {
    const hooks = makeFakeMarsPostmortemHooks({
      recentMissionId: null,
      rowsSequence: [
        [
          {
            missionId: "m_old",
            topic: "old",
            summary: "...",
            leaderSigned: true,
            createdAt: new Date(),
            recommendations: ["a"],
          },
        ],
      ],
    });
    const p = new FakeMarsPostmortemHelper(hooks);
    const rows = await p.listRecentPostmortems("u1", 3);
    expect(rows).toHaveLength(1);
    expect(hooks.listCallCount()).toBe(1);
  });

  it("listRecentPostmortems: recent mission already in rows → no race poll", async () => {
    const items: MarsPostmortemListItem[] = [
      {
        missionId: "m_recent",
        topic: "t",
        summary: "s",
        leaderSigned: true,
        createdAt: new Date(),
        recommendations: [],
      },
    ];
    const hooks = makeFakeMarsPostmortemHooks({
      recentMissionId: "m_recent",
      rowsSequence: [items],
    });
    const p = new FakeMarsPostmortemHelper(hooks);
    await p.listRecentPostmortems("u1", 3);
    expect(hooks.listCallCount()).toBe(1);
  });

  it("listRecentPostmortems clamps limit to [1, 10]", async () => {
    const hooks = makeFakeMarsPostmortemHooks({ recentMissionId: null });
    const p = new FakeMarsPostmortemHelper(hooks);
    await p.listRecentPostmortems("u1", 0);
    expect(hooks.listVectorMemories).toHaveBeenCalledWith("u1", 1, undefined);
    await p.listRecentPostmortems("u1", 99);
    expect(hooks.listVectorMemories).toHaveBeenLastCalledWith(
      "u1",
      10,
      undefined,
    );
  });

  it("listRecentPostmortems: findRecentMissionId throws → degrade to plain fetch", async () => {
    const hooks = makeFakeMarsPostmortemHooks({
      recentMissionId: null,
    });
    (hooks.findRecentMissionId as jest.Mock).mockRejectedValue(new Error("db"));
    const p = new FakeMarsPostmortemHelper(hooks);
    const r = await p.listRecentPostmortems("u1", 3);
    expect(r).toEqual([]);
  });

  // ── semantic recall (queryText) ──────────────────────────────────────────

  it("listRecentPostmortems: queryText + embeddingPort → listVectorMemories called with embedding", async () => {
    const embedding = [0.1, 0.2, 0.3];
    const hooks = makeFakeMarsPostmortemHooks({
      recentMissionId: null,
      embedding,
    });
    const p = new FakeMarsPostmortemHelper(hooks);
    await p.listRecentPostmortems("u1", 3, "AI trends");
    expect(hooks.embeddingPort!.generateEmbedding).toHaveBeenCalledWith(
      "AI trends",
    );
    expect(hooks.listVectorMemories).toHaveBeenCalledWith("u1", 3, embedding);
  });

  it("listRecentPostmortems: queryText but no embeddingPort → listVectorMemories called with undefined (recency)", async () => {
    const hooks = makeFakeMarsPostmortemHooks({
      recentMissionId: null,
      // no embedding → embeddingPort is undefined
    });
    const p = new FakeMarsPostmortemHelper(hooks);
    await p.listRecentPostmortems("u1", 3, "some topic");
    expect(hooks.listVectorMemories).toHaveBeenCalledWith("u1", 3, undefined);
  });

  it("listRecentPostmortems: queryText + embeddingPort throws → degrade to recency (listVectorMemories with undefined)", async () => {
    const hooks = makeFakeMarsPostmortemHooks({
      recentMissionId: null,
      embedding: "throw",
    });
    const p = new FakeMarsPostmortemHelper(hooks);
    await p.listRecentPostmortems("u1", 3, "AI topic");
    // embedding failed → queryEmbedding is undefined → recency path
    expect(hooks.listVectorMemories).toHaveBeenCalledWith("u1", 3, undefined);
  });

  it("listRecentPostmortems: no queryText → listVectorMemories called with undefined regardless of embeddingPort", async () => {
    const hooks = makeFakeMarsPostmortemHooks({
      recentMissionId: null,
      embedding: [0.5, 0.6],
    });
    const p = new FakeMarsPostmortemHelper(hooks);
    await p.listRecentPostmortems("u1", 3); // no queryText
    expect(hooks.embeddingPort!.generateEmbedding).not.toHaveBeenCalled();
    expect(hooks.listVectorMemories).toHaveBeenCalledWith("u1", 3, undefined);
  });
});
