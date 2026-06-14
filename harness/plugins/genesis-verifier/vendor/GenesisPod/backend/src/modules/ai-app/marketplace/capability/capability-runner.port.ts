/**
 * ICapabilityRunner —— 能力执行端口（平台共享，面向未来可插拔实现）。
 *
 * 消费方（company / 任何 app）只依赖本端口 + manifest，**不依赖具体实现**：
 *   - 今天：进程内 runner（跑 harness 通用编排器 + 共享 agent）。
 *   - 未来：同一端口可换成沙箱 / 远程 / MCP server 实现，消费方零改动。
 *
 * 执行契约刻意"纯"：runner 产出结果 + 流式事件；**持久化归消费方**（消费方拿
 * 结果写自己的库 + 把事件桥到自己的 WS）。这样 runner 不耦合任何 app 的 store。
 */
import type { CapabilityManifest } from "./capability-manifest";

/** 能力执行入参（深度洞察类工作流的最小语义输入；其余档位由能力默认值兜底）。 */
export interface CapabilityRunInput {
  readonly topic: string;
  readonly description?: string;
  readonly depth?: "quick" | "standard" | "deep";
  readonly language?: "zh-CN" | "en-US";
  /**
   * 用户选定的真实 model id（透传到 agentRunner.run RunOptions.preferredModelId）。
   * 命中 resolvePreferredModel 第一优先，bypass election，走用户 BYOK 默认解析链。
   * 不传时与 playground 默认行为一致（按 TaskProfile + BYOK 选模型）。
   */
  readonly preferredModelId?: string;
  /** researcher 抽图开关（withFigures=true → web-scraper extractImages）。 */
  readonly withFigures?: boolean;
  /**
   * 报告受众档位（透传 s7/s8/s9 writer/outline agent input；缺省 "domain-expert"）。
   * 消费方可按用户配置覆盖，例如 "general-public" / "executive" / "domain-expert"。
   */
  readonly audienceProfile?: string;
  /**
   * 报告风格档位（透传 s7/s8/s9 writer/outline agent input；缺省 "academic"）。
   * 消费方可按用户配置覆盖，例如 "casual" / "journalistic" / "academic"。
   */
  readonly styleProfile?: string;
  /**
   * 报告长度档位（透传 s7/s8/s9 writer/outline agent input；缺省 "standard"）。
   * 消费方可按用户配置覆盖，例如 "brief" / "standard" / "extended"。
   */
  readonly lengthProfile?: string;
  /**
   * 审计维度配置（透传能力核内部消费点；缺省不做额外审计层）。
   * 消费方可按合规需求注入额外审计 pass（例如 "bias-check" / "fact-check"）。
   */
  readonly auditLayers?: readonly string[];
  /**
   * S3 维度派遣并发档位（1-10；消费方按用户配置透传）。能力核 research.primitive
   * 读 ctx.input.invocation.concurrency 作滑动窗并发度，优先于 recipe params 与
   * min(维度数, 6) 默认。缺省/非法 → 走默认兜底（与用户未配行为一致）。
   */
  readonly concurrency?: number;
  /** 本地知识库 ids（researcher rag-search 召回限定；空/缺省 → 纯 web）。 */
  readonly knowledgeBaseIds?: readonly string[];
  /** 搜索时效窗口（透传 researcher + envelope.metadata，给 search tool 兜底）。 */
  readonly searchTimeRange?: "30d" | "90d" | "180d" | "365d" | "730d" | "all";
  /**
   * ★ #16a 增量复用（消费方"更新/续作"场景）：注入上次 mission 的可复用产物，让能力核
   *   跳过对应阶段的重算，等价 playground OFF 路 hydrateInherited* 的"跳过 S2/S3 重跑"。
   *
   *   - plan：上次拆解的维度规划 → S2 命中即直接复用，跳过 leader plan LLM。
   *   - researcherResults：上次各维 researcher 产物（按 dimension 索引）→ S3 perItemPipeline
   *     命中即复用，跳过 web 检索（增量复用最贵/最慢的一段）。
   *
   *   形状中性（消费方无需知道能力内部 CrossStageState/CS_KEY），能力核负责映射进内部状态。
   *   缺省/空 → 全量新跑（与首次运行一致）。仅在非 crash-resume（无 checkpoint）时生效。
   *
   *   注：章节级复用（writer 重写跳过）暂未覆盖，属后续波；当前复用 plan+research 已回收
   *   增量场景的主要 token/时延成本（web 检索 + ReAct 循环）。
   */
  readonly inheritedBaseline?: {
    readonly plan?: unknown;
    readonly researcherResults?: readonly unknown[];
    /**
     * Fix5：上次 mission 的深度档位（quick/standard/deep）。
     * 消费方（playground pipeline）在"换档位复跑"时传入。
     * 若 sourceDepth 存在且与本次 input.depth 不同，runner 将跳过 plan seed
     * 强制 S2 重规划（维度数量与档位强相关），仍复用 researcherResults（按维度匹配）。
     * string 宽类型让消费方无需显式 cast（能力核内部做安全比较即可）。
     */
    readonly sourceDepth?: string;
  };
}

