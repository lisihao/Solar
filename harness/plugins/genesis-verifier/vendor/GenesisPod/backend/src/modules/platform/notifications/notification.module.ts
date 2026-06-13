import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { NotificationService } from "./notification.service";
import { NotificationPresetsService } from "./presets/notification-presets.service";
import { NotificationGateway } from "./notification.gateway";
import { NotificationEventListener } from "./notification-event-listener.service";
import { PrismaModule } from "../../../common/prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
      inject: [ConfigService],
    }),
  ],
  // NotificationController（notifications，jwt 一方用户）已上提到 open-api/system
  // （System HTTP → L4）；NotificationService 留 L1 platform 并导出。
  // NotificationGateway（WebSocket）留此（gateway 非 HTTP controller）。
  providers: [
    NotificationService,
    NotificationPresetsService,
    NotificationGateway,
    // 2026-06-03: 从解散的 notifications-bridge 迁入；@OnEvent 业务无关，归位 platform。
    NotificationEventListener,
  ],
  exports: [NotificationService, NotificationPresetsService],
})
export class NotificationModule {}
