'use client';

/**
 * AgentInspector - 通用 Agent 详情弹框
 *
 * 抽自 agent-playground RoleDetailCard，是 Topic Insights / AI Planning /
 * AI Writing / AI Teams / AI Simulation 各模块的「点击 Agent 节点」统一弹框。
 *
 * 特性：
 * - 4 段信息：身份(A) / 配置(B) / 能力(C) / 状态(D)
 * - 底部「与该 Agent 对话」主按钮
 * - 两种形态：
 *   - modal：屏幕居中（createPortal），ESC / 遮罩点击关闭
 *   - overlay：父容器内绝对定位居中（用于 TeamTopologyCanvas.renderDetail）
 *
 * 数据契约见 types.ts，调用方喂数据，组件不直连 API。
 */

import { useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { Lightbulb, X } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import type { AgentInspectorProps } from './types';

const DEFAULT_LABELS: Required<NonNullable<AgentInspectorProps['labels']>> = {
  instancesUnit: '实例',
  running: '进行中',
  completed: '完成',
  failed: '失败',
  iterations: 'iter',
  recentThought: '最近思考',
  chat: '与该 Agent 对话',
};

const CHIP_PRESET: Record<string, string> = {
  default: 'bg-gray-100 text-gray-700',
  violet: 'bg-violet-50 text-violet-700',
  sky: 'bg-sky-50 text-sky-700',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
};

function inferChipClassName(label: string, override?: string): string {
  if (override) return override;
  // 按惯例：技能 → violet；工具 → sky；Verifier → amber
  if (/技能|skill/i.test(label)) return CHIP_PRESET.violet;
  if (/工具|tool/i.test(label)) return CHIP_PRESET.sky;
  if (/verifier|审|judge/i.test(label)) return CHIP_PRESET.amber;
  return CHIP_PRESET.default;
}

function renderIcon(
  icon: AgentInspectorProps['agent']['icon'],
  className: string
) {
  if (!icon) return null;
  if (typeof icon === 'string') {
    return <span className="text-xl">{icon}</span>;
  }
  const Icon = icon as ComponentType<{ className?: string }>;
  return <Icon className={className} />;
}

export function AgentInspector(props: AgentInspectorProps) {
  const {
    open,
    onClose,
    agent,
    mode = 'modal',
    onChat,
    chatLabel,
    labels: labelOverrides,
  } = props;

  const labels = { ...DEFAULT_LABELS, ...labelOverrides };

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // ESC 关闭（仅 modal 模式）
  useEffect(() => {
    if (!open || mode !== 'modal') return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, mode, onClose]);

  if (!open) return null;

  const counts = agent.instanceCounts ?? {};
  const showCountsRow =
    counts.running || counts.completed || counts.failed || counts.iterations
      ? true
      : false;

  const card = (
    <div
      className="max-h-[85vh] w-[360px] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
              agent.iconClassName ?? 'bg-violet-50 text-violet-600'
            )}
          >
            {renderIcon(agent.icon, 'h-4 w-4')}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-gray-900">
              {agent.name}
            </div>
            {(agent.statusLabel || agent.totalInstances !== undefined) && (
              <span
                className={cn(
                  'text-[11px] font-medium',
                  agent.statusColorClass ?? 'text-gray-500'
                )}
              >
                {agent.statusLabel}
                {agent.totalInstances !== undefined &&
                  agent.totalInstances > 0 && (
                    <span className="ml-1 text-gray-400">
                      · {agent.totalInstances} {labels.instancesUnit}
                    </span>
                  )}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Description */}
      {agent.description && (
        <p className="mb-3 text-[11px] leading-relaxed text-gray-600">
          {agent.description}
        </p>
      )}

      {/* Instance counts row */}
      {showCountsRow && (
        <div className="mb-3 flex flex-wrap gap-1 text-[10px] font-medium">
          {counts.running ? (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
              {counts.running} {labels.running}
            </span>
          ) : null}
          {counts.completed ? (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
              {counts.completed} {labels.completed}
            </span>
          ) : null}
          {counts.failed ? (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
              {counts.failed} {labels.failed}
            </span>
          ) : null}
          {counts.iterations ? (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
              {counts.iterations} {labels.iterations}
            </span>
          ) : null}
        </div>
      )}

      {/* Config dl: Loop / Model / Skills / Tools / Verifier */}
      {agent.config && agent.config.length > 0 && (
        <dl className="mb-3 space-y-1.5 text-[11px]">
          {agent.config.map((entry, idx) => {
            const chipClass = inferChipClassName(
              entry.label,
              entry.chipsClassName
            );
            return (
              <div key={idx} className="flex items-baseline gap-2">
                <dt className="w-16 shrink-0 text-gray-500">{entry.label}</dt>
                <dd className="flex flex-wrap gap-1">
                  {entry.chips && entry.chips.length > 0 ? (
                    entry.chips.map((c) => (
                      <span
                        key={c}
                        className={cn(
                          'font-mono rounded px-1.5 py-0.5',
                          chipClass
                        )}
                      >
                        {c}
                      </span>
                    ))
                  ) : entry.value !== undefined && entry.value !== null ? (
                    <span className="text-gray-700">{entry.value}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {/* Recent thinking callout */}
      {agent.recentThought && (
        <div className="rounded-lg bg-amber-50/60 px-2.5 py-2">
          <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            <Lightbulb className="h-3 w-3 text-amber-500" />
            {labels.recentThought}
          </p>
          <RecentThoughtBlock text={agent.recentThought} />
        </div>
      )}

      {/* Chat button */}
      {onChat && (
        <button
          type="button"
          onClick={onChat}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-3 py-2 text-[12px] font-medium text-white shadow-sm transition-all hover:shadow-md"
        >
          <Lightbulb className="h-3.5 w-3.5" />
          {chatLabel ?? labels.chat}
        </button>
      )}
    </div>
  );

  if (mode === 'overlay') {
    // 嵌入父容器（如 TeamTopologyCanvas）的居中浮层
    return (
      <>
        <div className="absolute inset-0 z-20 bg-black/0" onClick={onClose} />
        <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
          {card}
        </div>
      </>
    );
  }

  // modal 模式：portal 到 body，ESC + 点击遮罩关闭
  if (!mounted) return null;
  return createPortal(
    <div
      className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {card}
    </div>,
    document.body
  );
}

/**
 * 2026-05-09 (screenshot 47): 结构化渲染最近思考。
 * 之前直接 `<p>{text}</p>`，长字符串/JSON 都被压成一坨。
 *
 * 三段式自适应：
 *   1. JSON 解析成功 → 按字段名渲染键值列表（key 加粗 + value 缩进）
 *   2. 含换行 / 列表标记 → 用 whitespace-pre-wrap 保留排版
 *   3. 其他 → 简单包裹保留连字
 *
 * 容器最大高度 192px + 滚动，避免长 thought 撑爆 360px 卡片。
 */
function RecentThoughtBlock({ text }: { text: string }) {
  const trimmed = text.trim();
  const parsed = tryParseJson(trimmed);
  const baseClass =
    'max-h-48 overflow-y-auto text-[11px] leading-relaxed text-amber-900';

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length > 0) {
      return (
        <dl className={`${baseClass} space-y-1.5`}>
          {entries.map(([key, value]) => (
            <div key={key} className="rounded bg-white/50 px-2 py-1">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                {key}
              </dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-amber-900/90">
                {renderJsonValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      );
    }
  }

  // markdown / multiline / bullet 文本：保留排版
  if (/\n|^[-*]\s/m.test(trimmed)) {
    return (
      <pre className={`${baseClass} whitespace-pre-wrap break-words font-sans`}>
        {trimmed}
      </pre>
    );
  }

  return <p className={`${baseClass} break-words`}>{trimmed}</p>;
}

function tryParseJson(text: string): unknown {
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function renderJsonValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : JSON.stringify(v)
      )
      .join(', ');
  }
  return JSON.stringify(value, null, 2);
}
