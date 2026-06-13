import { Module, Global } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { HealthCheckService } from "./health/health-check.service";
import { AIMetricsService } from "./metrics/ai-metrics.service";
import { MetricsService } from "./metrics/metrics.service";
import { ErrorTrackingService } from "./error-reporting/error-tracking.service";
import { AuditLogService } from "./audit/audit-log.service";
// UserEventListener 含业务事件词表（TOPIC_INSIGHTS 等），留 common（L1 业务名禁令豁免），由本 @Global 模块装配
import { UserEventListener } from "@/common/observability/user-event.listener";

/**
 * 监控模块 - 提供全局可用的监控服务
 *
 * 包含:
 * - AIMetricsService: AI 指标收集（LLM 调用、Token 使用、成本估算）
 * - ErrorTrackingService: 错误跟踪和聚合
 * - HealthCheckService: 统一健康检查（DB/Cache/AI Engine）
 * - AuditLogService: append-only 高敏操作审计
 * - MetricsService: 进程内 Prometheus registry（W1-B 从 common/observability 并入）
 * - MetricsController: Prometheus /metrics 端点（canonical，单一来源）
 * - UserEventListener: user_events 批量 flush（@Global 自动注册）
 * 此模块是 @Global() 的，因此只需在 AppModule 中导入一次
 */
@Global()
@Module({
  imports: [PrismaModule],
  // MetricsController（/metrics Prometheus 端点）已上提到 open-api/system（System HTTP → L4）。
  // @SkipTransform/Public 随 controller 迁移；@Global MetricsService 留 platform，全局可注入。
  providers: [
    AIMetricsService,
    MetricsService,
    ErrorTrackingService,
    HealthCheckService,
    AuditLogService,
    UserEventListener,
  ],
  exports: [
    AIMetricsService,
    MetricsService,
    ErrorTrackingService,
    HealthCheckService,
    AuditLogService,
  ],
})
export class MonitoringModule {}
