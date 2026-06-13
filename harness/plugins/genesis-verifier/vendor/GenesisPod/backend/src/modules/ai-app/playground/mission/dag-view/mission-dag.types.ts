/**
 * MissionDag types —— /api/v1/playground/missions/:id/dag 的契约。
 *
 * 设计原则(2026-05-26 用户拍板"后端定义、前端呈现"):
 *   - 后端是图的"真源":nodes / edges / 每节点状态 / rerunable / 影响链路全部后端算。
 *   - 前端只渲染:接受 MissionDagGraph 直接画 SVG，layout 用最小算法(macro 沿
 *     spine、researcher fan-out 平均分布),不做拓扑决策。
 *   - 13 个 stepId(playground.config PLAYGROUND_PIPELINE.steps) 是 macro 节点;
 *     s3-researcher-collect 运行时按 mission.dimensions 展开成 N 个 research 子
 *     节点(parentStepId='s3-researcher-collect'),让前端能画 fan-out。
 *   - 非线性边(Writer⇄Reviewer 重写回环、签收 patch 自环、failover 切换)用
 *     EdgeKind 标注,前端区分样式;级联计算只走 'flow' 边。
 */

/** 节点状态 —— 直接由 mission.lastCompletedStage / mission.status 推导 */
export type MissionDagNodeStatus =
  | "idle" // 未启动
  | "running" // 进行中
  | "done" // 完成
  | "failed" // 失败
  | "degraded" // 降级收下(accept-degraded)
  | "cancelled"; // 取消

/** 节点类型 —— 前端按 kind 选样式 + 选择性显示 sub-info */
export type MissionDagNodeKind =
  | "macro" // S1/S2/S4/S5/.../S11 等单实例 stage
  | "research-dim" // S3 展开后的单个维度 research(运行时生成)
  | "writer" // S8 Writer(参与 rewrite-loop)
  | "reviewer" // S9 Critic / 9b Eval / signoff 前的 review 复合
  | "persist"; // S11 终止

/** Layout 提示 —— 前端 layout 函数读它分行/分列 */
export type MissionDagLayoutHint =
  /** macro stage spine,沿垂直主轴中线 */
  | "spine"
  /** S3 展开后的 research 维度,fan-out 横排 */
  | "fan"
  /** Writer/Reviewer 同行(rewrite loop) */
  | "split";

export interface MissionDagNode {
  /** 节点 id —— macro 节点直接是 stepId;research-dim 节点为 `${parentStepId}::${dimensionRef}` */
  readonly id: string;
  /** 渲染类型 */
  readonly kind: MissionDagNodeKind;
  /** 显示标签(中文) */
  readonly label: string;
  /** 副标签:维度名 / 进度数 / 备注 */
  readonly sub?: string;
  /** 实时状态(后端 derive) */
  readonly status: MissionDagNodeStatus;
  /** ReAct 当前迭代轮数(running 时有意义) */
  readonly iter?: number;
  /** 是否允许触发重跑;false 时前端禁用 ↻ 按钮 + 显 reason */
  readonly rerunable: boolean;
  readonly rerunableReason?: string;
  /** 评分(适用于 reviewer / signoff 等输出分数的节点) */
  readonly score?: number;
  /** Layout 提示 */
  readonly layout: MissionDagLayoutHint;
  /** research-dim 节点专用:维度引用(用于触发 local-rerun dimensionRef) */
  readonly dimensionRef?: string;
  /** 父 stepId(research-dim 节点指向 's3-researcher-collect') */
  readonly parentStepId?: string;
}

export type MissionDagEdgeKind =
  | "flow" // 正常单向依赖,前端实线箭头,级联计算走它
  | "fan" // fan-out / fan-in(macro→维度 / 维度→macro),也是 flow,但前端可不同笔触
  | "rewrite-loop" // Reviewer→Writer 重写回环,前端橙色虚线动画
  | "self-loop"; // 签收 patch 自环

export interface MissionDagEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: MissionDagEdgeKind;
}

export interface MissionDagGraph {
  readonly missionId: string;
  /** mission 当前态(顶部 stat 用) */
  readonly mission: {
    readonly status: string;
    readonly topic: string;
    readonly finalScore: number | null;
  };
  readonly nodes: ReadonlyArray<MissionDagNode>;
  readonly edges: ReadonlyArray<MissionDagEdge>;
}

/** GET /dag/cascade 返回:重跑某节点的级联预览 */
export interface MissionDagCascadePreview {
  readonly origin: string;
  /** 将级联重跑的下游节点 ids(含 macro + research-dim 衍生) */
  readonly willRerun: ReadonlyArray<string>;
  /** 保留不动的节点 ids */
  readonly kept: ReadonlyArray<string>;
  /** 是否允许触发 */
  readonly rerunable: boolean;
  /** 不允许时的原因 */
  readonly reason?: string;
}

/**
 * GET /dag/react/:nodeId 返回:该节点的 ReAct 内部循环快照(Phase 2)。
 *
 * 数据从 MissionEventBuffer 的 playground.agent:* 事件聚合派生:
 *   - lastThought   ← agent:thought.text
 *   - lastAction    ← agent:action.{kind, toolName}
 *   - lastObserve   ← agent:observation.{kind}
 *   - iter/maxIter  ← iteration:progress.{iteration, maxIterations}
 *   - finalizeAttempts ← agent:reflection 的累计次数(每次 finalize 校验都会记一条)
 *   - lastError     ← agent:error.message
 *   - phase         ← agent:lifecycle.phase 的最新值
 *   - currentStep   ← 由最近一条 agent:* 事件推断
 */
export type MissionDagReactCurrentStep =
  | "idle"
  | "thinking"
  | "tool"
  | "observing"
  | "finalizing"
  | "completed"
  | "failed";

export interface MissionDagReactSnapshot {
  readonly nodeId: string;
  /** 该节点对应的 agent role(leader / researcher / writer / reviewer 等) */
  readonly role: string;
  /** research-dim 节点专用:维度名(与 events.dimension 字符串对齐) */
  readonly dimension?: string;
  /** 选中的 agent 实例 id(同 role 下可能多个,这里选最近活跃的) */
  readonly agentId?: string;
  /** 当前在 ReAct 环里的哪一步 */
  readonly currentStep: MissionDagReactCurrentStep;
  /** 最近一次 iteration:progress 给的迭代数 */
  readonly iter?: number;
  readonly maxIter?: number;
  /** 最近一次 think 文本(截断 ≤ 240 字符) */
  readonly lastThought?: string;
  /** 最近一次 action(kind 通常是 tool_call / parallel_tool_call / finalize) */
  readonly lastAction?: {
    readonly kind: string;
    readonly toolName?: string;
  };
  /** 最近一次 observation kind(tool 结果或失败) */
  readonly lastObservation?: {
    readonly kind: string;
  };
  /** finalize 累计被拒次数(若有 reflection 事件可看出) */
  readonly finalizeAttempts: number;
  /** 最近一次错误消息(截断) */
  readonly lastError?: string;
  /** lifecycle 最新 phase(started / completed / failed) */
  readonly phase: "pending" | "running" | "completed" | "failed";
  /** 没事件可用时的解释(例如 s1-budget 是 persist primitive 没 ReAct 内循环) */
  readonly note?: string;
}
