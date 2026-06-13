import { Injectable, Logger } from "@nestjs/common";
import { InfographicContent } from "../types";
import { InfographicTemplateService } from "../infographic.service";
import { InfographicRenderService } from "./infographic-render.service";

/**
 * 信息图主服务（协调器）
 * 负责：API 入口、服务编排、业务逻辑协调
 */
@Injectable()
export class InfographicService {
  private readonly logger = new Logger(InfographicService.name);

  constructor(
    private readonly templateService: InfographicTemplateService,
    private readonly renderService: InfographicRenderService,
  ) {}

  /**
   * 生成信息图（主入口）
   */
  async generateInfographic(
    content: InfographicContent,
    options?: {
      width?: number;
      height?: number;
      backgroundImageBase64?: string;
    },
  ): Promise<string> {
    const width = options?.width || 1200;
    const height = options?.height || 800;
    const templateLayout = content.styleOptions?.templateLayout || "cards";

    this.logger.log(
      `Generating infographic: "${content.title}" with ${content.sections.length} sections, size: ${width}x${height}, template: ${templateLayout}`,
    );

    // 委托给 TemplateService 生成 HTML
    let html: string;

    switch (templateLayout) {
      case "center_visual":
        html = this.templateService.generateCenterVisualHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "timeline":
        html = this.templateService.generateTimelineHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "comparison":
        html = this.templateService.generateComparisonHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "statistics":
        html = this.templateService.generateStatisticsHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "checklist":
        html = this.templateService.generateChecklistHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "funnel":
        html = this.templateService.generateFunnelHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "matrix":
        html = this.templateService.generateMatrixHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "ranking":
        html = this.templateService.generateRankingHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
      case "cards":
      default:
        html = this.templateService.generateConsultingInfographicHTML(
          content,
          options?.backgroundImageBase64,
          width,
          height,
        );
        break;
    }

    // 委托给 RenderService 渲染为图片
    const imageBase64 = await this.renderService.renderToImage(
      html,
      width,
      height,
    );

    this.logger.log(
      `Infographic generated successfully with template: ${templateLayout}`,
    );

    return imageBase64;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.renderService.cleanup();
  }
}
