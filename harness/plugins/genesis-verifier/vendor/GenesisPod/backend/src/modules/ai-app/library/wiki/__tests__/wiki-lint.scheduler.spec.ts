/**
 * WikiLintScheduler spec — daily cron entry that finally consumes the
 * long-orphaned `cronLintEnabled` config field.
 *
 * Gates exercised:
 *  - only KBs with wikiEnabled=true scanned
 *  - cronLintEnabled=false short-circuits per-KB
 *  - recent lint finding within 23h short-circuits per-KB
 *  - per-KB failure does not abort the scan loop
 *  - top-level catch isolates the cron from crashing the Nest process
 */

import { WikiLintScheduler } from "../wiki-lint.scheduler";

function makePrismaMock() {
  return {
    knowledgeBase: {
      findMany: jest.fn(),
    },
    wikiLintFinding: {
      findFirst: jest.fn(),
    },
  } as any;
}

function makeLintMock() {
  return {
    runFullLintAsCron: jest.fn().mockResolvedValue({
      counts: {
        ORPHAN: 0,
        MISSING_XREF: 0,
        STALE: 0,
        CONTRADICTION: 0,
        DATA_GAP: 0,
      },
      budgetExceeded: false,
    }),
  } as any;
}

describe("WikiLintScheduler", () => {
  let prisma: any;
  let lint: any;
  let scheduler: WikiLintScheduler;

  beforeEach(() => {
    prisma = makePrismaMock();
    lint = makeLintMock();
    scheduler = new WikiLintScheduler(prisma, lint);
    // Enable by default so existing tests exercise real scheduler logic.
    process.env.ENABLE_WIKI_LINT_CRON = "true";
  });

  afterEach(() => {
    delete process.env.ENABLE_WIKI_LINT_CRON;
  });

  // ===== default-OFF guard (ENABLE_WIKI_LINT_CRON) =====

  describe("ENABLE_WIKI_LINT_CRON env gate", () => {
    it("does not run lint when flag is unset (default OFF)", async () => {
      delete process.env.ENABLE_WIKI_LINT_CRON;
      prisma.knowledgeBase.findMany.mockResolvedValue([
        { id: "kb-a", wikiConfig: { cronLintEnabled: true } },
      ]);

      await scheduler.runDailyLint();

      expect(lint.runFullLintAsCron).not.toHaveBeenCalled();
      expect(prisma.knowledgeBase.findMany).not.toHaveBeenCalled();
    });

    it("does not run lint when flag is explicitly 'false'", async () => {
      process.env.ENABLE_WIKI_LINT_CRON = "false";
      prisma.knowledgeBase.findMany.mockResolvedValue([
        { id: "kb-a", wikiConfig: { cronLintEnabled: true } },
      ]);

      await scheduler.runDailyLint();

      expect(lint.runFullLintAsCron).not.toHaveBeenCalled();
    });

    it("proceeds with lint when flag is 'true'", async () => {
      // flag already set to 'true' by beforeEach
      prisma.knowledgeBase.findMany.mockResolvedValue([
        { id: "kb-a", wikiConfig: { cronLintEnabled: true } },
      ]);
      prisma.wikiLintFinding.findFirst.mockResolvedValue(null);

      await scheduler.runDailyLint();

      expect(lint.runFullLintAsCron).toHaveBeenCalledWith("kb-a");
    });
  });

  it("scans only wikiEnabled KBs and runs lint when no recent finding exists", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([
      { id: "kb-a", wikiConfig: { cronLintEnabled: true } },
      { id: "kb-b", wikiConfig: { cronLintEnabled: true } },
    ]);
    prisma.wikiLintFinding.findFirst.mockResolvedValue(null);

    await scheduler.runDailyLint();

    expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith({
      where: { wikiEnabled: true },
      select: expect.any(Object),
    });
    expect(lint.runFullLintAsCron).toHaveBeenCalledTimes(2);
    expect(lint.runFullLintAsCron).toHaveBeenCalledWith("kb-a");
    expect(lint.runFullLintAsCron).toHaveBeenCalledWith("kb-b");
  });

  it("skips KBs whose cronLintEnabled is explicitly false", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([
      { id: "kb-on", wikiConfig: { cronLintEnabled: true } },
      { id: "kb-off", wikiConfig: { cronLintEnabled: false } },
    ]);
    prisma.wikiLintFinding.findFirst.mockResolvedValue(null);

    await scheduler.runDailyLint();

    expect(lint.runFullLintAsCron).toHaveBeenCalledTimes(1);
    expect(lint.runFullLintAsCron).toHaveBeenCalledWith("kb-on");
    expect(lint.runFullLintAsCron).not.toHaveBeenCalledWith("kb-off");
  });

  it("treats a missing wikiConfig row as cronLintEnabled (defaults true)", async () => {
    // KB whose config row was never inserted (legacy KB created before
    // P0 added the row) should still get linted by the cron.
    prisma.knowledgeBase.findMany.mockResolvedValue([
      { id: "kb-legacy", wikiConfig: null },
    ]);
    prisma.wikiLintFinding.findFirst.mockResolvedValue(null);

    await scheduler.runDailyLint();

    expect(lint.runFullLintAsCron).toHaveBeenCalledWith("kb-legacy");
  });

  it("short-circuits a KB whose latest lint finding is within the last 23h", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([
      { id: "kb-a", wikiConfig: { cronLintEnabled: true } },
    ]);
    // Recent manual run within the dedup window.
    prisma.wikiLintFinding.findFirst.mockResolvedValue({ id: "f-recent" });

    await scheduler.runDailyLint();

    expect(lint.runFullLintAsCron).not.toHaveBeenCalled();
  });

  it("isolates per-KB failures so the scan loop continues", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([
      { id: "kb-bad", wikiConfig: { cronLintEnabled: true } },
      { id: "kb-good", wikiConfig: { cronLintEnabled: true } },
    ]);
    prisma.wikiLintFinding.findFirst.mockResolvedValue(null);
    lint.runFullLintAsCron
      .mockRejectedValueOnce(new Error("LLM timeout"))
      .mockResolvedValueOnce({
        counts: {
          ORPHAN: 0,
          MISSING_XREF: 0,
          STALE: 0,
          CONTRADICTION: 0,
          DATA_GAP: 0,
        },
        budgetExceeded: false,
      });

    // Should not throw; loop continues past the first failure.
    await expect(scheduler.runDailyLint()).resolves.toBeUndefined();

    expect(lint.runFullLintAsCron).toHaveBeenCalledTimes(2);
  });

  it("does not throw if the scan query itself fails", async () => {
    prisma.knowledgeBase.findMany.mockRejectedValue(new Error("DB down"));

    // Top-level catch must keep the Nest process alive.
    await expect(scheduler.runDailyLint()).resolves.toBeUndefined();

    expect(lint.runFullLintAsCron).not.toHaveBeenCalled();
  });
});
