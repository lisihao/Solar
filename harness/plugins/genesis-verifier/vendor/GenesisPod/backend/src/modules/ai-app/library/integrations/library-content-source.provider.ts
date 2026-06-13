import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ContentSourceProvider } from "@/modules/ai-engine/facade";
import type {
  ContentSource,
  SourceItem,
  SourceListFilter,
  SourceListResult,
  SourceContentBundle,
} from "@/modules/ai-engine/facade";

/**
 * LibraryContentSourceProvider
 *
 * 2026-05-24 P17a: renamed from LibrarySocialSourceProvider; implements
 * generic engine `ContentSource`. id "AI_LIBRARY" preserved.
 *
 * Exposes user-authored Library content as a generic ContentSource:
 *   - Note (table: notes)              → contentKind 'note'
 *   - KnowledgeBaseDocument            → contentKind 'article' (pdf/document) or 'other'
 *
 * NOT exposed:
 *   - ParentChunk / ChildChunk  — RAG machine-intermediate, not human content
 *   - KnowledgeBase itself      — metadata container only
 *   - Collection                — container metadata, no standalone body
 *   - Resource                  — belongs to Explore, not user's library authoring
 *
 * Item ID encoding:
 *   note::{uuid}   → routes to `notes` table
 *   kbdoc::{uuid}  → routes to `knowledge_base_documents` table
 *
 * Isolation guarantee: every query is scoped to the caller's userId —
 * cross-user access is structurally impossible.
 */
