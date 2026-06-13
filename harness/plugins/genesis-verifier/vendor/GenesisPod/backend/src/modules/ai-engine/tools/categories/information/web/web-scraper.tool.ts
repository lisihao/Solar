/**
 * Web Scraper Tool
 * 网页抓取工具 - 复用 SearchService 的 URL 抓取能力
 */

import { Injectable } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

import { SearchService } from "../../../../content/web-search/web-search.service";

// ============================================================================
// Types
// ============================================================================

export interface WebScraperInput {
  /**
   * 要抓取的 URL
   */
  url: string;

  /**
   * 是否提取主要内容（去除导航、广告等）
   */
  extractMainContent?: boolean;

  /**
   * 最大内容长度（字符数）
   */
  maxLength?: number;

  /**
   * 抓取模式：
   * - "summary"（默认）：抽 main content，限首 5K 字，节省 token
   * - "full"：全文抓取，限 8K 字
   */
  extractMode?: "summary" | "full";

  /**
   * 是否抽取页面图片（默认 false 兼容老调用方）
   * 启用后从 html 中扫描 <img>，过滤图标 / pixel / placeholder，
   * 在 output.images 字段返回结构化图片清单（含 alt / figcaption / src）。
   * 适用于 Researcher 调用时 withFigures=true 的场景。
   */
  extractImages?: boolean;
}

export interface ScrapedImage {
  /** 图片直链 src（已规范化为 https:// 或 data:image/...）*/
  src: string;
  /** alt 属性（若无则空字符串）*/
  alt: string;
  /** 同祖先 figure 内的 figcaption 文本（若有）*/
  caption?: string;
  /** 在文档中的相对位置标记（如 "Figure 3" / 标题前 N 段后）*/
  contextHint?: string;
}

export interface WebScraperOutput {
  /**
   * 页面标题
   */
  title: string;

  /**
   * 提取的内容（纯文本）
   */
  content: string;

  /**
   * 清理后的 HTML（去除 script/style，保留结构标签，用于图片提取）
   */
  html?: string;

  /**
   * 抽到的图片清单（仅当 extractImages=true 时填充，已过滤图标/pixel/广告位）
   */
  images?: ScrapedImage[];

  /**
   * 原始 URL
   */
  url: string;

  /**
   * 内容长度
   */
  contentLength: number;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 内容是否被 8K 兜底截断
   */
  truncated?: boolean;

