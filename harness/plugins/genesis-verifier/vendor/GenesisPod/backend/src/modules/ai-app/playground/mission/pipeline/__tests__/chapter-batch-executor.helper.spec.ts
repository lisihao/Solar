import { executeChapterBatch } from "../helpers/chapter-batch-executor.helper";

// R2-#45: pre-dispatch budget gate — no new chapter LLM call may start after the
// mission budget pool is exhausted.
describe("executeChapterBatch — R2-#45 pre-dispatch budget gate", () => {
  const chapters = [
    { index: 1, heading: "A" },
    { index: 2, heading: "B" },
    { index: 3, heading: "C" },
  ];
  const deps = {
    log: {
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    },
  } as never;
  const ctx = { missionId: "m1", dimensionName: "Dim" };

  it("pool exhausted → runOne never called, terminal emitted per chapter", async () => {
    const runOne = jest.fn().mockResolvedValue({ index: 0 });
    const onChapterThrow = jest.fn().mockResolvedValue(undefined);
    const pool = { isExhausted: jest.fn().mockReturnValue(true) } as never;
    const results = await executeChapterBatch(
      chapters,
      2,
      [],
      runOne,
      onChapterThrow,
      deps,
      ctx,
      pool,
    );
    expect(runOne).toHaveBeenCalledTimes(0); // success criterion: no LLM call starts
    expect(onChapterThrow).toHaveBeenCalledTimes(3);
    expect(
      onChapterThrow.mock.calls.every((c) =>
        /budget-pool-exhausted/.test(String(c[1])),
      ),
    ).toBe(true);
    expect(results).toHaveLength(3);
    expect(
      results.every((r) => r.status === "fulfilled" && r.value === null),
    ).toBe(true);
  });

  it("pool not exhausted → all chapters run", async () => {
    const runOne = jest
      .fn()
      .mockImplementation((ch: { index: number }) =>
        Promise.resolve({ index: ch.index }),
      );
    const onChapterThrow = jest.fn().mockResolvedValue(undefined);
    const pool = { isExhausted: jest.fn().mockReturnValue(false) } as never;
    const results = await executeChapterBatch(
      chapters,
      2,
      [],
      runOne,
      onChapterThrow,
      deps,
      ctx,
      pool,
    );
    expect(runOne).toHaveBeenCalledTimes(3);
    expect(onChapterThrow).toHaveBeenCalledTimes(0);
    expect(
      results.every((r) => r.status === "fulfilled" && r.value !== null),
    ).toBe(true);
  });

  it("backward-compatible: no pool arg → all chapters run (legacy callers)", async () => {
    const runOne = jest.fn().mockResolvedValue({ index: 1 });
    const onChapterThrow = jest.fn();
    const results = await executeChapterBatch(
      chapters,
      2,
      [],
      runOne,
      onChapterThrow,
      deps,
      ctx,
    );
    expect(runOne).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
  });
});
