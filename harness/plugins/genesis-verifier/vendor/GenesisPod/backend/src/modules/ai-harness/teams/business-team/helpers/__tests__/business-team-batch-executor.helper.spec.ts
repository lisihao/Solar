import { executeBusinessTeamBatch } from "../business-team-batch-executor.helper";

describe("executeBusinessTeamBatch — pre-dispatch budget gate + per-item error boundary", () => {
  const items = [
    { index: 1, heading: "A" },
    { index: 2, heading: "B" },
    { index: 3, heading: "C" },
  ];
  const deps = {
    log: { warn: jest.fn(), error: jest.fn() },
  };
  const ctx = { missionId: "m1", sliceName: "Slice" };

  beforeEach(() => {
    deps.log.warn.mockClear();
    deps.log.error.mockClear();
  });

  it("pool exhausted → runOne never called, terminal emitted per item", async () => {
    const runOne = jest.fn().mockResolvedValue({ index: 0 });
    const onItemThrow = jest.fn().mockResolvedValue(undefined);
    const pool = { isExhausted: jest.fn().mockReturnValue(true) } as never;

    const results = await executeBusinessTeamBatch(
      items,
      2,
      [] as readonly string[],
      runOne,
      onItemThrow,
      deps,
      ctx,
      pool,
    );

    expect(runOne).toHaveBeenCalledTimes(0);
    expect(onItemThrow).toHaveBeenCalledTimes(3);
    expect(
      onItemThrow.mock.calls.every((c) =>
        /budget-pool-exhausted/.test(String(c[1])),
      ),
    ).toBe(true);
    expect(results).toHaveLength(3);
    expect(
      results.every((r) => r.status === "fulfilled" && r.value === null),
    ).toBe(true);
  });

  it("pool not exhausted → all items run", async () => {
    const runOne = jest
      .fn()
      .mockImplementation((it: { index: number }) =>
        Promise.resolve({ index: it.index }),
      );
    const onItemThrow = jest.fn().mockResolvedValue(undefined);
    const pool = { isExhausted: jest.fn().mockReturnValue(false) } as never;

    const results = await executeBusinessTeamBatch(
      items,
      2,
      [],
      runOne,
      onItemThrow,
      deps,
      ctx,
      pool,
    );

    expect(runOne).toHaveBeenCalledTimes(3);
    expect(onItemThrow).toHaveBeenCalledTimes(0);
    expect(
      results.every((r) => r.status === "fulfilled" && r.value !== null),
    ).toBe(true);
  });

  it("backward-compatible: no pool arg → all items run (legacy callers)", async () => {
    const runOne = jest.fn().mockResolvedValue({ index: 1 });
    const onItemThrow = jest.fn();

    const results = await executeBusinessTeamBatch(
      items,
      2,
      [],
      runOne,
      onItemThrow,
      deps,
      ctx,
    );

    expect(runOne).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
  });

  it("runOne throws → caught, onItemThrow called, result is fulfilled-null", async () => {
    const runOne = jest
      .fn()
      .mockImplementation((it: { index: number }) =>
        it.index === 2
          ? Promise.reject(new Error("LLM down"))
          : Promise.resolve({ index: it.index }),
      );
    const onItemThrow = jest.fn().mockResolvedValue(undefined);

    const results = await executeBusinessTeamBatch(
      items,
      3,
      [],
      runOne,
      onItemThrow,
      deps,
      ctx,
    );

    expect(runOne).toHaveBeenCalledTimes(3);
    expect(onItemThrow).toHaveBeenCalledTimes(1);
    expect(onItemThrow.mock.calls[0][0]).toMatchObject({ index: 2 });
    // failed item → fulfilled-null (NOT rejected): otherwise frontend never sees terminal
    expect(results[1]).toMatchObject({ status: "fulfilled", value: null });
    expect(deps.log.error).toHaveBeenCalledTimes(1);
  });

  it("non-Error throwable is stringified into the log line", async () => {
    const runOne = jest
      .fn()
      .mockImplementationOnce(() => Promise.reject("plain string"))
      .mockResolvedValue({ index: 99 });
    const onItemThrow = jest.fn().mockResolvedValue(undefined);

    await executeBusinessTeamBatch(
      [{ index: 1 }],
      1,
      [],
      runOne,
      onItemThrow,
      deps,
      ctx,
    );

    expect(deps.log.error).toHaveBeenCalledWith(
      expect.stringContaining("plain string"),
    );
  });

  it("snapshot is passed unchanged to every runOne invocation", async () => {
    const snapshot = ["h1", "h2"];
    const runOne = jest.fn().mockResolvedValue({ index: 0 });
    const onItemThrow = jest.fn();

    await executeBusinessTeamBatch(
      items,
      2,
      snapshot as readonly string[],
      runOne,
      onItemThrow,
      deps,
      ctx,
    );

    expect(runOne).toHaveBeenCalledTimes(3);
    for (const call of runOne.mock.calls) {
      // snapshot reference identity preserved (no clone — framework is pass-through)
      expect(call[1]).toBe(snapshot);
    }
  });

  it("concurrency=1 still works (sequential), preserves item order in results array", async () => {
    const seen: number[] = [];
    const runOne = jest
      .fn()
      .mockImplementation(async (it: { index: number }) => {
        seen.push(it.index);
        return { index: it.index };
      });
    const onItemThrow = jest.fn();

    const results = await executeBusinessTeamBatch(
      items,
      1,
      [],
      runOne,
      onItemThrow,
      deps,
      ctx,
    );

    expect(seen).toEqual([1, 2, 3]);
    expect(
      results.map((r) =>
        r.status === "fulfilled" && r.value
          ? (r.value as { index: number }).index
          : null,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("empty items array → returns []", async () => {
    const runOne = jest.fn();
    const onItemThrow = jest.fn();

    const results = await executeBusinessTeamBatch(
      [],
      4,
      [],
      runOne,
      onItemThrow,
      deps,
      ctx,
    );

    expect(results).toEqual([]);
    expect(runOne).not.toHaveBeenCalled();
  });
});
