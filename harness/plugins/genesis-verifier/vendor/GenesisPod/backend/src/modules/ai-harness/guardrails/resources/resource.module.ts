/**
 * Runtime Resource Module
 *
 * 提供 AI Engine runtime 层的资源管理与约束能力：
 * - ResourceManagerService: 资源配额管理
 * - CircuitBreakerService: 断路器
 * - ConstraintEngine / ConstraintEnforcementService: 三轴约束评估 & 强制
 * - CostController: 成本控制
 * - MissionTokenLedger: Token 预算
 * - MissionElectionTracker: mission 级模型选举多样性状态（2026-06-02 P0-1 自
 *   ai-engine/llm/models/selection 迁入；mission 状态属 L2.5）。@Global 导出，全局可注入。
 *
 * HealthCheckRunner 是纯类（非 @Injectable），消费者 `new HealthCheckRunner({...})`
 * 自己持有。不要把它放进 providers——Nest 会尝试注入 undefined 导致启动崩溃。
 * 需要使用时从 `@/modules/ai-engine/facade` 导入该 class 即可。
 *
 * 本模块是 @Global()。
 */

import { forwardRef, Global, Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { AiEngineToolsModule } from "@/modules/ai-engine/tools/tools.module";
import { AiEngineSkillsModule } from "@/modules/ai-engine/skills/skills.module";
import { AiEnginePlanningModule } from "@/modules/ai-engine/planning/planning.module";
// CostController 走 ModelPricingRegistry 单源（DB AIModel 表），删 6 模型硬编码价格表。
import { AiEngineLLMModule } from "@/modules/ai-engine/llm/llm.module";
import { KeyResolverModule } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.module";
import { SecretsModule } from "@/modules/platform/credentials/storage/secrets/secrets.module";
import { ResourceManagerService } from "./resource-manager.service";
// CircuitBreakerService 已搬到 ai-engine/safety/resilience/（PR-X3）
import { ConstraintEngine } from "../constraints/constraint-engine";
import { ConstraintEnforcementService } from "../constraints/constraint-enforcement.service";
import { CostController } from "./cost-controller";
import { MissionTokenLedger } from "../runtime/token-budget.service";
import { MissionElectionTracker } from "../runtime/mission-election-tracker.service";
import { RuntimeEnvironmentService } from "../runtime/runtime-environment.service";

const RUNTIME_RESOURCE_PROVIDERS = [
  ResourceManagerService,
  ConstraintEngine,
  ConstraintEnforcementService,
  CostController,
  MissionTokenLedger,
  MissionElectionTracker,
  RuntimeEnvironmentService,
];

@Global()
@Module({
  imports: [
    PrismaModule,
    // 引入三个 L2 registry 模块（legacy AgentRegistry + ToolRegistry + SkillRegistry）。
    // SpecAgentRegistry / ToolCircuitBreaker 走 DI token 模式（见
    // runtime-resource.abstractions.ts），由 ai-harness 模块在自己的 providers 里
    // 用 useExisting 绑到 token 上，因此本模块**不**直接 import ai-harness。
    forwardRef(() => AiEngineToolsModule),
    forwardRef(() => AiEngineSkillsModule),
    forwardRef(() => AiEnginePlanningModule),
    forwardRef(() => AiEngineLLMModule),
    // discoverUserKeys 真接 KeyResolver + Secrets（替换原来写死的 hasByok=false）
    KeyResolverModule,
    SecretsModule,
  ],
  providers: RUNTIME_RESOURCE_PROVIDERS,
  exports: RUNTIME_RESOURCE_PROVIDERS,
})
export class RuntimeResourceModule {}
