/**
 * Unit tests for LibraryContentSourceProvider
 *
 * Covered scenarios:
 *  1.  Static descriptor fields are correct
 *  2.  listItems — notes userId isolation
 *  3.  listItems — kbDocs userId isolation (via knowledgeBase.userId)
 *  4.  listItems — returns SourceItems for notes with contentKind = 'note'
 *  5.  listItems — returns SourceItems for kbDocs with correct contentKind
 *  6.  listItems — merges notes + kbDocs in createdAt-DESC order
 *  7.  listItems — search filter hits notes
 *  8.  listItems — dateRange filter applied
 *  9.  listItems — pagination: cursor advances, nextCursor set / cleared
 * 10.  listItems — cross-user isolation: user A data, user B query → 0 items
 * 11.  fetchBundle — empty itemIds returns []
 * 12.  fetchBundle — note:: prefix routes to notes table with userId enforcement
 * 13.  fetchBundle — kbdoc:: prefix routes to kbdoc table with userId enforcement
 * 14.  fetchBundle — cross-user isolation: wrong user → item omitted
 * 15.  fetchBundle — mixed note:: + kbdoc:: ids returned as separate bundles
 * 16.  fetchBundle — note bundle has correct bodyMime = text/markdown
 * 17.  fetchBundle — kbdoc bundle resolves bodyMime from mimeType
 */

import { Test, TestingModule } from "@nestjs/testing";
import { LibraryContentSourceProvider } from "../library-content-source.provider";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: "note-1",
    title: "My Note",
    content: "Some markdown content here.",
    tags: ["ai", "research"],
    createdAt: new Date("2026-03-01T10:00:00Z"),
    ...overrides,
  };
}

function makeKbDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "My Document",
    mimeType: "application/pdf",
    sourceType: "MANUAL",
    rawContent: "Document body text.",
    rawContentUri: null,
    createdAt: new Date("2026-03-02T10:00:00Z"),
    ...overrides,
  };
}

// fetchBundle variants
function makeNoteFull(overrides: Record<string, unknown> = {}) {
  return {
    id: "note-1",
    title: "My Note",
    content: "Full markdown content.",
    tags: ["tag1"],
    source: "pdf",
    createdAt: new Date("2026-03-01T10:00:00Z"),
    ...overrides,
  };
}

