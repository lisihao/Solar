/**
 * AgentSpec — AI App 业务 Agent 的声明式基类
 *
 * 业务方继承本类 + 配 @DefineAgent 装饰器即可拥有：
 *   - 类型安全的 input/output（Zod schema 推断）
 *   - 自动注册到 SpecAgentRegistry
 *   - 跑起来：harness.run(MyAgent, input) 一行
 *   - 流：harness.stream(MyAgent, input) 直接喂 SSE/WebSocket
 *
 * 示例：
 *
 *   const Input  = z.object({ topic: z.string() });
 *   const Output = z.object({ subTopics: z.array(z.string()).min(3) });
 *
 *   @DefineAgent({
 *     id: 'topic-extractor',
 *     identity: { role: 'research-analyst' },
 *     loop: 'react',
 *     tools: ['web-search'],
 *     skills: ['critical-review'],
 *     verifiers: ['self'],
 *     taskProfile: { creativity: 'low', outputLength: 'medium' },
 *     inputSchema: Input,
 *     outputSchema: Output,
 *     budget: { maxTokens: 5000, maxIterations: 8 },
 *   })
 *   export class TopicExtractorAgent extends AgentSpec<typeof Input, typeof Output> {
 *     buildSystemPrompt({ input }) {
 *       return `Extract sub-topics from "${input.topic}".`;
 *     }
 *   }
 */

import type { z } from "zod";
import type {
  AgentLoopKind,
  IAgentIdentity,
  IAgentRole,
  IAgentPersona,
} from "../abstractions";
import type { TaskProfile } from "../../../ai-engine/llm/types/task-profile.types";
import type { BuiltInVerifierId } from "../../evaluation/verify/judge.service";

export interface DefineAgentOptions<
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> {
  /** 唯一 id（用于 SpecAgentRegistry / 日志 / observability） */
  readonly id: string;
  /**
   * ★ Spec 版本（mission-pipeline-baseline.md §9.8 / D15）
   * SemVer：MAJOR.MINOR.PATCH。Checkpoint resume 时强校验，不匹配拒绝复用。
   * 缺省 "1.0.0"。
   */
  readonly version?: string;
  /**
   * Identity：可以写完整 IAgentIdentity，也可以写简写（只 role: string + 可选 persona）。
   * 简写会被装饰器展开为完整 identity。
   */
  readonly identity:
    | IAgentIdentity
    | {
        role: string | IAgentRole;
        persona?: IAgentPersona;
        description?: string;
      };
  /** Loop 策略，默认 react */
  readonly loop?: AgentLoopKind;
  /**
   * 允许的 tool id 列表（白名单，编译期硬编码方式）
   *
   * @deprecated 推荐用 toolCategories（runtime 召回）。tools 仅用于：
   *   - 已有 spec 的向后兼容
   *   - 必须精确控制单个 id 的特殊场景
   * 否则系统增删工具会导致 spec 漂移。
   */
  readonly tools?: readonly string[];
  /**
   * ★ Tool Recall（runtime 召回）
   *
   * 声明 agent 业务上需要哪些**类别**的工具，AgentRunner 启动时从 ToolRegistry
   * 实时拉取该类别下的所有 enabled 工具，渲染成 <available_tools> block 给 LLM。
   *
   * 优势：
   *   - 工具 CRUD 自动跟进，spec 无需改
   *   - 与 toolRecallHint 配合：上层（如 Leader）按 dim 性质给 hint，
   *     AgentRunner 取交集做 catalog
   *   - tools 与 toolCategories 同时存在时：tools ∪ toolCategories 召回
   *
   * 例：toolCategories: ['information']
   */
  readonly toolCategories?: readonly string[];
  /** 禁止的 tool id 列表（黑名单，优先级高于白名单） */
  readonly forbiddenTools?: readonly string[];
  /** 激活的 skill id 列表 */
  readonly skills?: readonly string[];
  /** 启用的 verifiers（仅 loop=reflexion 时生效；reflexion 的 spec.verifiers 重写默认） */
  readonly verifiers?: readonly BuiltInVerifierId[];
  /** 语义化模型参数 */
  readonly taskProfile?: TaskProfile;
  /** 输入 Zod schema（可选；提供时自动 .parse 入参 */
  readonly inputSchema?: TInputSchema;
  /** 输出 Zod schema —— 启用 LlmExecutor self-heal */
  readonly outputSchema?: TOutputSchema;
  /** 预算约束 */
  readonly budget?: {
    maxTokens?: number;
    maxIterations?: number;
    maxWallTimeMs?: number;
    /** USD 上限；不传则不强制 cost cap */
    maxCostUsd?: number;
    /**
     * ★ 决策上限的硬封顶（不被 budgetMultiplier 放大）
     *
     * 为什么需要：budgetMultiplier 同时缩放 maxTokens / maxIterations / maxWallTimeMs，
     * 但 maxIterations 是"决策边界"（LLM 还能搜几轮），不应被多倍放大 ——
     * 7.28× 把 5 轮变 36 轮直接让 LLM 永远不 finalize（见 P1 case 2026-04-29）。
     *
     * 推荐值：spec 默认 maxIterations × 2（容错 retry 一轮的级别）。
     * 不设置则不封顶（保持向后兼容）。
     */
    maxIterationsHardCap?: number;
  };
  /**
   * ★ 工具前置闸：为 true 时，agent 必须至少成功调用一次真实工具后才允许 finalize。
   * researcher 这类"必须先检索再产出"的角色启用，杜绝 0 工具直接幻觉 finalize
   * （prod mission df6c14ea 实证根因）。默认 false（leader/outline 等不受影响）。
   */
  readonly requireToolBeforeFinalize?: boolean;
  /** 默认 system prompt（如果 buildSystemPrompt 不重写，用此） */
  readonly systemPrompt?: string;
  /**
   * #35 — Strict JSON schema for the business finalize output payload,
   * derived from outputSchema (additionalProperties:false, all optional
   * fields absent from required[]).
   *
   * When set, the ReActLoop uses this as the provider-enforced decision
   * schema on final iterations (approachingLimit=true), non-FC branch only.
   * Must exactly match outputSchema's shape to avoid rejecting valid output.
   *
   * Pattern: define as a module-level const (e.g. RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA)
   * and reference it here. Do NOT inline ad-hoc objects.
   */
  readonly outputJsonSchema?: Readonly<Record<string, unknown>>;

  /**
   * P1a/P1b (2026-05-25) — delimited finalize transport hints (env-gated by
   * ENABLE_DELIMITED_FINALIZE). `finalizeProseFields`: finalize-output fields
   * holding LONG free-text (e.g. ["body"] / ["summary"]); `finalizeNdjsonArrayField`:
   * an array field to emit one-object-per-line (e.g. "findings"). When enabled,
   * the loop tells best-effort models (DeepSeek json_object etc.) to emit those
   * OUTSIDE the JSON envelope so unescaped quotes / long prose can't break finalize.
   */
  readonly finalizeProseFields?: readonly string[];
  readonly finalizeNdjsonArrayField?: string;
}

