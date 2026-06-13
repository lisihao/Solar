/**
 * AgentInspector - 通用 Agent 详情弹框类型定义
 *
 * 抽自 agent-playground RoleDetailCard，规格同 Screenshot_16：
 * - 头部：Icon + 标题 + 状态 · 实例数 + 关闭按钮
 * - 描述：一句话说明
 * - 状态计数：running / done / failed / iter chips
 * - 配置 dl：Loop / Model / Skills / Tools / Verifier
 * - 最近思考：amber 色块 callout
 * - 底部「与该 Agent 对话」按钮
 */

import type { LucideIcon } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

/** 状态类型 —— 五态对应五种颜色 */
export type AgentInspectorStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'pending';

/** 实例计数（一个 role 可能有多个并行实例） */
export interface AgentInstanceCounts {
  running?: number;
  completed?: number;
  failed?: number;
  /** 总迭代数（agent-playground 用于 ReAct iter 计数） */
  iterations?: number;
}

/** 配置项（dl 列表） */
export interface AgentConfigEntry {
  /** 标签（左侧 dt） */
  label: string;
  /** 单值文本 */
  value?: ReactNode;
  /** 数组值 → 渲染为 chips */
  chips?: string[];
  /** chips 颜色（Tailwind 配色组），默认按 label 推断 */
  chipsClassName?: string;
}

/** Agent 详情弹框的输入 */
export interface AgentInspectorAgent {
  /** Agent 名称（粗体大字） */
  name: string;
  /** 一句话描述 */
  description?: string;
  /** 顶部 icon —— Lucide 组件或 emoji 字符串 */
  icon?: LucideIcon | ComponentType<{ className?: string }> | string;
  /** Icon 容器配色，如 'bg-violet-50 text-violet-600' */
  iconClassName?: string;

  /** 状态文案（如 "进行中" / "已完成"） */
  statusLabel?: string;
  /** 状态颜色 Tailwind 类，如 'text-blue-600' */
  statusColorClass?: string;
  /** 实例总数（不传则不展示「· N 实例」） */
  totalInstances?: number;
  /** 实例计数细分 */
  instanceCounts?: AgentInstanceCounts;

  /** 配置项（Loop / Model / 技能 / 工具 / Verifier 等） */
  config?: AgentConfigEntry[];

  /** 最近思考文本；不传则不展示 callout */
  recentThought?: string;
}

/** 弹框形态 */
export type AgentInspectorMode = 'modal' | 'overlay';

export interface AgentInspectorProps {
  open: boolean;
  onClose: () => void;
  agent: AgentInspectorAgent;

  /**
   * 'modal' = 屏幕居中（默认），用 createPortal 挂到 body
   * 'overlay' = 在父容器内绝对居中（嵌入 TeamTopologyCanvas.renderDetail 用）
   */
  mode?: AgentInspectorMode;

  /** 「与该 Agent 对话」按钮回调；不传则不展示 */
  onChat?: () => void;
  chatLabel?: string;

  /** i18n 文案 */
  labels?: {
    instancesUnit?: string; // 默认「实例」
    running?: string; // 默认「进行中」
    completed?: string; // 默认「完成」
    failed?: string; // 默认「失败」
    iterations?: string; // 默认「iter」
    recentThought?: string; // 默认「最近思考」
    chat?: string; // 默认「与该 Agent 对话」
  };
}
