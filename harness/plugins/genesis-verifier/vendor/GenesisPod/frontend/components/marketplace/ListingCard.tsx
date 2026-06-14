'use client';

/**
 * ListingCard —— 智能体市场货架卡（4 类货架通用）。
 *
 * 说明：canonical AssetCard 面向"我拥有的资产 + 可见性切换"，与市场货架（只读货架 +
 * 一键采用 + 评分/采用数）语义不符，故为市场单独做一张轻卡；颜色全部走 token 化的
 * KIND_META，不散落硬编码 hue。
 */

import { Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import {
  SENIORITY_LABEL,
  TOOL_SOURCE_LABEL,
  type AnyListing,
} from './marketplace.types';
import { KIND_META, RatingMeta } from './listing-shared';

interface ListingCardProps {
  listing: AnyListing;
  acquired: boolean;
  onOpen: () => void;
  onAcquire: () => void;
}

export function ListingCard({
  listing,
  acquired,
  onOpen,
  onAcquire,
}: ListingCardProps) {
  const meta = KIND_META[listing.kind];
  const Icon = meta.Icon;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer flex-col rounded-xl border border-gray-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* 头部：图标 + 名称 + 类目 */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm',
            listing.kind === 'agent' ? listing.avatarGradient : meta.gradient
          )}
        >
          {listing.kind === 'agent' ? (
            <span className="text-base font-semibold">{listing.name[0]}</span>
          ) : (
            <Icon className="h-5 w-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-gray-900">
              {listing.name}
            </h3>
            <span
              className={cn(
                'flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                meta.soft,
                meta.text
              )}
            >
              {listing.kind === 'agent' ? listing.role : meta.label}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">
            {listing.tagline}
          </p>
        </div>
      </div>

      {/* 描述 */}
      <p className="mt-3 line-clamp-2 text-sm text-gray-600">
        {listing.description}
      </p>

      {/* 类型专属小标签 */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {listing.kind === 'agent' && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {SENIORITY_LABEL[listing.seniority]} · {listing.skillIds.length}{' '}
            技能 / {listing.toolIds.length} 工具
          </span>
        )}
        {listing.kind === 'tool' && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            来自 {TOOL_SOURCE_LABEL[listing.source]}
          </span>
        )}
        {listing.kind === 'workflow' && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {listing.teamSize} 人阵型 · {listing.stages.length} 阶段
          </span>
        )}
        {listing.kind === 'skill' && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            适用 {listing.activatesFor.join(' / ')}
          </span>
        )}
      </div>

      {/* 底部：评分 + 采用按钮 */}
      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
        <RatingMeta rating={listing.rating} installs={listing.installs} />
        {acquired ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700">
            <Check className="h-3.5 w-3.5" />
            已加入
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAcquire();
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            {listing.kind === 'agent' ? '招聘' : '加入'}
          </button>
        )}
      </div>
    </div>
  );
}
