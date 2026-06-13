import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * Admin 视角的知识管理只读查询服务（KB / 文档 / Wiki 跨用户列表 + 详情）。
 * standards/24 薄网关整改（Wave C）：原逻辑在 open-api/admin/knowledge controller
 * 内直接操作 Prisma；下沉到 ai-app/library（知识库领域的家）。controller 仅薄 HTTP。
 * 与 user-facing rag.controller 解耦：本服务不按 user 过滤，admin 看全量。
 */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function paging(pageStr?: string, pageSizeStr?: string) {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(pageSizeStr ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, pageSize };
}

@Injectable()
export class KnowledgeAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listKnowledgeBases(f: {
    search?: string;
    status?: string;
    type?: string;
    ownerId?: string;
    page?: string;
    pageSize?: string;
  }) {
    const { page, pageSize } = paging(f.page, f.pageSize);
    const where: Prisma.KnowledgeBaseWhereInput = {};
    if (f.search) {
      where.OR = [
        { name: { contains: f.search, mode: "insensitive" } },
        { description: { contains: f.search, mode: "insensitive" } },
      ];
    }
    if (f.status) where.status = f.status as Prisma.KnowledgeBaseWhereInput["status"];
    if (f.type) where.type = f.type as Prisma.KnowledgeBaseWhereInput["type"];
    if (f.ownerId) where.userId = f.ownerId;

    const [rows, total] = await Promise.all([
      this.prisma.knowledgeBase.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          type: true,
          status: true,
          sourceType: true,
          userId: true,
          user: { select: { email: true, fullName: true } },
          createdAt: true,
          updatedAt: true,
          lastSyncedAt: true,
          wikiEnabled: true,
          _count: { select: { documents: true, members: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.knowledgeBase.count({ where }),
    ]);

    return {
      items: rows.map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
        type: kb.type,
        status: kb.status,
        sourceType: kb.sourceType,
        ownerUserId: kb.userId,
        ownerEmail: kb.user?.email ?? null,
        ownerName: kb.user?.fullName ?? null,
        wikiEnabled: kb.wikiEnabled,
        documentCount: kb._count.documents,
        memberCount: kb._count.members,
        createdAt: kb.createdAt,
        updatedAt: kb.updatedAt,
        lastSyncedAt: kb.lastSyncedAt,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getKnowledgeBase(id: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
        _count: { select: { documents: true, members: true, wikiPages: true } },
        wikiConfig: true,
        members: {
          take: 20,
          include: { user: { select: { id: true, email: true, fullName: true } } },
        },
      },
    });
    if (!kb) return null;

    const docStatusBuckets = await this.prisma.knowledgeBaseDocument.groupBy({
      by: ["status"],
      where: { knowledgeBaseId: id },
      _count: true,
    });

    return {
      id: kb.id,
      name: kb.name,
      description: kb.description,
      type: kb.type,
      status: kb.status,
      sourceType: kb.sourceType,
      sourceTypes: kb.sourceTypes,
      owner: kb.user,
      wikiEnabled: kb.wikiEnabled,
      wikiConfig: kb.wikiConfig,
      counts: {
        documents: kb._count.documents,
        members: kb._count.members,
        wikiPages: kb._count.wikiPages,
      },
      docStatusBuckets: docStatusBuckets.map((b) => ({ status: b.status, count: b._count })),
      members: kb.members.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        email: m.user?.email ?? null,
        fullName: m.user?.fullName ?? null,
      })),
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
      lastSyncedAt: kb.lastSyncedAt,
      lastError: kb.lastError,
    };
  }

  async listDocuments(f: {
    search?: string;
    status?: string;
    knowledgeBaseId?: string;
    sourceType?: string;
    page?: string;
    pageSize?: string;
  }) {
    const { page, pageSize } = paging(f.page, f.pageSize);
    const where: Prisma.KnowledgeBaseDocumentWhereInput = {};
    if (f.search) where.title = { contains: f.search, mode: "insensitive" };
    if (f.status) where.status = f.status as Prisma.KnowledgeBaseDocumentWhereInput["status"];
    if (f.knowledgeBaseId) where.knowledgeBaseId = f.knowledgeBaseId;
    if (f.sourceType) where.sourceType = f.sourceType;

    const [rows, total] = await Promise.all([
      this.prisma.knowledgeBaseDocument.findMany({
        where,
        select: {
          id: true,
          title: true,
          sourceType: true,
          sourceUrl: true,
          status: true,
          chunkCount: true,
          rawContentSize: true,
          rawContentUri: true,
          knowledgeBaseId: true,
          knowledgeBase: {
            select: { id: true, name: true, user: { select: { email: true } } },
          },
          createdAt: true,
          updatedAt: true,
          processedAt: true,
          lastError: true,
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.knowledgeBaseDocument.count({ where }),
    ]);

    return {
      items: rows.map((d) => ({
        id: d.id,
        title: d.title,
        sourceType: d.sourceType,
        sourceUrl: d.sourceUrl,
        status: d.status,
        chunkCount: d.chunkCount,
        rawContentSize: d.rawContentSize,
        offloaded: !!d.rawContentUri,
        knowledgeBaseId: d.knowledgeBaseId,
        knowledgeBaseName: d.knowledgeBase?.name ?? null,
        ownerEmail: d.knowledgeBase?.user?.email ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        processedAt: d.processedAt,
        hasError: !!d.lastError,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getDocument(id: string) {
    const doc = await this.prisma.knowledgeBaseDocument.findUnique({
      where: { id },
      include: {
        knowledgeBase: {
          select: {
            id: true,
            name: true,
            user: { select: { id: true, email: true, fullName: true } },
          },
        },
      },
    });
    if (!doc) return null;

    const [parentChunks, embeddedChildChunks, totalChildChunks] = await Promise.all([
      this.prisma.parentChunk.count({ where: { documentId: id } }),
      this.prisma.childChunk.count({
        where: { documentId: id, embeddings: { some: {} } },
      }),
      this.prisma.childChunk.count({ where: { documentId: id } }),
    ]);

    return {
      id: doc.id,
      title: doc.title,
      sourceType: doc.sourceType,
      sourceUrl: doc.sourceUrl,
      mimeType: doc.mimeType,
      status: doc.status,
      knowledgeBase: doc.knowledgeBase,
      rawContent: doc.rawContent,
      rawContentSize: doc.rawContentSize,
      offloaded: !!doc.rawContentUri,
      rawContentUri: doc.rawContentUri,
      metadata: doc.metadata,
      chunkStats: {
        parentChunks,
        childChunks: totalChildChunks,
        embeddedChildChunks,
        notEmbeddedChildChunks: totalChildChunks - embeddedChildChunks,
      },
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      processedAt: doc.processedAt,
      lastError: doc.lastError,
    };
  }

  async listWikiPages(f: {
    search?: string;
    category?: string;
    knowledgeBaseId?: string;
    page?: string;
    pageSize?: string;
  }) {
    const { page, pageSize } = paging(f.page, f.pageSize);
    const where: Prisma.WikiPageWhereInput = {};
    if (f.search) {
      where.OR = [
        { title: { contains: f.search, mode: "insensitive" } },
        { slug: { contains: f.search, mode: "insensitive" } },
      ];
    }
    if (f.category) where.category = f.category as Prisma.WikiPageWhereInput["category"];
    if (f.knowledgeBaseId) where.knowledgeBaseId = f.knowledgeBaseId;

    const [rows, total] = await Promise.all([
      this.prisma.wikiPage.findMany({
        where,
        select: {
          id: true,
          slug: true,
          title: true,
          category: true,
          oneLiner: true,
          lastEditedBy: true,
          knowledgeBaseId: true,
          knowledgeBase: {
            select: { id: true, name: true, user: { select: { email: true } } },
          },
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.wikiPage.count({ where }),
    ]);

    return {
      items: rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        category: p.category,
        oneLiner: p.oneLiner,
        lastEditedBy: p.lastEditedBy,
        knowledgeBaseId: p.knowledgeBaseId,
        knowledgeBaseName: p.knowledgeBase?.name ?? null,
        ownerEmail: p.knowledgeBase?.user?.email ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getWikiPage(id: string) {
    const wiki = await this.prisma.wikiPage.findUnique({
      where: { id },
      include: {
        knowledgeBase: {
          select: {
            id: true,
            name: true,
            user: { select: { id: true, email: true, fullName: true } },
          },
        },
        sources: {
          take: 50,
          include: {
            document: {
              select: { id: true, title: true, sourceType: true, sourceUrl: true },
            },
          },
        },
        outboundLinks: { take: 50 },
      },
    });
    if (!wiki) return null;

    return {
      id: wiki.id,
      slug: wiki.slug,
      title: wiki.title,
      category: wiki.category,
      body: wiki.body,
      oneLiner: wiki.oneLiner,
      lastEditedBy: wiki.lastEditedBy,
      contentHash: wiki.contentHash,
      knowledgeBase: wiki.knowledgeBase,
      sources: wiki.sources.map((s) => ({
        documentId: s.documentId,
        spanStart: s.spanStart,
        spanEnd: s.spanEnd,
        quote: s.quote,
        document: s.document,
      })),
      outboundLinks: wiki.outboundLinks.map((l) => ({ ...l })),
      createdAt: wiki.createdAt,
      updatedAt: wiki.updatedAt,
    };
  }
}
