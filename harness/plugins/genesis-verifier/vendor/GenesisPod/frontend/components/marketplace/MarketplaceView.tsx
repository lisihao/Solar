'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Store,
  ArrowUpRight,
  Plus,
  Search,
  Users,
  Workflow,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { LoadingState } from '@/components/ui/states/LoadingState';
import { ErrorState } from '@/components/ui/states/ErrorState';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { AssetCard } from '@/components/ui/cards/asset-card/AssetCard';
import { cn } from '@/lib/utils/common';
import { toast } from '@/stores';
import { useCompanyStore } from '@/stores/company/companyStore';
import { useMarketplaceCatalog } from '@/hooks/features/useMarketplaceCatalog';
import type { WorkflowListing } from './marketplace.types';
import { KIND_META, RatingMeta } from './listing-shared';
import { HeroSkillToolDrawer } from '@/components/me/hero/HeroSkillToolDrawer';

/**
 * 专家市场 —— 每个工作流 listing 即一名「专家」（自带打法 + 阵型）。
 * 当前仅展示专家货架，Agent/技能/工具/团队货架暂不渲染。
 */
export function MarketplaceView() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { catalog, loading, error, refresh } = useMarketplaceCatalog();
  const { adoptHero } = useCompanyStore();

  // 专家 = 有 capability runner 绑定（missionType）的工作流；其余仅是无法真跑的
  // 工作流模板（PPT/辩论/写作团队等），不作为专家上架。按 missionType 去重，
  // 同一能力只出一名专家。
  const heroes = useMemo(() => {
    const seen = new Set<string>();
    return catalog.workflow.filter((w) => {
      if (!w.missionType || seen.has(w.missionType)) return false;
      seen.add(w.missionType);
      return true;
    });
  }, [catalog.workflow]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return heroes;
    return heroes.filter(
      (h) =>
        h.name.toLowerCase().includes(term) ||
        h.tagline.toLowerCase().includes(term) ||
        h.tags.some((t) => t.toLowerCase().includes(term))
    );
  }, [heroes, search]);

  const adopt = (hero: WorkflowListing) => {
    const capabilityId = hero.missionType ?? hero.id;
    void adoptHero(capabilityId).then((heroId) => {
      if (heroId) {
        toast.success(`已录用「${hero.name}」，进入我的专家团`);
        router.push('/agents');
      }
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50/50">
      <PageHeaderHero
        module="market"
        icon={<Store className="h-7 w-7 text-white" />}
        title="专家市场"
        subtitle="每位专家自带打法与阵型 —— 一键录用，带回「我的专家团」直接派单"
        actions={
          <Link
            href="/agents"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            我的专家团
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-7xl px-8 pb-12">
        {loading ? (
          <LoadingState text="加载专家市场中..." />
        ) : error ? (
          <ErrorState error={error} title="加载市场失败" onRetry={refresh} />
        ) : (
          <div className="space-y-4 pt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索专家、打法、标签…"
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                type={search ? 'search' : 'noData'}
                title={search ? '没有匹配的专家' : '专家市场暂未上新'}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((hero) => (
                  <HeroCard
                    key={hero.id}
                    hero={hero}
                    onAdopt={() => adopt(hero)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 专家卡：基于 canonical AssetCard。
 * customSection 承载「自带打法」（阶段 chips）+ 角色阵型预览；
 * footerExtra 承载评分 + 「录用」CTA。
 */
function HeroCard({
  hero,
  onAdopt,
}: {
  hero: WorkflowListing;
  onAdopt: () => void;
}) {
  const meta = KIND_META.workflow;
  const Icon = meta.Icon;
  const [drawerFocus, setDrawerFocus] = useState<
    null | 'skills' | 'tools' | 'workflow'
  >(null);

  return (
    <>
      <AssetCard
        title={hero.name}
        description={hero.description}
        icon={<Icon className="h-6 w-6 text-white" />}
        gradient={meta.gradient}
        badges={[
          {
            key: 'hero',
            label: '专家',
            className: cn(meta.soft, meta.text),
          },
        ]}
        stats={[
          {
            key: 'team-size',
            icon: <Users className="h-3.5 w-3.5" />,
            text: `${hero.teamSize} 人阵型`,
          },
        ]}
        customSection={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-medium">
            {hero.stages.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerFocus('workflow');
                }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Workflow className="h-3.5 w-3.5" />
                {hero.stages.length} 步工作流
              </button>
            )}
            {(hero.skillIds?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerFocus('skills');
                }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {hero.skillIds?.length ?? 0} 技能
              </button>
            )}
            {(hero.toolIds?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerFocus('tools');
                }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Wrench className="h-3.5 w-3.5" />
                {hero.toolIds?.length ?? 0} 工具
              </button>
            )}
          </div>
        }
        footerExtra={
          <div className="flex items-center gap-3">
            <RatingMeta rating={hero.rating} installs={hero.installs} />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAdopt();
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              录用
            </button>
          </div>
        }
      />
      <HeroSkillToolDrawer
        open={drawerFocus !== null}
        onClose={() => setDrawerFocus(null)}
        expertName={hero.name}
        focus={drawerFocus ?? 'all'}
        skillIds={hero.skillIds ?? []}
        toolIds={hero.toolIds ?? []}
        stages={hero.stages}
      />
    </>
  );
}
