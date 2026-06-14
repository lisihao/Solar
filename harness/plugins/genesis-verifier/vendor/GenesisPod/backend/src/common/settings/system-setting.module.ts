/**
 * SystemSettingModule
 *
 * Provides read-only access to SystemSetting values.
 * Depends only on PrismaModule — no heavy module imports.
 *
 * Use this module when a service needs to read system settings (API keys,
 * feature flags, provider config) without pulling in AdminModule.
 */

import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SystemSettingService } from "./system-setting.service";

@Module({
  imports: [PrismaModule],
  providers: [SystemSettingService],
  exports: [SystemSettingService],
})
export class SystemSettingModule {}
