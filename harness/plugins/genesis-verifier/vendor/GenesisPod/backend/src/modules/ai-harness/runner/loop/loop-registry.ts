/**
 * LoopRegistry — AgentLoop 多策略注册中心
 *
 * 解决 HarnessFacade.registerLoop 旧实现是 no-op 的问题。
 *
 * 启动时由 HarnessModule 把内置 loops（react / plan-execute / reflexion）注册进来，
 * 业务方也可以通过 facade.registerLoop() 注册自定义 loop（如 ToT、Debate、SWE-style）。
 *
 * AgentFactory 在 createAgent 时按 spec.loop 字段从这里取实现；缺省 react。
 */

import { Injectable } from "@nestjs/common";
import type { AgentLoopKind, IAgentLoop } from "../../agents/abstractions";

@Injectable()
export class LoopRegistry {
  private readonly loops = new Map<AgentLoopKind, IAgentLoop>();

  register(loop: IAgentLoop): void {
    this.loops.set(loop.kind, loop);
  }

  get(kind: AgentLoopKind): IAgentLoop {
    const loop = this.loops.get(kind);
    if (!loop) {
      throw new Error(
        `LoopRegistry: no loop registered for kind="${kind}". ` +
          `Available: ${[...this.loops.keys()].join(", ") || "(none)"}`,
      );
    }
    return loop;
  }

  has(kind: AgentLoopKind): boolean {
    return this.loops.has(kind);
  }

  list(): AgentLoopKind[] {
    return [...this.loops.keys()];
  }
}
