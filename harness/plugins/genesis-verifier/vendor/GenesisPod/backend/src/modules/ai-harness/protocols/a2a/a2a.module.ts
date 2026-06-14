/**
 * A2A (Agent-to-Agent) Module
 * 将 GenesisPod 暴露为 A2A 兼容的 Agent，让外部 AI Agent 可以发现和调用 GenesisPod 能力。
 *
 * TraceCollectorService 来自 @Global() ObservabilityModule，本模块无需再次注册为 provider。
 */

/**
 * A2A (Agent-to-Agent) Module
 * 将 GenesisPod 暴露为 A2A 兼容的 Agent，让外部 AI Agent 可以发现和调用 GenesisPod 能力。
 *
 * Controller (A2AController) 迁移至 open-api/external/a2a/a2a-server.controller.ts (PR-X17)。
 * DI token 绑定保留在本模块（作为服务协议层）。
 *
 * TraceCollectorService 来自 @Global() ObservabilityModule，本模块无需再次注册为 provider。
 */

import { Module } from "@nestjs/common";
import { AgentCardRegistry } from "./agent-card.registry";
import { A2AApiKeyGuard } from "./guards/a2a-api-key.guard";
import { A2ARpcService } from "./a2a-rpc.service";
import { A2ATaskStore } from "./a2a-task-store";
import { TEAMS_SERVICE_TOKEN, TRACE_COLLECTOR_TOKEN } from "./a2a.tokens";
import { SecretsModule } from "../../../platform/credentials/storage/secrets/secrets.module";
import { TeamsModule } from "../../teams/teams.module";
import { TeamsService } from "../../teams/services/teams.service";
import { TraceCollectorService } from "../../../ai-harness/tracing/observability/trace-collector.service";

@Module({
  imports: [SecretsModule, TeamsModule],
  providers: [
    AgentCardRegistry,
    A2AApiKeyGuard,
    // 2026-05-01 (PR-X-P): A2A v0.3 JSON-RPC handler service
    A2ARpcService,
    // G3: A2A task contextId/历史持久化（Redis via @Global CacheService；缺则进程内回退）
    A2ATaskStore,
    // DI token bindings: A2AController (in open-api/external/a2a/a2a-server.controller.ts) injects via token
    {
      provide: TEAMS_SERVICE_TOKEN,
      useExisting: TeamsService,
    },
    {
      provide: TRACE_COLLECTOR_TOKEN,
      useExisting: TraceCollectorService,
    },
  ],
  exports: [
    AgentCardRegistry,
    A2AApiKeyGuard,
    A2ARpcService,
    TEAMS_SERVICE_TOKEN,
    TRACE_COLLECTOR_TOKEN,
    // PR-X22: re-export SecretsModule so that consumers (e.g. A2AModule which
    // declares A2AController + uses @UseGuards(A2AApiKeyGuard)) can resolve the
    // guard's SecretsService dep in their own module context.
    SecretsModule,
  ],
})
export class A2AModule {}
