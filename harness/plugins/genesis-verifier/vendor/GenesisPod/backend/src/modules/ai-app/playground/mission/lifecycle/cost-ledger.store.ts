/**
 * CostLedgerStore — playground mission 成本台账落库 + 求和查询
 *
 * ★ 2026-05-30 P0 remediation（Wire-Cost）：
 *   原终态 costUsd/tokensUsed 直接写 budget pool 的标量快照（snap.poolCostUsd），
 *   pool 是进程内运行态、易随 rerun / 多分支漂移、且无 per-stage 留痕。本 store
 *   把每个 stage 的 LLM 用量逐行 append 到 agent_playground_mission_cost_ledger，
 *   终态 costUsd/tokensUsed 改为对台账 SUM（DB 端聚合）作为唯一权威值。
 *
 *   - appendCostEntry：stage/role 结算点 fire-and-forget 写一行。
 *   - sumByMission：终态求和（替代标量漂移）。
 *   - listByMission：per-mission 成本明细（按 stage/role/model 列行，供审计/UI）。
 *
 *   普通 class（非 @Injectable），由 MissionStore constructor 内 new，与其余 4 个
 *   helper 一致。
 */

import { Logger } from "@nestjs/common";
import type { PrismaService } from "../../../../../common/prisma/prisma.service";

/** 单行成本台账写入入参。 */
export interface CostLedgerEntry {
  missionId: string;
  userId: string;
  /** stage / step 标识（如 "researchers" / "writer-ch3"），可空。 */
  stepId?: string | null;
  /** 角色（leader / researcher / writer ...），可空。 */
  role?: string | null;
  /** 真实模型 id（来自 thinking 事件 modelId），可空。 */
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

/** 单 mission 成本汇总。 */
export interface CostLedgerSummary {
  promptTokens: number;
  completionTokens: number;
  /** prompt + completion 之和（终态 tokensUsed 用）。 */
  totalTokens: number;
  costUsd: number;
  /** 台账行数（=0 表示该 mission 没有任何 LLM 结算留痕）。 */
  entryCount: number;
}

/** per-mission 成本明细行（listByMission 返回）。 */
export interface CostLedgerRow {
  id: string;
  stepId: string | null;
  role: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  createdAt: Date;
}

/** 防御上界：单行 token / cost 超过即丢弃（与 token-spend.utils 的 reject 上界一致量级）。 */
const MAX_TOKENS_PER_ENTRY = 5_000_000;
const MAX_COST_PER_ENTRY_USD = 1_000;

function clampNonNegInt(v: number | undefined, max: number): number {
  if (v == null || !Number.isFinite(v) || v < 0) return 0;
  const n = Math.floor(v);
  return n > max ? max : n;
}

function clampNonNegFloat(v: number | undefined, max: number): number {
  if (v == null || !Number.isFinite(v) || v < 0) return 0;
  return v > max ? max : v;
}

export class CostLedgerStore {
  private readonly log = new Logger(CostLedgerStore.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 追加一行成本台账。fire-and-forget：失败结构化 warn（'cost_ledger_write_failed'）
   * 不吞错、不阻塞主链路。返回是否写入成功（调用方一般忽略）。
   */
  async appendCostEntry(entry: CostLedgerEntry): Promise<boolean> {
    const promptTokens = clampNonNegInt(
      entry.promptTokens,
      MAX_TOKENS_PER_ENTRY,
    );
    const completionTokens = clampNonNegInt(
      entry.completionTokens,
      MAX_TOKENS_PER_ENTRY,
    );
    const costUsd = clampNonNegFloat(entry.costUsd, MAX_COST_PER_ENTRY_USD);
    // 空结算（无 token 也无 cost）不写行，避免台账噪声。
    if (promptTokens === 0 && completionTokens === 0 && costUsd === 0) {
      return false;
    }
    try {
      await this.prisma.agentPlaygroundMissionCostLedger.create({
        data: {
          missionId: entry.missionId,
          userId: entry.userId,
          stepId: entry.stepId ? entry.stepId.slice(0, 120) : null,
          role: entry.role ? entry.role.slice(0, 80) : null,
          model: entry.model ? entry.model.slice(0, 120) : null,
          promptTokens,
          completionTokens,
          costUsd,
        },
      });
      return true;
    } catch (err: unknown) {
      this.log.warn(
        `cost_ledger_write_failed mission=${entry.missionId} stage=${entry.stepId ?? entry.role ?? "?"}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /**
   * 对单 mission 的所有台账行求和（DB 端聚合）。终态 costUsd/tokensUsed 取此值，
   * 替代 budget pool 标量漂移。无行时 entryCount=0，调用方据此决定是否回退到标量。
   */
  async sumByMission(missionId: string): Promise<CostLedgerSummary> {
    try {
      const agg = await this.prisma.agentPlaygroundMissionCostLedger.aggregate({
        where: { missionId },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          costUsd: true,
        },
        _count: { _all: true },
      });
      const promptTokens = agg._sum.promptTokens ?? 0;
      const completionTokens = agg._sum.completionTokens ?? 0;
      const costUsd = agg._sum.costUsd ?? 0;
      return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUsd,
        entryCount: agg._count._all,
      };
    } catch (err: unknown) {
      this.log.warn(
        `cost_ledger_sum_failed mission=${missionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        entryCount: 0,
      };
    }
  }

  /**
   * 列出单 mission 的成本明细（按时间正序）。供审计 / per-mission 成本面板读取。
   */
  async listByMission(missionId: string): Promise<CostLedgerRow[]> {
    // L6 fix：与 sumByMission 对齐——DB 故障（瞬时 prisma 错 / 未迁移环境）时优雅
    // 降级返回 []，而非让 GET /missions/:id/cost 的 Promise.all 整体 reject → 500。
    try {
      const rows = await this.prisma.agentPlaygroundMissionCostLedger.findMany({
        where: { missionId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          stepId: true,
          role: true,
          model: true,
          promptTokens: true,
          completionTokens: true,
          costUsd: true,
          createdAt: true,
        },
      });
      return rows.map((r) => ({
        id: r.id,
        stepId: r.stepId,
        role: r.role,
        model: r.model,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        costUsd: r.costUsd,
        createdAt: r.createdAt,
      }));
    } catch (err: unknown) {
      this.log.warn(
        `cost_ledger_list_failed mission=${missionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }
}
