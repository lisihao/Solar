/**
 * AgentStepCheckpointService — Agent 单步执行的快照与恢复（react-loop / agent runtime 粒度）
 *
 * 2026-05-15 改名: 原叫 `CheckpointService`，与 `memory/mission-checkpoint/MissionCheckpointService`
 * 同语义不同 scope 容易混淆。已彻底改名，无 alias 期。
 *
 * 与 MissionCheckpointService 的区别（MECE）：
 *   - 本类: agent step / react loop iteration 粒度，by agentId，用于 agent 中断恢复
 *   - MissionCheckpointService: mission / business stage 粒度，by missionId，用于业务级 resume
 *
 * 职责：
 *   - snapshot()：把当前 agent 状态打包成一条 checkpoint
 *   - load()：按 id 读回 checkpoint
 *   - latestForAgent()：取 agent 最新快照（resume 默认选这个）
 *
 * 重建 agent 的逻辑在 HarnessFacade.resume() 里。
 */

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  AgentId,
  AgentState,
  IAgentIdentity,
  IContextEnvelope,
} from "../../agents/abstractions";
import type {
  CheckpointReason,
  ICheckpoint,
  ICheckpointService,
  ICheckpointStore,
} from "./checkpoint.types";
import { InMemoryCheckpointStore } from "./in-memory-checkpoint-store";

@Injectable()
export class AgentStepCheckpointService implements ICheckpointService {
  private readonly logger = new Logger(AgentStepCheckpointService.name);

  constructor(
    private readonly store: ICheckpointStore = new InMemoryCheckpointStore(),
  ) {}

  async snapshot(params: {
    agentId: AgentId;
    agentState: AgentState;
    envelope: IContextEnvelope;
    identity: IAgentIdentity;
    eventsEmitted: number;
    reason: CheckpointReason;
    taskSnapshot?: ICheckpoint["taskSnapshot"];
  }): Promise<ICheckpoint> {
    const checkpoint: ICheckpoint = {
      id: randomUUID(),
      agentId: params.agentId,
      // HARNESS-SEC-001：从 envelope.memory 捕获归属用户，供 resume/fork 属主校验
      //   （optional chain：memory 缺失=系统/匿名断点 → ownerUserId undefined）
      ownerUserId: params.envelope.memory?.userId,
      takenAt: Date.now(),
      reason: params.reason,
      agentState: params.agentState,
      envelope: params.envelope,
      identity: params.identity,
      eventsEmitted: params.eventsEmitted,
      taskSnapshot: params.taskSnapshot,
    };
    await this.store.save(checkpoint);
    this.logger.debug(
      `[snapshot] agent=${params.agentId} reason=${params.reason} events=${params.eventsEmitted}`,
    );
    return checkpoint;
  }

  async load(id: string): Promise<ICheckpoint | null> {
    return this.store.load(id);
  }

  async latestForAgent(agentId: AgentId): Promise<ICheckpoint | null> {
    const list = await this.store.listByAgent(agentId);
    if (list.length === 0) return null;
    return list.reduce((latest, cur) =>
      cur.takenAt > latest.takenAt ? cur : latest,
    );
  }

  async listForAgent(agentId: AgentId): Promise<readonly ICheckpoint[]> {
    return this.store.listByAgent(agentId);
  }
}
