import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { ResourceLifecycleService } from "./resource-lifecycle.service";

/**
 * 拆出独立模块以打破循环：
 *   ResourcesModule imports IngestionConfigModule (existing)
 *   IngestionConfigModule needs ResourceLifecycleService (new)
 * 把 lifecycle 单独成模，两边都 import 这个就不绕死。
 */
@Module({
  imports: [PrismaModule],
  providers: [ResourceLifecycleService],
  exports: [ResourceLifecycleService],
})
export class ResourceLifecycleModule {}