function makeKbDocFull(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "My Document",
    rawContent: "Document body text.",
    rawContentUri: null,
    mimeType: "text/html",
    sourceType: "url",
    sourceUrl: "https://example.com",
    createdAt: new Date("2026-03-02T10:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  note: {
    findMany: jest.fn(),
  },
  knowledgeBaseDocument: {
    findMany: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("LibraryContentSourceProvider", () => {
  let provider: LibraryContentSourceProvider;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: return empty arrays so tests don't have to set both mocks
    mockPrisma.note.findMany.mockResolvedValue([]);
    mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibraryContentSourceProvider,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    provider = module.get<LibraryContentSourceProvider>(
      LibraryContentSourceProvider,
    );
  });

  // -------------------------------------------------------------------------
  // 1. Static descriptor
  // -------------------------------------------------------------------------

  describe("static descriptor", () => {
    it("has id = AI_LIBRARY", () => {
      expect(provider.id).toBe("AI_LIBRARY");
    });

    it("has icon = BookMarked", () => {
      expect(provider.icon).toBe("BookMarked");
    });

    it("exposes article, note, other contentKinds", () => {
      expect(provider.contentKinds).toEqual(
        expect.arrayContaining(["article", "note", "other"]),
      );
    });

    it("has maxItemsPerTask = 10", () => {
      expect(provider.maxItemsPerTask).toBe(10);
    });

    it("has zh-CN and en-US display names", () => {
      expect(provider.displayName["zh-CN"]).toBeTruthy();
      expect(provider.displayName["en-US"]).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // listItems
  // -------------------------------------------------------------------------

  describe("listItems", () => {
    it("2 - queries notes with caller userId (isolation)", async () => {
      await provider.listItems("user-A", {});

      const noteCall = mockPrisma.note.findMany.mock.calls[0][0];
      expect(noteCall.where).toMatchObject({ userId: "user-A" });
    });

    it("3 - queries kbDocs via knowledgeBase.userId (isolation)", async () => {
      await provider.listItems("user-A", {});

      const kbCall = mockPrisma.knowledgeBaseDocument.findMany.mock.calls[0][0];
      expect(kbCall.where).toMatchObject({
        knowledgeBase: { userId: "user-A" },
      });
    });

    it("4 - returns SourceItems for notes with contentKind = note", async () => {
      mockPrisma.note.findMany.mockResolvedValue([makeNote()]);

      const result = await provider.listItems("user-A", {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "note::note-1",
        title: "My Note",
        contentKind: "note",
      });
    });

    it("5 - maps pdf kbDoc to contentKind = article", async () => {
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        makeKbDoc({ mimeType: "application/pdf" }),
      ]);

      const result = await provider.listItems("user-A", {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: "kbdoc::doc-1",
        contentKind: "article",
      });
    });

    it("5b - maps unknown-mime kbDoc to contentKind = other", async () => {
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        makeKbDoc({ mimeType: "application/octet-stream", sourceType: "blob" }),
      ]);

      const result = await provider.listItems("user-A", {});

      expect(result.items[0].contentKind).toBe("other");
    });

    it("6 - merges notes and kbDocs sorted by createdAt DESC", async () => {
      const olderNote = makeNote({
        id: "note-old",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      const newerKbDoc = makeKbDoc({
        id: "doc-new",
        createdAt: new Date("2026-06-01T00:00:00Z"),
      });

      mockPrisma.note.findMany.mockResolvedValue([olderNote]);
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([newerKbDoc]);

      const result = await provider.listItems("user-A", {});

      // newerKbDoc should appear first
      expect(result.items[0].id).toBe("kbdoc::doc-new");
      expect(result.items[1].id).toBe("note::note-old");
    });

    it("7 - applies search filter to note query", async () => {
      await provider.listItems("user-A", { search: "climate" });

      const noteCall = mockPrisma.note.findMany.mock.calls[0][0];
      expect(noteCall.where).toHaveProperty("OR");
    });

    it("7b - applies search filter to kbDoc query", async () => {
      await provider.listItems("user-A", { search: "quantum" });

      const kbCall = mockPrisma.knowledgeBaseDocument.findMany.mock.calls[0][0];
      expect(kbCall.where).toHaveProperty("OR");
    });

    it("8 - applies dateRange filter", async () => {
      await provider.listItems("user-A", {
        dateRange: { from: "2026-01-01", to: "2026-12-31" },
      });

      const noteCall = mockPrisma.note.findMany.mock.calls[0][0];
      expect(noteCall.where).toHaveProperty("createdAt");
      const kbCall = mockPrisma.knowledgeBaseDocument.findMany.mock.calls[0][0];
      expect(kbCall.where).toHaveProperty("createdAt");
    });

    it("9 - sets nextCursor when more items remain after skip+limit", async () => {
      // 5 notes, limit = 2, skip = 0 → page has 2, nextCursor = '2'
      const notes = Array.from({ length: 5 }, (_, i) =>
        makeNote({ id: `note-${i}`, createdAt: new Date(2026, 0, i + 1) }),
      );
      mockPrisma.note.findMany.mockResolvedValue(notes);

      const result = await provider.listItems("user-A", { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe("2");
    });

    it("9b - clears nextCursor on last page", async () => {
      mockPrisma.note.findMany.mockResolvedValue([makeNote()]);

      const result = await provider.listItems("user-A", { limit: 10 });

      expect(result.nextCursor).toBeUndefined();
    });

    it("9c - cursor skips already-seen items", async () => {
      // 3 notes total; cursor = '2' → page starts at index 2
      const notes = Array.from({ length: 3 }, (_, i) =>
        makeNote({ id: `note-${i}`, createdAt: new Date(2026, 0, 3 - i) }),
      );
      mockPrisma.note.findMany.mockResolvedValue(notes);

      const result = await provider.listItems("user-A", {
        cursor: "2",
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it("10 - cross-user isolation: user A data queried with user B → 0 items", async () => {
      // Prisma is instructed to filter by userId; mock returns empty for user-B
      mockPrisma.note.findMany.mockResolvedValue([]);
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([]);

      const result = await provider.listItems("user-B", {});

      // Verify both queries use user-B, not user-A
      const noteCall = mockPrisma.note.findMany.mock.calls[0][0];
      expect(noteCall.where.userId).toBe("user-B");
      expect(noteCall.where.userId).not.toBe("user-A");

      const kbCall = mockPrisma.knowledgeBaseDocument.findMany.mock.calls[0][0];
      expect(kbCall.where.knowledgeBase.userId).toBe("user-B");

      expect(result.items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // fetchBundle
  // -------------------------------------------------------------------------

  describe("fetchBundle", () => {
    it("11 - returns [] when itemIds is empty", async () => {
      const result = await provider.fetchBundle([], "user-A");
      expect(result).toEqual([]);
      expect(mockPrisma.note.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.knowledgeBaseDocument.findMany).not.toHaveBeenCalled();
    });

    it("12 - note:: routes to notes table with userId in WHERE", async () => {
      mockPrisma.note.findMany.mockResolvedValue([makeNoteFull()]);

      await provider.fetchBundle(["note::note-1"], "user-A");

      const call = mockPrisma.note.findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({
        id: { in: ["note-1"] },
        userId: "user-A",
      });
    });

    it("13 - kbdoc:: routes to kbDocs table with knowledgeBase.userId in WHERE", async () => {
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        makeKbDocFull(),
      ]);

      await provider.fetchBundle(["kbdoc::doc-1"], "user-A");

      const call = mockPrisma.knowledgeBaseDocument.findMany.mock.calls[0][0];
      expect(call.where).toMatchObject({
        id: { in: ["doc-1"] },
        knowledgeBase: { userId: "user-A" },
      });
    });

    it("14 - cross-user isolation: Prisma returns 0 when userId mismatch", async () => {
      // Prisma would return [] because WHERE userId = 'user-A' won't match user-B's note
      mockPrisma.note.findMany.mockResolvedValue([]);

      const result = await provider.fetchBundle(["note::note-1"], "user-A");

      // No bundle returned for item that doesn't belong to user-A
      expect(result).toHaveLength(0);

      const call = mockPrisma.note.findMany.mock.calls[0][0];
      expect(call.where.userId).toBe("user-A");
    });

    it("15 - mixed note:: + kbdoc:: ids return separate bundles", async () => {
      mockPrisma.note.findMany.mockResolvedValue([makeNoteFull()]);
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        makeKbDocFull(),
      ]);

      const result = await provider.fetchBundle(
        ["note::note-1", "kbdoc::doc-1"],
        "user-A",
      );

      expect(result).toHaveLength(2);
      const sourceIds = result.map((b) => b.sourceId);
      expect(sourceIds).toContain("note::note-1");
      expect(sourceIds).toContain("kbdoc::doc-1");
    });

    it("16 - note bundle bodyMime = text/markdown", async () => {
      mockPrisma.note.findMany.mockResolvedValue([makeNoteFull()]);

      const [bundle] = await provider.fetchBundle(["note::note-1"], "user-A");

      expect(bundle.bodyMime).toBe("text/markdown");
      expect(bundle.body).toBe("Full markdown content.");
    });

    it("17 - kbdoc bundle resolves bodyMime from mimeType (html)", async () => {
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        makeKbDocFull({ mimeType: "text/html" }),
      ]);

      const [bundle] = await provider.fetchBundle(["kbdoc::doc-1"], "user-A");

      expect(bundle.bodyMime).toBe("text/html");
    });

    it("17b - kbdoc bundle with null mimeType defaults to text/plain", async () => {
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        makeKbDocFull({ mimeType: null }),
      ]);

      const [bundle] = await provider.fetchBundle(["kbdoc::doc-1"], "user-A");

      expect(bundle.bodyMime).toBe("text/plain");
    });

    it("includes sourceType = AI_LIBRARY in all bundles", async () => {
      mockPrisma.note.findMany.mockResolvedValue([makeNoteFull()]);
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        makeKbDocFull(),
      ]);

      const result = await provider.fetchBundle(
        ["note::note-1", "kbdoc::doc-1"],
        "user-A",
      );

      for (const bundle of result) {
        expect(bundle.sourceType).toBe("AI_LIBRARY");
      }
    });

    it("does not call kbDoc query when only note:: ids are requested", async () => {
      mockPrisma.note.findMany.mockResolvedValue([makeNoteFull()]);

      await provider.fetchBundle(["note::note-1"], "user-A");

      expect(mockPrisma.knowledgeBaseDocument.findMany).not.toHaveBeenCalled();
    });

    it("does not call note query when only kbdoc:: ids are requested", async () => {
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        makeKbDocFull(),
      ]);

      await provider.fetchBundle(["kbdoc::doc-1"], "user-A");

      expect(mockPrisma.note.findMany).not.toHaveBeenCalled();
    });
  });
});
