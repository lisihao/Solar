/**
 * TEAM_HANDOFF hook payload
 *
 * Fire point：teams orchestrator 切换 agent / handoff workflow
 * Plugin 用例：
 *   - audit log（谁在什么时候交给谁）
 *   - role-based access control（替代 / 阻断特定 handoff）
 */

export interface TeamHandoffPayload {
  readonly missionId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  /** handoff 上下文（messages / state / 业务自定义），不透明 */
  readonly context: unknown;
}
