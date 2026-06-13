/**
 * WebhooksModule - Webhook 事件推送模块
 *
 * 提供 Webhook 订阅管理和事件分发功能
 */

import { Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
import { WebhookDispatcherService } from "./webhook-dispatcher.service";
import { PrismaModule } from "../../../../common/prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcherService],
  exports: [WebhooksService, WebhookDispatcherService],
})
export class WebhooksModule {}
