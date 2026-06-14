'use client';

/**
 * Wiki Card Grid — landing surface for the Library Wiki tab.
 *
 * One AssetCard per wiki-enabled KB the caller has access to. Click a card
 * to enter the full wiki detail view (existing WikiTab body) for that KB.
 *
 * Mirrors the Topic Insight UX (`TopicResearchTab` → `TopicCard` grid), but
 * navigates within the same library route via the `?kb=` URL param rather
 * than a separate detail route — the existing WikiTab has all the per-KB
 * UI already; we only swap "auto-pick a KB" for "user-pick a KB".
 *
 * Reuses the platform `AssetCard` so card chrome (gradient header, badges,
 * stats, footer) stays visually consistent with Research / Writing /
 * Topic Insight cards.
 */

import { BookOpen, FileText, Plus } from 'lucide-react';
import { AssetCard } from '@/components/ui/cards/asset-card';
import { CardGrid } from '@/components/ui/cards/CardGrid';
import { useTranslation } from '@/lib/i18n';
import type { WikiKbSummary } from '@/lib/api/wiki';
import CreateKnowledgeBaseCard from '../knowledge-base/CreateKnowledgeBaseCard';

interface WikiCardGridProps {
  kbs: WikiKbSummary[];
  onOpen: (kbId: string) => void;
  onEnableMore: () => void;
  onEdit: (kbId: string) => void;
  onDisable: (kbId: string) => void;
}

export default function WikiCardGrid({
  kbs,
  onOpen,
  onEnableMore,
  onEdit,
  onDisable,
}: WikiCardGridProps) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {t('library.wiki.grid.title')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {t('library.wiki.grid.subtitle', { count: kbs.length })}
          </p>
        </div>
        <button
          onClick={onEnableMore}
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50"
        >
          <Plus className="h-4 w-4" />
          {t('library.wiki.grid.enableMore')}
        </button>
      </div>

      <CardGrid>
        {kbs.map((kb) => (
          <AssetCard
            key={kb.id}
            title={kb.name}
            description={kb.description ?? t('library.wiki.grid.noDescription')}
            icon={<BookOpen className="h-6 w-6 text-white" />}
            gradient="from-violet-500 to-purple-600"
            badges={[
              {
                key: 'type',
                label:
                  kb.type === 'TEAM'
                    ? t('library.wiki.enable.kbTypeTeam')
                    : t('library.wiki.enable.kbTypePersonal'),
                className:
                  kb.type === 'TEAM'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600',
              },
            ]}
            stats={[
              {
                key: 'pages',
                icon: <FileText className="h-3.5 w-3.5" />,
                text: t('library.wiki.kbSelector.pageCount', {
                  count: kb.pageCount,
                }),
              },
            ]}
            timestampLabel={t('library.wiki.grid.lastIngestLabel')}
            timestamp={kb.lastIngestAt ?? null}
            onClick={() => onOpen(kb.id)}
            isOwner
            onEdit={() => onEdit(kb.id)}
            onDelete={() => onDisable(kb.id)}
            labels={{
              edit: t('library.wiki.grid.actions.edit'),
              delete: t('library.wiki.grid.actions.disable'),
            }}
          />
        ))}
        {/* "+ 启用其他知识库" 放末位 —— 与各列表卡「新建卡置后」统一 */}
        <CreateKnowledgeBaseCard
          title={t('library.wiki.grid.enableMore')}
          description={t('library.wiki.grid.createCardDescription')}
          onClick={onEnableMore}
        />
      </CardGrid>
    </div>
  );
}
