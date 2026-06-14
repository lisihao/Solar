/**
 * Slides Engine v5.0 - Content Polisher Skill
 *
 * 内容润色技能：润色幻灯片内容以匹配整体风格
 * - 统一术语用法
 * - 调整语气以匹配目标风格
 * - 精简冗余表达
 * - 保持核心信息不变
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
  ChatMessage,
} from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// ============================================================================
// Types
// ============================================================================

/**
 * 风格指南
 */
export interface StyleGuide {
  /** 术语规范 */
  terminology?: string;
  /** 句式风格 */
  sentenceStyle?: string;
  /** 格式规范 */
  formatting?: string;
  /** 禁用词汇 */
  forbiddenWords?: string[];
  /** 首选词汇映射 */
  preferredTerms?: Record<string, string>;
}

/**
 * 内容变更记录
 */
export interface ContentChange {
  /** 页面索引 */
  pageIndex: number;
  /** 变更类型 */
  changeType: "terminology" | "tone" | "structure" | "simplify";
  /** 原始文本片段 */
  original: string;
  /** 修改后文本片段 */
  polished: string;
  /** 变更原因 */
  reason: string;
}

/**
 * 幻灯片页面
 */
export interface SlidePage {
  /** 页面索引 */
  index: number;
  /** 页面标题 */
  title: string;
  /** 页面内容 (HTML 或文本) */
  content: string;
  /** 页面类型 */
  type?: string;
}

/**
 * 输入参数
 */
export interface ContentPolisherInput {
  /** 需要润色的页面列表 */
  pages: SlidePage[];
  /** 风格指南 */
  styleGuide?: StyleGuide;
  /** 目标语气 */
  targetTone?: "formal" | "casual" | "technical" | "friendly";
  /** 语言 */
  language?: "zh" | "en";
}

/**
 * 输出结果
 */
export interface ContentPolisherResult {
  /** 润色后的页面列表 */
  pages: SlidePage[];
  /** 内容变更记录 */
  changes: ContentChange[];
  /** 统计信息 */
  stats: {
    totalPages: number;
    pagesPolished: number;
    totalChanges: number;
  };
}

// ============================================================================
// Content Polisher Skill
// ============================================================================

@Injectable()
export class ContentPolisherSkill implements ISkill<
  ContentPolisherInput,
  ContentPolisherResult
