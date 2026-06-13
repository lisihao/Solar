/**
 * Slides Engine v5.0 - Voice Narration Skill
 *
 * 语音旁白生成技能：为幻灯片生成播客风格的旁白脚本
 * - 根据幻灯片内容生成自然流畅的旁白文本
 * - 支持不同风格：正式、轻松、专业
 * - 预估时长
 * - 可选：集成 TTS 服务生成音频
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
 * 幻灯片页面（用于旁白生成）
 * 避免与 content-polisher.skill.ts 中的 SlidePage 冲突
 */
export interface NarrationSlidePage {
  /** 页面索引 */
  index: number;
  /** 页面标题 */
  title: string;
  /** 页面内容 (HTML 或文本) */
  content: string;
  /** 要点列表 */
  keyPoints?: string[];
}

/**
 * 旁白风格
 */
export type NarrationStyle =
  | "formal"
  | "casual"
  | "professional"
  | "storytelling";

/**
 * 页面旁白
 */
export interface PageNarration {
  /** 页面索引 */
  pageIndex: number;
  /** 旁白脚本 */
  script: string;
  /** 预估时长（秒） */
  estimatedDuration: number;
  /** 音频URL（可选，TTS生成后） */
  audioUrl?: string;
}

/**
 * 输入参数
 */
export interface VoiceNarrationInput {
  /** 幻灯片页面列表 */
  pages: NarrationSlidePage[];
  /** 演示主题 */
  presentationTitle: string;
  /** 旁白风格 */
  style?: NarrationStyle;
  /** 语言 */
  language?: "zh" | "en";
  /** 目标受众 */
  targetAudience?: string;
  /** 语速（字/分钟） */
  wordsPerMinute?: number;
}

/**
 * 输出结果
 */
export interface VoiceNarrationResult {
  /** 页面旁白列表 */
  narrations: PageNarration[];
  /** 总时长（秒） */
  totalDuration: number;
  /** 统计信息 */
  stats: {
    totalPages: number;
    totalWords: number;
    averageWordsPerPage: number;
  };
}

// ============================================================================
// Skill Implementation
// ============================================================================

@Injectable()
export class VoiceNarrationSkill implements ISkill<
  VoiceNarrationInput,
  VoiceNarrationResult
