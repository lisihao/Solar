'use client';

/**
 * MissionTodoBoard —— 任务列表（design system v1）
 *
 * 单一扁平表格，每行 = 1 个真实任务（dim 研究 / critic 警示 / reconciler 缺口）。
 * 不展示 system-stage 阶段行。章节重写聚合到 dim 行的 artifacts，不单独成行。
 *
 * 全程使用 playground-ui primitives + design tokens。
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MissionTaskList } from '@/components/common/mission-detail';
import { TruncatedCell } from '@/components/common/tables';
import { toast, confirm } from '@/stores';
import {
  ListChecks,
  Lightbulb,
  AlertTriangle,
  Search,
  PenLine,
  ShieldAlert,
  ScanSearch,
  Brain,
  ChevronRight,
  PiggyBank,
  GitBranch,
  Gavel,
  Database,
  Sparkles,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { rerunTodo, localRerunTodo } from '@/services/agent-playground/api';
import { cn } from '@/lib/utils/common';
import type {
  MissionTodo,
  MissionTodoStatus,
  MissionTodoAssignee,
} from '@/lib/features/agent-playground/mission-todo.types';
import type {
  AgentLiveState,
  DimensionPipelineState,
} from '@/lib/features/agent-playground/mission-presentation.types';
import { Card, StatusPill, RoleChip } from '@/components/agent-playground/ui';
import { statusToken } from '@/lib/design/tokens';
import { friendlyError } from '@/lib/features/agent-playground/friendly-error.util';
import { FRONTEND_STAGE_TO_STEP_ID } from '@/lib/features/agent-playground/stage-id-mapping';
import {
  AgentInspector,
  type AgentInspectorAgent,
} from '@/components/common/agent-inspector';

interface Props {
  todos: MissionTodo[];
  themeSummary?: string;
  selectedKey?: string | null;
  onSelect?: (todoId: string | null) => void;
  missionFailed?: boolean;
  missionFailedMessage?: string;
  missionCancelled?: boolean;
  /** ★ 2026-05-29: quality-failed（拒签）也是非成功终态，不得显示顶层"已完成"。 */
  missionQualityFailed?: boolean;
  agents?: AgentLiveState[];
  dimensionPipelines?: Map<string, DimensionPipelineState>;
  /** mission id —— 用于单 todo 重跑 */
  missionId?: string;
  /** mission 是否处于终态（completed/failed/cancelled）—— 决定是否允许重跑 */
  missionTerminal?: boolean;
}

