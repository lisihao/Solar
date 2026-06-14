/**
 * SocialEngineBridgeModule — 把 SocialPublishAdapter 绑定到 SOCIAL_PUBLISH_PORT 全局 token
 *
 * 为什么是 @Global：
 *   - engine `wechat-mp-publish.tool` 等用 `@Optional() @Inject(SOCIAL_PUBLISH_PORT)` 解析
 *   - 这些 tool 在 AiEngineToolsModule（engine）下注册，engine 不能 import ai-app
 *   - @Global 让 token provider 全局可见，AiEngineToolsModule 无须 import 本 module
 *     也能解析 —— 与 SKILL_PROVIDERS 同模式（实现侧主动绑定 token，消费侧通过
 *     @Optional + @Inject 解析）。
 *
 * 装配：AppModule（或更上层）import 本 module；本 module import AiSocialModule
 * 拿 SocialPublishAdapter（adapter 与 PublishExecutorService 同 AiSocialModule scope，
 * 避免循环依赖）。
 */

import { forwardRef, Global, Module } from "@nestjs/common";
import { SOCIAL_PUBLISH_PORT } from "@/modules/ai-engine/facade";
import { AiSocialModule } from "../module/ai-social.module";
import { SocialPublishAdapter } from "./social-publish.adapter";

@Global()
@Module({
  imports: [forwardRef(() => AiSocialModule)],
  providers: [
    {
      provide: SOCIAL_PUBLISH_PORT,
      useExisting: SocialPublishAdapter,
    },
  ],
  exports: [SOCIAL_PUBLISH_PORT],
})
export class SocialEngineBridgeModule {}
