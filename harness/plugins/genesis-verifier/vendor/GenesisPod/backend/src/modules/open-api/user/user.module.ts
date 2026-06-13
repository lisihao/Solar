import { Module } from "@nestjs/common";
import { CreditsController } from "./credits/credits.controller";
import { CreditsModule } from "../../platform/credits/credits.module";
import { NotificationController } from "./notifications/notification.controller";
import { NotificationModule } from "../../platform/notifications/notification.module";

/**
 * Open-API User Module（第一方登录用户 · 跨域自助能力面）
 *
 * standards/24 信任边界轴：user = JWT 第一方登录用户调用、跨域、不属任何单一产品域
 * 的通用能力（credits 自助余额/签到、notifications 用户自助通知）。各 controller 的
 * service 仍由对应 platform 模块提供（此处 import 取用，不重复注册）。
 *
 * 区别于：admin = 运营管理面（AdminGuard，跨域/平台治理）；system = 平台基建握手；
 * external = 非第一方（API-key/协议）。
 *
 * 2026-06-03 MECE 重组：从 OpenApiSystemModule 迁入 CreditsController /
 * NotificationController。agents / skills / ai 通用能力 API 各自有独立 module
 * （AgentsModule / SkillsModule / AiModule），同属 user 区，直接在 app.module 装配。
 */
@Module({
  imports: [CreditsModule, NotificationModule],
  controllers: [CreditsController, NotificationController],
})
export class OpenApiUserModule {}
