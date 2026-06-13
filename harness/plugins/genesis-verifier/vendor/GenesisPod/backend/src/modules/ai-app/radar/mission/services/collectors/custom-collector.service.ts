import { Injectable, Logger } from "@nestjs/common";
import { RadarSource } from "@prisma/client";
import * as cheerio from "cheerio";
import { CollectContext, ICollector, RawCollectedItem } from "./icollector";
import { computeContentHash } from "./hash.util";
import { assertSafeHttpUrl } from "./ssrf-util";

interface CustomCollectorConfig {
  /** 列表项 CSS selector（必须） */
  listSelector?: string;
  titleSelector?: string;
  linkSelector?: string;
  dateSelector?: string;
  authorSelector?: string;
  /** 日期 attr，比如 'datetime' / 'data-time'；不指定则取 textContent */
  dateAttr?: string;
}

const FETCH_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * CustomCollector —— 用户自定义 URL + CSS selector 的通用 HTML 列表抓取器。
 *
 * 直接用 Node fetch + cheerio 解析；SSRF check 自带（黑名单内网 / 私有 IP / file://）。
 * 不依赖 ai-engine ContentFetchService，因为后者返回的是 markdown 提取后的内容，
 * 不保留原始 HTML，无法走 CSS selector 抽取 list 项。
 *
 * config 示例（前端编辑 source 时填写）：
 *   {
 *     listSelector: "article.post",
 *     titleSelector: "h2 a",
 *     linkSelector: "h2 a",
 *     dateSelector: "time",
 *     dateAttr: "datetime"
 *   }
 *
 * 缺 listSelector 则 throw —— PR-R3 source-curator agent 推荐时会一并产出 selector。
 */
@Injectable()
export class CustomCollector implements ICollector {
  readonly type = "CUSTOM";
  private readonly log = new Logger(CustomCollector.name);

  async fetch(
    source: RadarSource,
    ctx: CollectContext,
  ): Promise<RawCollectedItem[]> {
    const config = (source.config ?? {}) as CustomCollectorConfig;
    if (!config.listSelector) {
      throw new Error(
        "CUSTOM source 必须在 config.listSelector 提供列表项 CSS selector",
      );
    }
    assertSafeHttpUrl(source.identifier);
    const html = await this.fetchHtml(source.identifier);
    const $ = cheerio.load(html);
    const out: RawCollectedItem[] = [];
    $(config.listSelector).each((_, el) => {
      if (out.length >= ctx.perSourceLimit) return false;
      const $el = $(el);
      const pickText = (sel?: string): string =>
        sel ? $el.find(sel).first().text().trim() : $el.text().trim();
      const pickAttr = (
        sel: string | undefined,
        attr: string,
      ): string | undefined =>
        sel ? $el.find(sel).first().attr(attr) : $el.attr(attr);

      const title = pickText(config.titleSelector) || null;
      const href = pickAttr(
        config.linkSelector ?? config.titleSelector,
        "href",
      );
      const url = href ? this.absoluteUrl(href, source.identifier) : null;
      const dateStr = config.dateAttr
        ? pickAttr(config.dateSelector, config.dateAttr)
        : pickText(config.dateSelector);
      const publishedAt = this.parseDate(dateStr) ?? new Date();
      if (publishedAt <= ctx.since) return; // continue
      const externalId = (url ?? title ?? "").trim();
      if (!externalId) return; // continue
      const author = pickText(config.authorSelector);
      out.push({
        externalId,
        contentHash: computeContentHash(title, null),
        title,
        content: null,
        author: author || null,
        authorAvatar: null,
        url,
        publishedAt,
        metrics: null,
        raw: { source: source.identifier },
      });
      return undefined;
    });
    this.log.debug(`CUSTOM ${source.identifier} → ${out.length} new items`);
    return out;
  }

  private async fetchHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; GenesisRadar/1.0; +https://gens.team/bot)",
          Accept: "text/html,application/xhtml+xml,*/*;q=0.5",
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}`);
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/(html|xml|plain)|application\/xhtml\+xml/.test(contentType)) {
        throw new Error(`Unsupported content-type: ${contentType}`);
      }
      const reader = res.body?.getReader();
      if (!reader) {
        return await res.text();
      }
      let total = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_HTML_BYTES) {
          throw new Error(
            `HTML 大小超出上限 ${MAX_HTML_BYTES} bytes from ${url}`,
          );
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
    } finally {
      clearTimeout(timer);
    }
  }

  private absoluteUrl(href: string, base: string): string {
    try {
      return new URL(href, base).toString();
    } catch {
      return href;
    }
  }

  private parseDate(s?: string | null): Date | null {
    if (!s) return null;
    const trimmed = s.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
