import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller";
import { AuthModule } from "../../platform/auth/auth.module";
// MetricsController（/metrics Prometheus 端点）：MetricsService 由 @Global MonitoringModule
// 提供，无需 import；@SkipTransform 随 controller 保留，Prometheus 抓取行为不变。
import { MetricsController } from "./metrics/metrics.controller";

/**
 * Open-API System Module（平台基建 / 握手面 · 零业务）
 *
 * standards/24 信任边界轴：system = 平台基建/握手，零业务（auth 登录握手、
 * metrics 平台指标）。engine/harness/platform 永不开 HTTP，service 留 L1 platform，
 * HTTP 入口进 L4 open-api。
 *
 * 2026-06-03 MECE 重组：credits / notifications（一方登录用户的跨域自助能力）
 * 已迁出本模块 → open-api/user（OpenApiUserModule）。system 仅保留 auth + metrics。
 */
@Module({
  imports: [AuthModule], // exports AuthService / GoogleAuthGuard 供 controller 注入
  controllers: [AuthController, MetricsController],
})
export class OpenApiSystemModule {}
