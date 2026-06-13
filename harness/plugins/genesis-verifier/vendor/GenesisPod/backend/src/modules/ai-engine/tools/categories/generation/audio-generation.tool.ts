/**
 * Audio Generation Tool
 * 音频生成工具 (TTS) - 通过接口依赖 ResearchProjectTTSService
 *
 * ★ 架构重构: 使用依赖反转原则打破循环依赖
 * - 工具依赖 ITTSService 接口
 * - ResearchProjectModule 提供 TTS_SERVICE 实现
 * - 不再需要 forwardRef
 */

import { Injectable, Inject, Optional } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";
import {
  TTS_SERVICE,
  ITTSService,
} from "../../abstractions/generation-services.interface";

// ============================================================================
// Types
// ============================================================================

export interface AudioGenerationInput {
  /**
   * 要转换为语音的文本
   */
  text: string;

  /**
   * 语音类型（male/female）
   */
  voice?: "male" | "female" | "Host1" | "Host2";

  /**
   * 语言代码
   */
  language?: string;

  /**
   * 语速（0.5-2.0）
   */
  speed?: number;

  /**
   * 音频格式
   */
  format?: "mp3" | "wav";

  /**
   * 情感/风格
   */
  emotion?: "neutral" | "excited" | "thoughtful" | "curious";

  /**
   * 是否分段处理（用于长文本）
   */
  segmented?: boolean;
}

export interface AudioGenerationOutput {
  /**
   * 音频 URL（可能是 base64 data URL 或远程 URL）
   */
  audioUrl: string;

  /**
   * 音频时长（秒）
   */
  duration: number;

  /**
   * 音频格式
   */
  format: string;

