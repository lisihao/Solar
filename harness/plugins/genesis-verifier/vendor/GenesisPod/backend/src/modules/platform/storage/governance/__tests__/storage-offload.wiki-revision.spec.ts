import { StorageOffloadService } from "../storage-offload.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ObjectStorageService } from "../../object-store/object-storage.service";

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

function getRevisionTarget(service: StorageOffloadService): OffloadTarget {
  const targets = (service as unknown as OffloadInternals).buildTargets();
  const t = targets.find((x) => x.name === "wiki_page_revisions.body");
  if (!t) throw new Error("wiki_page_revisions.body target not registered");
  return t;
}

describe("StorageOffloadService — wiki_page_revisions.body target", () => {
  const findMany = jest.fn();
  const update = jest.fn();
  const executeRawUnsafe = jest.fn();
  const mockPrisma = {
    wikiPageRevision: { findMany, update },
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
    target = getRevisionTarget(service);
  });

  describe("keyFor", () => {
    it("produces wiki-revisions/{id}/body.md (matches topic-reports/{id}/v{n}.md style)", () => {
      expect(target.keyFor("rev-abc")).toBe("wiki-revisions/rev-abc/body.md");
    });
  });

  describe("contentType", () => {
    it("is markdown utf-8 (revision body is markdown)", () => {
      expect(target.contentType).toBe("text/markdown; charset=utf-8");
    });
  });

  describe("list filter", () => {
    it("queries empty bodyUri + non-empty body (no status filter — append-only)", async () => {
      findMany.mockResolvedValue([]);

      await target.list(mockPrisma, 50);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            bodyUri: null,
            NOT: { body: "" },
          },
          take: 50,
        }),
      );
    });

    it("includes bodyUri in select to satisfy hydrate guard", async () => {
      findMany.mockResolvedValue([]);

      await target.list(mockPrisma, 10);

      const call = findMany.mock.calls[0][0];
      expect(call.select).toEqual({
        id: true,
        body: true,
        bodyUri: true,
      });
    });

    it("maps rows to {id, content}", async () => {
      findMany.mockResolvedValue([
        { id: "r1", body: "page-v1 body", bodyUri: null },
        { id: "r2", body: "page-v2 body", bodyUri: null },
      ]);

      const rows = await target.list(mockPrisma, 10);

      expect(rows).toEqual([
        { id: "r1", content: "page-v1 body" },
        { id: "r2", content: "page-v2 body" },
      ]);
    });
  });

  describe("commit", () => {
    it("uses raw SQL to clear body + write uri/size atomically", async () => {
      executeRawUnsafe.mockResolvedValue(1);

      await target.commit(
        mockPrisma,
        "rev-1",
        "wiki-revisions/rev-1/body.md",
        2048,
      );

      expect(executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(
          "UPDATE wiki_page_revisions SET body='', body_uri=$1, body_size=$2 WHERE id=$3",
        ),
        "wiki-revisions/rev-1/body.md",
        2048,
        "rev-1",
      );
    });

    it("does not call prisma.wikiPageRevision.update", async () => {
      executeRawUnsafe.mockResolvedValue(1);

      await target.commit(mockPrisma, "rev-1", "key", 100);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("recordSmall", () => {
    it("records bodySize only", async () => {
      update.mockResolvedValue({});

      await target.recordSmall(mockPrisma, "rev-1", 512);

      expect(update).toHaveBeenCalledWith({
        where: { id: "rev-1" },
        data: { bodySize: 512 },
      });
    });
  });
});
