/**
 * AI上下文构建器
 *
 * 为不同类型的资源构建统一、结构化的AI上下文
 * 遵循 docs/AI_CONTEXT_ARCHITECTURE.md 中定义的架构
 */

// ==================== Token估算器 ====================

/**
 * Token估算工具类
 * 使用简化估算：1 token ≈ 4 字符（英文）或 1.5 字符（中文）
 */
class TokenEstimator {
  private static readonly CHARS_PER_TOKEN_EN = 4;
  private static readonly CHARS_PER_TOKEN_ZH = 1.5;

  /**
   * 估算文本的token数量
   */
  static estimate(text: string): number {
    // 检测中文字符比例
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const totalChars = text.length;
    const chineseRatio = chineseChars / totalChars;

    // 混合比例计算
    const avgCharsPerToken =
      this.CHARS_PER_TOKEN_EN * (1 - chineseRatio) +
      this.CHARS_PER_TOKEN_ZH * chineseRatio;

    return Math.ceil(totalChars / avgCharsPerToken);
  }

  /**
   * 根据token限制截断文本
   */
  static truncateToTokens(text: string, maxTokens: number): string {
    const currentTokens = this.estimate(text);
    if (currentTokens <= maxTokens) {
      return text;
    }

    // 估算应保留的字符数
    const ratio = maxTokens / currentTokens;
    const targetLength = Math.floor(text.length * ratio * 0.95); // 留5%余量

    return text.substring(0, targetLength) + '...';
  }
}

// ==================== AI模型配置 ====================

interface ModelTokenLimits {
  contextWindow: number; // 模型上下文窗口
  reservedForResponse: number; // 预留给回复的token
  maxContentTokens: number; // 内容最大token数
}

const MODEL_LIMITS: Record<string, ModelTokenLimits> = {
  grok: {
    contextWindow: 128000,
    reservedForResponse: 4000,
    maxContentTokens: 120000,
  },
  'gpt-4o-mini': {
    contextWindow: 128000,
    reservedForResponse: 4000,
    maxContentTokens: 120000,
  },
  default: {
    contextWindow: 8000,
    reservedForResponse: 2000,
    maxContentTokens: 5000,
  },
};

// ==================== 内容优先级策略 ====================

enum ContentPriority {
  CRITICAL = 1, // 核心内容：标题、摘要
  HIGH = 2, // 高优先级：正文、README
  MEDIUM = 3, // 中优先级：元数据、统计
  LOW = 4, // 低优先级：标签、分类
}

interface ContentSection {
  priority: ContentPriority;
  content: string;
  label: string;
}

// ==================== 类型定义 ====================

export type ResourceType = 'PAPER' | 'PROJECT' | 'NEWS' | 'YOUTUBE_VIDEO';

export interface ResourceContextConfig {
  includeCore: boolean;
  includeMetadata: boolean;
  includeMetrics: boolean;
  includeTaxonomy: boolean;
  maxContentLength: number;
  // Token优化配置
  modelName?: string; // AI模型名称
  enableSmartTruncation?: boolean; // 启用智能截断
  maxTokens?: number; // 最大token数（可选，覆盖模型默认值）
}

export const DEFAULT_CONFIG: ResourceContextConfig = {
  includeCore: true,
  includeMetadata: true,
  includeMetrics: true,
  includeTaxonomy: true,
  maxContentLength: 15000,
  modelName: 'grok',
  enableSmartTruncation: true,
};

// 资源接口定义
export interface BaseResource {
  id: string;
  type: ResourceType;
  title: string;
  sourceUrl?: string;
}

export interface PaperResource extends BaseResource {
  type: 'PAPER';
  abstract?: string;
  pdfText?: string;
  authors?: Array<{ username?: string; platform?: string }>;
  publishedAt?: string;
  categories?: string[];
  qualityScore?: number;
  upvoteCount?: number;
  viewCount?: number;
  tags?: string[];
}

export interface ProjectResource extends BaseResource {
  type: 'PROJECT';
  description?: string;
  readme?: string;
  owner?: string;
  repository?: string;
  language?: string;
  license?: string;
  createdAt?: string;
  updatedAt?: string;
  stars?: number;
  forks?: number;
  issues?: number;
  contributors?: number;
  upvoteCount?: number;
  viewCount?: number;
  topics?: string[];
  tags?: string[];
}

