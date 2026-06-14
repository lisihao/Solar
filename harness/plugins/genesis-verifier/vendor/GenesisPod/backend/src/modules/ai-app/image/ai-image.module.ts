import { Module, forwardRef, OnModuleInit, Logger } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { MulterModule } from "@nestjs/platform-express";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { StorageModule } from "../../platform/storage/storage.module";
import { SecretsModule } from "../../platform/credentials/storage/secrets/secrets.module";
import { BrowserModule } from "../../../common/browser/browser.module";
// 直接从文件导入，避免 barrel export 循环依赖
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
// ★ 依赖反转: 导入 token 用于提供 ImageGenerationService 实现
import {
  IMAGE_GENERATION_SERVICE,
  IMAGE_GENERATION_SERVICE_TOKEN,
} from "@/modules/ai-harness/facade";
import { AgentRegistry } from "@/modules/ai-harness/facade";
import { ImageDesignerAgent } from "./agents";

// Generation
import {
  GenerationController,
  GenerationService,
  ImageGenerationService,
  PromptEnhancementService,
  Imagen4PromptService,
} from "./generation";

// Storage
import { StorageService } from "./storage";

// Export
import { ExportController, ExportService } from "./export";

// Brand Kit
import { BrandKitController, BrandKitService } from "./brand-kit";

// Infographic
import { InfographicService } from "./infographic";

// Analytics
import { AnalyticsService, AgentExecutorService } from "./analytics";

@Module({
  imports: [
    PrismaModule,
    HttpModule,
    BrowserModule,
    StorageModule,
    SecretsModule,
    MulterModule.register({
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    }),
    // 使用 forwardRef 打破循环依赖: AiImageModule ↔ AiEngineModule
    forwardRef(() => AiEngineModule),
  ],
  controllers: [GenerationController, BrandKitController, ExportController],
  providers: [
    // Generation
    GenerationService,
    ImageGenerationService,
    PromptEnhancementService,
    Imagen4PromptService,
    // Storage
    StorageService,
    // Export
    ExportService,
    // Brand Kit
    BrandKitService,
    // Infographic
    InfographicService,
    // Analytics
    AnalyticsService,
    AgentExecutorService,
    // ★ 依赖反转: 提供 IImageGenerationService 接口实现
    {
      provide: IMAGE_GENERATION_SERVICE,
      useExisting: GenerationService,
    },
    // ★ Agent 依赖反转: 提供 IImageGenerationService (Agent 接口)
    {
      provide: IMAGE_GENERATION_SERVICE_TOKEN,
      useExisting: GenerationService,
    },
    // Agent
    ImageDesignerAgent,
  ],
  exports: [
    // Generation
    GenerationService,
    ImageGenerationService,
    PromptEnhancementService,
    // Storage
    StorageService,
    // Export
    ExportService,
    // Brand Kit
    BrandKitService,
    // Infographic
    InfographicService,
    // Analytics
    AnalyticsService,
    AgentExecutorService,
    // ★ 依赖反转: 导出接口实现供 AiEngineModule 使用
    IMAGE_GENERATION_SERVICE,
  ],
})
export class AiImageModule implements OnModuleInit {
  private readonly logger = new Logger(AiImageModule.name);

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly imageDesignerAgent: ImageDesignerAgent,
  ) {}

  onModuleInit() {
    this.agentRegistry.register(this.imageDesignerAgent);
    this.logger.log("Registered ImageDesignerAgent to AgentRegistry");
  }
}
