/**
 * Content Analysis Module
 * AI Engine 核心能力 - 内容特征分析
 *
 * 从 ai-app/office/common/ 迁移到 AI Engine 供跨模块复用
 * AIFacade 通过 @Global() 自动可用
 */

import { Module } from "@nestjs/common";
import { ContentAnalysisService } from "./content-analysis.service";

@Module({
  providers: [ContentAnalysisService],
  exports: [ContentAnalysisService],
})
export class ContentAnalysisModule {}
