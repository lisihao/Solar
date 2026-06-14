import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  ContentSource,
  ContentSourceProvider,
  SourceListFilter,
  SourceListResult,
  SourceContentBundle,
  SourceItem,
} from "@/modules/ai-engine/facade";

type ContentKind = SourceItem["contentKind"];

interface ListRow {
  id: string;
  title: string;
  type: string;
  markdown: string | null;
  metadata: unknown;
  createdAt: Date;
}

interface BundleRow extends ListRow {
  content: unknown;
}

/** Map OfficeDocumentType → contentKind */
function toContentKind(type: string): ContentKind {
  switch (type) {
    case "ARTICLE":
    case "REPORT":
    case "RESEARCH":
    case "PROPOSAL":
      return "article";
    default:
      return "other";
  }
}

/**
 * Extract plain-text body from an OfficeDocument row.
 *
 * Priority:
 *  1. `markdown` column — already plain text / markdown; use as-is.
 *  2. `content` JSON column — structured slides/sections array; walk
 *     the tree and collect every string-valued `text`/`content`/`body`
 *     property, joining them with newlines.
 */
function extractBody(markdown: string | null, content: unknown): string {
  if (markdown) return markdown;

  const parts: string[] = [];
  function walk(node: unknown): void {
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (trimmed) parts.push(trimmed);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // Prefer explicit text-bearing keys over iterating all values
      for (const key of ["text", "content", "body", "title", "description"]) {
        if (typeof obj[key] === "string") {
          const trimmed = obj[key].trim();
          if (trimmed) parts.push(trimmed);
        }
      }
      // Recurse into child arrays (e.g. slides → elements)
      for (const key of [
        "slides",
        "sections",
        "elements",
        "items",
        "children",
        "pages",
      ]) {
        if (obj[key] !== undefined) walk(obj[key]);
      }
    }
  }
  walk(content);
  return parts.join("\n");
}

/**
 * OfficeContentSourceProvider
 *
 * 2026-05-24 P17a: renamed from OfficeSocialSourceProvider; implements generic
 * engine `ContentSource`. id "AI_OFFICE" preserved.
 */
@Injectable()
@ContentSourceProvider()
export class OfficeContentSourceProvider implements ContentSource {
  readonly id = "AI_OFFICE";
  readonly displayName = { "zh-CN": "AI Office", "en-US": "AI Office" };
  readonly icon = "FileText";
  readonly description = {
    "zh-CN": "从我的 AI Office 文档中选择",
    "en-US": "Pick from my AI Office documents",
  };
  readonly contentKinds: SourceItem["contentKind"][] = ["article", "other"];
  readonly maxItemsPerTask = 10;

  constructor(private readonly prisma: PrismaService) {}

  async listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<SourceListResult> {
    const limit = filter.limit ?? 20;

    const docs = await this.prisma.officeDocument.findMany({
      where: {
        userId,
        ...(filter.search
          ? { title: { contains: filter.search, mode: "insensitive" } }
          : {}),
        ...(filter.cursor ? { id: { gt: filter.cursor } } : {}),
      },
      select: {
        id: true,
        title: true,
        type: true,
        markdown: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;

    const result: SourceItem[] = (items as ListRow[]).map((doc) => {
      const meta =
        doc.metadata !== null &&
        typeof doc.metadata === "object" &&
        !Array.isArray(doc.metadata)
          ? (doc.metadata as Record<string, unknown>)
          : {};

      const wordCount =
        typeof meta["wordCount"] === "number" ? meta["wordCount"] : undefined;

      const preview = doc.markdown ? doc.markdown.slice(0, 200) : undefined;

      return {
        id: doc.id,
        title: doc.title,
        preview,
        contentKind: toContentKind(doc.type),
        wordCount,
        createdAt: doc.createdAt.toISOString(),
      };
    });

    return {
      items: result,
      nextCursor: hasMore ? items[items.length - 1].id : undefined,
    };
  }

  async fetchBundle(
    itemIds: string[],
    userId: string,
  ): Promise<SourceContentBundle[]> {
    if (itemIds.length === 0) return [];

    const docs = await this.prisma.officeDocument.findMany({
      where: {
        id: { in: itemIds },
        userId, // cross-user isolation: only return docs owned by this user
      },
      select: {
        id: true,
        title: true,
        type: true,
        markdown: true,
        content: true,
        metadata: true,
        createdAt: true,
      },
    });

    return (docs as BundleRow[]).map((doc) => {
      const body = extractBody(doc.markdown, doc.content);
      const bodyMime: SourceContentBundle["bodyMime"] = doc.markdown
        ? "text/markdown"
        : "text/plain";

      const meta =
        doc.metadata !== null &&
        typeof doc.metadata === "object" &&
        !Array.isArray(doc.metadata)
          ? (doc.metadata as Record<string, unknown>)
          : {};

      return {
        sourceType: this.id,
        sourceId: doc.id,
        title: doc.title,
        body,
        bodyMime,
        sourceMetadata: {
          type: doc.type,
          wordCount: meta["wordCount"],
          createdAt: doc.createdAt.toISOString(),
        },
        displayMetadata: {
          docType: doc.type,
        },
      };
    });
  }
}
