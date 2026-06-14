import { Injectable, Logger } from "@nestjs/common";
import { ToolRegistry, type ToolContext } from "@/modules/ai-harness/facade";
import { withTimeoutFallback } from "@/common/utils/timeout.utils";

/**
 * 提取的图表信息
 */
export interface ExtractedFigure {
  /** 图片 URL */
  imageUrl: string;
  /** 图片标题/说明 */
  caption: string;
  /** 图表类型 */
  type: "chart" | "table" | "diagram" | "photo";
  /** alt 文本 */
  alt?: string;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
}

// ==================== Constants ====================

/** 最小图片文件大小（字节）：低于此阈值的栅格图片视为缩略图/占位符
 * ★ v6.0: 从 15KB 降到 5KB — 很多有意义的图表/线图在 5-15KB 范围 */
const MIN_IMAGE_BYTES = 5_000;

/** URL 路径中的最小图片宽度（低于此视为缩略图 URL） */
const MIN_URL_DIMENSION_WIDTH = 400;

/** 图片下载超时（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 10_000;

/** 最大允许的图片文件大小（字节）：超过此大小的图片视为超大文件 */
const MAX_IMAGE_BYTES = 5_000_000;

/**
 * Figure Extractor Service
 *
 * 从 HTML 内容中提取图片和图表。本服务负责 Pipeline 的 Stage 1 和 Stage 2。
 *
 * ★ Figure Pipeline 全链路（质量第一，合理数量）：
 *
 *   Stage 1: extractFigures(HTML) — 本服务
 *     解析 <img>/<figure>/<picture>，isLikelyChart 过滤装饰图，classifyFigureType 分类
 *
 *   Stage 2: validateAndUpgradeFigures(GET+Range) — 本服务
 *     只允许 HTTP/HTTPS URL（data:/file:/相对路径/PDF → 全部丢弃）
 *     GET+Range 请求前 8KB → magic bytes 验证图片格式
 *     验证失败/网络错误 → 丢弃（绝不保留无法加载的图片）
 *
 *   Stage 3: filterRelevantFigures(Vision LLM) — FigureRelevanceService
 *     多模态 LLM 审查图片是否与主题相关、有信息价值
 *     排除纯装饰图、广告横幅、与章节无关的图片
 *     API 故障时保留已验证图片（不因 LLM 故障丢图）
 *
 *   Stage 4: Leader 分配 — evidence-summary.utils.ts
 *     FIGURE_ALLOCATION_GUIDANCE: 质量第一，合理数量
 *     每章节 1-3 张高度相关图表，无相关图表宁可不分配
 *
 *   Stage 5: SectionWriter 关键词过滤 — section-writer.service.ts
 *     threshold=1，仅防 LLM 幻觉分配，不做过度过滤
 *
 *   Stage 6: ReportAssembler → ReportSynthesis — 收集/组装
 *     isValidFigureUrl（URL 格式校验） + isGarbageFigureUrl（QR码/tracking pixel 等）
 *
 * 调用方：data-enrichment.service.ts（Stage 1→2→3 串联调用）
 */
@Injectable()
export class FigureExtractorService {
  private readonly logger = new Logger(FigureExtractorService.name);

  constructor(private readonly toolRegistry: ToolRegistry) {}

