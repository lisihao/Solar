import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AIController } from "./ai/ai.controller";
import { AiProvidersController } from "./providers/ai-providers.controller";
import { ApiFormatsController } from "./providers/api-formats.controller";
import { ModelTypesController } from "./providers/model-types.controller";
import { ProviderDiscoveryController } from "./providers/provider-discovery.controller";
import { AIAdminService } from "./ai/ai-admin.service";
import { LogsController } from "./logs/logs.controller";
import { PermissionsController } from "./permissions/permissions.controller";
import { BillingController } from "./billing/billing.controller";
import { NotificationsController } from "./notifications/notifications.controller";
import { MonitoringController } from "./monitoring/monitoring.controller";
import { CacheController } from "./cache/cache.controller";
import { AgentController } from "./agent/agent.controller";
import { ApprovalsController } from "./approvals/approvals.controller";
import { KernelController } from "./kernel/kernel.controller";
import { AdminModelRecommendationsController } from "./recommendations/model-recommendations.controller";
import { ObservabilityController } from "./observability/observability.controller";
import { HarnessInspectorController } from "./harness/harness-inspector.controller";
import { EvalController } from "./eval/eval.controller";
import { ConsolidationController } from "./consolidation/consolidation.controller";
import { OpsDashboardController } from "./dashboard/ops-dashboard.controller";
import { OpsDashboardService } from "./dashboard/ops-dashboard.service";
import { OverviewStatusController } from "./overview/overview-status.controller";
import { OverviewStatusService } from "./overview/overview-status.service";
import { TenantStatusController } from "./tenants/tenant-status.controller";
import { TenantStatusService } from "./tenants/tenant-status.service";
import { MCPExternalController } from "./mcp/external-servers.controller";
import { MCPServerController } from "./mcp/server.controller";
import { AdminCreditsController } from "./credits/admin-credits.controller";
import { ByokDashboardService } from "@/modules/platform/credentials/dashboard/byok-dashboard.service";
import { HumanApprovalAdminService } from "@/modules/ai-harness/lifecycle/human-approval-admin.service";
import { ProcessJournalQueryService } from "@/modules/ai-harness/memory/process-journal-query.service";
import { DbHealthService } from "@/modules/platform/monitoring/db-health.service";
import { CreditsModule } from "../../platform/credits/credits.module";
// ★ 2026-06-03 standards/16: System HTTP 上提——platform 的 admin/* controller
//   迁入 open-api/admin（System API 网关），对应 service 留 L1 platform。
import { SecretsController } from "./secrets/secrets.controller";
import { SecretKeysController } from "./secrets/secret-keys.controller";
import { DbOpsController } from "./db-ops/db-ops.controller";
import { SettingsController } from "./settings/settings.controller";
import { StorageGovernanceController } from "./storage/storage-governance.controller";
import { AgentConfigService } from "../../ai-harness/facade";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
import { SecretsModule } from "../../platform/credentials/storage/secrets/secrets.module";
import { KeyAssignmentsModule } from "../../platform/credentials/governance/key-assignments/key-assignments.module";
import { QuotaModule } from "./quota/quota.module";
import { MCPServerModule } from "../../open-api/external/mcp/mcp-server.module";
import { StorageModule } from "../../platform/storage/storage.module";
import { DbOpsModule } from "../../platform/db-ops/db-ops.module";

// Admin sub-services
import {
  UserManagementService,
  ResourceManagementService,
  StatisticsService,
  LogsService,
  PermissionsService,
  BillingService,
  NotificationsAdminService,
} from "./services";

// Monitoring services (from shared MonitoringModule, globally available)
// ErrorTrackingService and AIMetricsService are provided by MonitoringModule

