/**
 * WikiAutoIngestScheduler spec — PR-1, the "compounding" half of Karpathy's
 * LLM Wiki philosophy.
 *
 * Gates exercised (each test isolates one):
 *  - eligibility: only wikiEnabled + autoIngestEnabled != false KBs
 *  - coverage: only docs whose updatedAt is newer than APPLIED coverage are ingested
 *  - placeholder docs (metadata.pendingFetch=true) are filtered out
 *  - off-loaded docs (rawContentUri set) are always considered ready
 *  - debounce window pre-empts a tick
 *  - daily budget caps auto-ingest count per KB per day
 *  - pending diffs do not suppress auto-ingest by themselves
 *  - per-KB failure does not abort the loop
 *  - top-level catch keeps the cron alive
 */

import { WikiAutoIngestScheduler } from "../wiki-auto-ingest.scheduler";
import { AUTO_INGEST_SYSTEM_USER_ID } from "../wiki-ingest.service";

function makePrismaMock() {
  return {
    knowledgeBase: { findMany: jest.fn() },
    wikiDiff: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    wikiDocumentCoverage: { findMany: jest.fn() },
    knowledgeBaseDocument: { findMany: jest.fn() },
  } as any;
}

function makeIngestMock() {
  return {
    ingestAsCron: jest.fn().mockResolvedValue({ id: "diff-auto-1" } as any),
  } as any;
}

function makeKeyResolverMock(defaultProviders: string[] = ["openai"]): {
  getAvailableProviders: jest.Mock<Promise<string[]>, [string]>;
} {
  return {
    getAvailableProviders: jest.fn().mockResolvedValue(defaultProviders),
  } as any;
}

const KB_DEFAULT = {
  id: "kb-1",
  wikiConfig: {
    autoIngestEnabled: true,
    autoIngestDailyBudgetCalls: 20,
    autoIngestDebounceSeconds: 300,
  },
};

const CONSUMER_USER_ID = "consumer-user-1";

/**
 * 2026-05-11 BYOK consumer model：scheduler 每个 KB 先调 pickConsumerUserId
 * （= wikiDiff.findFirst 非哨兵），再调 findIngestableDocIds（= wikiDiff.findFirst
 * 哨兵 debounce）。spec 必须按这个顺序连续 mock findFirst 两次。
 */
function setupNoBlockers(prisma: any) {
  prisma.wikiDiff.findFirst
    .mockResolvedValueOnce({ createdByUserId: CONSUMER_USER_ID }) // consumer
    .mockResolvedValueOnce(null); // debounce
  prisma.wikiDiff.count.mockResolvedValue(0); // budget
  prisma.wikiDocumentCoverage.findMany.mockResolvedValue([]);
}

