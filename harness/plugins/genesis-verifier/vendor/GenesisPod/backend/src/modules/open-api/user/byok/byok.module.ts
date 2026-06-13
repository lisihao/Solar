/**
 * BYOK Module (Bring Your Own Key) — User-facing credential management
 *
 * User-facing controllers for personal API key management and model configuration.
 * Services remain in platform/credentials (credential infrastructure).
 *
 * Controllers migrated from platform/credentials/* (PR-X17, 5 个 user 控制器)
 * + ai-engine/llm/user-models.controller.ts (PR-X17, 模型发现/自动配置)。
 *
 * Routes:
 *   GET   /user/api-keys/*                          — 用户 BYOK Key 管理
 *   GET   /user/key-assignments/*                   — 分配查看
 *   POST  /user/key-requests/*                      — 申请共享 Key
 *   GET   /user/byok                                — BYOK 状态查询
 *   GET   /user/model-configs/*                     — 模型配置 CRUD
 *   POST  /user/api-keys/:provider/available-models — dynamic model discovery
 *   POST  /user/model-configs/auto-configure        — one-click AI setup
 */

import { Module } from "@nestjs/common";
import {
  UserModelsController,
  UserModelConfigsAutoController,
} from "./user-models.controller";
import { UserKeyAssignmentsController } from "./key-assignments.controller";
import { UserKeyRequestsController } from "./key-requests.controller";
import { UserByokController } from "./user-byok.controller";
import { UserApiKeysController } from "./user-api-keys.controller";
import { UserModelConfigsController } from "./user-model-configs.controller";
import { UserProvidersController } from "./user-providers.controller";
import { UserByokService } from "./user-byok.service";
import { UserProvidersService } from "./user-providers.service";
import { UserSecretsController } from "./user-secrets.controller";
import {
  UserAuthorizationController,
  AdminAuthorizationController,
} from "./authorization.controller";
import { UserToolsController } from "./user-tools.controller";
import { UserSkillsController } from "./user-skills.controller";
import { UserSkillsService } from "./user-skills.service";
import { AiEngineLLMModule } from "../../../ai-engine/llm/llm.module";
import { AiEngineSkillsModule } from "../../../ai-engine/skills/skills.module";
import { PrismaModule } from "../../../../common/prisma/prisma.module";
import { UserApiKeysModule } from "../../../platform/credentials/user-owned/user-api-keys/user-api-keys.module";
import { UserModelConfigsModule } from "../../../platform/credentials/user-owned/user-model-configs/user-model-configs.module";
import { UserSecretsModule } from "../../../platform/credentials/user-owned/user-secrets/user-secrets.module";
import { SecretsModule } from "../../../platform/credentials/storage/secrets/secrets.module";
import { UserToolsModule } from "../../../platform/credentials/user-owned/user-tools/user-tools.module";
import { AuthorizationModule } from "../../../platform/credentials/governance/authorization/authorization.module";
import { KeyAssignmentsModule } from "../../../platform/credentials/governance/key-assignments";
import { KeyRequestsModule } from "../../../platform/credentials/governance/key-requests";
import { KeyResolverModule } from "../../../platform/credentials/resolution/key-resolver";
import { KeyHealthModule } from "../../../platform/credentials/governance/key-health/key-health.module";

@Module({
  imports: [
    AiEngineLLMModule,
    AiEngineSkillsModule,
    PrismaModule,
    UserApiKeysModule,
    UserModelConfigsModule,
    UserSecretsModule,
    SecretsModule, // 2026-05-29 BYOK 多 Key：复用 admin SecretsService/SecretKeysService（user 作用域）
    UserToolsModule,
    AuthorizationModule,
    KeyAssignmentsModule,
    KeyRequestsModule,
    KeyResolverModule,
    KeyHealthModule, // 2026-06-02 Test Connection 成功后 forceHealthy 清除 key 的 DEAD 状态
  ],
  providers: [UserSkillsService, UserByokService, UserProvidersService],
  controllers: [
    UserModelsController,
    UserModelConfigsAutoController,
    UserKeyAssignmentsController,
    UserKeyRequestsController,
    UserByokController,
    UserApiKeysController,
    UserModelConfigsController,
    UserProvidersController, // PR-3: 用户自定义 provider CRUD
    UserSecretsController, // 2026-05-27 BYOK 全量化：统一 Key 表格
    UserToolsController, // 2026-05-27 BYOK：我的工具目录 + Key 状态
    UserSkillsController, // 2026-05-28 BYOK：我的技能目录(授权版) + 授权状态
    UserAuthorizationController, // 2026-05-27 BYOK：用户申请授权
    AdminAuthorizationController, // 2026-05-27 BYOK：admin 审批授权
  ],
})
export class ByokModule {}
