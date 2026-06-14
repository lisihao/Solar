/**
 * AgentFactory — 从 IAgentSpec 构造 HarnessedAgent
 *
 * 循环依赖处理：AgentFactory ↔ SubagentSpawner。
 * 采用 setter injection：HarnessModule onApplicationBootstrap 时把 spawner wire 进来。
 * 这比 forwardRef + @Inject(class) 更稳，测试里也可直接 factory.setSubagentSpawner(mock)。
 */

import { Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
// ★ type-only import — ModelElectionService is wired via setter injection
// (HarnessModule.onApplicationBootstrap) to avoid NestJS v10 forwardRef+Optional
// timing issues on sibling providers (LlmExecutor was losing AiChatService
// resolution in prod when this was a constructor @Optional inject).
import type { ModelElectionService } from "../../../ai-engine/llm/models/selection";
import type {
  MissionElectionReservation,
  MissionElectionTracker,
} from "../../guardrails/runtime/mission-election-tracker.service";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import type { EnvironmentSnapshot } from "../../../ai-harness/guardrails/runtime/runtime-environment.types";
import { MissionContext } from "../../../../common/context/mission-context";
import { AIModelType } from "@prisma/client";
import type {
  IAgent,
  IAgentLoop,
  IAgentSpec,
  IBudgetSnapshot,
  IContextEnvelope,
  IMemoryBinding,
  ISubagentSpawner,
} from "../abstractions";
import { AgentIdentity } from "./agent-identity";
import { ContextEnvelope } from "./context-envelope";
import { HarnessedAgent } from "./harnessed-agent";
import { SpecBasedAgent } from "./spec-based-agent";
import { ReActLoop } from "../../runner/loop/react-loop";
import { LoopRegistry } from "../../runner/loop/loop-registry";
import { MemoryContextBindingService } from "../../memory/indexing/memory-context-binding.service";
import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";
import { describeOutputSchemaForLlm } from "../dev-tools/zod-schema-prompt";
import { SkillActivator } from "../skill-runtime/skill-activator";
import { AgentStepCheckpointService } from "../../memory/checkpoint/agent-step-checkpoint.service";
import { AgentEventStore } from "../../memory/checkpoint/agent-event-store";
import { LlmExecutor } from "../../runner/executor/llm-executor";
import { AgentRegistry } from "../../handoffs/agent-registry";

@Injectable()
export class AgentFactory {
  private readonly defaultLoop?: IAgentLoop;
  private subagentSpawner?: ISubagentSpawner;
  /**
   * Model election service — wired via setter by HarnessModule.onApplicationBootstrap.
   * Same pattern as `subagentSpawner` above. Not using @Optional constructor inject
   * because in Nest v10 that combo with a forwardRef-provided dependency reliably
   * destabilised resolution of sibling providers (LlmExecutor lost AiChatService
   * in prod). Setter injection runs after all constructors, so no timing risk.
   */
  private electionService?: ModelElectionService;
  /**
   * 2026-05-10 §3：mission-scoped 选举多样性 tracker。同 electionService 一样
   * 走 setter injection 避免 OnModuleInit 时序坑。spec agent 选举时把 modelId
   * 累积到 tracker，下次同 mission 选举时按已选次数扣分驱动多 provider 分布。
   */
  private electionTracker?: MissionElectionTracker;

  constructor(
    @Optional() reactLoop?: ReActLoop,
    @Optional()
    private readonly memoryContextBindingService?: MemoryContextBindingService,
    @Optional() private readonly skillActivator?: SkillActivator,
    @Optional() private readonly checkpointService?: AgentStepCheckpointService,
    @Optional() private readonly llmExecutor?: LlmExecutor,
    /**
     * v2: LoopRegistry — 按 spec.loop 选择 loop 实现。
     * 缺省时退回 reactLoop（默认 ReActLoop）。
     */
    @Optional() private readonly loopRegistry?: LoopRegistry,
    /**
     * PR-C: AgentEventStore — 事件溯源持久化。
     * 不提供时事件不入库（向后兼容）。
     */
    @Optional() private readonly eventStore?: AgentEventStore,
    /**
     * PR-R: AgentRegistry — agent 实例中央目录，handoff 必需。
     */
    @Optional() private readonly agentRegistry?: AgentRegistry,
    /**
     * 2026-05-23 BYOK cross-model failover：
     * AiModelConfigService 用于在 BYOK 路径下列举用户的同 modelType 候选模型，
     * 供 SpecBasedAgent 在 provider 报错时切换到下一个用户配置的模型。
     * 与 AiEngineLLMModule 同属一个 DI 图（HarnessModule imports AiEngineLLMModule），
     * 用 @Optional() 避免非完整 DI 环境（unit test 等）崩溃。
     */
    @Optional() private readonly modelConfigService?: AiModelConfigService,
  ) {
    this.defaultLoop = reactLoop;
  }

  /**
   * 按 spec.loop 字段从 LoopRegistry 取实现；缺省 react。
   * 没有 LoopRegistry 时退回 defaultLoop（向后兼容）。
   */
  private pickLoop(spec: IAgentSpec): IAgentLoop | undefined {
    if (this.loopRegistry) {
      const kind = spec.loop ?? "react";
      if (this.loopRegistry.has(kind)) {
        return this.loopRegistry.get(kind);
      }
      // 未注册时静默 fallback 到 react
      if (this.loopRegistry.has("react")) {
        return this.loopRegistry.get("react");
      }
    }
    return this.defaultLoop;
  }

  /** Called by HarnessModule.onApplicationBootstrap to avoid forwardRef timing. */
  setElectionService(election: ModelElectionService): void {
    this.electionService = election;
  }

  /** Called by HarnessModule.onApplicationBootstrap; mission-scoped diversity tracker. */
  setElectionTracker(tracker: MissionElectionTracker): void {
    this.electionTracker = tracker;
  }

  async electPreferredModel(args: {
    roleId: string;
    taskProfile?: IAgentSpec["taskProfile"];
    userId?: string;
    envSnapshot?: EnvironmentSnapshot;
  }): Promise<string | undefined> {
    const selection = await this.electPreferredModelSelection(args);
    return selection.modelId;
  }

  async electPreferredModelSelection(args: {
    roleId: string;
    taskProfile?: IAgentSpec["taskProfile"];
    userId?: string;
    envSnapshot?: EnvironmentSnapshot;
  }): Promise<{
    modelId?: string;
    missionId?: string;
    reservation?: MissionElectionReservation;
  }> {
    if (!this.electionService) return {};

    // 2026-05-12 BYOK fix: 有 userId 上下文时整体跳过 election。
    //
    // 真因：election 候选池 = `envSnapshot.models.CHAT ∪ REASONING`（见
    //   buildElectionCandidates）。即使 ModelElectionService Step 3 已有 BYOK
    //   provider 过滤，遇到用户配过但 quota-exhausted 的 deepseek key 仍会通过
    //   （只看"有没有 key"不看 key 健康度）。election 评分里 isDefault 只
    //   +5 分，tier+role+cost 三项 reasoning 模型常压倒 grok-4-1-fast-reasoning。
    //
    //   症状：用户明确把 grok 设为 CHAT default，但 agent run 跑出
    //   deepseek-reasoner —— preferredModelId 透给 react-loop 后第一优先击穿了
    //   byokUserId 闸 → chat({ model: "deepseek-reasoner" }) Path B 跳过
    //   findUserDefaultByType → resolveKey(userId, "deepseek") → 那条
    //   quota-exhausted 的 deepseek key 报 402 / 直接 NoAvailableKeyError。
    //
    //   修法：BYOK userId 上下文整体跳过 election，返回 modelId=undefined。
    //   react-loop.ts:568 byokUserId 闸已经处理"无 preferredModelId 时让 chat()
    //   走 findUserDefaultByType"，全链路对齐"用户选啥用啥"。
    //
    //   admin/cron 无 userId 路径仍走 election（admin downgrade 行为不变）。
    if (args.userId) {
      return {};
    }

    const candidates = this.buildElectionCandidates(args.envSnapshot);
    const missionId = MissionContext.get()?.missionId;
    const role = this.resolveElectionRoleHint(args.roleId);
    const runElection = async (previouslyElected: ReadonlyArray<string>) => {
      const result = await this.electionService!.elect({
        modelType: AIModelType.CHAT,
        candidates,
        taskProfile: args.taskProfile,
        role,
        userId: args.userId,
        previouslyElected,
      });
      return {
        result,
        electedModelId: result.elected.modelId,
      };
    };
    const selection = this.electionTracker
      ? await this.electionTracker.reserveSerializedElection(
          missionId,
          runElection,
        )
      : { result: (await runElection([])).result };

    return {
      modelId: selection.result.elected.modelId,
      missionId,
      reservation: selection.reservation,
    };
  }

  /**
   * ★ 目标架构 v2：从声明式 IAgentSpec 创建 SpecBasedAgent。
   * Spec 必须包含 outputSchema 或 stubFn 之一（否则使用 createAgent 走 ReActLoop）。
   *
   * @param envSnapshot 环境快照——pipeline stage 从 identity.capabilities.env
   *   拿到后传进来，驱动 SpecBasedAgent 的环境感知选举。
   */
  createSpecAgent<TInput, TOutput>(
    spec: IAgentSpec<TInput, TOutput>,
    envSnapshot?: EnvironmentSnapshot,
  ): SpecBasedAgent<TInput, TOutput> {
    if (!this.llmExecutor) {
      throw new Error(
        "LlmExecutor not available — cannot create spec agent. Ensure AiEngineHarnessModule is imported.",
      );
    }
    const id = spec.identity.role.id;
    // ★ Lazy accessor (closure) — NOT this.electionService directly.
    // createSpecAgent is called during OnModuleInit ({app}.module.ts:346)
    // but setElectionService runs at OnApplicationBootstrap (HarnessModule).
    // Capturing the field ref here would freeze `undefined` forever; the closure
    // defers the read until runtime (executeSpec), by which point the setter has
    // wired the real service. This is the fix for Railway "AG-01-LD chat failed:
    // DEFAULT_AI_MODEL 未设置" that persisted after DI was fixed.
    return new SpecBasedAgent<TInput, TOutput>(
      id,
      spec,
      this.llmExecutor,
      () => this.electionService,
      envSnapshot,
      () => this.electionTracker,
      () => this.modelConfigService,
    );
  }

  /**
   * 供 HarnessModule onApplicationBootstrap 调用，打破循环依赖。
   * 不提供 spawner 时，agent.spawnSubagent() 会抛错。
   */
  setSubagentSpawner(spawner: ISubagentSpawner): void {
    this.subagentSpawner = spawner;
  }

  create(
    spec: IAgentSpec,
    preferredModelId?: string,
    preferredModelReservation?: {
      missionId?: string;
      reservation?: MissionElectionReservation;
    },
  ): IAgent {
    const identity =
      spec.identity instanceof AgentIdentity
        ? spec.identity
        : new AgentIdentity(spec.identity);

    const sessionId = spec.sessionId ?? randomUUID();
    const memory: IMemoryBinding = {
      sessionId,
      userId: spec.userId,
      workspaceId: spec.workspaceId,
    };

    const budget: IBudgetSnapshot = {
      tokensUsed: 0,
      tokensRemaining: identity.constraints?.maxTokens ?? 50_000,
      iterationsUsed: 0,
      iterationsRemaining: identity.constraints?.maxIterations ?? 20,
      wallTimeStartMs: Date.now(),
    };

    const systemPrompt = spec.systemPrompt ?? identity.toSystemPrompt();

    const envelope = new ContextEnvelope({
      system: systemPrompt,
      messages: [],
      reminders: [],
      tools: [...identity.tools],
      memory,
      budget,
      runtimeEnv: spec.runtimeEnv, // PR-J
      // 2026-05-13: mission-scoped metadata（searchTimeRange / language / missionId 等）
      // 透传给 ContextEnvelope → tool-invoker 注入 ToolContext.metadata。
      metadata: spec.metadata,
    });

    // ★ 包装 spec.outputSchema + validateBusinessRules 成 ReActLoop 期望的
    // validator 形态（{ok}|{ok:false, issues}），驱动 finalize 时的内容校验闸：
    // 不达标 → critique reminder → continue loop → LLM 直接补缺。
    const outputSchemaValidator = spec.outputSchema
      ? (output: unknown) => {
          // ReActLoop.finalize 经常把 LLM 输出原样塞进 output；如果是 string
          // 形式的 JSON 或 prose-wrapped JSON，先尝试 robust extract 再校验。
          //
          // ★ 2026-05-13: 之前只在 trimmed 严格 startsWith("{")/("[") 时尝试
          // JSON.parse，本地推理模型（Nemotron-3-Nano / DeepSeek-R1 等）
          // 频繁吐 "Here is the JSON: {…}\n\nLet me know…" 这种带前后散文
          // 的输出，会绕过判断 → Zod 直接 reject → finalize-reject 循环
          // 攒到 MAX_FINALIZE_REJECTS → RUNNER_OUTPUT_SCHEMA_MISMATCH。
          // 改走 extractJsonFromAIResponse 的 7 策略抽取器（含 <think> 剥离、
          // 任意位置 brace counting、truncated JSON repair）。
          let candidate: unknown = output;
          if (typeof candidate === "string") {
            const extracted = extractJsonFromAIResponse(candidate);
            if (extracted.success) {
              candidate = extracted.data;
            }
            // extracted.success === false → 留作 string，schema 自己 reject
          }
          const result = spec.outputSchema!.safeParse(candidate);
          if (result.success) return { ok: true as const };
          const issues = result.error.issues
            .map(
              (iss) =>
                `${iss.path.join(".") || "<root>"}: ${iss.message} (code=${iss.code})`,
            )
            .join("; ");
          return { ok: false as const, issues };
        }
      : undefined;
    const validateBusinessRulesWrapper = spec.validateBusinessRules
      ? (output: unknown, input?: unknown) => {
          try {
            // ★ outputSchema 存在时，先 schema-parse 出结构化值再校验业务规则。
            //   ReActLoop.finalize 可能直接塞进 LLM 的字符串/部分对象，没有这一步
            //   validateBusinessRules 会拿到 raw 值（如 string），常见报错
            //   "X is not iterable" / "Cannot read properties of undefined"ã€‚
            let typed: unknown = output;
            if (spec.outputSchema) {
              let candidate: unknown = output;
              // ★ 2026-05-13: 与 outputSchemaValidator 对齐，走 extractJsonFromAIResponse
              //   7 策略抽取器，避免推理模型输出 "Here is the JSON: {…}" 时
              //   business rules 被静默跳过（早期版本只识别严格 startsWith("{")，
              //   reasoning model prose-wrapped 输出会绕过此分支）。
              if (typeof candidate === "string") {
                const extracted = extractJsonFromAIResponse(candidate);
                if (extracted.success) {
                  candidate = extracted.data;
                }
                // extracted.success === false → 留作 string，schema 闸会拒
              }
              const parsed = spec.outputSchema.safeParse(candidate);
              if (!parsed.success) {
                // schema 闸已经拒绝了，business 闸不再重复报错
                return null;
              }
              typed = parsed.data;
            }
            // ★ Bug fix (2026-04-28): input 之前硬编码 undefined，导致 spec 里
            //   `ctx.input.phase` 之类的访问崩溃为 "Cannot read properties of
            //   undefined (reading 'phase')"。现在由 HarnessedAgent.execute()
            //   把 task.input 透传过来。仍兼容旧调用点（input?=undefined 时退化）。
            spec.validateBusinessRules!(typed as never, {
              input: input as never,
              identity,
            });
            return null;
          } catch (err) {
            return err instanceof Error ? err.message : String(err);
          }
        }
      : undefined;

    return new HarnessedAgent({
      identity,
      envelope,
      loop: this.pickLoop(spec),
      memoryBridge: this.memoryContextBindingService,
      skillActivator: this.skillActivator,
      subagentSpawner: this.subagentSpawner,
      checkpointService: this.checkpointService,
      checkpointEveryNActions: this.checkpointService ? 3 : 0,
      eventStore: this.eventStore,
      agentRegistry: this.agentRegistry,
      // 透传 spec.taskProfile —— Loop 内 chat() 用 agent 真实意图
      taskProfile: spec.taskProfile,
      preferredModelId,
      preferredModelReservation: preferredModelReservation?.reservation,
      preferredModelMissionId: preferredModelReservation?.missionId,
      onCommitPreferredModelReservation:
        preferredModelReservation?.reservation && this.electionTracker
          ? (missionId, token) =>
              this.electionTracker!.commitReservation(missionId, token)
          : undefined,
      onReleasePreferredModelReservation:
        preferredModelReservation?.reservation && this.electionTracker
          ? (missionId, token) =>
              this.electionTracker!.releaseReservation(missionId, token)
          : undefined,
      // ★ 内容驱动退出闸 validator
      outputSchemaValidator,
      validateBusinessRules: validateBusinessRulesWrapper,
      // ★ 2026-05-13: pre-render JSON skeleton for the rejection critique.
      //   Computed once at agent construction (cheap, cached for all runs).
      //   Loop injects it into the critique when finalize fails schema validation,
      //   giving local / reasoning models a concrete shape to copy.
      outputSchemaDescription:
        describeOutputSchemaForLlm(spec.outputSchema) ?? undefined,
      // #35: strict finalize JSON schema for provider-level enforcement on final
      // iterations. undefined when not set — loop falls back to permissive schema.
      finalizeOutputJsonSchema: spec.outputJsonSchema
        ? { ...spec.outputJsonSchema }
        : undefined,
      // P1a/P1b: delimited finalize transport hints (env-gated). Long prose /
      // NDJSON array fields emitted outside the JSON envelope.
      finalizeProseFields: spec.finalizeProseFields
        ? [...spec.finalizeProseFields]
        : undefined,
      finalizeNdjsonArrayField: spec.finalizeNdjsonArrayField,
      // Model-level failover (BYOK → user's other models; admin → re-election).
      // Shared with createWithEnvelope via buildModelFailoverProvider so both
      // construction paths behave identically.
      modelFailoverProvider: this.buildModelFailoverProvider(spec, identity),
    });
  }

  /**
   * 构造模型级 failover provider 闭包（create + createWithEnvelope 共用，保证两条
   * 构造路径一致；之前 createWithEnvelope 漏接导致 subagent / checkpoint resume 的
   * agent 无 failover）。两路：
   *   BYOK (spec.userId) → listUserEnabledModelsByType(userId, CHAT, exclude)
   *   admin/cron (无 userId) → ModelElectionService.elect(excludeModelIds)
   * 依赖（@Optional）缺失时返回 undefined —— failover 关闭，行为同修复前，不崩。
   */
  private buildModelFailoverProvider(
    spec: IAgentSpec,
    identity: AgentIdentity,
  ):
    | ((
        excludeModelIds: ReadonlyArray<string>,
        excludeProviders?: ReadonlyArray<string>,
      ) => Promise<string | null>)
    | undefined {
    const effectiveUserId = spec.userId;
    if (effectiveUserId) {
      const modelConfigService = this.modelConfigService;
      if (!modelConfigService) return undefined;
      return async (
        excludeModelIds: ReadonlyArray<string>,
        excludeProviders?: ReadonlyArray<string>,
      ): Promise<string | null> => {
        try {
          const models = await modelConfigService.listUserEnabledModelsByType(
            effectiveUserId,
            AIModelType.CHAT,
            excludeModelIds,
            excludeProviders ?? [],
          );
          return models[0]?.modelId ?? null;
        } catch {
          return null;
        }
      };
    }
    if (!this.electionService) return undefined;
    const taskProfile = spec.taskProfile;
    const roleId = identity.role.id;
    const runtimeEnv = spec.runtimeEnv;
    return async (
      excludeModelIds: ReadonlyArray<string>,
    ): Promise<string | null> => {
      try {
        // Fresh env snapshot for candidate list; empty candidates if absent.
        const envSnapshot = runtimeEnv?.getEnvironmentSnapshot
          ? await runtimeEnv.getEnvironmentSnapshot().catch(() => undefined)
          : undefined;
        const candidates = this.buildElectionCandidates(envSnapshot);
        const role = this.resolveElectionRoleHint(roleId);
        const result = await this.electionService!.elect({
          modelType: AIModelType.CHAT,
          candidates,
          taskProfile,
          role,
          userId: undefined,
          excludeModelIds: [...excludeModelIds],
        });
        return result.elected.modelId ?? null;
      } catch {
        return null;
      }
    };
  }

  /**
   * 供 SubagentSpawner 使用：在已派生的 envelope 上创建 agent，
   * 不重新计算 memory/budget（isolation policy 已经准备好了）。
   */
  createWithEnvelope(spec: IAgentSpec, envelope: IContextEnvelope): IAgent {
    const identity =
      spec.identity instanceof AgentIdentity
        ? spec.identity
        : new AgentIdentity(spec.identity);

    const env =
      envelope instanceof ContextEnvelope
        ? envelope
        : new ContextEnvelope({
            system: envelope.system,
            messages: [...envelope.messages],
            reminders: [...envelope.reminders],
            tools: [...envelope.tools],
            memory: envelope.memory,
            budget: envelope.budget,
            // PR-J 必修：plain envelope 重建时不能丢 runtimeEnv，
            // 否则 subagent 失去环境感知 → credit/quota 检查全 noop
            runtimeEnv: envelope.runtimeEnv,
            metadata: envelope.metadata,
          });

    return new HarnessedAgent({
      identity,
      envelope: env,
      loop: this.pickLoop(spec),
      memoryBridge: this.memoryContextBindingService,
      skillActivator: this.skillActivator,
      subagentSpawner: this.subagentSpawner,
      checkpointService: this.checkpointService,
      checkpointEveryNActions: this.checkpointService ? 3 : 0,
      eventStore: this.eventStore,
      agentRegistry: this.agentRegistry,
      // ★ 2026-05-13: subagent path also gets the schema skeleton for
      //   finalize-rejection critique.
      outputSchemaDescription:
        describeOutputSchemaForLlm(spec.outputSchema) ?? undefined,
      // 模型级 failover：subagent / checkpoint resume 重建的 agent 也要容错。
      modelFailoverProvider: this.buildModelFailoverProvider(spec, identity),
    });
  }

  /**
   * Resume：从 checkpoint 重建 agent（envelope + identity 还原）。
   * 适合长任务失败/中断后续跑。
   */
  createFromCheckpoint(checkpoint: {
    identity: IAgentSpec["identity"];
    envelope: IContextEnvelope;
    sessionId?: string;
  }): IAgent {
    return this.createWithEnvelope(
      {
        identity: checkpoint.identity,
        sessionId: checkpoint.sessionId,
      },
      checkpoint.envelope,
    );
  }

  private resolveElectionRoleHint(
    roleId: string,
  ):
    | "leader"
    | "researcher"
    | "writer"
    | "reviewer"
    | "extractor"
    | "classifier"
    | "default" {
    const lc = roleId.toLowerCase();
    if (/leader|planner|dispatch|adjust/.test(lc)) return "leader";
    if (/research/.test(lc)) return "researcher";
    if (/writer|section|synthes|editor|report/.test(lc)) return "writer";
    if (/review|evaluat|check|verif|repair|critic/.test(lc)) return "reviewer";
    if (/extract|miner|meta/.test(lc)) return "extractor";
    if (/classif|intent/.test(lc)) return "classifier";
    return "default";
  }

  private buildElectionCandidates(envSnapshot?: EnvironmentSnapshot): Array<{
    modelId: string;
    provider: string;
    modelType: "CHAT" | "REASONING" | "EMBEDDING" | "VISION";
    healthy: "healthy" | "unhealthy" | "unknown";
    recentErrorRate?: number;
    costTier: "basic" | "standard" | "strong" | "unknown";
  }> {
    if (!envSnapshot) return [];
    return [...envSnapshot.models.CHAT, ...envSnapshot.models.REASONING].map(
      (model) => ({
        modelId: model.modelId,
        provider: model.provider,
        modelType: model.modelType,
        healthy: model.healthy,
        recentErrorRate: model.recentErrorRate,
        costTier: model.costTier,
      }),
    );
  }
}
