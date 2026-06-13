/**
 * mission-todo.types.ts — Frontend MissionTodo TYPE MIRROR + UI-only helper
 *
 * 落地依据：thinning plan §B4-4 / §B5-1 / §6.6.3 / §7.2
 *
 * **2026-05-26 重命名收口**：原 todo-ledger-shapes.ts。"ledger" 容易暗示 truth
 * derivation；本文件实际是 frontend MissionTodo TYPE MIRROR，仅供组件 prop 标注，
 * 不携带任何 truth derivation。
 *
 * **本文件包含**：
 *   1. MissionTodo 形状类型（mirror backend `TodoBoardEntry`，省 retryPipelineKey 等
 *      backend-only 字段）
 *   2. UI-only helper：deriveLayerBreadcrumb（§6.6.3 second list / §7.2 UI-only helper）
 *
 * **truth source**: backend canonical view `missionView.todoBoard.items: TodoBoardEntry[]`。
 *   page.tsx 将其映射为 MissionTodo[]，分发到组件。
 */

// ============================================================================
// MissionTodo enums
// ============================================================================

export type MissionTodoOrigin =
  | 'leader-plan'
  | 'leader-assess-retry'
  | 'leader-assess-replace'
  | 'leader-assess-extend'
  | 'leader-assess-abort'
  | 'leader-chat-create'
  | 'self-heal-retry'
  | 'reviewer-revise'
  | 'critic-blindspot'
  | 'reconciler-gap'
  | 'system-stage'
  | 'chapter-pipeline';

export type MissionTodoScope =
  | 'mission'
  | 'dimension'
  | 'chapter'
  | 'review'
  | 'system';

export type MissionTodoStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface MissionTodoAssignee {
  role:
    | 'leader'
    | 'researcher'
    | 'analyst'
    | 'writer'
    | 'reviewer'
    | 'reconciler'
    | 'critic'
    | 'mission';
  agentId?: string;
  dimensionName?: string;
}

export interface MissionTodoArtifact {
  kind:
    | 'finding-count'
    | 'insight-count'
    | 'fact-table'
    | 'figure'
    | 'chapter'
    | 'verdict-score'
    | 'critic-warning'
    | 'foreword';
  label: string;
  value?: string | number;
}

export interface MissionTodoNarrativeItem {
  ts: number;
  text: string;
  tone?: 'info' | 'success' | 'warn' | 'error';
}

export type SystemStageId =
  | 's1-budget'
  | 's2-leader-plan'
  | 's3-researchers'
  | 's4-leader-assess'
  | 's5-reconciler'
  | 's6-analyst'
  | 's7-writer-outline'
  | 's8-writer-draft'
  | 's8b-quality-enhancement'
  | 's9-critic-l4'
  | 's9b-objective-evaluation'
  | 's10-leader-signoff'
  | 's11-persist'
  | 's12-self-evolution';

export interface MissionTodo {
  id: string;
  parentId?: string;
  origin: MissionTodoOrigin;
  createdBy: 'leader' | 'reviewer' | 'critic' | 'reconciler' | 'system';
  createdAt: number;
  reasonText: string;
  scope: MissionTodoScope;
  title: string;
  assignee: MissionTodoAssignee;
  status: MissionTodoStatus;
  startedAt?: number;
  endedAt?: number;
  artifacts: MissionTodoArtifact[];
  narrativeLog: MissionTodoNarrativeItem[];
  agentRefId?: string;
  dimensionRef?: string;
  systemStageId?: SystemStageId;
  pipelineKey?: string;
  retryStrategy?: 'fresh-collect' | 'reuse-recompute';
  failedStage?: string;
}

// ============================================================================
// UI-only helper（§6.6.3 second list / §7.2 — 不携带 mission truth）
// ============================================================================

export interface MissionTodoLayer {
  id: 'AI-APP' | 'AI-HARNESS' | 'AI-ENGINE' | 'AI-INFRA';
  label: string;
  detail: string;
}

/**
 * 4 层架构面包屑 —— 给 drawer 顶部用。
 * 根据 todo 的 systemStageId / scope / origin 派生，不消费 events / mission truth。
 */
export function deriveLayerBreadcrumb(todo: MissionTodo): MissionTodoLayer[] {
  const harnessLoop = (() => {
    if (todo.scope === 'system' && todo.systemStageId) {
      switch (todo.systemStageId) {
        case 's2-leader-plan':
        case 's4-leader-assess':
        case 's10-leader-signoff':
          return 'Leader-Replanner-Lite';
        case 's3-researchers':
          return 'ReAct + 自愈';
        case 's5-reconciler':
        case 's9-critic-l4':
          return 'Judge';
        case 's6-analyst':
          return 'Reflexion';
        case 's7-writer-outline':
          return 'Planning';
        case 's8-writer-draft':
          return 'ReAct (自愈)';
        case 's1-budget':
        case 's11-persist':
          return '—';
        case 's12-self-evolution':
          return 'FailureLearner + VectorMemory';
      }
    }
    if (todo.scope === 'dimension') return 'ReAct + 自愈';
    if (todo.scope === 'chapter') return 'Chapter-pipeline';
    if (todo.scope === 'review') return 'Judge';
    return '—';
  })();

  const engineCapability = (() => {
    if (todo.scope === 'system' && todo.systemStageId) {
      switch (todo.systemStageId) {
        case 's2-leader-plan':
          return 'TaskProfile · Leader prompt';
        case 's3-researchers':
          return 'Tools · web-search / arxiv / scrape';
        case 's4-leader-assess':
          return 'TaskProfile · 决策提示';
        case 's5-reconciler':
          return 'Skills · 实体抽取 / 冲突检测';
        case 's6-analyst':
          return 'TaskProfile · 综合提示';
        case 's7-writer-outline':
        case 's8-writer-draft':
          return 'Skills · 写作 + 引用规范化';
        case 's9-critic-l4':
          return 'TaskProfile · 独立复审';
        case 's10-leader-signoff':
          return 'TaskProfile · 签字提示';
        case 's1-budget':
          return 'modelRouting · 预估';
        case 's11-persist':
          return 'memory · trajectory';
      }
    }
    if (todo.scope === 'dimension') return 'Tools · web-search / arxiv';
    if (todo.scope === 'chapter') return 'Skills · 写作';
    if (todo.scope === 'review') return 'Skills · 评审';
    return '—';
  })();

  const infraCapability = (() => {
    if (todo.systemStageId === 's1-budget') return 'Credits · 预估 + 闸门';
    if (todo.systemStageId === 's11-persist') return 'Storage · DB 落库';
    return 'Credits · BillingContext + tickCost';
  })();

  return [
    {
      id: 'AI-APP',
      label: 'AI-APP',
      detail: 'agent-playground · 原生 Agent Team',
    },
    {
      id: 'AI-HARNESS',
      label: 'AI-HARNESS',
      detail: harnessLoop,
    },
    {
      id: 'AI-ENGINE',
      label: 'AI-ENGINE',
      detail: engineCapability,
    },
    {
      id: 'AI-INFRA',
      label: 'AI-INFRA',
      detail: infraCapability,
    },
  ];
}
