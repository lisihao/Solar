/**
 * Slides Engine v4.0 - Image Fetcher Skill
 *
 * 配图获取技能：根据关键词从图片服务获取高质量配图
 * 支持 Unsplash API（免费50次/小时）
 * v4.0: 实现 ISkill 接口，集成到 AI Engine 技能系统
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";

/**
 * 图片搜索结果
 */
export interface ImageResult {
  id: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  description?: string;
  author?: string;
  authorUrl?: string;
}

/**
 * 图片搜索选项
 */
export interface ImageSearchOptions {
  /** 搜索关键词 */
  keywords: string[];
  /** 图片尺寸: small(400), medium(800), large(1600) */
  size?: "small" | "medium" | "large";
  /** 图片方向 */
  orientation?: "landscape" | "portrait" | "squarish";
  /** 返回数量 */
  count?: number;
}

/**
 * MissionOrchestrator 传递的输入格式
 */
interface OrchestratorInput {
  task?: string;
  context?: {
    input?: {
      keywords?: string[];
      size?: "small" | "medium" | "large";
      orientation?: "landscape" | "portrait" | "squarish";
      count?: number;
    };
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

/**
 * 本地备选图片库（当 API 不可用时使用）
 * v3.4: 扩展更多主题分类
 */
const FALLBACK_IMAGES: Record<string, string[]> = {
  business: [
    "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=800",
    "https://images.unsplash.com/photo-1560472355-536de3962603?w=800",
  ],
  technology: [
    "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800",
    "https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=800",
  ],
  data: [
    "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800",
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800",
  ],
  team: [
    "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800",
    "https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800",
  ],
  growth: [
    "https://images.unsplash.com/photo-1543286386-713bdd548da4?w=800",
    "https://images.unsplash.com/photo-1526628953301-3e589a6a8b74?w=800",
  ],
  innovation: [
    "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800",
    "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800",
  ],
  // v3.4: 新增主题分类
  weather: [
    "https://images.unsplash.com/photo-1504608524841-42fe6f032b4b?w=800",
    "https://images.unsplash.com/photo-1534088568595-a066f410bcda?w=800",
  ],
  city: [
    "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800",
    "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800",
  ],
  shopping: [
    "https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=800",
    "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800",
  ],
  lifestyle: [
    "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800",
    "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800",
  ],
  network: [
    "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800",
    "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800",
  ],
  nature: [
    "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800",
    "https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?w=800",
  ],
  default: [
    "https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=800",
    "https://images.unsplash.com/photo-1497032628192-86f99bcd76bc?w=800",
  ],
};

/**
 * 关键词到类别映射
 * v3.4: 大幅扩展关键词覆盖
 */
const KEYWORD_CATEGORY_MAP: Record<string, string> = {
  // 商业
  商业: "business",
  公司: "business",
  企业: "business",
  市场: "business",
  经济: "business",
  投资: "business",
  金融: "business",
  business: "business",
  company: "business",
  market: "business",
  economy: "business",
  // 技术
  技术: "technology",
  科技: "technology",
  数字化: "technology",
  互联网: "technology",
  通信: "technology",
  基础设施: "technology",
  tech: "technology",
  digital: "technology",
  software: "technology",
  internet: "technology",
  // 数据
  数据: "data",
  分析: "data",
  图表: "data",
  统计: "data",
  指标: "data",
  评价: "data",
  data: "data",
  analytics: "data",
  chart: "data",
  // 团队
  团队: "team",
  协作: "team",
  人员: "team",
  员工: "team",
  team: "team",
  collaboration: "team",
  people: "team",
  // 增长
  增长: "growth",
  发展: "growth",
  提升: "growth",
  前景: "growth",
  growth: "growth",
  development: "growth",
  progress: "growth",
  // 创新
  创新: "innovation",
  未来: "innovation",
  智能: "innovation",
  AI: "innovation",
  innovation: "innovation",
  future: "innovation",
  ai: "innovation",
  // v3.4: 新增主题映射
  // 天气/气候
  气候: "weather",
  天气: "weather",
  气温: "weather",
  季节: "weather",
  冬季: "weather",
  夏季: "weather",
  降雪: "weather",
  weather: "weather",
  climate: "weather",
  // 城市
  城市: "city",
  首都: "city",
  渥太华: "city",
  多伦多: "city",
  温哥华: "city",
  地理: "city",
  位置: "city",
  city: "city",
  urban: "city",
  // 购物/超市
  购物: "shopping",
  超市: "shopping",
  商店: "shopping",
  零售: "shopping",
  消费: "shopping",
  shopping: "shopping",
  retail: "shopping",
  store: "shopping",
  // 生活方式
  生活: "lifestyle",
  居民: "lifestyle",
  便利: "lifestyle",
  质量: "lifestyle",
  lifestyle: "lifestyle",
  living: "lifestyle",
  // 网络
  网络: "network",
  覆盖: "network",
  信号: "network",
  宽带: "network",
  network: "network",
  coverage: "network",
  // 自然
  自然: "nature",
  环境: "nature",
  植物: "nature",
  公园: "nature",
  nature: "nature",
  environment: "nature",
};

@Injectable()
export class ImageFetcherSkill implements ISkill<
  ImageSearchOptions,
  ImageResult[]
> {
  private readonly logger = new Logger(ImageFetcherSkill.name);
  private readonly unsplashAccessKey: string | undefined;
  private readonly sizeMap = {
    small: 400,
    medium: 800,
    large: 1600,
  };

  // ISkill required properties
  readonly id = "slides-image-fetcher";
  readonly name = "图片获取";
  readonly description = "根据关键词搜索并获取相关图片";
  readonly layer: SkillLayer = SKILL_LAYERS.CONTENT;
  readonly domain = "slides";
  readonly tags = ["slides", "image", "fetch", "search"];
  readonly version = "4.0.0";

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.unsplashAccessKey = this.configService.get<string>(
      "UNSPLASH_ACCESS_KEY",
    );
    if (!this.unsplashAccessKey) {
      // Non-critical: gracefully falls back to default images
      this.logger.debug(
        "[ImageFetcherSkill] UNSPLASH_ACCESS_KEY not configured, using fallback images",
      );
    }
  }

  /**
   * ISkill 执行入口
   * 实现 ISkill<ImageSearchOptions, ImageResult[]> 接口
   *
   * 支持两种输入格式：
   * 1. 直接调用: { keywords, size?, orientation?, count? }
   * 2. MissionOrchestrator 格式: { task, context, previousOutputs }
   */
  async execute(
    input: ImageSearchOptions | OrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<ImageResult[]>> {
    const startTime = new Date();

    // 处理 Orchestrator 输入格式
    const actualInput = this.normalizeInput(input);
    if (!actualInput.keywords || actualInput.keywords.length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Missing keywords in input",
          retryable: false,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }

    try {
      this.logger.log(
        `[execute] Executing skill ${this.id} with executionId: ${context.executionId}`,
      );

      const result = await this.searchImages(actualInput);

      const endTime = new Date();

      return {
        success: true,
        data: result,
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      this.logger.error(
        `[execute] Error executing skill ${this.id}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        success: false,
        error: {
          code: "IMAGE_FETCH_ERROR",
          message: errorMessage,
          details: {
            skillId: this.id,
            executionId: context.executionId,
          },
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }

  /**
   * 根据关键词搜索图片
   */
  async searchImages(options: ImageSearchOptions): Promise<ImageResult[]> {
    const {
      keywords,
      size = "medium",
      orientation = "landscape",
      count = 1,
    } = options;

    const query = keywords.join(" ");
    this.logger.log(`[searchImages] Searching for: ${query}`);

    // 如果没有 API key，使用本地备选图片
    if (!this.unsplashAccessKey) {
      return this.getFallbackImages(keywords, count);
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get("https://api.unsplash.com/search/photos", {
          params: {
            query,
            orientation,
            per_page: count,
          },
          headers: {
            Authorization: `Client-ID ${this.unsplashAccessKey}`,
          },
        }),
      );

      const results = response.data.results || [];
      const width = this.sizeMap[size];

      return results.map(
        (photo: {
          id: string;
          urls: { raw: string; small: string };
          width: number;
          height: number;
          description?: string;
          alt_description?: string;
          user?: { name: string; links?: { html: string } };
        }) => ({
          id: photo.id,
          url: `${photo.urls.raw}&w=${width}&fit=crop`,
          thumbnailUrl: photo.urls.small,
          width: photo.width,
          height: photo.height,
          description: photo.description || photo.alt_description,
          author: photo.user?.name,
          authorUrl: photo.user?.links?.html,
        }),
      );
    } catch (error) {
      this.logger.error(`[searchImages] API error: ${error}`);
      return this.getFallbackImages(keywords, count);
    }
  }

  /**
   * 根据标题和内容提取关键词
   */
  extractKeywords(title: string, content?: string): string[] {
    const text = `${title} ${content || ""}`;
    const keywords: string[] = [];

    // 匹配中文关键词
    const chineseWords = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    keywords.push(...chineseWords.slice(0, 3));

    // 匹配英文关键词
    const englishWords =
      text.match(/\b[a-zA-Z]{3,}\b/g)?.map((w) => w.toLowerCase()) || [];
    keywords.push(...englishWords.slice(0, 2));

    // 去重
    return [...new Set(keywords)];
  }

  /**
   * 为幻灯片获取配图
   * 根据页面标题自动提取关键词并获取合适的图片
   */
  async fetchImageForSlide(
    title: string,
    subtitle?: string,
  ): Promise<ImageResult | null> {
    const keywords = this.extractKeywords(title, subtitle);
    if (keywords.length === 0) {
      keywords.push("business");
    }

    const results = await this.searchImages({
      keywords,
      size: "medium",
      orientation: "landscape",
      count: 1,
    });

    return results[0] || null;
  }

  /**
   * 生成图片占位符 HTML
   * 用于在图片加载前显示
   */
  generatePlaceholderHtml(
    width: number,
    height: number,
    text?: string,
  ): string {
    return `
<div style="
  width: ${width}px;
  height: ${height}px;
  background: linear-gradient(135deg, #1E293B 0%, #334155 100%);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748B;
  font-size: 14px;
">
  ${text || "图片加载中..."}
</div>
    `.trim();
  }

  /**
   * 生成带图片的 HTML 片段
   */
  generateImageHtml(
    image: ImageResult,
    options: {
      width?: number | string;
      height?: number | string;
      borderRadius?: string;
      objectFit?: "cover" | "contain" | "fill";
    } = {},
  ): string {
    const {
      width = "100%",
      height = "auto",
      borderRadius = "8px",
      objectFit = "cover",
    } = options;

    const widthStyle = typeof width === "number" ? `${width}px` : width;
    const heightStyle = typeof height === "number" ? `${height}px` : height;

    return `
<img
  src="${image.url}"
  alt="${image.description || "配图"}"
  style="
    width: ${widthStyle};
    height: ${heightStyle};
    border-radius: ${borderRadius};
    object-fit: ${objectFit};
  "
  loading="lazy"
/>
    `.trim();
  }

  /**
   * 获取本地备选图片
   */
  private getFallbackImages(keywords: string[], count: number): ImageResult[] {
    // 查找匹配的类别
    let category = "default";
    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();
      if (KEYWORD_CATEGORY_MAP[lowerKeyword]) {
        category = KEYWORD_CATEGORY_MAP[lowerKeyword];
        break;
      }
    }

    const images = FALLBACK_IMAGES[category] || FALLBACK_IMAGES.default;
    const results: ImageResult[] = [];

    for (let i = 0; i < Math.min(count, images.length); i++) {
      results.push({
        id: `fallback-${category}-${i}`,
        url: images[i],
        thumbnailUrl: images[i].replace("w=800", "w=200"),
        width: 800,
        height: 533,
        description: `${category} image`,
      });
    }

    this.logger.log(
      `[getFallbackImages] Using fallback images for category: ${category}`,
    );
    return results;
  }

  /**
   * 规范化输入格式
   * 支持直接调用格式和 MissionOrchestrator 格式
   */
  private normalizeInput(
    input: ImageSearchOptions | OrchestratorInput,
  ): ImageSearchOptions {
    // 检查是否是直接调用格式（有 keywords 属性）
    if ("keywords" in input && Array.isArray(input.keywords)) {
      return input;
    }

    // 处理 Orchestrator 格式
    const orchestratorInput = input as OrchestratorInput;
    const missionInput = orchestratorInput.context?.input;

    if (missionInput?.keywords && Array.isArray(missionInput.keywords)) {
      return {
        keywords: missionInput.keywords,
        size: missionInput.size,
        orientation: missionInput.orientation,
        count: missionInput.count,
      };
    }

    // 尝试从 context 的其他位置获取 keywords
    const context = orchestratorInput.context;
    if (context) {
      // 检查 context 是否直接有 keywords
      if (Array.isArray((context as Record<string, unknown>).keywords)) {
        return {
          keywords: (context as Record<string, unknown>).keywords as string[],
          size: (context as Record<string, unknown>).size as
            | "small"
            | "medium"
            | "large"
            | undefined,
          orientation: (context as Record<string, unknown>).orientation as
            | "landscape"
            | "portrait"
            | "squarish"
            | undefined,
          count: (context as Record<string, unknown>).count as
            | number
            | undefined,
        };
      }
    }

    // 返回空输入，让调用者处理错误
    this.logger.warn(
      `[normalizeInput] Could not extract keywords from input: ${JSON.stringify(Object.keys(input))}`,
    );
    return { keywords: [] };
  }
}
