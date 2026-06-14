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

function getKbDocumentTarget(service: StorageOffloadService): OffloadTarget {
  const targets = (service as unknown as OffloadInternals).buildTargets();
  const t = targets.find(
    (x) => x.name === "knowledge_base_documents.raw_content",
  );
  if (!t) throw new Error("kb_document target not registered");
  return t;
}

describe("StorageOffloadService — knowledge_base_documents.raw_content target", () => {
  const findMany = jest.fn();
  const update = jest.fn();
  const executeRawUnsafe = jest.fn();
  const mockPrisma = {
    knowledgeBaseDocument: {
      findMany,
      update,
    },
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
    target = getKbDocumentTarget(service);
  });

  describe("keyFor", () => {
    it("produces stable kb-documents/{id}/raw.txt key", () => {
      expect(target.keyFor("doc-123")).toBe("kb-documents/doc-123/raw.txt");
    });

    it("ignores version arg (KB documents are not versioned)", () => {
      expect(target.keyFor("abc", 5)).toBe("kb-documents/abc/raw.txt");
    });
  });

  describe("contentType", () => {
    it("is text/plain utf-8 (raw doc bytes are not markdown)", () => {
      expect(target.contentType).toBe("text/plain; charset=utf-8");
    });
  });

  describe("list filter", () => {
    it("queries only READY status with empty uri and non-empty rawContent", async () => {
      findMany.mockResolvedValue([]);

      await target.list(mockPrisma, 50);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            rawContentUri: null,
            status: "READY",
            NOT: { rawContent: "" },
          },
          take: 50,
        }),
      );
    });

    it("includes rawContentUri in select to satisfy hydrate guard", async () => {
      findMany.mockResolvedValue([]);

      await target.list(mockPrisma, 10);

      const call = findMany.mock.calls[0][0];
      expect(call.select).toEqual({
        id: true,
        rawContent: true,
        rawContentUri: true,
      });
    });

    it("maps rows to {id, content} payload", async () => {
      findMany.mockResolvedValue([
        { id: "d1", rawContent: "hello", rawContentUri: null },
        { id: "d2", rawContent: "world", rawContentUri: null },
      ]);

      const rows = await target.list(mockPrisma, 10);

      expect(rows).toEqual([
        { id: "d1", content: "hello" },
        { id: "d2", content: "world" },
      ]);
    });
  });

  describe("commit", () => {
    it("uses raw SQL to clear rawContent + write uri/size atomically", async () => {
      executeRawUnsafe.mockResolvedValue(1);

      await target.commit(
        mockPrisma,
        "doc-1",
        "kb-documents/doc-1/raw.txt",
        4096,
      );

      expect(executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(
          "UPDATE knowledge_base_documents SET raw_content='', raw_content_uri=$1, raw_content_size=$2 WHERE id=$3",
        ),
        "kb-documents/doc-1/raw.txt",
        4096,
        "doc-1",
      );
    });

    it("does not call prisma.knowledgeBaseDocument.update (would re-trigger hydrate hooks)", async () => {
      executeRawUnsafe.mockResolvedValue(1);

      await target.commit(mockPrisma, "doc-1", "key", 100);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("recordSmall", () => {
    it("records size only, leaves rawContent/uri unchanged", async () => {
      update.mockResolvedValue({});

      await target.recordSmall(mockPrisma, "doc-1", 512);

      expect(update).toHaveBeenCalledWith({
        where: { id: "doc-1" },
        data: { rawContentSize: 512 },
      });
    });
  });
});
