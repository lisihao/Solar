import { Global, Module } from "@nestjs/common";
import { AiEnginePlanningModule } from "@/modules/ai-engine/planning/planning.module";
import { MissionStateManager } from "./mission-state.manager";
import { MissionContextService } from "./mission-context.service";
import { MissionInputService } from "./mission-input.service";

/**
 * Mission Context Module（W2-F：协作 mission 上下文/状态/输入服务从 ai-app/teams 迁入 harness）
 *
 * 这三个服务是 mission 协作的基础设施（非 teams 业务专属）：依赖 harness 的 AgentFacade /
 * ConstraintEnforcementService 与 engine 的 ContextBudgetCalculator，按 MECE 归 L2.5 harness。
 *
 * @Global：供 ai-app/teams 的 mission-execution/prompt/review/team-mission 经 facade 注入
 * （与其它 @Global harness 服务一致，app 无需显式 import 本模块）。
 *
 * 依赖来源（避免 facade barrel 值循环，被迁服务一律 import source 文件）：
 * - AgentFacade：@Global HarnessModule
 * - ConstraintEnforcementService：@Global RuntimeResourceModule
 * - ContextBudgetCalculator（TokenBudgetService 别名）：本模块 import AiEnginePlanningModule
 */
@Global()
@Module({
  imports: [AiEnginePlanningModule],
  providers: [MissionStateManager, MissionContextService, MissionInputService],
  exports: [MissionStateManager, MissionContextService, MissionInputService],
})
export class MissionContextModule {}
