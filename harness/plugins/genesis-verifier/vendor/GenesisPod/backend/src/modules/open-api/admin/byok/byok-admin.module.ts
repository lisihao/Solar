/**
 * BYOK Admin API Module (open-api/admin/byok)
 *
 * 路由：/admin/{key-assignments,key-requests,byok-dashboard}/*
 *
 * 2026-05-08 v5（drop_distributable_keys）:
 *   - 删除 DistributableKeysController（密钥池抽象已废弃）
 *   - 管理员秘钥配置入口已收敛到 /admin/ai/models（AIModel.apiKey 单一源）
 *   - 用户授权入口在用户管理行内 🔑 按钮（PR-D 模型粒度）
 */

import { Module } from "@nestjs/common";
import { AdminKeyAssignmentsController } from "./admin-key-assignments.controller";
import { AdminKeyRequestsController } from "./admin-key-requests.controller";
import { AdminByokDashboardController } from "./admin-byok-dashboard.controller";
import { KeyAssignmentsModule } from "../../../platform/credentials/governance/key-assignments";
import { KeyRequestsModule } from "../../../platform/credentials/governance/key-requests";
import { KeyResolverModule } from "../../../platform/credentials/resolution/key-resolver";
import { ByokDashboardService } from "@/modules/platform/credentials/dashboard/byok-dashboard.service";

@Module({
  imports: [KeyAssignmentsModule, KeyRequestsModule, KeyResolverModule],
  controllers: [
    AdminKeyAssignmentsController,
    AdminKeyRequestsController,
    AdminByokDashboardController,
  ],
  // AdminByokDashboardController injects ByokDashboardService (only dep: global
  // PrismaService). It is declared here — not in AdminModule where the controller
  // does not live — so it resolves within ByokAdminModule's own context.
  providers: [ByokDashboardService],
})
export class ByokAdminModule {}
