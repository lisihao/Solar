'use client';

/**
 * BudgetAndTimeLimitPanel —— mission 预算 + 时长上限统一控件。
 *
 * 在两处共用：
 *   1. 新建 mission 对话框（PlaygroundMissionDialog）
 *   2. mission 详情页 "另存为新 mission" 设置面板
 *
 * 暴露 3 个硬上限给用户：
 *   - maxCredits          mission 级 token 上限（1 credit ≈ 1k tokens）
 *   - budgetMultiplier    每个子 agent 的 token / iteration 缩放
 *   - wallTimeMinutes     mission 总时长上限
 *
 * 实时显示 ≈ tokens / ≈ USD，让用户清楚"会烧多少"。
 */

import { cn } from '@/lib/utils/common';

export const CREDIT_PRESETS = [500, 2000, 8000, 30000, 100000] as const;
export const MULTIPLIER_PRESETS = [0.5, 1.0, 2.0, 4.0] as const;
export const WALL_TIME_PRESETS = [15, 30, 60, 120, 180] as const;

export const MAX_CREDITS_LIMIT = { min: 10, max: 100_000 } as const;
export const MULTIPLIER_LIMIT = { min: 0.3, max: 10 } as const;
export const WALL_TIME_LIMIT_MINUTES = { min: 1, max: 180 } as const;

// ★ 2026-05-22 ③J/K 契约单一源：原 SCALE_TIERS 前端镜像已删除。调研规模档位的
//   数值/展示全部来自后端 GET /agent-playground/budget-tiers（useBudgetTiers），
//   前端不再维护任何 tier 数值副本（杜绝"前后端各一份 → 漂移"）。

export interface BudgetAndTimeLimitPanelProps {
  maxCredits: number;
  setMaxCredits: (n: number) => void;
  budgetMultiplierOverride: number;
  setBudgetMultiplierOverride: (n: number) => void;
  wallTimeMinutes: number;
  setWallTimeMinutes: (n: number) => void;
  /** compact = 一行 label + 控件（默认 false：label 占独立一行） */
  compact?: boolean;
}

export function BudgetAndTimeLimitPanel({
  maxCredits,
  setMaxCredits,
  budgetMultiplierOverride,
  setBudgetMultiplierOverride,
  wallTimeMinutes,
  setWallTimeMinutes,
  compact = false,
}: BudgetAndTimeLimitPanelProps) {
  const estimatedTokens = maxCredits * 1000;
  const estimatedUsd = maxCredits * 0.002;

  return (
    <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            预算与时限
          </p>
          <p className="mt-0.5 text-[11px] text-amber-900/70">
            硬上限。任意一项先到 → mission 自动停止，不会无限烧。
          </p>
        </div>
        <div className="text-right text-[11px] leading-tight text-amber-900">
          <p className="font-mono text-sm font-semibold">
            ≈ {(estimatedTokens / 1_000_000).toFixed(2)}M tokens
          </p>
          <p className="font-mono">≈ ${estimatedUsd.toFixed(2)} USD</p>
        </div>
      </div>

      <NumberFieldWithChips
        label={`Credits 上限（1 credit ≈ 1k tokens · 范围 ${MAX_CREDITS_LIMIT.min} – ${MAX_CREDITS_LIMIT.max}）`}
        value={maxCredits}
        min={MAX_CREDITS_LIMIT.min}
        max={MAX_CREDITS_LIMIT.max}
        onChange={(v) =>
          setMaxCredits(
            Math.max(MAX_CREDITS_LIMIT.min, Math.min(MAX_CREDITS_LIMIT.max, v))
          )
        }
        presets={CREDIT_PRESETS}
        renderPreset={(p) => (p >= 1000 ? `${p / 1000}k` : String(p))}
        compact={compact}
      />

      <NumberFieldWithChips
        label={`Agent 倍率（每个子 agent 的 token / iteration 缩放 · 范围 ${MULTIPLIER_LIMIT.min} – ${MULTIPLIER_LIMIT.max}）`}
        value={budgetMultiplierOverride}
        min={MULTIPLIER_LIMIT.min}
        max={MULTIPLIER_LIMIT.max}
        step={0.1}
        onChange={(v) =>
          setBudgetMultiplierOverride(
            Math.max(MULTIPLIER_LIMIT.min, Math.min(MULTIPLIER_LIMIT.max, v))
          )
        }
        presets={MULTIPLIER_PRESETS}
        renderPreset={(p) => `${p.toFixed(1)}×`}
        compact={compact}
      />

      <NumberFieldWithChips
        label={`时长上限（分钟 · 范围 ${WALL_TIME_LIMIT_MINUTES.min} – ${WALL_TIME_LIMIT_MINUTES.max}）`}
        value={wallTimeMinutes}
        min={WALL_TIME_LIMIT_MINUTES.min}
        max={WALL_TIME_LIMIT_MINUTES.max}
        onChange={(v) =>
          setWallTimeMinutes(
            Math.max(
              WALL_TIME_LIMIT_MINUTES.min,
              Math.min(WALL_TIME_LIMIT_MINUTES.max, v)
            )
          )
        }
        presets={WALL_TIME_PRESETS}
        renderPreset={(p) => (p >= 60 ? `${p / 60}h` : `${p}m`)}
        compact={compact}
      />
    </div>
  );
}

interface NumberFieldWithChipsProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  presets: readonly number[];
  renderPreset: (p: number) => string;
  compact: boolean;
}

function NumberFieldWithChips({
  label,
  value,
  min,
  max,
  step,
  onChange,
  presets,
  renderPreset,
  compact,
}: NumberFieldWithChipsProps) {
  return (
    <div className={cn('space-y-1', compact && 'space-y-0.5')}>
      <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(+e.target.value || min)}
          className="font-mono w-32 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
        />
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
                value === preset
                  ? 'border-amber-500 bg-amber-100 text-amber-900'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300'
              )}
            >
              {renderPreset(preset)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
