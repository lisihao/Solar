/**
 * InMemoryCheckpointStore — 测试 + 开发用内存实现
 *
 * 生产环境应替换为 Prisma 持久化（已有 ai-harness/protocols/journal/checkpoint-manager
 * 可作为适配层）。本 phase 只做 in-memory，保持 Phase 6 聚焦在 Harness 层协议。
 */

import { Injectable } from "@nestjs/common";
import type { ICheckpoint, ICheckpointStore } from "./checkpoint.types";

@Injectable()
export class InMemoryCheckpointStore implements ICheckpointStore {
  private readonly byId = new Map<string, ICheckpoint>();
  private readonly byAgent = new Map<string, string[]>();

  async save(checkpoint: ICheckpoint): Promise<void> {
    this.byId.set(checkpoint.id, checkpoint);
    const list = this.byAgent.get(checkpoint.agentId) ?? [];
    list.push(checkpoint.id);
    this.byAgent.set(checkpoint.agentId, list);
  }

  async load(id: string): Promise<ICheckpoint | null> {
    return this.byId.get(id) ?? null;
  }

  async listByAgent(agentId: string): Promise<readonly ICheckpoint[]> {
    const ids = this.byAgent.get(agentId) ?? [];
    return ids
      .map((id) => this.byId.get(id))
      .filter((cp): cp is ICheckpoint => cp !== undefined);
  }

  async delete(id: string): Promise<void> {
    const cp = this.byId.get(id);
    if (!cp) return;
    this.byId.delete(id);
    const list = this.byAgent.get(cp.agentId);
    if (list) {
      const idx = list.indexOf(id);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  async clear(): Promise<void> {
    this.byId.clear();
    this.byAgent.clear();
  }

  /** 测试用 */
  size(): number {
    return this.byId.size;
  }
}
