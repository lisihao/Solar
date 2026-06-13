/**
 * AI Kernel - Checkpoint Manager
 * 检查点管理器实现
 *
 * Migrated from ai-engine/planning/checkpoints/checkpoint-manager.ts
 */

import { v4 as uuid } from "uuid";
import { Logger } from "@nestjs/common";
import type {
  Checkpoint,
  ExecutionContext,
} from "../../teams/orchestrator/workflow-orchestrator.interface";
import { LruMap } from "@/common/utils/lru-map";

/**
 * 检查点存储接口
 */
export interface ICheckpointStore {
  save(checkpoint: Checkpoint): Promise<void>;
  get(id: string): Promise<Checkpoint | null>;
  getByExecution(executionId: string): Promise<Checkpoint[]>;
  getLatest(executionId: string): Promise<Checkpoint | null>;
  delete(id: string): Promise<boolean>;
  deleteByExecution(executionId: string): Promise<number>;
}

/**
 * 内存检查点存储
 */
export class InMemoryCheckpointStore implements ICheckpointStore {
  private readonly checkpoints = new LruMap<string, Checkpoint>(500);

  async save(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(checkpoint.id, checkpoint);
  }

  async get(id: string): Promise<Checkpoint | null> {
    return this.checkpoints.get(id) || null;
  }

  async getByExecution(executionId: string): Promise<Checkpoint[]> {
    return Array.from(this.checkpoints.values())
      .filter((cp) => cp.executionId === executionId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  async getLatest(executionId: string): Promise<Checkpoint | null> {
    const checkpoints = await this.getByExecution(executionId);
    return checkpoints[checkpoints.length - 1] || null;
  }

  async delete(id: string): Promise<boolean> {
    return this.checkpoints.delete(id);
  }

  async deleteByExecution(executionId: string): Promise<number> {
    let count = 0;
    for (const [id, cp] of this.checkpoints) {
      if (cp.executionId === executionId) {
        this.checkpoints.delete(id);
        count++;
      }
    }
    return count;
  }
}

/**
 * 检查点管理器配置
 */
export interface CheckpointManagerConfig {
  /**
   * 是否启用自动检查点
   */
  autoCheckpoint?: boolean;

  /**
   * 自动检查点间隔（步骤数）
   */
  checkpointInterval?: number;

  /**
   * 最大检查点数量
   */
  maxCheckpoints?: number;

  /**
   * 检查点过期时间（ms）
   */
  checkpointTTL?: number;
}

/**
 * 检查点管理器
 * 注意：使用工厂模式注册，不需要 @Injectable() 装饰器
 */
export class CheckpointManager {
  private readonly logger = new Logger(CheckpointManager.name);
  private readonly config: Required<CheckpointManagerConfig>;
  private store: ICheckpointStore;

  private static readonly DEFAULT_CONFIG: Required<CheckpointManagerConfig> = {
    autoCheckpoint: true,
    checkpointInterval: 5,
    maxCheckpoints: 10,
    checkpointTTL: 24 * 60 * 60 * 1000, // 24 hours
  };

  constructor(store?: ICheckpointStore, config?: CheckpointManagerConfig) {
    this.store = store || new InMemoryCheckpointStore();
    this.config = { ...CheckpointManager.DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置检查点存储
   */
  setStore(store: ICheckpointStore): void {
    this.store = store;
  }

  /**
   * 创建检查点
   */
  async createCheckpoint(
    executionId: string,
    workflowId: string,
    stepId: string,
    context: ExecutionContext,
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: uuid(),
      executionId,
      workflowId,
      stepId,
      context: this.serializeContext(context),
      timestamp: new Date(),
    };

    await this.store.save(checkpoint);

    // 清理旧检查点
    await this.cleanupOldCheckpoints(executionId);

    this.logger.debug(
      `Created checkpoint ${checkpoint.id} for execution ${executionId} at step ${stepId}`,
    );

    return checkpoint;
  }

  /**
   * 获取检查点
   */
  async getCheckpoint(id: string): Promise<Checkpoint | null> {
    return this.store.get(id);
  }

  /**
   * 获取执行的所有检查点
   */
  async getCheckpoints(executionId: string): Promise<Checkpoint[]> {
    return this.store.getByExecution(executionId);
  }

  /**
   * 获取最新检查点
   */
  async getLatestCheckpoint(executionId: string): Promise<Checkpoint | null> {
    return this.store.getLatest(executionId);
  }

  /**
   * 从检查点恢复上下文
   */
  async restoreContext(checkpointId: string): Promise<ExecutionContext | null> {
    const checkpoint = await this.store.get(checkpointId);
    if (!checkpoint) {
      return null;
    }

    return this.deserializeContext(checkpoint.context);
  }

  /**
   * 删除检查点
   */
  async deleteCheckpoint(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  /**
   * 删除执行的所有检查点
   */
  async deleteCheckpoints(executionId: string): Promise<number> {
    return this.store.deleteByExecution(executionId);
  }

  /**
   * 检查是否应该创建检查点
   */
  shouldCreateCheckpoint(stepIndex: number): boolean {
    if (!this.config.autoCheckpoint) {
      return false;
    }
    return stepIndex > 0 && stepIndex % this.config.checkpointInterval === 0;
  }

  /**
   * 序列化上下文
   */
  private serializeContext(context: ExecutionContext): ExecutionContext {
    return {
      ...context,
      stepResults: new Map(context.stepResults),
      // 移除不可序列化的字段
      signal: undefined,
    };
  }

  /**
   * 反序列化上下文
   */
  private deserializeContext(context: ExecutionContext): ExecutionContext {
    return {
      ...context,
      stepResults: new Map(
        Object.entries(
          context.stepResults as unknown as Record<string, unknown>,
        ),
      ) as ExecutionContext["stepResults"],
      startTime: new Date(context.startTime),
    };
  }

  /**
   * 清理旧检查点
   */
  private async cleanupOldCheckpoints(executionId: string): Promise<void> {
    const checkpoints = await this.store.getByExecution(executionId);

    // 按数量清理
    if (checkpoints.length > this.config.maxCheckpoints) {
      const toDelete = checkpoints.slice(
        0,
        checkpoints.length - this.config.maxCheckpoints,
      );
      for (const cp of toDelete) {
        await this.store.delete(cp.id);
      }
    }

    // 按过期时间清理
    const now = Date.now();
    for (const cp of checkpoints) {
      if (now - cp.timestamp.getTime() > this.config.checkpointTTL) {
        await this.store.delete(cp.id);
      }
    }
  }
}