/** 执行流事件（消费方桥到自己的 WS / 进度）。 */
export interface CapabilityRunEvent {
  readonly type:
    | "started"
    | "stage:started"
    | "stage:completed"
    | "stage:failed"
    | "stage:degraded"
    | "stage:stalled"
    | "agent-lifecycle"
    /**
     * 过程级 agent 事件（流式中间态，区别于完成快照 'agent-lifecycle'）。
     * 来自 IAgentEvent relay，纯流式不落库。
     * payload 承载翻译后的 {kind, text, role, tag, dimension, toolId}。
     * kind 值：
     *   - 'lifecycle-started'    agent 启动卡片（phase='started'）
     *   - 'lifecycle-completed'  agent 完成卡片（phase='completed'）
     *   - 'lifecycle-failed'     agent 失败卡片（phase='failed'）
     *   - 'thinking'             LLM 思考步骤
     *   - 'action_planned'       决定调用工具
     *   - 'action_executed'      工具调用完成
     *   - 'error'                错误事件（tag='error'）
     */
    | "agent-trace"
    /**
     * 通用业务域事件（能力核发；消费方 bridge 按各自 namespace 翻译）。
     * payload 结构：{ event: string; data: Record<string,unknown> }
     * event 示例：
     *   "agent:lifecycle"             agent 完成快照（agentId/role/phase/tokensUsed/costCents）
     *   "agent:narrative"             编排叙事（stage/role/tag/text/dimension）
     *   "dimension:research:started"  维度研究开始（dimension）
     *   "dimension:research:completed"维度研究完成（dimension/findingsCount/summary）
     *   "leader:goals-set"            S2 规划后（goals/initialRisks/dimensions）
     *   "leader:decision"             S4 评估后（phase/decision/perDimension）
     *   "stage:metrics"               stage 统计（stepId/dimensions/findings 数等）
     */
    | "domain"
    | "completed"
    | "failed";
  readonly stepId?: string;
  readonly label?: string;
  readonly timestamp: number;
  /** agent-lifecycle / agent-trace 事件的补充载荷（含 agentId / tokensUsed / costCents / modelTrail 等）。 */
  readonly payload?: Record<string, unknown>;
  /**
   * 结构化阶段元数据（消费方可选消费；14 阶段点亮 + 计费用）。
   * systemStageId 是前端 14-chip 点亮锚点（如 s1-budget … s11-persist）。
   */
  readonly telemetry?: {
    readonly systemStageId?: string;
    readonly tokensUsed?: number;
    readonly costCents?: number;
    readonly dimension?: string;
    readonly agentId?: string;
    readonly phase?: "started" | "completed" | "failed";
  };
}

/** 终态写入细节（消费方落库 + 终态仲裁用）。 */
export interface MissionTerminalDetails {
  readonly report?: unknown;
  readonly reportArtifact?: unknown;
  readonly themeSummary?: string;
  readonly dimensions?: ReadonlyArray<unknown>;
  readonly verdicts?: unknown;
  readonly leaderSignOff?: unknown;
  /**
   * 跨维对账报告（s5 reconciler 产物：reconciliationReport 全文 + deduplicationStats）。
   * 消费方落 ReconciliationPanel 数据源列；缺省/null 时 adapter 跳过写入。
   * leaderOverallScore / leaderVerdict 不在此声明——消费方 adapter 从 leaderSignOff 提取
   *   （s10 signoff 对象自带这两字段），无需 runner 另传顶层键。
   */
  readonly reconciliationReport?: unknown;
  readonly finalScore?: number;
  readonly elapsedWallTimeMs?: number;
  readonly tokensUsed?: number;
  readonly costCents?: number;
  readonly errorMessage?: string;
  readonly failureCode?: string;
}

