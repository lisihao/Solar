/**
 * PreparseService (W1 v2.0 rebuild)
 *
 * 文档加入 KB 时立即抽取富语料 + 图片 URL + 章节结构 + 源语种，落到
 * `KnowledgeBaseDocument.metadata.preparse`，让后续 W2 wiki ingest 直接消费
 * 不再现场抓 URL（rawContent 已是裸文本，丢失原 <img> / 视频缩略图）。
 *
 * **复用 H/E primitives 硬要求**：URL/YouTube 抓取一律走
 * `ContentFetchService.fetchFromUrl()`（含 SSRF guard + DB cache + Supadata
 *  fallback），本 service 仅做 image URL 抽取 + locale detection +
 * section parsing + DB 写回 + 状态机 + 失败重试。
 *
 * 见 docs/architecture/ai-app/library/wiki/llm-wiki-v2-rebuild-plan.md §4.W1。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  ContentFetchService,
  type FetchedContent,
} from "@/modules/ai-engine/facade";
import {
  detectLocale,
  extractImageUrls,
  extractYoutubeVideoId,
  parseSections,
  type PreparseMetadata,
} from "./preparse.utils";

const MAX_RETRIES = 3;

@Injectable()
export class PreparseService {
  private readonly log = new Logger(PreparseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentFetch: ContentFetchService,
  ) {}

  /**
   * 入口：根据 docId 加载 doc，按 sourceUrl 是否 URL 类型路由到对应 preparser。
   *
   * 幂等：metadata.preparse.status === 'ready' 直接跳过；'pending' / 'failed' 重试。
   *
   * fire-and-forget：caller（addDocument）不应 await 本方法，preparse 失败不阻断 doc 写入。
   * 内部异常一律 swallow + log error + 写 status='failed'。
   */
  async preparseDocument(docId: string): Promise<void> {
    const doc = await this.prisma.knowledgeBaseDocument.findUnique({
      where: { id: docId },
      select: {
        id: true,
        sourceUrl: true,
        // rawContentUri 必须与 rawContent 同 select：documents 写入后由
        // StorageOffloadService 搬到 R2 时 DB 列置空，PrismaService 的
        // hydrate hook 用 rawContentUri 透明回填。漏选 URI 会让 off-loaded
        // 文档读到 rawContent='' → preparse 抓不到内容静默失败。
        rawContent: true,
        rawContentUri: true,
        title: true,
        metadata: true,
      },
    });

    if (!doc) {
      this.log.warn(`[preparse ${docId}] doc not found, skipping`);
      return;
    }

    const existing = this.readPreparse(doc.metadata);
    if (existing?.status === "ready") {
      this.log.debug(`[preparse ${docId}] already ready, skipping`);
      return;
    }
    if (existing?.status === "parsing") {
      // 已有 in-flight，避免并发重入（pod 重启场景仍可能撞，accepted）
      this.log.debug(`[preparse ${docId}] already in-flight, skipping`);
      return;
    }

    const retryCount = (existing?.retryCount ?? 0) + 1;
    if (retryCount > MAX_RETRIES) {
      this.log.warn(
        `[preparse ${docId}] retry budget exhausted (${MAX_RETRIES}), giving up`,
      );
      return;
    }

    await this.writePreparse(docId, {
      status: "parsing",
      mediaUrls: [],
      retryCount,
    });

    try {
      const parsed = await this.runPreparse(doc);
      await this.writePreparse(docId, {
        ...parsed,
        status: "ready",
        parsedAt: new Date().toISOString(),
        retryCount,
      });
      this.log.log(
        `[preparse ${docId}] ready · ${parsed.mediaUrls.length} images · ` +
          `${parsed.structuredContent?.sections.length ?? 0} sections · ` +
          `locale=${parsed.sourceLocale}`,
      );
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      await this.writePreparse(docId, {
        status: "failed",
        mediaUrls: [],
        errorCode: "PREPARSE_FAILED",
        errorMessage: errMessage.slice(0, 500),
        retryCount,
      });
      this.log.error(
        `[preparse ${docId}] failed (attempt ${retryCount}/${MAX_RETRIES}): ${errMessage}`,
      );
    }
  }

  /**
   * 实际抓取 + 抽取流水线。
   *
   * 流程：
   *   1. URL 类型 → ContentFetchService.fetchFromUrl()（内置 YouTube 路由 + SSRF guard）
   *   2. 非 URL → 直接用已有的 rawContent
   *   3. 抽全部 image URL（markdown ![] + html <img> + cover + YT thumbnail）
   *   4. 抽 H2/H3 章节结构
   *   5. 语种检测
   */
  private async runPreparse(doc: {
    id: string;
    sourceUrl: string | null;
    rawContent: string | null;
    title: string | null;
  }): Promise<Omit<PreparseMetadata, "status" | "parsedAt" | "retryCount">> {
    let markdown = doc.rawContent ?? "";
    let coverImageUrl: string | null = null;
    let videoId: string | null = null;

    if (doc.sourceUrl && /^https?:\/\//i.test(doc.sourceUrl)) {
      videoId = extractYoutubeVideoId(doc.sourceUrl);

      // 复用 ContentFetchService（含 SSRF / YT cache / 网页 readability）
      const fetched: FetchedContent = await this.contentFetch.fetchFromUrl(
        doc.sourceUrl,
      );
      // ContentFetchService 已经把内容清洗成 markdown；优先用它而非 rawContent
      // （rawContent 可能是用户手贴的 / 旧版本截断的）
      if (fetched.content) {
        markdown = fetched.content;
      }
      coverImageUrl = fetched.coverImage ?? null;
    }

    const mediaUrls = extractImageUrls({
      markdown,
      coverImageUrl,
      videoId,
    });
    const sections = parseSections(markdown);
    const sourceLocale = detectLocale(markdown);

    return {
      mediaUrls,
      sourceLocale,
      structuredContent: {
        title: doc.title ?? "",
        sections,
      },
    };
  }

  private readPreparse(metadata: Prisma.JsonValue): PreparseMetadata | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    const sub = (metadata as Record<string, unknown>).preparse;
    if (!sub || typeof sub !== "object") return null;
    return sub as PreparseMetadata;
  }

  /**
   * Merge `preparse` 子键到 metadata（保留其他 metadata 字段）。
   * 用 raw SQL JSONB merge 避免 read-modify-write race（多个 pod 并发触发）。
   */
  private async writePreparse(
    docId: string,
    preparse: PreparseMetadata,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE knowledge_base_documents
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('preparse', ${JSON.stringify(preparse)}::jsonb)
      WHERE id = ${docId}
    `.catch((err: unknown) => {
      this.log.error(
        `[preparse ${docId}] writePreparse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
