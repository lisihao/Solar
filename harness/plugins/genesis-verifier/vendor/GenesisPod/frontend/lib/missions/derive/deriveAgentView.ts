/**
 * deriveAgentView — Role / Agent progression 投影（canonical 派生层）
 *
 * 蓝图 §9.6：各 feature 团队角色不同（playground leader/researcher/writer/...、
 * social author/editor、radar runner），这里把"角色状态卡"需要的字段做归一化，
 * 让 canonical RoleCard 能跨 feature 复用。
 *
 * 纯函数、无 React 依赖。
 */

/** Agent / Role canonical 阶段（与 RoleCardStatus 对齐） */
export type CanonicalAgentPhase =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export interface AgentView {
  /** 唯一 id（feature 内部 agent id） */
  agentId: string;
  /** 角色名（leader / researcher / writer / 自定义...） */
  role: string;
  /** 显示用 label（默认 = role） */
  label?: string;
  /** canonical 阶段 */
  phase: CanonicalAgentPhase;
  /** feature 可选：模型 id（gpt-4 / claude-3 / ...） */
  modelId?: string;
  /** feature 可选：耗时 ms */
  wallTimeMs?: number;
  /** feature 可选：维度名 / 子任务名（researcher#1 的"市场规模"等） */
  dimension?: string;
  /** feature 可选：失败信息 */
  failureMessage?: string;
}

export interface AgentDeriveInput {
  agentId: string;
  role: string;
  label?: string;
  /** feature 内部字符串状态 */
  phase: string;
  modelId?: string;
  wallTimeMs?: number;
  dimension?: string;
  failureMessage?: string;
}

/** 把 feature 内部 agent list 归一化成 canonical AgentView[] */
export function deriveAgentView(input: AgentDeriveInput[]): AgentView[] {
  return input.map((a) => ({
    agentId: a.agentId,
    role: a.role,
    label: a.label,
    phase: normalizeAgentPhase(a.phase),
    modelId: a.modelId,
    wallTimeMs: a.wallTimeMs,
    dimension: a.dimension,
    failureMessage: a.failureMessage,
  }));
}

function normalizeAgentPhase(raw: string): CanonicalAgentPhase {
  const v = raw.toLowerCase();
  if (v === 'completed' || v === 'done' || v === 'success') return 'completed';
  if (v === 'running' || v === 'active' || v === 'in_progress')
    return 'running';
  if (v === 'failed' || v === 'error' || v === 'rejected') return 'failed';
  return 'pending';
}

/** 按 role 分组（用于 mission 详情页"按角色摆位"） */
export function groupAgentsByRole(
  agents: AgentView[]
): Map<string, AgentView[]> {
  const out = new Map<string, AgentView[]>();
  for (const a of agents) {
    const arr = out.get(a.role) ?? [];
    arr.push(a);
    out.set(a.role, arr);
  }
  return out;
}
