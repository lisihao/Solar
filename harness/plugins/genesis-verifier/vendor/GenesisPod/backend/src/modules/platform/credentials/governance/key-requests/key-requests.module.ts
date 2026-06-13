import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { KeyAssignmentsModule } from "../key-assignments/key-assignments.module";
import { NotificationModule } from "@/modules/platform/notifications/notification.module";
import { KeyRequestsService } from "./key-requests.service";

@Module({
  imports: [PrismaModule, KeyAssignmentsModule, NotificationModule],
  // PR-X17: HTTP Controllers moved to open-api/admin/byok or ai-app/byok
  controllers: [],
  providers: [KeyRequestsService],
  exports: [KeyRequestsService],
})
export class KeyRequestsModule {}
