import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { TaskProfile } from "@/modules/ai-harness/facade";

export interface FileInfo {
  id: string;
  name: string;
  mimeType?: string;
  content?: string;
  description?: string;
  size?: number;
  createdAt?: Date;
  modifiedAt?: Date;
  source: "google_drive" | "notion" | "library";
}

export interface CategorySuggestion {
  category: string;
  confidence: number;
  reason: string;
}

export interface TagSuggestion {
  tag: string;
  confidence: number;
  reason: string;
}

export interface FolderSuggestion {
  folderPath: string;
  confidence: number;
  reason: string;
}

export interface OrganizationSuggestion {
  fileId: string;
  fileName: string;
  categories: CategorySuggestion[];
  tags: TagSuggestion[];
  suggestedFolder: FolderSuggestion | null;
  summary: string;
  relatedFiles?: string[];
}

export interface BatchOrganizationResult {
  success: boolean;
  suggestions: OrganizationSuggestion[];
  totalFiles: number;
  processedFiles: number;
  errors: Array<{ fileId: string; error: string }>;
}

@Injectable()
export class AiFileOrganizerService {
  private readonly logger = new Logger(AiFileOrganizerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 分析单个文件并生成整理建议
   */
  async analyzeFile(file: FileInfo): Promise<OrganizationSuggestion> {
    this.logger.log(`Analyzing file: ${file.name}`);

    const prompt = this.buildAnalysisPrompt(file);

    try {
      // 定义任务配置：文件分类任务，需要低创意度和短输出
      const taskProfile: TaskProfile = {
        creativity: "low", // temperature: 0.3 - 分析任务
        outputLength: "short", // maxTokens: 1500
      };

      const result = await this.chatFacade.chat({
        messages: [
          { role: "system", content: this.getSystemPrompt() },
          { role: "user", content: prompt },
        ],
        taskProfile,
      });

      const suggestion = this.parseAIResponse(result.content, file);
      return suggestion;
    } catch (error) {
      this.logger.error(`Failed to analyze file ${file.name}: ${error}`);
      return this.getDefaultSuggestion(file);
    }
  }

  /**
   * 批量分析文件并生成整理建议
   */
  async batchAnalyze(files: FileInfo[]): Promise<BatchOrganizationResult> {
    this.logger.log(`Batch analyzing ${files.length} files`);

    const result: BatchOrganizationResult = {
      success: true,
      suggestions: [],
      totalFiles: files.length,
      processedFiles: 0,
      errors: [],
    };

    // 分批处理，每批最多5个文件
    const batchSize = 5;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      // 并行处理每批
      const batchResults = await Promise.allSettled(
        batch.map((file) => this.analyzeFile(file)),
      );

      for (let j = 0; j < batchResults.length; j++) {
        const fileResult = batchResults[j];
        const file = batch[j];

        if (fileResult.status === "fulfilled") {
          result.suggestions.push(fileResult.value);
          result.processedFiles++;
        } else {
          result.errors.push({
            fileId: file.id,
            error: fileResult.reason?.message || "Analysis failed",
          });
        }
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  /**
   * 获取现有的分类列表（用于一致性）
   */
  async getExistingCategories(): Promise<string[]> {
    const resources = await this.prisma.resource.findMany({
      select: { type: true },
      distinct: ["type"],
    });

    return resources.map((r) => r.type).filter(Boolean);
  }

  /**
   * 获取现有的标签列表
   */
  async getExistingTags(): Promise<string[]> {
    const resources = await this.prisma.resource.findMany({
      where: {
        NOT: {
          tags: { equals: [] },
        },
      },
      select: { tags: true },
    });

    const allTags = new Set<string>();
    resources.forEach((r) => {
      if (r.tags && Array.isArray(r.tags)) {
        r.tags.forEach((tag) => allTags.add(tag as string));
      }
    });

    return Array.from(allTags);
  }

  // Valid ResourceType enum values from Prisma schema
  private readonly VALID_RESOURCE_TYPES = [
    "PAPER",
    "BLOG",
    "REPORT",
    "YOUTUBE_VIDEO",
    "NEWS",
    "PROJECT",
    "EVENT",
    "RSS",
    "POLICY",
  ];

  // Map AI-suggested categories to valid ResourceType values
  private mapCategoryToResourceType(category: string): string | null {
    const categoryMap: Record<string, string> = {
      // Direct mappings
      paper: "PAPER",
      blog: "BLOG",
      report: "REPORT",
      news: "NEWS",
      policy: "POLICY",
      video: "YOUTUBE_VIDEO",
      youtube: "YOUTUBE_VIDEO",
      // Indirect mappings
      article: "BLOG",
      document: "REPORT",
      research: "PAPER",
      study: "PAPER",
      analysis: "REPORT",
      presentation: "REPORT",
      spreadsheet: "REPORT",
    };

    const normalizedCategory = category.toLowerCase().trim();

    // Check direct mapping
    if (categoryMap[normalizedCategory]) {
      return categoryMap[normalizedCategory];
    }

    // Check if it's already a valid type (case-insensitive)
    const upperCategory = normalizedCategory.toUpperCase();
    if (this.VALID_RESOURCE_TYPES.includes(upperCategory)) {
      return upperCategory;
    }

    // No valid mapping found
    return null;
  }

  /**
   * 应用整理建议到资源
   */
  async applySuggestion(
    resourceId: string,
    suggestion: Partial<OrganizationSuggestion>,
  ): Promise<void> {
    const updates: Record<string, unknown> = {};

    if (suggestion.categories && suggestion.categories.length > 0) {
      // 使用置信度最高的分类
      const topCategory = suggestion.categories.reduce((a, b) =>
        a.confidence > b.confidence ? a : b,
      );

      // Map to valid ResourceType - only update if valid mapping exists
      const mappedType = this.mapCategoryToResourceType(topCategory.category);
      if (mappedType) {
        updates.type = mappedType;
      } else {
        this.logger.warn(
          `Skipping type update: "${topCategory.category}" is not a valid ResourceType`,
        );
      }
    }

    if (suggestion.tags && suggestion.tags.length > 0) {
      // 使用置信度 > 0.7 的标签
      const highConfidenceTags = suggestion.tags
        .filter((t) => t.confidence > 0.7)
        .map((t) => t.tag);
      if (highConfidenceTags.length > 0) {
        updates.tags = highConfidenceTags;
      }
    }

    if (suggestion.summary) {
      updates.abstract = suggestion.summary;
    }

    if (Object.keys(updates).length > 0) {
      await this.prisma.resource.update({
        where: { id: resourceId },
        data: updates,
      });
      this.logger.log(`Applied suggestions to resource ${resourceId}`);
    }
  }

  /**
   * 查找相关文件
   */
  async findRelatedFiles(
    file: FileInfo,
    limit = 5,
  ): Promise<Array<{ id: string; title: string; similarity: number }>> {
    // 简单实现：基于标题关键词搜索
    const keywords = this.extractKeywords(file.name);

    if (keywords.length === 0) {
      return [];
    }

    const resources = await this.prisma.resource.findMany({
      where: {
        OR: keywords.map((keyword) => ({
          title: { contains: keyword, mode: "insensitive" as const },
        })),
      },
      select: {
        id: true,
        title: true,
      },
      take: limit,
    });

    return resources.map((r, index) => ({
      id: r.id,
      title: r.title,
      similarity: 1 - index * 0.1, // 简单的相似度模拟
    }));
  }

  private getSystemPrompt(): string {
    return `You are an AI assistant specialized in file organization and categorization.
Your task is to analyze files and suggest:
1. Categories (e.g., article, paper, report, note, code, image, etc.)
2. Tags (relevant keywords)
3. A brief summary (1-2 sentences)
4. Suggested folder path for organization

Respond in JSON format:
{
  "categories": [{"category": "string", "confidence": 0.0-1.0, "reason": "string"}],
  "tags": [{"tag": "string", "confidence": 0.0-1.0, "reason": "string"}],
  "suggestedFolder": {"folderPath": "string", "confidence": 0.0-1.0, "reason": "string"},
  "summary": "string"
}

Be concise and accurate. Focus on the most relevant categories and tags.`;
  }

  private buildAnalysisPrompt(file: FileInfo): string {
    let prompt = `Analyze this file and provide organization suggestions:\n\n`;
    prompt += `File Name: ${file.name}\n`;

    if (file.mimeType) {
      prompt += `MIME Type: ${file.mimeType}\n`;
    }

    if (file.description) {
      prompt += `Description: ${file.description}\n`;
    }

    if (file.content) {
      // 限制内容长度
      const truncatedContent = file.content.slice(0, 2000);
      prompt += `\nContent Preview:\n${truncatedContent}`;
      if (file.content.length > 2000) {
        prompt += "\n[Content truncated...]";
      }
    }

    prompt += `\n\nSource: ${file.source}`;

    return prompt;
  }

  private parseAIResponse(
    response: string,
    file: FileInfo,
  ): OrganizationSuggestion {
    try {
      // 尝试提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.getDefaultSuggestion(file);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        fileId: file.id,
        fileName: file.name,
        categories: parsed.categories || [],
        tags: parsed.tags || [],
        suggestedFolder: parsed.suggestedFolder || null,
        summary: parsed.summary || "",
        relatedFiles: [],
      };
    } catch {
      this.logger.warn(`Failed to parse AI response for file ${file.name}`);
      return this.getDefaultSuggestion(file);
    }
  }

  private getDefaultSuggestion(file: FileInfo): OrganizationSuggestion {
    // 基于文件扩展名的默认分类 - 使用有效的 ResourceType 值
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const categoryMap: Record<string, string> = {
      // Documents -> REPORT (closest match)
      pdf: "REPORT",
      doc: "REPORT",
      docx: "REPORT",
      // Text files -> BLOG
      txt: "BLOG",
      md: "BLOG",
      // Video -> YOUTUBE_VIDEO
      mp4: "YOUTUBE_VIDEO",
      mov: "YOUTUBE_VIDEO",
      avi: "YOUTUBE_VIDEO",
      // Spreadsheets/Presentations -> REPORT
      xlsx: "REPORT",
      xls: "REPORT",
      pptx: "REPORT",
      ppt: "REPORT",
      // Research papers
      tex: "PAPER",
    };

    // Get mapped category or null if no valid mapping
    const category = categoryMap[ext] || null;

    return {
      fileId: file.id,
      fileName: file.name,
      categories: category
        ? [
            {
              category,
              confidence: 0.5,
              reason: `Based on file extension .${ext}`,
            },
          ]
        : [], // Empty array if no valid category mapping
      tags: [],
      suggestedFolder: null,
      summary: "",
      relatedFiles: [],
    };
  }

  private extractKeywords(text: string): string[] {
    // 简单的关键词提取
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    // 去重并返回前5个
    return [...new Set(words)].slice(0, 5);
  }
}
