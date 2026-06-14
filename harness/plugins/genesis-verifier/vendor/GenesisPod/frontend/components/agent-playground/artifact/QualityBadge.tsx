'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  AlertTriangle,
  Info,
} from 'lucide-react';
import type { ArtifactQualityVerdicts } from '@/lib/features/agent-playground/report-artifact.types';
import {
  scoreColor,
  scoreBgColor,
  scoreBgLight,
} from '@/lib/features/agent-playground/formatters';

interface Props {
  quality: ArtifactQualityVerdicts;
  /** 强制默认展开（在"报告分析"slide-over 内为 true，因为整个 tab 就是为查看质量服务的） */
  defaultOpen?: boolean;
}

const DIM_LABELS: Record<keyof ArtifactQualityVerdicts['dimensions'], string> =
  {
    traceability: '可追溯性',
    factualConsistency: '事实一致',
    novelty: '新颖度',
    coverage: '覆盖度',
    redundancy: '冗余控制',
    formatCorrectness: '格式正确',
    citationDensity: '引用密度',
    styleConformance: '风格一致',
    lengthAccuracy: '长度准确',
    chapterBalance: '章节平衡',
  };

/**
 * 10 维质量评分 + L4 critic 警告展示
 */
export function QualityBadge({ quality, defaultOpen }: Props) {
  // Phase P27-1: 有 hardGate 违规时默认展开；defaultOpen 强制覆盖（slide-over 用）
  const [open, setOpen] = useState(
    defaultOpen ?? quality.hardGateViolations.length > 0
  );
  const Icon =
    quality.overall >= 80
      ? ShieldCheck
      : quality.overall >= 60
        ? Info
        : AlertTriangle;
  const l4 = quality.warnings.filter((w) => w.dimension.startsWith('l4-'));
  const l4Verdict = l4.find((w) => w.dimension === 'l4-critic')?.message;
  const verdictMatch = l4Verdict?.match(/^\[(pass|concerns|fail)\]/);
  const verdict = verdictMatch?.[1] as 'pass' | 'concerns' | 'fail' | undefined;
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl ${scoreBgLight(quality.overall)}`}
          >
            <Icon className={`h-4 w-4 ${scoreColor(quality.overall)}`} />
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-900">
              质量评分{' '}
              <span className={scoreColor(quality.overall)}>
                {quality.overall}/100
              </span>
              {quality.finalVerdict && (
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    quality.finalVerdict === 'excellent'
                      ? 'bg-emerald-100 text-emerald-700'
                      : quality.finalVerdict === 'good'
                        ? 'bg-blue-100 text-blue-700'
                        : quality.finalVerdict === 'acceptable'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                  }`}
                >
                  {quality.finalVerdict === 'excellent'
                    ? '优秀'
                    : quality.finalVerdict === 'good'
                      ? '良好'
                      : quality.finalVerdict === 'acceptable'
                        ? '合格'
                        : '不达标'}
                </span>
              )}
            </p>
            <div className="mt-0.5 h-1 w-32 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full transition-all ${
                  quality.overall >= 80
                    ? 'bg-emerald-500'
                    : quality.overall >= 60
                      ? 'bg-amber-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(100, quality.overall)}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-500">
              {quality.hardGateViolations.length > 0
                ? `${quality.hardGateViolations.length} 项硬卡违规`
                : quality.warnings.length > 0
                  ? `${quality.warnings.length} 项提醒`
                  : '10 维通过'}
              {verdict && (
                <span
                  className={`ml-2 rounded px-1 py-0 text-[10px] font-medium ${
                    verdict === 'pass'
                      ? 'bg-emerald-100 text-emerald-700'
                      : verdict === 'concerns'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                  }`}
                >
                  L4 独立复审 · {verdict}
                </span>
              )}
            </p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          {/* 10 维评分（含进度条，弱项靠前） */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {Object.entries(quality.dimensions)
              .sort((a, b) => a[1] - b[1])
              .map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-lg border border-gray-100 bg-gray-50/50 p-2 text-center"
                >
                  <p className="text-[10px] text-gray-500">
                    {
                      DIM_LABELS[
                        k as keyof ArtifactQualityVerdicts['dimensions']
                      ]
                    }
                  </p>
                  <p className={`text-lg font-bold ${scoreColor(v)}`}>{v}</p>
                  <div className="mt-0.5 h-0.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full transition-all ${
                        v >= 80
                          ? 'bg-emerald-500'
                          : v >= 60
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(100, v)}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
          {/* hardGateViolations */}
          {quality.hardGateViolations.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-red-700">
                硬卡违规
              </p>
              <ul className="space-y-1">
                {quality.hardGateViolations.map((v, i) => (
                  <li
                    key={i}
                    className="rounded border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700"
                  >
                    [{v.severity}] {v.dimension}: {v.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* L4 critic */}
          {l4.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-violet-700">
                L4 独立复审
              </p>
              <ul className="space-y-1">
                {l4.map((w, i) => (
                  <li
                    key={i}
                    className="rounded border border-violet-100 bg-violet-50 px-2 py-1 text-xs text-violet-700"
                  >
                    <span className="font-semibold">{w.dimension}</span>:{' '}
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* qualityTrace 时间线（相对时间） */}
          {quality.qualityTrace.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-700">
                <span>质量审核轨迹</span>
                <span
                  className={`rounded px-1 py-0 text-[10px] font-medium ${
                    quality.qualityTrace.every((t) => t.passed)
                      ? 'bg-emerald-100 text-emerald-700'
                      : quality.qualityTrace.filter((t) => t.passed).length >=
                          quality.qualityTrace.length / 2
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                  }`}
                >
                  {quality.qualityTrace.filter((t) => t.passed).length}/
                  {quality.qualityTrace.length} 通过
                </span>
              </p>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto text-[11px]">
                {(() => {
                  const t0 = quality.qualityTrace[0]?.timestamp ?? 0;
                  return quality.qualityTrace.map((t, i) => {
                    const delta = ((t.timestamp - t0) / 1000).toFixed(1);
                    return (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-gray-600"
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${t.passed ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        />
                        <span className="font-medium">{t.stage}</span>
                        <span className="text-gray-400">·</span>
                        <span className="truncate">{t.check}</span>
                        <span className="ml-auto text-[10px] text-gray-400">
                          +{delta}s
                        </span>
                      </li>
                    );
                  });
                })()}
              </ul>
            </div>
          )}

          {/* 其他 warnings */}
          {quality.warnings.filter((w) => !w.dimension.startsWith('l4-'))
            .length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-amber-700">
                其他提醒
              </p>
              <ul className="space-y-1">
                {quality.warnings
                  .filter((w) => !w.dimension.startsWith('l4-'))
                  .map((w, i) => (
                    <li
                      key={i}
                      className="rounded border border-amber-100 bg-amber-50 px-2 py-1 text-xs text-amber-700"
                    >
                      <span className="font-semibold">{w.dimension}</span>:{' '}
                      {w.message}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
