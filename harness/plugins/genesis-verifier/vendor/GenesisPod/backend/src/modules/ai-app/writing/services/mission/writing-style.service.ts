/**
 * Writing Style Service
 *
 * 负责管理写作风格配置和生成风格提示
 * 从 WritingMissionService 拆分出来，专注于风格管理逻辑
 */

import { Injectable, Logger } from "@nestjs/common";
import { StyleTemplateService } from "../style/style-template.service";
import {
  generateStylePrompt,
  recommendStyleByGenre,
} from "../../constants/writing-style-presets";

@Injectable()
export class WritingStyleService {
  private readonly logger = new Logger(WritingStyleService.name);

  constructor(private readonly styleTemplateService: StyleTemplateService) {}

  /**
   * 获取项目的风格提示
   * 使用三层风格配置系统（系统模板 → 用户模板 → 项目级覆盖）
   */
  async getProjectStylePrompt(projectId: string): Promise<string | undefined> {
    try {
      const mergedConfig =
        await this.styleTemplateService.getMergedStyleConfig(projectId);

      if (!mergedConfig) {
        this.logger.warn(
          `Project ${projectId} not found, cannot get style prompt`,
        );
        return undefined;
      }

      return mergedConfig.fullPrompt;
    } catch (error) {
      this.logger.error(
        `Failed to get style prompt for project ${projectId}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * 根据类型推荐风格
   */
  recommendStylesByGenre(genre: string): string[] {
    return recommendStyleByGenre(genre);
  }

  /**
   * 生成风格提示（从预设）
   */
  generateStylePromptFromPreset(styleId: string): string {
    return generateStylePrompt(styleId);
  }

  /**
   * 将 temperature 映射到 TaskProfile 的 creativity 级别
   */
  mapTemperatureToCreativity(
    temp: number,
  ): "deterministic" | "low" | "medium" | "high" {
    if (temp <= 0.2) return "deterministic";
    if (temp <= 0.3) return "low";
    if (temp <= 0.7) return "medium";
    return "high";
  }

  /**
   * 将 maxTokens 映射到 TaskProfile 的 outputLength 级别
   */
  mapMaxTokensToOutputLength(
    tokens: number,
  ): "minimal" | "short" | "medium" | "standard" | "long" | "extended" {
    if (tokens <= 1000) return "minimal";
    if (tokens <= 2000) return "short";
    if (tokens <= 4000) return "medium";
    if (tokens <= 6000) return "standard";
    if (tokens <= 8000) return "long";
    return "extended";
  }
}
