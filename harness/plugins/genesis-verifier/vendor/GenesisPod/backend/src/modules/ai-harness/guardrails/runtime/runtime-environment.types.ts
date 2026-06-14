/**
 * RuntimeEnvironmentService 公共类型契约
 *
 * 设计文档：docs/architecture/ai-harness/redesign/11-capability-discovery.md
 *
 * 注意：这是 L2 AI Engine runtime 层通用契约——**不含任何 AI App 特定概念**
 * （无 "{app}"、"harness"、"research-depth" 等）。
 * 各 L3 App 在自己的 CapabilityReconciler 里把本层输出映射到 App 语义。
 */

export type RuntimeModelType = "CHAT" | "REASONING" | "EMBEDDING" | "VISION";

/**
 * Health 三态语义（核心：unknown ≠ healthy）
 *   - "healthy"：已探测且健康
 *   - "unhealthy"：已探测且不健康（错误率超阈 / probe 失败）
 *   - "unknown"：未探测 / 数据不足。**caller 必须显式处理这种状态**，
 *     不得当成 healthy 用——这是把"假绿灯"全部清除的关键。
 */
export type RuntimeHealth = "healthy" | "unhealthy" | "unknown";

/**
 * costTier 由 DB AIModel.costTier 显式声明（管理员后台填）。
 * 不再用模型名 startsWith 启发式推断。
 *   - "basic" = 便宜（mini / nano / haiku 类）
 *   - "standard" = 主力对话
 *   - "strong" = 旗舰推理（opus / o1 / gpt-5）
 *   - "unknown" = DB 未配置 costTier（caller 应提示管理员去配）
 */
export type RuntimeCostTier = "basic" | "standard" | "strong" | "unknown";

export interface RuntimeModelCapability {
  readonly modelId: string;
  readonly provider: string;
  readonly modelType: RuntimeModelType;
  readonly contextWindow: number;
  readonly costTier: RuntimeCostTier;
  readonly healthy: RuntimeHealth;
  readonly recentErrorRate?: number;
}

export interface RuntimeToolCapability {
  readonly toolId: string;
  readonly name: string;
  readonly category?: string;
  readonly enabled: boolean;
  readonly healthy: RuntimeHealth;
  readonly note?: string;
}

export interface RuntimeDepHealth {
  readonly healthy: RuntimeHealth;
  readonly checkedAt: string;
  readonly note?: string;
}

export interface RuntimeUserKeyState {
  readonly hasByok: boolean;
  readonly byokProviders: ReadonlyArray<string>;
  readonly sharedKeyAvailable: boolean;
}

/**
 * L2 Environment Snapshot — 客观环境事实，与任何 AI App 无关。
 */
export interface EnvironmentSnapshot {
  readonly generatedAt: string;
  readonly userId: string;
  readonly models: Readonly<
    Record<RuntimeModelType, ReadonlyArray<RuntimeModelCapability>>
  >;
  readonly agents: ReadonlyArray<string>; // L2 AgentRegistry 全量 id
  readonly tools: ReadonlyArray<RuntimeToolCapability>; // L2 ToolRegistry
  readonly skills: ReadonlyArray<string>; // L2 SkillRegistry 全量 id
  readonly userKeys: RuntimeUserKeyState;
  readonly externalDeps: Readonly<Record<string, RuntimeDepHealth>>;
}

export interface EnvironmentSnapshotParams {
  readonly userId: string;
  /** 强制刷新缓存（默认使用 30 秒缓存） */
  readonly force?: boolean;
}
