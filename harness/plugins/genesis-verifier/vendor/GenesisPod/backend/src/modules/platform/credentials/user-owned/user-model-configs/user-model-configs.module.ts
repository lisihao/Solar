import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { UserModelConfigsService } from "./user-model-configs.service";

@Module({
  imports: [PrismaModule],
  // PR-X17: HTTP Controllers moved to open-api/admin/byok or ai-app/byok
  controllers: [],
  providers: [UserModelConfigsService],
  exports: [UserModelConfigsService],
})
export class UserModelConfigsModule {}