/** dim 任务细分状态：采集 / 撰写 / 复审 / 重写 / 评分 / 完成 / 失败 */
function deriveDimSubStatus(
  td: MissionTodo,
  pipelines?: Map<string, DimensionPipelineState>,
  allTodos?: MissionTodo[],
  agents?: AgentLiveState[],
  missionCompleted?: boolean
): { label: string; tone: string } | null {
  if (td.scope !== 'dimension') return null;
  // ★ 优先级最高：若该 dim 有 leader-assess-* 子任务在 in_progress，整个 dim 显示"重派采集中"
  //   即便 dim 本身之前已 graded，Leader 重派时 UI 必须明确表达"在重做"
  if (allTodos && td.scope === 'dimension') {
    const liveLeaderRetry = allTodos.find(
      (x) =>
        x.parentId === td.id &&
        (x.origin === 'leader-assess-retry' ||
          x.origin === 'leader-assess-replace' ||
          x.origin === 'leader-assess-extend') &&
        (x.status === 'in_progress' || x.status === 'pending')
    );
    if (liveLeaderRetry) {
      return {
        label: 'Leader 重派采集中',
        tone: 'bg-orange-100 text-orange-700 ring-orange-200',
      };
    }
    const liveSelfHeal = allTodos.find(
      (x) =>
        x.parentId === td.id &&
        x.origin === 'self-heal-retry' &&
        (x.status === 'in_progress' || x.status === 'pending')
    );
    if (liveSelfHeal) {
      return {
        label: '自愈重试中',
        tone: 'bg-orange-100 text-orange-700 ring-orange-200',
      };
    }
  }
  if (td.status === 'failed')
    return {
      // ★ 区分失败阶段：章节 pipeline 失败 ≠ 采集失败（采集其实成功了）
      label:
        td.failedStage === 'chapter-pipeline-failed' ? '撰写失败' : '采集失败',
      tone: 'bg-red-100 text-red-700 ring-red-200',
    };
  if (td.status === 'cancelled')
    return {
      label: '已放弃',
      tone: 'bg-gray-100 text-gray-600 ring-gray-200',
    };
  const pipelineKey = td.pipelineKey ?? td.dimensionRef;
  const pipeline = pipelineKey ? pipelines?.get(pipelineKey) : undefined;
  // 还没起 outline
  if (!pipeline || pipeline.chapters.length === 0) {
    // ★ 2026-05-27 修复 Screenshot_32/33 实证：Drawer 显示该 dim 已完成、tokens
    //   都跑出来了，列表却仍写"数据采集"。根因：deriveDimSubStatus 这里只看
    //   pipeline.chapters.length === 0 就标"采集中"，没看 researcher agent 自身已
    //   `phase === 'completed'`。研究阶段确实完了、但写作阶段没起来时（mission 终态
    //   + 整合阶段被跳过 / pipeline 残缺），标"采集完成 · 待大纲"更准确。
    const dimName = td.assignee?.dimensionName;
    const researcher = dimName
      ? agents?.find((a) => a.role === 'researcher' && a.dimension === dimName)
      : undefined;
    if (researcher?.phase === 'completed') {
      return {
        label: '采集完成 · 待大纲',
        tone: 'bg-teal-100 text-teal-700 ring-teal-200',
      };
    }
    if (researcher?.phase === 'failed') {
      return {
        label: '采集失败',
        tone: 'bg-red-100 text-red-700 ring-red-200',
      };
    }
    if (td.status === 'done') {
      // dimension todo 会在 research completed 时先变成 done；只有在后续章节/评分
      // 流水线尚未 materialize 时，列表才显示“采集完成”。一旦 pipeline 有章节数据，
      // 必须继续往下看 writing/review/grade，不能被这个早期 done 卡死。
      return missionCompleted
        ? {
            label: '已完成',
            tone: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
          }
        : {
            label: '采集完成',
            tone: 'bg-teal-100 text-teal-700 ring-teal-200',
          };
    }
    return {
      label: '数据采集',
      tone: 'bg-blue-100 text-blue-700 ring-blue-200',
    };
  }
  const chs = pipeline.chapters;
  const total = chs.length;
  // ★ 2026-05-01 (用户实证：评审通过后跳"待启动")：把 'done' / 'failed-finalized' 也算
  //   终态，避免 chapter:done 事件到达后 passed 计数清零、所有章节看起来重新"待启动"。
  const passed = chs.filter(
    (c) => c.status === 'passed' || c.status === 'done'
  ).length;
  const failed = chs.filter(
    (c) => c.status === 'failed' || c.status === 'failed-finalized'
  ).length;
  const writing = chs.filter((c) => c.status === 'writing').length;
  const reviewing = chs.filter((c) => c.status === 'reviewing').length;
  const revising = chs.filter((c) => c.status === 'revising').length;
  // ★ 已开工章节数 = 任何 status !== 'pending' —— 用于 N/M 副数字（开工/总数）
  //   主标签按 "最深推进阶段" 决定（passed > review > writing > revising > pending）
  //   副数字一律是 inflight（开工章节数），不再用单一状态计数
  const inflight = chs.filter((c) => c.status !== 'pending').length;
  if (failed > 0) {
    return {
      label: `撰写失败 ${failed}/${total}`,
      tone: 'bg-red-100 text-red-700 ring-red-200',
    };
  }
  if (revising > 0) {
    return {
      label: `重写中 · ${inflight}/${total}`,
      tone: 'bg-orange-100 text-orange-700 ring-orange-200',
    };
  }
  if (reviewing > 0) {
    return {
      label: `初稿复审 · ${inflight}/${total}`,
      tone: 'bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200',
    };
  }
  if (writing > 0) {
    return {
      label: `初稿撰写 · ${inflight}/${total}`,
      tone: 'bg-teal-100 text-teal-700 ring-teal-200',
    };
  }
  // 全部章节通过，但 grade 还没出来
  // ★ 2026-05-01 真治根（mission da6e2af7 实证）：backend per-dim-pipeline 已用
  //   try/finally INVARIANT 保证每个 dim 必发 graded 事件（成功 / 失败 / 跳过）。
  //   前端"等待评分"仅作为 < 1 秒短暂中间态。grade.failed=true → 显示"评分失败"
  //   而非误导的"已完成 · 0/100"；degraded 走通过路径标 "兜底完成"。
  if (passed === total && !pipeline.grade) {
    return {
      label: '等待评分',
      tone: 'bg-amber-100 text-amber-700 ring-amber-200',
    };
  }
  if (passed === total && pipeline.grade) {
    if (pipeline.grade.failed) {
      const reason =
        pipeline.grade.phase === 'no-findings'
          ? '采集失败'
          : pipeline.grade.phase === 'outline-failed'
            ? '大纲失败'
            : pipeline.grade.phase === 'no-chapters'
              ? '章节失败'
              : pipeline.grade.phase === 'integrator-failed'
                ? '整合失败'
                : pipeline.grade.phase === 'grade-failed'
                  ? '评分失败'
                  : pipeline.grade.phase === 'pipeline-exception'
                    ? '流水线异常'
                    : pipeline.grade.phase === 'research-failed'
                      ? '研究失败'
                      : '评分跳过';
      return {
        label: `${reason}`,
        tone: 'bg-red-100 text-red-700 ring-red-200',
      };
    }
    if (pipeline.integrationDegraded) {
      return {
        label: `兜底完成 · ${pipeline.grade.overall}/100`,
        tone: 'bg-orange-100 text-orange-700 ring-orange-200',
      };
    }
    return {
      label: `已完成 · ${pipeline.grade.overall}/100`,
      tone: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    };
  }
  // 还有 pending 章节
  return {
    label: `${passed}/${total} 章节就绪`,
    tone: 'bg-blue-100 text-blue-700 ring-blue-200',
  };
}

