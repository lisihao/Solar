import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { UserToolsService } from "./user-tools.service";

@Module({
  imports: [PrismaModule],
  providers: [UserToolsService],
  exports: [UserToolsService],
})
export class UserToolsModule {}
