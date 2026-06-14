/**
 * Release 发布通知模块
 *
 * 功能：
 * - 收集 Git 变更信息
 * - 使用 AI 生成发布说明
 * - 批量推送通知给所有用户
 */

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { NotificationModule } from "../notifications/notification.module";
import { ReleaseService } from "./release.service";

@Module({
  imports: [PrismaModule, NotificationModule],
  providers: [ReleaseService],
  exports: [ReleaseService],
})
export class ReleaseModule {}
