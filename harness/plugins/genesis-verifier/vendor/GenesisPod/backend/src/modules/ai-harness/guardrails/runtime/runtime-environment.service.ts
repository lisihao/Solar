/**
 * RuntimeEnvironmentService — L2 AI Engine 运行时环境发现（通用）
 *
 * 设计文档：docs/architecture/ai-harness/redesign/11-capability-discovery.md
 *
 * 职责：
 * - 只回答"当前 AI Engine 基础设施客观有什么"：
 *   模型（AIModel 表）/ agent（L2 PlanBasedAgentRegistry）/ tool（L2 ToolRegistry）/
 *   skill（L2 SkillRegistry）/ 用户 key / 外部依赖
 * - **不**含任何 AI App 特定概念（没有 "harness"、"{app}"、"research-depth"）
 * - tablesExist() 接受通用表名数组，不硬编码 App 私有表
 *
 * 各 L3 App 自己在 CapabilityReconciler 里把本服务输出映射到 App 语义。
 *
 * 所有外部依赖 @Optional：单组件失败降级不抛错，partial snapshot 胜于 no snapshot。
 */

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PlanBasedAgentRegistry } from "@/modules/ai-harness/agents/registry/plan-based-agent-registry";
import { ToolRegistry } from "@/modules/ai-engine/tools/registry/tool.registry";
import { SkillRegistry } from "@/modules/ai-engine/skills/registry/skill.registry";
// v3.1 A0：AiChatModelConfigService 弃用，迁至 canonical AiModelConfigService
import { AiModelConfigService } from "@/modules/ai-engine/llm/models/config/ai-model-config.service";
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import {
  SPEC_AGENT_REGISTRY_PROBE,
  TOOL_CIRCUIT_BREAKER_PROBE,
  type ISpecAgentRegistryProbe,
  type IToolCircuitBreakerProbe,
} from "./runtime-resource.abstractions";
import type {
  EnvironmentSnapshot,
  EnvironmentSnapshotParams,
  RuntimeCostTier,
  RuntimeModelCapability,
  RuntimeModelType,
  RuntimeToolCapability,
} from "./runtime-environment.types";

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  readonly snapshot: EnvironmentSnapshot;
  readonly expiresAt: number;
}

@Injectable()
export class RuntimeEnvironmentService {
  private readonly logger = new Logger(RuntimeEnvironmentService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly agentRegistry?: PlanBasedAgentRegistry,
    @Optional() private readonly toolRegistry?: ToolRegistry,
    @Optional() private readonly skillRegistry?: SkillRegistry,
    @Optional()
    @Inject(SPEC_AGENT_REGISTRY_PROBE)
    private readonly specAgentRegistry?: ISpecAgentRegistryProbe,
    @Optional()
    private readonly modelConfigService?: AiModelConfigService,
    @Optional() private readonly keyResolver?: KeyResolverService,
    @Optional() private readonly secrets?: SecretsService,
    @Optional()
    @Inject(TOOL_CIRCUIT_BREAKER_PROBE)
    private readonly toolCircuitBreaker?: IToolCircuitBreakerProbe,
  ) {
    // P1-5: registry @Optional 是为了单元测试（没完整 DI 图）简单；
    // 生产环境（AppModule 完整组装）下这些必须到位，否则 snapshot 数据残缺。
    // 启动日志里 warn 缺项，帮助排查。
    if (!this.prisma) {
      this.logger.warn(
        "PrismaService missing — models & DB schema discovery disabled",
      );
    }
    if (!this.agentRegistry) {
      this.logger.warn(
        "PlanBasedAgentRegistry missing — env.agents will be empty (caller should ensure AiEngineOrchestrationModule is imported)",
      );
    }
    if (!this.toolRegistry) {
      this.logger.warn(
        "ToolRegistry missing — env.tools will be empty (caller should ensure AiEngineToolsModule is imported)",
      );
    }
    if (!this.skillRegistry) {
      this.logger.warn(
        "SkillRegistry missing — env.skills will be empty (caller should ensure AiEngineSkillsModule is imported)",
      );
    }
  }

  async snapshot(
    params: EnvironmentSnapshotParams,
  ): Promise<EnvironmentSnapshot> {
    const key = params.userId;
    if (!params.force) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
    }