  /**
   * 截断前的原始内容长度（字符数）
   */
  originalLength?: number;

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class WebScraperTool extends BaseTool<
  WebScraperInput,
  WebScraperOutput
> {
  readonly id = "web-scraper";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "information";
  readonly tags = ["web", "scrape", "html", "general"];
  readonly name = "网页抓取";
  readonly description =
    "抓取并解析指定 URL 的网页内容。提取页面标题和主要文本内容，适用于获取文章、博客、新闻等网页的详细信息。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "要抓取的网页 URL，必须是完整的 HTTP/HTTPS 地址",
      },
      extractMainContent: {
        type: "boolean",
        description: "是否只提取主要内容，过滤导航、广告等",
        default: true,
      },
      maxLength: {
        type: "number",
        description: "最大内容长度（字符数），默认 10000",
        default: 10000,
      },
      extractMode: {
        type: "string",
        enum: ["summary", "full"],
        default: "summary",
        description:
          "summary: 抽 main content + 首 5K 字（默认，节省 token）；full: 全文抓取，限 8K 字",
      },
      extractImages: {
        type: "boolean",
        description:
          "是否抽取页面图片清单（含 alt / figcaption / src）；适用于 withFigures=true 的研究调用。默认 false",
        default: false,
      },
    },
    required: ["url"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "页面标题",
      },
      content: {
        type: "string",
        description: "提取的页面内容",
      },
      url: {
        type: "string",
        description: "原始 URL",
      },
      contentLength: {
        type: "number",
        description: "内容长度（字符数）",
      },
      success: {
        type: "boolean",
        description: "抓取是否成功",
      },
      truncated: {
        type: "boolean",
        description: "内容是否被 8K 兜底截断",
      },
      originalLength: {
        type: "number",
        description: "截断前的原始内容长度（字符数）",
      },
      error: {
        type: "string",
        description: "错误信息（如果失败）",
      },
      images: {
        type: "array",
        description:
          "抽到的图片清单（仅 extractImages=true 时填充，已过滤图标 / pixel / 广告位）",
        items: {
          type: "object",
          properties: {
            src: {
              type: "string",
              description: "图片直链 https:// 或 data:image/...",
            },
            alt: { type: "string" },
            caption: {
              type: "string",
              description: "同祖先 <figure> 的 <figcaption> 文本",
            },
            contextHint: { type: "string" },
          },
        },
      },
    },
  };

  // 默认 summary 模式首段上限（字符数）
  private static readonly SUMMARY_LIMIT = 5000;
  // 所有模式的绝对兜底上限（字符数），防止 ToolInvoker 16K 截断
  private static readonly MAX_OUTPUT = 8000;

  constructor(private readonly searchService: SearchService) {
    super();
    // defaultTimeout set in class property // 30 秒超时
  }

  validateInput(input: WebScraperInput) {
    if (!input.url || typeof input.url !== "string") {
      return false;
    }

    // 验证 URL 格式
    try {
      new URL(input.url);
      return true;
    } catch {
      return false;
    }
  }

  protected async doExecute(
    input: WebScraperInput,
    _context: ToolContext,
  ): Promise<WebScraperOutput> {
    const {
      url,
      maxLength,
      extractImages = false,
      extractMode = "summary",
    } = input;

    try {
      // 使用 SearchService 的 fetchUrlContent 方法
      const result = await this.searchService.fetchUrlContent(url);

      if (!result.success) {
        // ★ P0-LIVE-SCRAPER-EMPTY (2026-04-30): 之前硬编码 "Failed to fetch URL content"
        //   把 fetchUrlContent 返回的真实 HTTP 错误（403 Forbidden / 451 Unavailable
        //   For Legal Reasons / timeout / "PDF skipped — using snippet"）全吞了，
        //   LLM 看到一连串相同 generic 错误反复抓同样 URL 浪费 12K tokens/iter。
        //   透传原始 error 让 LLM 决策：403 → 换源；timeout → 跳过；PDF skipped → 用 snippet。
        return {
          title: "",
          content: "",
          url,
          contentLength: 0,
          success: false,
          error: result.error || "Failed to fetch URL content",
        };
      }

      let content = result.content || "";

      // Step 1: 按 extractMode 施加模式限制
      // summary 模式：限首 5K 字，节省 LLM token
      // full 模式：不在此处限制，由 Step 2/3 兜底
      if (extractMode === "summary") {
        if (content.length > WebScraperTool.SUMMARY_LIMIT) {
          content = content.slice(0, WebScraperTool.SUMMARY_LIMIT);
        }
      }

      // Step 2: 兼容老调用方传入的 maxLength（显式指定时优先于 extractMode 模式限）
      if (maxLength !== undefined && content.length > maxLength) {
        content = content.substring(0, maxLength) + "...";
      }

      // Step 3: 8K 绝对兜底——防止 ToolInvoker truncatePayload 16K 截断造成 JSON 损坏
      const originalLength = content.length;
      const truncated = content.length > WebScraperTool.MAX_OUTPUT;
      if (truncated) {
        content =
          content.slice(0, WebScraperTool.MAX_OUTPUT) + "\n…[truncated]";
      }

      const images =
        extractImages && result.html
          ? this.extractImageList(result.html, url)
          : undefined;

      return {
        title: result.title || "",
        content,
        html: result.html,
        url,
        contentLength: content.length,
        success: true,
        truncated,
        originalLength,
        ...(images ? { images } : {}),
      };
    } catch (error) {
      return {
        title: "",
        content: "",
        url,
        contentLength: 0,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 从清理后的 HTML 抽取图片清单。
   *
   * 过滤规则：
   * - src 必须 https:// 或 data:image/...
   * - 排除 favicon / pixel tracker / 广告位（src 含 'icon' / '1x1' / 'pixel' / 'tracker' / 'beacon'）
   * - 排除尺寸太小（width/height 属性 < 100 px）
   * - 同 src 去重（保留含 alt / figcaption 信息更完整的一条）
   * - 单页 cap 12 张，按出现顺序保留前 12
   *
   * 解析采用正则（轻量、无 dom 依赖），不追求 100% 准确，仅供 Researcher LLM 二次判断。
   */
  private extractImageList(html: string, baseUrl: string): ScrapedImage[] {
    const out: ScrapedImage[] = [];
    const seen = new Set<string>();
    // 先抽取 figure...figcaption 配对，建立 src → caption 的映射
    const figureBlocks = html.match(/<figure[\s\S]*?<\/figure>/gi) ?? [];
    const captionBySrc = new Map<string, string>();
    for (const fig of figureBlocks) {
      const srcMatch = fig.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
      const capMatch = fig.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
      if (srcMatch && capMatch) {
        const cleanSrc = this.normalizeSrc(srcMatch[1], baseUrl);
        if (cleanSrc) {
          const captionText = capMatch[1]
            .replace(/<[^>]+>/g, "")
            .trim()
            .slice(0, 200);
          if (captionText) captionBySrc.set(cleanSrc, captionText);
        }
      }
    }
    // 再扫所有 <img>
    const imgRegex = /<img\b([^>]*)\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRegex.exec(html)) !== null) {
      const attrs = m[1];
      const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
      if (!srcMatch) continue;
      const altMatch = attrs.match(/alt\s*=\s*["']([^"']*)["']/i);
      const widthMatch = attrs.match(/width\s*=\s*["']?(\d+)/i);
      const heightMatch = attrs.match(/height\s*=\s*["']?(\d+)/i);
      const w = widthMatch ? parseInt(widthMatch[1], 10) : undefined;
      const h = heightMatch ? parseInt(heightMatch[1], 10) : undefined;
      if ((w !== undefined && w < 100) || (h !== undefined && h < 100)) {
        continue; // 太小，多半是图标
      }
      const cleanSrc = this.normalizeSrc(srcMatch[1], baseUrl);
      if (!cleanSrc || seen.has(cleanSrc)) continue;
      // 排除常见垃圾路径
      const lower = cleanSrc.toLowerCase();
      if (
        /\b(favicon|sprite|tracker|pixel|beacon|spinner|placeholder|gravatar)\b/.test(
          lower,
        ) ||
        /[/-](icon|logo)[-./]/.test(lower) ||
        /\b1x1\b/.test(lower)
      ) {
        continue;
      }
      seen.add(cleanSrc);
      out.push({
        src: cleanSrc,
        alt: altMatch?.[1] ?? "",
        caption: captionBySrc.get(cleanSrc),
      });
      if (out.length >= 12) break;
    }
    return out;
  }

  /**
   * 把 src 规范化到 https:// 或 data:image/...；其余（http / 相对路径解析失败）丢弃。
   */
  private normalizeSrc(rawSrc: string, baseUrl: string): string | null {
    const trimmed = rawSrc.trim();
    if (!trimmed) return null;
    // ★ 关键安全：直接丢弃 data:image —— LLM context 防爆。
    //   data:image base64 单张轻易 > 100KB，5 张/dim 会撑爆 LLM observation。
    //   Researcher 的 figureCandidate.sourceUrl 也强制要求 http(s)，data: URL 无法引用。
    if (trimmed.startsWith("data:")) return null;
    try {
      const abs = new URL(trimmed, baseUrl).toString();
      if (abs.startsWith("https://")) return abs;
      // http:// 升级为 https:// 不一定可用，保留原样仅当下游能处理；
      // 这里保守只接受真 https:// 来源，符合 Researcher figureCandidate 红线。
      if (abs.startsWith("http://"))
        return abs.replace(/^http:\/\//, "https://");
    } catch {
      // 相对路径解析失败
    }
    return null;
  }
}
