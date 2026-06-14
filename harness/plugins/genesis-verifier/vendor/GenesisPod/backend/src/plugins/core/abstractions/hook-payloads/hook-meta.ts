/**
 * Hook 调用元数据（v5.1 R0.5 PR-0 / standards/19 §三）
 *
 * 出现在所有 hook payload 的 `meta` 字段中，统一抽象，**业务无关**：
 *   - missionId / agentId / model 等是平台层概念
 *   - 严禁出现 ai-app 名（research / consumer / writing 等）—— v5.1 §0 红线
 *   - agentType 是业务无关的标签（如 "research-style" / "write-style"），由 SKILL.md
 *     frontmatter `tags` 字段表达，不是 ai-app 名
 */
export interface HookMeta {
  readonly missionId?: string;
  readonly agentId?: string;
  readonly model?: string;
  readonly tenantId?: string;
  readonly agentType?: string;
  readonly correlationId?: string;
  /** 调用时间戳（毫秒） */
  readonly timestamp?: number;
}
