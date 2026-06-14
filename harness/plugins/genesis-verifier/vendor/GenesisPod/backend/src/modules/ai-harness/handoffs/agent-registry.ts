/**
 * AgentRegistry —— 按 ID 查找运行中的 IAgent 实例（handoff 必需）
 *
 * 与 SpecAgentRegistry 区别：
 *   - SpecAgentRegistry: 静态 spec 注册（声明式 agent 定义）
 *   - AgentRegistry: 运行时实例注册（活的 agent，可 handoff 给）
 *
 * Lifecycle：
 *   - HarnessedAgent.execute() 开始时自动注册
 *   - terminated 事件后自动注销（防止持有死 agent 引用）
 */

import { Injectable, Logger } from "@nestjs/common";
import type { IAgent } from "@/modules/ai-harness/agents/abstractions";

@Injectable()
export class AgentRegistry {
  private readonly log = new Logger(AgentRegistry.name);
  private readonly byId = new Map<string, IAgent>();

  register(agent: IAgent): void {
    if (this.byId.has(agent.id)) {
      // 多次注册同 id 是 bug，但不抛错以免干扰 long-running agent
      this.log.warn(`Agent ${agent.id} already registered — overwriting`);
    }
    this.byId.set(agent.id, agent);
  }

  unregister(agentId: string): void {
    this.byId.delete(agentId);
  }

  get(agentId: string): IAgent | undefined {
    return this.byId.get(agentId);
  }

  has(agentId: string): boolean {
    return this.byId.has(agentId);
  }

  /** Test introspection */
  size(): number {
    return this.byId.size;
  }

  /** Test introspection */
  ids(): readonly string[] {
    return [...this.byId.keys()];
  }
}
