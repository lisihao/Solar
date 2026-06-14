import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SocialContentType, AIModelType } from "@prisma/client";
import {
  BILINGUAL_FORMAT_GUIDE,
  WECHAT_ARTICLE_SYSTEM_PROMPT,
  XIAOHONGSHU_NOTE_SYSTEM_PROMPT,
  XIAOHONGSHU_NOTE_BILINGUAL_ADDENDUM,
} from "../skills/social-transformer.prompt";

export interface TransformInput {
  sourceContent: string;
  sourceTitle?: string;
  /** 原文内容（英文或原始语言） */
  originalContent?: string;
  /** 翻译内容（中文） */
  translatedContent?: string;
  /** 是否为双语内容 */
  isBilingual?: boolean;
  targetType: SocialContentType;
  additionalInstructions?: string;
  /** 用户ID（用于积分消费） */
  userId?: string;
}

export interface TransformOutput {
  title: string;
  content: string;
  digest?: string;
  tags?: string[];
}

@Injectable()
export class ContentTransformerService {
  private readonly logger = new Logger(ContentTransformerService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  async transform(input: TransformInput): Promise<TransformOutput> {
    this.logger.log(
      `Transforming content to ${input.targetType}, isBilingual=${input.isBilingual}`,
    );

    const prompt = this.buildPrompt(input);

    const response = await this.chatFacade.chat({
      messages: [
        {
          role: "system",
          content: this.getSystemPrompt(input.targetType, input.isBilingual),
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: "medium",
        outputLength: "long",
      },
      billing: input.userId
        ? {
            userId: input.userId,
            moduleType: "ai-social",
            operationType: "generate-post",
            description: `社交内容生成 - ${input.targetType}`,
          }
        : undefined,
    });

    // Check for API errors (e.g., expired API key, rate limits)
    if (response.isError) {
      this.logger.error(
        `AI transform failed: ${response.content.slice(0, 200)}`,
      );
      throw new Error(`AI 内容转换失败: ${response.content.slice(0, 100)}`);
    }

    // Validate response content is not empty or too short
    if (!response.content || response.content.length < 50) {
      this.logger.error(
        `AI returned invalid content (length=${response.content?.length || 0})`,
      );
      throw new Error("AI 返回的内容无效或过短，请重试");
    }

    return this.parseResponse(response.content, input.sourceTitle);
  }

  private getSystemPrompt(
    targetType: SocialContentType,
    isBilingual?: boolean,
  ): string {
    // 双语输出的通用样式说明
    const bilingualStyleGuide = isBilingual ? BILINGUAL_FORMAT_GUIDE : "";

    switch (targetType) {
      case SocialContentType.WECHAT_ARTICLE:
        return `${WECHAT_ARTICLE_SYSTEM_PROMPT.replace(
          /### 3\. 结尾部分/,
          `### 3. 结尾部分${bilingualStyleGuide}`,
        )}`;

      case SocialContentType.XIAOHONGSHU_NOTE:
        const bilingualAddendum = isBilingual
          ? XIAOHONGSHU_NOTE_BILINGUAL_ADDENDUM
          : "";
        return `${XIAOHONGSHU_NOTE_SYSTEM_PROMPT}${bilingualAddendum}`;

      default:
        return "将内容转换为适合社交媒体发布的格式。";
    }
  }

  private buildPrompt(input: TransformInput): string {
    let prompt = `请将以下内容转换为目标平台格式：

原始标题：${input.sourceTitle || "无"}
`;

    // 如果有双语内容，分别提供原文和翻译
    if (input.isBilingual && input.originalContent && input.translatedContent) {
      prompt += `
【重要提示】此内容为双语素材，请按照双语格式要求输出中英对照内容。

=== 英文原文 (English Original) ===
${input.originalContent}

=== 中文翻译 (Chinese Translation) ===
${input.translatedContent}
`;
    } else if (input.originalContent && !input.translatedContent) {
      // 只有原文，没有翻译
      prompt += `
【提示】以下为英文原文，请在输出时保留关键术语的英文原文。

原始内容（英文）：
${input.originalContent}
`;
    } else {
      // 普通内容
      prompt += `
原始内容：
${input.sourceContent}`;
    }

    if (input.additionalInstructions) {
      prompt += `\n\n额外要求：${input.additionalInstructions}`;
    }

    return prompt;
  }

  private parseResponse(
    responseContent: string,
    fallbackTitle?: string,
  ): TransformOutput {
    try {
      // 尝试从响应中提取JSON
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          title: parsed.title || fallbackTitle || "未命名",
          content: parsed.content || responseContent,
          digest: parsed.digest,
          tags: parsed.tags || [],
        };
      }
    } catch (error) {
      this.logger.warn("Failed to parse AI response as JSON", error);
    }

    // 如果解析失败，返回原始响应
    return {
      title: fallbackTitle || "未命名",
      content: responseContent,
      tags: [],
    };
  }
}
