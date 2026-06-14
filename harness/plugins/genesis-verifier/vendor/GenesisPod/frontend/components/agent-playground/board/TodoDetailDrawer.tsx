'use client';

/**
 * TodoDetailDrawer —— 单条 todo 的"完整故事"
 *
 * 信息架构（自上而下，遵循"采集 → 综合 → 评审"的真实流水线顺序）：
 *   Header        : origin badge + title + role
 *   Layer strip   : AI-APP → AI-HARNESS → AI-ENGINE → AI-INFRA（紧凑 chip）
 *   Stats         : 状态 / 耗时 / Tokens / 工具调用
 *   Reason        : 任务起因（reasonText）
 *   Failure       : 失败原因（仅 failed）
 *   关键发现       : findings 卡片（编号 + claim + evidence + source）  ← 采集结果摘要
 *   使用工具       : ToolBadge chips                                    ← 采集手段
 *   引用来源       : 去重 URL 列表                                       ← 采集材料
 *   完整时间线     : 默认折叠，narrative + thought + tool-call + tool-result 卡  ← 采集过程
 *   章节进度       : chapter pipeline 状态卡                             ← 综合（章节撰写）
 *   维度评分       : 5-axis grade                                        ← 评审（章节复审/维度打分）
 *   开发者诊断     : 默认折叠，原始 ReAct trace JSON
 *
 * 全程使用 playground-ui primitives + design tokens，禁止再写裸 Tailwind chip。
 */

import React, { useMemo, useState } from 'react';
import { ChevronRight, Lightbulb, RefreshCw } from 'lucide-react';
import { SideDrawer } from '@/components/common/drawers/SideDrawer';
import { localRerunTodo } from '@/services/agent-playground/api';
import { cn } from '@/lib/utils/common';
import { toast, confirm } from '@/stores';
import type {
  MissionTodo,
  MissionTodoNarrativeItem,
} from '@/lib/features/agent-playground/mission-todo.types';
import { deriveLayerBreadcrumb } from '@/lib/features/agent-playground/mission-todo.types';
import type {
  AgentLiveState,
  AgentTraceItem,
  DimensionPipelineState,
  StageProcessTrace,
} from '@/lib/features/agent-playground/mission-presentation.types';
import { deriveDrawerSections } from '@/lib/features/agent-playground/drawer-derive-shapes';
import { StageProcessPanel } from '@/components/agent-playground/panels/StageProcessPanel';
import { useStageProcessTrace } from '@/hooks/features/useStageProcessTrace';
import { FRONTEND_STAGE_TO_STEP_ID } from '@/lib/features/agent-playground/stage-id-mapping';
import {
  Card,
  Section,
  StatusPill,
  RoleChip,
  MetricStat,
  ToolBadge,
  ToneCard,
  SourceLink,
  ExpandableText,
  linkifyText,
} from '@/components/agent-playground/ui';
import {
  roleToken,
  toneToken,
  type ToneKey,
  type RoleKey,
} from '@/lib/design/tokens';
import { friendlyError } from '@/lib/features/agent-playground/friendly-error.util';
import {
  fmtTimestamp,
  fmtRelative,
  fmtDuration,
} from '@/lib/features/agent-playground/formatters';

interface Props {
  todo: MissionTodo | undefined;
  agents: AgentLiveState[];
  dimensionPipelines?: Map<string, DimensionPipelineState>;
  /** 全量 todos 列表 — 用于 dim 父级 drawer 展示「本维度被 Leader 要求修改了什么」 */
  allTodos?: MissionTodo[];
  /** T75: canonical view.stages[] —— system-stage drawer 直接读 processTrace 渲染 */
  stages?: ReadonlyArray<{ id: string; processTrace?: StageProcessTrace }>;
  /** T75 streaming: live event stream，叠加到 stage.processTrace 实时刷新 Drawer */
  events?: ReadonlyArray<{
    type: string;
    payload?: unknown;
    agentId?: string;
    timestamp: number;
  }>;
  onClose: () => void;
  /** 单 todo 重跑 —— 仅 mission 终态 + 非 abort/persist origin 时启用 */
  missionId?: string;
  missionTerminal?: boolean;
}

// ─── Origin label ────────────────────────────────────
const ORIGIN_LABEL: Record<
  MissionTodo['origin'],
  { label: string; cls: string }
