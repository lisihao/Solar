'use client';

import { ChevronDown } from 'lucide-react';
import {
  type ArchitectureLayer as LayerType,
  LAYER_STYLES,
} from '@/lib/features/admin/architecture';
import type { OverviewCardStatus } from '@/hooks/domain/useAdminStatus';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils/common';
import ArchitectureCard from './ArchitectureCard';

interface ArchitectureLayerProps {
  layer: LayerType;
  showArrow?: boolean;
  overviewStats?: Record<string, number>;
  /** 实时状态映射（key = card id） */
  cardStatuses?: Record<string, OverviewCardStatus>;
}

export default function ArchitectureLayer({
  layer,
  showArrow = true,
  overviewStats,
  cardStatuses,
}: ArchitectureLayerProps) {
  const { t } = useTranslation();
  const styles = LAYER_STYLES[layer.level];

  // 该层异常卡片数（用于层头摘要）：故障红 > 降级黄 > 健康绿
  const layerCards = layer.cards ?? layer.groups?.flatMap((g) => g.cards) ?? [];
  const downCount = cardStatuses
    ? layerCards.filter((c) => cardStatuses[c.id]?.status === 'down').length
    : 0;
  const degradedCount = cardStatuses
    ? layerCards.filter((c) => cardStatuses[c.id]?.status === 'degraded').length
    : 0;

  return (
    <div className="relative">
      {/* Layer container — 白色层卡 + 发丝描边 + 左侧细色轨 */}
      <div
        className={cn(
          'overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md',
          styles.border,
          styles.bg
        )}
      >
        <div className="flex">
          {/* Left accent rail */}
          <div className={cn('w-1 flex-shrink-0', styles.accentBar)} />

          <div className="min-w-0 flex-1">
            {/* Layer header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div className="flex items-center gap-3">
                {/* Level badge — 等宽字，工程图纸感 */}
                <span
                  className={cn(
                    'font-mono flex h-7 items-center rounded-md px-2 text-xs font-bold tracking-wide',
                    styles.badge
                  )}
                >
                  {layer.displayLevel ?? `L${layer.level}`}
                </span>

                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold tracking-tight text-slate-900">
                    {t(layer.titleKey)}
                  </h3>
                  {layer.subtitleKey && (
                    <p className="truncate text-xs text-slate-400">
                      {t(layer.subtitleKey)}
                    </p>
                  )}
                </div>
              </div>

              {/* Layer status summary */}
              <div className="font-mono flex flex-shrink-0 items-center gap-2 text-xs text-slate-400">
                {cardStatuses &&
                  (downCount > 0 ? (
                    <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 font-sans font-medium text-red-700">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                      {downCount} {t('admin.architecture.health.down')}
                    </span>
                  ) : degradedCount > 0 ? (
                    <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 font-sans font-medium text-amber-700">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                      {degradedCount} {t('admin.architecture.health.degraded')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 font-sans font-medium text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {t('admin.architecture.health.healthy')}
                    </span>
                  ))}
                <span>
                  {layerCards.length}
                  <span className="ml-1 text-slate-300">modules</span>
                </span>
              </div>
            </div>

            {/* Cards grid */}
            <div className="px-5 py-4">
              {layer.cards && (
                <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                  {layer.cards.map((card) => (
                    <ArchitectureCard
                      key={card.id}
                      card={card}
                      layerLevel={layer.level}
                      fixedWidth
                      overviewStats={overviewStats}
                      cardStatus={cardStatuses?.[card.id]}
                    />
                  ))}
                </div>
              )}

              {/* Grouped cards (for layers with sub-groups) */}
              {layer.groups && (
                <div className="space-y-4">
                  {layer.groups.map((group) => (
                    <div key={group.id}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-mono text-xs uppercase tracking-widest text-slate-400">
                          {t(group.titleKey)}
                        </span>
                        <div className="h-px flex-1 bg-slate-100" />
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                        {group.cards.map((card) => (
                          <ArchitectureCard
                            key={card.id}
                            card={card}
                            layerLevel={layer.level}
                            fixedWidth
                            overviewStats={overviewStats}
                            cardStatus={cardStatuses?.[card.id]}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dependency flow connector — 极简发丝线 */}
      {showArrow && (
        <div className="flex flex-col items-center py-1">
          <div className="h-3 w-px bg-slate-200" />
          <ChevronDown className="-my-0.5 h-3.5 w-3.5 text-slate-300" />
          <div className="h-3 w-px bg-slate-200" />
        </div>
      )}
    </div>
  );
}
