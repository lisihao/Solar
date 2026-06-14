import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { SecretsModule } from "@/modules/platform/credentials/storage/secrets/secrets.module";
import { NotificationModule } from "@/modules/platform/notifications/notification.module";
import { KeyAssignmentsService } from "./key-assignments.service";

@Module({
  imports: [PrismaModule, SecretsModule, NotificationModule],
  controllers: [],
  providers: [KeyAssignmentsService],
  exports: [KeyAssignmentsService],
})
export class KeyAssignmentsModule {}