describe("WikiAutoIngestScheduler", () => {
  let prisma: any;
  let ingest: any;
  let keyResolver: any;
  let scheduler: WikiAutoIngestScheduler;

  beforeEach(() => {
    prisma = makePrismaMock();
    ingest = makeIngestMock();
    keyResolver = makeKeyResolverMock();
    scheduler = new WikiAutoIngestScheduler(prisma, ingest, keyResolver);
    // Enable by default so existing tests exercise real scheduler logic.
    // The env-gate tests manage the flag themselves.
    process.env.ENABLE_WIKI_AUTO_INGEST = "true";
  });

  afterEach(() => {
    delete process.env.ENABLE_WIKI_AUTO_INGEST;
  });

  // ===== default-OFF guard (ENABLE_WIKI_AUTO_INGEST) =====

  describe("ENABLE_WIKI_AUTO_INGEST env gate", () => {
    it("does not call ingestAsCron when flag is unset (default OFF)", async () => {
      delete process.env.ENABLE_WIKI_AUTO_INGEST; // remove the beforeEach value
      prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);

      await scheduler.tick();

      expect(ingest.ingestAsCron).not.toHaveBeenCalled();
      expect(prisma.knowledgeBase.findMany).not.toHaveBeenCalled();
    });

    it("does not call ingestAsCron when flag is explicitly 'false'", async () => {
      process.env.ENABLE_WIKI_AUTO_INGEST = "false";
      prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);

      await scheduler.tick();

      expect(ingest.ingestAsCron).not.toHaveBeenCalled();
    });

    it("proceeds with ingest when flag is 'true'", async () => {
      process.env.ENABLE_WIKI_AUTO_INGEST = "true";
      prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
      setupNoBlockers(prisma);
      prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1", metadata: {}, rawContentUri: null },
      ]);

      await scheduler.tick();

      expect(ingest.ingestAsCron).toHaveBeenCalledWith(
        "kb-1",
        ["doc-1"],
        CONSUMER_USER_ID,
      );
    });
  });

  it("skips KBs whose autoIngestEnabled is explicitly false", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([
      {
        id: "kb-off",
        wikiConfig: {
          autoIngestEnabled: false,
          autoIngestDailyBudgetCalls: 20,
          autoIngestDebounceSeconds: 300,
        },
      },
    ]);

    await scheduler.tick();

    expect(ingest.ingestAsCron).not.toHaveBeenCalled();
    expect(prisma.wikiDiff.findFirst).not.toHaveBeenCalled();
  });

  it("treats missing wikiConfig row as autoIngestEnabled (defaults true)", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([
      { id: "kb-legacy", wikiConfig: null },
    ]);
    setupNoBlockers(prisma);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
      { id: "doc-1", metadata: {}, rawContentUri: null },
    ]);

    await scheduler.tick();

    expect(ingest.ingestAsCron).toHaveBeenCalledWith(
      "kb-legacy",
      ["doc-1"],
      CONSUMER_USER_ID,
    );
  });

  it("ingests docs that changed after the cursor", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    setupNoBlockers(prisma);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
      { id: "doc-new", metadata: {}, rawContentUri: null },
      { id: "doc-changed", metadata: null, rawContentUri: null },
    ]);

    await scheduler.tick();

    expect(ingest.ingestAsCron).toHaveBeenCalledWith(
      "kb-1",
      ["doc-new", "doc-changed"],
      CONSUMER_USER_ID,
    );
  });

  it("filters out placeholder docs (metadata.pendingFetch=true)", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    setupNoBlockers(prisma);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
      { id: "doc-real", metadata: {}, rawContentUri: null },
      {
        id: "doc-placeholder",
        metadata: { pendingFetch: true },
        rawContentUri: null,
      },
    ]);

    await scheduler.tick();

    expect(ingest.ingestAsCron).toHaveBeenCalledWith(
      "kb-1",
      ["doc-real"],
      CONSUMER_USER_ID,
    );
  });

  it("treats off-loaded docs (rawContentUri set) as always ready", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    setupNoBlockers(prisma);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
      // metadata is null but content lives in R2 → ready
      {
        id: "doc-offloaded",
        metadata: null,
        rawContentUri: "s3://kb-1/doc-offloaded.txt",
      },
    ]);

    await scheduler.tick();

    expect(ingest.ingestAsCron).toHaveBeenCalledWith(
      "kb-1",
      ["doc-offloaded"],
      CONSUMER_USER_ID,
    );
  });

  it("does not call ingestAsCron when no docs changed since cursor", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    setupNoBlockers(prisma);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([]);

    await scheduler.tick();

    expect(ingest.ingestAsCron).not.toHaveBeenCalled();
  });

  it("debounce: skips KB when an auto-ingest WikiDiff exists within the window", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    prisma.wikiDiff.findFirst
      .mockResolvedValueOnce({ createdByUserId: CONSUMER_USER_ID }) // consumer
      .mockResolvedValueOnce({ id: "diff-recent" }); // debounce probe → hit

    await scheduler.tick();

    expect(prisma.wikiDiff.count).not.toHaveBeenCalled();
    expect(prisma.knowledgeBaseDocument.findMany).not.toHaveBeenCalled();
    expect(ingest.ingestAsCron).not.toHaveBeenCalled();
  });

  it("daily budget: skips KB when today's auto-ingest count >= budget", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    prisma.wikiDiff.findFirst
      .mockResolvedValueOnce({ createdByUserId: CONSUMER_USER_ID }) // consumer
      .mockResolvedValueOnce(null); // debounce clear
    prisma.wikiDiff.count.mockResolvedValueOnce(20); // budget exhausted

    await scheduler.tick();

    expect(prisma.knowledgeBaseDocument.findMany).not.toHaveBeenCalled();
    expect(ingest.ingestAsCron).not.toHaveBeenCalled();
  });

  it("queries the budget count with the AUTO_INGEST sentinel userId", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    setupNoBlockers(prisma);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([]);

    await scheduler.tick();

    const countArgs = prisma.wikiDiff.count.mock.calls[0][0];
    expect(countArgs.where.createdByUserId).toBe(AUTO_INGEST_SYSTEM_USER_ID);
  });

  it("isolates per-KB failures so the scan loop continues", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([
      KB_DEFAULT,
      { ...KB_DEFAULT, id: "kb-2" },
    ]);
    // kb-1: consumer lookup throws (DB hiccup). kb-2: clean run.
    prisma.wikiDiff.findFirst
      .mockRejectedValueOnce(new Error("DB hiccup")) // kb-1 consumer
      .mockResolvedValueOnce({ createdByUserId: CONSUMER_USER_ID }) // kb-2 consumer
      .mockResolvedValueOnce(null); // kb-2 debounce
    prisma.wikiDiff.count.mockResolvedValue(0);
    prisma.wikiDocumentCoverage.findMany.mockResolvedValue([]);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
      { id: "doc-x", metadata: {}, rawContentUri: null },
    ]);

    await expect(scheduler.tick()).resolves.toBeUndefined();

    // kb-2 still got ingested.
    expect(ingest.ingestAsCron).toHaveBeenCalledWith(
      "kb-2",
      ["doc-x"],
      CONSUMER_USER_ID,
    );
  });

  it("does not let pending diffs suppress docs with no applied coverage", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    setupNoBlockers(prisma);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
      {
        id: "doc-after-pending",
        metadata: {},
        rawContentUri: null,
        updatedAt: new Date("2026-05-10T10:00:00.000Z"),
      },
    ]);

    await scheduler.tick();

    expect(ingest.ingestAsCron).toHaveBeenCalledWith(
      "kb-1",
      ["doc-after-pending"],
      CONSUMER_USER_ID,
    );
  });

  it("skips docs already covered by an applied coverage watermark", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    setupNoBlockers(prisma);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
      {
        id: "doc-covered",
        metadata: {},
        rawContentUri: null,
        updatedAt: new Date("2026-05-10T10:00:00.000Z"),
      },
      {
        id: "doc-newer",
        metadata: {},
        rawContentUri: null,
        updatedAt: new Date("2026-05-10T11:00:00.000Z"),
      },
    ]);
    prisma.wikiDocumentCoverage.findMany.mockResolvedValue([
      {
        documentId: "doc-covered",
        lastCoveredDocumentUpdatedAt: new Date("2026-05-10T10:00:00.000Z"),
      },
      {
        documentId: "doc-newer",
        lastCoveredDocumentUpdatedAt: new Date("2026-05-10T10:30:00.000Z"),
      },
    ]);

    await scheduler.tick();

    expect(ingest.ingestAsCron).toHaveBeenCalledWith(
      "kb-1",
      ["doc-newer"],
      CONSUMER_USER_ID,
    );
  });

  it("does not throw if the top-level scan query itself fails", async () => {
    prisma.knowledgeBase.findMany.mockRejectedValue(new Error("DB down"));

    await expect(scheduler.tick()).resolves.toBeUndefined();

    expect(ingest.ingestAsCron).not.toHaveBeenCalled();
  });

  // ===== 2026-05-11 BYOK consumer model: 谁消费谁付钱 =====

  it("skips KB with no manual WikiDiff history (no consumer yet)", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    // pickConsumerUserId → wikiDiff.findFirst returns null (zero manual ingest)
    prisma.wikiDiff.findFirst.mockResolvedValueOnce(null);

    await scheduler.tick();

    // Should not even hit debounce probe / doc query / ingest
    expect(prisma.wikiDiff.count).not.toHaveBeenCalled();
    expect(prisma.knowledgeBaseDocument.findMany).not.toHaveBeenCalled();
    expect(ingest.ingestAsCron).not.toHaveBeenCalled();
    expect(keyResolver.getAvailableProviders).not.toHaveBeenCalled();
  });

  it("skips KB when the consumer's BYOK is empty", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    prisma.wikiDiff.findFirst.mockResolvedValueOnce({
      createdByUserId: "consumer-no-byok",
    });
    // KeyResolver returns empty providers → no BYOK
    keyResolver.getAvailableProviders.mockResolvedValueOnce([]);

    await scheduler.tick();

    expect(keyResolver.getAvailableProviders).toHaveBeenCalledWith(
      "consumer-no-byok",
    );
    expect(prisma.wikiDiff.count).not.toHaveBeenCalled();
    expect(ingest.ingestAsCron).not.toHaveBeenCalled();
  });

  it("uses latest non-system WikiDiff creator as the consumer (not KB creator)", async () => {
    prisma.knowledgeBase.findMany.mockResolvedValue([KB_DEFAULT]);
    // pickConsumerUserId picks "user-junjie" who manually ingested most recently
    prisma.wikiDiff.findFirst
      .mockResolvedValueOnce({ createdByUserId: "user-junjie" }) // consumer
      .mockResolvedValueOnce(null); // debounce clear
    prisma.wikiDiff.count.mockResolvedValueOnce(0);
    prisma.wikiDocumentCoverage.findMany.mockResolvedValue([]);
    prisma.knowledgeBaseDocument.findMany.mockResolvedValue([
      { id: "doc-1", metadata: {}, rawContentUri: null },
    ]);

    await scheduler.tick();

    expect(ingest.ingestAsCron).toHaveBeenCalledWith(
      "kb-1",
      ["doc-1"],
      "user-junjie",
    );
    // Consumer lookup must exclude the AUTO_INGEST sentinel
    const consumerQuery = prisma.wikiDiff.findFirst.mock.calls[0][0];
    expect(consumerQuery.where.createdByUserId).toEqual({
      not: AUTO_INGEST_SYSTEM_USER_ID,
    });
    expect(consumerQuery.orderBy).toEqual({ createdAt: "desc" });
  });
});
