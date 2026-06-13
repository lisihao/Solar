/**
 * AI URL Classifier Service
 * 使用 AI 自动分类 URL 到对应的资源类型
 */

import { Injectable, Logger } from "@nestjs/common";
import { ResourceType, AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";

export interface UrlClassificationResult {
  /**
   * 分类结果
   */
  resourceType: ResourceType;

  /**
   * 置信度 (0-1)
   */
  confidence: number;

  /**
   * 分类原因/解释
   */
  reason: string;

  /**
   * 替代分类建议
   */
  alternatives?: Array<{
    resourceType: ResourceType;
    confidence: number;
    reason: string;
  }>;

  /**
   * 从 URL/页面中提取的信息
   */
  extractedInfo?: {
    domain: string;
    title?: string;
    description?: string;
    contentType?: string;
  };
}

@Injectable()
export class AiUrlClassifierService {
  private readonly logger = new Logger(AiUrlClassifierService.name);

  // 资源类型描述映射，用于 AI 分类
  private readonly resourceTypeDescriptions: Record<string, string> = {
    PAPER:
      "学术论文、研究论文 - 来自 arXiv, IEEE, ACM, Springer, Nature, Cell, Google Scholar, ResearchGate 等学术平台",
    BLOG: "技术博客、公司研究博客 - 来自 Google, Microsoft, NVIDIA, OpenAI, DeepMind, Anthropic, Medium, Hugging Face 等技术公司或博客平台",
    NEWS: "新闻文章 - 来自 TechCrunch, The Verge, Wired, Bloomberg, Reuters, BBC 等新闻媒体",
    YOUTUBE_VIDEO: "YouTube 视频 - youtube.com 或 youtu.be 链接",
    REPORT:
      "行业报告、分析报告 - 来自 Gartner, Forrester, IDC, McKinsey, BCG, Deloitte, Goldman Sachs 等咨询公司或分析机构",
    POLICY:
      "政策文件、政府文件 - 来自政府网站 (.gov, .mil), 智库 (Brookings, RAND, CFR), 或政策研究机构",
    EVENT:
      "活动、会议 - 来自 Eventbrite, Meetup 或技术会议网站如 NeurIPS, ICML, CES",
    RSS: "RSS 订阅源 - 任何 RSS/Atom feed 链接",
  };

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 使用 AI 对 URL 进行分类
   */
  async classifyUrl(url: string): Promise<UrlClassificationResult> {
    this.logger.log(`Classifying URL: ${url}`);

    try {
      // 提取 URL 基本信息
      const urlInfo = this.extractUrlInfo(url);

      // 快速检查：YouTube 视频
      if (this.isYouTubeUrl(url)) {
        return {
          resourceType: "YOUTUBE_VIDEO" as ResourceType,
          confidence: 1.0,
          reason: "YouTube video URL detected",
          extractedInfo: urlInfo,
        };
      }

      // 快速检查：RSS feed
      if (this.isRssFeed(url)) {
        return {
          resourceType: "RSS" as ResourceType,
          confidence: 1.0,
          reason: "RSS feed URL detected",
          extractedInfo: urlInfo,
        };
      }

      // 首先尝试规则匹配（更快、更可靠）
      const ruleBasedResult = this.classifyByRules(url, urlInfo);
      if (ruleBasedResult.confidence >= 0.8) {
        this.logger.log(
          `Rule-based classification: ${ruleBasedResult.resourceType} (confidence: ${ruleBasedResult.confidence})`,
        );
        return ruleBasedResult;
      }

      // 如果规则匹配置信度不高，尝试使用 AI 进行分类
      try {
        const prompt = this.buildClassificationPrompt(url, urlInfo);
        const result = await this.callLLM(prompt);

        // 解析 AI 响应
        const classification = this.parseClassificationResponse(result);

        // 将 AI 提取的标题和描述合并到 extractedInfo
        return {
          resourceType: classification.resourceType,
          confidence: classification.confidence,
          reason: classification.reason,
          alternatives: classification.alternatives,
          extractedInfo: {
            domain: urlInfo?.domain || "unknown",
            contentType: urlInfo?.contentType,
            title: classification.title || urlInfo?.title,
            description: classification.description || urlInfo?.description,
          },
        };
      } catch (llmError) {
        // LLM 失败时使用规则匹配结果
        this.logger.warn(
          `LLM classification failed, using rule-based fallback: ${llmError}`,
        );
        return ruleBasedResult;
      }
    } catch (error) {
      this.logger.error(`Failed to classify URL: ${error}`);

      // 返回默认分类
      return {
        resourceType: "BLOG" as ResourceType,
        confidence: 0.3,
        reason: "Classification failed, defaulting to BLOG",
        extractedInfo: this.extractUrlInfo(url),
      };
    }
  }

  /**
   * 批量分类 URL
   */
  async classifyUrls(urls: string[]): Promise<UrlClassificationResult[]> {
    const results: UrlClassificationResult[] = [];

    for (const url of urls) {
      const result = await this.classifyUrl(url);
      results.push(result);
    }

    return results;
  }

  /**
   * 基于规则的 URL 分类（不需要 LLM）
   * 根据已知的域名模式进行分类
   */
  private classifyByRules(
    url: string,
    urlInfo: UrlClassificationResult["extractedInfo"],
  ): UrlClassificationResult {
    const domain = urlInfo?.domain?.toLowerCase() || "";
    const lowerUrl = url.toLowerCase();

    // 学术论文平台 - 高置信度
    const paperDomains = [
      "arxiv.org",
      "ieee.org",
      "acm.org",
      "springer.com",
      "nature.com",
      "science.org",
      "cell.com",
      "sciencedirect.com",
      "researchgate.net",
      "scholar.google",
      "pubmed.ncbi",
      "biorxiv.org",
      "medrxiv.org",
      "ssrn.com",
      "semanticscholar.org",
    ];
    if (
      paperDomains.some((d) => domain.includes(d)) ||
      lowerUrl.includes("/abs/") ||
      lowerUrl.includes("/paper/") ||
      lowerUrl.includes("/doi/")
    ) {
      return {
        resourceType: "PAPER" as ResourceType,
        confidence: 0.9,
        reason: `Academic paper platform detected: ${domain}`,
        extractedInfo: urlInfo,
      };
    }

    // 新闻网站 - 高置信度
    const newsDomains = [
      "techcrunch.com",
      "theverge.com",
      "wired.com",
      "arstechnica.com",
      "bloomberg.com",
      "reuters.com",
      "bbc.com",
      "cnn.com",
      "nytimes.com",
      "wsj.com",
      "engadget.com",
      "venturebeat.com",
      "zdnet.com",
      "cnet.com",
    ];
    if (newsDomains.some((d) => domain.includes(d))) {
      return {
        resourceType: "NEWS" as ResourceType,
        confidence: 0.9,
        reason: `News platform detected: ${domain}`,
        extractedInfo: urlInfo,
      };
    }

    // 技术博客平台 - 高置信度
    const blogDomains = [
      "medium.com",
      "dev.to",
      "hashnode.dev",
      "substack.com",
      "ghost.io",
      "wordpress.com",
      "blogger.com",
      "tumblr.com",
      "adafruit.com",
      "hackaday.com",
      "instructables.com",
    ];
    if (
      blogDomains.some((d) => domain.includes(d)) ||
      lowerUrl.includes("/blog/") ||
      lowerUrl.includes("/post/")
    ) {
      return {
        resourceType: "BLOG" as ResourceType,
        confidence: 0.85,
        reason: `Blog platform detected: ${domain}`,
        extractedInfo: urlInfo,
      };
    }

    // 公司技术博客 - 高置信度
    const companyBlogs = [
      "blog.google",
      "blog.microsoft",
      "engineering.fb",
      "ai.meta",
      "openai.com/blog",
      "anthropic.com",
      "deepmind.google",
      "aws.amazon.com/blogs",
      "cloud.google.com/blog",
      "nvidia.com/blog",
      "huggingface.co/blog",
    ];
    if (companyBlogs.some((d) => domain.includes(d) || lowerUrl.includes(d))) {
      return {
        resourceType: "BLOG" as ResourceType,
        confidence: 0.9,
        reason: `Tech company blog detected: ${domain}`,
        extractedInfo: urlInfo,
      };
    }

    // 行业报告 - 中等置信度
    const reportDomains = [
      "gartner.com",
      "forrester.com",
      "idc.com",
      "mckinsey.com",
      "bcg.com",
      "deloitte.com",
      "pwc.com",
      "kpmg.com",
      "ey.com",
      "goldmansachs.com",
      "statista.com",
    ];
    if (
      reportDomains.some((d) => domain.includes(d)) ||
      lowerUrl.includes("/report") ||
      lowerUrl.includes("/research")
    ) {
      return {
        resourceType: "REPORT" as ResourceType,
        confidence: 0.8,
        reason: `Report/research platform detected: ${domain}`,
        extractedInfo: urlInfo,
      };
    }

    // 政策/政府网站 - 高置信度
    if (
      domain.endsWith(".gov") ||
      domain.endsWith(".mil") ||
      domain.includes("whitehouse.gov") ||
      domain.includes("congress.gov")
    ) {
      return {
        resourceType: "POLICY" as ResourceType,
        confidence: 0.9,
        reason: `Government/policy site detected: ${domain}`,
        extractedInfo: urlInfo,
      };
    }

    // 活动/会议 - 中等置信度
    const eventDomains = [
      "eventbrite.com",
      "meetup.com",
      "neurips.cc",
      "icml.cc",
      "iclr.cc",
      "cvpr",
      "siggraph.org",
    ];
    if (
      eventDomains.some((d) => domain.includes(d)) ||
      lowerUrl.includes("/event") ||
      lowerUrl.includes("/conference")
    ) {
      return {
        resourceType: "EVENT" as ResourceType,
        confidence: 0.8,
        reason: `Event/conference platform detected: ${domain}`,
        extractedInfo: urlInfo,
      };
    }

    // GitHub - 默认为博客（README/项目介绍）
    if (domain.includes("github.com") || domain.includes("gitlab.com")) {
      return {
        resourceType: "BLOG" as ResourceType,
        confidence: 0.7,
        reason: `Code repository detected: ${domain}`,
        extractedInfo: urlInfo,
      };
    }

    // 默认：无法确定，返回低置信度的 BLOG
    return {
      resourceType: "BLOG" as ResourceType,
      confidence: 0.5,
      reason: `Unknown domain, defaulted to BLOG: ${domain}`,
      extractedInfo: urlInfo,
    };
  }

  /**
   * 检查是否为 YouTube URL
   */
  private isYouTubeUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const host = urlObj.hostname.toLowerCase();
      return (
        host.includes("youtube.com") ||
        host.includes("youtu.be") ||
        host.includes("youtube-nocookie.com")
      );
    } catch {
      return false;
    }
  }

  /**
   * 检查是否为 RSS feed
   */
  private isRssFeed(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return (
      lowerUrl.includes("/feed") ||
      lowerUrl.includes("/rss") ||
      lowerUrl.includes(".xml") ||
      lowerUrl.includes("/atom") ||
      lowerUrl.includes("format=rss")
    );
  }

  /**
   * 提取 URL 基本信息
   */
  private extractUrlInfo(
    url: string,
  ): UrlClassificationResult["extractedInfo"] {
    try {
      const urlObj = new URL(url);
      return {
        domain: urlObj.hostname,
        contentType: this.guessContentType(url),
      };
    } catch {
      return {
        domain: "unknown",
      };
    }
  }

  /**
   * 猜测内容类型
   */
  private guessContentType(url: string): string {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.includes("/pdf") || lowerUrl.endsWith(".pdf")) {
      return "pdf";
    }
    if (lowerUrl.includes("/video") || lowerUrl.includes("/watch")) {
      return "video";
    }
    if (
      lowerUrl.includes("/paper") ||
      lowerUrl.includes("/abs/") ||
      lowerUrl.includes("/doi/")
    ) {
      return "paper";
    }
    if (lowerUrl.includes("/blog") || lowerUrl.includes("/post")) {
      return "blog";
    }
    if (lowerUrl.includes("/news") || lowerUrl.includes("/article")) {
      return "news";
    }
    if (lowerUrl.includes("/report") || lowerUrl.includes("/research")) {
      return "report";
    }

    return "webpage";
  }

  /**
   * 构建分类提示词
   * 同时请求LLM提取页面标题和描述（利用LLM的网络搜索能力）
   */
  private buildClassificationPrompt(
    url: string,
    urlInfo: UrlClassificationResult["extractedInfo"],
  ): string {
    const resourceTypes = Object.entries(this.resourceTypeDescriptions)
      .map(([type, desc]) => `- ${type}: ${desc}`)
      .join("\n");

    return `You are a URL analysis expert. Analyze the following URL to:
1. Classify it into the most appropriate resource type
2. Extract/infer the page title and description

URL: ${url}
Domain: ${urlInfo?.domain || "unknown"}
Detected content type: ${urlInfo?.contentType || "unknown"}

Available resource types:
${resourceTypes}

Analyze the URL and use your knowledge to:
1. Determine the most appropriate resource type based on domain and URL patterns
2. If you know what this page is about, provide the actual title and a brief description
3. If you don't know the specific content, infer a reasonable title from the URL path

Respond in JSON format:
{
  "resourceType": "TYPE",
  "confidence": 0.0-1.0,
  "reason": "Brief explanation of why this classification",
  "title": "The page title (if known) or inferred from URL",
  "description": "Brief description of the page content (if known)",
  "alternatives": [
    {"resourceType": "TYPE", "confidence": 0.0-1.0, "reason": "Brief explanation"}
  ]
}

Only include alternatives if there are other plausible classifications with confidence > 0.3.`;
  }

  /**
   * 调用 LLM 进行分类
   *
   * 通过 AIFacade 统一入口调用，使用 TaskProfile 语义化配置：
   * - creativity: "deterministic" — URL 分类需要确定性输出
   * - outputLength: "minimal"    — 简短的 JSON 分类结果
   */
  private async callLLM(prompt: string): Promise<string> {
    const response = await this.chatFacade.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a URL classification assistant. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: "deterministic",
        outputLength: "minimal",
      },
    });

    return response.content;
  }

  /**
   * 解析分类响应
   * 包含资源类型、置信度以及从LLM获取的标题和描述
   */
  private parseClassificationResponse(response: string): Omit<
    UrlClassificationResult,
    "extractedInfo"
  > & {
    title?: string;
    description?: string;
  } {
    try {
      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // 验证资源类型
      const validTypes = Object.keys(this.resourceTypeDescriptions);
      if (!validTypes.includes(parsed.resourceType)) {
        this.logger.warn(
          `Invalid resource type: ${parsed.resourceType}, defaulting to BLOG`,
        );
        parsed.resourceType = "BLOG";
        parsed.confidence = 0.5;
      }

      return {
        resourceType: parsed.resourceType as ResourceType,
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        reason: parsed.reason || "Classified by AI",
        title: parsed.title || undefined,
        description: parsed.description || undefined,
        alternatives: parsed.alternatives?.map(
          (alt: {
            resourceType: string;
            confidence: number;
            reason: string;
          }) => ({
            resourceType: alt.resourceType as ResourceType,
            confidence: Math.min(1, Math.max(0, alt.confidence || 0)),
            reason: alt.reason || "",
          }),
        ),
      };
    } catch (error) {
      this.logger.error(`Failed to parse classification response: ${error}`);

      // 返回默认值
      return {
        resourceType: "BLOG" as ResourceType,
        confidence: 0.3,
        reason: "Failed to parse AI response",
      };
    }
  }

  /**
   * 获取所有支持的资源类型及其描述
   */
  getResourceTypeDescriptions(): Record<string, string> {
    return { ...this.resourceTypeDescriptions };
  }
}
