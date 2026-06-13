import { StorageOffloadService } from "../storage-offload.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ObjectStorageService } from "../../object-store/object-storage.service";
import { Prisma, WikiDiffStatus } from "@prisma/client";

interface OffloadTarget {
  name: string;
  list: (
    p: PrismaService,
    take: number,
  ) => Promise<Array<{ id: string; content: string; version?: number }>>;
  commit: (
    p: PrismaService,
    id: string,
    uri: string,
    size: number,
  ) => Promise<void>;
  recordSmall: (p: PrismaService, id: string, size: number) => Promise<void>;
  keyFor: (id: string, version?: number) => string;
  contentType: string;
}

interface OffloadInternals {
  buildTargets: () => OffloadTarget[];
}

function getDiffTarget(service: StorageOffloadService): OffloadTarget {
  const targets = (service as unknown as OffloadInternals).buildTargets();
  const t = targets.find((x) => x.name === "wiki_diffs.items");
  if (!t) throw new Error("wiki_diffs.items target not registered");
  return t;
}

describe("StorageOffloadService — wiki_diffs.items target", () => {
  const findMany = jest.fn();
  const update = jest.fn();
  const executeRawUnsafe = jest.fn();
  const mockPrisma = {
    wikiDiff: { findMany, update },
    $executeRawUnsafe: executeRawUnsafe,
  } as unknown as PrismaService;

  const mockStorage = {
    isEnabled: () => true,
  } as unknown as ObjectStorageService;

  let service: StorageOffloadService;
  let target: OffloadTarget;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageOffloadService(mockPrisma, mockStorage);
    target = getDiffTarget(service);
  });

  describe("keyFor", () => {
    it("produces wiki-diffs/{id}/items.json", () => {
      expect(target.keyFor("diff-abc")).toBe("wiki-diffs/diff-abc/items.json");
    });
  });

  describe("contentType", () => {
    it("is application/json (items is JSON serialised)", () => {
      expect(target.contentType).toBe("application/json; charset=utf-8");
    });
  });

  describe("list filter", () => {
    it("filters APPLIED|DISMISSED with 30-day grace + items_uri null + items not JSON null", async () => {
      findMany.mockResolvedValue([]);

      const before = Date.now();
      await target.list(mockPrisma, 50);
      const after = Date.now();

      const call = findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({
        itemsUri: null,
        status: {
          in: [WikiDiffStatus.APPLIED, WikiDiffStatus.DISMISSED],
        },
        NOT: { items: { equals: Prisma.JsonNull } },
      });
      // 30-day cutoff verification
      const cutoff = call.where.createdAt.lt as Date;
      const expectedCutoff = before - 30 * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedCutoff);
      expect(cutoff.getTime()).toBeLessThanOrEqual(
        after - 30 * 24 * 60 * 60 * 1000 + 1000,
      );
      expect(call.take).toBe(50);
    });

    it("never archives PENDING (apply transaction needs items in DB)", async () => {
      findMany.mockResolvedValue([]);

      await target.list(mockPrisma, 10);

      const where = findMany.mock.calls[0][0].where;
      expect(where.status.in).not.toContain(WikiDiffStatus.PENDING);
      expect(where.status.in).not.toContain(WikiDiffStatus.CONFLICTED);
    });

    it("includes itemsUri in select to satisfy hydrate guard", async () => {
      findMany.mockResolvedValue([]);

      await target.list(mockPrisma, 10);

      expect(findMany.mock.calls[0][0].select).toEqual({
        id: true,
        items: true,
        itemsUri: true,
      });
    });

    it("filters out null items rows + JSON.stringifies items payload", async () => {
      findMany.mockResolvedValue([
        { id: "d1", items: { creates: [], updates: [], deletes: [] } },
        { id: "d2", items: null }, // already off-loaded edge case
      ]);

      const rows = await target.list(mockPrisma, 10);

      expect(rows).toEqual([
        {
          id: "d1",
          content: JSON.stringify({ creates: [], updates: [], deletes: [] }),
        },
      ]);
    });
  });

  describe("commit", () => {
    it("uses raw SQL writing JSONB null (preserves NOT NULL constraint)", async () => {
      executeRawUnsafe.mockResolvedValue(1);

      await target.commit(
        mockPrisma,
        "diff-1",
        "wiki-diffs/diff-1/items.json",
        4096,
      );

      const sql = executeRawUnsafe.mock.calls[0][0];
      expect(sql).toContain("UPDATE wiki_diffs");
      expect(sql).toContain("items='null'::jsonb");
      expect(sql).toContain("items_uri=$1");
      expect(sql).toContain("items_size=$2");
      expect(executeRawUnsafe.mock.calls[0]).toEqual([
        sql,
        "wiki-diffs/diff-1/items.json",
        4096,
        "diff-1",
      ]);
    });

    it("does not call prisma.wikiDiff.update", async () => {
      executeRawUnsafe.mockResolvedValue(1);

      await target.commit(mockPrisma, "diff-1", "key", 100);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("recordSmall", () => {
    it("records itemsSize only", async () => {
      update.mockResolvedValue({});

      await target.recordSmall(mockPrisma, "diff-1", 512);

      expect(update).toHaveBeenCalledWith({
        where: { id: "diff-1" },
        data: { itemsSize: 512 },
      });
    });
  });
});
