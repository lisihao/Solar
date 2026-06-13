/**
 * AI Engine - Reliability Module
 *
 * agent 无关的可靠性原语聚合（W7：从 safety 杂货筐拆出）：
 * - EntityHealthRegistry：多实体健康注册 + selectBest 选择（喂 routing 的 health 信号）
 * - RateLimitService：token-bucket 限流（global / per-tenant / per-agentType）
 *
 * @Global —— 这两个原语被 engine/harness/app 多处注入；声明全局单例，避免在
 * 多个模块各自 providers 注册导致**有状态注册表 split-brain**（W7 同时修复此旧隐患：
 * 原先 safety/constraint + planning + tools 三处重复 provide）。
 */

import { Global, Module } from "@nestjs/common";
import { CacheModule } from "@/common/cache/cache.module";
import { EntityHealthRegistry } from "./entity-health/entity-health.registry";
import { RateLimitService } from "./rate-limit/rate-limit.service";

@Global()
@Module({
  imports: [CacheModule],
  providers: [EntityHealthRegistry, RateLimitService],
  exports: [EntityHealthRegistry, RateLimitService],
})
export class AiEngineReliabilityModule {}