/**
 * MissionPersistencePort —— 多阶段执行的持久化契约（**消费方注入**）。
 *
 * 能力内核执行期不碰任何 app DB：中间态走 harness CrossStageState；
 * 仅 checkpoint/resume + 终态仲裁经此端口由消费方落库（company 落 company 库、
 * playground 落 MissionStore）。是 harness IMissionStore 的"能力侧最小投影 +
 * terminal arbiter 扩展"——消费方可让自家 store 一套实现同时满足两个视图。
 *
 * 缺省（不注入）→ runner 用内存实现纯跑、不落库。
 */
export interface MissionPersistencePort {
  // ── 核心：crash-resume（MUST）──
  markStageProgress(missionId: string, stepId: string): Promise<void>;
  saveCheckpoint(
    missionId: string,
    snapshot: {
      lastStepId: string;
      topic: string;
      crossState: Readonly<Record<string, unknown>>;
    },
  ): Promise<boolean>;
  loadCheckpoint(missionId: string): Promise<{
    lastStepId: string;
    topic: string;
    crossState: Readonly<Record<string, unknown>>;
  } | null>;
  clearCheckpoint(missionId: string): Promise<void>;

  // ── 终态：条件写仲裁（MUST；WHERE status='running' 首写赢）──
  applyTerminalIfRunning(
    missionId: string,
    outcome: "completed" | "failed" | "cancelled",
    details: MissionTerminalDetails,
  ): Promise<boolean>;

  // ── 可选：维度持久化（能力核 s2 plan 产出后 fire-and-forget 调；消费方实现写各自 store）──
  /**
   * 把 s2 leader plan 产出的维度列表持久化（实现由消费方提供；缺省跳过写入）。
   *
   * 让"任务分解"在运行中即可显示（消费方在 mission 运行期即可落 dimensions 字段）。
   * 沉淀承诺：失败只 log warn，不破坏 mission 终态。
   */
  recordPlanDimensions?(
    missionId: string,
    dims: ReadonlyArray<{ id?: string; name: string; rationale?: string }>,
  ): Promise<void>;

  // ── 可选：S12 自进化 recall（能力核 run() 开始前调；消费方实现从 harness_vector_memory 召回）──
  /**
   * 召回同用户同主题的历史 postmortem（实现由消费方提供；缺省返回空数组）。
   *
   * leader plan 阶段前召回，让 Leader 看到历史经验教训再规划。
   * 沉淀承诺：失败只 log warn，回退到空数组（不破坏 mission）。
   */
  recallPostmortems?(args: {
    userId: string;
    topic: string;
    limit?: number;
  }): Promise<
    ReadonlyArray<{
      missionId: string;
      topic: string;
      summary: string;
      recommendations: string[];
      leaderSigned: boolean | null;
      qualityScore: number | null;
      createdAt: string;
    }>
  >;

  // ── 可选：S12 自进化 postlude（能力核 fire-and-forget 调；消费方实现写 harness_vector_memory）──
  /**
   * 把 mission postmortem 写入 harness_vector_memory（实现由消费方提供；缺省跳过写入）。
   *
   * namespace=userId，tags 含 'deep-insight'/'mission-postmortem'/signed|unsigned。
   * 沉淀承诺：失败只 log warn，不破坏 mission 终态。
   */
  recordPostmortem?(args: {
    readonly missionId: string;
    readonly userId: string;
    readonly topic: string;
    readonly summary: string;
    readonly recommendations: readonly string[];
    readonly leaderSigned: boolean | null;
    readonly qualityScore: number | null;
    readonly tokensUsed: number;
    readonly costUsd: number;
    /** source 标签（如 'deep-insight:mission'）。 */
    readonly source: string;
    /** tags 写入 harness_vector_memory.tags。 */
    readonly tags: readonly string[];
    readonly failureClassification?: {
      readonly mode: string;
      readonly signals: readonly string[];
      readonly confidence: number;
    };
  }): Promise<void>;

