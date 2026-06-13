import { Injectable, Logger } from "@nestjs/common";
import { RadarSource } from "@prisma/client";
// 紧急修复 (2026-05-16): `import Parser from "rss-parser"` 在 CJS 编译后变成
// `rss_parser_1.default()`，而 rss-parser 是纯 CJS 包没有 default export，
// 触发 prod bootstrap `TypeError: rss_parser_1.default is not a constructor`。
// 改用 `import * as Parser` 同项目内 RssService（explore/ingestion）一致的写法。
import * as RssParserModule from "rss-parser";
import { CollectContext, ICollector, RawCollectedItem } from "./icollector";
import { computeContentHash } from "./hash.util";
import { assertSafeHttpUrl } from "./ssrf-util";

// 最小内部类型（替代 any；rss-parser 自带类型对 ESM/CJS 互操作不友好）
interface RssParserItem {
  isoDate?: string;
  pubDate?: string;
  link?: string;
  guid?: string;
  id?: string;
  title?: string;
  content?: string;
  contentSnippet?: string;
  creator?: string;
  author?: string;
}
interface RssParserFeed {
  items?: RssParserItem[];
}
interface RssParserOptions {
  timeout?: number;
  requestOptions?: { headers?: Record<string, string> };
  customFields?: { item?: Array<[string, string]> };
}
interface RssParserInstance {
  parseURL(url: string): Promise<RssParserFeed>;
}
type RssParserCtor = new (opts?: RssParserOptions) => RssParserInstance;

const Parser = ((RssParserModule as unknown as { default?: unknown }).default ??
  RssParserModule) as RssParserCtor;

/**
 * RssCollector —— 直接解析 identifier (URL) 拿 feed。
 *
 * 用 rss-parser npm 包（项目已装），不依赖 explore/ingestion/RssService
 * 以保持 ai-app/radar 内的边界单一。
 */
@Injectable()
export class RssCollector implements ICollector {
  readonly type = "RSS";
  private readonly log = new Logger(RssCollector.name);
  private readonly parser: RssParserInstance;

  constructor() {
    this.parser = new Parser({
      timeout: 25_000,
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; GenesisRadar/1.0; +https://gens.team/bot)",
          Accept:
            "application/rss+xml, application/xml, application/atom+xml, text/xml, */*",
        },
      },
      customFields: {
        item: [
          ["dc:creator", "creator"],
          ["content:encoded", "content"],
        ],
      },
    });
  }

  async fetch(
    source: RadarSource,
    ctx: CollectContext,
  ): Promise<RawCollectedItem[]> {
    // SSRF 防护：rss-parser 内部走 follow-redirects，redirect 后可能跳到内网。
    // 入库时已校验过 identifier，但攻击者可能通过 DB 注入绕过——这里再校验一次。
    assertSafeHttpUrl(source.identifier);
    const feed = await this.parser.parseURL(source.identifier);
    const items = feed.items ?? [];
    const out: RawCollectedItem[] = [];
    for (const item of items) {
      if (out.length >= ctx.perSourceLimit) break;
      const publishedAt = this.parseDate(item.isoDate ?? item.pubDate);
      if (!publishedAt) continue;
      if (publishedAt <= ctx.since) continue;
      const link = (item.link ?? "").trim();
      const externalId = (item.guid ?? item.id ?? link).trim();
      if (!externalId) continue;
      const title = (item.title ?? "").trim() || null;
      const content =
        (item.content ?? item.contentSnippet ?? "").trim() || null;
      out.push({
        externalId,
        contentHash: computeContentHash(title, content),
        title,
        content,
        author: (item.creator ?? item.author ?? null) || null,
        authorAvatar: null,
        url: link || null,
        publishedAt,
        metrics: null,
        raw: item as unknown as Record<string, unknown>,
      });
    }
    this.log.debug(
      `RSS ${source.identifier} → ${out.length} new items (since ${ctx.since.toISOString()})`,
    );
    return out;
  }

  private parseDate(s?: string | null): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
