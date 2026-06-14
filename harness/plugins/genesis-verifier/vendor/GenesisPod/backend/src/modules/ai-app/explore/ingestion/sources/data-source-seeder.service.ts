import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { APP_CONFIG } from "../../../../../common/config/app.config";

/**
 * 数据源预置服务 - 应用启动时自动添加预置数据源
 *
 * 行为：
 * - 验证 RSS 源有效性，只添加有效的数据源
 * - 无效源汇总输出（单条警告日志），避免日志刷屏
 */
@Injectable()
export class DataSourceSeederService implements OnModuleInit {
  private readonly logger = new Logger(DataSourceSeederService.name);
  private readonly VALIDATION_TIMEOUT = 10000; // 10秒超时

  constructor(private prisma: PrismaService) {}

  /**
   * 验证RSS Feed是否有效
   * @param url RSS Feed URL
   * @returns true if valid, false otherwise
   */
  private async validateRssFeed(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.VALIDATION_TIMEOUT,
      );

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": APP_CONFIG.brand.userAgent,
          Accept:
            "application/rss+xml, application/xml, application/atom+xml, text/xml, */*",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // 静默返回 false，由调用方汇总输出
        return false;
      }

      // 检查Content-Type是否为XML
      const contentType = response.headers.get("content-type") || "";
      const isXml =
        contentType.includes("xml") ||
        contentType.includes("rss") ||
        contentType.includes("atom");

      if (!isXml) {
        // 尝试检查响应内容是否以XML标签开头
        const text = await response.text();
        const trimmedText = text.trim();
        // 如果不是 XML/RSS/Feed 格式，且是 HTML 页面，则验证失败
        if (
          !trimmedText.startsWith("<?xml") &&
          !trimmedText.startsWith("<rss") &&
          !trimmedText.startsWith("<feed") &&
          !trimmedText.startsWith("<html")
        ) {
          return false;
        }
        // 如果以 <html 开头，说明返回的是 HTML 页面而非 RSS
        if (
          trimmedText.startsWith("<html") ||
          trimmedText.startsWith("<!DOCTYPE html")
        ) {
          return false;
        }
      }

      return true;
    } catch {
      // 静默返回 false，由调用方汇总输出
      return false;
    }
  }

  async onModuleInit() {
    this.logger.log("Checking and seeding default data sources...");
    await this.seedAllSources();
  }

  // ============== YouTube 频道配置 ==============
  private readonly YOUTUBE_CHANNELS = [
    {
      name: "Y Combinator",
      channelId: "UCcefcZRL2oaA_uBNeo5UOWg",
      handle: "@ycombinator",
      description: "Y Combinator官方频道，创业、投资、科技讲座",
      keywords: ["startup", "venture capital", "entrepreneurship", "tech"],
    },
    {
      name: "BG2Pod",
      channelId: "UC-yRDvpR99LUc5l7i7jLzew",
      handle: "@Bg2Pod",
      description: "Brad Gerstner & Bill Gurley播客，科技投资市场分析",
      keywords: ["tech", "investing", "venture capital", "markets"],
    },
    {
      name: "Dwarkesh Patel",
      channelId: "UChnNjLyx_5rk_iDPQ2BQDQA",
      handle: "@DwarkeshPatel",
      description: "Dwarkesh Podcast - 深度科技访谈，AI、技术、创业、地缘政治",
      keywords: [
        "ai",
        "technology",
        "interviews",
        "podcast",
        "startups",
        "geopolitics",
      ],
    },
    {
      name: "Bloomberg Technology",
      channelId: "UCrM7B7SL_g1edFOnmj-SDKg",
      handle: "@BloombergTechnology",
      description: "Bloomberg科技新闻与分析",
      keywords: ["tech", "business", "news", "markets", "bloomberg"],
    },
  ];

  // ============== 企业技术博客配置 ==============
  private readonly TECH_BLOGS = [
    // 大型科技公司 (AI基础设施) - 已验证的RSS
    {
      name: "NVIDIA Technical Blog",
      baseUrl: "https://developer.nvidia.com/blog/feed/",
      description: "NVIDIA开发者博客，GPU、AI、CUDA技术",
      keywords: ["nvidia", "gpu", "cuda", "ai", "deep learning"],
    },
    {
      name: "Google AI Blog",
      baseUrl: "https://blog.google/technology/ai/rss/",
      description: "Google AI研究与产品博客",
      keywords: ["google", "ai", "machine learning", "research"],
    },
    {
      name: "Google Cloud Blog",
      baseUrl: "https://cloud.google.com/blog/rss",
      description: "Google Cloud技术博客",
      keywords: ["google", "cloud", "gcp", "infrastructure"],
    },
    {
      name: "AWS News Blog",
      baseUrl: "https://aws.amazon.com/blogs/aws/feed/",
      description: "AWS官方新闻博客",
      keywords: ["aws", "amazon", "cloud", "infrastructure"],
    },
    {
      name: "AWS Machine Learning Blog",
      baseUrl: "https://aws.amazon.com/blogs/machine-learning/feed/",
      description: "AWS机器学习博客",
      keywords: ["aws", "machine learning", "sagemaker", "ai"],
    },
    {
      name: "Microsoft Research Blog",
      baseUrl: "https://www.microsoft.com/en-us/research/feed/",
      description: "Microsoft研究院博客",
      keywords: ["microsoft", "research", "ai", "innovation"],
    },
    {
      name: "Cisco Networking Blog",
      baseUrl: "https://blogs.cisco.com/networking/feed",
      description: "Cisco网络技术博客",
      keywords: ["cisco", "networking", "infrastructure", "security"],
    },
    // 网络安全公司 - 已验证的RSS
    {
      name: "Palo Alto Networks Blog",
      baseUrl: "https://www.paloaltonetworks.com/blog/feed/",
      description: "Palo Alto Networks安全博客",
      keywords: ["paloalto", "security", "firewall", "threat"],
    },
    {
      name: "CrowdStrike Blog",
      baseUrl: "https://www.crowdstrike.com/blog/feed/",
      description: "CrowdStrike网络安全博客",
      keywords: ["crowdstrike", "endpoint", "security", "threat"],
    },
    // AI 初创公司/研究机构 - 已验证的RSS
    {
      name: "OpenAI Blog",
      baseUrl: "https://openai.com/blog/rss.xml",
      description: "OpenAI官方博客，GPT、DALL-E等AI研究",
      keywords: ["openai", "gpt", "chatgpt", "ai", "research"],
    },
    {
      name: "Anthropic News",
      baseUrl: "https://www.anthropic.com/news/rss.xml",
      description: "Anthropic官方博客，Claude AI研究",
      keywords: ["anthropic", "claude", "ai safety", "research"],
    },
    {
      name: "Hugging Face Blog",
      baseUrl: "https://huggingface.co/blog/feed.xml",
      description: "Hugging Face开源AI模型与工具",
      keywords: ["huggingface", "transformers", "open source", "ai"],
    },
    {
      name: "DeepMind Blog",
      baseUrl: "https://deepmind.google/blog/rss.xml",
      description: "DeepMind AI研究博客",
      keywords: ["deepmind", "google", "ai research", "alphafold"],
    },
  ];

  // ============== 研究报告配置 ==============
  private readonly REPORT_SOURCES = [
    {
      name: "SemiAnalysis",
      baseUrl: "https://semianalysis.substack.com/feed",
      description: "半导体行业深度分析，AI芯片市场研究",
      keywords: ["semiconductor", "ai chips", "nvidia", "amd", "intel"],
    },
    {
      name: "Stratechery",
      baseUrl: "https://stratechery.com/feed/",
      description: "Ben Thompson科技战略分析",
      keywords: ["tech strategy", "analysis", "business", "platforms"],
    },
    {
      name: "Benedict Evans",
      baseUrl: "https://www.ben-evans.com/benedictevans?format=rss",
      description: "Benedict Evans科技产业分析",
      keywords: ["tech", "analysis", "mobile", "ai", "future"],
    },
    {
      name: "a16z Blog",
      baseUrl: "https://a16z.com/feed/",
      description: "Andreessen Horowitz风投博客",
      keywords: ["a16z", "venture capital", "startup", "tech"],
    },
    {
      name: "AI Supremacy (Substack)",
      baseUrl: "https://aisupremacy.substack.com/feed",
      description: "AI行业深度分析与趋势",
      keywords: ["ai", "analysis", "industry", "trends"],
    },
    {
      name: "The Batch (DeepLearning.AI)",
      baseUrl: "https://www.deeplearning.ai/the-batch/feed/",
      description: "Andrew Ng的AI周报",
      keywords: ["deeplearning", "ai news", "andrew ng", "research"],
    },
    {
      name: "Import AI",
      baseUrl: "https://importai.substack.com/feed",
      description: "Jack Clark的AI周报",
      keywords: ["ai", "policy", "research", "anthropic"],
    },
    {
      name: "MIT Technology Review AI",
      baseUrl:
        "https://www.technologyreview.com/topic/artificial-intelligence/feed",
      description: "MIT科技评论 - AI专题",
      keywords: ["mit", "ai", "research", "technology"],
    },
  ];

  // ============== 学术论文配置 ==============
  private readonly PAPER_SOURCES = [
    {
      name: "arXiv cs.AI",
      baseUrl: "https://rss.arxiv.org/rss/cs.AI",
      description: "arXiv人工智能论文",
      keywords: ["arxiv", "ai", "research", "papers"],
    },
    {
      name: "arXiv cs.LG",
      baseUrl: "https://rss.arxiv.org/rss/cs.LG",
      description: "arXiv机器学习论文",
      keywords: ["arxiv", "machine learning", "deep learning", "papers"],
    },
    {
      name: "arXiv cs.CL",
      baseUrl: "https://rss.arxiv.org/rss/cs.CL",
      description: "arXiv计算语言学论文 (NLP/LLM)",
      keywords: ["arxiv", "nlp", "llm", "language models"],
    },
    {
      name: "arXiv cs.CV",
      baseUrl: "https://rss.arxiv.org/rss/cs.CV",
      description: "arXiv计算机视觉论文",
      keywords: ["arxiv", "computer vision", "image", "video"],
    },
  ];

  // ============== 科技新闻配置 (TOP 10+) ==============
  private readonly NEWS_SOURCES = [
    {
      name: "Ars Technica",
      baseUrl: "https://feeds.arstechnica.com/arstechnica/index",
      description: "Ars Technica深度科技报道",
      keywords: ["ars technica", "tech", "science", "analysis"],
    },
    {
      name: "Hacker News",
      baseUrl: "https://news.ycombinator.com/rss",
      description: "Y Combinator Hacker News",
      keywords: ["hackernews", "ycombinator", "startup", "tech"],
    },
    {
      name: "TechCrunch",
      baseUrl: "https://techcrunch.com/feed/",
      description: "TechCrunch科技创业新闻",
      keywords: ["techcrunch", "startup", "funding", "tech"],
    },
    {
      name: "The Verge",
      baseUrl: "https://www.theverge.com/rss/index.xml",
      description: "The Verge科技消费电子",
      keywords: ["verge", "tech", "gadgets", "consumer"],
    },
    {
      name: "Wired",
      baseUrl: "https://www.wired.com/feed/rss",
      description: "Wired科技文化杂志",
      keywords: ["wired", "tech", "culture", "future"],
    },
    {
      name: "VentureBeat",
      baseUrl: "https://venturebeat.com/feed/",
      description: "VentureBeat AI与企业技术",
      keywords: ["venturebeat", "ai", "enterprise", "startup"],
    },
    {
      name: "ZDNet",
      baseUrl: "https://www.zdnet.com/news/rss.xml",
      description: "ZDNet企业IT新闻",
      keywords: ["zdnet", "enterprise", "it", "business"],
    },
    {
      name: "The Information",
      baseUrl: "https://www.theinformation.com/feed",
      description: "The Information深度科技报道",
      keywords: ["information", "tech", "business", "exclusive"],
    },
    {
      name: "Reuters Technology",
      baseUrl: "https://www.reuters.com/technology/rss",
      description: "Reuters科技新闻",
      keywords: ["reuters", "tech", "business", "global"],
    },
    {
      name: "CNBC Tech",
      baseUrl: "https://www.cnbc.com/id/19854910/device/rss/rss.html",
      description: "CNBC科技财经",
      keywords: ["cnbc", "tech", "finance", "markets"],
    },
  ];

  // ============== AI政策配置 (美国/欧洲/中国) ==============
  private readonly POLICY_SOURCES = [
    // 美国政策源
    {
      name: "CSET Georgetown",
      baseUrl: "https://cset.georgetown.edu/feed/",
      description: "乔治城大学安全与新兴技术中心 - 中美AI政策研究",
      keywords: ["cset", "china", "us", "ai policy", "research"],
      region: "US",
    },
    {
      name: "Brookings AI",
      baseUrl: "https://www.brookings.edu/topic/artificial-intelligence/feed/",
      description: "Brookings智库 - AI政策研究",
      keywords: ["brookings", "ai policy", "governance", "us"],
      region: "US",
    },
    {
      name: "Center for AI Safety (CAIS)",
      baseUrl: "https://www.safe.ai/blog-rss-feed",
      description: "AI安全中心 - AI风险研究",
      keywords: ["ai safety", "risk", "alignment", "policy"],
      region: "US",
    },
    {
      name: "Stanford HAI",
      baseUrl: "https://hai.stanford.edu/news/feed",
      description: "Stanford人类中心AI研究所",
      keywords: ["stanford", "hai", "ai research", "policy"],
      region: "US",
    },
    // 欧洲政策源
    {
      name: "EU AI Act News",
      baseUrl: "https://artificialintelligenceact.substack.com/feed",
      description: "欧盟AI法案最新动态",
      keywords: ["eu", "ai act", "regulation", "europe"],
      region: "EU",
    },
    {
      name: "Ada Lovelace Institute",
      baseUrl: "https://www.adalovelaceinstitute.org/feed/",
      description: "Ada Lovelace研究所 - AI伦理与治理",
      keywords: ["ada lovelace", "ai ethics", "governance", "uk"],
      region: "EU",
    },
    // 中国/国际政策源
    {
      name: "ChinAI Newsletter",
      baseUrl: "https://chinai.substack.com/feed",
      description: "ChinAI通讯 - 中国AI政策与研究翻译",
      keywords: ["china", "ai", "policy", "translation"],
      region: "CN",
    },
    {
      name: "DigiChina (Stanford)",
      baseUrl: "https://digichina.stanford.edu/feed/",
      description: "Stanford中国数字经济研究",
      keywords: ["china", "digital", "policy", "tech"],
      region: "CN",
    },
    // 全球AI治理
    {
      name: "Future of Life Institute",
      baseUrl: "https://futureoflife.org/feed/",
      description: "生命未来研究所 - AI风险与治理",
      keywords: ["fli", "ai risk", "existential", "governance"],
      region: "GLOBAL",
    },
    {
      name: "Partnership on AI",
      baseUrl: "https://partnershiponai.org/feed/",
      description: "AI合作伙伴关系 - 多利益相关方AI治理",
      keywords: ["partnership", "ai governance", "ethics", "industry"],
      region: "GLOBAL",
    },
  ];

  async seedAllSources() {
    let created = 0;
    let skipped = 0;
    const invalidSources: string[] = [];

    // 收集所有数据源进行批量处理
    const allSources = [
      ...this.YOUTUBE_CHANNELS.map((s) => ({ ...s, type: "youtube" as const })),
      ...this.TECH_BLOGS.map((s) => ({ ...s, type: "blog" as const })),
      ...this.REPORT_SOURCES.map((s) => ({ ...s, type: "report" as const })),
      ...this.PAPER_SOURCES.map((s) => ({ ...s, type: "paper" as const })),
      ...this.NEWS_SOURCES.map((s) => ({ ...s, type: "news" as const })),
      ...this.POLICY_SOURCES.map((s) => ({ ...s, type: "policy" as const })),
    ];

    // 批量检查哪些源已存在（单次数据库查询）
    const existingNames = new Set(
      (
        await this.prisma.dataSource.findMany({
          where: {
            name: { in: allSources.map((s) => s.name) },
          },
          select: { name: true },
        })
      ).map((s) => s.name),
    );

    // 过滤出需要创建的源
    const sourcesToCreate = allSources.filter(
      (s) => !existingNames.has(s.name),
    );
    skipped = existingNames.size;

    // 并发验证和创建新源（限制并发数避免网络压力）
    const CONCURRENCY = 5;
    for (let i = 0; i < sourcesToCreate.length; i += CONCURRENCY) {
      const batch = sourcesToCreate.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (source) => {
          let result: "created" | "skipped" | "invalid";
          switch (source.type) {
            case "youtube":
              result = await this.seedYouTubeChannel(
                source as unknown as (typeof this.YOUTUBE_CHANNELS)[0],
              );
              break;
            case "blog":
              result = await this.seedBlog(
                source as unknown as (typeof this.TECH_BLOGS)[0],
              );
              break;
            case "report":
              result = await this.seedReport(
                source as unknown as (typeof this.REPORT_SOURCES)[0],
              );
              break;
            case "paper":
              result = await this.seedPaper(
                source as unknown as (typeof this.PAPER_SOURCES)[0],
              );
              break;
            case "news":
              result = await this.seedNews(
                source as unknown as (typeof this.NEWS_SOURCES)[0],
              );
              break;
            case "policy":
              result = await this.seedPolicy(
                source as unknown as (typeof this.POLICY_SOURCES)[0],
              );
              break;
            default:
              result = "invalid";
          }
          return { name: source.name, result };
        }),
      );

      for (const { name, result } of results) {
        if (result === "created") created++;
        else if (result === "invalid") invalidSources.push(name);
        // skipped 已经在上面计算过了
      }
    }

    // 汇总输出结果
    this.logger.log(
      `Data source seeding: ${created} created, ${skipped} exist, ${invalidSources.length} invalid`,
    );

    // 无效源汇总警告（单条日志）
    if (invalidSources.length > 0) {
      this.logger.warn(
        `Invalid RSS sources skipped: ${invalidSources.join(", ")}`,
      );
    }
  }

  private async seedYouTubeChannel(
    channel: (typeof this.YOUTUBE_CHANNELS)[0],
  ): Promise<"created" | "skipped" | "invalid"> {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;

    const existing = await this.prisma.dataSource.findFirst({
      where: { OR: [{ name: channel.name }, { baseUrl: rssUrl }] },
    });

    if (existing) return "skipped";

    // Validate YouTube RSS feed
    const isValid = await this.validateRssFeed(rssUrl);
    if (!isValid) {
      return "invalid";
    }

    await this.prisma.dataSource.create({
      data: {
        name: channel.name,
        description: channel.description,
        type: "YOUTUBE",
        category: "YOUTUBE_VIDEO",
        baseUrl: rssUrl,
        apiEndpoint: `https://www.youtube.com/${channel.handle}`,
        authType: "NONE",
        crawlerType: "RSS",
        crawlerConfig: {
          channelId: channel.channelId,
          handle: channel.handle,
          schedule: { frequency: "daily", time: "06:00", enabled: true },
        },
        rateLimit: 1,
        keywords: channel.keywords,
        categories: ["Technology", "Business"],
        languages: ["en"],
        status: "ACTIVE",
        isVerified: true, // Validated
      },
    });

    this.logger.log(`[Seeder] Created YouTube source: ${channel.name}`);
    return "created";
  }

  private async seedBlog(
    blog: (typeof this.TECH_BLOGS)[0],
  ): Promise<"created" | "skipped" | "invalid"> {
    const existing = await this.prisma.dataSource.findFirst({
      where: { OR: [{ name: blog.name }, { baseUrl: blog.baseUrl }] },
    });

    if (existing) return "skipped";

    // Validate RSS feed
    const isValid = await this.validateRssFeed(blog.baseUrl);
    if (!isValid) {
      return "invalid";
    }

    await this.prisma.dataSource.create({
      data: {
        name: blog.name,
        description: blog.description,
        type: "RSS",
        category: "BLOG",
        baseUrl: blog.baseUrl,
        authType: "NONE",
        crawlerType: "RSS",
        crawlerConfig: {
          maxItems: 20,
          schedule: { frequency: "daily", time: "07:00", enabled: true },
        },
        rateLimit: 1,
        keywords: blog.keywords,
        categories: ["Technology"],
        languages: ["en"],
        status: "ACTIVE",
        isVerified: true, // Validated
      },
    });

    this.logger.log(`[Seeder] Created Blog source: ${blog.name}`);
    return "created";
  }

  private async seedReport(
    report: (typeof this.REPORT_SOURCES)[0],
  ): Promise<"created" | "skipped" | "invalid"> {
    const existing = await this.prisma.dataSource.findFirst({
      where: { OR: [{ name: report.name }, { baseUrl: report.baseUrl }] },
    });

    if (existing) return "skipped";

    // Validate RSS feed
    const isValid = await this.validateRssFeed(report.baseUrl);
    if (!isValid) {
      return "invalid";
    }

    await this.prisma.dataSource.create({
      data: {
        name: report.name,
        description: report.description,
        type: "RSS",
        category: "REPORT",
        baseUrl: report.baseUrl,
        authType: "NONE",
        crawlerType: "RSS",
        crawlerConfig: {
          maxItems: 20,
          schedule: { frequency: "daily", time: "09:00", enabled: true },
        },
        rateLimit: 1,
        keywords: report.keywords,
        categories: ["Research", "Analysis"],
        languages: ["en"],
        status: "ACTIVE",
        isVerified: true, // Validated
      },
    });

    this.logger.log(`[Seeder] Created Report source: ${report.name}`);
    return "created";
  }

  private async seedPaper(
    paper: (typeof this.PAPER_SOURCES)[0],
  ): Promise<"created" | "skipped" | "invalid"> {
    const existing = await this.prisma.dataSource.findFirst({
      where: { OR: [{ name: paper.name }, { baseUrl: paper.baseUrl }] },
    });

    if (existing) return "skipped";

    // Validate RSS feed
    const isValid = await this.validateRssFeed(paper.baseUrl);
    if (!isValid) {
      return "invalid";
    }

    await this.prisma.dataSource.create({
      data: {
        name: paper.name,
        description: paper.description,
        type: "ARXIV",
        category: "PAPER",
        baseUrl: paper.baseUrl,
        authType: "NONE",
        crawlerType: "RSS",
        crawlerConfig: {
          maxItems: 50,
          schedule: { frequency: "daily", time: "05:00", enabled: true },
        },
        rateLimit: 1,
        keywords: paper.keywords,
        categories: ["Academic", "Research"],
        languages: ["en"],
        status: "ACTIVE",
        isVerified: true, // Validated
      },
    });

    this.logger.log(`[Seeder] Created Paper source: ${paper.name}`);
    return "created";
  }

  private async seedNews(
    news: (typeof this.NEWS_SOURCES)[0],
  ): Promise<"created" | "skipped" | "invalid"> {
    const existing = await this.prisma.dataSource.findFirst({
      where: { OR: [{ name: news.name }, { baseUrl: news.baseUrl }] },
    });

    if (existing) return "skipped";

    // Validate RSS feed
    const isValid = await this.validateRssFeed(news.baseUrl);
    if (!isValid) {
      return "invalid";
    }

    await this.prisma.dataSource.create({
      data: {
        name: news.name,
        description: news.description,
        type: "RSS",
        category: "NEWS",
        baseUrl: news.baseUrl,
        authType: "NONE",
        crawlerType: "RSS",
        crawlerConfig: {
          maxItems: 30,
          schedule: { frequency: "hourly", time: "", enabled: true },
        },
        rateLimit: 1,
        keywords: news.keywords,
        categories: ["News", "Technology"],
        languages: ["en"],
        status: "ACTIVE",
        isVerified: true, // Validated
      },
    });

    this.logger.log(`[Seeder] Created News source: ${news.name}`);
    return "created";
  }

  private async seedPolicy(
    policy: (typeof this.POLICY_SOURCES)[0],
  ): Promise<"created" | "skipped" | "invalid"> {
    const existing = await this.prisma.dataSource.findFirst({
      where: { OR: [{ name: policy.name }, { baseUrl: policy.baseUrl }] },
    });

    if (existing) return "skipped";

    // Validate RSS feed
    const isValid = await this.validateRssFeed(policy.baseUrl);
    if (!isValid) {
      return "invalid";
    }

    await this.prisma.dataSource.create({
      data: {
        name: policy.name,
        description: policy.description,
        type: "RSS",
        category: "POLICY",
        baseUrl: policy.baseUrl,
        authType: "NONE",
        crawlerType: "RSS",
        crawlerConfig: {
          region: policy.region,
          maxItems: 20,
          schedule: { frequency: "daily", time: "08:00", enabled: true },
        },
        rateLimit: 1,
        keywords: policy.keywords,
        categories: ["Policy", "AI Governance"],
        languages: ["en"],
        status: "ACTIVE",
        isVerified: true, // Validated
      },
    });

    this.logger.log(`[Seeder] Created Policy source: ${policy.name}`);
    return "created";
  }
}
