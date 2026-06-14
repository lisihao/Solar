import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AIModelService } from "./ai-model.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";

/**
 * AI 模型配置接口
 * 提供前端获取可用模型列表，用于用户选择
 */
@ApiTags("AI Office - Models")
@Controller("ai-office/models")
export class AIModelController {
  constructor(private readonly aiModelService: AIModelService) {}

  // ============ 公开端点（服务间通信）============

  /**
   * 获取默认文本模型（公开端点，用于服务间通信）
   * GET /ai-office/models/default/text
   *
   * 返回简化的模型信息（不含敏感数据如 API Key）
   */
  @Get("default/text")
  async getDefaultTextModel() {
    const model = await this.aiModelService.getDefaultTextModel();
    return {
      id: model.id,
      name: model.name,
      displayName: model.displayName,
      provider: model.provider,
      modelId: model.modelId,
    };
  }

  /**
   * 获取默认图像生成模型（公开端点）
   * GET /ai-office/models/default/image
   */
  @Get("default/image")
  async getDefaultImageModel() {
    const model = await this.aiModelService.getDefaultImageModel();
    return {
      id: model.id,
      name: model.name,
      displayName: model.displayName,
      provider: model.provider,
      modelId: model.modelId,
    };
  }

  // ============ 需要认证的端点 ============

  /**
   * 获取可用的文本模型列表
   * GET /ai-office/models/text
   */
  @Get("text")
  @UseGuards(JwtAuthGuard)
  async getTextModels() {
    return this.aiModelService.getAvailableTextModels();
  }

  /**
   * 获取可用的图像生成模型列表
   * GET /ai-office/models/image
   */
  @Get("image")
  @UseGuards(JwtAuthGuard)
  async getImageModels() {
    return this.aiModelService.getAvailableImageModels();
  }
}