/** 解析 todo 到对应 agent 的 modelId */
function resolveModel(
  todo: MissionTodo,
  agents: AgentLiveState[]
): string | undefined {
  const ref = todo.agentRefId;
  if (ref) {
    const a =
      agents.find((x) => x.agentId === ref) ??
      agents.find((x) => x.agentId.startsWith(`${ref}.`));
    if (a?.modelId) return a.modelId;
  }
  if (todo.assignee.dimensionName) {
    const a = agents.find(
      (x) =>
        x.role === 'researcher' && x.dimension === todo.assignee.dimensionName
    );
    if (a?.modelId) return a.modelId;
  }
  const byRole = agents.find((x) => x.role === todo.assignee.role);
  return byRole?.modelId;
}

/** todo.status 映射到 StatusPill 的 status key */
function statusKey(s: MissionTodoStatus) {
  return s === 'done'
    ? 'done'
    : s === 'in_progress'
      ? 'running'
      : s === 'failed'
        ? 'failed'
        : s === 'cancelled'
          ? 'cancelled'
          : s === 'blocked'
            ? 'blocked'
            : 'pending';
}

/** 排序：进行中 > 待启动 > 已完成 > 失败 > 已放弃 */
const STATUS_PRIORITY: Record<MissionTodoStatus, number> = {
  in_progress: 0,
  pending: 1,
  blocked: 2,
  done: 3,
  failed: 4,
  cancelled: 5,
};

/** 任务类型图标（按 scope+systemStageId+origin） */
function taskIcon(td: MissionTodo): LucideIcon {
  if (td.systemStageId) {
    switch (td.systemStageId) {
      case 's1-budget':
        return PiggyBank;
      case 's2-leader-plan':
      case 's4-leader-assess':
      case 's10-leader-signoff':
        return Brain;
      case 's3-researchers':
        return Search;
      case 's5-reconciler':
        return ScanSearch;
      case 's6-analyst':
        return GitBranch;
      case 's7-writer-outline':
      case 's8-writer-draft':
        return PenLine;
      case 's9-critic-l4':
        return ShieldAlert;
      case 's11-persist':
        return Database;
      case 's12-self-evolution':
        return Sparkles;
    }
  }
  if (td.scope === 'dimension') return Search;
  if (td.scope === 'chapter') return PenLine;
  if (td.scope === 'review') {
    if (td.origin === 'critic-blindspot') return ShieldAlert;
    if (td.origin === 'reconciler-gap') return ScanSearch;
    return Gavel;
  }
  return Brain;
}

