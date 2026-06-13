import { Module } from "@nestjs/common";
import { YoutubeController } from "./youtube.controller";
import { YoutubeService } from "@/modules/ai-harness/facade";
import { PdfGeneratorService } from "./pdf-generator.service";
import { YoutubeVideosController } from "./youtube-videos.controller";
import { YoutubeVideosService } from "./youtube-videos.service";
import { YoutubeAiChatController } from "./youtube-ai-chat/youtube-ai-chat.controller";
import { YoutubeAiChatService } from "./youtube-ai-chat/youtube-ai-chat.service";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { BrowserModule } from "../../../common/browser/browser.module";
import { SystemSettingModule } from "../../../common/settings/system-setting.module";
import { ToolKeyResolverModule } from "../../platform/credentials/resolution/tool-key-resolver/tool-key-resolver.module";
import { ExploreContentSourceProvider } from "./integrations/explore-content-source.provider";

/**
 * Explore Module
 * 整合 YouTube 相关功能：字幕获取、PDF导出、视频管理、AI 聊天历史
 */
@Module({
  imports: [
    PrismaModule,
    BrowserModule,
    SystemSettingModule,
    ToolKeyResolverModule,
  ],
  controllers: [
    YoutubeController,
    YoutubeVideosController,
    YoutubeAiChatController,
  ],
  providers: [
    YoutubeService,
    PdfGeneratorService,
    YoutubeVideosService,
    YoutubeAiChatService,
    // Generic ContentSource — auto-discovered by engine ContentSourceRegistry
    ExploreContentSourceProvider,
  ],
  exports: [
    YoutubeService,
    PdfGeneratorService,
    YoutubeVideosService,
    YoutubeAiChatService,
    ExploreContentSourceProvider,
  ],
})
export class ExploreModule {}