  // ── 可选：S12 失败模式记录（能力核 fire-and-forget 调；消费方实现转写 FailureLearnerService）──
  /**
   * 记录粗粒度失败模式，供 FailureLearnerService 在下次同用户同 topic 启动时
   * 给 leader plan 提供 prior knowledge（"上次同主题没过线"）。
   *
   * 典型调用场景（与旧 s12-self-evolution.stage.ts 语义一致）：
   *   - leaderSigned===false → failureCode="LEADER_REFUSED_SIGN"
   *   - missionStatus="failed" 时可选附分类的 failureCode
   *
   * 沉淀承诺：失败只 log warn，不破坏 mission 终态。
   *
   * 接线现状（2026-06-09）：playground 侧 MissionStore 注入 @Optional FailureLearnerService
   * 后经构造参数透传给 MissionStorePersistenceAdapter（key 形状与旧 s12 stage 一致，
   * 历史 pattern 行继续累加）；company 侧暂未实现（可选方法，缺省即跳过）。
   */
  recordFailurePattern?(input: {
    missionId: string;
    topic: string;
    failureCode: string;
    model?: string;
  }): Promise<void>;

  // ── 可选：trajectory（UI 展示 / 重跑复用，能力内核不依赖）──
  saveResearchResult?(args: {
    missionId: string;
    dimension: string;
    findings: ReadonlyArray<unknown>;
    summary: string;
    state: "completed" | "failed";
  }): Promise<boolean>;
  saveReportVersion?(args: {
    missionId: string;
    triggerType: "initial" | "rerun-fresh";
    reportFull?: unknown;
    reportTitle?: string;
    reportSummary?: string;
    finalScore?: number;
    leaderSigned?: boolean;
  }): Promise<number>;
}

/** 执行上下文（归属 + 关联 + 流式回调 + 取消）。 */
export interface CapabilityRunContext {
  /** BYOK / billing / ownership 归属。 */
  readonly userId: string;
  /** 消费方生成的 mission id（用于关联自己的运行记录）。 */
  readonly missionId: string;
  /** 流式事件回调。 */
  readonly onEvent?: (event: CapabilityRunEvent) => void | Promise<void>;
  readonly signal?: AbortSignal;
  /**
   * 消费方注入的持久化端口（checkpoint/resume + 终态仲裁）。
   * 缺省 → runner 用内存实现纯跑、不落库。事件仍全过 onEvent，不另加注入对象。
   */
  readonly persistence?: MissionPersistencePort;
}

/** 能力执行结果（消费方据此写自己的运行记录）。 */
export interface CapabilityRunResult {
  readonly status: "completed" | "failed";
  /** 报告正文（markdown）。 */
  readonly report?: string;
  /** 归一引用列表。 */
  readonly references?: ReadonlyArray<{
    source: string;
    title?: string;
    snippet?: string;
  }>;
  /** 各阶段原始产物（按 step id 索引，消费方可深取）。 */
  readonly stageOutputs: Readonly<Record<string, unknown>>;
  /** 算力汇总。 */
  readonly usage?: { totalTokens: number; totalCostCents: number };
  readonly error?: string;
  /** 各维度研究流水线状态（按 dimension id 索引，可选富产出）。 */
  readonly dimensionPipelines?: Readonly<
    Record<
      string,
      {
        agentId: string;
        state: string;
        tokensUsed?: number;
        costCents?: number;
        modelTrail?: readonly {
          modelId: string;
          promptTokens: number;
          completionTokens: number;
        }[];
      }
    >
  >;
  /** reviewer 抽取的质量评审结论（可选）。 */
  readonly verdicts?: ReadonlyArray<{
    dimension?: string;
    score?: number;
    comment?: string;
  }>;
  /** 各阶段富输出快照（by step id）。 */
  readonly byStage?: Readonly<Record<string, unknown>>;
  /**
   * 内部评审合成判定（runner 从内部 reviewer/critic 已有产出直接映射，
   * 无额外 LLM 调用）。消费方据此对接验收 gate。
   */
  readonly reviewVerdict?: {
    /** 0-100 综合分（来自内部 reviewer score）。 */
    readonly score?: number;
    /** 内部 reviewer 三档判定。 */
    readonly verdict?: "approve" | "revise" | "reject";
    /** reviewer 备注 / critic 盲点（展示用）。 */
    readonly notes?: readonly string[];
  };
}

/**
 * 能力执行端口。实现方在能力家内提供，注册进 CapabilityRegistry；消费方按
 * manifest.id 解析后调用。
 */
export interface ICapabilityRunner {
  readonly manifest: CapabilityManifest;
  run(
    input: CapabilityRunInput,
    ctx: CapabilityRunContext,
  ): Promise<CapabilityRunResult>;
}
