/**
 * Image Generation Service Interface
 * 图像生成服务抽象接口 - 供 AI Engine 使用
 *
 * 解决问题: ImageDesignerAgent 不应直接依赖 AI Apps 的具体实现
 * 实现位置: backend/src/modules/ai-app/image/
 */

export interface IImageGenerationService {
  /**
   * 生成图像
   */
  generateImage(params: {
    prompt: string;
    userId?: string;
    style?: string;
    size?: string;
    quality?: string;
    options?: Record<string, unknown>;
  }): Promise<{
    url: string;
    width?: number;
    height?: number;
    metadata?: Record<string, unknown>;
  }>;

  /**
   * 增强 Prompt
   */
  enhancePrompt?(prompt: string, style?: string): Promise<string>;

  /**
   * 生成信息图表
   */
  generateInfographic?(params: {
    content: string;
    style?: string;
    layout?: string;
    options?: Record<string, unknown>;
  }): Promise<{
    html: string;
    imageUrl?: string;
  }>;
}

/**
 * Injection Token for Image Generation Service
 */
export const IMAGE_GENERATION_SERVICE_TOKEN = Symbol(
  "IMAGE_GENERATION_SERVICE",
);
