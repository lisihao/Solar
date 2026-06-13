/**
 * Screenshot Analyzer Service
 *
 * 截图分析服务 - 使用配置的默认聊天模型分析用户上传的截图
 *
 * 职责：
 * 1. OCR 识别截图中的文本
 * 2. 识别错误信息和异常
 * 3. 识别页面和 UI 元素
 * 4. 生成问题描述
 *
 * ★ 架构说明（已知限制）：
 * - 模型配置和 API Key 通过 ChatFacade 获取 ✓
 * - Vision API 需要图片 + 文本的多模态消息格式，当前 ChatMessage 仅支持 content: string
 * - 因此暂时保留直接调用各 provider Vision API 的逻辑
 * - TODO: 当 ChatFacade 支持多模态消息后，应改为 facade.chat() 统一调用
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SecretsService } from "../../../platform/facade";
import type {
  ScreenshotAnalysis,
  FeedbackAttachment,
} from "../triage/triage-decision.types";

// TaskProfile 映射常量（待 ChatFacade 支持多模态后，改用 taskProfile 语义化配置）
// creativity: "low" → temperature 0.3（截图分析需要准确提取，不需要创意）
// outputLength: "short" → maxTokens 1000（结构化 JSON 分析结果，无需长输出）
const VISION_TEMPERATURE = 0.3;
const VISION_MAX_TOKENS = 1000;

const VISION_PROMPT = `你是一个专业的软件测试工程师，正在分析用户提交的 bug 截图。

请仔细分析这张截图，提取以下信息：

1. **检测到的文本** (detectedText): 识别截图中的所有关键文本，特别是错误消息、警告信息
2. **检测到的错误** (detectedErrors): 提取任何错误信息、异常堆栈、警告弹窗
3. **UI 元素** (uiElements): 识别截图中的主要 UI 组件（按钮、表单、弹窗等）
4. **页面识别** (pageIdentified): 判断这是哪个功能页面（如：PPT编辑器、研究报告、设置页面等）
5. **问题描述** (issueDescription): 用一句话描述你从截图中观察到的问题

请以 JSON 格式返回结果：
{
  "detectedText": ["文本1", "文本2"],
  "detectedErrors": ["错误信息1"],
  "uiElements": ["按钮", "表单"],
  "pageIdentified": "页面名称",
  "issueDescription": "问题描述"
}

只返回 JSON，不要其他解释。`;

@Injectable()
export class ScreenshotAnalyzerService {
  private readonly logger = new Logger(ScreenshotAnalyzerService.name);

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly secretsService: SecretsService,
  ) {}

  /**
   * 分析截图
   */
  async analyzeScreenshots(
    attachments: FeedbackAttachment[],
  ): Promise<ScreenshotAnalysis> {
    const imageAttachments = attachments.filter((a) =>
      a.mimeType.startsWith("image/"),
    );

    if (imageAttachments.length === 0) {
      return { hasScreenshot: false };
    }

    this.logger.log(`Analyzing ${imageAttachments.length} screenshots`);

    try {
      const analysisResults = await Promise.all(
        imageAttachments.map((attachment) =>
          this.analyzeSingleScreenshot(attachment),
        ),
      );

      // 合并所有分析结果
      return this.mergeAnalysisResults(analysisResults);
    } catch (error) {
      this.logger.error("Failed to analyze screenshots", error);
      return {
        hasScreenshot: true,
        issueDescription: "截图分析失败，请人工查看",
      };
    }
  }

  /**
   * 分析单个截图
   */
  private async analyzeSingleScreenshot(
    attachment: FeedbackAttachment,
  ): Promise<ScreenshotAnalysis> {
    try {
      const response = await this.callVisionApi(attachment.url);
      return this.parseVisionResponse(response);
    } catch (error) {
      this.logger.error(
        `Failed to analyze screenshot: ${attachment.filename}`,
        error,
      );
      return {
        hasScreenshot: true,
        issueDescription: `截图 ${attachment.filename} 分析失败`,
      };
    }
  }

  /**
   * 调用 Vision API（使用配置的默认聊天模型）
   */
  private async callVisionApi(imageUrl: string): Promise<string> {
    // ★ 通过 ChatFacade 获取默认聊天模型
    const defaultModel = await this.chatFacade.getDefaultTextModel();
    if (!defaultModel) {
      throw new Error("No default text model available for vision API");
    }
    const provider = defaultModel.provider.toLowerCase();
    const modelName = defaultModel.displayName;

    this.logger.debug(
      `[callVisionApi] Using model: ${modelName} (provider: ${provider})`,
    );

    // 根据 provider 调用对应的 Vision API
    switch (provider) {
      case "google":
      case "gemini":
        return this.callGeminiVisionApi(modelName, imageUrl);
      case "openai":
        return this.callOpenAIVisionApi(modelName, imageUrl);
      case "anthropic":
      case "claude":
        return this.callClaudeVisionApi(modelName, imageUrl);
      default:
        // 尝试使用 OpenAI 兼容格式
        this.logger.warn(
          `Unknown provider ${provider}, trying OpenAI-compatible format`,
        );
        return this.callOpenAIVisionApi(modelName, imageUrl);
    }
  }

  /**
   * 调用 Gemini Vision API
   *
   * ★ 架构说明：通过 ChatFacade 获取模型配置（包括 API Key）
   *
   * 任务配置映射 (TaskProfile equivalent):
   * - creativity: "low" (temperature: 0.3) - 截图分析需要准确提取信息
   * - outputLength: "short" (maxOutputTokens: 1000) - 结构化分析结果
   */
  private async callGeminiVisionApi(
    modelName: string,
    imageUrl: string,
  ): Promise<string> {
    // ★ 通过 ChatFacade 获取模型配置
    const modelConfig = await this.chatFacade.getFullModelConfig(modelName);
    if (!modelConfig) {
      throw new Error(`Gemini model ${modelName} not found in database`);
    }

    // ★ 解析 API Key（支持 Secret Manager）
    let apiKey = modelConfig.apiKey;
    if (modelConfig.secretKey) {
      const resolvedKey = await this.secretsService.getValue(
        modelConfig.secretKey,
      );
      if (resolvedKey) {
        apiKey = resolvedKey;
      }
    }

    if (!apiKey) {
      throw new Error(`API key not configured for Gemini model ${modelName}`);
    }

    // Gemini 需要 base64 图片，先下载图片
    const imageData = await this.fetchImageAsBase64(imageUrl);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.modelId}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: VISION_PROMPT },
              {
                inlineData: {
                  mimeType: imageData.mimeType,
                  data: imageData.base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: VISION_MAX_TOKENS,
          temperature: VISION_TEMPERATURE,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini Vision API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  /**
   * 调用 OpenAI Vision API
   *
   * ★ 架构说明：通过 ChatFacade 获取模型配置（包括 API Key）
   *
   * 任务配置映射 (TaskProfile equivalent):
   * - creativity: "low" (temperature: 0.3) - 截图分析需要准确提取信息
   * - outputLength: "short" (max_tokens: 1000) - 结构化分析结果
   */
  private async callOpenAIVisionApi(
    modelName: string,
    imageUrl: string,
  ): Promise<string> {
    // ★ 通过 ChatFacade 获取模型配置
    const modelConfig = await this.chatFacade.getFullModelConfig(modelName);
    if (!modelConfig) {
      throw new Error(`OpenAI model ${modelName} not found in database`);
    }

    // ★ 解析 API Key（支持 Secret Manager）
    let apiKey = modelConfig.apiKey;
    if (modelConfig.secretKey) {
      const resolvedKey = await this.secretsService.getValue(
        modelConfig.secretKey,
      );
      if (resolvedKey) {
        apiKey = resolvedKey;
      }
    }

    if (!apiKey) {
      throw new Error(`API key not configured for OpenAI model ${modelName}`);
    }

    const baseUrl =
      modelConfig.apiEndpoint?.trim() || "https://api.openai.com/v1";

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelConfig.modelId,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VISION_PROMPT },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: VISION_MAX_TOKENS,
        temperature: VISION_TEMPERATURE,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Vision API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  /**
   * 调用 Claude Vision API
   *
   * ★ 架构说明：通过 ChatFacade 获取模型配置（包括 API Key）
   */
  private async callClaudeVisionApi(
    modelName: string,
    imageUrl: string,
  ): Promise<string> {
    // ★ 通过 ChatFacade 获取模型配置
    const modelConfig = await this.chatFacade.getFullModelConfig(modelName);
    if (!modelConfig) {
      throw new Error(`Claude model ${modelName} not found in database`);
    }

    // ★ 解析 API Key（支持 Secret Manager）
    let apiKey = modelConfig.apiKey;
    if (modelConfig.secretKey) {
      const resolvedKey = await this.secretsService.getValue(
        modelConfig.secretKey,
      );
      if (resolvedKey) {
        apiKey = resolvedKey;
      }
    }

    if (!apiKey) {
      throw new Error(`API key not configured for Claude model ${modelName}`);
    }

    // Claude 需要 base64 图片
    const imageData = await this.fetchImageAsBase64(imageUrl);

    const baseUrl =
      modelConfig.apiEndpoint?.trim() || "https://api.anthropic.com/v1";

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelConfig.modelId,
        max_tokens: VISION_MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: imageData.mimeType,
                  data: imageData.base64,
                },
              },
              { type: "text", text: VISION_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude Vision API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || "";
  }

  /**
   * 下载图片并转换为 base64
   */
  private async fetchImageAsBase64(
    imageUrl: string,
  ): Promise<{ base64: string; mimeType: string }> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return { base64, mimeType: contentType };
  }

  /**
   * 解析 Vision 响应
   */
  private parseVisionResponse(response: string): ScreenshotAnalysis {
    try {
      // 提取 JSON 部分
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        hasScreenshot: true,
        detectedText: parsed.detectedText || [],
        detectedErrors: parsed.detectedErrors || [],
        uiElements: parsed.uiElements || [],
        pageIdentified: parsed.pageIdentified || undefined,
        issueDescription: parsed.issueDescription || undefined,
      };
    } catch (error) {
      this.logger.warn("Failed to parse vision response", error);
      return {
        hasScreenshot: true,
        issueDescription: response.slice(0, 200),
      };
    }
  }

  /**
   * 合并多个分析结果
   */
  private mergeAnalysisResults(
    results: ScreenshotAnalysis[],
  ): ScreenshotAnalysis {
    if (results.length === 0) {
      return { hasScreenshot: false };
    }

    if (results.length === 1) {
      return results[0];
    }

    // 合并所有结果
    const merged: ScreenshotAnalysis = {
      hasScreenshot: true,
      detectedText: [],
      detectedErrors: [],
      uiElements: [],
    };

    const pages = new Set<string>();
    const descriptions: string[] = [];

    for (const result of results) {
      if (result.detectedText) {
        merged.detectedText!.push(...result.detectedText);
      }
      if (result.detectedErrors) {
        merged.detectedErrors!.push(...result.detectedErrors);
      }
      if (result.uiElements) {
        merged.uiElements!.push(...result.uiElements);
      }
      if (result.pageIdentified) {
        pages.add(result.pageIdentified);
      }
      if (result.issueDescription) {
        descriptions.push(result.issueDescription);
      }
    }

    // 去重
    merged.detectedText = [...new Set(merged.detectedText)];
    merged.detectedErrors = [...new Set(merged.detectedErrors)];
    merged.uiElements = [...new Set(merged.uiElements)];

    // 合并页面和描述
    if (pages.size > 0) {
      merged.pageIdentified = [...pages].join(", ");
    }
    if (descriptions.length > 0) {
      merged.issueDescription = descriptions.join("; ");
    }

    return merged;
  }

  /**
   * 快速检查截图是否包含错误
   */
  async quickErrorCheck(
    attachments: FeedbackAttachment[],
  ): Promise<{ hasError: boolean; errorHint?: string }> {
    const analysis = await this.analyzeScreenshots(attachments);

    if (analysis.detectedErrors && analysis.detectedErrors.length > 0) {
      return {
        hasError: true,
        errorHint: analysis.detectedErrors[0],
      };
    }

    // 检查常见错误关键词
    const errorKeywords = [
      "error",
      "错误",
      "失败",
      "failed",
      "exception",
      "异常",
      "warning",
      "警告",
      "404",
      "500",
      "undefined",
      "null",
    ];

    const allText = (analysis.detectedText || []).join(" ").toLowerCase();

    for (const keyword of errorKeywords) {
      if (allText.includes(keyword)) {
        return {
          hasError: true,
          errorHint: `检测到关键词: ${keyword}`,
        };
      }
    }

    return { hasError: false };
  }
}