export interface NewsResource extends BaseResource {
  type: 'NEWS';
  fullText?: string;
  summary?: string;
  author?: string;
  publisher?: string;
  publishedAt?: string;
  section?: string;
  readTime?: number;
  upvoteCount?: number;
  viewCount?: number;
  shares?: number;
  categories?: string[];
  tags?: string[];
}

export interface VideoResource extends BaseResource {
  type: 'YOUTUBE_VIDEO';
  transcript?: string;
  description?: string;
  chapters?: Array<{ timestamp: string; title: string }>;
  channel?: string;
  channelId?: string;
  creator?: string;
  publishedAt?: string;
  duration?: string;
  language?: string;
  views?: number;
  likes?: number;
  comments?: number;
  subscribers?: number;
  upvoteCount?: number;
  categories?: string[];
  tags?: string[];
  topics?: string[];
}

export type Resource =
  | PaperResource
  | ProjectResource
  | NewsResource
  | VideoResource;

// ==================== 构建器接口和基类 ====================

interface ContextBuilder {
  build(resource: Resource, config: ResourceContextConfig): string;
}

/**
 * 抽象基类 - 提供通用构建逻辑
 * 遵循Template Method模式
 */
abstract class BaseContextBuilder<
  T extends BaseResource,
> implements ContextBuilder {
  build(resource: T, config: ResourceContextConfig): string {
    // 如果启用智能截断，使用优先级分配
    if (config.enableSmartTruncation) {
      return this.buildWithSmartTruncation(resource, config);
    }

    // 传统构建方式
    return this.buildTraditional(resource, config);
  }

  /**
   * 智能截断构建 - 基于优先级分配token
   */
  private buildWithSmartTruncation(
    resource: T,
    config: ResourceContextConfig
  ): string {
    const modelName = config.modelName || 'default';
    const limits = MODEL_LIMITS[modelName] || MODEL_LIMITS['default'];
    const maxTokens = config.maxTokens || limits.maxContentTokens;

    // 收集所有内容片段
    const contentSections: ContentSection[] = [];

    // 1. Header (CRITICAL)
    const header = this.buildHeader(resource);
    contentSections.push({
      priority: ContentPriority.CRITICAL,
      content: header,
      label: 'Header',
    });

    // 2. Core content (CRITICAL/HIGH)
    if (config.includeCore) {
      const core = this.buildCoreSection(resource, config.maxContentLength);
      if (core) {
        contentSections.push({
          priority: ContentPriority.HIGH,
          content: core,
          label: 'Core',
        });
      }
    }

    // 3. Metadata (MEDIUM)
    if (config.includeMetadata) {
      const metadata = this.buildMetadataSection(resource);
      if (metadata) {
        contentSections.push({
          priority: ContentPriority.MEDIUM,
          content: metadata,
          label: 'Metadata',
        });
      }
    }

    // 4. Metrics (MEDIUM)
    if (config.includeMetrics) {
      const metrics = this.buildMetricsSection(resource);
      if (metrics) {
        contentSections.push({
          priority: ContentPriority.MEDIUM,
          content: metrics,
          label: 'Metrics',
        });
      }
    }

    // 5. Taxonomy (LOW)
    if (config.includeTaxonomy) {
      const taxonomy = this.buildTaxonomySection(resource);
      if (taxonomy) {
        contentSections.push({
          priority: ContentPriority.LOW,
          content: taxonomy,
          label: 'Taxonomy',
        });
      }
    }

    // 6. Source (LOW)
    if (resource.sourceUrl) {
      contentSections.push({
        priority: ContentPriority.LOW,
        content: `SOURCE: ${resource.sourceUrl}`,
        label: 'Source',
      });
    }

    // 按优先级分配token
    return this.allocateTokensByPriority(contentSections, maxTokens);
  }

  /**
   * 按优先级分配token
   */
  private allocateTokensByPriority(
    sections: ContentSection[],
    maxTokens: number
  ): string {
    // 按优先级排序
    sections.sort((a, b) => a.priority - b.priority);

    const result: string[] = [];
    let remainingTokens = maxTokens;

    for (const section of sections) {
      const sectionTokens = TokenEstimator.estimate(section.content);

      if (sectionTokens <= remainingTokens) {
        // 完整包含
        result.push(section.content);
        remainingTokens -= sectionTokens;
      } else if (remainingTokens > 100) {
        // 部分包含（截断）
        const truncated = TokenEstimator.truncateToTokens(
          section.content,
          remainingTokens
        );
        result.push(truncated);
        remainingTokens = 0;
        break;
      } else {
        // Token耗尽
        break;
      }
    }

    return result.join('\n\n');
  }

  /**
   * 传统构建方式（向后兼容）
   */
  private buildTraditional(resource: T, config: ResourceContextConfig): string {
    const sections: string[] = [];

    // Header
    sections.push(this.buildHeader(resource));

    // Core content
    if (config.includeCore) {
      const coreSection = this.buildCoreSection(
        resource,
        config.maxContentLength
      );
      if (coreSection) sections.push(coreSection);
    }

    // Metadata
    if (config.includeMetadata) {
      const metadataSection = this.buildMetadataSection(resource);
      if (metadataSection) sections.push(metadataSection);
    }

    // Metrics
    if (config.includeMetrics) {
      const metricsSection = this.buildMetricsSection(resource);
      if (metricsSection) sections.push(metricsSection);
    }

    // Taxonomy
    if (config.includeTaxonomy) {
      const taxonomySection = this.buildTaxonomySection(resource);
      if (taxonomySection) sections.push(taxonomySection);
    }

    // Source
    if (resource.sourceUrl) {
      sections.push(`SOURCE: ${resource.sourceUrl}`);
    }

    return sections.join('\n\n');
  }

  // Abstract methods - 子类必须实现
  protected abstract buildHeader(resource: T): string;
  protected abstract buildCoreSection(resource: T, maxLength: number): string;

  // Optional methods - 子类可选实现
  protected buildMetadataSection(resource: T): string {
    return '';
  }

  protected buildMetricsSection(resource: T): string {
    return '';
  }

  protected buildTaxonomySection(resource: T): string {
    return '';
  }

  // Helper methods
  protected formatDate(dateString: string | undefined): string {
    return dateString ? new Date(dateString).toLocaleDateString() : 'N/A';
  }

  protected truncateText(text: string, maxLength: number): string {
    return text.length > maxLength ? text.substring(0, maxLength) : text;
  }
}

