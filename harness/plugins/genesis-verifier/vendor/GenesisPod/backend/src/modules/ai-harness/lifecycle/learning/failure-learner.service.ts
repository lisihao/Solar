/**
 * FailureLearnerService — 跨 mission 失败模式记忆
 *
 * 2026-05-01 上提: 原叫 HarnessFailureLearner，挂在 {app}/services/
 * failure-learning/ 下。改名 + 上提到 ai-harness/governance/learning/，因为跨
 * mission 失败模式不是 consumer 专属能力，research / writing / teams 都可复用。
 * ai-app 模块通过 `@/modules/ai-harness/facade` 注入。
 *
 * 功能：
 *
 *   1. recordFailure：每次单维度/单 agent 失败后记一条；同 (agent, model,
 *      prompt 前缀, failureCode) 已存在则 count++，更新 lastDiagnostic
 *   2. lookupFallback：mission 启动前/降级路径中检索 —— 已知会撞墙的组合直接
 *      返回 lastFallbackModel，跳过浪费 token 的重蹈覆辙
 *   3. recordSuccess：fallback 成功跑通时把 lastFallbackModel 标稳，下次直接用
 *
 * 表 harness_failure_patterns 已建好（migration 20260426e）。
 */
import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { PrismaService } from "../../../../common/prisma/prisma.service";

export interface FailurePatternKey {
  agentSpecId: string;
  modelId: string;
  /** systemPrompt 原文（service 自己 hash） */
  systemPrompt: string;
  failureCode: string;
}

export interface FailurePatternHit {
  count: number;
  lastFallbackModel?: string;
  lastDiagnostic?: Record<string, unknown>;
  resolved: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * ★ E57 (2026-05-25): 自动禁用模型的硬 count 阈值（单一权威源）。
 * 此前各调用方各自拍脑袋判断 count 多少算"持续失败"，无统一阈值。现集中到
 * FailureLearnerService.shouldAutoDisable，调用方一律用它，避免阈值漂移。
 * 含义：同 (agent, model, prompt, failureCode) 累计失败 ≥ 阈值 且未标 resolved
 * → 视为持续性失败，应 markModelDisabled 让 react-loop 自动绕开。
 */
export const FAILURE_AUTODISABLE_THRESHOLD = 3;

@Injectable()
export class FailureLearnerService {
  private readonly log = new Logger(FailureLearnerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ★ P1-R3-C (round 3): pattern key 高基数修复
   *
   * 之前用 systemPrompt 全文 hash —— 但 systemPrompt 含动态 topic / dimension /
   * language 等运行时渲染内容，每次 mission 都不同，导致：
   *   - 同 (agent, model, errorCode) 永远建新行（DB 高速膨胀）
   *   - count++ 失效，preDisableKnownFailingModels 永不命中
   *
   * 修复策略：从 systemPrompt 中抽取**结构特征**作为稳定 key——
   *   1. 取首 200 字符（通常是 agent role 声明 + 任务说明，相对稳定）
   *   2. 剥离明显的动态内容（数字、URL、UUID-like、引号包裹的用户输入）
   *   3. 仍 hash 取 16 字符前缀
   *
   * 这样同 agent 同任务模板的不同 mission 命中同一 key，count 真正累加。
   */
  private hashPrompt(systemPrompt: string): string {
    const head = systemPrompt.slice(0, 200);
    const stable = head
      .replace(/\b\d+\b/g, "N") // 数字
      .replace(/https?:\/\/\S+/g, "URL") // URL
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "UUID") // UUID-like
      .replace(/"[^"]{1,80}"/g, '"X"') // 引号包裹用户文本
      .replace(/'[^']{1,80}'/g, "'X'")
      .replace(/\s+/g, " ")
      .trim();
    return createHash("sha256").update(stable).digest("hex").slice(0, 16);
  }

  /**
   * ★ P0-R4-3 (round 4): legacy hash —— 旧代码用 systemPrompt 全文 hash，
   * lookup 时同时查新旧 key 让历史失败学习数据过渡期可用。
   * 后续可写迁移脚本批量重 hash 老行，再去除此 fallback。
   */
  private legacyHashPrompt(systemPrompt: string): string {
    return createHash("sha256").update(systemPrompt).digest("hex").slice(0, 16);
  }

