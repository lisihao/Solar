import {
  Controller,
  Get,
  Query,
  Res,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import axios from "axios";
import { AdvancedExtractorService } from "../../../../common/content-processing/advanced-extractor.service";
import { NewsExtractorService } from "./news-extractor.service";
import { PuppeteerFetcherService } from "./puppeteer-fetcher.service";
import { FlareSolverrService } from "./flaresolverr.service";
import { APP_CONFIG } from "../../../../common/config/app.config";
import { Public } from "../../../../common/decorators/public.decorator";

/**
 * 代理控制器 - 用于代理外部资源（如 PDF），绕过 CORS 和 X-Frame-Options 限制
 *
 * 四层回退机制：
 * 1. 直接 HTTP 请求（带浏览器 Headers）
 * 2. FlareSolverr（专业 Cloudflare 绕过服务）
 * 3. Jina Reader API（备选）
 * 4. Puppeteer 无头浏览器（最后手段）
 * 5. 优雅降级（提示用户手动访问）
 */
@Public()
@ApiTags("Proxy")
@Controller("proxy")
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  // Jina Reader API endpoint - 用于获取被 bot detection 阻止的网页内容
  private readonly JINA_READER_API = "https://r.jina.ai";

  constructor(
    private advancedExtractor: AdvancedExtractorService,
    private newsExtractor: NewsExtractorService,
    private puppeteerFetcher: PuppeteerFetcherService,
    private flareSolverr: FlareSolverrService,
  ) {}

  /**
   * SSRF protection: block requests to internal/private IP addresses
   */
  private isBlockedAddress(hostname: string): boolean {
    const lower = hostname.toLowerCase();

    // Block localhost variants
    if (lower === "localhost" || lower === "[::1]") return true;

    // Block IPv6 private ranges
    if (
      lower.startsWith("[fc") ||
      lower.startsWith("[fd") ||
      lower.startsWith("[fe80")
    )
      return true;

    // Check IPv4 patterns
    const ipv4Match = hostname.match(
      /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    );
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      if (a === 127) return true; // 127.0.0.0/8 loopback
      if (a === 10) return true; // 10.0.0.0/8 private
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
      if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
      if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
      if (a === 0) return true; // 0.0.0.0/8
    }

    return false;
  }

  /**
   * 通过 Jina Reader API 获取网页内容
   * 当直接获取返回 403 时使用此方法作为 fallback
   * Jina Reader 返回 Markdown 格式的内容
   */
  private async fetchViaJinaReader(url: string): Promise<{
    success: boolean;
    content?: string;
    error?: string;
    requiresCaptcha?: boolean;
  }> {
    try {
      this.logger.log(`Fetching via Jina Reader: ${url}`);
      const jinaUrl = `${this.JINA_READER_API}/${url}`;

      const response = await axios.get(jinaUrl, {
        timeout: 30000,
        headers: {
          Accept: "text/plain",
          "User-Agent": APP_CONFIG.brand.userAgent,
        },
      });

      if (response.status === 200 && response.data) {
        const content = String(response.data);

        // 检测 Cloudflare CAPTCHA 页面
        const captchaIndicators = [
          "Verify you are human",
          "Just a moment...",
          "needs to review the security of your connection",
          "Please turn JavaScript on",
          "Enable JavaScript and cookies",
          "Checking your browser",
          "DDoS protection by",
          "ray ID",
        ];

        const hasCaptcha = captchaIndicators.some((indicator) =>
          content.toLowerCase().includes(indicator.toLowerCase()),
        );

        if (hasCaptcha) {
          this.logger.warn(`Jina Reader returned CAPTCHA page for ${url}`);
          return {
            success: false,
            error:
              "此网站需要人机验证，无法自动获取内容。请点击「打开原始」在浏览器中查看。",
            requiresCaptcha: true,
          };
        }

        // 检查内容长度是否过短（可能是错误页面）
        if (content.length < 200) {
          this.logger.warn(
            `Jina Reader returned very short content for ${url}: ${content.length} chars`,
          );
          return {
            success: false,
            error: "获取的内容过短，可能是错误页面。",
          };
        }

        this.logger.log(
          `Successfully fetched via Jina Reader (${content.length} chars)`,
        );
        return { success: true, content };
      }

      return {
        success: false,
        error: `Jina Reader returned status ${response.status}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Jina Reader fallback failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 微信公众号文章 HTML 预处理
   *
   * 微信文章的特殊之处：
   * 1. #js_content 默认 visibility:hidden，Readability 会跳过隐藏内容
   * 2. 图片使用 data-src 而非 src（懒加载）
   * 3. 包含大量微信 UI 噪声（"继续滑动看下一个"等）
   */
  private preprocessWechatHtml(html: string): string {
    let processed = html;

    // 1. 移除 visibility:hidden 和 display:none，让 Readability 能看到内容
    processed = processed.replace(
      /visibility\s*:\s*hidden/gi,
      "visibility:visible",
    );

    // 2. 把 data-src 转为 src（微信图片懒加载）
    processed = processed.replace(
      /<img([^>]*?)data-src="([^"]+)"([^>]*?)>/gi,
      (match, before, dataSrc, after) => {
        // 如果已有 src 属性且不是空的占位图，保留原 src
        if (/src="(?!data:)[^"]+"/i.test(before + after)) {
          return match;
        }
        return `<img${before}src="${dataSrc}"${after}>`;
      },
    );

    // 3. 移除微信 UI 噪声元素
    const noisePatterns = [
      /<div[^>]*class="[^"]*qr_code_pc[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      /<div[^>]*id="js_pc_qr_code"[^>]*>[\s\S]*?<\/div>/gi,
      /继续滑动看下一个/g,
      /向上滑动看下一个/g,
      /轻触阅读原文/g,
    ];
    for (const pattern of noisePatterns) {
      processed = processed.replace(pattern, "");
    }

    // 4. 将微信图片 URL 通过代理（在提取后的 content 中也会生效）
    processed = processed.replace(
      /src="(https?:\/\/mmbiz\.qpic\.cn[^"]+)"/gi,
      (_, imgUrl) => {
        const proxyUrl = `/api/v1/proxy/image?url=${encodeURIComponent(imgUrl)}`;
        return `src="${proxyUrl}"`;
      },
    );

    return processed;
  }

  /**
   * 从 URL 中提取标题（用于 fallback）
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      // 取最后一段路径作为标题
      const segments = pathname.split("/").filter((s) => s.length > 0);
      if (segments.length > 0) {
        const lastSegment = segments[segments.length - 1];
        // 移除文件扩展名，替换连字符为空格
        return lastSegment
          .replace(/\.[^.]+$/, "")
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
      return urlObj.hostname;
    } catch {
      return "Untitled";
    }
  }

  /**
   * 将 Markdown 转换为简单的 HTML
   */
  private markdownToHtml(markdown: string, title: string): string {
    // 基本的 Markdown 到 HTML 转换
    const html = markdown
      // 代码块
      .replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
      // 行内代码
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // 粗体
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      // 斜体
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      // 标题
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // 图片
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
      // 列表
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
      // 段落
      .replace(/\n\n+/g, "</p><p>")
      .replace(/\n/g, "<br/>");

    return `<article><h1>${title}</h1><p>${html}</p></article>`;
  }
  /**
   * 代理 PDF 文件
   *
   * 解决问题：
   * 1. arXiv 等网站的 X-Frame-Options: DENY 阻止 iframe 嵌入
   * 2. CORS 跨域限制
   *
   * 使用方式：
   * http://localhost:4000/api/v1/proxy/pdf?url=https://arxiv.org/pdf/2511.04676v1
   */
  @Get("pdf")
  async proxyPdf(
    @Query("url") url: string,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`PDF proxy request received for URL: ${url}`);

    if (!url) {
      this.logger.warn("PDF proxy request missing URL parameter");
      throw new HttpException(
        "URL parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    // PDF 是静态文件，允许所有域名访问（用户导入的 PDF 应该能查看）
    // 仅做基本的 URL 格式验证
    try {
      const urlObj = new URL(url);

      if (this.isBlockedAddress(urlObj.hostname)) {
        throw new HttpException(
          "Access to internal addresses is not allowed",
          HttpStatus.FORBIDDEN,
        );
      }

      this.logger.log(`Fetching PDF from: ${urlObj.hostname}`);

      // 从远程服务器获取 PDF
      // 使用完整的浏览器请求头以绕过学术网站（如 openreview.net）的反爬策略
      const urlObj2 = new URL(url);
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000, // 30 seconds timeout
        maxRedirects: 5, // 跟随重定向
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
          Accept:
            "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          DNT: "1",
          Connection: "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          Referer: `${urlObj2.protocol}//${urlObj2.hostname}/`,
          "sec-ch-ua":
            '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-User": "?1",
        },
      });

      // 设置响应头，允许在 iframe 中显示
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
      // 关键：不设置 X-Frame-Options，允许 iframe 嵌入
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // 允许跨域 iframe 加载
      res.setHeader("Cache-Control", "public, max-age=86400"); // 缓存 24 小时
      // 移除限制性的 CSP 头，允许任何来源的 iframe 嵌入
      res.removeHeader("Content-Security-Policy");
      res.removeHeader("X-Frame-Options");

      this.logger.log(
        `Successfully fetched PDF (${Buffer.from(response.data).length} bytes)`,
      );

      // 发送 PDF 数据
      res.send(Buffer.from(response.data));
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Failed to fetch PDF from ${url}: ${error.message}`,
          error.stack,
        );
        throw new HttpException(
          "Failed to fetch external PDF resource",
          error.response?.status || HttpStatus.BAD_GATEWAY,
        );
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Internal error while proxying PDF: ${errorMessage}`,
        errorStack,
      );
      throw new HttpException(
        "Internal server error while proxying PDF",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 代理 HTML 页面
   *
   * 解决问题：
   * 1. arXiv 等网站的 X-Frame-Options: SAMEORIGIN 阻止 iframe 嵌入
   * 2. CORS 跨域限制
   *
   * 使用方式：
   * http://localhost:4000/api/v1/proxy/html?url=https://arxiv.org/abs/2511.04675v1
   */
  @Get("html")
  async proxyHtml(
    @Query("url") url: string,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log(`HTML proxy request received for URL: ${url}`);

    if (!url) {
      this.logger.warn("HTML proxy request missing URL parameter");
      throw new HttpException(
        "URL parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    // 安全检查：只拦截内网地址（防 SSRF），域名白名单已移除
    // ★ 内容已通过 AI 筛选流程，用户主动导入的 URL 无需域名限制
    try {
      const urlObj = new URL(url);

      if (this.isBlockedAddress(urlObj.hostname)) {
        throw new HttpException(
          "Access to internal addresses is not allowed",
          HttpStatus.FORBIDDEN,
        );
      }

      this.logger.log(`Fetching HTML from allowed domain: ${urlObj.hostname}`);

      // 从远程服务器获取 HTML - 使用真实浏览器特征
      const response = await axios.get(url, {
        responseType: "text",
        timeout: 30000,
        maxRedirects: 5,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Cache-Control": "max-age=0",
          "sec-ch-ua":
            '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          DNT: "1",
          Connection: "keep-alive",
        },
      });

      // 设置响应头，允许在 iframe 中显示
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      // 关键：不设置 X-Frame-Options，允许 iframe 嵌入
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600"); // 缓存 1 小时
      // 移除限制性的 CSP 头，允许任何来源的 iframe 嵌入
      res.removeHeader("Content-Security-Policy");
      res.removeHeader("X-Frame-Options");

      // 修改 HTML，移除限制性头部并添加 base 标签
      let html = response.data as string;
      // 构建 base URL — 使用页面完整路径（非仅 hostname）
      // 例如 https://arxiv.org/html/2602.14516v1 的图片用相对路径 ./extracted/figure.png
      // base 需要是 https://arxiv.org/html/2602.14516v1/ 而非 https://arxiv.org/
      const pathDir = urlObj.pathname.endsWith("/")
        ? urlObj.pathname
        : urlObj.pathname + "/";
      const baseUrl = `${urlObj.protocol}//${urlObj.hostname}${pathDir}`;

      // 移除阻止 iframe 嵌入的 meta 标签
      // 这些标签会阻止内容在 iframe 中显示，即使使用 Blob URL
      html = html.replace(
        /<meta\s+http-equiv=["']?Content-Security-Policy["']?\s+content=["'][^"']*["']\s*\/?>/gi,
        "",
      );
      html = html.replace(
        /<meta\s+http-equiv=["']?X-Frame-Options["']?\s+content=["'][^"']*["']\s*\/?>/gi,
        "",
      );

      // 在 <head> 标签后插入 <base> 标签
      if (html.includes("<head>")) {
        html = html.replace("<head>", `<head><base href="${baseUrl}">`);
      } else if (html.includes("<HEAD>")) {
        html = html.replace("<HEAD>", `<HEAD><base href="${baseUrl}">`);
      }

      // ★ Blob URL 中 <base> 标签不生效（Blob URL 没有真实域名信息）
      // 必须将相对路径的资源 URL 直接替换为绝对路径
      const origin = `${urlObj.protocol}//${urlObj.hostname}`;
      html = html.replace(
        /(src|href)=(["'])(\.\/|\.\.\/|(?!https?:\/\/|data:|blob:|#|javascript:)[^"']*?)\2/gi,
        (match, attr, quote, rawPath) => {
          // 跳过空属性和绝对 URL
          if (
            !rawPath ||
            rawPath.startsWith("http") ||
            rawPath.startsWith("data:")
          ) {
            return match;
          }
          let absoluteUrl: string;
          if (rawPath.startsWith("./")) {
            // ./path → relative to current page directory
            absoluteUrl = `${baseUrl}${rawPath.slice(2)}`;
          } else if (rawPath.startsWith("../")) {
            // ../path → resolve relative to page (simplified: use origin + path)
            absoluteUrl = `${origin}${rawPath}`;
          } else if (rawPath.startsWith("/")) {
            // /path → root-relative
            absoluteUrl = `${origin}${rawPath}`;
          } else {
            // bare relative (image.png) → relative to current page directory
            absoluteUrl = `${baseUrl}${rawPath}`;
          }
          return `${attr}=${quote}${absoluteUrl}${quote}`;
        },
      );

      this.logger.log(
        `Successfully processed HTML (${html.length} characters) from ${urlObj.hostname}`,
      );

      // 发送修改后的 HTML 数据
      res.send(html);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Failed to fetch HTML from ${url}: ${error.message}`,
          error.stack,
        );
        throw new HttpException(
          `Failed to fetch HTML: ${error.message}`,
          error.response?.status || HttpStatus.BAD_GATEWAY,
        );
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Internal error while proxying HTML: ${errorMessage}`,
        errorStack,
      );
      throw new HttpException(
        "Internal server error while proxying HTML",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Reader Mode - 提取网页主要内容
   *
   * 使用高级4层容错提取机制：
   * Plan A: Readability (70-80% success) - 最优方案，适合新闻/博客
   * Plan B: DOM 节点提取 (60-70% success) - Readability失败时的备选
   * Plan C: 正则表达式提取 (50-60% success) - 结构化内容提取
   * Plan D: 基础HTML降级 (>99% success) - 最后的安全网
   *
   * 完美解决X-Frame-Options、CSP等限制
   * 支持AI完整分析内容
   * 确保提取成功率 >95%
   *
   * 使用方式：
   * http://localhost:4000/api/v1/proxy/html-reader?url=https://example.com
   */
  @Get("html-reader")
  async proxyHtmlReader(
    @Query("url") url: string,
  ): Promise<Record<string, unknown>> {
    this.logger.log(`Reader Mode request received for URL: ${url}`);

    if (!url) {
      this.logger.warn("Reader Mode request missing URL parameter");
      throw new HttpException(
        "URL parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    // 安全检查：只拦截内网地址
    try {
      const urlObj = new URL(url);

      if (this.isBlockedAddress(urlObj.hostname)) {
        throw new HttpException(
          "Access to internal addresses is not allowed",
          HttpStatus.FORBIDDEN,
        );
      }

      this.logger.log(`Fetching HTML for Reader Mode from: ${urlObj.hostname}`);

      let html: string | undefined;
      let usedJinaReader = false;

      // 尝试直接获取 HTML
      try {
        const response = await axios.get(url, {
          responseType: "text",
          timeout: 30000,
          maxRedirects: 5,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "max-age=0",
            Connection: "keep-alive",
            "Sec-Ch-Ua":
              '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
          },
        });
        html = response.data;
      } catch (fetchError) {
        // 如果是 403 错误，启动四层回退机制
        if (
          axios.isAxiosError(fetchError) &&
          fetchError.response?.status === 403
        ) {
          this.logger.log(
            `Direct fetch returned 403, starting fallback chain for ${url}`,
          );

          // 回退层 1: FlareSolverr（专业 Cloudflare 绕过服务）
          if (this.flareSolverr.getIsAvailable()) {
            this.logger.log(`Trying FlareSolverr for ${url}`);
            const flareResult = await this.flareSolverr.fetchPage(url, {
              maxTimeout: 60000,
            });

            if (flareResult.success && flareResult.html) {
              this.logger.log(
                `FlareSolverr successfully fetched ${url} (${flareResult.solveTime}ms)`,
              );
              html = flareResult.html;
            } else {
              this.logger.warn(`FlareSolverr failed: ${flareResult.error}`);
            }
          }

          // 回退层 2: Jina Reader API（如果 FlareSolverr 失败或不可用）
          if (!html) {
            this.logger.log(`Trying Jina Reader for ${url}`);
            const jinaResult = await this.fetchViaJinaReader(url);
            if (jinaResult.success && jinaResult.content) {
              const titleMatch = jinaResult.content.match(/^#\s+(.+)$/m);
              const title = titleMatch ? titleMatch[1] : urlObj.hostname;
              html = this.markdownToHtml(jinaResult.content, title);
              usedJinaReader = true;
            }
          }

          // 回退层 3: Puppeteer 无头浏览器（最后手段）
          if (!html) {
            this.logger.log(`Trying Puppeteer for ${url}`);
            const puppeteerResult = await this.puppeteerFetcher.fetchPage(url, {
              timeout: 30000,
            });

            if (puppeteerResult.success && puppeteerResult.html) {
              this.logger.log(
                `Puppeteer successfully fetched ${url} (${puppeteerResult.loadTime}ms)`,
              );
              html = puppeteerResult.html;
            }
          }

          // 所有方法都失败，返回优雅降级响应
          if (!html) {
            this.logger.warn(
              `All fallback methods failed for ${urlObj.hostname}, returning graceful degradation`,
            );
            return {
              success: false,
              requiresCaptcha: true,
              title: this.extractTitleFromUrl(url),
              content: "",
              textContent: "",
              excerpt:
                "此网站使用了 Cloudflare 等安全防护，需要人机验证才能访问内容。",
              siteName: urlObj.hostname,
              length: 0,
              plan: "blocked",
              confidence: 0,
              sourceUrl: url,
              message:
                "此网站需要人机验证，无法自动获取内容。请点击「打开原始」在浏览器中查看。",
            };
          }
        } else {
          throw fetchError;
        }
      }

      // 确保 html 已定义（如果前面所有方法都失败，应该已经返回了）
      if (!html) {
        throw new HttpException(
          "Failed to fetch page content",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // 使用高级提取服务，实现4层容错机制
      let result = await this.advancedExtractor.extract(html, url, 30000);

      // SPA/CSR 检测：内容过短时，用 Puppeteer 执行 JS 后重试
      const strippedTextReader = (result.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const isLowQualityReader =
        !usedJinaReader && strippedTextReader.length < 500;
      if (isLowQualityReader) {
        this.logger.log(
          `Low quality extraction (stripped: ${strippedTextReader.length} chars), likely SPA/CSR. Trying Puppeteer...`,
        );
        const puppeteerResult = await this.puppeteerFetcher.fetchPage(url, {
          timeout: 30000,
        });
        if (puppeteerResult.success && puppeteerResult.html) {
          this.logger.log(
            `Puppeteer re-fetch successful (${puppeteerResult.loadTime}ms), re-extracting...`,
          );
          html = puppeteerResult.html;
          result = await this.advancedExtractor.extract(html, url, 30000);
        }
      }

      if (!result.success || result.length === 0) {
        this.logger.warn(
          `Failed to extract content from ${url} (Plan: ${result.plan})`,
        );
        throw new HttpException(
          "Failed to extract content from this page",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      this.logger.log(
        `Successfully extracted article via Plan ${result.plan.toUpperCase()}${usedJinaReader ? " (via Jina Reader)" : ""}: "${result.title}" (${result.length} characters, confidence: ${result.confidence}%)`,
      );

      // 返回提取的内容
      return {
        title: result.title,
        content: result.content,
        textContent: result.textContent,
        excerpt: result.excerpt,
        byline: result.byline,
        siteName: result.siteName,
        length: result.length,
        plan: result.plan,
        viaJinaReader: usedJinaReader, // 标记是否通过 Jina Reader 获取
        confidence: result.confidence,
        sourceUrl: url,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Failed to fetch HTML from ${url}: ${error.message}`,
          error.stack,
        );
        throw new HttpException(
          `Failed to fetch HTML: ${error.message}`,
          error.response?.status || HttpStatus.BAD_GATEWAY,
        );
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Internal error in Reader Mode: ${errorMessage}`,
        errorStack,
      );
      throw new HttpException(
        "Internal server error while extracting content",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 新闻内容专用提取器 - 优化提取新闻文章的元数据
   *
   * 实现4层元数据提取层级：
   * 1. Schema.org JSON-LD (95% 置信度) - 最标准的新闻元数据格式
   * 2. Open Graph meta标签 (75% 置信度) - 常见的社交媒体分享标准
   * 3. Twitter Card meta标签 (60% 置信度) - 推特分享标准
   * 4. 通用提取 (50% 置信度) - 启发式备选方案
   *
   * 增强功能：
   * - 自动检测付费墙（subscription, membership, login required等）
   * - 提取发布日期、修改日期、作者等关键元数据
   * - 图片URL提取（og:image, twitter:image等）
   * - 网站名称和域名识别
   *
   * 使用方式：
   * http://localhost:4000/api/v1/proxy/html-reader-news?url=https://example.com/article
   */
  @Get("html-reader-news")
  async proxyHtmlReaderNews(
    @Query("url") url: string,
  ): Promise<Record<string, unknown>> {
    this.logger.log(`News Reader Mode request received for URL: ${url}`);

    if (!url) {
      this.logger.warn("News Reader Mode request missing URL parameter");
      throw new HttpException(
        "URL parameter is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    // 检查是否为 PDF 文件 - Reader Mode 不应处理 PDF，应直接在 PDF Viewer 中打开
    if (url.toLowerCase().endsWith(".pdf")) {
      this.logger.log(
        `PDF URL detected in News Reader Mode, returning redirect to PDF viewer: ${url}`,
      );
      return {
        isPdf: true,
        pdfUrl: url,
        title: decodeURIComponent(url.split("/").pop() || "PDF Document"),
        content: "",
        error: "This is a PDF file. Please use the PDF viewer instead.",
      };
    }

    // News类别不限制域名，允许访问所有新闻网站
    try {
      let currentUrl = url;
      let html: string | undefined;
      let usedJinaReader = false;
      const maxMetaRedirects = 3; // 最多跟随3次 meta refresh 重定向

      // 获取 HTML 并处理 meta refresh 重定向
      for (
        let redirectCount = 0;
        redirectCount <= maxMetaRedirects;
        redirectCount++
      ) {
        const urlObj = new URL(currentUrl);

        if (this.isBlockedAddress(urlObj.hostname)) {
          throw new HttpException(
            "Access to internal addresses is not allowed",
            HttpStatus.FORBIDDEN,
          );
        }

        this.logger.log(
          `Fetching HTML for News Reader Mode from: ${urlObj.hostname} (redirect #${redirectCount})`,
        );

        // 尝试直接获取 HTML
        try {
          const response = await axios.get(currentUrl, {
            responseType: "text",
            timeout: 30000,
            maxRedirects: 5,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
              "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
              "Accept-Encoding": "gzip, deflate, br",
              "Cache-Control": "max-age=0",
              Connection: "keep-alive",
              "Sec-Ch-Ua":
                '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
              "Sec-Ch-Ua-Mobile": "?0",
              "Sec-Ch-Ua-Platform": '"Windows"',
              "Sec-Fetch-Dest": "document",
              "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Site": "none",
              "Sec-Fetch-User": "?1",
              "Upgrade-Insecure-Requests": "1",
            },
          });
          html = response.data;
        } catch (fetchError) {
          // 如果是 403 错误，启动四层回退机制
          if (
            axios.isAxiosError(fetchError) &&
            fetchError.response?.status === 403
          ) {
            this.logger.log(
              `Direct fetch returned 403, starting fallback chain for ${currentUrl}`,
            );

            // 回退层 1: FlareSolverr（专业 Cloudflare 绕过服务）
            if (this.flareSolverr.getIsAvailable()) {
              this.logger.log(`Trying FlareSolverr for ${currentUrl}`);
              const flareResult = await this.flareSolverr.fetchPage(
                currentUrl,
                {
                  maxTimeout: 60000,
                },
              );

              if (flareResult.success && flareResult.html) {
                this.logger.log(
                  `FlareSolverr successfully fetched ${currentUrl} (${flareResult.solveTime}ms)`,
                );
                html = flareResult.html;
                break; // FlareSolverr 成功，跳出重定向循环
              } else {
                this.logger.warn(`FlareSolverr failed: ${flareResult.error}`);
              }
            }

            // 回退层 2: Jina Reader API
            this.logger.log(`Trying Jina Reader for ${currentUrl}`);
            const jinaResult = await this.fetchViaJinaReader(currentUrl);
            if (jinaResult.success && jinaResult.content) {
              // Jina Reader 返回 Markdown，转换为 HTML
              const titleMatch = jinaResult.content.match(/^#\s+(.+)$/m);
              const title = titleMatch ? titleMatch[1] : urlObj.hostname;
              html = this.markdownToHtml(jinaResult.content, title);
              usedJinaReader = true;
              break; // Jina Reader 成功，跳出重定向循环
            }

            // 回退层 3: Puppeteer 无头浏览器（最后手段）
            this.logger.log(`Trying Puppeteer for ${currentUrl}`);
            const puppeteerResult = await this.puppeteerFetcher.fetchPage(
              currentUrl,
              { timeout: 30000 },
            );

            if (puppeteerResult.success && puppeteerResult.html) {
              this.logger.log(
                `Puppeteer successfully fetched ${currentUrl} (${puppeteerResult.loadTime}ms)`,
              );
              html = puppeteerResult.html;
              break; // Puppeteer 成功，跳出重定向循环
            }

            // 所有方法都失败，返回优雅降级响应
            this.logger.warn(
              `All fallback methods failed for ${urlObj.hostname}, returning graceful degradation`,
            );
            return {
              success: false,
              requiresCaptcha: true,
              title: this.extractTitleFromUrl(url),
              content: "",
              textContent: "",
              excerpt:
                "此网站使用了 Cloudflare 等安全防护，需要人机验证才能访问内容。",
              siteName: urlObj.hostname,
              length: 0,
              plan: "blocked",
              confidence: 0,
              sourceUrl: url,
              finalUrl: currentUrl,
              message:
                "此网站需要人机验证，无法自动获取内容。请点击「打开原始」在浏览器中查看。",
            };
          } else {
            throw fetchError;
          }
        }

        // 检测 meta refresh 重定向（如 deepmind.google -> blog.google）
        const redirectCheck = this.newsExtractor.detectMetaRefreshRedirect(
          html!,
          currentUrl,
        );

        if (redirectCheck.isRedirect && redirectCheck.redirectUrl) {
          if (redirectCount < maxMetaRedirects) {
            this.logger.log(
              `Following meta refresh redirect: ${currentUrl} -> ${redirectCheck.redirectUrl}`,
            );
            currentUrl = redirectCheck.redirectUrl;
            continue; // 跟随重定向
          } else {
            this.logger.warn(
              `Max meta refresh redirects reached (${maxMetaRedirects}), using current page`,
            );
          }
        }

        // 没有重定向或已达到最大次数，跳出循环
        break;
      }

      // 微信公众号文章预处理：Readability 会跳过 visibility:hidden 的内容
      // 微信 HTML 中 #js_content 默认是隐藏的，需要先 unhide
      if (currentUrl.includes("mp.weixin.qq.com")) {
        html = this.preprocessWechatHtml(html!);
      }

      // 统一使用 AdvancedExtractorService (Readability) 提取 HTML 内容
      // 这样可以保留图片、表格等富媒体内容
      let contentResult = await this.advancedExtractor.extract(
        html!,
        currentUrl,
        30000,
      );

      // SPA/CSR 检测：如果直接 HTML 提取内容质量不佳，
      // 说明页面可能是客户端渲染（如 TrendForce、React SPA），
      // 需要用 Puppeteer 执行 JS 后再提取
      const strippedText = (contentResult.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const urlRedirected =
        new URL(url).pathname !== new URL(currentUrl).pathname;
      const isLowQuality =
        !usedJinaReader && (strippedText.length < 500 || urlRedirected);
      if (isLowQuality) {
        // 使用原始 URL 重新获取，避免跟随服务器端重定向到错误页面
        const fetchUrl = urlRedirected ? url : currentUrl;
        this.logger.log(
          `Low quality extraction (stripped: ${strippedText.length} chars, redirected: ${urlRedirected}), trying Puppeteer with original URL: ${fetchUrl}`,
        );
        const puppeteerResult = await this.puppeteerFetcher.fetchPage(
          fetchUrl,
          { timeout: 30000 },
        );
        if (puppeteerResult.success && puppeteerResult.html) {
          this.logger.log(
            `Puppeteer re-fetch successful (${puppeteerResult.loadTime}ms), re-extracting...`,
          );
          html = puppeteerResult.html;
          contentResult = await this.advancedExtractor.extract(
            html,
            fetchUrl,
            30000,
          );
        } else {
          // Puppeteer 也失败，尝试 Jina Reader
          this.logger.log(`Puppeteer failed, trying Jina Reader...`);
          const jinaResult = await this.fetchViaJinaReader(fetchUrl);
          if (jinaResult.success && jinaResult.content) {
            const titleMatch = jinaResult.content.match(/^#\s+(.+)$/m);
            const jinaTitle = titleMatch
              ? titleMatch[1]
              : new URL(currentUrl).hostname;
            html = this.markdownToHtml(jinaResult.content, jinaTitle);
            usedJinaReader = true;
            contentResult = await this.advancedExtractor.extract(
              html,
              currentUrl,
              30000,
            );
          }
        }
      }

      // 同时使用 NewsExtractorService 提取元数据（作者、日期等）
      const newsMetadata = await this.newsExtractor.extractNews(
        html!,
        currentUrl,
      );

      // 验证提取结果
      const title = contentResult.title || newsMetadata.title;
      if (!title || title.length < 5) {
        this.logger.warn(`Failed to extract valid title from ${currentUrl}`);
        throw new HttpException(
          "Failed to extract valid article from this page",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      this.logger.log(
        `Successfully extracted content via ${contentResult.plan}${usedJinaReader ? " (via Jina Reader)" : ""}: "${title}" (${contentResult.length} chars, confidence: ${contentResult.confidence}%)`,
      );

      // 返回统一格式的结果：HTML 内容 + 新闻元数据
      return {
        title: title,
        content: contentResult.content, // 保留 HTML 结构（图片、表格等）
        textContent: contentResult.textContent,
        excerpt: contentResult.excerpt || newsMetadata.excerpt,
        byline: contentResult.byline || newsMetadata.author,
        author: newsMetadata.author,
        publishDate: newsMetadata.publishDate,
        modifiedDate: newsMetadata.modifiedDate,
        imageUrl: newsMetadata.imageUrl,
        siteName: contentResult.siteName || newsMetadata.siteName,
        length: contentResult.length,
        plan: contentResult.plan,
        viaJinaReader: usedJinaReader, // 标记是否通过 Jina Reader 获取
        paywalledIndicators: newsMetadata.paywalledIndicators,
        confidence: contentResult.confidence,
        source: newsMetadata.source,
        sourceUrl: url, // 保留原始 URL
        finalUrl: currentUrl, // 添加最终 URL（如果有重定向）
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        this.logger.error(
          `Failed to fetch HTML from ${url}: ${error.message}`,
          error.stack,
        );
        throw new HttpException(
          `Failed to fetch HTML: ${error.message}`,
          error.response?.status || HttpStatus.BAD_GATEWAY,
        );
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Internal error in News Reader Mode: ${errorMessage}`,
        errorStack,
      );
      throw new HttpException(
        "Internal server error while extracting news content",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 图片代理端点 - 用于获取被 Cloudflare 保护的图片
   * 通过后端代理请求，绕过浏览器直接请求时的 403 限制
   */
  @Get("image")
  async proxyImage(
    @Query("url") url: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!url) {
      throw new HttpException("URL is required", HttpStatus.BAD_REQUEST);
    }

    try {
      const urlObj = new URL(url);

      // 只允许 http/https 协议
      if (!["http:", "https:"].includes(urlObj.protocol)) {
        throw new HttpException("Invalid URL protocol", HttpStatus.BAD_REQUEST);
      }

      if (this.isBlockedAddress(urlObj.hostname)) {
        throw new HttpException(
          "Access to internal addresses is not allowed",
          HttpStatus.FORBIDDEN,
        );
      }

      this.logger.log(`Proxying image: ${urlObj.hostname}`);

      // 微信图片需要特殊的 Referer
      const isWechatImage =
        urlObj.hostname === "mmbiz.qpic.cn" ||
        urlObj.hostname === "mmbiz.qlogo.cn";
      const referer = isWechatImage
        ? "https://mp.weixin.qq.com/"
        : `${urlObj.protocol}//${urlObj.hostname}/`;

      // 尝试直接获取图片
      try {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 15000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: referer,
          },
        });

        const contentType = String(
          response.headers["content-type"] ?? "image/jpeg",
        );
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400"); // 缓存 1 天
        // CORS：允许前端跨域 fetch() 读取响应体（HtmlCaptureService 把图片
        // inline 成 data: URL 走 PDF 导出的关键链路；不加这两个头浏览器 fetch
        // 会被 CORS 拦截 → 导出 PDF 出现破图）
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.send(Buffer.from(response.data));
        return;
      } catch (fetchError) {
        // 如果直接获取失败（403），尝试使用 FlareSolverr
        if (
          axios.isAxiosError(fetchError) &&
          fetchError.response?.status === 403
        ) {
          this.logger.log(
            `Direct image fetch returned 403, trying FlareSolverr for ${url}`,
          );

          if (this.flareSolverr.getIsAvailable()) {
            const flareResult = await this.flareSolverr.fetchPage(url, {
              maxTimeout: 30000,
            });

            if (flareResult.success && flareResult.html) {
              // FlareSolverr 返回的是 HTML，但对于图片请求，我们需要从响应中提取二进制数据
              // 由于 FlareSolverr 主要用于 HTML 页面，对于图片我们使用其获取的 cookies 重新请求
              if (flareResult.cookies && flareResult.cookies.length > 0) {
                const cookieHeader = flareResult.cookies
                  .map((c) => `${c.name}=${c.value}`)
                  .join("; ");

                const retryResponse = await axios.get(url, {
                  responseType: "arraybuffer",
                  timeout: 15000,
                  headers: {
                    "User-Agent": flareResult.userAgent || "Mozilla/5.0",
                    Cookie: cookieHeader,
                    Accept: "image/*,*/*;q=0.8",
                    Referer: `${urlObj.protocol}//${urlObj.hostname}/`,
                  },
                });

                const contentType = String(
                  retryResponse.headers["content-type"] ?? "image/jpeg",
                );
                res.setHeader("Content-Type", contentType);
                res.setHeader("Cache-Control", "public, max-age=86400");
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
                res.send(Buffer.from(retryResponse.data));
                return;
              }
            }
          }
        }

        // ★ 2026-05-25 机制级修：外部图拉取失败是常态(403/404/超时)，不应抛 5xx
        //   —— 5xx 会被 AllExceptionsFilter 升级为 Critical/[MONITORING] 告警刷屏。
        //   改为返回透明占位图(200)，<img> 自然空白，无破图、无错误告警。
        this.logger.warn(`Failed to proxy image (placeholder served): ${url}`);
        this.sendTransparentPixel(res);
        return;
      }
    } catch (error) {
      // 显式拒绝(如 SSRF 阻断)保留原 HttpException 语义。
      if (error instanceof HttpException) {
        throw error;
      }
      // 其余(网络/超时等外部失败)同样降级为占位图，避免误报严重错误。
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(
        `Image proxy failed (placeholder served): ${errorMessage}`,
      );
      this.sendTransparentPixel(res);
    }
  }

  /**
   * 返回 1×1 透明 PNG 占位图（200）。外部图代理失败时用，避免 5xx 误报严重错误，
   * 前端 <img> 显示为空白而非破图。
   */
  private sendTransparentPixel(res: Response): void {
    if (res.headersSent) return;
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.status(HttpStatus.OK).send(pixel);
  }
}
