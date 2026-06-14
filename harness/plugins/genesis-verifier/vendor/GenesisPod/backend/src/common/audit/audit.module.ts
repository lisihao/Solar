/**
 * Audit Module
 *
 * 提供审计日志能力
 * 设计为全局单例模块
 */

import { Module, Global } from "@nestjs/common";
import { AuditService } from "./audit.service";

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
