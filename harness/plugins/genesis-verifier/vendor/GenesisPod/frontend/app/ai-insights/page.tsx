'use client';

/**
 * AI Insights - 专题洞察页面 (原 AI Research 主页面)
 * Topic monitoring / intelligence dashboard
 */

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import {
  TopicResearchTab,
  CreateTopicDialog as TopicCreateDialog,
} from '@/components/ai-insights';
import { ResearchTopicType } from '@/lib/types/topic-insights';
import { SkillsModal } from '@/components/common/skills/SkillsModal';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { Sparkles } from 'lucide-react';

// ==================== 图标组件 ====================
const SearchIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

const LoaderIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 4v16m8-8H4"
    />
  </svg>
);

// ==================== 主页面内容 ====================
function InsightsPageContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [topicActiveType, setTopicActiveType] =
    useState<ResearchTopicType | null>(null);
  const [showTopicCreateDialog, setShowTopicCreateDialog] = useState(false);
  const [initialCreateName, setInitialCreateName] = useState('');
  const [showSkillsModal, setShowSkillsModal] = useState(false);

  // Auto-open create dialog when navigated from AI Ask ActionCard with ?q= param
  useEffect(() => {
    const q = searchParams?.get('q');
    if (q) {
      setInitialCreateName(decodeURIComponent(q));
      setShowTopicCreateDialog(true);
    }
  }, [searchParams]);

  return (
    <div className="h-full overflow-auto bg-gray-50">
      {/* Header — 走公共 PageHeaderHero */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/50 backdrop-blur-sm">
        <PageHeaderHero
          title={t('aiInsights.title')}
          subtitle={t('aiInsights.subtitle')}
          icon={
            <svg
              className="h-7 w-7 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
          }
          actions={
            <>
              <button
                onClick={() => setShowSkillsModal(true)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                title={t('aiInsights.skills.title') || 'Research Skills'}
              >
                <Sparkles className="h-4 w-4 text-violet-500" />
              </button>
              <button
                onClick={() => setShowTopicCreateDialog(true)}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30"
              >
                <PlusIcon className="h-5 w-5" />
                {t('aiInsights.actions.createNew')}
              </button>
            </>
          }
        >
          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('aiInsights.search.placeholder')}
              className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
            />
          </div>
        </PageHeaderHero>
      </div>

      {/* Topic Research Content */}
      <div className="px-8 py-6">
        <TopicResearchTab
          activeType={topicActiveType}
          searchQuery={searchQuery}
          showCreateDialog={showTopicCreateDialog}
          onShowCreateDialog={setShowTopicCreateDialog}
          initialCreateName={initialCreateName}
        />
      </div>

      {/* Skills Modal */}
      <SkillsModal
        open={showSkillsModal}
        onClose={() => setShowSkillsModal(false)}
        domain="research"
        title={t('aiInsights.skills.title') || 'Research Skills'}
      />
    </div>
  );
}

// ==================== 主页面 ====================
export default function InsightsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-gray-50">
          <LoaderIcon className="h-8 w-8 animate-spin text-violet-600" />
        </div>
      }
    >
      <InsightsPageContent />
    </Suspense>
  );
}