const META_KEY = Symbol.for("genesis.harness.dx.AgentSpecMeta");

/**
 * @DefineAgent 装饰器 —— 把 options 挂到类的 metadata 上。
 * AgentRunner 在执行时通过 readDefineAgentMeta() 取出。
 */
export function DefineAgent<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(options: DefineAgentOptions<TInputSchema, TOutputSchema>): ClassDecorator {
  return (target: object) => {
    Object.defineProperty(target, META_KEY, {
      value: options,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  };
}

/** 读取 @DefineAgent 元数据（AgentRunner 内部用） */
export function readDefineAgentMeta(ctor: object): DefineAgentOptions | null {
  const meta = (ctor as unknown as Record<symbol, unknown>)[META_KEY];
  return (meta as DefineAgentOptions) ?? null;
}

/**
 * AgentSpec — 业务 Agent 类的基类。
 *
 * 业务方覆盖 buildSystemPrompt / buildUserPrompt / validateBusinessRules / stubFn 即可。
 * 不覆盖时会使用默认行为（identity.toSystemPrompt() / `task.input` JSON / no validation）。
 *
 * 泛型参数推断：从 @DefineAgent 的 inputSchema / outputSchema 自动推。
 */
export abstract class AgentSpec<
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> {
  /**
   * Phantom 字段 —— 让 TypeScript 能从子类推 TInput / TOutput。
   * 不在运行时使用。
   */
  declare protected readonly __input: z.infer<TInputSchema>;
  declare protected readonly __output: z.infer<TOutputSchema>;

  /** 可选：动态 system prompt（覆盖默认 identity.toSystemPrompt） */
  buildSystemPrompt?(ctx: {
    input: z.infer<TInputSchema>;
    identity: IAgentIdentity;
  }): string;

  /** 可选：动态 user prompt（覆盖默认 JSON 序列化） */
  buildUserPrompt?(ctx: {
    input: z.infer<TInputSchema>;
    identity: IAgentIdentity;
  }): string;

  /** 可选：业务规则校验（Zod 后调用，throw 触发 LLM retry） */
  validateBusinessRules?(
    output: z.infer<TOutputSchema>,
    ctx: {
      input: z.infer<TInputSchema>;
      identity: IAgentIdentity;
    },
  ): void;

  /** 可选：stub 模式产出函数（绕过 LLM；与 env AI_ENGINE_AGENT_STUB=1 联动） */
  stubFn?(ctx: {
    input: z.infer<TInputSchema>;
    identity: IAgentIdentity;
  }): Promise<z.infer<TOutputSchema>>;
}
