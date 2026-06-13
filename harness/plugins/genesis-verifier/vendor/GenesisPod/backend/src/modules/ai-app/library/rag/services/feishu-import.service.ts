/**
 * Feishu Import Service
 * Handles importing content from Feishu (Wiki nodes, Docs) to RAG Knowledge Base
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { UrlFetchService } from "./url-fetch.service";

export type FeishuLinkType =
  | "wiki_node"
  | "doc"
  | "sheet"
  | "bitable"
  | "external";

export interface FeishuImportParams {
  url: string;
  title?: string;
  description?: string;
  userId: string;
  knowledgeBaseId?: string;
}

export interface FeishuImportResult {
  documentId: string;
  title: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  linkType: FeishuLinkType;
  detailUrl: string;
}

@Injectable()
export class FeishuImportService {
  private readonly logger = new Logger(FeishuImportService.name);

  private readonly FEISHU_DOMAINS = [
    "feishu.cn",
    "larksuite.com",
    "feishu.net",
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly urlFetchService: UrlFetchService,
  ) {}

  /**
   * Import content from Feishu URL to RAG Knowledge Base
   */
  async importFeishuUrl(
    params: FeishuImportParams,
  ): Promise<FeishuImportResult> {
    this.logger.log(`Importing Feishu URL: ${params.url}`);

    const linkType = this.identifyLinkType(params.url);
    this.logger.log(`Link type: ${linkType}`);

    // Check for duplicates
    const existingDoc = await this.findExistingDocument(params.url);
    if (existingDoc) {
      throw new Error(
        `该内容已存在于知识库"${existingDoc.knowledgeBase?.name || "未知"}"中`,
      );
    }

    // Get or create default KB
    const knowledgeBase = params.knowledgeBaseId
      ? await this.knowledgeBaseService.findById(params.knowledgeBaseId)
      : await this.getOrCreateDefaultKnowledgeBase(params.userId);

    // Extract metadata
    const metadata = await this.extractMetadata(
      params.url,
      params.title,
      params.description,
    );

    // Determine source type
    const sourceType = this.getSourceType(linkType);

    // Add document to knowledge base
    const document = await this.knowledgeBaseService.addDocument(
      knowledgeBase.id,
      {
        title: metadata.title,
        sourceType,
        sourceUrl: params.url,
        content: metadata.description || "",
        metadata: {
          author: metadata.author,
          feishuLinkType: linkType,
          importedAt: new Date().toISOString(),
          importSource: "feishu",
        },
      },
    );

    this.logger.log(
      `Document created: ${document.id} in KB ${knowledgeBase.id}`,
    );

    return {
      documentId: document.id,
      title: document.title,
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBaseName: knowledgeBase.name,
      linkType,
      detailUrl: `/rag/${knowledgeBase.id}/documents/${document.id}`,
    };
  }

  /**
   * Identify the type of Feishu link
   */
  identifyLinkType(url: string): FeishuLinkType {
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname.toLowerCase();

      if (pathname.includes("/wiki/")) {
        return "wiki_node";
      }
      if (pathname.includes("/docs/") || pathname.includes("/docx/")) {
        return "doc";
      }
      if (pathname.includes("/sheets/") || pathname.includes("/sheet/")) {
        return "sheet";
      }
      if (pathname.includes("/base/") || pathname.includes("/bitable/")) {
        return "bitable";
      }
    } catch (error) {
      this.logger.warn(`Failed to parse URL: ${url}`);
    }

    return "external";
  }

  /**
   * Check if a URL is a Feishu domain
   */
  isFeishuUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return this.FEISHU_DOMAINS.some((domain) =>
        parsedUrl.hostname.includes(domain),
      );
    } catch {
      return false;
    }
  }

  private async extractMetadata(
    url: string,
    providedTitle?: string,
    providedDescription?: string,
  ): Promise<{ title: string; description?: string; author?: string }> {
    try {
      const fetchResult = await this.urlFetchService.fetchUrl(url);
      return {
        title: providedTitle || fetchResult.title || "无标题",
        description: providedDescription || fetchResult.metadata.description,
        author: fetchResult.metadata.author,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to extract metadata from ${url}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return {
        title: providedTitle || "无标题",
        description: providedDescription,
      };
    }
  }

  private getSourceType(linkType: FeishuLinkType): string {
    switch (linkType) {
      case "wiki_node":
        return "FEISHU_WIKI";
      case "doc":
        return "FEISHU_DOC";
      case "sheet":
        return "FEISHU_SHEET";
      case "bitable":
        return "FEISHU_BITABLE";
      default:
        return "URL";
    }
  }

  private async findExistingDocument(url: string) {
    return this.prisma.knowledgeBaseDocument.findFirst({
      where: { sourceUrl: url },
      include: {
        knowledgeBase: {
          select: { id: true, name: true },
        },
      },
    });
  }

  private async getOrCreateDefaultKnowledgeBase(userId: string) {
    let kb = await this.prisma.knowledgeBase.findFirst({
      where: {
        userId,
        name: { in: ["飞书同步", "Feishu Collection", "飞书收藏"] },
      },
    });

    if (kb) return kb;

    kb = await this.prisma.knowledgeBase.findFirst({
      where: { userId, type: "PERSONAL" },
      orderBy: { createdAt: "asc" },
    });

    if (kb) return kb;

    this.logger.log(`Creating default Feishu KB for user ${userId}`);
    return this.knowledgeBaseService.create(userId, {
      name: "飞书同步",
      description: "通过飞书自动同步的文档和知识库内容",
      sourceType: "URL",
    });
  }

  /**
   * Get user mapping from Feishu Open ID
   * Note: This is a reverse lookup (feishuOpenId → userId), separate from
   * FeishuDataSourceService.getFeishuBinding() which does (userId → feishuOpenId)
   */
  async getUserByFeishuOpenId(feishuOpenId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        preferences: {
          path: ["feishuOpenId"],
          equals: feishuOpenId,
        },
      },
      select: { id: true },
    });

    return user?.id || null;
  }
}