> {
  private readonly logger = new Logger(ContentPolisherSkill.name);

  // ============================================================================
  // ISkill Implementation - Required Properties
  // ============================================================================

  readonly id = "slides-content-polisher";
  readonly name = "内容润色";
  readonly description = "润色幻灯片内容以匹配整体风格";
  readonly layer: SkillLayer = SKILL_LAYERS.OPTIMIZATION;
  readonly domain = "slides";
  readonly tags = ["slides", "content", "polish", "style", "tone"];
  readonly version = "5.0.0";

  constructor(@Optional() private readonly chatFacade: ChatFacade) {}

  // ============================================================================
  // ISkill Methods
  // ============================================================================

  /**
   * 执行内容润色
   */
  async execute(
    input: ContentPolisherInput,
    context: SkillContext,
  ): Promise<SkillResult<ContentPolisherResult>> {
    const startTime = new Date();

    if (!input.pages || input.pages.length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Pages are required for content polishing",
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
      this.logger.debug(
        `[execute] Starting content polish for ${input.pages.length} pages (executionId: ${context.executionId})`,
      );

      const polishedPages: SlidePage[] = [];
      const allChanges: ContentChange[] = [];

      // 并行处理所有页面
      const results = await Promise.all(
        input.pages.map((page) =>
          this.polishPage(
            page,
            input.styleGuide,
            input.targetTone,
            input.language,
          ),
        ),
      );

      for (const result of results) {
        polishedPages.push(result.page);
        allChanges.push(...result.changes);
      }

      const outputResult: ContentPolisherResult = {
        pages: polishedPages,
        changes: allChanges,
        stats: {
          totalPages: input.pages.length,
          pagesPolished: polishedPages.filter(
            (p, i) => p.content !== input.pages[i].content,
          ).length,
          totalChanges: allChanges.length,
        },
      };

      const endTime = new Date();

      this.logger.log(
        `[execute] Content polish completed: ${outputResult.stats.pagesPolished}/${outputResult.stats.totalPages} pages modified, ${outputResult.stats.totalChanges} changes`,
      );

      return {
        success: true,
        data: outputResult,
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

      this.logger.error(`[execute] Content polish failed: ${errorMessage}`);

      return {
        success: false,
        error: {
          code: "CONTENT_POLISH_FAILED",
          message: errorMessage,
          retryable: true,
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

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 润色单个页面
   */
  private async polishPage(
    page: SlidePage,
    styleGuide?: StyleGuide,
    targetTone?: string,
    language?: string,
  ): Promise<{ page: SlidePage; changes: ContentChange[] }> {
    // 如果没有 AI Facade，返回原始内容
    if (!this.chatFacade) {
      this.logger.warn(
        "[polishPage] AIFacade not available, returning original content",
      );
      return { page, changes: [] };
    }

    const tone = targetTone || "formal";
    const lang = language || "zh";

    const prompt = this.buildPolishPrompt(page, styleGuide, tone, lang);

    try {
      const messages: ChatMessage[] = [{ role: "user", content: prompt }];
      const response = await this.chatFacade.chat({
        messages,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "low", outputLength: "medium" },
      });

      // 解析 AI 响应
      const result = this.parsePolishResponse(response.content, page);

      return result;
    } catch (error) {
      this.logger.warn(
        `[polishPage] AI polishing failed for page ${page.index}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // 返回原始内容
      return { page, changes: [] };
    }
  }

  /**
   * 构建润色提示词
   */
  private buildPolishPrompt(
    page: SlidePage,
    styleGuide?: StyleGuide,
    targetTone?: string,
    language?: string,
  ): string {
    const isZh = language === "zh";

    let styleInstructions = "";
    if (styleGuide) {
      if (styleGuide.terminology) {
        styleInstructions += isZh
          ? `\n- 术语规范：${styleGuide.terminology}`
          : `\n- Terminology: ${styleGuide.terminology}`;
      }
      if (styleGuide.sentenceStyle) {
        styleInstructions += isZh
          ? `\n- 句式风格：${styleGuide.sentenceStyle}`
          : `\n- Sentence style: ${styleGuide.sentenceStyle}`;
      }
      if (styleGuide.forbiddenWords && styleGuide.forbiddenWords.length > 0) {
        styleInstructions += isZh
          ? `\n- 避免使用：${styleGuide.forbiddenWords.join(", ")}`
          : `\n- Avoid using: ${styleGuide.forbiddenWords.join(", ")}`;
      }
      if (styleGuide.preferredTerms) {
        const terms = Object.entries(styleGuide.preferredTerms)
          .map(([from, to]) => `"${from}" → "${to}"`)
          .join(", ");
        styleInstructions += isZh
          ? `\n- 术语替换：${terms}`
          : `\n- Term replacements: ${terms}`;
      }
    }

    if (isZh) {
      return `你是专业的演示文稿内容编辑。请润色以下幻灯片内容：

## 页面标题
${page.title}

## 当前内容
${page.content}

## 风格要求
- 目标语气：${targetTone || "正式专业"}${styleInstructions}

## 润色要求
1. 保持核心信息不变
2. 统一术语用法
3. 调整语气以匹配目标风格
4. 精简冗余表达
5. 确保表达清晰简洁

## 输出格式
请返回 JSON 格式：
\`\`\`json
{
  "polishedContent": "润色后的完整内容",
  "changes": [
    {
      "changeType": "terminology|tone|structure|simplify",
      "original": "原始文本片段",
      "polished": "修改后文本片段",
      "reason": "变更原因"
    }
  ]
}
\`\`\`

只返回 JSON，不要其他内容。`;
    } else {
      return `You are a professional presentation content editor. Please polish the following slide content:

## Page Title
${page.title}

## Current Content
${page.content}

## Style Requirements
- Target tone: ${targetTone || "formal professional"}${styleInstructions}

## Polish Requirements
1. Maintain core information unchanged
2. Unify terminology usage
3. Adjust tone to match target style
4. Simplify redundant expressions
5. Ensure clear and concise expression

## Output Format
Please return JSON format:
\`\`\`json
{
  "polishedContent": "fully polished content",
  "changes": [
    {
      "changeType": "terminology|tone|structure|simplify",
      "original": "original text snippet",
      "polished": "polished text snippet",
      "reason": "reason for change"
    }
  ]
}
\`\`\`

Return only JSON, no other content.`;
    }
  }

  /**
   * 解析润色响应
   */
  private parsePolishResponse(
    response: string,
    originalPage: SlidePage,
  ): { page: SlidePage; changes: ContentChange[] } {
    try {
      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { page: originalPage, changes: [] };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        polishedContent?: string;
        changes?: Array<{
          changeType?: string;
          original?: string;
          polished?: string;
          reason?: string;
        }>;
      };

      const polishedPage: SlidePage = {
        ...originalPage,
        content: parsed.polishedContent || originalPage.content,
      };

      const changes: ContentChange[] = (parsed.changes || []).map((c) => ({
        pageIndex: originalPage.index,
        changeType: (c.changeType as ContentChange["changeType"]) || "simplify",
        original: c.original || "",
        polished: c.polished || "",
        reason: c.reason || "",
      }));

      return { page: polishedPage, changes };
    } catch (error) {
      this.logger.warn(
        `[parsePolishResponse] Failed to parse AI response: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return { page: originalPage, changes: [] };
    }
  }
}