// ==================== 主入口类 ====================

export class AIContextBuilder {
  /**
   * 主入口：根据资源类型构建上下文
   */
  static buildContext(
    resource: Resource,
    config: ResourceContextConfig = DEFAULT_CONFIG
  ): string {
    const builder = this.getBuilderForType(resource.type);
    return builder.build(resource, config);
  }

  /**
   * 获取对应资源类型的构建器
   */
  private static getBuilderForType(type: ResourceType): ContextBuilder {
    switch (type) {
      case 'PAPER':
        return new PaperContextBuilder();
      case 'PROJECT':
        return new ProjectContextBuilder();
      case 'NEWS':
        return new NewsContextBuilder();
      case 'YOUTUBE_VIDEO':
        return new VideoContextBuilder();
      default:
        return new GenericContextBuilder();
    }
  }
}

// ==================== 论文上下文构建器 ====================

class PaperContextBuilder extends BaseContextBuilder<PaperResource> {
  protected buildHeader(resource: PaperResource): string {
    return '=== RESOURCE TYPE: Academic Paper ===\n';
  }

  protected buildCoreSection(
    resource: PaperResource,
    maxLength: number
  ): string {
    const parts: string[] = ['CORE CONTENT:'];

    parts.push(`Title: ${resource.title}`);

    // Authors - Support both arXiv format (name, affiliation) and GitHub format (username, platform)
    if (resource.authors && resource.authors.length > 0) {
      const authorNames = resource.authors
        .map((a) => {
          if (typeof a === 'object' && a !== null) {
            return (
              ('username' in a && a.username) ||
              ('platform' in a && a.platform) ||
              'Unknown'
            );
          }
          return 'Unknown';
        })
        .join(', ');
      parts.push(`Authors: ${authorNames}`);
    }

    // Published date
    if (resource.publishedAt) {
      parts.push(`Published: ${this.formatDate(resource.publishedAt)}`);
    }

    // Abstract
    if (resource.abstract) {
      parts.push(`\nABSTRACT:\n${resource.abstract}`);
    }

    // PDF full text
    if (resource.pdfText && resource.pdfText.trim()) {
      const truncated = this.truncateText(resource.pdfText, maxLength);
      parts.push(
        `\nPDF FULL TEXT (first ${truncated.length} characters):\n${truncated}`
      );
    }

    return parts.join('\n');
  }

