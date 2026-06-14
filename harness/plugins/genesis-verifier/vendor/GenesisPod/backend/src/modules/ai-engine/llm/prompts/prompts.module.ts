/**
 * Prompts Module
 * Prompt 模板管理子模块
 *
 * 提供：
 * - Prompt 模板版本管理
 * - 模板激活和回滚
 * - 模板渲染
 */

import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { PromptTemplateService } from "./prompt-template.service";
import { PromptTierAdaptationService } from "./prompt-tier-adaptation.service";

@Module({
  imports: [PrismaModule],
  providers: [PromptTemplateService, PromptTierAdaptationService],
  exports: [PromptTemplateService, PromptTierAdaptationService],
})
export class PromptsModule {}