> {
  private readonly logger = new Logger(VoiceNarrationSkill.name);

  readonly id = "voice-narration";
  readonly name = "Voice Narration Skill";
  readonly description = "为幻灯片生成播客风格的旁白脚本";
  readonly layer: SkillLayer = SKILL_LAYERS.CONTENT;
  readonly domain = "slides";
  readonly tags = ["narration", "voice", "audio"];

  constructor(
    @Optional()
    private readonly chatFacade?: ChatFacade,
  ) {}

  async execute(
    input: VoiceNarrationInput,
    context: SkillContext,
  ): Promise<SkillResult<VoiceNarrationResult>> {
    const startTime = new Date();
    this.logger.log(
      `[VoiceNarrationSkill] Starting narration generation for ${input.pages.length} pages`,
    );

    const style = input.style || "professional";
    const language = input.language || "zh";
    const wordsPerMinute =
      input.wordsPerMinute || (language === "zh" ? 200 : 150);

    try {
      const narrations: PageNarration[] = [];
      let totalWords = 0;

      for (const page of input.pages) {
        const narration = await this.generateNarrationForPage(
          page,
          input.presentationTitle,
          style,
          language,
          input.targetAudience,
        );

        // Calculate word count and duration
        const wordCount = this.countWords(narration, language);
        const duration = Math.ceil((wordCount / wordsPerMinute) * 60);

        narrations.push({
          pageIndex: page.index,
          script: narration,
          estimatedDuration: duration,
        });

        totalWords += wordCount;
      }

      const totalDuration = narrations.reduce(
        (sum, n) => sum + n.estimatedDuration,
        0,
      );

      const result: VoiceNarrationResult = {
        narrations,
        totalDuration,
        stats: {
          totalPages: input.pages.length,
          totalWords,
          averageWordsPerPage: Math.round(totalWords / input.pages.length),
        },
      };

      const endTime = new Date();
      this.logger.log(
        `[VoiceNarrationSkill] Generated narrations: ${narrations.length} pages, ${totalDuration}s total`,
      );

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
      this.logger.error(
        `[VoiceNarrationSkill] Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return {
        success: false,
        error: {
          code: "NARRATION_GENERATION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Failed to generate narrations",
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

  /**
   * 为单个页面生成旁白
   */
  private async generateNarrationForPage(
    page: NarrationSlidePage,
    presentationTitle: string,
    style: NarrationStyle,
    language: string,
    targetAudience?: string,
  ): Promise<string> {
    if (!this.chatFacade) {
      // Fallback: simple template-based narration
      return this.generateTemplateNarration(page, style, language);
    }

    const styleGuide = this.getStyleGuide(style, language);

    const prompt =
      language === "zh"
        ? `你是一位专业的演讲稿撰写专家。请为以下幻灯片页面生成一段自然流畅的旁白脚本。

演示主题：${presentationTitle}
页面标题：${page.title}
页面内容：
${this.extractTextContent(page.content)}
${page.keyPoints ? `要点：\n${page.keyPoints.join("\n")}` : ""}
${targetAudience ? `目标受众：${targetAudience}` : ""}

风格要求：${styleGuide}

要求：
1. 旁白应该自然流畅，适合口语表达
2. 不要直接复述页面内容，而是解释和补充
3. 使用过渡词连接上下文
4. 时长控制在30-60秒
5. 只输出旁白文本，不要其他内容`
        : `You are a professional speechwriter. Generate a natural, flowing narration script for the following slide.

Presentation: ${presentationTitle}
Slide Title: ${page.title}
Content:
${this.extractTextContent(page.content)}
${page.keyPoints ? `Key Points:\n${page.keyPoints.join("\n")}` : ""}
${targetAudience ? `Target Audience: ${targetAudience}` : ""}

Style: ${styleGuide}

Requirements:
1. The narration should be natural and suitable for spoken delivery
2. Don't just read the slide - explain and expand
3. Use transitions to connect with context
4. Keep it 30-60 seconds
5. Output only the narration text`;

    const messages: ChatMessage[] = [{ role: "user", content: prompt }];

    const response = await this.chatFacade.chat({
      messages,
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: "medium",
        outputLength: "short",
      },
    });

    return response.content.trim();
  }

  /**
   * 模板化旁白生成（无 AI 时的回退方案）
   */
  private generateTemplateNarration(
    page: NarrationSlidePage,
    style: NarrationStyle,
    language: string,
  ): string {
    const text = this.extractTextContent(page.content);
    const keyPoints = page.keyPoints || [];

    if (language === "zh") {
      const intro =
        style === "formal"
          ? `接下来我们来看${page.title}。`
          : `让我们聊聊${page.title}。`;

      const body =
        keyPoints.length > 0
          ? `主要有以下几点：${keyPoints.slice(0, 3).join("；")}。`
          : text.slice(0, 200);

      return `${intro}${body}`;
    } else {
      const intro =
        style === "formal"
          ? `Let's examine ${page.title}.`
          : `Let's talk about ${page.title}.`;

      const body =
        keyPoints.length > 0
          ? `The key points are: ${keyPoints.slice(0, 3).join("; ")}.`
          : text.slice(0, 200);

      return `${intro} ${body}`;
    }
  }

  /**
   * 获取风格指南
   */
  private getStyleGuide(style: NarrationStyle, language: string): string {
    const guides: Record<NarrationStyle, { zh: string; en: string }> = {
      formal: {
        zh: "正式、专业、客观",
        en: "Formal, professional, objective",
      },
      casual: {
        zh: "轻松、亲切、口语化",
        en: "Casual, friendly, conversational",
      },
      professional: {
        zh: "专业、清晰、有见地",
        en: "Professional, clear, insightful",
      },
      storytelling: {
        zh: "叙事性、引人入胜、有故事感",
        en: "Narrative, engaging, story-driven",
      },
    };

    return guides[style][language as "zh" | "en"];
  }

  /**
   * 从 HTML 提取纯文本
   */
  private extractTextContent(html: string): string {
    // Remove HTML tags
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 计算字数
   */
  private countWords(text: string, language: string): number {
    if (language === "zh") {
      // Chinese: count characters (excluding spaces and punctuation)
      return text.replace(/[\s\p{P}]/gu, "").length;
    } else {
      // English: count words
      return text.split(/\s+/).filter((w) => w.length > 0).length;
    }
  }
}
