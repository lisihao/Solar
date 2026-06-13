/**
 * SAFETY_INPUT / SAFETY_OUTPUT hook payload
 *
 * Fire point：ai-engine/safety pipeline 入口与出口
 * Plugin 用例：
 *   - PII 检测 / 删除
 *   - prompt injection 防护
 *   - 内容审核（违禁词 / 政策合规）
 */

export interface SafetyInputPayload {
  readonly text: string;
  /** 上下文：来源（user / agent / tool）+ 业务标签 */
  readonly source: "user" | "agent" | "tool";
  readonly tags?: ReadonlyArray<string>;
}

export interface SafetyOutputPayload {
  readonly text: string;
  /** 输出关联的 agent / tool */
  readonly producedBy: string;
  readonly tags?: ReadonlyArray<string>;
}

/** Safety 决策结果（hook 用 replacePayload 注入） */
export interface SafetyDecisionPayload {
  /** 是否被阻断 */
  readonly blocked: boolean;
  /** 原因 */
  readonly reason?: string;
  /** 替换后的文本（部分 PII 脱敏） */
  readonly sanitizedText?: string;
}
