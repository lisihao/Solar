/**
 * AgentPlaygroundEventRelay — playground 业务 event relay (thin extends)
 *
 * 2026-05-08 PR-E1：原 ~360 行 emit + tickCost + IAgentEvent 翻译已上提到
 * `ai-harness/teams/business-team/events/event-relay.framework.ts`。本类仅作为
 * playground 业务专属 namespace 实例，extends framework 注入 "playground"
 * 前缀，向后兼容现有 import 路径与构造函数签名。
 */

import { EventBus } from "@/modules/ai-harness/facade";
import { EventRelayFramework } from "@/modules/ai-harness/facade";
import type { InvocationContext } from "../mission/roles/agent-invoker.service";

export class AgentPlaygroundEventRelay extends EventRelayFramework {
  constructor(eventBus: EventBus) {
    super(eventBus, "playground");
  }
}

/**
 * Type re-export：framework 的 EventRelayContext 与 playground InvocationContext
 * 的 4 个字段（missionId/userId/agentId/role）兼容；invoker.invoke 直接传
 * InvocationContext 给 framework.relayAgentEvents（structural typing 自动校验）。
 */
export type { InvocationContext };
