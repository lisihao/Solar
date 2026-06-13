/**
 * Generation Services Abstractions
 *
 * 定义生成类工具所需的服务接口和注入令牌
 * 使用依赖反转原则打破 AiEngineModule 与外部模块的循环依赖
 *
 * 架构说明:
 * - 接口定义在 AiEngineModule (核心层)
 * - 实现在各应用模块 (AiImageModule, ResearchProjectModule)
 * - 工具依赖接口，不依赖具体实现
 */

import { Observable } from "rxjs";

// ============================================================================
// Image Generation Service
// ============================================================================

/**
 * 图像生成服务注入令牌
 */
export const IMAGE_GENERATION_SERVICE = Symbol("IMAGE_GENERATION_SERVICE");

/**
 * 图像生成流事件类型
 */
export interface ImageGenerationStreamEvent {
  data: string;
}

/**
 * 图像生成服务接口
 * 由 AiImageModule.GenerationService 实现
 */
export interface IImageGenerationService {
  /**
   * 流式生成图像
   * @param options 生成选项
   * @returns Observable 事件流
   */
  generateImageStream(options: {
    prompt: string;
    content?: string;
    urls?: string[];
    style?: string;
    aspectRatio?: "9:16" | "16:9" | "1:1";
    templateLayout?: string;
    [key: string]: unknown;
  }): Observable<ImageGenerationStreamEvent>;
}

// ============================================================================
// TTS Service
// ============================================================================

/**
 * TTS 服务注入令牌
 */
export const TTS_SERVICE = Symbol("TTS_SERVICE");

/**
 * TTS 脚本格式
 */
export interface TTSScript {
  title: string;
  script: {
    segments: Array<{
      speaker: string;
      text: string;
      emotion?: string;
    }>;
    estimatedDuration: string;
  };
}

/**
 * TTS 生成结果
 */
export interface TTSResult {
  audioUrl: string;
  duration: number;
}

/**
 * TTS 服务接口
 * 由 ResearchProjectModule.ResearchProjectTTSService 实现
 */
export interface ITTSService {
  /**
   * 检查 TTS 服务是否可用（同步，仅看 env/admin；不含 BYOK 用户 Key）
   */
  isAvailable(): boolean;

  /**
   * 2026-05-28 BYOK：在当前用户上下文下检查是否可用（含用户 BYOK Key 解析）。
   * 工具门控应优先用它，否则只配 BYOK Key 无 env 的用户会被同步检查误拦。
   */
  isAvailableAsync(): Promise<boolean>;

  /**
   * 获取当前 TTS 提供商
   */
  getProvider(): string;

  /**
   * 生成音频
   * @param script TTS 脚本
   * @returns 音频结果或 null
   */
  generateAudio(script: TTSScript): Promise<TTSResult | null>;
}
