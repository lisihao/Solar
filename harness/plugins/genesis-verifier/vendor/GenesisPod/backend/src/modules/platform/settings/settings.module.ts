/**
 * Settings Module
 *
 * Provides system configuration management for admins
 */

import { Module, Global } from "@nestjs/common";
import { SettingsService } from "./settings.service";

// HTTP 层（SettingsController，admin/settings）已上提到 open-api/admin（System HTTP → L4）。
// @Global SettingsService 留 L1 platform，全局可注入（含上提后的 controller）。
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
