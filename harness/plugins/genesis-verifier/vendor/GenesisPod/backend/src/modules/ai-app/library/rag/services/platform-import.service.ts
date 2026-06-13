/**
 * Platform Import Service for Knowledge Base
 * Handles importing platform bookmarks and notes into knowledge bases
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { UrlFetchService } from "./url-fetch.service";

export interface AvailableBookmark {
  id: string;
  title: string;
  url: string;
  type: string;
  savedAt: Date;
  tags?: string[];
}

export interface AvailableNote {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  contentPreview: string;
  resourceId?: string;
  resourceTitle?: string;
}

export interface ImportResult {
  success: number;
  failed: Array<{ id: string; error: string }>;
  documentIds: string[];
}

@Injectable()
export class PlatformImportService {
  private readonly logger = new Logger(PlatformImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly urlFetchService: UrlFetchService,
  ) {}

  // ==================== Bookmark Import ====================

  /**
   * Get available bookmarks for import
   * Bookmarks are resources that users have saved/bookmarked
   */
  async getAvailableBookmarks(
    userId: string,
    options?: {
      search?: string;
      tags?: string[];
      page?: number;
      limit?: number;
    },
  ): Promise<{ bookmarks: AvailableBookmark[]; total: number }> {
    const { search, tags, page = 1, limit = 20 } = options || {};
    const skip = (page - 1) * limit;

    // Query resources that user has bookmarked (upvoted/saved)
    // sourceUrl is non-nullable in schema (String, not String?), so filter out empty strings
    const where: Record<string, unknown> = {
      upvotes: {
        some: { userId },
      },
      sourceUrl: { not: "" },
    };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { abstract: { contains: search, mode: "insensitive" } },
      ];
    }

    if (tags && tags.length > 0) {
      where.categories = {
        hasSome: tags,
      };
    }

    const [resources, total] = await Promise.all([
      this.prisma.resource.findMany({
        where,
        select: {
          id: true,
          title: true,
          sourceUrl: true,
          type: true,
          createdAt: true,
          categories: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.resource.count({ where }),
    ]);

    const bookmarks: AvailableBookmark[] = resources
      .filter((r) => r.sourceUrl) // Ensure URL exists
      .map((r) => ({
        id: r.id,
        title: r.title || "Untitled",
        url: r.sourceUrl,
        type: r.type,
        savedAt: r.createdAt,
        tags: Array.isArray(r.categories)
          ? (r.categories as string[])
          : undefined,
      }));

    return { bookmarks, total };
  }

  /**
   * Import bookmarks to knowledge base
   * Fetches content from bookmark URLs and adds to KB
   */
  async importBookmarks(
    knowledgeBaseId: string,
    userId: string,
    bookmarkIds: string[],
  ): Promise<ImportResult> {
    this.logger.log(
      `Importing ${bookmarkIds.length} bookmarks to KB ${knowledgeBaseId}`,
    );

    // Verify KB access
    await this.knowledgeBaseService.findById(knowledgeBaseId, userId);

    const result: ImportResult = {
      success: 0,
      failed: [],
      documentIds: [],
    };

    // Get bookmark resources
    const resources = await this.prisma.resource.findMany({
      where: {
        id: { in: bookmarkIds },
        upvotes: { some: { userId } },
      },
      select: {
        id: true,
        title: true,
        sourceUrl: true,
        content: true,
        abstract: true,
      },
    });

    for (const resource of resources) {
      try {
        let content = resource.content || resource.abstract || "";

        // If no content, try to fetch from URL
        if (!content && resource.sourceUrl) {
          try {
            const fetched = await this.urlFetchService.fetchUrl(
              resource.sourceUrl,
            );
            content = fetched.content;
          } catch (fetchErr) {
            this.logger.warn(
              `Failed to fetch bookmark URL ${resource.sourceUrl}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
            );
            // Use abstract as fallback
            content =
              resource.abstract ||
              `Bookmarked content from ${resource.sourceUrl}`;
          }
        }

        const doc = await this.knowledgeBaseService.addDocument(
          knowledgeBaseId,
          {
            title: resource.title || "Untitled Bookmark",
            content,
            sourceType: "BOOKMARK",
            sourceId: resource.id,
            sourceUrl: resource.sourceUrl || undefined,
          },
        );

        result.success++;
        result.documentIds.push(doc.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.warn(
          `Failed to import bookmark ${resource.id}: ${message}`,
        );
        result.failed.push({ id: resource.id, error: message });
      }
    }

    // Report bookmarks not found
    const foundIds = resources.map((r) => r.id);
    for (const id of bookmarkIds) {
      if (!foundIds.includes(id)) {
        result.failed.push({
          id,
          error: "Bookmark not found or not accessible",
        });
      }
    }

    this.logger.log(
      `Bookmark import complete: ${result.success} success, ${result.failed.length} failed`,
    );

    return result;
  }

  // ==================== Note Import ====================

  /**
   * Get available notes for import
   */
  async getAvailableNotes(
    userId: string,
    options?: {
      search?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ notes: AvailableNote[]; total: number }> {
    const { search, page = 1, limit = 20 } = options || {};
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { userId };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
      ];
    }

    const [notes, total] = await Promise.all([
      this.prisma.note.findMany({
        where,
        select: {
          id: true,
          title: true,
          content: true,
          createdAt: true,
          updatedAt: true,
          resourceId: true,
          resource: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.note.count({ where }),
    ]);

    const availableNotes: AvailableNote[] = notes.map((n) => ({
      id: n.id,
      title: n.title || "Untitled Note",
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      contentPreview: (n.content || "").slice(0, 100) + "...",
      resourceId: n.resourceId || undefined,
      resourceTitle: n.resource?.title,
    }));

    return { notes: availableNotes, total };
  }

  /**
   * Import notes to knowledge base
   */
  async importNotes(
    knowledgeBaseId: string,
    userId: string,
    noteIds: string[],
    autoSync?: boolean,
  ): Promise<ImportResult> {
    this.logger.log(
      `Importing ${noteIds.length} notes to KB ${knowledgeBaseId}`,
    );

    // Verify KB access
    await this.knowledgeBaseService.findById(knowledgeBaseId, userId);

    const result: ImportResult = {
      success: 0,
      failed: [],
      documentIds: [],
    };

    // Get notes
    const notes = await this.prisma.note.findMany({
      where: {
        id: { in: noteIds },
        userId,
      },
      select: {
        id: true,
        title: true,
        content: true,
        resource: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    for (const note of notes) {
      try {
        const title =
          note.title ||
          (note.resource?.title
            ? `Notes on: ${note.resource.title}`
            : "Untitled Note");

        const doc = await this.knowledgeBaseService.addDocument(
          knowledgeBaseId,
          {
            title,
            content: note.content || "",
            sourceType: "NOTE",
            sourceId: note.id,
            mimeType: "text/markdown",
            metadata: {
              autoSync: autoSync || false,
              linkedResourceId: note.resource?.id,
              linkedResourceTitle: note.resource?.title,
            },
          },
        );

        result.success++;
        result.documentIds.push(doc.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.warn(`Failed to import note ${note.id}: ${message}`);
        result.failed.push({ id: note.id, error: message });
      }
    }

    // Report notes not found
    const foundIds = notes.map((n) => n.id);
    for (const id of noteIds) {
      if (!foundIds.includes(id)) {
        result.failed.push({ id, error: "Note not found or not accessible" });
      }
    }

    this.logger.log(
      `Note import complete: ${result.success} success, ${result.failed.length} failed`,
    );

    return result;
  }
}
