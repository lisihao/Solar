'use client';

import {
  Clock,
  GitCompareArrows,
  History,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { ReportVersionMeta } from './ArtifactReader';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { SideDrawer } from '@/components/common/drawers/SideDrawer';

interface Props {
  open: boolean;
  versions: ReportVersionMeta[];
  currentVersion?: number;
  versionSwitching?: boolean;
  onSelectVersion: (version: number) => void;
  onClose: () => void;
}

/**
 * ★ 2026-05-07 学 TI ReportRevisionHistory（components/ai-insights/reports/）：
 *   - 顶部 History 图标触发右侧抽屉（学 TopicContentPanel:1544-1564 sidePanelType）
 *   - 时间线卡片：版本徽章 + triggerType 标签 + 评分 + 签字 + 时间
 *   - radio 单选切换；当前版本高亮 + 蓝色环（learn TI 1313-1318）
 *
 *   playground 与 TI 差异：playground mission 报告是不可变快照（每次 rerun 写新版本）
 *   不支持 rollback / edit（这两个 TI 语义在 playground 无意义），仅支持切换查看。
 */

const TRIGGER_LABELS: Record<
  string,
  {
    label: string;
    color: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  initial: {
    label: '首版',
    color: 'text-emerald-700 bg-emerald-50',
    icon: Plus,
  },
  'rerun-fresh': {
    label: '全量重跑',
    color: 'text-blue-700 bg-blue-50',
    icon: RefreshCw,
  },
  'rerun-incremental': {
    label: '增量重跑',
    color: 'text-violet-700 bg-violet-50',
    icon: GitCompareArrows,
  },
  'todo-rerun': {
    label: 'TODO 重跑',
    color: 'text-amber-700 bg-amber-50',
    icon: Sparkles,
  },
};

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

export function ReportVersionDrawer({
  open,
  versions,
  currentVersion,
  versionSwitching = false,
  onSelectVersion,
  onClose,
}: Props) {
  return (
    <SideDrawer open={open} onClose={onClose} title="版本历史" widthPx={420}>
      {/* Subtitle */}
      <p className="mb-3 flex items-center gap-1.5 text-[11px] text-gray-500">
        <History className="h-3.5 w-3.5 text-violet-600" />共 {versions.length}{' '}
        个版本
        {currentVersion != null ? ` · 当前显示 v${currentVersion}` : ''}
      </p>

      {/* Body */}
      {versions.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-12 w-12" />}
          title="暂无版本记录"
          description="Mission 完成后将记录首版报告"
        />
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute bottom-0 left-4 top-0 w-0.5 bg-gray-200" />
          <div className="space-y-4">
            {versions.map((v) => {
              const cfg = TRIGGER_LABELS[v.triggerType] ?? {
                label: v.triggerType,
                color: 'text-gray-700 bg-gray-50',
                icon: RefreshCw,
              };
              const Icon = cfg.icon;
              const isCurrent = v.version === currentVersion;
              return (
                <label
                  key={v.version}
                  className={`relative flex cursor-pointer gap-3 pl-10 transition-colors ${
                    isCurrent
                      ? '-mx-4 rounded-lg bg-violet-50/60 px-4 py-2'
                      : 'hover:-mx-4 hover:rounded-lg hover:bg-gray-50 hover:px-4 hover:py-2'
                  } ${versionSwitching ? 'pointer-events-none opacity-60' : ''}`}
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-2 flex h-5 w-5 items-center justify-center rounded-full ${
                      isCurrent
                        ? 'bg-violet-600 ring-4 ring-violet-100'
                        : 'border-2 border-gray-300 bg-white'
                    }`}
                  >
                    {isCurrent && (
                      <div className="h-2 w-2 rounded-full bg-white" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {/* Version + trigger type + signed badge */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-sm font-bold text-gray-900">
                            v{v.version}
                          </span>
                          <span
                            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${cfg.color}`}
                          >
                            <Icon className="h-2.5 w-2.5" />
                            {cfg.label}
                          </span>
                          {isCurrent && (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10.5px] font-medium text-violet-700">
                              当前
                            </span>
                          )}
                          {v.leaderSigned === true && (
                            <span
                              className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700"
                              title="Leader 签字"
                            >
                              已签
                            </span>
                          )}
                          {v.leaderSigned === false && (
                            <span
                              className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700"
                              title="未签字"
                            >
                              未签
                            </span>
                          )}
                        </div>

                        {/* Label / meta */}
                        {v.versionLabel && (
                          <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                            {v.versionLabel}
                          </p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10.5px] text-gray-500">
                          <span>{formatDateTime(v.generatedAt)}</span>
                          {v.finalScore != null && (
                            <span
                              className={
                                v.finalScore >= 80
                                  ? 'font-medium text-emerald-600'
                                  : v.finalScore >= 65
                                    ? 'font-medium text-amber-600'
                                    : 'font-medium text-red-600'
                              }
                            >
                              {v.finalScore} 分
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Radio */}
                      <input
                        type="radio"
                        name="report-version"
                        checked={isCurrent}
                        disabled={versionSwitching}
                        onChange={() => {
                          if (!isCurrent) onSelectVersion(v.version);
                        }}
                        className="mt-0.5 h-4 w-4 cursor-pointer text-violet-600 focus:ring-violet-500"
                      />
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer hints */}
      {versions.length === 1 && (
        <p className="mt-4 border-t border-gray-200 pt-3 text-[11px] text-gray-500">
          首次生成版本，rerun 任意章节 / 全量后将出现新版本
        </p>
      )}
      {versionSwitching && (
        <p className="mt-4 border-t border-gray-200 pt-3 text-[11px] text-violet-600">
          <RefreshCw className="mr-1 inline h-3 w-3 animate-spin" />
          正在加载版本内容…
        </p>
      )}
    </SideDrawer>
  );
}
