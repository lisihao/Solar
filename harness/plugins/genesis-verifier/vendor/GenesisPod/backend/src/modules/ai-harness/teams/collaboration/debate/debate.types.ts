/**
 * 抽象辩论 Pattern 类型 —— 纯协议层，无持久化。
 *
 * 来源：W1 PR2 评审修订（teams-mode-review.md §2 + §3.1 P0-4）。
 * 设计：原计划"提层" ai-app/teams/debate.service 整文件，
 *      但该 service 与 teams Prisma 模型（DebateSession/DebateAgent/Topic）
 *      深度耦合，搬到 harness 会把业务持久化拖进通用层，违反 MECE。
 *      改为：harness 仅提供纯 pattern + 抽象接口，
 *      ai-app/teams 与 ai-app/ask 各自实现 IDebateAgent 适配自己的持久化。
 *
 * 关联：
 *   - docs/architecture/ai-app/ask/teams-mode.md §5（adapters）
 *   - docs/architecture/ai-app/ask/teams-mode-review.md §3.1（P0-4）
 */

/**
 * 辩论中的角色。
 *
 * 注意：与 Prisma `DebateRole` enum 字符串值保持一致，便于 ai-app/teams
 * 在适配 IDebateAgent 时直接 1:1 映射。
 */
export type DebateRole = "RED" | "BLUE" | "JUDGE";

/**
 * 辩论一回合的输出。
 */
export interface DebateRoundResult {
  /** 回合序号（从 1 起） */
  round: number;
  /** 该回合的发言者（agentId） */
  speakerId: string;
  /** 发言者角色 */
  role: DebateRole;
  /** 发言文本内容 */
  content: string;
  /** 该回合 token 用量（如可用） */
  tokensUsed?: number;
}

/**
 * Pattern 配置。所有可选项有合理默认值。
 */
export interface DebatePatternConfig {
  /** 最大轮数（默认 3） */
  maxRounds?: number;
  /** 单回合超时（ms，默认 120000） */
  roundTimeoutMs?: number;
  /** 是否启用 Judge 总结（默认 false） */
  enableJudge?: boolean;
  /** 中断信号（用户取消 / billing 超限） */
  signal?: AbortSignal;
}

/**
 * 抽象辩论参与者。各 app 各自实现该接口，关联自己的持久化层与计费。
 *
 * Pattern 不知道 Prisma、不知道 Topic、不知道 AskRoom；
 * 它仅依赖该接口提供"chat 能力 + 角色 + 历史"。
 *
 * 评审修订（R2 重要）：增加 metadata 透传字段，让 adapter 层可携带房间 id /
 * 会话 id / billing referenceId 等上下文，pattern 不解读，仅在跨 adapter 协作
 * 时由消费方原样读取（pattern 自己不会读）。
 */
export interface IDebateAgent {
  /** Agent 唯一 id（在本次辩论会话中） */
  readonly id: string;
  /** 显示名 */
  readonly displayName: string;
  /** 在本场辩论中的角色 */
  readonly role: DebateRole;
  /** 在本场辩论中的立场（描述性文本，用于 system prompt） */
  readonly stance: string;
  /**
   * adapter 携带的不透明上下文（pattern 不解读）。
   * 典型用途：room/session/turn id、billing referenceId、模型偏好。
   * pattern 不会修改或读取该字段；adapter 在自己的 chat() 实现中通过 closure
   * capture 即可使用，无需经过 pattern 流转。
   */
  readonly metadata?: Record<string, unknown>;
  /**
   * 调用底层 LLM 输出本回合发言。
   *
   * @param systemPrompt 完整的 system prompt（由 pattern 拼好）
   * @param history 该 agent 自己的历史发言（不含他人，独立隔离）
   * @param userMessage 本回合的"用户消息"（如：对手的上一轮发言）
   * @param signal 取消信号；adapter 实现应在 chat 进入与流式接收阶段都检查
   */
  chat(input: {
    systemPrompt: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
    signal?: AbortSignal;
  }): Promise<{ content: string; tokensUsed?: number }>;
}