  protected buildMetadataSection(resource: PaperResource): string {
    const parts: string[] = ['METADATA:'];

    if (resource.categories && resource.categories.length > 0) {
      parts.push(`Categories: ${resource.categories.join(', ')}`);
    }

    if (resource.qualityScore) {
      parts.push(`Quality Score: ${resource.qualityScore}/10`);
    }

    return parts.length > 1 ? parts.join('\n') : '';
  }

  protected buildMetricsSection(resource: PaperResource): string {
    const metrics: string[] = [];

    if (resource.upvoteCount) {
      metrics.push(`${resource.upvoteCount} upvotes`);
    }

    if (resource.viewCount) {
      metrics.push(`${resource.viewCount} views`);
    }

    return metrics.length > 0 ? `ENGAGEMENT:\n${metrics.join(', ')}` : '';
  }

  protected buildTaxonomySection(resource: PaperResource): string {
    if (resource.tags && resource.tags.length > 0) {
      return `TAGS: ${resource.tags.join(', ')}`;
    }
    return '';
  }
}

// ==================== 开源项目上下文构建器 ====================

class ProjectContextBuilder implements ContextBuilder {
  build(resource: ProjectResource, config: ResourceContextConfig): string {
    const sections: string[] = [];

    // Header
    sections.push('=== RESOURCE TYPE: Open Source Project ===\n');

    // Core info
    if (config.includeCore) {
      sections.push(this.buildCoreSection(resource, config.maxContentLength));
    }

    // Metadata
    if (config.includeMetadata) {
      sections.push(this.buildMetadataSection(resource));
    }

    // Metrics
    if (config.includeMetrics) {
      sections.push(this.buildMetricsSection(resource));
    }

    // Taxonomy
    if (config.includeTaxonomy) {
      sections.push(this.buildTaxonomySection(resource));
    }

    // Source
    if (resource.sourceUrl) {
      sections.push(`SOURCE: ${resource.sourceUrl}`);
    }

    return sections.join('\n\n');
  }

  private buildCoreSection(
    resource: ProjectResource,
    maxLength: number
  ): string {
    const parts: string[] = ['CORE INFO:'];

    if (resource.owner && resource.repository) {
      parts.push(`Project: ${resource.owner}/${resource.repository}`);
    } else {
      parts.push(`Project: ${resource.title}`);
    }

    if (resource.language) {
      parts.push(`Language: ${resource.language}`);
    }

    if (resource.license) {
      parts.push(`License: ${resource.license}`);
    }

    if (resource.createdAt) {
      parts.push(
        `Created: ${new Date(resource.createdAt).toLocaleDateString()}`
      );
    }

    if (resource.updatedAt) {
      parts.push(
        `Last Updated: ${new Date(resource.updatedAt).toLocaleDateString()}`
      );
    }

    // Description
    if (resource.description) {
      parts.push(`\nDESCRIPTION:\n${resource.description}`);
    }

    // README
    if (resource.readme && resource.readme.trim()) {
      const truncated = resource.readme.substring(0, maxLength);
      parts.push(
        `\nREADME CONTENT (first ${truncated.length} characters):\n${truncated}`
      );
    }

    return parts.join('\n');
  }

  private buildMetadataSection(resource: ProjectResource): string {
    return ''; // Can be extended later
  }

