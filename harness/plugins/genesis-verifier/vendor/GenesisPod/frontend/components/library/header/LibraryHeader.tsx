'use client';

import { BookOpen, Plus } from 'lucide-react';
import { BRAND_GRADIENT } from '../_design/tokens';

interface LibraryHeaderProps {
  title: string;
  subtitle: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * 知识库统一 Header（与 AI Office / AI Research 同构）
 * - 左：渐变方块 logo + 标题 + 副标题
 * - 右：主 CTA
 * 搜索框已拆出（LibrarySearchBar），放到 Tab 下方 —— 学习 Agent 市场范式。
 */
export default function LibraryHeader({
  title,
  subtitle,
  primaryAction,
}: LibraryHeaderProps) {
  return (
    <div className="border-b border-gray-100 bg-white/70 backdrop-blur-sm">
      <div className="px-8 pb-4 pt-6">
        {/* Title row */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${BRAND_GRADIENT.gradient} shadow-lg ${BRAND_GRADIENT.shadow}`}
            >
              <BookOpen className="h-7 w-7 text-white" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
              <p className="text-sm text-gray-500">{subtitle}</p>
            </div>
          </div>
          {primaryAction && (
            <button
              onClick={primaryAction.onClick}
              className={`inline-flex items-center gap-2 rounded-xl bg-gradient-to-r ${BRAND_GRADIENT.gradient} px-4 py-2.5 text-sm font-semibold text-white shadow-lg ${BRAND_GRADIENT.shadow} transition-all hover:shadow-xl`}
            >
              <Plus className="h-4 w-4" />
              {primaryAction.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