@Module({
  imports: [
    PrismaModule,
    AiEngineModule,
    SecretsModule,
    KeyAssignmentsModule, // PR-6: 让 AdminService 能在 updateAIModel 时反向恢复 STALE
    QuotaModule,
    MCPServerModule,
    CreditsModule, // AdminCreditsController 注入 CreditsService/CreditRulesService
    StorageModule,
    DbOpsModule, // DbOpsService（admin/tables controller 上提后注入）；SettingsService/EmailService/SecretsService 已 @Global 或经 SecretsModule 提供
  ],
  controllers: [
    AdminController,
    // ★ 2026-06-03 standards/16 System HTTP 上提（route/guard 原样保留）
    SecretsController, // admin/secrets/*
    SecretKeysController, // admin/secrets/:secretId/keys/*
    DbOpsController, // admin/tables/*
    SettingsController, // admin/settings/*
    StorageGovernanceController, // storage/* (STORAGE_ADMIN_KEY header 鉴权的运维清理端点)
    AIController, // /admin/ai/* routes for tools, skills, mcp-servers
    LogsController, // /admin/logs/* routes
    PermissionsController, // /admin/permissions/* routes
    BillingController, // /admin/billing/* routes
    NotificationsController, // /admin/notifications/* routes
    MonitoringController, // /admin/monitoring/* routes for error tracking & AI metrics
    CacheController, // /admin/cache/* routes for cache management
    MCPExternalController, // /admin/mcp/external-servers/* routes
    MCPServerController, // /admin/mcp/server（原 mcp-server-admin，admin/mcp-server 路由）
    AdminCreditsController, // /admin/credits（从 system/credits 拆出）
    AgentController, // /admin/agents/* routes for agent configuration
    ApprovalsController, // /admin/approvals/* routes for human-in-the-loop approvals
    KernelController, // /admin/kernel/* routes for AI Kernel process management
    AdminModelRecommendationsController, // /admin/ai-models/auto-configure + /admin/model-recommendations
    ObservabilityController, // /admin/traces/* routes (PR-X17: migrated from ai-harness/tracing)
    EvalController, // /admin/evals/* routes for eval runs and experiments
    ConsolidationController, // /admin/dreaming/* 2026-05-15 PR-I Dreaming（主动反思）骨架
    AiProvidersController, // /admin/ai-providers/* PR-1 数据驱动 provider catalog
    ApiFormatsController, // /admin/api-formats/* 2026-05-11 P3 ApiFormat CRUD
    ModelTypesController, // /admin/model-types/* 2026-05-11 P3 ModelType CRUD
    ProviderDiscoveryController, // /admin/ai-models/discover 2026-05-11 P5 一键探测
    OpsDashboardController, // /admin/dashboard/* 运营看板（运营看板 W5）
    OverviewStatusController, // /admin/overview-status 架构图实时状态（30s 轮询）
    TenantStatusController, // /admin/tenants/status 全租户状态总览
    ...(process.env.NODE_ENV === "production"
      ? []
      : [HarnessInspectorController]), // /harness/inspector/* routes (PR-X17: migrated from ai-harness/agents/dev-tools)
  ],
  providers: [
    AdminService,
    ByokDashboardService, // Wave C
    HumanApprovalAdminService, // Wave C
    ProcessJournalQueryService, // Wave C
    DbHealthService, // Wave C
    AIAdminService,
    // Admin sub-services (dependencies of AdminService)
    UserManagementService,
    ResourceManagementService,
    StatisticsService,
    LogsService,
    PermissionsService,
    BillingService,
    NotificationsAdminService,
    AgentConfigService,
    OpsDashboardService, // 运营看板聚合（运营看板 W5）
    OverviewStatusService, // 架构图实时状态聚合
    TenantStatusService, // 全租户状态聚合
    // Note: ErrorTrackingService and AIMetricsService are provided globally by MonitoringModule
  ],
  exports: [
    AdminService,
    AIAdminService,
    UserManagementService,
    ResourceManagementService,
    StatisticsService,
    LogsService,
    PermissionsService,
    BillingService,
    NotificationsAdminService,
    // Note: ErrorTrackingService and AIMetricsService are exported globally by MonitoringModule
  ],
})
export class AdminModule {}
