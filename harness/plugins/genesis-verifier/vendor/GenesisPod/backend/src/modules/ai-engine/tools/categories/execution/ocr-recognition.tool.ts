/**
 * OCR Recognition Tool
 * OCR 文字识别工具 - 从图片中提取文字内容
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

import Tesseract from "tesseract.js";

// ============================================================================
// Types
// ============================================================================

export interface OCRRecognitionInput {
  /**
   * 图片来源
   */
  image: {
    /**
     * 图片 URL
     */
    url?: string;

    /**
     * 图片 Base64 数据
     */
    base64?: string;

    /**
     * 图片文件路径
     */
    path?: string;
  };

  /**
   * 识别选项
   */
  options?: {
    /**
     * 语言代码，支持多语言，默认 "eng+chi_sim"
     * 常用: eng(英文), chi_sim(简体中文), chi_tra(繁体中文), jpn(日文), kor(韩文)
     */
    language?: string;

    /**
     * 是否返回详细信息（包含置信度和边界框），默认 true
     */
    detailed?: boolean;

    /**
     * 最小置信度阈值 (0-100)，默认 0
     */
    minConfidence?: number;

    /**
     * PSM (Page Segmentation Mode)，默认 3
     * 3: Fully automatic page segmentation (default)
     * 6: Assume a single uniform block of text
     * 11: Sparse text. Find as much text as possible in no particular order
     */
    psm?: number;
  };
}

export interface OCRRecognitionOutput {
  /**
   * 是否识别成功
   */
  success: boolean;

  /**
   * 识别的文本内容
   */
  text: string;

  /**
   * 详细识别结果
   */
  details?: {
    /**
     * 整体置信度 (0-100)
     */
    confidence: number;

    /**
     * 逐行识别结果
     */
    lines: Array<{
      text: string;
      confidence: number;
      bbox: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
      };
    }>;