/** 起因 badge 文案 + 配色 + tooltip（每行前置的 4 字色块标签） */
function originBadge(td: MissionTodo): {
  label: string;
  tone: string;
  hint: string;
} {
  // system stage：每阶段独立配色，4 字术语
  if (td.systemStageId) {
    switch (td.systemStageId) {
      case 's1-budget':
        return {
          label: '预算估算',
          tone: 'bg-amber-100 text-amber-700 ring-amber-200',
          hint: 'Mission 启动前的 token 预算估算与额度校验（S1）',
        };
      case 's2-leader-plan':
        return {
          label: '维度规划',
          tone: 'bg-violet-100 text-violet-700 ring-violet-200',
          hint: 'Leader 把 topic 拆成多个研究维度（MECE）+ 声明成功标准（S2）',
        };
      case 's3-researchers':
        return {
          label: '并行研究',
          tone: 'bg-blue-100 text-blue-700 ring-blue-200',
          hint: '所有 Researcher 并行调研各自维度，搜证 / 提取 finding / 生成章节（S3）',
        };
      case 's4-leader-assess':
        return {
          label: '研究初审',
          tone: 'bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200',
          hint: 'Leader 看完 Researcher 产出后做 accept / patch / redirect / abort 决策（S4）',
        };
      case 's5-reconciler':
        return {
          label: '跨维对账',
          tone: 'bg-sky-100 text-sky-700 ring-sky-200',
          hint: '跨维度 fact-check：抽事实表、检测冲突 / 重叠 / 缺口（S5）',
        };
      case 's6-analyst':
        return {
          label: '综合分析',
          tone: 'bg-cyan-100 text-cyan-700 ring-cyan-200',
          hint: 'Analyst 跨维度归纳 insights、消解矛盾、生成 themeSummary（S6）',
        };
      case 's7-writer-outline':
        return {
          label: '章节规划',
          tone: 'bg-teal-100 text-teal-700 ring-teal-200',
          hint: 'Writer 规划 mission 级章节大纲（S7，仅 thorough+ 档位）',
        };
      case 's8-writer-draft':
        return {
          label: '撰写报告',
          tone: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
          hint: 'Writer 起草 + L3 三路 Reviewer 评分 + memory 入库 + 装配 ReportArtifact（S8）',
        };
      case 's9-critic-l4':
        return {
          label: '独立复审',
          tone: 'bg-rose-100 text-rose-700 ring-rose-200',
          hint: '独立 Critic Agent 跳出闭环找盲点 / 偏见 / 改进建议（S9，thorough+ 启用）',
        };
      case 's10-leader-signoff':
        return {
          label: '终审签字',
          tone: 'bg-purple-100 text-purple-700 ring-purple-200',
          hint: 'Leader 综合所有产出写前言并对最终交付物签字承诺（S10）',
        };
      case 's11-persist':
        return {
          label: '落库归档',
          tone: 'bg-slate-100 text-slate-700 ring-slate-200',
          hint: '按签字结果 markCompleted / markFailed，trace 向量化入用户记忆（S11）',
        };
      case 's12-self-evolution':
        return {
          label: '自我进化',
          tone: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
          hint: '本次 mission 复盘 → FailureLearner 记失败 pattern + postmortem 入向量记忆，下次同主题启动时 leader plan 自动召回历史经验（S12）',
        };
    }
  }
  switch (td.origin) {
    case 'leader-plan':
      return {
        label: '维度任务',
        tone: 'bg-blue-100 text-blue-700 ring-blue-200',
        hint: 'Leader 在 S2 维度规划阶段派下来的研究维度子任务',
      };
    case 'leader-assess-retry':
      return {
        label: '评审重派',
        tone: 'bg-orange-100 text-orange-700 ring-orange-200',
        hint: 'Leader 在 S4 初审看完 Researcher 产出后给出 patch 决策 —— 同一 Researcher 带着补丁要点（缺哪类证据）再做一轮',
      };
    case 'leader-assess-replace':
      return {
        label: '换签 spec',
        tone: 'bg-orange-100 text-orange-700 ring-orange-200',
        hint: 'Leader S4 初审决策：原方案不可救，改用新的 spec / 角色 / 检索策略重做',
      };
    case 'leader-assess-extend':
      return {
        label: '追加任务',
        tone: 'bg-orange-100 text-orange-700 ring-orange-200',
        hint: 'Leader S4 初审决策：维度覆盖不全，新增一个维度补上空白',
      };
    case 'leader-assess-abort':
      return {
        label: '放弃维度',
        tone: 'bg-amber-100 text-amber-700 ring-amber-200',
        hint: 'Leader S4 初审决策：该维度无法补救，标记放弃，不再投入预算',
      };
    case 'leader-chat-create':
      return {
        label: '对话追加',
        tone: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
        hint: '用户通过 Leader Chat 实时追加的研究维度',
      };
    case 'self-heal-retry':
      return {
        label: '自愈重试',
        tone: 'bg-orange-100 text-orange-700 ring-orange-200',
        hint: '上一轮 finalize 校验失败 / 工具失败 / 模型不可用，框架自动重试',
      };
    case 'reviewer-revise':
      return {
        label: '复审重写',
        tone: 'bg-rose-100 text-rose-700 ring-rose-200',
        hint: 'Chapter Reviewer 评分 < 70，要求 Writer 按 critique 重写本章',
      };
    case 'critic-blindspot':
      return {
        label: '复审警示',
        tone: 'bg-red-100 text-red-700 ring-red-200',
        hint: 'L4 Independent Critic 发现的盲点 / 偏见 / 改进建议',
      };
    case 'reconciler-gap':
      return {
        label: '对账缺口',
        tone: 'bg-sky-100 text-sky-700 ring-sky-200',
        hint: 'Reconciler 跨维对账时发现的证据缺口（critical / minor）',
      };
    case 'system-stage':
      return {
        label: '系统阶段',
        tone: 'bg-gray-100 text-gray-700 ring-gray-200',
        hint: '系统级阶段任务',
      };
    case 'chapter-pipeline':
      return {
        label: '章节撰写',
        tone: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
        hint: 'Writer 按维度逐章撰写 + Reviewer 复审，每章独立推进',
      };
  }
}

function originLabel(td: MissionTodo): string {
  return originBadge(td).label;
}

/** assignee role → inspector 资料映射（覆盖 leader/researcher/analyst/writer/reviewer + reconciler/critic/mission） */
const ROLE_INSPECTOR_PROFILE: Record<
  MissionTodoAssignee['role'],
  {
    name: string;
    description: string;
    Icon: LucideIcon;
    loop: string;
    modelHint: string;
    skills: string[];
    tools: string[];
    verifiers?: string[];
  }