> = {
  'leader-plan': {
    label: '维度规划',
    cls: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  'leader-assess-retry': {
    label: 'Leader 评审重派',
    cls: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  'leader-assess-replace': {
    label: 'Leader 换 spec',
    cls: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  'leader-assess-extend': {
    label: 'Leader 追加',
    cls: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  'leader-assess-abort': {
    label: 'Leader 放弃',
    cls: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  'leader-chat-create': {
    label: 'Leader Chat 追加',
    cls: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  'self-heal-retry': {
    label: '自愈重试',
    cls: 'bg-orange-50 text-orange-700 ring-orange-200',
  },
  'reviewer-revise': {
    label: 'Reviewer 重写',
    cls: 'bg-rose-50 text-rose-700 ring-rose-200',
  },
  'critic-blindspot': {
    label: 'Critic 警示',
    cls: 'bg-red-50 text-red-700 ring-red-200',
  },
  'reconciler-gap': {
    label: 'Reconciler 缺口',
    cls: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  'system-stage': {
    label: '系统阶段',
    cls: 'bg-gray-50 text-gray-700 ring-gray-200',
  },
  'chapter-pipeline': {
    label: '章节撰写',
    cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
};

/** 后端 stepId → 中文标签（cascade preview 显示）*/
const STEP_LABEL: Record<string, string> = {
  's1-budget': 'S1 预算闸',
  's2-leader-plan': 'S2 Leader 规划',
  's3-researcher-collect': 'S3 Researcher 采集',
  's4-leader-assess': 'S4 Leader 评审',
  's5-reconciler': 'S5 Reconciler 跨维核对',
  's6-analyst': 'S6 Analyst 综合',
  's7-writer-outline': 'S7 Writer 大纲',
  's8-writer': 'S8 Writer 起草',
  's8b-quality-enhancement': 'S8B 章节质量补救',
  's9-critic': 'S9 Critic L4',
  's9b-objective-eval': 'S9B 10 维客观评分',
  's10-leader-foreword-signoff': 'S10 Leader 前言+签字',
  's11-persist': 'S11 持久化',
};

/**
 * cascade chain — 镜像后端 PLAYGROUND_PIPELINE.steps[i].dag.successors
 * 显示给用户看"重跑此阶段会顺带跑哪些下游"。后端是单一信源，前端只用于 preview
 * 二次确认，实际 cascade 仍由后端按 dag 计算（防漂移）。
 */
const STEP_SUCCESSORS: Record<string, string[]> = {
  's1-budget': [],
  's2-leader-plan': [
    's3-researcher-collect',
    's4-leader-assess',
    's5-reconciler',
    's6-analyst',
    's7-writer-outline',
    's8-writer',
    's8b-quality-enhancement',
    's9-critic',
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  's3-researcher-collect': [
    's4-leader-assess',
    's5-reconciler',
    's6-analyst',
    's7-writer-outline',
    's8-writer',
    's8b-quality-enhancement',
    's9-critic',
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  's4-leader-assess': [
    's5-reconciler',
    's6-analyst',
    's7-writer-outline',
    's8-writer',
    's8b-quality-enhancement',
    's9-critic',
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  's5-reconciler': [
    's6-analyst',
    's7-writer-outline',
    's8-writer',
    's8b-quality-enhancement',
    's9-critic',
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  's6-analyst': [
    's7-writer-outline',
    's8-writer',
    's8b-quality-enhancement',
    's9-critic',
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  's7-writer-outline': [
    's8-writer',
    's8b-quality-enhancement',
    's9-critic',
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  's8-writer': [
    's8b-quality-enhancement',
    's9-critic',
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  's8b-quality-enhancement': [
    's9-critic',
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  's9-critic': [
    's9b-objective-eval',
    's10-leader-foreword-signoff',
    's11-persist',
  ],
  's9b-objective-eval': ['s10-leader-foreword-signoff', 's11-persist'],
  's10-leader-foreword-signoff': ['s11-persist'],
  's11-persist': [],
};

function cascadeChainFor(stepId: string): string[] {
  const successors = STEP_SUCCESSORS[stepId];
  if (!successors) return [stepId];
  return [stepId, ...successors];
}

// ─── System-stage → agent linking ─────────────────────
// 把 system-stage todo（无 agentRefId）映射到运行 agent，使 Drawer 能 surface
// 该 stage 的 ReAct trace + tool calls + tokens（与 dimension drawer 同等丰富）。
// 后端 single-shot agent 通过 AgentRunner emit `agent:thought/action/observation`
// 走标准 trace 管道，但 todo 自己不知道 agentId —— 由此 hint 表挂桥。
//
// 命名约定（与 backend `agentId: ...` literal 对齐）：
//   ids[]      字符串完全匹配
//   prefixes[] 前缀匹配（catches "writer#1" / "writer#2" / "analyst.retry"）
//
// 多 attempt 的 stage 取 trace 长度最大的 attempt（通常是最近一次）。
// s1-budget / s11-persist / s12-self-evolution 无 LLM 调用，不需要 agent 链接。
const SYSTEM_STAGE_AGENT_HINT: Record<
  string,
  { ids?: string[]; prefixes?: string[] }
> = {
  // s1-budget: 系统级 token 预算计算，无 LLM agent
  's2-leader-plan': { ids: ['leader'] },
  // s3-researchers: 维度并行 fanout，已通过 dimensionName 匹配覆盖
  's4-leader-assess': { ids: ['leader'] }, // Leader 评审决策；retry 路径由 researcher#N agent 完成（dim drawer 覆盖）
  's5-reconciler': { ids: ['reconciler'] },
  's6-analyst': { ids: ['analyst'], prefixes: ['analyst.'] }, // analyst + analyst.retry
  's7-writer-outline': { ids: ['outline-planner'] },
  's8-writer-draft': { prefixes: ['writer#', 'writer.'], ids: ['writer'] }, // writer#1/#2/#3
  's8b-quality-enhancement': { ids: ['writer'], prefixes: ['writer#'] }, // 章节质量自评，writer 复用
  's9-critic-l4': { ids: ['critic'], prefixes: ['critic.', 'mission-critic'] },
  's9b-objective-evaluation': {
    ids: ['critic', 'evaluator'],
    prefixes: ['critic.', 'evaluator.'],
  },
  's10-leader-signoff': { ids: ['leader'] },
  // s11-persist: DB 写操作，无 LLM
  // s12-self-evolution: postmortem 统计 + 向量索引，无 LLM
};

function findAgentForSystemStage(
  agents: AgentLiveState[],
  systemStageId: string
): AgentLiveState | undefined {
  const hint = SYSTEM_STAGE_AGENT_HINT[systemStageId];
  if (!hint) return undefined;
  const matches: AgentLiveState[] = [];
  for (const a of agents) {
    if (hint.ids?.includes(a.agentId)) {
      matches.push(a);
      continue;
    }
    if (hint.prefixes?.some((p) => a.agentId.startsWith(p))) {
      matches.push(a);
    }
  }
  if (matches.length === 0) return undefined;
  // 多个 attempt → 取 trace 长度最大的（最新一轮通常 trace 最丰富）
  matches.sort((a, b) => (b.trace?.length ?? 0) - (a.trace?.length ?? 0));
  return matches[0];
}

// ─── Dimension grade label ────────────────────────────
// 维度总评标签：优先反映 failed/skipped 状态，避免把"评分阶段失败后用章节均分兜底"
// 的分数误标成"不及格"。非失败时同时兼容词组(excellent/good/fair/poor)与字母(A-F)
// 等级——后端兜底路径发的是字母等级，正常路径发的是词组，前端两者都要认。
function dimGradeLabel(grade: {
  overall: number;
  grade: string;
  failed?: boolean;
  skipped?: boolean;
}): string {
  if (grade.skipped) return '评分未执行';
  if (grade.failed) return '评分未完成·章节均分兜底';
  const g = grade.grade;
  if (g === 'excellent' || g === 'A') return '优秀';
  if (g === 'good' || g === 'B') return '良好';
  if (g === 'fair' || g === 'C') return '一般';
  if (g === 'poor' || g === 'D' || g === 'F') return '不及格';
  // 未知等级 token → 按分数兜底，绝不默认"不及格"
  return grade.overall >= 80 ? '优秀' : grade.overall >= 60 ? '良好' : '不及格';
}

// ─── Status mapping ───────────────────────────────────
function todoStatusToToken(s: MissionTodo['status']) {
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

// ─── Timeline cards ──────────────────────────────────
type TimelineKind =
  | 'narrative'
  | 'thought'
  | 'tool-call'
  | 'parallel-tool-call'
  | 'tool-result'
  | 'reflection'
  | 'finalize';

interface ParallelSubCall {
  toolId: string;
  query?: string;
}

interface TimelineEntry {
  kind: TimelineKind;
  ts: number;
  narrative?: MissionTodoNarrativeItem;
  trace?: AgentTraceItem;
  query?: string;
  subCalls?: ParallelSubCall[];
  results?: { title?: string; url?: string; snippet?: string }[];
  resultToolId?: string;
  /** ★ P0-LIVE-UI-TOOL-ERR (2026-04-30): tool 失败时的明细原因 */
  toolError?: string;
  /** 失败的子调用列表（parallel_tool_call 中部分失败时） */
  toolErrors?: { toolId?: string; url?: string; error: string }[];
  /**
   * ★ P0-LIVE-UI-TOOL-EMPTY (2026-04-30): 当 collectResultsDeep 提取不到结构化
   * results 也无 error，但 output 里其实有 markdown/text 内容（比如 scrape tool
   * 返回 {markdown}）时，存这里做兜底"raw 内容预览"，让用户至少看到抓到了什么。
   */
  rawOutputPreview?: string;
  /** 调用时的 URL（从 trace.input.url 抽出），用于让 tool-call query 可点击 */
  callUrl?: string;
}

/**
 * 简单 URL 检测：以 http/https 开头 + 至少一个非空字符。
 */
function looksLikeUrl(s: string | undefined): boolean {
  return !!s && /^https?:\/\/\S+$/i.test(s.trim());
}

/**
 * 从 output 抽人类友好的"结论摘要"。
 *
 * 输出策略（按优先级）：
 *   1) outcome / conclusion / summary / answer / verdict 字段（工具自己给的结论）
 *   2) results[] 命中数 + 首条标题 + 来源域名 → "命中 N 条 · 首条：{title} ({domain}) / Matched N · top: ..."
 *   3) 大段文本字段 (markdown / content / text / body) 截前 500
 *   4) note / message / reason 字段 → 双语化（已知模式翻译）
 *   5) success/ok flag → "成功未匹配 · No matches" / "失败 · Failed"
 *   6) 兜底：undefined（不展示 raw JSON）
 *
 * 双语原则：英文工具消息保留原文 + 附中文翻译；中文 note 保留原文 + 附英文。
 */
function extractRawOutputPreview(output: unknown): string | undefined {
  if (!output) return undefined;
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed.slice(0, 500);
  }
  if (typeof output !== 'object') return undefined;
  const o = output as Record<string, unknown>;

  // ★ 0) 后端 truncatePayload 包装态 { _truncated, preview }：preview 是 JSON
  //    半截字符串。从中 regex 提取 results 数量 + 首条标题做双语摘要，
  //    避免裸 JSON 直接糊脸（之前直接 slice 500 字 raw 用户极差）。
  if (o._truncated === true && typeof o.preview === 'string') {
    const preview = o.preview;
    const titles = [...preview.matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => m[1])
      .filter((t) => t.length > 0);
    const urlCount = [...preview.matchAll(/"url"\s*:\s*"https?:\/\//g)].length;
    const hits = Math.max(titles.length, urlCount);
    if (hits > 0) {
      const firstTitle = titles[0]?.slice(0, 60);
      const zh = `命中 ${hits} 条结果${firstTitle ? ` · 首条：「${firstTitle}」` : ''}（结果较多已截断，详见运行日志）`;
      const en = `Matched ${hits} result${hits > 1 ? 's' : ''}${firstTitle ? ` · top: "${firstTitle}"` : ''} (truncated, see runtime log)`;
      return `${zh}\n${en}`;
    }
    // 没匹配到结构化命中 → fallback 给精简提示而非塞 raw
    return '工具返回内容较多已截断，详见运行日志\nTool output truncated, see runtime log';
  }

  // 1) 工具自报结论字段
  for (const key of ['outcome', 'conclusion', 'summary', 'answer', 'verdict']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.trim().slice(0, 500);
    }
  }

  // 2) results[] 结构化命中
  if (Array.isArray(o.results) && o.results.length > 0) {
    const total =
      typeof o.totalResults === 'number'
        ? o.totalResults
        : (o.results as unknown[]).length;
    const first = (o.results as unknown[])[0] as
      | Record<string, unknown>
      | undefined;
    const firstTitle =
      typeof first?.title === 'string' && first.title.trim()
        ? first.title.trim()
        : typeof first?.heading === 'string' && first.heading.trim()
          ? first.heading.trim()
          : undefined;
    const firstUrl = typeof first?.url === 'string' ? first.url : undefined;
    const domain = firstUrl ? safeDomain(firstUrl) : undefined;
    const zh = `命中 ${total} 条结果${
      firstTitle
        ? ` · 首条：「${firstTitle.slice(0, 60)}」${domain ? `（${domain}）` : ''}`
        : ''
    }`;
    const en = `Matched ${total} result${total > 1 ? 's' : ''}${
      firstTitle
        ? ` · top: "${firstTitle.slice(0, 60)}"${domain ? ` (${domain})` : ''}`
        : ''
    }`;
    return `${zh}\n${en}`;
  }

  // 3) 大段文本字段
  for (const key of ['markdown', 'content', 'text', 'body', 'html']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.trim().slice(0, 500);
    }
  }

  // 4) note / message / reason → 双语化
  for (const key of ['note', 'message', 'reason', 'description']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      return bilingualizeToolNote(v.trim());
    }
  }

  // 5) success/ok flag 兜底叙述
  if (typeof o.success === 'boolean' || typeof o.ok === 'boolean') {
    const ok = o.success === true || o.ok === true;
    const total =
      typeof o.totalResults === 'number'
        ? o.totalResults
        : Array.isArray(o.results)
          ? (o.results as unknown[]).length
          : undefined;
    if (ok && total === 0)
      return '调用成功但未匹配到结果\nSucceeded but matched 0 results';
    if (ok && typeof total === 'number')
      return `调用成功，命中 ${total} 条\nSucceeded · matched ${total} result${total > 1 ? 's' : ''}`;
    if (!ok) return '调用未成功\nCall did not succeed';
  }

  // 6) 兜底：不展示 raw JSON
  return undefined;
}

/** 提取 URL 域名，失败返回 undefined */
function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/**
 * 把工具 note 双语呈现：已知英文模式 → 中英对照；其它原文 + 一句标签。
 *   "no knowledgeBaseId provided -- caller should fall back to web-search"
 *     → "未指定知识库，已切换到网页搜索 / No KB specified, fell back to web search"
 */
function bilingualizeToolNote(note: string): string {
  const lower = note.toLowerCase();
  if (
    lower.includes('no knowledgebaseid') ||
    lower.includes('fall back to web-search') ||
    lower.includes('fall back to web search')
  ) {
    return '未指定知识库，已自动切换到网页搜索\nNo knowledge base specified, fell back to web search';
  }
  if (lower.includes('rate limit') || lower.includes('rate-limit')) {
    return '调用被限流，已稍后重试\nRate limited, retrying';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return '调用超时\nCall timed out';
  }
  if (lower.includes('not found') || lower.includes('404')) {
    return '未找到匹配的资源\nResource not found';
  }
  if (lower.includes('forbidden') || lower.includes('403')) {
    return '访问被拒绝（403）\nAccess forbidden (403)';
  }
  if (lower.includes('unauthor') || lower.includes('401')) {
    return '未授权（401）\nUnauthorized (401)';
  }
  if (lower.includes('quota') || lower.includes('insufficient')) {
    return '配额不足\nQuota exhausted';
  }
  // 未识别的 note 原文返回 + 限长（已是人话不强翻）
  return note.slice(0, 240);
}

/**
 * 同时收集 tool errors（success===false 或 error 字段非空时的 message）。
 * 让 UI 在 results 为空时仍能展示具体失败原因，而不是 generic"未返回任何内容"。
 */
function collectToolErrorsDeep(
  node: unknown
): { toolId?: string; url?: string; error: string }[] {
  const out: { toolId?: string; url?: string; error: string }[] = [];
  const visit = (n: unknown, ctxToolId?: string) => {
    if (!n) return;
    if (typeof n !== 'object') return;
    if (Array.isArray(n)) {
      n.forEach((x) => visit(x, ctxToolId));
      return;
    }
    const o = n as Record<string, unknown>;
    const tid =
      typeof o.toolId === 'string'
        ? o.toolId
        : typeof o.tool === 'string'
          ? o.tool
          : ctxToolId;
    const err = typeof o.error === 'string' ? o.error : undefined;
    const success = typeof o.success === 'boolean' ? o.success : undefined;
    const url = typeof o.url === 'string' ? o.url : undefined;
    if (err && (success === false || success === undefined)) {
      out.push({ toolId: tid, url, error: err });
    }
    for (const k of ['output', 'subResults', 'data']) {
      if (o[k] !== undefined) visit(o[k], tid);
    }
  };
  visit(node);
  return out;
}

function collectResultsDeep(
  node: unknown
): { title?: string; url?: string; snippet?: string }[] {
  const out: { title?: string; url?: string; snippet?: string }[] = [];
  const regexExtract = (s: string) => {
    const titleRe = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    const urlRe = /"url"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    const contentRe =
      /"(?:content|snippet|description)"\s*:\s*"((?:[^"\\]|\\.){0,400})"/g;
    const titles = [...s.matchAll(titleRe)].map((m) => m[1]);
    const urls = [...s.matchAll(urlRe)].map((m) => m[1]);
    const contents = [...s.matchAll(contentRe)].map((m) => m[1]);
    const n = Math.max(titles.length, urls.length);
    for (let i = 0; i < n; i++) {
      if (titles[i] || urls[i]) {
        out.push({ title: titles[i], url: urls[i], snippet: contents[i] });
      }
    }
  };
  const visit = (n: unknown) => {
    if (!n) return;
    if (typeof n === 'string') {
      const trimmed = n
        .trim()
        .replace(/…$/, '')
        .replace(/\.\.\.$/, '');
      if (
        (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
        (trimmed.endsWith('}') || trimmed.endsWith(']'))
      ) {
        try {
          visit(JSON.parse(trimmed));
        } catch {
          regexExtract(trimmed);
        }
      } else if (trimmed.includes('"title"') || trimmed.includes('"url"')) {
        regexExtract(trimmed);
      }
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    // ★ 2026-05-01: 后端 truncatePayload 包装态 {_truncated, preview} —— preview
    //   是 JSON 半截字符串，对它跑 regexExtract 让前端能渲染成 SourceLink 卡片
    //   而不是裸文本糊脸
    if (o._truncated === true && typeof o.preview === 'string') {
      regexExtract(o.preview);
      return;
    }
    // ★ 2026-04-30: 扩展识别 researcher findings 格式（{claim, evidence, source}）+
    //   通用 url 字段名（source / sourceUrl / link / href）+ title 字段名（claim / heading / name）
    const titleField =
      typeof o.title === 'string'
        ? o.title
        : typeof o.heading === 'string'
          ? o.heading
          : typeof o.claim === 'string'
            ? o.claim
            : typeof o.name === 'string'
              ? o.name
              : undefined;
    const urlField =
      typeof o.url === 'string'
        ? o.url
        : typeof o.sourceUrl === 'string'
          ? o.sourceUrl
          : typeof o.link === 'string'
            ? o.link
            : typeof o.href === 'string'
              ? o.href
              : typeof o.source === 'string' &&
                  /^https?:\/\//i.test(o.source.trim())
                ? o.source.trim()
                : undefined;
    const snippetField =
      typeof o.snippet === 'string'
        ? o.snippet
        : typeof o.description === 'string'
          ? o.description
          : typeof o.content === 'string'
            ? o.content
            : typeof o.evidence === 'string'
              ? o.evidence
              : typeof o.summary === 'string'
                ? o.summary
                : undefined;
    if (titleField || urlField) {
      out.push({
        title: titleField,
        url: urlField,
        snippet: snippetField,
      });
    }
    for (const k of [
      'results',
      'items',
      'hits',
      'output',
      'data',
      'preview',
      'subResults',
      // ★ researcher tool 输出
      'findings',
      'sources',
      // ★ rag-search 工具命中
      'matches',
      'documents',
    ]) {
      if (o[k] !== undefined) visit(o[k]);
    }
  };
  visit(node);
  return out;
}

function buildTimeline(
  narrativeLog: readonly MissionTodoNarrativeItem[],
  trace: readonly AgentTraceItem[]
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const n of narrativeLog) {
    out.push({ kind: 'narrative', ts: n.ts, narrative: n });
  }
  for (const t of trace) {
    if (t.kind === 'thought' && t.text && t.text.trim()) {
      out.push({ kind: 'thought', ts: t.ts, trace: t });
    } else if (t.kind === 'action' && !t.toolId && t.text && t.text.trim()) {
      // ★ Screenshot_62/63 (#105) 修复：单 LLM stage (outline-planner / critic 等)
      //   走 structured output 而非 tool_call → toolId 永远缺失。早先这里直接 skip
      //   导致"完整时间线"几乎全空（只剩 stage 启动/完成两条 narrative）。改为把无
      //   toolId 的 action 当成 thought 一样渲染（其 text 字段才是 LLM 推理过程）。
      out.push({ kind: 'thought', ts: t.ts, trace: t });
    } else if (t.kind === 'action' && t.toolId) {
      if (t.toolId === 'finalize') {
        // finalize 不另起卡（产出已在"关键发现"展示）—— 跳过
        continue;
      }
      if (t.toolId === 'parallel_tool_call' && Array.isArray(t.input)) {
        const subCalls: ParallelSubCall[] = [];
        for (const sub of t.input as unknown[]) {
          if (!sub || typeof sub !== 'object') continue;
          const o = sub as Record<string, unknown>;
          const subToolId =
            typeof o.toolId === 'string'
              ? o.toolId
              : typeof o.tool === 'string'
                ? o.tool
                : 'unknown';
          const inp = (o.input ?? {}) as Record<string, unknown>;
          const query =
            typeof inp.query === 'string'
              ? inp.query
              : typeof inp.url === 'string'
                ? inp.url
                : undefined;
          subCalls.push({ toolId: subToolId, query });
        }
        out.push({ kind: 'parallel-tool-call', ts: t.ts, trace: t, subCalls });
      } else {
        const inp = (t.input ?? {}) as Record<string, unknown>;
        const query =
          typeof inp.query === 'string'
            ? inp.query
            : typeof inp.url === 'string'
              ? inp.url
              : undefined;
        const callUrl =
          typeof inp.url === 'string' && looksLikeUrl(inp.url)
            ? inp.url
            : looksLikeUrl(query)
              ? query
              : undefined;
        out.push({ kind: 'tool-call', ts: t.ts, trace: t, query, callUrl });
      }
    } else if (t.kind === 'observation') {
      // 跳过 finalize 的 observation（产出在 findings）
      if (t.toolId === 'finalize') continue;
      // ★ P0-LIVE-UI-TOOL-ERR (2026-04-30): observation 自带 error 时之前直接
      //   skip 了整个 entry，UI 看不到任何信息。改为照常 push tool-result，
      //   把 error 透传到 toolError 字段；同时从 output 里递归提取 success:false
      //   子调用错误（parallel_tool_call 部分失败的情形）。
      const results = collectResultsDeep(t.output);
      const subErrors = collectToolErrorsDeep(t.output);
      const topError = t.error
        ? typeof t.error === 'string'
          ? t.error
          : ((t.error as { message?: string }).message ?? undefined)
        : undefined;
      const rawOutputPreview =
        results.length === 0 && !topError && subErrors.length === 0
          ? extractRawOutputPreview(t.output)
          : undefined;
      out.push({
        kind: 'tool-result',
        ts: t.ts,
        trace: t,
        results,
        resultToolId: t.toolId,
        toolError: topError,
        toolErrors: subErrors.length > 0 ? subErrors : undefined,
        rawOutputPreview,
      });
    } else if (t.kind === 'reflection' && t.text) {
      out.push({ kind: 'reflection', ts: t.ts, trace: t });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

const KIND_TONE: Record<TimelineKind, ToneKey> = {
  narrative: 'info',
  thought: 'info',
  'tool-call': 'info',
  'parallel-tool-call': 'info',
  'tool-result': 'neutral',
  reflection: 'warn',
  finalize: 'success',
};

const KIND_LABEL: Record<TimelineKind, string> = {
  narrative: '进展',
  thought: '思考',
  'tool-call': '调用工具',
  'parallel-tool-call': '并发调用',
  'tool-result': '工具结果',
  reflection: '反思',
  finalize: '产出',
};

// ─── Main component ───────────────────────────────────
export function TodoDetailDrawer({
  todo,
  agents,
  dimensionPipelines,
  allTodos,
  stages,
  events,
  onClose,
  missionId,
  missionTerminal,
}: Props) {
  const [showTimeline, setShowTimeline] = useState(true);
  const [showDiag, setShowDiag] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  // ★ T75 streaming: 从 canonical view 取 stage 静态 processTrace，再用 live events
  //   叠加本地实时 reactTrace（在 backend view refetch 250ms+ 窗口内也能看到新事件）。
  const targetStageId =
    todo && todo.scope === 'system' ? todo.systemStageId : undefined;
  const canonicalProcessTrace = useMemo(() => {
    if (!targetStageId || !stages) return undefined;
    return stages.find((s) => s.id === targetStageId)?.processTrace;
  }, [targetStageId, stages]);
  const liveProcessTrace = useStageProcessTrace(
    targetStageId,
    events ?? [],
    canonicalProcessTrace
  );

  if (!todo) return null;

  // ★ 2026-05-07 (PR-R7): 局部重跑扩展 — 用 stepId 走 cascade 路径
  //   - 老路径：scope=system + s9b → 走老 dispatch（保留兼容）
  //   - 新路径：todo 有 systemStageId（且非 s1-budget）→ 经 FRONTEND_STAGE_TO_STEP_ID
  //     映射成后端 stepId，调 localRerunTodo({stepId}) 走 cascade
  //   - 后端按 dag.successors 自动展开链：reset 整链 + 顺序执行 + best-effort partial
  //   - reopen 自动：cascade 终点是 s11-persist 且 status=failed → markReopened
  const stepId = todo.systemStageId
    ? FRONTEND_STAGE_TO_STEP_ID[todo.systemStageId]
    : // ★ 2026-05-29 单维度局部重跑：维度 todo 映射到 s3 研究段 + dimensionRef，
      //   后端只重跑该维度（不重建整 mission）。
      todo.scope === 'dimension' && todo.dimensionRef
      ? 's3-researcher-collect'
      : undefined;
  const supportsLocalRerun =
    // 老路径：v1 已支持的 s9b
    (todo.scope === 'system' && todo.id.endsWith('s9b-objective-evaluation')) ||
    // 新路径：有可映射的 stepId 且不在黑名单
    (!!stepId && stepId !== 's1-budget');

  // ★ 收尾评审 P0-T1 (2026-05-07): s11-persist 重跑是 c195035f 主用例，不能硬排除。
  //   后端 isLocallyRerunable 会按 dag.rerunable 判断（s11 dag.rerunable=true）。
  //   仅 s1-budget 在前端硬排除（语义上预算闸不应重跑，后端也是黑名单）。
  const canRerun =
    !!(missionId && missionTerminal) &&
    todo.systemStageId !== 's1-budget' &&
    todo.origin !== 'leader-assess-abort' &&
    supportsLocalRerun &&
    (todo.status === 'done' ||
      todo.status === 'failed' ||
      todo.status === 'cancelled');

  // PR-R7: cascade preview — 仅 stepId 路径展示
  const cascadeChain = stepId ? cascadeChainFor(stepId) : undefined;

  const handleRerun = async () => {
    if (!missionId || rerunning || !supportsLocalRerun) return;
    // PR-R7: cascade preview 二次确认（只在 stepId 路径显示，老路径直接走）
    if (cascadeChain && cascadeChain.length > 1) {
      const ok = await confirm({
        title: `局部重跑将顺序执行 ${cascadeChain.length} 个阶段`,
        description:
          `${cascadeChain.map((s, i) => `${i + 1}. ${STEP_LABEL[s] ?? s}`).join('，')}。` +
          `产物会 patch 回原 mission（不创建新 mission）；若当前 failed 会自动 reopen。是否继续？`,
        type: 'warning',
      });
      if (!ok) return;
    }
    setRerunning(true);
    try {
      // 局部重跑：不跳转，保留在原 mission detail 页（mission:rerun-completed
      // 事件会触发 page.tsx re-fetch persisted）
      await localRerunTodo(missionId, todo.id, {
        origin: todo.origin,
        scope: todo.scope,
        dimensionRef: todo.dimensionRef,
        todoTitle: todo.title,
        reasonText: todo.reasonText,
        stepId, // PR-R7: undefined 时后端走老路径
      });
      setRerunning(false);
    } catch (e) {
      toast.error('重跑失败', e instanceof Error ? e.message : String(e));
      setRerunning(false);
    }
  };

  const origin = ORIGIN_LABEL[todo.origin];
  const layers = deriveLayerBreadcrumb(todo);
  const statusKey = todoStatusToToken(todo.status);

  // Linked agent
  // 1. agentRefId 显式指定 → 直接找
  // 2. dimension todo → 按 researcher.dimension 找
  // 3. system-stage todo（无 agentRefId）→ 用 systemStageId 反查执行该 stage 的
  //    agent（Reconciler / Analyst / Writer-Outline / Writer-Draft 等 single-shot
  //    agent 通过 AgentRunner emit ReAct trace，但 todo 不知道 agentId）
  const linkedAgent = todo.agentRefId
    ? agents.find(
        (a) =>
          a.agentId === todo.agentRefId ||
          a.agentId.startsWith(`${todo.agentRefId}.`)
      )
    : todo.assignee.dimensionName
      ? agents.find(
          (a) =>
            a.role === 'researcher' &&
            a.dimension === todo.assignee.dimensionName
        )
      : todo.systemStageId
        ? findAgentForSystemStage(agents, todo.systemStageId)
        : undefined;

  const sections = deriveDrawerSections(linkedAgent);
  const timeline = buildTimeline(todo.narrativeLog, linkedAgent?.trace ?? []);
  const anchor = todo.startedAt ?? todo.createdAt;

  // 计数
  const totalToolCalls = sections.toolUsage.reduce(
    (s, t) => s + t.callCount,
    0
  );

  return (
    <SideDrawer open onClose={onClose} widthPx={672}>
      {/* ─── Custom Header ─── */}
      <div className="flex items-start justify-between border-b border-gray-200 bg-white px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1',
                origin.cls
              )}
            >
              {origin.label}
            </span>
            <RoleChip
              role={todo.assignee.role}
              agentId={todo.assignee.agentId}
              size="xs"
            />
          </div>
          <h2 className="mt-1 truncate text-base font-semibold text-gray-900">
            {todo.title}
          </h2>
        </div>
        {canRerun && (
          <div className="ml-3 flex items-center">
            <button
              type="button"
              onClick={() => void handleRerun()}
              disabled={rerunning}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
              title="局部重跑：在当前 mission 内重跑此任务，产物 patch 回原报告（不创建新 mission）"
            >
              <RefreshCw
                className={cn('h-3 w-3', rerunning && 'animate-spin')}
              />
              局部重跑
            </button>
          </div>
        )}
      </div>

      {/* ─── Body ─── */}
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {/* 4 层架构 strip — 2×2 grid，避免横向滚动 */}
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-violet-100 bg-violet-50/40 p-2">
          {layers.map((l) => (
            <div
              key={l.id}
              className="min-w-0 rounded-md bg-white/70 px-2 py-1.5 ring-1 ring-violet-100"
            >
              <p className="font-mono text-[10px] font-semibold leading-tight text-violet-700">
                {l.label}
              </p>
              <p className="mt-0.5 break-words text-[10.5px] leading-snug text-gray-600">
                {l.detail}
              </p>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          <MetricStat
            label="状态"
            value={<StatusPill status={statusKey} size="sm" />}
          />
          <MetricStat
            label="耗时"
            value={fmtDuration(todo.startedAt, todo.endedAt)}
          />
          <MetricStat
            label="Tokens"
            value={
              sections.totalTokens > 0
                ? sections.totalTokens >= 1000
                  ? `${(sections.totalTokens / 1000).toFixed(1)}k`
                  : sections.totalTokens
                : null
            }
          />
          <MetricStat
            label="工具调用"
            value={totalToolCalls > 0 ? totalToolCalls : null}
          />
        </div>

        {/* Reason — 重派/重写类任务用更醒目的 Tone callout 展示「具体要求修改什么」 */}
        {todo.reasonText &&
          (todo.origin === 'leader-assess-retry' ||
          todo.origin === 'leader-assess-replace' ||
          todo.origin === 'leader-assess-extend' ||
          todo.origin === 'reviewer-revise' ||
          todo.origin === 'critic-blindspot' ||
          todo.origin === 'self-heal-retry' ? (
            <ToneCard
              tone={
                todo.origin === 'critic-blindspot'
                  ? 'error'
                  : todo.origin === 'self-heal-retry'
                    ? 'warn'
                    : 'warn'
              }
              label={
                todo.origin === 'leader-assess-retry'
                  ? 'Leader 要求修改（patch 内容）'
                  : todo.origin === 'leader-assess-replace'
                    ? 'Leader 要求换签 spec'
                    : todo.origin === 'leader-assess-extend'
                      ? 'Leader 追加维度的理由'
                      : todo.origin === 'reviewer-revise'
                        ? 'Reviewer 要求重写的 critique'
                        : todo.origin === 'critic-blindspot'
                          ? 'L4 Critic 警示'
                          : '自愈触发理由'
              }
            >
              <ExpandableText
                text={
                  todo.origin === 'self-heal-retry'
                    ? friendlyError(todo.reasonText)
                    : todo.reasonText
                }
                maxChars={800}
                className="text-[13px] leading-relaxed text-amber-900"
              />
            </ToneCard>
          ) : (
            <Card className="px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                任务起因
              </p>
              <ExpandableText
                text={todo.reasonText}
                maxChars={300}
                className="mt-1 text-[13px] leading-relaxed text-gray-800"
              />
            </Card>
          ))}

        {/* dim 父级 drawer：展示「本维度被 Leader / Reviewer 要求修改了什么」一览 */}
        {todo.scope === 'dimension' &&
          !todo.parentId &&
          allTodos &&
          (() => {
            const childPatches = allTodos.filter(
              (x) =>
                x.parentId === todo.id &&
                (x.origin === 'leader-assess-retry' ||
                  x.origin === 'leader-assess-replace' ||
                  x.origin === 'leader-assess-extend' ||
                  x.origin === 'reviewer-revise' ||
                  x.origin === 'critic-blindspot')
            );
            if (childPatches.length === 0) return null;
            return (
              <Section
                title="Leader / Reviewer 要求的修改"
                count={`${childPatches.length} 项`}
              >
                <ul className="space-y-2 p-3">
                  {childPatches.map((c) => {
                    const ORIGIN_LABEL_MAP: Record<string, string> = {
                      'leader-assess-retry': 'Leader 重派',
                      'leader-assess-replace': 'Leader 换签',
                      'leader-assess-extend': 'Leader 追加',
                      'reviewer-revise': 'Reviewer 重写',
                      'critic-blindspot': 'Critic 警示',
                    };
                    const live =
                      c.status === 'in_progress' || c.status === 'pending';
                    return (
                      <li
                        key={c.id}
                        className={cn(
                          'rounded-md border px-3 py-2',
                          live
                            ? 'border-orange-200 bg-orange-50/40'
                            : c.status === 'done'
                              ? 'border-emerald-200 bg-emerald-50/40'
                              : 'border-gray-200 bg-gray-50/40'
                        )}
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <span className="font-mono text-[10px] font-semibold text-orange-700">
                            {ORIGIN_LABEL_MAP[c.origin] ?? c.origin}
                          </span>
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1',
                              live
                                ? 'bg-orange-100 text-orange-700 ring-orange-200'
                                : c.status === 'done'
                                  ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                                  : 'bg-gray-100 text-gray-600 ring-gray-200'
                            )}
                          >
                            {live
                              ? '进行中'
                              : c.status === 'done'
                                ? '已完成'
                                : c.status === 'failed'
                                  ? '失败'
                                  : c.status === 'cancelled'
                                    ? '已放弃'
                                    : '待启动'}
                          </span>
                        </div>
                        <ExpandableText
                          text={c.reasonText}
                          maxChars={500}
                          className="text-[12px] leading-relaxed text-gray-700"
                        />
                      </li>
                    );
                  })}
                </ul>
              </Section>
            );
          })()}

        {/* Failure callout */}
        {todo.status === 'failed' && linkedAgent?.failureMessage && (
          <ToneCard tone="error" label="失败原因">
            <ExpandableText
              text={friendlyError(linkedAgent.failureMessage)}
              maxChars={400}
              className="text-[13px] leading-relaxed text-red-800"
            />
          </ToneCard>
        )}

        {/* T75 streaming: system-stage Drawer 渲染 liveProcessTrace —— canonical
            view.stages[X].processTrace + 本地 live events 累积合并（reactTrace
            实时刷新，不需等 view refetch 250ms+ 窗口）。 */}
        {todo.scope === 'system' && todo.systemStageId && liveProcessTrace
          ? (() => {
              return (
                <StageProcessPanel
                  processTrace={liveProcessTrace}
                  stageLabel={todo.title}
                />
              );
            })()
          : null}

        {/* BUG #101: s1-budget has no LLM — show notice + artifacts + timing */}
        {todo.scope === 'system' &&
          todo.systemStageId === 's1-budget' &&
          !liveProcessTrace && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  阶段过程 · stage process
                </h4>
                <span className="text-[11px] text-gray-400">{todo.title}</span>
              </div>
              <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] text-blue-700">
                本阶段无 LLM 调用，仅做预算分配（deterministic token budget
                allocation）
              </p>
              {todo.artifacts.length > 0 && (
                <div className="space-y-1.5">
                  <h5 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    预算分配结果
                  </h5>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                    {todo.artifacts.map((a, i) => (
                      <React.Fragment key={i}>
                        <dt className="truncate text-gray-500">{a.label}</dt>
                        <dd className="font-mono truncate text-right text-gray-800">
                          {a.value != null ? String(a.value) : '—'}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </div>
              )}
              {(todo.startedAt != null || todo.endedAt != null) && (
                <div className="space-y-1.5">
                  <h5 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    阶段时序
                  </h5>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                    {todo.startedAt != null && (
                      <React.Fragment>
                        <dt className="text-gray-500">开始</dt>
                        <dd className="font-mono text-right text-gray-800">
                          {fmtTimestamp(todo.startedAt)}
                        </dd>
                      </React.Fragment>
                    )}
                    {todo.endedAt != null && (
                      <React.Fragment>
                        <dt className="text-gray-500">完成</dt>
                        <dd className="font-mono text-right text-gray-800">
                          {fmtTimestamp(todo.endedAt)}
                        </dd>
                      </React.Fragment>
                    )}
                    {todo.startedAt != null && todo.endedAt != null && (
                      <React.Fragment>
                        <dt className="text-gray-500">耗时</dt>
                        <dd className="font-mono text-right text-gray-800">
                          {fmtDuration(todo.startedAt, todo.endedAt)}
                        </dd>
                      </React.Fragment>
                    )}
                  </dl>
                </div>
              )}
            </div>
          )}

        {/* BUG #100: dimension todo — render researcher agent ReAct process panel */}
        {todo.scope === 'dimension' &&
          linkedAgent &&
          linkedAgent.trace.length > 0 &&
          (() => {
            const dimTrace: import('@/lib/features/agent-playground/mission-presentation.types').StageProcessTrace =
              {
                reactTrace: linkedAgent.trace.map((t) => ({
                  kind: t.kind,
                  ts: t.ts,
                  text: t.text,
                  toolId: t.toolId,
                  output:
                    t.output != null
                      ? typeof t.output === 'string'
                        ? t.output
                        : JSON.stringify(t.output).slice(0, 500)
                      : undefined,
                  latencyMs: t.latencyMs,
                  tokensUsed: t.tokensUsed,
                  error: t.error,
                })),
                stepCount: linkedAgent.trace.length,
                totalTokens: linkedAgent.trace.reduce(
                  (s, t) => s + (t.tokensUsed ?? 0),
                  0
                ),
                totalDurationMs: linkedAgent.wallTimeMs,
              };
            return (
              <StageProcessPanel
                processTrace={dimTrace}
                stageLabel={`Researcher · ${todo.assignee.dimensionName ?? todo.assignee.agentId ?? ''}`}
              />
            );
          })()}

        {/* 关键发现 */}
        {sections.findings.length > 0 && (
          <Section title="关键发现" count={sections.findings.length}>
            <ol className="space-y-2 p-3">
              {sections.findings.map((f, i) => (
                <li
                  key={i}
                  className="rounded-md border border-gray-200 bg-white px-3 py-2"
                >
                  <div className="flex items-start gap-2">
                    <span className="font-mono mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <ExpandableText
                        text={f.claim}
                        maxChars={200}
                        className="text-[13px] font-medium leading-relaxed text-gray-900"
                      />
                      {f.evidence && (
                        <div className="mt-1.5">
                          <ExpandableText
                            text={f.evidence}
                            maxChars={260}
                            className="text-[11.5px] leading-relaxed text-gray-600"
                          />
                        </div>
                      )}
                      {f.source && (
                        <a
                          href={/^https?:\/\//i.test(f.source) ? f.source : '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono mt-1.5 inline-block break-all text-[10px] text-violet-700 hover:underline"
                        >
                          {(() => {
                            try {
                              return new URL(f.source).hostname.replace(
                                /^www\./,
                                ''
                              );
                            } catch {
                              return f.source;
                            }
                          })()}
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* 使用工具 */}
        {sections.toolUsage.filter((t) => t.toolId !== 'finalize').length >
          0 && (
          <Section
            title="使用工具"
            count={
              sections.toolUsage.filter((t) => t.toolId !== 'finalize').length
            }
          >
            <div className="flex flex-wrap gap-1.5 p-3">
              {sections.toolUsage
                .filter((t) => t.toolId !== 'finalize')
                .map((tu) => (
                  <ToolBadge
                    key={tu.toolId}
                    toolId={tu.toolId}
                    count={tu.callCount}
                  />
                ))}
            </div>
          </Section>
        )}

        {/* 引用来源 */}
        {sections.sources.length > 0 && (
          <Section title="引用来源" count={`${sections.sources.length} 个`}>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto p-3">
              {sections.sources.map((s, i) => (
                <li key={`${s.url}-${i}`}>
                  <SourceLink title={s.title} url={s.url} hits={s.hits} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 完整时间线 */}
        {timeline.length > 0 && (
          <Section
            title="完整时间线"
            count={`${timeline.length} 个事件`}
            collapsible
            defaultOpen={showTimeline}
          >
            <ol className="relative space-y-0 p-3 pl-9">
              <span
                className="absolute bottom-3 left-[20px] top-3 w-0.5 bg-gradient-to-b from-violet-200 via-blue-200 to-emerald-100"
                aria-hidden="true"
              />
              {timeline.map((c, i) => (
                <TimelineEntryView
                  key={`${c.ts}-${i}`}
                  entry={c}
                  anchor={anchor}
                />
              ))}
            </ol>
          </Section>
        )}

        {/* 章节进度 + 维度评分 (仅 dim todos with chapter pipeline)
              ★ 2026-04-30 REDESIGN (task #61)：retry 双路径 — pipeline 按 todo.pipelineKey 取
              - leader-plan / reuse-recompute: pipelineKey === dim name（grade 就地更新）
              - leader-assess-retry (fresh-collect): pipelineKey === `${dim}:${retryLabel}` 独立索引 */}
        {todo.scope === 'dimension' &&
          todo.dimensionRef &&
          (() => {
            const pipelineKey = todo.pipelineKey ?? todo.dimensionRef;
            // ★ 2026-05-02 修 Screenshot 53 章节进度 0/0 假统计：retry todo 用
            //   独立 pipelineKey，但其 pipeline 可能为空（chapter pipeline 还没跑）
            //   → fallback 到 dimensionRef 原 pipeline 拿章节数据，避免显示
            //   误导的 "0/0 通过 4978 字"。
            let pipeline = dimensionPipelines?.get(pipelineKey);
            if (!pipeline || pipeline.chapters.length === 0) {
              if (pipelineKey !== todo.dimensionRef) {
                pipeline = dimensionPipelines?.get(todo.dimensionRef);
              }
            }
            if (!pipeline || pipeline.chapters.length === 0) return null;
            return (
              <>
                <Section
                  title="章节进度"
                  count={`${pipeline.chapters.filter((c) => c.status === 'passed' || c.status === 'done').length} / ${pipeline.chapters.length} 通过${pipeline.totalWordCount ? ' · ' + pipeline.totalWordCount + ' 字' : ''}`}
                >
                  <ul className="space-y-1.5 p-3">
                    {pipeline.chapters.map((c) => {
                      // ★ 2026-05-01 (Screenshot 45 + 用户实证：评审通过后跳到"待启动")：
                      //   补齐 'done' / 'failed-finalized' 两种终态映射 —— 之前 fallthrough
                      //   到 '待启动'，章节实际已落地却显示等待状态。
                      const cls =
                        c.status === 'passed' || c.status === 'done'
                          ? 'bg-emerald-50 ring-emerald-200 text-emerald-700'
                          : c.status === 'writing'
                            ? 'bg-blue-50 ring-blue-200 text-blue-700'
                            : c.status === 'reviewing'
                              ? 'bg-amber-50 ring-amber-200 text-amber-700'
                              : c.status === 'revising'
                                ? 'bg-orange-50 ring-orange-200 text-orange-700'
                                : c.status === 'failed'
                                  ? 'bg-red-50 ring-red-200 text-red-700'
                                  : c.status === 'failed-finalized'
                                    ? 'bg-orange-50 ring-orange-200 text-orange-700'
                                    : 'bg-gray-50 ring-gray-200 text-gray-600';
                      const statusLabel =
                        c.status === 'passed' || c.status === 'done'
                          ? '已完成'
                          : c.status === 'writing'
                            ? '撰写中'
                            : c.status === 'reviewing'
                              ? '评审中'
                              : c.status === 'revising'
                                ? `重写第 ${c.attempts} 轮`
                                : c.status === 'failed'
                                  ? '失败'
                                  : c.status === 'failed-finalized'
                                    ? '兜底落地'
                                    : '待启动';
                      return (
                        <li
                          key={c.index}
                          className="rounded-md border border-gray-200 bg-white px-3 py-2"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-[10px] font-bold text-gray-500">
                              #{c.index}
                            </span>
                            <span className="flex-1 text-[12.5px] font-medium text-gray-900">
                              {c.heading}
                            </span>
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                                cls
                              )}
                            >
                              {statusLabel}
                            </span>
                          </div>
                          {c.thesis && (
                            <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                              {c.thesis}
                            </p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
                            {c.wordCount != null && c.wordCount > 0 && (
                              <span>{c.wordCount} 字</span>
                            )}
                            {c.score != null && (
                              <span className="font-mono text-gray-400">
                                复审 {c.score}/100
                              </span>
                            )}
                            {c.attempts > 1 && (
                              <span className="text-orange-600">
                                已重写 {c.attempts - 1} 次
                              </span>
                            )}
                          </div>
                          {c.critique && (
                            <div className="mt-1.5 rounded-md bg-amber-50/50 px-2 py-1.5 ring-1 ring-amber-100">
                              <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                                Reviewer 反馈
                              </p>
                              <ExpandableText
                                text={c.critique}
                                maxChars={180}
                                className="text-[11px] leading-relaxed text-gray-700"
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Section>

                {pipeline.grade && (
                  <Section
                    title="维度总评（5 轴综合）"
                    count={`${pipeline.grade.overall}/100 · ${dimGradeLabel(
                      pipeline.grade
                    )}`}
                  >
                    <div className="p-3">
                      <p className="mb-2 text-xs text-gray-400">
                        评估维度整体质量（广度 / 深度 / 证据 / 连贯性 /
                        时效性），独立于各章节复审分。
                      </p>
                      <ul className="space-y-1.5">
                        {(
                          [
                            ['breadth', '广度'],
                            ['depth', '深度'],
                            ['evidence', '证据'],
                            ['coherence', '连贯性'],
                            ['freshness', '时效性'],
                          ] as const
                        ).map(([k, label]) => {
                          // canonical view DimensionPipelineView.grade 当前未暴露
                          // axes 5-axis breakdown（grade 字段是简化形）。defensive
                          // chain：axes 缺失时整 axis 区段不渲染。Follow-up：
                          // backend projector 加 extractDimensionGradeAxes。
                          const axes = pipeline.grade?.axes;
                          const a = axes?.[k];
                          if (!a) return null;
                          return (
                            <li key={k}>
                              <div className="flex items-baseline justify-between text-[11px]">
                                <span className="text-gray-700">{label}</span>
                                <span
                                  className={cn(
                                    'font-mono font-semibold',
                                    a.score >= 80
                                      ? 'text-emerald-600'
                                      : a.score >= 60
                                        ? 'text-amber-600'
                                        : 'text-red-600'
                                  )}
                                >
                                  {a.score}
                                </span>
                              </div>
                              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-gray-100">
                                <div
                                  className={cn(
                                    'h-full rounded-full',
                                    a.score >= 80
                                      ? 'bg-emerald-400'
                                      : a.score >= 60
                                        ? 'bg-amber-400'
                                        : 'bg-red-400'
                                  )}
                                  style={{ width: `${a.score}%` }}
                                />
                              </div>
                              {a.comment && (
                                <p className="mt-0.5 text-[10px] text-gray-500">
                                  {a.comment}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {pipeline.grade.summary && (
                        <p className="mt-3 rounded bg-gray-50 px-2 py-1.5 text-[11px] leading-relaxed text-gray-700 ring-1 ring-gray-200">
                          {pipeline.grade.summary}
                        </p>
                      )}
                    </div>
                  </Section>
                )}
              </>
            );
          })()}

        {/* 开发者诊断 */}
        {linkedAgent && linkedAgent.trace.length > 0 && (
          <Section
            title="开发者诊断视图"
            count={`${linkedAgent.trace.length} 条原始 trace`}
            collapsible
            defaultOpen={false}
          >
            <ul className="space-y-1.5 p-3">
              {linkedAgent.trace.map((t, i) => (
                <RawTraceRow key={`${t.ts}-${i}`} trace={t} />
              ))}
            </ul>
          </Section>
        )}
      </div>
    </SideDrawer>
  );
}

// ─── Timeline entry view ─────────────────────────────
function TimelineEntryView({
  entry,
  anchor,
}: {
  entry: TimelineEntry;
  anchor: number;
}) {
  const tone = KIND_TONE[entry.kind];
  const label = KIND_LABEL[entry.kind];
  const tk = toneToken[tone];
  return (
    <li className="relative pb-3 last:pb-0">
      <span
        className={cn(
          // 2026-05-13: -left-[25px] 让 dot 中心与 line 中心对齐：
          //   ol pl-9 (36px) → li 左缘 = 36；line 中心 = 20 + 1 = 21px；
          //   dot w-5 (20px)，-left-[25px] 让 dot 左缘 = 36-25 = 11px，中心 = 11+10 = 21px ✓
          'absolute -left-[25px] top-1 inline-flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-white',
          tk.bg
        )}
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            tk.text.replace('text-', 'bg-')
          )}
        />
      </span>
      <ToneCard
        tone={tone}
        label={label}
        meta={
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] font-semibold text-gray-600">
              {fmtRelative(entry.ts, anchor)}
            </span>
            <span className="font-mono text-[9px] text-gray-400">
              {fmtTimestamp(entry.ts)}
            </span>
          </span>
        }
      >
        <TimelineEntryBody entry={entry} />
      </ToneCard>
    </li>
  );
}

function TimelineEntryBody({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === 'narrative' && entry.narrative) {
    return (
      <ExpandableText
        text={entry.narrative.text}
        maxChars={300}
        className="block whitespace-pre-wrap text-[13px] leading-relaxed text-gray-800"
      />
    );
  }
  if (entry.kind === 'thought' && entry.trace?.text) {
    return (
      <ExpandableText
        text={entry.trace.text}
        maxChars={300}
        className="block whitespace-pre-wrap text-[12.5px] italic leading-relaxed text-violet-900"
      />
    );
  }
  if (entry.kind === 'tool-call') {
    return (
      <div className="space-y-1">
        {entry.trace?.toolId && (
          <ToolBadge toolId={entry.trace.toolId} size="xs" />
        )}
        {entry.query && (
          <p className="font-mono break-words text-[12px] leading-relaxed text-blue-900">
            <span className="text-blue-500">▸</span>{' '}
            {/* ★ P0-LIVE-UI-TOOL-LINK (2026-04-30): query 是 URL 时渲染可点击链接，
                之前用户看到 https://... 全是纯文本，没法直接点开溯源 */}
            {entry.callUrl ? (
              <a
                href={entry.callUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-800 hover:decoration-blue-500"
              >
                {entry.query}
              </a>
            ) : (
              entry.query
            )}
          </p>
        )}
      </div>
    );
  }
  if (entry.kind === 'parallel-tool-call' && entry.subCalls) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-gray-600">
          并发执行 {entry.subCalls.length} 个工具调用
        </p>
        <ul className="space-y-1">
          {entry.subCalls.map((sub, i) => (
            <li
              key={i}
              className="rounded-md bg-white px-2 py-1.5 ring-1 ring-blue-100"
            >
              <ToolBadge toolId={sub.toolId} size="xs" />
              {sub.query && (
                <p className="font-mono mt-1 break-words text-[12px] leading-relaxed text-blue-900">
                  <span className="text-blue-500">▸</span> {sub.query}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (entry.kind === 'tool-result') {
    const hasResults = entry.results && entry.results.length > 0;
    const hasErrors =
      !!entry.toolError || (entry.toolErrors && entry.toolErrors.length > 0);
    const hasRawPreview = !!entry.rawOutputPreview;
    // ★ P0-LIVE-UI-TOOL-ERR-PARTIAL (2026-04-30): parallel_tool_call 同时含
    //   成功 + 失败时（如 5 个抓 URL 中 1 个 HTTP 403, 4 个成功），之前只看
    //   results.length > 0 就走 ToolResultList 完全跳过 errors 显示，用户看
    //   不到失败子调用的原因。改为 results 和 errors 同时渲染（先列错误警示
    //   卡，再列成功结果）。
    if (!hasResults && !hasErrors && !hasRawPreview) {
      return (
        <p className="text-[11px] italic text-gray-500">
          （工具未返回可解析的结构化结果）
        </p>
      );
    }
    return (
      <div className="space-y-2">
        {entry.toolError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5">
            <p className="font-mono text-[11px] leading-relaxed text-red-700">
              {entry.toolError}
            </p>
          </div>
        )}
        {entry.toolErrors && entry.toolErrors.length > 0 && (
          <div className="space-y-1.5">
            {entry.toolErrors.map((e, i) => (
              <div
                key={i}
                className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  {e.toolId || '子调用失败'}
                </p>
                {e.url && (
                  <p className="font-mono mt-0.5 break-all text-[10.5px] leading-relaxed text-amber-700/80">
                    {e.url}
                  </p>
                )}
                <p className="font-mono mt-0.5 break-words text-[11px] leading-relaxed text-amber-900">
                  {e.error}
                </p>
              </div>
            ))}
          </div>
        )}
        {hasResults && <ToolResultList results={entry.results ?? []} />}
        {/* tool 没有结构化 {title,url} 但有可读结论时展示 —— 人话样式（非 mono） */}
        {!hasResults && hasRawPreview && entry.rawOutputPreview && (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
              结论 · Outcome
            </p>
            <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-700">
              {entry.rawOutputPreview}
              {entry.rawOutputPreview.length >= 500 ? ' …' : ''}
            </p>
          </div>
        )}
      </div>
    );
  }
  if (entry.kind === 'reflection' && entry.trace?.text) {
    return (
      <ExpandableText
        text={entry.trace.text}
        maxChars={260}
        className="block whitespace-pre-wrap text-[12.5px] leading-relaxed text-amber-900"
      />
    );
  }
  return null;
}

// ─── Tool result list ─────────────────────────────────
function ToolResultList({
  results,
}: {
  results: { title?: string; url?: string; snippet?: string }[];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? results : results.slice(0, 5);
  return (
    <div className="space-y-1.5">
      {visible.map((r, i) => (
        <SourceLink key={i} title={r.title} url={r.url} snippet={r.snippet} />
      ))}
      {results.length > 5 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll(!showAll);
          }}
          className="w-full rounded-md border border-dashed border-gray-300 bg-white px-2 py-1.5 text-center text-[11px] text-violet-600 hover:bg-violet-50 hover:text-violet-700"
        >
          {showAll
            ? `▴ 收起，仅显示前 5 条`
            : `▾ 展开剩余 ${results.length - 5} 条结果`}
        </button>
      )}
    </div>
  );
}

// ─── Raw trace row (developer view) ──────────────────
function RawTraceRow({ trace }: { trace: AgentTraceItem }) {
  const dump = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  };
  const inputStr = dump(trace.input);
  const outputStr = dump(trace.output);
  const kindCls =
    trace.kind === 'thought'
      ? 'bg-amber-50 text-amber-900'
      : trace.kind === 'action'
        ? 'bg-violet-50 text-violet-900'
        : trace.kind === 'observation'
          ? trace.error
            ? 'bg-red-50 text-red-900'
            : 'bg-sky-50 text-sky-900'
          : trace.kind === 'reflection'
            ? 'bg-purple-50 text-purple-900'
            : 'bg-red-50 text-red-900';
  return (
    <li
      className={cn(
        'rounded-md px-2 py-1.5 text-[11px] leading-relaxed',
        kindCls
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="font-semibold">{trace.kind}</span>
        {trace.toolId && (
          <span className="font-mono rounded bg-white/60 px-1.5 text-[10px]">
            {trace.toolId}
          </span>
        )}
        {trace.latencyMs != null && (
          <span className="font-mono text-[10px] opacity-60">
            {trace.latencyMs}ms
          </span>
        )}
        {trace.tokensUsed != null && trace.tokensUsed > 0 && (
          <span className="font-mono text-[10px] opacity-60">
            +{trace.tokensUsed}tk
          </span>
        )}
      </div>
      {trace.text && (
        <p className="mt-1 whitespace-pre-wrap break-words">{trace.text}</p>
      )}
      {inputStr && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] opacity-70 hover:opacity-100">
            ▸ input
          </summary>
          <pre className="font-mono mt-1 max-h-64 overflow-auto rounded bg-white/60 p-1.5 text-[10px] text-gray-700">
            {inputStr.length > 6000
              ? inputStr.slice(0, 6000) + '\n…(已截断)'
              : inputStr}
          </pre>
        </details>
      )}
      {outputStr && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] opacity-70 hover:opacity-100">
            ▸ output
          </summary>
          <pre className="font-mono mt-1 max-h-64 overflow-auto rounded bg-white/60 p-1.5 text-[10px] text-gray-700">
            {outputStr.length > 6000
              ? outputStr.slice(0, 6000) + '\n…(已截断)'
              : outputStr}
          </pre>
        </details>
      )}
      {trace.error && (
        <p className="mt-1 whitespace-pre-wrap break-words font-medium">
          ⚠{' '}
          {trace.error.length > 400
            ? trace.error.slice(0, 400) + '…'
            : trace.error}
        </p>
      )}
    </li>
  );
}