  /** 记录一次失败（同 key 计数+1，更新 lastDiagnostic） */
  async recordFailure(input: {
    key: FailurePatternKey;
    missionId: string;
    userId: string;
    diagnostic?: Record<string, unknown>;
  }): Promise<void> {
    const promptHashPrefix = this.hashPrompt(input.key.systemPrompt);
    try {
      await this.prisma.harnessFailurePattern.upsert({
        where: {
          agentSpecId_modelId_promptHashPrefix_failureCode: {
            agentSpecId: input.key.agentSpecId,
            modelId: input.key.modelId,
            promptHashPrefix,
            failureCode: input.key.failureCode,
          },
        },
        create: {
          agentSpecId: input.key.agentSpecId,
          modelId: input.key.modelId,
          promptHashPrefix,
          failureCode: input.key.failureCode,
          count: 1,
          lastMissionId: input.missionId,
          lastUserId: input.userId,
          lastDiagnostic: input.diagnostic
            ? (input.diagnostic as object)
            : undefined,
        },
        update: {
          count: { increment: 1 },
          lastMissionId: input.missionId,
          lastUserId: input.userId,
          lastDiagnostic: input.diagnostic
            ? (input.diagnostic as object)
            : undefined,
        },
      });
    } catch (err) {
      // 学习失败不能阻断 mission；只记日志
      this.log.warn(
        `recordFailure upsert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 查询某 (agent, model?, prompt 前缀) 已有的失败记录。
   *
   * - modelId 给定 → 只查这个 model 的失败记录（精确）
   * - modelId 省略 → 查 (agent, prompt) 下**所有 model** 的失败记录
   *   用于 mission 启动前的预检：拿出"任何曾在此 prompt 上撞墙的 model"
   *   全部喂给 adapter.markModelDisabled，让 react-loop 自动绕开。
   *
   * 返回结果按 lastSeenAt 倒序，调用方按 count + resolved 决策是否生效。
   */
  async lookup(input: {
    agentSpecId: string;
    modelId?: string;
    systemPrompt: string;
  }): Promise<
    (FailurePatternHit & { modelId: string; failureCode: string })[]
  > {
    // ★ P0-R4-3 (round 4): 同时查新旧 hash key 兼容历史 DB 行
    const newHash = this.hashPrompt(input.systemPrompt);
    const legacyHash = this.legacyHashPrompt(input.systemPrompt);
    const hashes = newHash === legacyHash ? [newHash] : [newHash, legacyHash];
    try {
      const records = await this.prisma.harnessFailurePattern.findMany({
        where: {
          agentSpecId: input.agentSpecId,
          ...(input.modelId ? { modelId: input.modelId } : {}),
          promptHashPrefix: { in: hashes },
        },
        orderBy: { lastSeenAt: "desc" },
        take: 20,
      });
      return records.map((r) => ({
        modelId: r.modelId,
        failureCode: r.failureCode,
        count: r.count,
        lastFallbackModel: r.lastFallbackModel ?? undefined,
        lastDiagnostic:
          (r.lastDiagnostic as Record<string, unknown>) ?? undefined,
        resolved: r.resolved,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
      }));
    } catch (err) {
      this.log.warn(
        `lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * ★ E57 (2026-05-25): 单一权威判定 —— 某失败记录是否已达"持续性失败"应自动禁用。
   * 调用方（model 预检 / react-loop 降级）一律用此函数，不再各自硬编码 count 比较。
   */
  shouldAutoDisable(
    hit: Pick<FailurePatternHit, "count" | "resolved">,
  ): boolean {
    return !hit.resolved && hit.count >= FAILURE_AUTODISABLE_THRESHOLD;
  }

  /**
   * 记录一次"原 model 失败 → 切到 fallback model 后跑通"的成功 workaround。
   * 让下次同 key 命中时直接走这个 fallback。
   */
  async recordSuccessfulFallback(input: {
    key: FailurePatternKey;
    fallbackModelId: string;
  }): Promise<void> {
    const promptHashPrefix = this.hashPrompt(input.key.systemPrompt);
    try {
      await this.prisma.harnessFailurePattern.updateMany({
        where: {
          agentSpecId: input.key.agentSpecId,
          modelId: input.key.modelId,
          promptHashPrefix,
          failureCode: input.key.failureCode,
        },
        data: {
          lastFallbackModel: input.fallbackModelId,
          resolved: true,
        },
      });
    } catch (err) {
      this.log.warn(
        `recordSuccessfulFallback failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