> = {
  leader: {
    name: 'Research Leader',
    description: '分析 topic、规划维度、组织 mission 全程编排与签字',
    Icon: Brain,
    loop: 'ReAct',
    modelHint: 'planning · 系统配置 CHAT 模型（BYOK）',
    skills: ['topic-decomposition', 'planning', 'sign-off'],
    tools: [],
  },
  researcher: {
    name: 'Dimension Researcher',
    description: '并行调研单一维度，搜证 / 提取 finding / 输出 dim summary',
    Icon: Search,
    loop: 'ReAct',
    modelHint: 'search · 系统配置 CHAT 模型（BYOK）',
    skills: ['evidence-gathering', 'finding-extraction'],
    tools: ['web-search', 'arxiv-search', 'github-search', 'web-scraper'],
  },
  reconciler: {
    name: 'Reconciler',
    description: '跨维对账：事实表抽取 / 冲突检测 / 重叠检测 / 缺口识别',
    Icon: ScanSearch,
    loop: 'ReAct',
    modelHint: 'reasoning · 系统配置 CHAT 模型（BYOK）',
    skills: ['fact-extraction', 'conflict-detection', 'gap-analysis'],
    tools: [],
  },
  analyst: {
    name: 'Research Analyst',
    description: '整合多维度发现，做交叉验证、矛盾消解、洞察归纳',
    Icon: GitBranch,
    loop: 'Reflexion',
    modelHint: 'reasoning · 系统配置 CHAT 模型（BYOK）',
    skills: ['critical-review', 'synthesis'],
    tools: [],
    verifiers: ['self', 'critical'],
  },
  writer: {
    name: 'Report Writer',
    description: '把 insights 写成结构化 Markdown 报告（章节 outline + draft）',
    Icon: PenLine,
    loop: 'ReAct',
    modelHint: 'long-form · 系统配置 CHAT 模型（BYOK）',
    skills: ['outline', 'draft', 'citation-normalization'],
    tools: [],
  },
  reviewer: {
    name: 'Quality Reviewer',
    description: '调用多个 Judge 并行评分，达成共识；< 70 分触发 Writer 重写',
    Icon: Gavel,
    loop: 'JudgeConsensus',
    modelHint: 'judge × 3 · 系统配置 CHAT 模型（BYOK）',
    skills: ['10-dim-grading', 'critique'],
    tools: [],
  },
  critic: {
    name: 'L4 Independent Critic',
    description: '独立复审：盲点 / 偏见 / 改进建议（不参与生产，避免自我确认）',
    Icon: ShieldAlert,
    loop: 'ReAct',
    modelHint: 'critical · 系统配置 CHAT 模型（BYOK）',
    skills: ['blindspot-detection', 'bias-flagging'],
    tools: [],
  },
  mission: {
    name: 'Mission Orchestrator',
    description: '系统级编排：预算闸 / 状态机 / 持久化 / 取消信号',
    Icon: Sparkles,
    loop: 'system',
    modelHint: '不调用 LLM',
    skills: ['budget-gate', 'state-machine', 'persistence'],
    tools: [],
  },
};

/** 解析 todo 到对应 agent 的实时实例（用于 inspector 实例计数 / recentThought） */
function resolveAssigneeAgents(
  todo: MissionTodo,
  agents: AgentLiveState[]
): AgentLiveState[] {
  if (todo.agentRefId) {
    const exact = agents.filter(
      (a) =>
        a.agentId === todo.agentRefId ||
        a.agentId.startsWith(`${todo.agentRefId}.`)
    );
    if (exact.length > 0) return exact;
  }
  if (todo.assignee.dimensionName) {
    return agents.filter(
      (a) =>
        a.role === 'researcher' && a.dimension === todo.assignee.dimensionName
    );
  }
  if (
    todo.assignee.role === 'leader' ||
    todo.assignee.role === 'analyst' ||
    todo.assignee.role === 'writer' ||
    todo.assignee.role === 'reviewer' ||
    todo.assignee.role === 'researcher'
  ) {
    return agents.filter((a) => a.role === todo.assignee.role);
  }
  return [];
}

function buildAssigneeInspectorPayload(
  todo: MissionTodo,
  agents: AgentLiveState[]
): AgentInspectorAgent {
  const profile = ROLE_INSPECTOR_PROFILE[todo.assignee.role];
  const matched = resolveAssigneeAgents(todo, agents);
  const running = matched.filter((a) => a.phase === 'running').length;
  const done = matched.filter((a) => a.phase === 'completed').length;
  const failed = matched.filter((a) => a.phase === 'failed').length;
  const totalIters = matched.reduce((s, a) => s + (a.iterations ?? 0), 0);

  let recentThought: string | undefined;
  for (let i = matched.length - 1; i >= 0 && !recentThought; i--) {
    const trace = matched[i].trace;
    for (let j = trace.length - 1; j >= 0; j--) {
      if (trace[j].kind === 'thought' && trace[j].text) {
        recentThought = trace[j].text;
        break;
      }
    }
  }

  const modelId = matched.find((a) => a.modelId)?.modelId;
  const dimName = todo.assignee.dimensionName;
  return {
    name: profile.name + (dimName ? ` · ${dimName}` : ''),
    description: profile.description,
    icon: profile.Icon,
    iconClassName: 'bg-violet-50 text-violet-600',
    // ★ Screenshot_81/82/83 (2026-05-27 #110 续): 用户反馈"没必要同一页显示两个
    //   状态, 显示一个就行" — 删掉顶部 statusLabel, 让 inspector 只显示下方
    //   instanceCounts row (running / completed / failed / iter) 作单一状态源。
    statusLabel: undefined,
    statusColorClass: undefined,
    totalInstances: matched.length || undefined,
    instanceCounts: matched.length
      ? {
          running,
          completed: done,
          failed,
          iterations: totalIters,
        }
      : undefined,
    config: [
      { label: 'Loop', value: profile.loop },
      { label: '模型', value: modelId ?? profile.modelHint },
      ...(todo.assignee.agentId
        ? [{ label: '实例 ID', value: todo.assignee.agentId }]
        : []),
      ...(dimName ? [{ label: '维度', value: dimName }] : []),
      { label: '技能', chips: profile.skills },
      ...(profile.tools.length > 0
        ? [{ label: '工具', chips: profile.tools }]
        : []),
      ...(profile.verifiers
        ? [{ label: 'Verifier', chips: profile.verifiers }]
        : []),
    ],
    recentThought,
  };
}

