/**
 * A2A API Module — open-api layer for Agent-to-Agent protocol endpoints
 *
 * This module exposes A2AController in the open-api layer.
 * Service infrastructure (AgentCardRegistry, DI tokens, guards) lives in
 * ai-harness/protocols/a2a/a2a.module.ts.
 *
 * Controller migrated from ai-harness/protocols/a2a/a2a.controller.ts (PR-X17).
 */

import { Module } from "@nestjs/common";
import { A2AController } from "./a2a-server.controller";
import { A2ARpcController } from "./a2a-rpc.controller";
import { A2AModule } from "../../../ai-harness/protocols/a2a/a2a.module";

@Module({
  imports: [A2AModule],
  // 2026-05-01 (PR-X-P): 同时挂 v0.1 legacy controller + v0.3 JSON-RPC controller
  controllers: [A2AController, A2ARpcController],
})
export class A2AApiModule {}
