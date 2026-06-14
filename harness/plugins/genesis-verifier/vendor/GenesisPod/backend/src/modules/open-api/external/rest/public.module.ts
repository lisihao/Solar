/**
 * Public API Module
 *
 * Exposes GenesisPod capabilities via REST endpoints
 * for external consumers (OpenClaw, Web Apps, Mobile).
 *
 * Authentication: MCP API Key (same key pool as MCP Server)
 * Response format: Wrapped by global ResponseTransformInterceptor
 */

import { Module } from "@nestjs/common";
import { PublicController } from "./public.controller";
import { SecretsModule } from "../../../platform/credentials/storage/secrets/secrets.module";
// ★ 2026-06-03 standards/16: 公开退订端点 HTTP 上提（notifications/unsubscribe，
//   token-only 无需登录）；UnsubscribeTokenService 留 L1 platform，经
//   NotificationDispatcherModule 导出注入。
import { UnsubscribeController } from "./notifications/unsubscribe.controller";
import { NotificationDispatcherModule } from "../../../platform/notifications/dispatcher/notification-dispatcher.module";
@Module({
  imports: [
    SecretsModule, // Required for MCPApiKeyGuard
    NotificationDispatcherModule, // exports UnsubscribeTokenService（上提的 UnsubscribeController 注入）
    // ★ DiscussionModule removed — research accessed via AIFacade.executeDirectResearch()
    // AIFacade is @Global, no explicit import needed
  ],
  controllers: [PublicController, UnsubscribeController],
})
export class PublicModule {}
