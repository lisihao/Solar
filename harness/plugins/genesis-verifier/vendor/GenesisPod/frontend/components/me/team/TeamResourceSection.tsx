'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states/LoadingState';
import { ErrorState } from '@/components/ui/states/ErrorState';
import { KIND_META } from '@/components/marketplace/listing-shared';
import type { ListingKind } from '@/components/marketplace/marketplace.types';

/** 卡片视图模型（调用方从真实数据 / mock 映射好，meta/usage 预渲染为节点）。 */
export interface TeamResourceCard {
  id: string;
  name: string;
  subtitle?: string;
  /** 分组依据（工具=category，技能=domain，工作流=category） */
  category: string;
  /** 标题下的 meta 行（状态徽章 / 阶段链 / 来源等） */
  meta?: ReactNode;
  /** 底部左侧用量/状态文案 */
  usage?: ReactNode;
  /** 底部右侧操作（配置密钥 / 申请授权 / 测试 / 套用…），调用方按数据渲染 */
  actions?: ReactNode;
  /** 传入则标题可内联改名（工作流用） */
  onRename?: (name: string) => void;
  /** 标题旁的徽标（如工作流来源「市场/自建」） */
  badge?: ReactNode;
}

/**
 * TeamResourceSection —— 「我的团队」下三个资源库（团队工具/技能/工作流）的共用骨架。
 *
 * 卡片样式统一（用户 2026-06-07 要求与工作流对齐）+ 按分类分组呈现。
 * 工具/技能接真实后端数据（loading/error 由调用方透传），工作流为 mock。
 */
export interface TeamResourceSectionProps {
  kind: ListingKind;
  cards: TeamResourceCard[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** 数量单位，如「套工作流」「个工具」「项技能」 */
  unitLabel: string;
  /** 市场货架名，如「工作流市场」 */
  marketLabel: string;
  /** 提示尾句，如「获取更多 SOP。」 */
  hint: string;
  emptyTitle: string;
  emptyDesc: string;
  /** 头部右侧额外内容（如「新建工作流」按钮） */
  headerExtra?: ReactNode;
}

export function TeamResourceSection({
  kind,
  cards,
  loading,
  error,
  onRetry,
  unitLabel,
  marketLabel,
  hint,
  emptyTitle,
  emptyDesc,
  headerExtra,
}: TeamResourceSectionProps) {
  const meta = KIND_META[kind];
  const Icon = meta.Icon;

  // 按分类分组（每组一个标题 + 卡片网格）
  const grouped = (() => {
    const map = new Map<string, TeamResourceCard[]>();
    for (const c of cards) {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {loading ? '加载中…' : `已获取 ${cards.length} ${unitLabel}`}。去
          <Link
            href="/marketplace"
            className="mx-1 font-medium text-primary hover:underline"
          >
            {marketLabel}
          </Link>
          {hint}
        </p>
        <div className="flex flex-shrink-0 items-center gap-2">
          {headerExtra}
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            去市场 <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : cards.length === 0 ? (
        <EmptyState
          type="default"
          title={emptyTitle}
          description={emptyDesc}
          action={{
            label: '去市场',
            onClick: () => {
              window.location.href = '/marketplace';
            },
          }}
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, group]) => (
            <div key={category} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {category}{' '}
                <span className="font-normal text-gray-400">
                  · {group.length}
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.map((card) => (
                  <div
                    key={card.id}
                    className="flex flex-col rounded-xl border border-gray-200 bg-white p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm',
                          meta.gradient
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {card.onRename ? (
                            <input
                              value={card.name}
                              onChange={(e) => card.onRename?.(e.target.value)}
                              aria-label="名称"
                              className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent font-semibold text-gray-900 hover:border-gray-200 focus:border-gray-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          ) : (
                            <h4 className="truncate font-semibold text-gray-900">
                              {card.name}
                            </h4>
                          )}
                          {card.badge}
                        </div>
                        {card.subtitle && (
                          <p className="line-clamp-1 text-xs text-gray-500">
                            {card.subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    {card.meta && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {card.meta}
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs text-gray-400">
                      <span className="min-w-0 truncate">{card.usage}</span>
                      {card.actions && (
                        <div className="flex flex-shrink-0 items-center gap-1">
                          {card.actions}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