  /**
   * 创建工具执行上下文
   */
  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }

  /**
   * 从 URL 获取并提取图表
   * 使用 web-scraper 工具获取 HTML 内容，然后提取图表
   *
   * @param url 目标 URL
   * @param timeout 超时时间（毫秒）
   * @returns 提取的图表列表
   */
  async extractFiguresFromUrl(
    url: string,
    timeout: number = 10000,
  ): Promise<ExtractedFigure[]> {
    try {
      // 通过 ToolRegistry 获取 web-scraper 工具
      const webScraperTool = this.toolRegistry.tryGet("web-scraper");
      if (!webScraperTool) {
        this.logger.warn(
          "[extractFiguresFromUrl] web-scraper tool not available",
        );
        return [];
      }

      // 超时控制
      const toolResult = await withTimeoutFallback(
        webScraperTool.execute(
          {
            url,
            maxLength: 50000, // 获取更多内容以便提取图片
            returnHtml: true, // 请求返回 HTML（如果工具支持）
          },
          this.createToolContext("web-scraper"),
        ),
        timeout,
        {
          success: false,
          error: { code: "TIMEOUT", message: "Fetch timeout" },
        } as Awaited<ReturnType<typeof webScraperTool.execute>>,
      );

      if (!toolResult.success || !toolResult.data) {
        this.logger.debug(
          `[extractFiguresFromUrl] Failed to fetch ${url}: ${toolResult.error?.message}`,
        );
        return [];
      }

      const scraperData = toolResult.data as {
        content: string;
        html?: string;
        success: boolean;
      };

      if (!scraperData.success) {
        return [];
      }

      // 使用 HTML 内容（如果可用），否则使用 content
      const htmlContent = scraperData.html || scraperData.content || "";

      // 提取图表
      const figures = this.extractFigures(url, htmlContent);
      this.logger.debug(
        `[extractFiguresFromUrl] Extracted ${figures.length} figures from ${url}`,
      );

      // ★ v4.5: 异步校验图片可访问性 + 质量
      const validated = await this.validateAndUpgradeFigures(figures);
      return validated;
    } catch (error) {
      this.logger.warn(
        `[extractFiguresFromUrl] Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 从 HTML 内容中提取图表
   *
   * @param baseUrl 页面基础 URL，用于解析相对路径
   * @param htmlContent HTML 内容
   * @returns 提取的图表列表
   */
  extractFigures(baseUrl: string, htmlContent: string): ExtractedFigure[] {
    if (!htmlContent) {
      return [];
    }

    const figures: ExtractedFigure[] = [];

    // 1. 提取 <figure> 标签（更结构化，优先级高）
    const figureElements = this.extractFigureElements(baseUrl, htmlContent);
    figures.push(...figureElements);

    // 2. 提取独立的 <img> 标签
    const imgElements = this.extractImgElements(baseUrl, htmlContent);

    // 过滤掉已经在 figure 中提取过的图片
    const figureUrls = new Set(figures.map((f) => f.imageUrl));
    const newImgs = imgElements.filter((img) => !figureUrls.has(img.imageUrl));
    figures.push(...newImgs);

    // 3. 过滤非内容图片（logo、icon、tracking pixel 等）
    const filteredFigures = figures.filter((fig) =>
      this.isLikelyChart(
        fig.imageUrl,
        fig.caption,
        fig.alt,
        fig.width,
        fig.height,
      ),
    );

    // 4. 限制每个 URL 最多提取的图片数量
    // ★ v6.0: 从 5 提升到 10 — 高质量文章常有 10+ 配图
    const MAX_FIGURES_PER_URL = 10;
    const limitedFigures = filteredFigures.slice(0, MAX_FIGURES_PER_URL);

    this.logger.debug(
      `Extracted ${limitedFigures.length} figures from ${figures.length} images (filtered: ${filteredFigures.length}, max: ${MAX_FIGURES_PER_URL})`,
    );

    return limitedFigures;
  }

  /**
   * 提取 <figure> 元素
   *
   * ★ v6.0: 放宽提取条件 — 无 figcaption 时用 alt 兜底，
   *   都没有时用空 caption（交给 isLikelyChart 黑名单过滤）。
   *   旧逻辑要求必须有 figcaption 且 ≥8 字符，杀掉了大量有价值图片。
   */
  private extractFigureElements(
    baseUrl: string,
    htmlContent: string,
  ): ExtractedFigure[] {
    const figures: ExtractedFigure[] = [];

    const figureBlockRegex = /<figure[^>]*>[\s\S]*?<\/figure>/gi;
    const imgSrcRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/i;
    const figcaptionRegex = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i;

    let match;
    while ((match = figureBlockRegex.exec(htmlContent)) !== null) {
      const block = match[0];
      const imgMatch = imgSrcRegex.exec(block);
      if (!imgMatch) continue;
      const imgSrc = imgMatch[1];

      // 优先用 figcaption，没有则用 alt 兜底
      const capMatch = figcaptionRegex.exec(block);
      const alt = this.extractAltFromImg(block);
      let caption = "";
      if (capMatch) {
        const figcaption = this.cleanHtmlText(capMatch[1]);
        caption = this.isMeaningfulCaption(figcaption) ? figcaption : alt;
      } else {
        caption = alt;
      }

      const resolvedUrl = this.resolveUrl(baseUrl, imgSrc);
      if (resolvedUrl) {
        figures.push({
          imageUrl: resolvedUrl,
          caption: caption || "",
          type: this.classifyFigureType(caption || alt),
          alt,
        });
      }
    }

    return figures;
  }

  /**
   * 提取独立的 <img> 元素
   *
   * ★ v6.0: 放宽提取条件 — 有 alt 文本的直接接受；无 alt 但有尺寸
   *   信息且宽度 ≥ 200px 的也接受（大图通常是内容图片）。
   *   旧逻辑要求 alt ≥8 字符，杀掉了 80%+ 的图片。
   */
  private extractImgElements(
    baseUrl: string,
    htmlContent: string,
  ): ExtractedFigure[] {
    const figures: ExtractedFigure[] = [];

    const imgRegex =
      /<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi;

    let match;
    while ((match = imgRegex.exec(htmlContent)) !== null) {
      const alt = this.extractAltFromFullMatch(match[0]);
      const width = this.extractDimension(match[0], "width");
      const height = this.extractDimension(match[0], "height");

      // 接受条件：有非空 alt，或宽度 ≥ 200px（大图通常是内容图片）
      const hasAlt = alt && alt.trim().length > 0;
      const isLargeImage = width !== undefined && width >= 200;
      if (!hasAlt && !isLargeImage) continue;

      const imgSrc = this.extractBestSrc(match[0]) || match[1];
      const resolvedUrl = this.resolveUrl(baseUrl, imgSrc);
      if (resolvedUrl) {
        figures.push({
          imageUrl: resolvedUrl,
          caption: alt,
          type: this.classifyFigureType(alt),
          alt,
          width,
          height,
        });
      }
    }

    return figures;
  }

  /**
   * 从 img 标签中提取最佳 src（优先 lazy-load 属性，其次 srcset 高清版）
   */
  private extractBestSrc(imgTag: string): string | null {
    // 1. Prefer lazy-load attributes which contain the real high-res URL
    for (const attr of ["data-src", "data-original", "data-lazy-src"]) {
      const match = imgTag.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
      if (match && !match[1].startsWith("data:")) {
        return match[1];
      }
    }

    // 2. ★ v4.5: 尝试从 srcset 提取最高分辨率版本
    const srcsetUrl = this.extractHighestResSrcset(imgTag);
    if (srcsetUrl) return srcsetUrl;

    return null;
  }

  /**
   * ★ v4.5: 从 srcset 属性中解析最高分辨率的图片 URL
   *
   * srcset 格式: "url1 800w, url2 400w" 或 "url1 2x, url2 1x"
   * 选择宽度 >= 600w 的最大候选项
   */
  private extractHighestResSrcset(imgTag: string): string | null {
    const srcsetMatch = imgTag.match(/srcset=["']([^"']+)["']/i);
    if (!srcsetMatch) return null;

    const srcset = srcsetMatch[1];
    const candidates = srcset
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let bestUrl = "";
    let bestSize = 0;

    for (const candidate of candidates) {
      const parts = candidate.trim().split(/\s+/);
      if (parts.length < 1) continue;
      const url = parts[0];
      if (!url || url.startsWith("data:")) continue;

      const descriptor = parts[1] || "1x";
      let size = 0;
      if (descriptor.endsWith("w")) {
        size = parseInt(descriptor, 10);
      } else if (descriptor.endsWith("x")) {
        size = parseFloat(descriptor) * 1000; // normalize to comparable scale
      }

      if (size > bestSize) {
        bestSize = size;
        bestUrl = url;
      }
    }

    // 仅当最佳候选宽度 >= 600px 时才使用（避免选到小缩略图）
    return bestSize >= 600 ? bestUrl : null;
  }

  /**
   * 从 img 标签中提取 alt 属性
   */
  private extractAltFromImg(imgTag: string): string {
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);
    return altMatch ? altMatch[1] : "";
  }

  /**
   * 从完整匹配中提取 alt（处理 alt 在 src 前面的情况）
   */
  private extractAltFromFullMatch(fullMatch: string): string {
    const altMatch = fullMatch.match(/alt=["']([^"']*)["']/i);
    return altMatch ? altMatch[1] : "";
  }

  /**
   * 提取图片尺寸
   */
  private extractDimension(
    imgTag: string,
    dimension: "width" | "height",
  ): number | undefined {
    const regex = new RegExp(`${dimension}=["']?(\\d+)["']?`, "i");
    const match = imgTag.match(regex);
    return match ? parseInt(match[1], 10) : undefined;
  }

  /**
   * 解析相对 URL 为绝对 URL
   */
  private resolveUrl(baseUrl: string, imgSrc: string): string | null {
    try {
      // 跳过 data URLs
      if (imgSrc.startsWith("data:")) {
        return null;
      }

      // ★ v4.4: 解码 HTML 实体（&amp; → &, &#39; → ' 等）
      // HTML 中提取的 URL 常包含 &amp; 导致参数腐蚀
      imgSrc = imgSrc
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

      let resolved: string;

      // 已经是绝对 URL
      if (imgSrc.startsWith("http://") || imgSrc.startsWith("https://")) {
        resolved = imgSrc;
      } else if (imgSrc.startsWith("//")) {
        // 协议相对 URL
        resolved = "https:" + imgSrc;
      } else {
        // 相对 URL，需要基于 baseUrl 解析
        const base = new URL(baseUrl);
        resolved = new URL(imgSrc, base).href;
      }

      // Validate: URL must parse and have a valid image-like path
      const parsed = new URL(resolved);
      if (!parsed.hostname || parsed.hostname.length < 3) {
        return null;
      }

      // Reject corrupted CDN URLs with encoding artifacts ($s!, %24s!, etc.)
      if (/\$s!|%24s!/i.test(resolved)) {
        this.logger.debug(
          `Rejecting corrupted CDN URL (encoding artifact): ${resolved.substring(0, 120)}`,
        );
        return null;
      }

      // Reject URLs that are too long (likely corrupted srcset or concatenated params)
      if (resolved.length > 2048) {
        this.logger.debug(
          `Rejecting excessively long URL (${resolved.length} chars): ${resolved.substring(0, 120)}...`,
        );
        return null;
      }

      return resolved;
    } catch (error) {
      this.logger.debug(`Failed to resolve URL: ${imgSrc} from ${baseUrl}`);
      return null;
    }
  }

  /**
   * 判断图片是否可能是有意义的内容图片。
   *
   * ★ v6.0 根因重构：从白名单改为黑名单模式。
   *
   * 旧逻辑（白名单）：必须匹配 chart/data/graph 等关键词才放行
   *   → 导致新闻照片、产品图、事件场景图全部被杀，报告图片极度稀少
   *
   * 新逻辑（黑名单）：只排除明确的非内容图片（logo/icon/tracking pixel/装饰图），
   *   其余全部放行，交给后续 validateAndUpgradeFigures 做可访问性校验。
   */
  private isLikelyChart(
    url: string,
    caption: string,
    alt?: string,
    width?: number,
    height?: number,
  ): boolean {
    // ── 硬性排除：尺寸过小 ──
    if (width && height && (width < 50 || height < 50)) {
      return false;
    }
    if (/[?&](w|width|h|height)=1\b/.test(url)) {
      return false;
    }

    const combinedText =
      `${url || ""} ${caption || ""} ${alt || ""}`.toLowerCase();

    // ── 黑名单：明确的非内容图片 ──
    const excludePatterns = [
      // UI 元素
      /logo/i,
      /icon/i,
      /avatar/i,
      /favicon/i,
      /button/i,
      /arrow/i,
      /spinner/i,
      /loading/i,
      /badge/i,
      /emoji/i,
      // 社交/广告
      /social/i,
      /share/i,
      /facebook/i,
      /twitter/i,
      /linkedin/i,
      /instagram/i,
      /youtube/i,
      /advertisement/i,
      /\bad\b/i,
      /sponsor/i,
      /affiliate/i,
      /promo/i,
      /cta[-_]/i,
      // 追踪/占位
      /pixel/i,
      /tracking/i,
      /spacer/i,
      /placeholder/i,
      // 装饰性
      /decorative/i,
      /ornament/i,
      /pattern[-_]?bg/i,
      /background[-_]?image/i,
      /bg[-_]?image/i,
      // 人物头像/肖像（非内容）
      /gravatar\.com/i,
      /author[-_]?photo/i,
      /headshot/i,
      /portrait/i,
      /profile[-_]?(?:pic|photo|image|img)/i,
      /staff[-_]?photo/i,
      /team[-_]?photo/i,
      /contributor[-_]?(?:photo|image|img|avatar|pic)/i,
      /mugshot/i,
      // CDN 头像路径（sanity.io, cloudinary 等）
      /cdn\.sanity\.io\/.*(?:author|person|avatar|headshot|profile)/i,
      /res\.cloudinary\.com\/.*(?:author|person|avatar|headshot|profile)/i,
      // 页面元素
      /newsletter/i,
      /subscribe/i,
      /signup/i,
      // WordPress 缩略图
      /wp-content\/uploads.*-\d+x\d+\./i,
      // 博客封面/文章横幅（非研究图表）
      /blog[-_]?cover/i,
      /cover[-_]?image/i,
      /hero[-_]?image/i,
      /banner[-_]?image/i,
      /header[-_]?image/i,
      /featured[-_]?image/i,
      /main(?:[-_]|%20)?visual/i,
      /blogs[-_]?ninja/i,
      // 站点装饰/资产路径
      /\/customization\//i,
      /\/default-source\//i,
      /sfimages/i,
      // ★ v7: 营销/活动/直播海报（非研究内容）
      /直播/i,
      /报名/i,
      /活动预告/i,
      /webinar/i,
      /live[-_]?stream/i,
      /register[-_]?now/i,
    ];

    if (excludePatterns.some((pattern) => pattern.test(combinedText))) {
      return false;
    }

    // ★ v7: 检测文章标题卡/封面图 — 博客平台的文章头图通常是装饰性大字标题
    // 特征：caption 很长（>50字）且包含平台名称或 emoji，说明 caption 是文章标题而非图表说明
    const captionText = `${caption || ""} ${alt || ""}`;
    const blogPlatformNames =
      /掘金|知乎|CSDN|简书|segmentfault|InfoQ|博客园|开源中国|腾讯云社区|阿里云开发者|Heywhale|和鲸|稀土/i;
    if (captionText.length > 50 && blogPlatformNames.test(captionText)) {
      return false;
    }
    // 含 emoji 的长文本 caption 通常是博客文章标题，不是图表描述
    if (
      captionText.length > 40 &&
      /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(
        captionText,
      )
    ) {
      return false;
    }

    // ── URL 内嵌尺寸检测：路径中含 NxN 且尺寸极小（头像/图标）──
    // e.g. "/images/author-100x100.jpg" or "?w=48&h=48"
    const urlDimMatch = url.match(/[-_/](\d{2,3})x(\d{2,3})[-_./]/);
    if (urlDimMatch) {
      const urlW = parseInt(urlDimMatch[1], 10);
      const urlH = parseInt(urlDimMatch[2], 10);
      if (urlW <= 200 && urlH <= 200) {
        return false;
      }
    }

    // ── 尺寸异常排除（但不要求尺寸必须存在）──
    if (width && (width < 80 || width > 4000)) {
      return false;
    }

    // ── 黑名单模式：通过排除的图片全部放行 ──
    return true;
  }

  /**
   * 判断 caption/alt 是否有实质性内容
   * 排除空、纯数字、通用标签如 "image"、"figure 1"、"photo" 等
   */
  private isMeaningfulCaption(text: string | undefined): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length < 8) return false; // 至少 8 个字符才有描述价值

    // 排除通用无意义 caption
    const genericPatterns = [
      /^figure\s*\d*$/i,
      /^fig\.?\s*\d*$/i,
      /^image\s*\d*$/i,
      /^img\s*\d*$/i,
      /^photo\s*\d*$/i,
      /^picture\s*\d*$/i,
      /^chart\s*\d*$/i,
      /^graph\s*\d*$/i,
      /^table\s*\d*$/i,
      /^diagram\s*\d*$/i,
      /^screenshot\s*\d*$/i,
      /^illustration\s*\d*$/i,
      /^图\s*\d*$/i,
      /^表\s*\d*$/i,
      /^图片\s*\d*$/i,
      /^\d+$/,
    ];
    if (genericPatterns.some((p) => p.test(trimmed))) return false;

    return true;
  }

  /**
   * 分类图表类型
   */
  private classifyFigureType(
    text: string,
  ): "chart" | "table" | "diagram" | "photo" {
    if (!text) return "photo";
    const lowerText = text.toLowerCase();

    // ★ v7: 博客文章标题/营销文案不应被提升为信息图表类型
    // 特征：很长的文本（>40字）、含平台名称、含 emoji、含营销词汇
    // 即使包含"架构"等关键词，也是文章标题而非图表描述
    const isBlogTitle =
      text.length > 40 &&
      (/掘金|知乎|CSDN|简书|InfoQ|博客园|Heywhale|和鲸|腾讯云|阿里云/i.test(
        lowerText,
      ) ||
        /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(
          text,
        ) ||
        /深度解析|一文读懂|万字|保姆级|手把手|从入门到|实战指南|完全指南|最全|合集/i.test(
          lowerText,
        ));
    if (isBlogTitle) {
      return "photo";
    }

    // 表格
    if (/table|表格|数据表/i.test(lowerText)) {
      return "table";
    }

    // 图表
    if (
      /chart|graph|plot|趋势|增长|对比|统计|forecast|projection/i.test(
        lowerText,
      )
    ) {
      return "chart";
    }

    // 流程图/架构图
    if (/diagram|flow|process|架构|流程|结构/i.test(lowerText)) {
      return "diagram";
    }

    // 照片/图片
    if (
      /photo|image|picture|screenshot|照片|图片|截图|实拍|摄影/i.test(lowerText)
    ) {
      return "photo";
    }

    // ★ 带 Figure/Fig/图 编号前缀的学术图片，倾向归类为 diagram（架构图、示意图等）
    // 例如 "Figure 2" "Fig. 3a" "图4" 等 — 学术论文图片默认非照片
    if (/\b(figure|fig\.?|图)\s*\d/i.test(lowerText)) {
      return "diagram";
    }

    // 无法识别的默认为照片（研究报告中无关键词的图片多为实物照片）
    return "photo";
  }

  /**
   * 清理 HTML 文本，移除标签
   */
  private cleanHtmlText(html: string): string {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ==================== v4.5: Image Validation ====================

  /**
   * ★ v4.5: 异步校验并升级提取的图片列表
   *
   * 对每个候选图片执行：
   * 1. 尝试 CDN URL 升级（识别缩略图参数，替换为高清版本）
   * 2. HEAD 请求验证可访问性（非 200 直接丢弃）
   * 3. Content-Length 校验（栅格图片 < 15KB 丢弃）
   * 4. URL 路径中的尺寸提示校验（< 400px 宽丢弃）
   *
   * 原则：宁缺毋滥，不可访问或质量不达标的一律丢弃
   */
  async validateAndUpgradeFigures(
    figures: ExtractedFigure[],
  ): Promise<ExtractedFigure[]> {
    if (figures.length === 0) return [];

    const results = await Promise.allSettled(
      figures.map((fig) => this.validateSingleFigure(fig)),
    );

    const validated = results
      .filter(
        (r): r is PromiseFulfilledResult<ExtractedFigure | null> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value)
      .filter((fig): fig is ExtractedFigure => fig !== null);

    if (figures.length !== validated.length) {
      this.logger.log(
        `[validateFigures] ${figures.length} candidates → ${validated.length} validated ` +
          `(${figures.length - validated.length} rejected)`,
      );
    }

    return validated;
  }

  /**
   * 校验单个图片：尝试升级 URL → GET+Range 校验可访问性 → 保留原始 HTTP URL
   * 返回 null 表示该图片应被丢弃
   *
   * ★ v6: 不再将图片转为 base64 data URL（根因修复）
   * - base64 嵌入导致 LLM prompt token 爆炸（148K-916K tokens）
   * - base64 存入数据库后前端无法正常展示
   * - 正确做法：保留原始 HTTP URL 给前端，需离线时走 R2 存储
   */
  private async validateSingleFigure(
    figure: ExtractedFigure,
  ): Promise<ExtractedFigure | null> {
    const originalUrl = figure.imageUrl;

    // ★ 防护网 1: 拒绝 data URL — 永远不应出现在 figureReferences 中
    if (originalUrl.startsWith("data:")) {
      this.logger.debug(
        `[validateFigure] REJECTED data URL (${(originalUrl.length / 1024).toFixed(0)}KB): should not appear in figureReferences`,
      );
      return null;
    }

    // ★ 防护网 2: 拒绝非 HTTP URL
    if (
      !originalUrl.startsWith("http://") &&
      !originalUrl.startsWith("https://")
    ) {
      this.logger.debug(
        `[validateFigure] REJECTED non-HTTP URL: ${originalUrl.substring(0, 120)}`,
      );
      return null;
    }

    // ★ 防护网 3: 拒绝 PDF 链接
    if (/\.pdf(\?|$)/i.test(originalUrl)) {
      this.logger.debug(
        `[validateFigure] REJECTED PDF URL: ${originalUrl.substring(0, 120)}`,
      );
      return null;
    }

    // ★ 防护网 4: 拒绝 SVG — Vision API 不支持矢量格式（仅支持 png/jpeg/gif/webp）
    if (/\.svg(\?|$)/i.test(originalUrl)) {
      this.logger.debug(
        `[validateFigure] REJECTED SVG URL: ${originalUrl.substring(0, 120)}`,
      );
      return null;
    }

    // ★ 防护网 5: 拒绝带认证参数的签名 URL — Vision API 无法下载这些 URL，会触发重试消耗 rate limit
    // Substack CDN 的 token 参数是公开可访问的，不过滤
    if (
      !/substackcdn\.com/i.test(originalUrl) &&
      /[?&](oh=|oe=|_nc_|token=|signature=|auth=)/i.test(originalUrl)
    ) {
      this.logger.debug(
        `[validateFigure] REJECTED signed URL: ${originalUrl.substring(0, 80)}...`,
      );
      return null;
    }

    // 1. 尝试 CDN URL 升级（获取更高分辨率版本）
    const upgradedUrl = this.tryUpgradeImageUrl(originalUrl);
    const candidateUrl = upgradedUrl ?? originalUrl;

    if (upgradedUrl) {
      this.logger.debug(
        `[validateFigure] Upgraded URL: ${originalUrl.substring(0, 80)} → ${upgradedUrl.substring(0, 80)}`,
      );
    }

    // 2. GET+Range 校验图片可访问性（请求前 8KB）
    const isValid = await this.validateImageUrl(candidateUrl);
    if (isValid) {
      return { ...figure, imageUrl: candidateUrl };
    }

    // 升级 URL 校验失败时回退原始 URL
    if (upgradedUrl) {
      const fallbackValid = await this.validateImageUrl(originalUrl);
      if (fallbackValid) {
        return figure;
      }
    }

    // ★ v7: 验证失败 → 丢弃（质量第一，不保留无法加载的图片）
    this.logger.debug(
      `[validateFigure] REJECTED (validation failed): ${originalUrl.substring(0, 120)}`,
    );
    return null;
  }

  /**
   * ★ v7: GET+Range 轻量校验图片 URL 可访问性
   *
   * HEAD 请求在很多 CDN 上不可靠（返回错误 Content-Type、不返回 Content-Length）。
   * 改用 GET + Range 头请求前 8KB，通过实际响应头和 magic bytes 验证。
   * 不存储下载内容（避免 base64 问题），只用于校验。
   */
  private async validateImageUrl(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; GenesisBot/1.0; +https://gens.team)",
            Accept: "image/*",
            Range: "bytes=0-8191",
          },
        });
        clearTimeout(timer);

        // 200 或 206 (Partial Content) 都接受
        if (!response.ok && response.status !== 206) {
          // 405 Method Not Allowed → 极少见于 GET，但仍然乐观放行
          if (response.status === 405) {
            return true;
          }
          this.logger.debug(
            `[validateImageUrl] HTTP ${response.status}: ${url.substring(0, 100)}`,
          );
          return false;
        }

        // 检查 Content-Type
        const contentType = response.headers.get("content-type") || "";

        // Content-Length 检查（从 response header 或 content-range 获取真实大小）
        let fullSize = 0;
        const contentRange = response.headers.get("content-range");
        if (contentRange) {
          // Content-Range: bytes 0-8191/123456
          const rangeMatch = contentRange.match(/\/(\d+)/);
          if (rangeMatch) fullSize = parseInt(rangeMatch[1], 10);
        }
        if (fullSize === 0) {
          fullSize = parseInt(
            response.headers.get("content-length") || "0",
            10,
          );
        }

        if (fullSize > 0 && fullSize > MAX_IMAGE_BYTES) {
          this.logger.debug(
            `[validateImageUrl] Too large (${(fullSize / 1024).toFixed(0)}KB): ${url.substring(0, 100)}`,
          );
          // 消费 response body 防止连接泄漏
          try {
            await response.arrayBuffer();
          } catch {
            /* ignore */
          }
          return false;
        }

        // 读取前 8KB 用于 magic bytes 检查
        let bytes: Buffer | null = null;
        try {
          const ab = await response.arrayBuffer();
          bytes = Buffer.from(ab);
        } catch {
          // 读取失败 → 无法验证 → 拒绝
          return false;
        }

        // ★ SVG 拒绝：Vision API 不支持矢量格式，Content-Type 可能是 image/svg+xml
        if (contentType.includes("svg")) {
          this.logger.debug(
            `[validateImageUrl] SVG Content-Type rejected (${contentType}): ${url.substring(0, 100)}`,
          );
          return false;
        }

        // 如果 Content-Type 明确是 image/* → 直接通过（再检查大小）
        if (contentType.startsWith("image/")) {
          // 仅在知道完整大小时检查下限
          if (fullSize > 0 && fullSize < MIN_IMAGE_BYTES) {
            this.logger.debug(
              `[validateImageUrl] Too small (${fullSize} bytes): ${url.substring(0, 100)}`,
            );
            return false;
          }
          return true;
        }

        // Content-Type 不是 image/* 或为空 → 用 magic bytes 兜底
        if (bytes && bytes.length >= 4) {
          if (this.isImageByMagicBytes(bytes)) {
            return true;
          }
        }

        // Content-Type 明确是非图片类型 → 拒绝
        if (contentType && !contentType.startsWith("image/")) {
          this.logger.debug(
            `[validateImageUrl] Not an image (${contentType}), no image magic bytes: ${url.substring(0, 100)}`,
          );
          return false;
        }

        // Content-Type 为空 + magic bytes 检查也失败 → 拒绝
        this.logger.debug(
          `[validateImageUrl] No Content-Type, no image magic bytes: ${url.substring(0, 100)}`,
        );
        return false;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 网络错误/超时 → 拒绝（质量第一，无法验证的图片不保留）
      this.logger.debug(
        `[validateImageUrl] Network error/timeout (rejected): ${url.substring(0, 100)}`,
      );
      return false;
    }
  }

  /**
   * 通过 magic bytes 判断是否为图片文件
   */
  private isImageByMagicBytes(bytes: Buffer): boolean {
    if (bytes.length < 4) return false;

    // PNG: 89 50 4E 47
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return true;
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return true;
    }
    // GIF: 47 49 46 38
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    ) {
      return true;
    }
    // WebP: 52 49 46 46 ... 57 45 42 50
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes.length >= 12 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return true;
    }
    // BMP: 42 4D
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return true;
    }
    // ★ SVG 不再视为有效图片格式 — Vision API 仅支持 png/jpeg/gif/webp
    // SVG 作为矢量格式无法被 Vision LLM 处理，需在此拦截

    return false;
  }

  /**
   * ★ v4.5: 尝试升级 CDN URL 到更高分辨率版本
   *
   * 识别常见 CDN 的缩略图参数并替换：
   * - Brightspot: /resize/WxH!/ → 去掉 resize
   * - 通用: ?w=N, &width=N → 提升到 1200
   * - 通用: /quality/N/ → 提升到 90
   */
  private tryUpgradeImageUrl(url: string): string | null {
    let upgraded = url;
    let changed = false;

    // Brightspot CDN: /resize/WxH!/ 或 /resize/WxH/
    if (/\/resize\/\d+x\d+!?\//.test(upgraded)) {
      upgraded = upgraded.replace(
        /\/resize\/\d+x\d+!?\//,
        "/resize/1200x800!/",
      );
      changed = true;
    }

    // 通用 CDN 宽度参数: ?w=N, &w=N, ?width=N, &width=N（仅当值较小时升级）
    const widthMatch = upgraded.match(/([?&])(?:w|width)=(\d+)/);
    if (widthMatch && parseInt(widthMatch[2], 10) < MIN_URL_DIMENSION_WIDTH) {
      upgraded = upgraded.replace(
        /([?&])(?:w|width)=\d+/,
        `${widthMatch[1]}w=1200`,
      );
      changed = true;
    }

    // 通用 CDN 高度参数: 跟随宽度一起调整
    const heightMatch = upgraded.match(/([?&])(?:h|height)=(\d+)/);
    if (changed && heightMatch && parseInt(heightMatch[2], 10) < 400) {
      upgraded = upgraded.replace(
        /([?&])(?:h|height)=\d+/,
        `${heightMatch[1]}h=800`,
      );
    }

    // 低质量参数: /quality/N/ → /quality/90/
    const qualityMatch = upgraded.match(/\/quality\/(\d+)\//);
    if (qualityMatch && parseInt(qualityMatch[1], 10) < 80) {
      upgraded = upgraded.replace(/\/quality\/\d+\//, "/quality/90/");
      changed = true;
    }

    return changed ? upgraded : null;
  }
}