export function MissionTodoBoard({
  todos,
  selectedKey,
  onSelect,
  missionFailed,
  missionFailedMessage,
  missionCancelled,
  missionQualityFailed,
  agents,
  dimensionPipelines,
  missionId,
  missionTerminal,
}: Props) {
  const router = useRouter();
  // mission 真正完成（终态且非失败/取消/拒签）—— 决定维度卡片显示"已完成"还是"采集完成"。
  // quality-failed（拒签）虽是终态但非成功，顶层不得显示"已完成"（与页头 pill "质量未达标" 一致）。
  const missionCompleted =
    !!missionTerminal &&
    !missionFailed &&
    !missionCancelled &&
    !missionQualityFailed;
  const [inspectorTodo, setInspectorTodo] = useState<MissionTodo | null>(null);
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  const canRerunTodo = (td: MissionTodo): boolean => {
    if (!missionTerminal || !missionId) return false;
    // ★ PR-R5b-FULL (2026-05-07): s11-persist 已实装真 handler（c195035f 主用例）
    //   s12-self-evolution 是 postlude 异步任务，不在 cascade 体系，仍排除
    if (td.systemStageId === 's12-self-evolution') return false;
    // s1-budget 黑名单（后端 dag.rerunable=false）
    if (td.systemStageId === 's1-budget') return false;
    // 已放弃的维度不重跑（应整体 rerun 重新规划）
    if (td.origin === 'leader-assess-abort') return false;
    // 仅终态 / 失败 / 完成 任务允许（pending / in_progress 不显示）
    return (
      td.status === 'done' ||
      td.status === 'failed' ||
      td.status === 'cancelled'
    );
  };

  const handleRerunTodo = async (td: MissionTodo) => {
    if (!missionId || rerunningId) return;

    // ★ PR-R5b-FULL (2026-05-07): 13 stage 全部装真 handler 后，所有 systemStageId 映射
    //   到 stepId 都走局部重跑（cascade 自动展开下游）。仅 s12 / 无 stepId 走"开新研究对比"。
    const stepId = td.systemStageId
      ? FRONTEND_STAGE_TO_STEP_ID[td.systemStageId]
      : // ★ 2026-05-29 单维度局部重跑：维度 todo 无 systemStageId，映射到 s3 研究段
        //   + 传 dimensionRef，后端只重跑该维度（不重建整 mission）。
        td.scope === 'dimension' && td.dimensionRef
        ? 's3-researcher-collect'
        : undefined;
    const supportsLocalRerun =
      // 老路径兼容：s9b legacy todo id 后缀路径
      (td.scope === 'system' && td.id.endsWith('s9b-objective-evaluation')) ||
      // 新路径：systemStageId 可映射到 stepId 且非黑名单
      (!!stepId && stepId !== 's1-budget');

    setRerunningId(td.id);
    try {
      if (supportsLocalRerun) {
        // 真正的局部重跑：单 stage 重跑 + cascade 下游 + patch 回原 mission，不跳转
        await localRerunTodo(missionId, td.id, {
          origin: td.origin,
          scope: td.scope,
          dimensionRef: td.dimensionRef,
          todoTitle: td.title,
          reasonText: td.reasonText,
          stepId,
        });
        // 局部重跑成功 → mission:rerun-completed 事件触发外层 re-fetch persisted
        return;
      }

      // 非局部重跑：明确提示用户"将另起新 mission 跑完整流程"
      const confirmed = await confirm({
        title: '此任务类型不支持局部重跑',
        description:
          '点击「确认」会另起一个新 mission 重跑完整流程（约 5-15 分钟），并把此 todo 作为 leader 的 focus hint。',
        type: 'warning',
        confirmText: '另起新 mission 重跑',
      });
      if (!confirmed) return;

      const { missionId: newId } = await rerunTodo(missionId, td.id, {
        origin: td.origin,
        scope: td.scope,
        dimensionRef: td.dimensionRef,
        todoTitle: td.title,
        reasonText: td.reasonText,
      });
      router.push(`/agent-playground/team/${newId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('重跑失败', msg);
    } finally {
      setRerunningId(null);
    }
  };
  // 任务列表包含 system 阶段 + 工作任务（chapter 重写聚合到 dim，不进表）。
  // 历史 deriveTodoLedger HIDDEN_ORIGINS = {'reconciler-gap'}：跨维度对账 gap
  // 是 reconciler 自动跑的诊断结果，由 Analyst 综合纳入，无需用户操作 → 主列表隐藏。
  const HIDDEN_ORIGINS = new Set<MissionTodo['origin']>(['reconciler-gap']);
  const workTodos = todos.filter(
    (td) => td.scope !== 'chapter' && !HIDDEN_ORIGINS.has(td.origin)
  );

  // ─── 树状排序：parent 紧跟 children，children 缩进显示 ───
  // 1. 索引 parent → children
  const childrenByParent = new Map<string, MissionTodo[]>();
  for (const td of workTodos) {
    if (td.parentId) {
      const arr = childrenByParent.get(td.parentId) ?? [];
      arr.push(td);
      childrenByParent.set(td.parentId, arr);
    }
  }
  // 2. depth 计算（最多 2 层：system → dim → retry）
  const depthOf = (td: MissionTodo): number => {
    if (!td.parentId) return 0;
    const parent = workTodos.find((x) => x.id === td.parentId);
    return parent ? depthOf(parent) + 1 : 1;
  };
  // 3. DFS 展开顺序：preserve backend canonical order（todo-board.projector
  //    reorderTodoBoardItems 已经按 s1/s2 → dim → chapter → s3+ 排好），
  //    frontend 不再按 createdAt re-sort（system stage 都同 missionCreatedAt，
  //    会让 dim 错乱地堆到末尾，见 Screenshot_52 回归）。
  const sorted: MissionTodo[] = [];
  const rootOrderIndex = new Map<string, number>();
  workTodos.forEach((t, i) => {
    if (!t.parentId || !workTodos.some((p) => p.id === t.parentId)) {
      rootOrderIndex.set(t.id, i);
    }
  });
  const roots = workTodos
    .filter((t) => rootOrderIndex.has(t.id))
    .sort((a, b) => rootOrderIndex.get(a.id)! - rootOrderIndex.get(b.id)!);
  const visit = (td: MissionTodo) => {
    sorted.push(td);
    // children 仍按 createdAt 排（retry 子任务的产生顺序）
    const kids = (childrenByParent.get(td.id) ?? []).sort(
      (a, b) => a.createdAt - b.createdAt
    );
    for (const k of kids) visit(k);
  };
  for (const r of roots) visit(r);

  const counts = workTodos.reduce(
    (acc, td) => {
      acc[td.status] = (acc[td.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<MissionTodoStatus, number>
  );

  // ─── Empty state ───
  if (workTodos.length === 0) {
    if (missionFailed) {
      return (
        <Card className="bg-red-50/40" bordered>
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700">
                Mission 失败 · 任务列表为空
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-red-800">
                Leader 在维度规划阶段就挂了，没有产生任何子任务。
              </p>
              {missionFailedMessage && (
                <pre className="font-mono mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-[11px] leading-relaxed text-red-900 ring-1 ring-red-200">
                  {missionFailedMessage}
                </pre>
              )}
            </div>
          </div>
        </Card>
      );
    }
    return (
      <Card className="px-4 py-10 text-center" bordered>
        <Lightbulb className="mx-auto mb-2 h-7 w-7 text-amber-400" />
        <p className="text-sm font-medium text-gray-700">
          等 Leader 拆完维度，任务会动态出现
        </p>
      </Card>
    );
  }

  // ─── Header bar ───
  const Header = (
    <Card className="flex items-center justify-between px-4 py-2.5" bordered>
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-violet-500" />
        <h3 className="text-sm font-semibold text-gray-900">任务列表</h3>
        <span className="text-xs text-gray-500">
          · 共 {workTodos.length} 项
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {(
          ['done', 'in_progress', 'pending', 'failed', 'cancelled'] as const
        ).map((k) =>
          counts[k] ? (
            <span key={k} className="flex items-center gap-1 text-gray-500">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  k === 'done' && 'bg-emerald-500',
                  k === 'in_progress' && 'animate-pulse bg-blue-500',
                  k === 'failed' && 'bg-red-500',
                  k === 'cancelled' && 'bg-gray-400',
                  k === 'pending' && 'bg-gray-300'
                )}
              />
              {statusToken[statusKey(k)].label} {counts[k]}
            </span>
          ) : null
        )}
      </div>
    </Card>
  );

  // ─── Table ───
  return (
    <div className="space-y-3">
      {Header}
      <MissionTaskList<MissionTodo>
        items={sorted}
        getRowKey={(td) => td.id}
        selectedKey={selectedKey}
        onRowClick={(td) => onSelect?.(selectedKey === td.id ? null : td.id)}
        getRowClassName={(td) =>
          cn(
            td.status === 'in_progress' &&
              'bg-blue-50/40 border-l-4 border-l-blue-400',
            td.status === 'done' && 'border-l-4 border-l-emerald-400',
            td.status === 'failed' &&
              'bg-red-50/30 border-l-4 border-l-red-400',
            td.status === 'cancelled' &&
              'bg-gray-50/40 border-l-4 border-l-gray-300 opacity-70',
            td.status === 'pending' && 'border-l-4 border-l-transparent',
            td.status === 'blocked' &&
              'bg-amber-50/30 border-l-4 border-l-amber-400'
          ) || undefined
        }
        className="!p-0"
        columns={[
          {
            key: 'idx',
            label: '#',
            className: 'w-10 text-center',
            render: (_td, idx) => (
              <span className="text-xs text-gray-500">{idx + 1}</span>
            ),
          },
          {
            key: 'name',
            label: '任务名称',
            className: 'w-[36%]',
            render: (td) => {
              const Icon = taskIcon(td);
              return (
                <div
                  className="flex items-start gap-2"
                  style={{ paddingLeft: `${depthOf(td) * 18}px` }}
                >
                  {depthOf(td) > 0 && (
                    <span
                      className="mt-1.5 inline-block h-3 w-3 flex-shrink-0 border-b-2 border-l-2 border-violet-200"
                      aria-hidden
                    />
                  )}
                  <span
                    className={cn(
                      'mt-0.5 inline-flex flex-shrink-0 cursor-help items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1',
                      originBadge(td).tone
                    )}
                    title={originBadge(td).hint}
                  >
                    {originBadge(td).label}
                  </span>
                  <Icon className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <TruncatedCell className="text-sm font-medium text-gray-900">
                      {td.title}
                    </TruncatedCell>
                    {td.reasonText && (
                      <TruncatedCell className="text-[11px] text-gray-500">
                        {td.origin === 'self-heal-retry'
                          ? friendlyError(td.reasonText)
                          : td.reasonText}
                      </TruncatedCell>
                    )}
                  </div>
                </div>
              );
            },
          },
          {
            key: 'assignee',
            label: '负责人',
            className: 'w-[16%]',
            render: (td) => (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setInspectorTodo(td);
                }}
                className="rounded-md focus:outline-none focus:ring-2 focus:ring-violet-300"
                title="点击查看 Agent 详情"
              >
                <RoleChip
                  role={td.assignee.role}
                  agentId={td.assignee.agentId}
                  size="xs"
                />
              </button>
            ),
          },
          {
            key: 'model',
            label: '模型',
            className: 'w-[12%]',
            render: (td) => {
              const modelId = agents ? resolveModel(td, agents) : undefined;
              return modelId ? (
                <span className="font-mono inline-flex max-w-full items-center gap-1 rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 ring-1 ring-gray-200">
                  <TruncatedCell className="max-w-[96px] text-[10px]">
                    {modelId}
                  </TruncatedCell>
                </span>
              ) : (
                <span className="text-[10px] text-gray-300">—</span>
              );
            },
          },
          {
            key: 'status',
            label: '状态',
            className: 'w-[14%] text-center',
            render: (td) => {
              const sk = statusKey(td.status);
              const baseSub = deriveDimSubStatus(
                td,
                dimensionPipelines,
                todos,
                agents,
                missionCompleted
              );
              const subStatus =
                missionCancelled &&
                td.scope === 'dimension' &&
                (td.status === 'in_progress' || td.status === 'pending')
                  ? {
                      label: '已取消',
                      tone: 'bg-gray-100 text-gray-600 ring-gray-200',
                    }
                  : baseSub;
              return subStatus ? (
                <span
                  className={cn(
                    'inline-flex items-center justify-center whitespace-nowrap rounded-md px-2 py-0.5 text-[10.5px] font-medium ring-1',
                    subStatus.tone
                  )}
                  title={subStatus.label}
                >
                  {subStatus.label}
                </span>
              ) : missionCancelled &&
                (td.status === 'in_progress' || td.status === 'pending') ? (
                <span
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-[10.5px] font-medium text-gray-600 ring-1 ring-gray-200"
                  title="Mission 已取消"
                >
                  已取消
                </span>
              ) : (
                <StatusPill status={sk} size="sm" />
              );
            },
          },
          {
            key: 'action',
            label: '操作',
            className: 'w-[18%] text-center',
            render: (td) => (
              <div className="inline-flex items-center justify-end gap-1.5">
                {canRerunTodo(td) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRerunTodo(td);
                    }}
                    disabled={rerunningId === td.id}
                    className="inline-flex items-center gap-0.5 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10.5px] font-medium text-violet-700 ring-1 ring-violet-200 transition-colors hover:bg-violet-100 disabled:cursor-wait disabled:opacity-60"
                    title="基于当前结果重新启动一次 mission，重点改进此任务"
                  >
                    <RefreshCw
                      className={cn(
                        'h-3 w-3',
                        rerunningId === td.id && 'animate-spin'
                      )}
                    />
                    重跑
                  </button>
                )}
                <span className="inline-flex items-center gap-0.5 text-[11px] text-violet-600 hover:text-violet-700">
                  详情 <ChevronRight className="h-3 w-3" />
                </span>
              </div>
            ),
          },
        ]}
      />

      {/* Assignee 点击 → Agent Inspector 弹窗 */}
      {inspectorTodo && (
        <AgentInspector
          open
          onClose={() => setInspectorTodo(null)}
          agent={buildAssigneeInspectorPayload(inspectorTodo, agents ?? [])}
          mode="modal"
        />
      )}
    </div>
  );
}