  private buildMetricsSection(resource: ProjectResource): string {
    const metrics: string[] = ['REPOSITORY STATS:'];

    if (resource.stars !== undefined) {
      metrics.push(`⭐ ${resource.stars} stars`);
    }

    if (resource.forks !== undefined) {
      metrics.push(`🍴 ${resource.forks} forks`);
    }

    if (resource.contributors !== undefined) {
      metrics.push(`📊 ${resource.contributors} contributors`);
    }

    if (resource.issues !== undefined) {
      metrics.push(`🐛 ${resource.issues} open issues`);
    }

    if (resource.viewCount) {
      metrics.push(`👁️ ${resource.viewCount} views`);
    }

    if (resource.upvoteCount) {
      metrics.push(`👍 ${resource.upvoteCount} upvotes`);
    }

    return metrics.length > 1 ? metrics.join(' | ') : '';
  }

  private buildTaxonomySection(resource: ProjectResource): string {
    const parts: string[] = [];

    if (resource.topics && resource.topics.length > 0) {
      parts.push(`TOPICS: ${resource.topics.join(', ')}`);
    }

    if (resource.tags && resource.tags.length > 0) {
      parts.push(`TAGS: ${resource.tags.join(', ')}`);
    }

    return parts.join('\n');
  }
}

// ==================== 新闻上下文构建器 ====================

class NewsContextBuilder implements ContextBuilder {
  build(resource: NewsResource, config: ResourceContextConfig): string {
    const sections: string[] = [];

    // Header
    sections.push('=== RESOURCE TYPE: News Article ===\n');

    // Core content
    if (config.includeCore) {
      sections.push(this.buildCoreSection(resource, config.maxContentLength));
    }

    // Metadata
    if (config.includeMetadata) {
      sections.push(this.buildMetadataSection(resource));
    }

    // Metrics
    if (config.includeMetrics) {
      sections.push(this.buildMetricsSection(resource));
    }

    // Taxonomy
    if (config.includeTaxonomy) {
      sections.push(this.buildTaxonomySection(resource));
    }

    // Source
    if (resource.sourceUrl) {
      sections.push(`SOURCE: ${resource.sourceUrl}`);
    }

    return sections.join('\n\n');
  }

  private buildCoreSection(resource: NewsResource, maxLength: number): string {
    const parts: string[] = [];

    parts.push(`HEADLINE: ${resource.title}`);

    if (resource.author) {
      parts.push(`Author: ${resource.author}`);
    }

    if (resource.publisher) {
      parts.push(`Publisher: ${resource.publisher}`);
    }

    if (resource.publishedAt) {
      parts.push(
        `Published: ${new Date(resource.publishedAt).toLocaleDateString()}`
      );
    }

    if (resource.section) {
      parts.push(`Section: ${resource.section}`);
    }

    if (resource.readTime) {
      parts.push(`Reading Time: ~${resource.readTime} minutes`);
    }

    // Summary
    if (resource.summary) {
      parts.push(`\nSUMMARY:\n${resource.summary}`);
    }

    // Full text
    if (resource.fullText && resource.fullText.trim()) {
      const truncated = resource.fullText.substring(0, maxLength);
      parts.push(
        `\nFULL ARTICLE (first ${truncated.length} characters):\n${truncated}`
      );
    }

    return parts.join('\n');
  }

  private buildMetadataSection(resource: NewsResource): string {
    return ''; // Can be extended later
  }

  private buildMetricsSection(resource: NewsResource): string {
    const metrics: string[] = [];

    if (resource.viewCount) {
      metrics.push(`${resource.viewCount} views`);
    }

    if (resource.upvoteCount) {
      metrics.push(`${resource.upvoteCount} upvotes`);
    }

    if (resource.shares) {
      metrics.push(`${resource.shares} shares`);
    }

    return metrics.length > 0 ? `ENGAGEMENT:\n${metrics.join(' | ')}` : '';
  }

  private buildTaxonomySection(resource: NewsResource): string {
    const parts: string[] = [];

    if (resource.categories && resource.categories.length > 0) {
      parts.push(`CATEGORIES: ${resource.categories.join(', ')}`);
    }

    if (resource.tags && resource.tags.length > 0) {
      parts.push(`TAGS: ${resource.tags.join(', ')}`);
    }

    return parts.join('\n');
  }
}

