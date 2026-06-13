/**
 * LeaderInvocationFactory — 单源 LeaderRunFn 构造器
 *
 * 抽自 playground-pipeline-dispatcher + rerun-runtime-builder 重复实现。
 * 让 mission 跑期 + rerun cascade 共用同一闭包模板（invoker.invoke + billing
 * envAdapter + state 三态映射），任何行为调整改一处即可。
 */

import { Injectable } from "@nestjs/common";
import { AgentInvoker } from "../roles";
import type { LeaderRunFn } from "../roles/leader.service";
import type { LeaderAgent } from "../agents/leader/leader.agent";

@Injectable()
export class LeaderInvocationFactory {
  constructor(private readonly invoker: AgentInvoker) {}

  /**
   * 构造给 SupervisedMission.run 用的 LeaderRunFn 闭包。
   *
   * @param missionId   mission 标识，记入 invoker context 用于事件归属
   * @param userId      用户标识（同上）
   * @param billing     BillingRuntimeEnvAdapter 实例（envAdapter，转 never 因
   *                    AgentInvoker 接受 unknown env shape）
   */
  build(missionId: string, userId: string, billing: unknown): LeaderRunFn {
    return async <TIn, TOut>({
      spec,
      input,
      agentId,
    }: {
      spec: typeof LeaderAgent;
      input: TIn;
      agentId: string;
    }): Promise<{
      state: "completed" | "failed" | "cancelled";
      output?: TOut;
      events?: readonly unknown[];
    }> => {
      const result = await this.invoker.invoke(
        spec as unknown as typeof LeaderAgent,
        input as unknown as Record<string, unknown>,
        {
          missionId,
          userId,
          agentId,
          role: "leader",
          envAdapter: billing as never,
        },
      );
      return {
        state:
          result.state === "completed"
            ? "completed"
            : result.state === "cancelled"
              ? "cancelled"
              : "failed",
        output: result.output as TOut | undefined,
        events: result.events,
      };
    };
  }
}
