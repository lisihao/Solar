import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * 数据库健康/连接池监控服务。
 * standards/24 薄网关整改（Wave C）：monitoring.controller 的 database/health
 * 与 database/pool 端点不再直接注入 PrismaService，委派至此（DB 监控属 platform/monitoring）。
 */
@Injectable()
export class DbHealthService {
  constructor(private readonly prisma: PrismaService) {}

  databaseHealth() {
    return this.prisma.healthCheck();
  }

  databasePoolStats() {
    return this.prisma.getPoolStats();
  }
}
