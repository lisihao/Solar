/**
 * AI Office 共享模块
 *
 * 提供 Slides 和 Docs 模块共用的服务：
 * - 模板选择服务
 * - 阅读体验服务
 *
 * ContentAnalysisService 在 Phase 3 迁移到 ai-app/office/content-analysis/
 * 需要显式导入 ContentAnalysisModule（不再 @Global）
 */

import { Module } from "@nestjs/common";
import { AIModelService } from "../core/ai-model.service";
import { ContentAnalysisModule } from "../content-analysis/content-analysis.module";

// 服务
import { TemplateSelectionService } from "./template-selection.service";
import { ReadingExperienceService } from "./reading-experience.service";

const services = [TemplateSelectionService, ReadingExperienceService];

@Module({
  imports: [ContentAnalysisModule],
  providers: [AIModelService, ...services],
  exports: [...services],
})
export class AIOfficeCommonModule {}
