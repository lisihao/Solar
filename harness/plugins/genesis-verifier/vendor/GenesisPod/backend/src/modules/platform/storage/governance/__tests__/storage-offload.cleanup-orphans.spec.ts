import { StorageOffloadService } from "../storage-offload.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ObjectStorageService } from "../../object-store/object-storage.service";

interface OffloadInternals {
  cleanupOrphans: () => Promise<number>;
}

function asInternals(svc: StorageOffloadService): OffloadInternals {
  return svc as unknown as OffloadInternals;
}

describe("StorageOffloadService — cleanupOrphans (cascade GDPR remediation)", () => {
  const listObjects = jest.fn();
  const deleteObject = jest.fn();
  const isEnabled = jest.fn();

  const kbDocFindMany = jest.fn();
  const revFindMany = jest.fn();
  const diffFindMany = jest.fn();
  const reportFindMany = jest.fn();
  const dimFindMany = jest.fn();
  const taskFindMany = jest.fn();

  const mockPrisma = {
    knowledgeBaseDocument: { findMany: kbDocFindMany },
    wikiPageRevision: { findMany: revFindMany },
    wikiDiff: { findMany: diffFindMany },
    topicReport: { findMany: reportFindMany },
    dimensionAnalysis: { findMany: dimFindMany },
    researchTask: { findMany: taskFindMany },
  } as unknown as PrismaService;

  const mockStorage = {
    isEnabled,
    listObjects,
    deleteObject,
  } as unknown as ObjectStorageService;

  let service: StorageOffloadService;

  beforeEach(() => {
    jest.clearAllMocks();
    isEnabled.mockReturnValue(true);
    service = new StorageOffloadService(mockPrisma, mockStorage);
  });

  it("returns 0 when storage disabled", async () => {
    isEnabled.mockReturnValue(false);
    const n = await asInternals(service).cleanupOrphans();
    expect(n).toBe(0);
    expect(listObjects).not.toHaveBeenCalled();
  });

  it("returns 0 when no R2 objects", async () => {
    listObjects.mockResolvedValue({ objects: [], isTruncated: false });
    const n = await asInternals(service).cleanupOrphans();
    expect(n).toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes objects whose DB row no longer exists", async () => {
    listObjects.mockResolvedValue({
      objects: [
        { key: "kb-documents/live-1/raw.txt", size: 100 },
        { key: "kb-documents/orphan-1/raw.txt", size: 200 },
        { key: "kb-documents/orphan-2/raw.txt", size: 300 },
      ],
      isTruncated: false,
    });
    kbDocFindMany.mockResolvedValue([{ id: "live-1" }]);
    deleteObject.mockResolvedValue(true);

    const n = await asInternals(service).cleanupOrphans();

    expect(n).toBe(2);
    expect(deleteObject).toHaveBeenCalledWith("kb-documents/orphan-1/raw.txt");
    expect(deleteObject).toHaveBeenCalledWith("kb-documents/orphan-2/raw.txt");
    expect(deleteObject).not.toHaveBeenCalledWith(
      "kb-documents/live-1/raw.txt",
    );
  });

  it("groups by prefix and queries each table once", async () => {
    listObjects.mockResolvedValue({
      objects: [
        { key: "kb-documents/d1/raw.txt", size: 100 },
        { key: "kb-documents/d2/raw.txt", size: 100 },
        { key: "wiki-revisions/r1/body.md", size: 100 },
        { key: "wiki-diffs/diff-1/items.json", size: 100 },
      ],
      isTruncated: false,
    });
    kbDocFindMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);
    revFindMany.mockResolvedValue([{ id: "r1" }]);
    diffFindMany.mockResolvedValue([{ id: "diff-1" }]);
    deleteObject.mockResolvedValue(true);

    await asInternals(service).cleanupOrphans();

    expect(kbDocFindMany).toHaveBeenCalledTimes(1);
    expect(kbDocFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: expect.arrayContaining(["d1", "d2"]) } },
      }),
    );
    expect(revFindMany).toHaveBeenCalledTimes(1);
    expect(diffFindMany).toHaveBeenCalledTimes(1);
    expect(deleteObject).not.toHaveBeenCalled(); // 全部 live
  });

  it("ignores keys that do not match any registered prefix", async () => {
    listObjects.mockResolvedValue({
      objects: [
        { key: "unknown-prefix/something.bin", size: 100 },
        { key: "secrets/api.key", size: 50 },
      ],
      isTruncated: false,
    });

    const n = await asInternals(service).cleanupOrphans();

    expect(n).toBe(0);
    expect(deleteObject).not.toHaveBeenCalled();
    // 各 findMany 都不应被调（无 candidate id）
    expect(kbDocFindMany).not.toHaveBeenCalled();
    expect(revFindMany).not.toHaveBeenCalled();
  });

  it("DB query failure does not abort whole cleanup (degrades gracefully)", async () => {
    listObjects.mockResolvedValue({
      objects: [
        { key: "kb-documents/d1/raw.txt", size: 100 },
        { key: "wiki-revisions/r1/body.md", size: 100 },
      ],
      isTruncated: false,
    });
    kbDocFindMany.mockRejectedValue(new Error("DB conn lost"));
    revFindMany.mockResolvedValue([]); // r1 is orphan
    deleteObject.mockResolvedValue(true);

    const n = await asInternals(service).cleanupOrphans();

    // kbDoc skipped, but rev orphan still cleaned
    expect(n).toBe(1);
    expect(deleteObject).toHaveBeenCalledWith("wiki-revisions/r1/body.md");
  });

  it("deduplicates candidate ids before DB query (multiple keys per id)", async () => {
    listObjects.mockResolvedValue({
      objects: [
        { key: "kb-documents/d1/raw.txt", size: 100 },
        { key: "kb-documents/d1/raw.bak", size: 200 }, // hypothetical duplicate
      ],
      isTruncated: false,
    });
    kbDocFindMany.mockResolvedValue([{ id: "d1" }]);

    await asInternals(service).cleanupOrphans();

    expect(kbDocFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["d1"] } },
      }),
    );
  });
});