@Injectable()
@ContentSourceProvider()
export class LibraryContentSourceProvider implements ContentSource {
  readonly id = "AI_LIBRARY";
  readonly displayName = {
    "zh-CN": "我的知识库",
    "en-US": "My Library",
  } as const;
  readonly icon = "BookMarked";
  readonly description = {
    "zh-CN": "从我的知识库（笔记/收藏/文档）中选择",
    "en-US": "Pick from my library (notes/collections/documents)",
  } as const;
  readonly contentKinds = ["article", "note", "other"] as const;
  readonly maxItemsPerTask = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists notes and knowledge-base documents belonging to userId.
   *
   * Results are ordered by createdAt DESC and merged: notes first, then kb-docs,
   * up to `limit`. Cursor-based pagination uses a string offset (total skip count).
   */
  async listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<SourceListResult> {
    const limit = Math.min(filter.limit ?? 20, this.maxItemsPerTask);
    const skip = filter.cursor ? parseInt(filter.cursor, 10) : 0;

    const dateFilter =
      filter.dateRange != null
        ? {
            gte: new Date(filter.dateRange.from),
            lte: new Date(filter.dateRange.to),
          }
        : undefined;

    // --- Notes query ---
    const noteWhere: Record<string, unknown> = { userId };
    if (filter.search) {
      noteWhere.OR = [
        { title: { contains: filter.search, mode: "insensitive" } },
        { content: { contains: filter.search, mode: "insensitive" } },
      ];
    }
    if (dateFilter) noteWhere.createdAt = dateFilter;

    // --- KnowledgeBaseDocument query (scoped via knowledgeBase.userId) ---
    const kbDocWhere: Record<string, unknown> = {
      knowledgeBase: { userId },
    };
    if (filter.search) {
      kbDocWhere.OR = [
        { title: { contains: filter.search, mode: "insensitive" } },
        { rawContent: { contains: filter.search, mode: "insensitive" } },
      ];
    }
    if (dateFilter) kbDocWhere.createdAt = dateFilter;

    const [notes, kbDocs] = await Promise.all([
      this.prisma.note.findMany({
        where: noteWhere,
        select: {
          id: true,
          title: true,
          content: true,
          tags: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.knowledgeBaseDocument.findMany({
        where: kbDocWhere,
        select: {
          id: true,
          title: true,
          mimeType: true,
          sourceType: true,
          rawContent: true,
          rawContentUri: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Merge and sort all items by createdAt DESC
    const allItems: SourceItem[] = [
      ...notes.map((n) => this.noteToSourceItem(n)),
      ...kbDocs.map((d) => this.kbDocToSourceItem(d)),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = allItems.length;
    const page = allItems.slice(skip, skip + limit);
    const nextOffset = skip + page.length;
    const hasMore = nextOffset < total;

    return {
      items: page,
      nextCursor: hasMore ? String(nextOffset) : undefined,
    };
  }

  /**
   * Fetch full content bundles for given itemIds.
   *
   * itemIds use prefix routing:
   *   "note::{uuid}"  → notes table
   *   "kbdoc::{uuid}" → knowledge_base_documents table
   *
   * userId is enforced on every query — items not belonging to userId are omitted.
   */
  async fetchBundle(
    itemIds: string[],
    userId: string,
  ): Promise<SourceContentBundle[]> {
    if (itemIds.length === 0) return [];

    const noteIds: string[] = [];
    const kbDocIds: string[] = [];

    for (const itemId of itemIds) {
      if (itemId.startsWith("note::")) {
        noteIds.push(itemId.slice(6));
      } else if (itemId.startsWith("kbdoc::")) {
        kbDocIds.push(itemId.slice(7));
      }
    }

    const [notes, kbDocs] = await Promise.all([
      noteIds.length > 0
        ? this.prisma.note.findMany({
            where: { id: { in: noteIds }, userId }, // strict user-isolation
            select: {
              id: true,
              title: true,
              content: true,
              tags: true,
              source: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      kbDocIds.length > 0
        ? this.prisma.knowledgeBaseDocument.findMany({
            where: {
              id: { in: kbDocIds },
              knowledgeBase: { userId }, // strict user-isolation via relation
            },
            select: {
              id: true,
              title: true,
              rawContent: true,
              rawContentUri: true,
              mimeType: true,
              sourceType: true,
              sourceUrl: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const bundles: SourceContentBundle[] = [];

    for (const note of notes) {
      bundles.push({
        sourceType: this.id,
        sourceId: `note::${note.id}`,
        title: note.title ?? "(Untitled Note)",
        body: note.content,
        bodyMime: "text/markdown",
        sourceMetadata: {
          noteId: note.id,
          source: note.source ?? null,
          createdAt: note.createdAt.toISOString(),
        },
        displayMetadata: {
          tags: Array.isArray(note.tags) ? note.tags : [],
        },
      });
    }

    for (const doc of kbDocs) {
      // rawContent may be offloaded to R2 (rawContentUri set), body may be "".
      // We serve whatever is in DB — hydration is transparent via PrismaService.
      const body = doc.rawContent ?? "";

      bundles.push({
        sourceType: this.id,
        sourceId: `kbdoc::${doc.id}`,
        title: doc.title,
        body,
        bodyMime: this.resolveMime(doc.mimeType),
        sourceMetadata: {
          documentId: doc.id,
          sourceType: doc.sourceType,
          sourceUrl: doc.sourceUrl ?? null,
          createdAt: doc.createdAt.toISOString(),
        },
        displayMetadata: {
          mimeType: doc.mimeType ?? null,
        },
      });
    }

    return bundles;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private noteToSourceItem(note: {
    id: string;
    title: string | null;
    content: string;
    tags: unknown;
    createdAt: Date;
  }): SourceItem {
    const preview = note.content.slice(0, 200).replace(/\n+/g, " ");
    return {
      id: `note::${note.id}`,
      title: note.title ?? "(Untitled Note)",
      preview: preview || undefined,
      contentKind: "note",
      wordCount: note.content.split(/\s+/).filter(Boolean).length,
      createdAt: note.createdAt.toISOString(),
      tags: Array.isArray(note.tags)
        ? (note.tags as string[]).filter((t) => typeof t === "string")
        : [],
    };
  }

  private kbDocToSourceItem(doc: {
    id: string;
    title: string;
    mimeType: string | null;
    sourceType: string;
    rawContent: string;
    rawContentUri: string | null;
    createdAt: Date;
  }): SourceItem {
    const kind = this.resolveContentKind(doc.mimeType, doc.sourceType);
    const preview = doc.rawContent.slice(0, 200).replace(/\n+/g, " ");
    return {
      id: `kbdoc::${doc.id}`,
      title: doc.title,
      preview: preview || undefined,
      contentKind: kind,
      wordCount: doc.rawContent.split(/\s+/).filter(Boolean).length,
      createdAt: doc.createdAt.toISOString(),
      tags: [],
    };
  }

  private resolveContentKind(
    mimeType: string | null,
    sourceType: string,
  ): "article" | "other" {
    if (!mimeType && !sourceType) return "other";
    const mime = (mimeType ?? "").toLowerCase();
    const src = sourceType.toLowerCase();
    if (
      mime.includes("pdf") ||
      mime.includes("text") ||
      mime.includes("html") ||
      src === "url" ||
      src === "web" ||
      src === "feishu" ||
      src === "notion" ||
      src === "google_drive"
    ) {
      return "article";
    }
    return "other";
  }

  private resolveMime(
    mimeType: string | null,
  ): "text/markdown" | "text/html" | "text/plain" {
    if (!mimeType) return "text/plain";
    const m = mimeType.toLowerCase();
    if (m.includes("html")) return "text/html";
    if (m.includes("markdown") || m.includes("md")) return "text/markdown";
    return "text/plain";
  }
}
