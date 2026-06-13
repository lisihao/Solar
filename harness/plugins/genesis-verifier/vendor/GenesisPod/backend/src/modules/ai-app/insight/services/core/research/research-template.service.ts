/**
 * Research Template Service
 *
 * P1: 研究模板库
 * 提供行业/场景预设模板，快速启动不同类型的研究
 *
 * 核心功能：
 * 1. 内置模板管理（竞品分析、市场调研、技术评估等）
 * 2. 模板应用（参数填充 → 自动生成维度和配置）
 * 3. 自定义模板保存和复用
 * 4. 模板推荐（根据话题自动推荐合适模板）
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType, Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  TemplateCategory,
  TemplateDimension,
  ResearchTemplate,
  TemplateApplicationResult,
} from "../../../types/research-template.types";

@Injectable()
export class ResearchTemplateService {
  private readonly logger = new Logger(ResearchTemplateService.name);

  /** 内置模板库 */
  private readonly builtInTemplates: ResearchTemplate[] = [
    // =========================================================================
    // 竞品分析模板
    // =========================================================================
    {
      id: "competitive-analysis",
      name: "Competitive Analysis",
      description:
        "全面的竞品分析框架，对比产品功能、市场地位、用户口碑、技术架构",
      category: TemplateCategory.COMPETITIVE_ANALYSIS,
      tags: ["business", "product", "strategy"],
      dimensions: [
        {
          name: "Market Position & Strategy",
          description: "分析各竞品的市场定位、目标客户、定价策略和品牌差异化",
          queryTemplates: [
            "{company} market position strategy",
            "{company} vs {competitor} comparison",
          ],
          sources: ["web", "hackernews"],
          required: true,
          weight: 1.0,
        },
        {
          name: "Product & Features",
          description: "对比核心功能、产品路线图、技术栈和用户体验",
          queryTemplates: [
            "{company} product features review",
            "{company} technology stack architecture",
          ],
          sources: ["web", "github", "hackernews"],
          required: true,
          weight: 0.9,
        },
        {
          name: "Financial & Growth",
          description: "营收、融资、用户增长、市场份额数据",
          queryTemplates: [
            "{company} revenue growth funding",
            "{company} market share users",
          ],
          sources: ["web", "finance-api"],
          required: false,
          weight: 0.7,
        },
        {
          name: "User Sentiment & Reviews",
          description: "用户评价、社区反馈、NPS 和满意度分析",
          queryTemplates: [
            "{company} user reviews feedback",
            "{company} customer satisfaction",
          ],
          sources: ["web", "social-x", "hackernews"],
          required: false,
          weight: 0.6,
        },
      ],
      recommendedSources: ["web", "hackernews", "github", "social-x"],
      recommendedDepth: "deep",
      parameters: [
        {
          key: "company",
          label: "Target Company",
          type: "text",
          required: true,
          placeholder: "e.g., OpenAI",
        },
        {
          key: "competitor",
          label: "Primary Competitor",
          type: "text",
          required: false,
          placeholder: "e.g., Anthropic",
        },
        {
          key: "industry",
          label: "Industry",
          type: "text",
          required: false,
          placeholder: "e.g., AI/ML",
        },
      ],
      guidancePrompt:
        "Focus on factual data and quantifiable metrics. Compare features side by side. Identify key differentiators and competitive moats.",
      reportStructure: {
        titleTemplate: "Competitive Analysis: {company}",
        sections: [
          {
            title: "Executive Summary",
            description: "Key findings overview",
            required: true,
          },
          {
            title: "Market Landscape",
            description: "Industry context",
            required: true,
          },
          {
            title: "Product Comparison",
            description: "Feature matrix",
            required: true,
          },
          {
            title: "SWOT Analysis",
            description: "Strengths/Weaknesses/Opportunities/Threats",
            required: true,
          },
          {
            title: "Recommendations",
            description: "Strategic recommendations",
            required: true,
          },
        ],
        includeExecutiveSummary: true,
        includeCredibilityReport: true,
        includeBibliography: true,
      },
      usageCount: 0,
      isBuiltIn: true,
    },

    // =========================================================================
    // 市场调研模板
    // =========================================================================
    {
      id: "market-research",
      name: "Market Research",
      description: "市场规模、增长趋势、主要参与者、用户需求和市场机会分析",
      category: TemplateCategory.MARKET_RESEARCH,
      tags: ["market", "business", "investment"],
      dimensions: [
        {
          name: "Market Size & Growth",
          description: "市场总规模、增长率、细分市场数据",
          queryTemplates: [
            "{market} market size growth forecast",
            "{market} industry report 2024 2025",
          ],
          sources: ["web", "academic"],
          required: true,
          weight: 1.0,
        },
        {
          name: "Key Players & Ecosystem",
          description: "主要参与者、市场份额、价值链分析",
          queryTemplates: [
            "{market} major companies market share",
            "{market} ecosystem value chain",
          ],
          sources: ["web", "finance-api"],
          required: true,
          weight: 0.9,
        },
        {
          name: "Trends & Drivers",
          description: "市场驱动因素、技术趋势、监管变化",
          queryTemplates: [
            "{market} trends drivers challenges",
            "{market} technology innovation",
          ],
          sources: ["web", "academic", "hackernews"],
          required: true,
          weight: 0.8,
        },
        {
          name: "Customer Insights",
          description: "用户需求、消费行为、痛点分析",
          queryTemplates: [
            "{market} customer needs preferences",
            "{market} user behavior analysis",
          ],
          sources: ["web", "social-x"],
          required: false,
          weight: 0.6,
        },
      ],
      recommendedSources: ["web", "academic", "finance-api"],
      recommendedDepth: "deep",
      parameters: [
        {
          key: "market",
          label: "Market/Industry",
          type: "text",
          required: true,
          placeholder: "e.g., Electric Vehicle Market",
        },
        {
          key: "region",
          label: "Geographic Focus",
          type: "select",
          required: false,
          options: [
            { label: "Global", value: "global" },
            { label: "North America", value: "north-america" },
            { label: "Europe", value: "europe" },
            { label: "Asia Pacific", value: "asia-pacific" },
            { label: "China", value: "china" },
          ],
        },
      ],
      guidancePrompt:
        "Prioritize quantitative data, market reports, and verifiable statistics. Include both bull and bear perspectives.",
      usageCount: 0,
      isBuiltIn: true,
    },

    // =========================================================================
    // 技术评估模板
    // =========================================================================
    {
      id: "technology-evaluation",
      name: "Technology Evaluation",
      description: "技术成熟度、生态系统、性能对比、采用趋势和最佳实践",
      category: TemplateCategory.TECHNOLOGY_EVALUATION,
      tags: ["technology", "engineering", "architecture"],
      dimensions: [
        {
          name: "Technical Architecture & Design",
          description: "技术架构、设计原理、核心创新点",
          queryTemplates: [
            "{technology} architecture design principles",
            "{technology} technical deep dive",
          ],
          sources: ["web", "academic", "github"],
          required: true,
          weight: 1.0,
        },
        {
          name: "Ecosystem & Adoption",
          description: "生态系统成熟度、社区活跃度、企业采用案例",
          queryTemplates: [
            "{technology} ecosystem community adoption",
            "{technology} enterprise use cases",
          ],
          sources: ["github", "hackernews", "web"],
          required: true,
          weight: 0.9,
        },
        {
          name: "Performance & Benchmarks",
          description: "性能基准、对比测试、资源消耗",
          queryTemplates: [
            "{technology} benchmark performance comparison",
            "{technology} scalability limitations",
          ],
          sources: ["web", "academic", "github"],
          required: true,
          weight: 0.8,
        },
        {
          name: "Alternatives & Migration",
          description: "替代方案对比、迁移路径、决策矩阵",
          queryTemplates: [
            "{technology} alternatives comparison",
            "{technology} vs {alternative} migration",
          ],
          sources: ["web", "hackernews"],
          required: false,
          weight: 0.7,
        },
      ],
      recommendedSources: ["web", "academic", "github", "hackernews"],
      recommendedDepth: "deep",
      parameters: [
        {
          key: "technology",
          label: "Technology",
          type: "text",
          required: true,
          placeholder: "e.g., Rust programming language",
        },
        {
          key: "alternative",
          label: "Alternative Technology",
          type: "text",
          required: false,
          placeholder: "e.g., Go",
        },
        {
          key: "useCase",
          label: "Use Case",
          type: "text",
          required: false,
          placeholder: "e.g., Backend microservices",
        },
      ],
      guidancePrompt:
        "Focus on technical accuracy. Include code examples where relevant. Compare objectively with alternatives.",
      usageCount: 0,
      isBuiltIn: true,
    },

    // =========================================================================
    // 政策分析模板
    // =========================================================================
    {
      id: "policy-analysis",
      name: "Policy Analysis",
      description: "政策法规分析、影响评估、利益相关者分析、合规指南",
      category: TemplateCategory.POLICY_ANALYSIS,
      tags: ["policy", "regulation", "compliance", "government"],
      dimensions: [
        {
          name: "Policy Overview & Background",
          description: "政策/法规背景、立法进程、关键条款",
          queryTemplates: [
            "{policy} regulation overview background",
            "{policy} legislation history",
          ],
          sources: [
            "web",
            "federal-register",
            "congress-gov",
            "whitehouse-news",
          ],
          required: true,
          weight: 1.0,
        },
        {
          name: "Impact Analysis",
          description: "对产业、企业、消费者的影响评估",
          queryTemplates: [
            "{policy} impact analysis industry",
            "{policy} economic consequences",
          ],
          sources: ["web", "academic"],
          required: true,
          weight: 0.9,
        },
        {
          name: "Stakeholder Perspectives",
          description: "各利益相关方立场、公众舆论、行业回应",
          queryTemplates: [
            "{policy} stakeholder opinions reactions",
            "{policy} industry response public opinion",
          ],
          sources: ["web", "social-x", "hackernews"],
          required: true,
          weight: 0.8,
        },
        {
          name: "Compliance & Implementation",
          description: "合规要求、实施时间线、最佳实践",
          queryTemplates: [
            "{policy} compliance requirements guide",
            "{policy} implementation timeline",
          ],
          sources: ["web", "federal-register"],
          required: false,
          weight: 0.7,
        },
      ],
      recommendedSources: [
        "web",
        "federal-register",
        "congress-gov",
        "whitehouse-news",
        "academic",
      ],
      recommendedDepth: "comprehensive",
      parameters: [
        {
          key: "policy",
          label: "Policy/Regulation",
          type: "text",
          required: true,
          placeholder: "e.g., EU AI Act",
        },
        {
          key: "jurisdiction",
          label: "Jurisdiction",
          type: "select",
          required: false,
          options: [
            { label: "United States", value: "us" },
            { label: "European Union", value: "eu" },
            { label: "China", value: "china" },
            { label: "Global", value: "global" },
          ],
        },
      ],
      guidancePrompt:
        "Reference official documents and legislative texts. Present balanced perspectives. Include timeline of key dates.",
      usageCount: 0,
      isBuiltIn: true,
    },

    // =========================================================================
    // 学术文献综述模板
    // =========================================================================
    {
      id: "literature-review",
      name: "Literature Review",
      description:
        "系统性文献综述，包括研究现状、方法论分析、主要发现和研究缺口",
      category: TemplateCategory.LITERATURE_REVIEW,
      tags: ["academic", "research", "literature"],
      dimensions: [
        {
          name: "Research Landscape",
          description: "研究领域概述、主要研究方向、时间脉络",
          queryTemplates: [
            "{topic} research survey overview",
            "{topic} systematic review",
          ],
          sources: ["academic", "semantic-scholar", "pubmed"],
          required: true,
          weight: 1.0,
        },
        {
          name: "Methodology Analysis",
          description: "主要研究方法、实验设计、数据来源",
          queryTemplates: [
            "{topic} methodology approach technique",
            "{topic} experimental design dataset",
          ],
          sources: ["academic", "semantic-scholar"],
          required: true,
          weight: 0.9,
        },
        {
          name: "Key Findings & Debates",
          description: "主要发现、学术争议、对立观点",
          queryTemplates: [
            "{topic} findings results state of the art",
            "{topic} challenges limitations debate",
          ],
          sources: ["academic", "semantic-scholar"],
          required: true,
          weight: 0.9,
        },
        {
          name: "Research Gaps & Future Directions",
          description: "研究缺口、未来方向、开放问题",
          queryTemplates: [
            "{topic} research gaps future work",
            "{topic} open problems directions",
          ],
          sources: ["academic", "semantic-scholar"],
          required: true,
          weight: 0.8,
        },
      ],
      recommendedSources: ["academic", "semantic-scholar", "pubmed"],
      recommendedDepth: "comprehensive",
      parameters: [
        {
          key: "topic",
          label: "Research Topic",
          type: "text",
          required: true,
          placeholder: "e.g., Large Language Model Alignment",
        },
        {
          key: "timeframe",
          label: "Time Frame",
          type: "select",
          required: false,
          options: [
            { label: "Last Year", value: "1y" },
            { label: "Last 3 Years", value: "3y" },
            { label: "Last 5 Years", value: "5y" },
            { label: "All Time", value: "all" },
          ],
        },
      ],
      guidancePrompt:
        "Cite specific papers and authors. Follow academic review conventions. Include citation counts and impact metrics where available.",
      reportStructure: {
        titleTemplate: "Literature Review: {topic}",
        sections: [
          {
            title: "Introduction",
            description: "Research context",
            required: true,
          },
          {
            title: "Methodology",
            description: "Review methodology",
            required: true,
          },
          {
            title: "Findings",
            description: "Thematic analysis",
            required: true,
          },
          {
            title: "Discussion",
            description: "Synthesis and gaps",
            required: true,
          },
          {
            title: "Conclusion",
            description: "Summary and future work",
            required: true,
          },
        ],
        includeExecutiveSummary: true,
        includeCredibilityReport: true,
        includeBibliography: true,
      },
      usageCount: 0,
      isBuiltIn: true,
    },
  ];

  /** 用户自定义模板（内存缓存，可持久化） */
  private readonly customTemplates = new Map<string, ResearchTemplate>();

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 获取所有可用模板
   */
  getTemplates(category?: TemplateCategory): ResearchTemplate[] {
    const all = [
      ...this.builtInTemplates,
      ...Array.from(this.customTemplates.values()),
    ];

    if (category) {
      return all.filter((t) => t.category === category);
    }

    return all;
  }

  /**
   * 获取单个模板 (checks DB first, then falls back to in-memory)
   */
  getTemplate(templateId: string): ResearchTemplate | undefined {
    return (
      this.builtInTemplates.find((t) => t.id === templateId) ||
      this.customTemplates.get(templateId)
    );
  }

  /**
   * 获取单个模板 (async version, checks DB first)
   */
  async getTemplateAsync(
    templateId: string,
  ): Promise<ResearchTemplate | undefined> {
    try {
      const dbTemplate = await this.prisma.researchTemplate.findUnique({
        where: { templateId },
      });
      if (dbTemplate) {
        return this.dbTemplateToResearchTemplate(dbTemplate);
      }
    } catch (error) {
      this.logger.warn(
        `[getTemplateAsync] DB lookup failed, falling back to in-memory: ${error}`,
      );
    }
    return this.getTemplate(templateId);
  }

  /**
   * 应用模板生成研究配置
   */
  applyTemplate(
    templateId: string,
    params: Record<string, string>,
  ): TemplateApplicationResult | null {
    const template = this.getTemplate(templateId);
    if (!template) {
      this.logger.warn(`[applyTemplate] Template not found: ${templateId}`);
      return null;
    }

    // 验证必填参数
    for (const param of template.parameters) {
      if (param.required && !params[param.key]) {
        this.logger.warn(
          `[applyTemplate] Missing required parameter: ${param.key}`,
        );
        return null;
      }
    }

    // 替换维度中的参数占位符
    const dimensions = template.dimensions.map((dim) => ({
      name: this.replaceParams(dim.name, params),
      description: this.replaceParams(dim.description, params),
      searchQueries: dim.queryTemplates.map((q) =>
        this.replaceParams(q, params),
      ),
      searchSources: dim.sources,
    }));

    // 生成话题名称
    const topicName = template.reportStructure?.titleTemplate
      ? this.replaceParams(template.reportStructure.titleTemplate, params)
      : `${template.name}: ${params[template.parameters[0]?.key] || "Research"}`;

    return {
      topicName,
      dimensions,
      researchConfig: {
        depth: template.recommendedDepth,
        sources: template.recommendedSources,
        guidancePrompt: this.replaceParams(template.guidancePrompt, params),
      },
    };
  }

  /**
   * 根据话题描述推荐模板
   */
  async recommendTemplate(
    topicDescription: string,
  ): Promise<
    Array<{ template: ResearchTemplate; score: number; reason: string }>
  > {
    try {
      const templateSummaries = this.builtInTemplates
        .map((t) => `- ${t.id}: ${t.name} - ${t.description}`)
        .join("\n");

      const response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: `You are a research template recommender. Given a topic description, recommend the most suitable templates from the available list.

Available templates:
${templateSummaries}

Return JSON array: [{ "templateId": "...", "score": 0.9, "reason": "..." }]
Score from 0-1, recommend up to 3 templates.`,
          },
          {
            role: "user",
            content: topicDescription,
          },
        ],
        operationName: "模板匹配",
        modelType: AIModelType.CHAT,
        skipGuardrails: true, // 内部系统调用，模板推荐
        taskProfile: { creativity: "low", outputLength: "short" },
      });

      const parsed = this.parseJsonArray(response.content || "");
      return parsed
        .map((item: Record<string, unknown>) => ({
          template: this.getTemplate(item.templateId as string)!,
          score: item.score as number,
          reason: item.reason as string,
        }))
        .filter(
          (item: { template: ResearchTemplate | undefined }) => item.template,
        );
    } catch (error) {
      this.logger.error(`[recommendTemplate] Failed: ${error}`);
      return [];
    }
  }

  /**
   * 保存自定义模板
   */
  saveCustomTemplate(template: ResearchTemplate): void {
    template.isBuiltIn = false;
    this.customTemplates.set(template.id, template);
    this.logger.log(`[saveCustomTemplate] Saved template: ${template.id}`);
  }

  /**
   * 获取模板分类列表
   */
  getCategories(): Array<{ category: TemplateCategory; count: number }> {
    const counts = new Map<TemplateCategory, number>();
    for (const t of this.getTemplates()) {
      counts.set(t.category, (counts.get(t.category) || 0) + 1);
    }

    return Array.from(counts.entries()).map(([category, count]) => ({
      category,
      count,
    }));
  }

  // =========================================================================
  // DB-Backed Template Management
  // =========================================================================

  /**
   * Sync built-in templates to database as isBuiltIn: true
   * Idempotent - skips templates that already exist in DB
   */
  async syncBuiltInTemplates(): Promise<number> {
    let synced = 0;
    for (const template of this.builtInTemplates) {
      const existing = await this.prisma.researchTemplate.findUnique({
        where: { templateId: template.id },
      });
      if (!existing) {
        await this.prisma.researchTemplate.create({
          data: {
            templateId: template.id,
            name: template.name,
            description: template.description,
            category: template.category,
            dimensions: template.dimensions as unknown as Prisma.InputJsonValue,
            dataSources: template.recommendedSources,
            guidancePrompt: template.guidancePrompt,
            reportStructure:
              template.reportStructure as unknown as Prisma.InputJsonValue,
            iterationCount: 3,
            enabled: true,
            isBuiltIn: true,
          },
        });
        synced++;
      }
    }
    this.logger.log(`[syncBuiltInTemplates] Synced ${synced} templates to DB`);
    return synced;
  }

  /**
   * Create a custom template in the database
   */
  async createCustomTemplate(data: {
    templateId: string;
    name: string;
    description?: string;
    category: string;
    dimensions: Prisma.InputJsonValue;
    dataSources?: string[];
    guidancePrompt?: string;
    reportStructure?: Prisma.InputJsonValue;
    iterationCount?: number;
  }) {
    return this.prisma.researchTemplate.create({
      data: {
        templateId: data.templateId,
        name: data.name,
        description: data.description,
        category: data.category,
        dimensions: data.dimensions,
        dataSources: data.dataSources ?? [],
        guidancePrompt: data.guidancePrompt,
        reportStructure: data.reportStructure,
        iterationCount: data.iterationCount ?? 3,
        enabled: true,
        isBuiltIn: false,
      },
    });
  }

  /**
   * Update a template in the database
   */
  async updateTemplate(
    templateId: string,
    data: Partial<{
      name: string;
      description: string;
      category: string;
      dimensions: Prisma.InputJsonValue;
      dataSources: string[];
      guidancePrompt: string;
      reportStructure: Prisma.InputJsonValue;
      iterationCount: number;
      enabled: boolean;
    }>,
  ) {
    return this.prisma.researchTemplate.update({
      where: { templateId },
      data: data as Prisma.ResearchTemplateUpdateInput,
    });
  }

  /**
   * Convert a DB research template record to the in-memory ResearchTemplate type
   */
  private dbTemplateToResearchTemplate(
    dbTemplate: Record<string, unknown>,
  ): ResearchTemplate {
    const dimensions = dbTemplate.dimensions;
    return {
      id: dbTemplate.templateId as string,
      name: dbTemplate.name as string,
      description: (dbTemplate.description as string) || "",
      category: dbTemplate.category as TemplateCategory,
      tags: [],
      dimensions: Array.isArray(dimensions)
        ? (dimensions as TemplateDimension[])
        : [],
      recommendedSources: (dbTemplate.dataSources as string[]) || [],
      recommendedDepth: "deep",
      parameters: [],
      guidancePrompt: (dbTemplate.guidancePrompt as string) || "",
      reportStructure: dbTemplate.reportStructure as
        | ResearchTemplate["reportStructure"]
        | undefined,
      usageCount: (dbTemplate.usageCount as number) || 0,
      isBuiltIn: (dbTemplate.isBuiltIn as boolean) || false,
    };
  }

  // =========================================================================
  // Helper Methods
  // =========================================================================

  private replaceParams(
    template: string,
    params: Record<string, string>,
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    }
    return result;
  }

  private parseJsonArray(content: string): Array<Record<string, unknown>> {
    try {
      const jsonMatch =
        content.match(/```json\s*([\s\S]*?)```/) ||
        content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