  /**
   * 使用的 TTS 提供商
   */
  provider?: string;

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 元数据
   */
  metadata?: {
    voice: string;
    language?: string;
    speed?: number;
    wordCount?: number;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class AudioGenerationTool extends BaseTool<
  AudioGenerationInput,
  AudioGenerationOutput
> {
  readonly id = "audio-generation";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "generation";
  readonly tags = ["generation", "audio", "tts", "speech", "voice"];
  readonly name = "音频生成";
  readonly description =
    "将文本转换为自然语音音频（Text-to-Speech）。支持多种语音选项、语言和情感风格。适用于生成播客、音频解说、有声读物等。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "要转换为语音的文本内容",
      },
      voice: {
        type: "string",
        description: "语音类型",
        enum: ["male", "female", "Host1", "Host2"],
        default: "Host1",
      },
      language: {
        type: "string",
        description: "语言代码，如 en-US, zh-CN",
        default: "en-US",
      },
      speed: {
        type: "number",
        description: "语速，范围 0.5-2.0，默认 1.0",
        default: 1.0,
      },
      format: {
        type: "string",
        description: "音频格式",
        enum: ["mp3", "wav"],
        default: "mp3",
      },
      emotion: {
        type: "string",
        description: "情感/风格",
        enum: ["neutral", "excited", "thoughtful", "curious"],
        default: "neutral",
      },
      segmented: {
        type: "boolean",
        description: "是否分段处理长文本",
        default: false,
      },
    },
    required: ["text"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      audioUrl: {
        type: "string",
        description: "生成的音频 URL（base64 data URL 或远程 URL）",
      },
      duration: {
        type: "number",
        description: "音频时长（秒）",
      },
      format: {
        type: "string",
        description: "音频格式",
      },
      provider: {
        type: "string",
        description: "TTS 提供商（elevenlabs/google）",
      },
      success: {
        type: "boolean",
        description: "生成是否成功",
      },
      error: {
        type: "string",
        description: "错误信息（如果失败）",
      },
      metadata: {
        type: "object",
        description: "元数据信息",
        properties: {
          voice: { type: "string" },
          language: { type: "string" },
          speed: { type: "number" },
          wordCount: { type: "number" },
        },
      },
    },
  };

  constructor(
    @Optional()
    @Inject(TTS_SERVICE)
    private readonly ttsService?: ITTSService,
  ) {
    super();
    // defaultTimeout set in class property // 120 秒超时（TTS 生成可能较慢）
  }

  validateInput(input: AudioGenerationInput) {
    return (
      typeof input.text === "string" &&
      input.text.trim().length > 0 &&
      input.text.length <= 50000 && // 限制文本长度
      (!input.speed || (input.speed >= 0.5 && input.speed <= 2.0))
    );
  }

  protected async doExecute(
    input: AudioGenerationInput,
    _context: ToolContext,
  ): Promise<AudioGenerationOutput> {
    const {
      text,
      voice = "Host1",
      language = "en-US",
      speed = 1.0,
      format = "mp3",
      emotion = "neutral",
      segmented = false,
    } = input;

    // ★ 检查服务是否注入
    if (!this.ttsService) {
      return {
        audioUrl: "",
        duration: 0,
        format,
        success: false,
        error:
          "TTS service not available. ResearchProjectModule may not be loaded.",
      };
    }

    // 检查 TTS 服务是否可用（含 BYOK 用户 Key；2026-05-28 改用 async 门控，
    // 否则只配 BYOK Key、无 env 的用户会被同步 isAvailable() 误拦）
    if (!(await this.ttsService.isAvailableAsync())) {
      return {
        audioUrl: "",
        duration: 0,
        format,
        success: false,
        error:
          "TTS service not available. Configure a TTS key in 我的工具 (BYOK) or set ELEVENLABS_API_KEY / GOOGLE_TTS_API_KEY.",
      };
    }

    try {
      const provider = this.ttsService.getProvider();

      // 准备脚本格式
      const script = this.prepareScript(text, voice, emotion, segmented);

      // 生成音频
      const result = await this.ttsService.generateAudio(script);

      if (!result) {
        // ★ P0-LIVE-TOOL-EMPTY-ERR (2026-04-30): TTS provider 返回 null/undefined
        //   时通常是 API key 失效 / 配额耗尽 / 网络超时；带上 provider 名称
        //   让 LLM 知道是哪家 provider 挂了。
        return {
          audioUrl: "",
          duration: 0,
          format,
          success: false,
          error: `Failed to generate audio: TTS provider "${provider}" returned no result (likely API key invalid / quota exhausted / network timeout — check Admin → Secrets for ${provider}_API_KEY)`,
        };
      }

      // 计算词数
      const wordCount = text.split(/\s+/).length;

      return {
        audioUrl: result.audioUrl,
        duration: result.duration,
        format,
        provider,
        success: true,
        metadata: {
          voice,
          language,
          speed,
          wordCount,
        },
      };
    } catch (error) {
      return {
        audioUrl: "",
        duration: 0,
        format,
        success: false,
        error:
          error instanceof Error ? error.message : "Audio generation failed",
      };
    }
  }

  /**
   * 准备 TTS 脚本格式
   */
  private prepareScript(
    text: string,
    voice: string,
    emotion: string,
    segmented: boolean,
  ): {
    title: string;
    script: {
      segments: Array<{
        speaker: string;
        text: string;
        emotion?: string;
      }>;
      estimatedDuration: string;
    };
  } {
    // 如果需要分段，按句子分割
    const segments = segmented
      ? this.splitIntoSegments(text, voice, emotion)
      : [
          {
            speaker: voice,
            text,
            emotion: emotion !== "neutral" ? emotion : undefined,
          },
        ];

    // 估算时长（约 150 词/分钟）
    const wordCount = text.split(/\s+/).length;
    const estimatedMinutes = Math.ceil(wordCount / 150);

    return {
      title: "Generated Audio",
      script: {
        segments,
        estimatedDuration: `${estimatedMinutes}m`,
      },
    };
  }

  /**
   * 将长文本分割成段落
   */
  private splitIntoSegments(
    text: string,
    voice: string,
    emotion: string,
  ): Array<{
    speaker: string;
    text: string;
    emotion?: string;
  }> {
    // 按段落分割（双换行符）
    const paragraphs = text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    return paragraphs.map((paragraph) => ({
      speaker: voice,
      text: paragraph,
      emotion: emotion !== "neutral" ? emotion : undefined,
    }));
  }
}