// ==================== 视频上下文构建器 ====================

class VideoContextBuilder implements ContextBuilder {
  build(resource: VideoResource, config: ResourceContextConfig): string {
    const sections: string[] = [];

    // Header
    sections.push('=== RESOURCE TYPE: Video Content ===\n');

    // Core content
    if (config.includeCore) {
      sections.push(this.buildCoreSection(resource, config.maxContentLength));
    }

    // Metadata
    if (config.includeMetadata) {
      sections.push(this.buildMetadataSection(resource));
    }

    // Metrics
    if (config.includeMetrics) {
      sections.push(this.buildMetricsSection(resource));
    }

    // Taxonomy
    if (config.includeTaxonomy) {
      sections.push(this.buildTaxonomySection(resource));
    }

    // Source
    if (resource.sourceUrl) {
      sections.push(`SOURCE: ${resource.sourceUrl}`);
    }

    return sections.join('\n\n');
  }

  private buildCoreSection(resource: VideoResource, maxLength: number): string {
    const parts: string[] = [];

    parts.push(`VIDEO: ${resource.title}`);

    if (resource.channel) {
      const channelInfo = resource.subscribers
        ? `${resource.channel} (${resource.subscribers} subscribers)`
        : resource.channel;
      parts.push(`Channel: ${channelInfo}`);
    }

    if (resource.creator) {
      parts.push(`Creator: ${resource.creator}`);
    }

    if (resource.publishedAt) {
      parts.push(
        `Published: ${new Date(resource.publishedAt).toLocaleDateString()}`
      );
    }

    if (resource.duration) {
      parts.push(`Duration: ${resource.duration}`);
    }

    if (resource.language) {
      parts.push(`Language: ${resource.language}`);
    }

    // Description
    if (resource.description) {
      parts.push(`\nDESCRIPTION:\n${resource.description}`);
    }

    // Chapters
    if (resource.chapters && resource.chapters.length > 0) {
      parts.push('\nCHAPTERS:');
      resource.chapters.forEach((chapter) => {
        parts.push(`${chapter.timestamp} - ${chapter.title}`);
      });
    }

    // Transcript
    if (resource.transcript && resource.transcript.trim()) {
      const truncated = resource.transcript.substring(0, maxLength);
      parts.push(
        `\nVIDEO TRANSCRIPT (first ${truncated.length} characters):\n${truncated}`
      );
    }

    return parts.join('\n');
  }

  private buildMetadataSection(resource: VideoResource): string {
    return ''; // Can be extended later
  }

  private buildMetricsSection(resource: VideoResource): string {
    const metrics: string[] = ['ENGAGEMENT:'];

    if (resource.views) {
      metrics.push(`👁️ ${resource.views} views`);
    }

    if (resource.likes) {
      metrics.push(`👍 ${resource.likes} likes`);
    }

    if (resource.comments) {
      metrics.push(`💬 ${resource.comments} comments`);
    }

    if (resource.upvoteCount) {
      metrics.push(`⭐ ${resource.upvoteCount} upvotes (internal)`);
    }

    return metrics.length > 1 ? metrics.join(' | ') : '';
  }

  private buildTaxonomySection(resource: VideoResource): string {
    const parts: string[] = [];

    if (resource.topics && resource.topics.length > 0) {
      parts.push(`TOPICS: ${resource.topics.join(', ')}`);
    }

    if (resource.categories && resource.categories.length > 0) {
      parts.push(`CATEGORIES: ${resource.categories.join(', ')}`);
    }

    if (resource.tags && resource.tags.length > 0) {
      parts.push(`TAGS: ${resource.tags.join(', ')}`);
    }

    return parts.join('\n');
  }
}

// ==================== 通用构建器（兜底） ====================

class GenericContextBuilder implements ContextBuilder {
  build(resource: Resource, config: ResourceContextConfig): string {
    return `=== RESOURCE: ${resource.title} ===\n\nType: ${resource.type}\nSource: ${resource.sourceUrl || 'N/A'}`;
  }
}