    const [models, tools, userKeys] = await Promise.all([
      this.discoverModels(params.userId),
      this.discoverTools(),
      this.discoverUserKeys(params.userId),
    ]);
    const agents = this.discoverAgents();
    const skills = this.discoverSkills();
    const externalDeps = this.discoverExternalDeps();

    const snapshot: EnvironmentSnapshot = {
      generatedAt: new Date().toISOString(),
      userId: params.userId,
      models,
      agents,
      tools,
      skills,
      userKeys,
      externalDeps,
    };
    this.cache.set(key, { snapshot, expiresAt: Date.now() + CACHE_TTL_MS });

    this.logger.log(
      `snapshot user=${params.userId} ` +
        `models=[CHAT:${models.CHAT.length},REAS:${models.REASONING.length},EMB:${models.EMBEDDING.length}] ` +
        `agents=${agents.length} tools=${tools.filter((t) => t.enabled).length}/${tools.length}`,
    );
    return snapshot;
  }

  /**
   * 通用 DB 表存在性探测。Caller 传表名数组，返回每个表是否存在。
   * 不含任何 App 特定表名；由 caller 决定关心哪些表。
   */
  async tablesExist(names: string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const n of names) result[n] = false;
    if (!this.prisma || names.length === 0) return result;

    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ table_name: string }>
      >(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1)`,
        names,
      );
      const present = new Set(rows.map((r) => r.table_name));
      for (const n of names) result[n] = present.has(n);
    } catch (err) {
      this.logger.warn(
        `tablesExist failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return result;
  }

  invalidate(userId?: string): void {
    if (!userId) {
      this.cache.clear();
      return;
    }
    this.cache.delete(userId);
  }

  // ================== Discovery ==================

  private async discoverModels(
    userId: string,
  ): Promise<EnvironmentSnapshot["models"]> {
    const empty = {
      CHAT: [] as RuntimeModelCapability[],
      REASONING: [] as RuntimeModelCapability[],
      EMBEDDING: [] as RuntimeModelCapability[],
      VISION: [] as RuntimeModelCapability[],
    };
    if (!this.prisma) return empty;

    try {
      // ★ 2026-05-12 真因修复（BYOK quota fallback 不工作）：
      //   原来只读 admin AIModel 表，用户 BYOK 的 UserModelConfig 完全没进
      //   model pool → findSiblingModel 返回 undefined → QUOTA_EXCEEDED 时
      //   ReActLoop 没法 fallback。
      //   修法：同时读 UserModelConfig 并以 userId+modelId 维度合并，admin
      //   AIModel 兜底。BYOK 优先于 admin（避免被禁用的 admin 行盖掉用户私
      //   有模型）。
      //   注意：不用 Promise.all（caller 在测试 mock 里可能漏 mock
      //   userModelConfig，导致 unhandled rejection 把 worker 弄崩）；
      //   两次 await + try 各包让其中一个失败不影响另一个。
      const adminRows = await this.prisma.aIModel.findMany({
        where: { isEnabled: true },
        select: {
          modelId: true,
          provider: true,
          modelType: true,
          maxTokens: true,
          isReasoning: true,
          supportsVision: true,
          costTier: true,
        },
      });
      let userRows: Array<{
        modelId: string;
        provider: string;
        modelType: string;
        maxTokens: number;
        isReasoning: boolean | null;
        supportsVision: boolean | null;
      }> = [];
      try {
        userRows = await this.prisma.userModelConfig.findMany({
          where: { userId, isEnabled: true },
          select: {
            modelId: true,
            provider: true,
            modelType: true,
            maxTokens: true,
            isReasoning: true,
            supportsVision: true,
          },
        });
      } catch (err) {
        this.logger.warn(
          `discoverModels: userModelConfig read failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // 合并：BYOK 优先（先 push 进 rows），admin 兜底。同 modelId+provider
      // 重复时 BYOK 留下。
      const seenKey = new Set<string>();
      const rows: Array<{
        modelId: string;
        provider: string;
        modelType: string;
        maxTokens: number;
        isReasoning: boolean | null;
        supportsVision: boolean | null;
        costTier: string | null;
      }> = [];
      for (const r of userRows) {
        const key = `${r.provider}::${r.modelId}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        rows.push({ ...r, costTier: null }); // UserModelConfig 暂无 costTier 字段
      }
      for (const r of adminRows) {
        const key = `${r.provider}::${r.modelId}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        rows.push(r);
      }

      // 最近 1 小时错误率（ai_engine_metrics 表可能不存在，包 try）
      const since = new Date(Date.now() - 60 * 60 * 1000);
      let errorMap = new Map<string, { calls: number; errors: number }>();
      try {
        const errorRows = await this.prisma.$queryRawUnsafe<
          Array<{ model_id: string; calls: bigint; errors: bigint }>
        >(
          `SELECT model_id,
                  COUNT(*)::bigint AS calls,
                  COUNT(*) FILTER (WHERE success = false)::bigint AS errors
           FROM ai_engine_metrics
           WHERE created_at >= $1 AND model_id IS NOT NULL
           GROUP BY model_id`,
          since,
        );
        errorMap = new Map(
          errorRows.map((r) => [
            r.model_id,
            { calls: Number(r.calls), errors: Number(r.errors) },
          ]),
        );
      } catch {
        // ai_engine_metrics 可能不存在；所有模型视为 healthy
      }

      const result: {
        CHAT: RuntimeModelCapability[];
        REASONING: RuntimeModelCapability[];
        EMBEDDING: RuntimeModelCapability[];
        VISION: RuntimeModelCapability[];
      } = { CHAT: [], REASONING: [], EMBEDDING: [], VISION: [] };
      for (const row of rows) {
        const s = errorMap.get(row.modelId);
        const errorRate = s && s.calls > 0 ? s.errors / s.calls : undefined;
        // ★ healthy 三态：errorRate undefined 不再当 healthy（是 unknown）
        //   - 已知错误率 < 50% → healthy
        //   - 已知错误率 >= 50% → unhealthy
        //   - 无数据（新接 BYOK / 从未调用过）→ unknown，让 caller 显式处理
        const healthy: RuntimeModelCapability["healthy"] =
          errorRate === undefined
            ? "unknown"
            : errorRate < 0.5
              ? "healthy"
              : "unhealthy";
        // ★ costTier 从 DB 读；DB 没配 → "unknown"（不再字符串启发式）
        const costTier: RuntimeCostTier = isValidCostTier(row.costTier)
          ? (row.costTier as RuntimeCostTier)
          : "unknown";
        const cap: RuntimeModelCapability = {
          modelId: row.modelId,
          provider: row.provider,
          modelType: row.modelType as RuntimeModelType,
          contextWindow: row.maxTokens,
          costTier,
          healthy,
          recentErrorRate: errorRate,
        };
        const bucket = result[row.modelType as RuntimeModelType];
        if (bucket) bucket.push(cap);

        // Reasoning is a *capability*, not an exclusive enum value:
        // 1. DB `AIModelType` enum has no REASONING member — operators mark
        //    reasoning models as CHAT + `isReasoning=true`.
        // 2. A single model (gpt-5 / o1 / claude-4 / deepseek-r1) serves
        //    both plain CHAT calls and reasoning calls; a reconciler that
        //    reads only `modelType` will always report REAS:0 even when
        //    the user has explicitly enabled a reasoning model.
        //
        // Resolution: the DB `isReasoning` boolean is the operator-declared
        // truth. When absent, fall back to the shared
        // AiModelConfigService.isReasoningModel() which already knows
        // the o1/o3/gpt-5/deepseek-r1/gemini-2.5/*-thinking families.
        // Mirror the capability into the REASONING bucket additively — the
        // CHAT bucket entry stays so chat callers see the same model.
        const isReasoning =
          row.isReasoning === true ||
          (row.isReasoning !== false &&
            (this.modelConfigService?.isReasoningModel(row.modelId) ?? false));
        if (
          isReasoning &&
          !result.REASONING.some((m) => m.modelId === row.modelId)
        ) {
          result.REASONING.push({ ...cap, modelType: "REASONING" });
        }

        // Vision 与 reasoning 同理：AIModelType enum 无 VISION 成员，
        // 操作员通过 supportsVision=true 声明多模态模型。CHAT 桶保留，
        // VISION 桶 additive 填充——Reconciler 读 VISION 时可以拿到候选。
        if (
          row.supportsVision === true &&
          !result.VISION.some((m) => m.modelId === row.modelId)
        ) {
          result.VISION.push({ ...cap, modelType: "VISION" });
        }
      }
      return result;
    } catch (err) {
      this.logger.warn(
        `discoverModels failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return empty;
    }
  }

  private discoverAgents(): string[] {
    // 合并 legacy PlanBasedAgentRegistry（plan-based agents）+ 新 SpecAgentRegistry（spec agents）
    const ids = new Set<string>();
    if (this.agentRegistry) {
      try {
        for (const id of this.agentRegistry.getAllIds()) ids.add(id);
      } catch {
        // ignore
      }
    }
    if (this.specAgentRegistry) {
      try {
        for (const id of this.specAgentRegistry.getAllIds()) ids.add(id);
      } catch {
        // ignore
      }
    }
    return [...ids];
  }

  private discoverTools(): Promise<RuntimeToolCapability[]> {
    if (!this.toolRegistry) return Promise.resolve([]);
    try {
      const tools = this.toolRegistry.getAll();
      return Promise.resolve(
        tools.map((t) => {
          // ★ 用既有的 ToolCircuitBreaker 作为真实健康反馈，不再造假绿灯：
          //   - enabled=false → unhealthy（操作员显式禁用）
          //   - circuit breaker open → unhealthy（连续失败 3 次自动熔断）
          //   - circuit breaker half-open → unknown（冷却中允许试探）
          //   - circuit breaker closed → unknown（从未失败 ≠ 已知 healthy；
          //     只有真实运行中没出过错可以退而求其次当 unknown 表达"暂无负面信号"）
          const enabled = t.enabled !== false;
          const cbState = this.toolCircuitBreaker?.getState(t.id) ?? "closed";
          const healthy: RuntimeToolCapability["healthy"] = !enabled
            ? "unhealthy"
            : cbState === "open"
              ? "unhealthy"
              : "unknown";
          const note = !enabled
            ? "disabled by operator"
            : cbState === "open"
              ? "circuit breaker open (consecutive failures)"
              : cbState === "half-open"
                ? "circuit breaker half-open (probing)"
                : undefined;
          return {
            toolId: t.id,
            name: t.name,
            category: t.category,
            enabled,
            healthy,
            note,
          };
        }),
      );
    } catch (err) {
      this.logger.warn(
        `discoverTools failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return Promise.resolve([]);
    }
  }

  private discoverSkills(): string[] {
    if (!this.skillRegistry) return [];
    try {
      // BaseRegistry.getAll returns ISkill[]; we map to id strings
      return this.skillRegistry.getAll().map((s) => s.id);
    } catch {
      return [];
    }
  }

  private async discoverUserKeys(
    userId: string,
  ): Promise<EnvironmentSnapshot["userKeys"]> {
    // ★ 接真服务，不再写死 hasByok=false / sharedKeyAvailable=true。
    // KeyResolverService.getAvailableProviders 已经合并了 personal + assigned key 来源。
    // SecretsService.listAvailableProviders 给出系统级可用的 provider 列表。
    let byokProviders: string[] = [];
    if (this.keyResolver) {
      try {
        byokProviders = await this.keyResolver.getAvailableProviders(userId);
      } catch (err) {
        this.logger.warn(
          `discoverUserKeys: KeyResolverService.getAvailableProviders failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else {
      this.logger.warn(
        "discoverUserKeys: KeyResolverService not injected — userKeys.hasByok will always be false. " +
          "Wire KeyResolverModule into RuntimeResourceModule to fix.",
      );
    }

    let sharedKeyProviders: string[] = [];
    if (this.secrets) {
      try {
        sharedKeyProviders = await this.secrets.listAvailableProviders();
      } catch (err) {
        this.logger.warn(
          `discoverUserKeys: SecretsService.listAvailableProviders failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      hasByok: byokProviders.length > 0,
      byokProviders,
      // sharedKeyAvailable 只有在确实查到至少一个系统 key 时为 true，
      // 不再"假设可用"。
      sharedKeyAvailable: sharedKeyProviders.length > 0,
    };
  }

  private discoverExternalDeps(): EnvironmentSnapshot["externalDeps"] {
    // ★ 不再写死 healthy=true 假报告。未接 probe 的依赖一律标 unknown。
    //   要让某个依赖出现在 snapshot 里，应该实现真 probe 后填 healthy/unhealthy。
    //   返回空对象——caller 看到 deps={} 就知道环境信息不可靠，不会被假绿灯误导。
    return {};
  }
}

function isValidCostTier(value: string | null | undefined): boolean {
  return value === "basic" || value === "standard" || value === "strong";
}
