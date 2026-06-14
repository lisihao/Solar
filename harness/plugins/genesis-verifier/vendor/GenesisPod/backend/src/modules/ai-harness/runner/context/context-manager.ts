/**
 * ContextManager — envelope 生命周期管理
 *
 * 组合 Compactor + Pruner，对外暴露一个 ensureBudget() 方法：
 *   - 计算当前 envelope 的 token 估算
 *   - 必要时先压缩，再裁剪
 *   - 返回优化后的 envelope（可能等于原 envelope）
 *
 * 使用场景：
 *   - ReActLoop 每轮 reason 前调一次
 *   - App 层长任务中途也可以手动调
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type { IContextEnvelope } from "../../agents/abstractions";
import { ContextCompactor, type CompactionResult } from "./context-compactor";
import { PriorityPruner } from "./priority-pruner";
import { estimateEnvelopeTokens } from "./token-estimator";

export interface EnsureBudgetResult {
  envelope: IContextEnvelope;
  /** 压缩是否执行 */
  compacted: boolean;
  /** 裁剪是否执行 */
  pruned: boolean;
  /** 操作前 token 估算 */
  beforeTokens: number;
  /** 操作后 token 估算 */
  afterTokens: number;
}

@Injectable()
export class ContextManager {
  private readonly logger = new Logger(ContextManager.name);

  constructor(
    @Optional() private readonly compactor?: ContextCompactor,
    @Optional() private readonly pruner?: PriorityPruner,
  ) {}

  /**
   * 保证 envelope 在预算内。调用方可以基于返回信息记 trace。
   */
  async ensureBudget(envelope: IContextEnvelope): Promise<EnsureBudgetResult> {
    const beforeTokens = estimateEnvelopeTokens(envelope);

    let current = envelope;
    let compactResult: CompactionResult | null = null;

    // 1. Compact if needed
    if (this.compactor) {
      compactResult = await this.compactor.compact(current);
      if (compactResult.compacted) {
        current = compactResult.envelope;
        this.logger.debug(
          `[ensureBudget] compacted: removed ${compactResult.removedMessageCount} msgs, ` +
            `summary ${compactResult.summaryChars} chars`,
        );
      }
    }

    // 2. Prune reminders
    let pruned = false;
    if (this.pruner) {
      const before = current.reminders.length;
      current = this.pruner.prune(current);
      if (current.reminders.length < before) {
        pruned = true;
        this.logger.debug(
          `[ensureBudget] pruned reminders: ${before} → ${current.reminders.length}`,
        );
      }
    }

    const afterTokens = estimateEnvelopeTokens(current);

    return {
      envelope: current,
      compacted: compactResult?.compacted ?? false,
      pruned,
      beforeTokens,
      afterTokens,
    };
  }
}