    /**
     * 逐词识别结果
     */
    words: Array<{
      text: string;
      confidence: number;
      bbox: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
      };
    }>;
  };

  /**
   * 错误信息（如果有）
   */
  error?: string;

  /**
   * 处理时间（毫秒）
   */
  processingTime: number;

  /**
   * 元数据
   */
  metadata?: {
    /**
     * 使用的语言
     */
    language: string;

    /**
     * 图片尺寸
     */
    imageSize?: {
      width: number;
      height: number;
    };
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class OCRRecognitionTool extends BaseTool<
  OCRRecognitionInput,
  OCRRecognitionOutput
> {
  private readonly logger = new Logger(OCRRecognitionTool.name);

  readonly id = "ocr-recognition";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "execution";
  readonly tags = ["execution", "ocr", "image", "text-extraction", "vision"];
  readonly name = "OCR 文字识别";
  readonly description =
    "从图片中提取文字内容。支持多语言识别（中文、英文、日文、韩文等），返回文本、置信度和边界框信息。适用于文档扫描、图片文字提取等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      image: {
        type: "object",
        description: "图片来源（提供 url、base64 或 path 之一）",
        properties: {
          url: {
            type: "string",
            description: "图片 URL",
          },
          base64: {
            type: "string",
            description: "图片 Base64 数据",
          },
          path: {
            type: "string",
            description: "图片文件路径",
          },
        },
      },
      options: {
        type: "object",
        description: "识别选项",
        properties: {
          language: {
            type: "string",
            description:
              "语言代码，支持多语言组合（用+连接），默认 'eng+chi_sim'",
            default: "eng+chi_sim",
          },
          detailed: {
            type: "boolean",
            description: "是否返回详细信息（置信度和边界框），默认 true",
            default: true,
          },
          minConfidence: {
            type: "number",
            description: "最小置信度阈值 (0-100)，默认 0",
            default: 0,
          },
          psm: {
            type: "number",
            description: "页面分割模式，默认 3（自动）",
            default: 3,
          },
        },
      },
    },
    required: ["image"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "是否识别成功",
      },
      text: {
        type: "string",
        description: "识别的文本内容",
      },
      details: {
        type: "object",
        description: "详细识别结果",
        properties: {
          confidence: {
            type: "number",
            description: "整体置信度",
          },
          lines: {
            type: "array",
            description: "逐行识别结果",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                confidence: { type: "number" },
                bbox: {
                  type: "object",
                  properties: {
                    x0: { type: "number" },
                    y0: { type: "number" },
                    x1: { type: "number" },
                    y1: { type: "number" },
                  },
                },
              },
            },
          },
          words: {
            type: "array",
            description: "逐词识别结果",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                confidence: { type: "number" },
                bbox: {
                  type: "object",
                  properties: {
                    x0: { type: "number" },
                    y0: { type: "number" },
                    x1: { type: "number" },
                    y1: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
      error: {
        type: "string",
        description: "错误信息",
      },
      processingTime: {
        type: "number",
        description: "处理时间（毫秒）",
      },
      metadata: {
        type: "object",
        description: "元数据",
        properties: {
          language: { type: "string" },
          imageSize: {
            type: "object",
            properties: {
              width: { type: "number" },
              height: { type: "number" },
            },
          },
        },
      },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property // 120 秒超时（OCR 可能较慢）
  }

  validateInput(input: OCRRecognitionInput) {
    const { image } = input;

    if (!image) {
      return false;
    }

    // 至少提供一种图片来源
    if (!image.url && !image.base64 && !image.path) {
      this.logger.warn("No image source provided");
      return false;
    }

    return true;
  }

  protected async doExecute(
    input: OCRRecognitionInput,
    _context: ToolContext,
  ): Promise<OCRRecognitionOutput> {
    const { image, options } = input;
    const language = options?.language || "eng+chi_sim";
    const detailed = options?.detailed ?? true;
    const minConfidence = options?.minConfidence || 0;
    const psm = options?.psm || 3;

    this.logger.log(`Starting OCR recognition (language: ${language})`);

    const startTime = Date.now();

    try {
      // 确定图片源
      const imageSource = image.url || image.base64 || image.path || "";

      // 执行 OCR 识别
      const result = await Tesseract.recognize(imageSource, language, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            this.logger.debug(
              `OCR progress: ${Math.round((m.progress || 0) * 100)}%`,
            );
          }
        },
        tessedit_pageseg_mode: psm,
      });

      const processingTime = Date.now() - startTime;

      // 提取文本
      const text = result.data.text.trim();

      // 整体置信度
      const confidence = result.data.confidence;

      // 构建详细结果
      let details: OCRRecognitionOutput["details"] | undefined;

      if (detailed) {
        // 提取行信息
        const lines = result.data.lines
          .map((line) => ({
            text: line.text.trim(),
            confidence: line.confidence,
            bbox: line.bbox,
          }))
          .filter((line) => line.confidence >= minConfidence);

        // 提取词信息
        const words = result.data.words
          .map((word) => ({
            text: word.text.trim(),
            confidence: word.confidence,
            bbox: word.bbox,
          }))
          .filter((word) => word.confidence >= minConfidence);

        details = {
          confidence,
          lines,
          words,
        };
      }

      this.logger.log(
        `OCR recognition completed: success=true, chars=${text.length}, confidence=${confidence.toFixed(2)}%, time=${processingTime}ms`,
      );

      return {
        success: true,
        text,
        details,
        processingTime,
        metadata: {
          language,
          imageSize: result.data.imageSize
            ? {
                width: result.data.imageSize.width,
                height: result.data.imageSize.height,
              }
            : undefined,
        },
      };
    } catch (error: unknown) {
      const processingTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`OCR recognition failed: ${errorMessage}`);

      return {
        success: false,
        text: "",
        error: errorMessage,
        processingTime,
        metadata: {
          language,
        },
      };
    }
  }
}
