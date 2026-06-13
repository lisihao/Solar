import { LibraryContentSourceProvider } from "../library-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

const mockNoteFindMany = jest.fn();
const mockKbDocFindMany = jest.fn();
const mockPrisma = {
  note: { findMany: mockNoteFindMany },
  knowledgeBaseDocument: { findMany: mockKbDocFindMany },
} as unknown as PrismaService;

const makeNoteListRow = (
  overrides: Partial<{
    id: string;
    title: string | null;
    content: string;
    tags: unknown;
    createdAt: Date;
  }> = {},
) => ({
  id: "note-1",
  title: "My Note",
  content: "Note body content",
  tags: ["tag1"],
  createdAt: new Date("2024-05-01T00:00:00Z"),
  ...overrides,
});

const makeKbDocListRow = (
  overrides: Partial<{
    id: string;
    title: string;
    mimeType: string | null;
    sourceType: string;
    rawContent: string;
    rawContentUri: string | null;
    createdAt: Date;
  }> = {},
) => ({
  id: "kbdoc-1",
  title: "KB Document",
  mimeType: "text/plain",
  sourceType: "url",
  rawContent: "Document raw content",
  rawContentUri: null,
  createdAt: new Date("2024-05-02T00:00:00Z"),
  ...overrides,
});

const makeNoteBundleRow = (
  overrides: Partial<{
    id: string;
    title: string | null;
    content: string;
    tags: unknown;
    source: string | null;
    createdAt: Date;
  }> = {},
) => ({
  id: "note-1",
  title: "My Note",
  content: "Full note body",
  tags: ["tag1"],
  source: null,
  createdAt: new Date("2024-05-01T00:00:00Z"),
  ...overrides,
});

const makeKbDocBundleRow = (
  overrides: Partial<{
    id: string;
    title: string;
    rawContent: string;
    rawContentUri: string | null;
    mimeType: string | null;
    sourceType: string;
    sourceUrl: string | null;
    createdAt: Date;
  }> = {},
) => ({
  id: "kbdoc-1",
  title: "KB Document",
  rawContent: "Full kb content",
  rawContentUri: null,
  mimeType: "text/plain",
  sourceType: "url",
  sourceUrl: "https://example.com",
  createdAt: new Date("2024-05-02T00:00:00Z"),
  ...overrides,
});

describe("LibraryContentSourceProvider — userId isolation (integration)", () => {
  let provider: LibraryContentSourceProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new LibraryContentSourceProvider(mockPrisma);
    mockNoteFindMany.mockResolvedValue([]);
    mockKbDocFindMany.mockResolvedValue([]);
  });

  it("uses the real LibraryContentSourceProvider class", () => {
    expect(provider).toBeInstanceOf(LibraryContentSourceProvider);
    expect(provider.id).toBe("AI_LIBRARY");
  });

  describe("listItems — notes isolation", () => {
    it("passes userId into note.where.userId", async () => {
      await provider.listItems("user-b", {});
      expect(mockNoteFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-b" }),
        }),
      );
    });

    it("does NOT contain user-a id in note query when called with user-b", async () => {
      await provider.listItems("user-b", {});
      const callArg = mockNoteFindMany.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(callArg.where)).toContain("user-b");
      expect(JSON.stringify(callArg.where)).not.toContain("user-a");
    });

    it("maps note rows to SourceItem with note:: prefix", async () => {
      mockNoteFindMany.mockResolvedValue([makeNoteListRow()]);
      const result = await provider.listItems("user-b", {});
      const noteItem = result.items.find((i) => i.id.startsWith("note::"));
      expect(noteItem).toBeDefined();
      expect(noteItem!.contentKind).toBe("note");
      expect(noteItem!.createdAt).toBe("2024-05-01T00:00:00.000Z");
    });
  });

  describe("listItems — KB docs isolation", () => {
    it("passes userId into knowledgeBaseDocument.where.knowledgeBase.userId", async () => {
      await provider.listItems("user-b", {});
      expect(mockKbDocFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            knowledgeBase: { userId: "user-b" },
          }),
        }),
      );
    });

    it("does NOT contain user-a id in kbDoc query when called with user-b", async () => {
      await provider.listItems("user-b", {});
      const callArg = mockKbDocFindMany.mock.calls[0][0] as { where: unknown };
      expect(JSON.stringify(callArg.where)).toContain("user-b");
      expect(JSON.stringify(callArg.where)).not.toContain("user-a");
    });

    it("maps kbDoc rows to SourceItem with kbdoc:: prefix", async () => {
      mockKbDocFindMany.mockResolvedValue([makeKbDocListRow()]);
      const result = await provider.listItems("user-b", {});
      const kbItem = result.items.find((i) => i.id.startsWith("kbdoc::"));
      expect(kbItem).toBeDefined();
      expect(kbItem!.contentKind).toBe("article");
      expect(kbItem!.createdAt).toBe("2024-05-02T00:00:00.000Z");
    });
  });

  describe("fetchBundle — notes isolation", () => {
    it("passes userId and id filter in note.where", async () => {
      await provider.fetchBundle(["note::note-1"], "user-b");
      expect(mockNoteFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["note-1"] },
            userId: "user-b",
          }),
        }),
      );
    });

    it("maps note bundle rows to SourceContentBundle with note:: sourceId", async () => {
      mockNoteFindMany.mockResolvedValue([makeNoteBundleRow()]);
      const bundles = await provider.fetchBundle(["note::note-1"], "user-b");
      expect(bundles).toHaveLength(1);
      expect(bundles[0].sourceId).toBe("note::note-1");
      expect(bundles[0].sourceType).toBe("AI_LIBRARY");
      expect(bundles[0].bodyMime).toBe("text/markdown");
    });
  });

  describe("fetchBundle — KB docs isolation", () => {
    it("passes userId via knowledgeBase.userId in kbDoc.where", async () => {
      await provider.fetchBundle(["kbdoc::kbdoc-1"], "user-b");
      expect(mockKbDocFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ["kbdoc-1"] },
            knowledgeBase: { userId: "user-b" },
          }),
        }),
      );
    });

    it("maps kbDoc bundle rows to SourceContentBundle with kbdoc:: sourceId", async () => {
      mockKbDocFindMany.mockResolvedValue([makeKbDocBundleRow()]);
      const bundles = await provider.fetchBundle(["kbdoc::kbdoc-1"], "user-b");
      expect(bundles).toHaveLength(1);
      expect(bundles[0].sourceId).toBe("kbdoc::kbdoc-1");
      expect(bundles[0].sourceType).toBe("AI_LIBRARY");
    });
  });

  describe("fetchBundle — edge cases", () => {
    it("short-circuits without DB call for empty itemIds", async () => {
      const bundles = await provider.fetchBundle([], "user-b");
      expect(bundles).toEqual([]);
      expect(mockNoteFindMany).not.toHaveBeenCalled();
      expect(mockKbDocFindMany).not.toHaveBeenCalled();
    });
  });
});
