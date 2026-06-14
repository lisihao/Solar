import { Module } from "@nestjs/common";
import { ContentProcessingModule } from "@/common/content-processing/content-processing.module";
import { SystemSettingModule } from "@/common/settings/system-setting.module";
import { ToolKeyResolverModule } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.module";
import {
  ContentFetchService,
  YOUTUBE_SERVICE_TOKEN,
} from "./content-fetch.service";
import { YoutubeService } from "./youtube.service";

/**
 * ContentFetchModule
 *
 * PR-X11: YoutubeService 已搬到 engine/content/fetch（与本模块同位置），
 * 不再 import ai-app/explore（消除 engine → app 反向依赖）。
 *
 * PR-X22: imports SystemSettingModule (YoutubeService 注入 SystemSettingService)
 */
@Module({
  imports: [
    ContentProcessingModule,
    SystemSettingModule,
    ToolKeyResolverModule,
  ],
  providers: [
    ContentFetchService,
    YoutubeService,
    { provide: YOUTUBE_SERVICE_TOKEN, useExisting: YoutubeService },
  ],
  exports: [ContentFetchService, YoutubeService],
})
export class ContentFetchModule {}
