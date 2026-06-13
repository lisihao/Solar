import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { StartupMigrationService } from "./startup-migration.service";

@Global()
@Module({
  providers: [PrismaService, StartupMigrationService],
  exports: [PrismaService],
})
export class PrismaModule {}
