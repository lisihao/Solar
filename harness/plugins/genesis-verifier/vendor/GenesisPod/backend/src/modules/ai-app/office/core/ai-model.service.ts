import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";

/**
 * AI 模型动态配置服务
 * 严禁硬编码模型名称！所有模型选择都通过此服务获取
 *
 * ★ 重构说明：已迁移到使用 ChatFacade，不再直接访问 prisma.aIModel
 */
@Injectable()
export class AIModelService {
  private readonly logger = new Logger(AIModelService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 获取默认文本模型 (用于推理、生成)
   * 优先级: 用户选择 > 系统默认 (isDefault=true) > 任意启用的模型
   *
   * @param userModelId 用户指定的模型ID (可选)
   * @returns AIModel 实体
   */
  async getDefaultTextModel(userModelId?: string) {
    this.logger.debug(
      `[getDefaultTextModel] Looking for text model, userModelId: ${userModelId || "none"}`,
    );

    // 1. 用户指定了模型
    if (userModelId) {
      const userModel = await this.chatFacade.getModelById(userModelId);
      if (userModel) {
        this.logger.debug(
          `[getDefaultTextModel] Using user specified model: ${userModel.displayName}`,
        );
        return {
          id: userModel.id,
          name: userModel.modelId,
          modelId: userModel.modelId,
          displayName: userModel.displayName,
          provider: userModel.provider,
          maxTokens: userModel.maxTokens,
          isEnabled: true,
          isDefault: false,
          modelType: AIModelType.CHAT,
        };
      }
      this.logger.warn(
        `[getDefaultTextModel] User specified model ${userModelId} not found or disabled`,
      );
    }

    // 2. 查找系统默认文本模型
    const defaultModel = await this.chatFacade.getDefaultTextModel();
    if (defaultModel) {
      this.logger.debug(
        `[getDefaultTextModel] Using system default model: ${defaultModel.displayName}`,
      );
      return {
        id: defaultModel.id,
        name: defaultModel.modelId,
        modelId: defaultModel.modelId,
        displayName: defaultModel.displayName,
        provider: defaultModel.provider,
        maxTokens: defaultModel.maxTokens,
        isEnabled: true,
        isDefault: true,
        modelType: AIModelType.CHAT,
      };
    }

    // 3. Fallback: 抛出错误，让调用者处理
    this.logger.error("[getDefaultTextModel] No text model configured!");
    throw new Error(
      "No text model configured. Please configure at least one CHAT model.",
    );
  }

  /**
   * 获取默认图形生成模型
   *
   * @param userModelId 用户指定的模型ID (可选)
   * @returns AIModel 实体
   */
  async getDefaultImageModel(userModelId?: string) {
    this.logger.debug(
      `[getDefaultImageModel] Looking for image model, userModelId: ${userModelId || "none"}`,
    );

    // 1. 用户指定了模型
    if (userModelId) {
      const userModel = await this.chatFacade.getModelById(userModelId);
      if (userModel) {
        this.logger.debug(
          `[getDefaultImageModel] Using user specified model: ${userModel.displayName}`,
        );
        return {
          id: userModel.id,
          name: userModel.modelId,
          modelId: userModel.modelId,
          displayName: userModel.displayName,
          provider: userModel.provider,
          maxTokens: userModel.maxTokens,
          isEnabled: true,
          isDefault: false,
          modelType: AIModelType.IMAGE_GENERATION,
        };
      }
    }

    // 2. 查找系统默认图像生成模型
    const defaultModel = await this.chatFacade.getDefaultImageModel();
    if (defaultModel) {
      this.logger.debug(
        `[getDefaultImageModel] Using system default model: ${defaultModel.displayName}`,
      );
      return {
        id: defaultModel.id,
        name: defaultModel.modelId,
        modelId: defaultModel.modelId,
        displayName: defaultModel.displayName,
        provider: defaultModel.provider,
        maxTokens: defaultModel.maxTokens,
        isEnabled: true,
        isDefault: true,
        modelType: AIModelType.IMAGE_GENERATION,
      };
    }

    // 3. Fallback: 抛出错误，让调用者处理
    this.logger.error("[getDefaultImageModel] No image model configured!");
    throw new Error(
      "No image generation model configured. Please configure at least one IMAGE_GENERATION model.",
    );
  }

  /**
   * 获取所有可用的文本模型列表 (用于前端下拉选择)
   */
  async getAvailableTextModels() {
    const models = await this.chatFacade.getAvailableModels(AIModelType.CHAT);

    // 转换为原有格式，并按默认排序
    return models
      .map((model) => ({
        id: model.id,
        name: model.name,
        displayName: model.name,
        provider: model.provider,
        modelId: model.id,
        isDefault: false, // ChatFacade 不返回 isDefault，可以扩展
        icon: null,
        color: null,
      }))
      .sort((a, b) => {
        // 先按 isDefault 降序，再按 displayName 升序
        if (a.isDefault !== b.isDefault) {
          return a.isDefault ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }

  /**
   * 获取所有可用的图像生成模型列表
   */
  async getAvailableImageModels() {
    const models = await this.chatFacade.getAvailableModels(
      AIModelType.IMAGE_GENERATION,
    );

    // 转换为原有格式，并按默认排序
    return models
      .map((model) => ({
        id: model.id,
        name: model.name,
        displayName: model.name,
        provider: model.provider,
        modelId: model.id,
        isDefault: false, // ChatFacade 不返回 isDefault，可以扩展
        icon: null,
        color: null,
      }))
      .sort((a, b) => {
        // 先按 isDefault 降序，再按 displayName 升序
        if (a.isDefault !== b.isDefault) {
          return a.isDefault ? -1 : 1;
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }
}
