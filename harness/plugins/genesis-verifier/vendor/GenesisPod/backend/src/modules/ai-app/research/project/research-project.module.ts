/**
 * Notebook Research Module - NotebookLM 风格研究模块
 *
 * 提供基于上传文档的交互式研究能力:
 * - 文档上传和分析
 * - AI 驱动的对话
 * - 研究报告生成
 * - TTS 语音输出
 */
import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
// Import directly from source to avoid circular dependency via barrel export
import { AiEngineModule } from "../../../ai-engine/ai-engine.module";
import { StorageModule } from "../../../platform/storage/storage.module";
import { CreditsModule } from "../../../platform/credits/credits.module";
import { ToolKeyResolverModule } from "../../../platform/credentials/resolution/tool-key-resolver/tool-key-resolver.module";
// ★ 依赖反转: 导入 token 用于提供 ITTSService 实现
import { TTS_SERVICE } from "@/modules/ai-harness/facade";

// 控制器和服务
import { ResearchProjectController } from "./research-project.controller";
import { ResearchProjectService } from "./research-project.service";
import { ResearchProjectSourceService } from "./research-project-source.service";
import { SourceIngestionService } from "./source-ingestion.service";
import { SourceMetadataService } from "./source-metadata.service";
import { SourceQueryService } from "./source-query.service";
import { ResearchProjectChatService } from "./research-project-chat.service";
import { ResearchProjectOutputService } from "./research-project-output.service";
import { ResearchProjectTTSService } from "./research-project-tts.service";
import { FileParserService } from "./services/file-parser.service";

@Module({
  // 使用 forwardRef 打破循环依赖: ResearchProjectModule ↔ AiEngineModule (AudioGenerationTool 需要 ResearchProjectTTSService)
  imports: [
    PrismaModule,
    forwardRef(() => AiEngineModule),
    StorageModule,
    CreditsModule,
    ToolKeyResolverModule,
  ],
  controllers: [ResearchProjectController],
  providers: [
    ResearchProjectService,
    ResearchProjectSourceService,
    SourceIngestionService,
    SourceMetadataService,
    SourceQueryService,
    ResearchProjectChatService,
    ResearchProjectOutputService,
    ResearchProjectTTSService,
    FileParserService,
    // ★ 依赖反转: 提供 ITTSService 接口实现
    {
      provide: TTS_SERVICE,
      useExisting: ResearchProjectTTSService,
    },
  ],
  exports: [
    ResearchProjectService,
    ResearchProjectSourceService,
    ResearchProjectChatService,
    ResearchProjectOutputService,
    ResearchProjectTTSService,
    // ★ 依赖反转: 导出接口实现供 AiEngineModule 使用
    TTS_SERVICE,
  ],
})
export class ResearchProjectModule {}
