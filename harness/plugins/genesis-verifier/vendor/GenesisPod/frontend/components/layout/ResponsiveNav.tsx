'use client';

import { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Rss,
  FileBarChart,
  Youtube,
  Scale,
  Newspaper,
  Plus,
  Filter,
  TrendingUp,
  Clock,
  Star,
  Link2,
  FileUp,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/i18n-context';

export type TabType =
  | 'papers'
  | 'blogs'
  | 'reports'
  | 'youtube'
  | 'policy'
  | 'news';
export type SortByType = 'trendingScore' | 'publishedAt' | 'qualityScore';
export type YouTubeLibraryTabType = 'genesis' | 'solar';
export type PaperLibraryTabType = 'recent' | 'github' | 'insights' | 'hot';

interface ResponsiveNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onImportUrlClick: () => void;
  onImportFileClick: () => void;
  onFilterClick: () => void;
  filterActive?: boolean;
  sortBy: SortByType;
  onSortChange: (sortBy: SortByType) => void;
  youtubeLibraryTab?: YouTubeLibraryTabType;
  onYouTubeLibraryTabChange?: (tab: YouTubeLibraryTabType) => void;
  paperLibraryTab?: PaperLibraryTabType;
  onPaperLibraryTabChange?: (tab: PaperLibraryTabType) => void;
  className?: string;
}

interface NavTab {
  id: TabType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: {
    active: string;
    inactive: string;
  };
}

const NAV_TABS: NavTab[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    icon: Youtube,
    color: {
      active: 'border-red-300 bg-red-50 text-red-600 shadow-sm',
      inactive:
        'border-gray-200 bg-white text-gray-600 hover:border-red-200 hover:bg-red-50/50 hover:text-red-600',
    },
  },
  {
    id: 'papers',
    label: 'Industry Trends',
    icon: FileText,
    color: {
      active: 'border-sky-300 bg-sky-50 text-sky-600 shadow-sm',
      inactive:
        'border-gray-200 bg-white text-gray-600 hover:border-sky-200 hover:bg-sky-50/50 hover:text-sky-600',
    },
  },
  {
    id: 'blogs',
    label: 'Blogs',
    icon: Rss,
    color: {
      active: 'border-violet-300 bg-violet-50 text-violet-600 shadow-sm',
      inactive:
        'border-gray-200 bg-white text-gray-600 hover:border-violet-200 hover:bg-violet-50/50 hover:text-violet-600',
    },
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileBarChart,
    color: {
      active: 'border-amber-300 bg-amber-50 text-amber-600 shadow-sm',
      inactive:
        'border-gray-200 bg-white text-gray-600 hover:border-amber-200 hover:bg-amber-50/50 hover:text-amber-600',
    },
  },
  {
    id: 'policy',
    label: 'Policy',
    icon: Scale,
    color: {
      active: 'border-indigo-300 bg-indigo-50 text-indigo-600 shadow-sm',
      inactive:
        'border-gray-200 bg-white text-gray-600 hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-600',
    },
  },
  {
    id: 'news',
    label: 'News',
    icon: Newspaper,
    color: {
      active: 'border-emerald-300 bg-emerald-50 text-emerald-600 shadow-sm',
      inactive:
        'border-gray-200 bg-white text-gray-600 hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-600',
    },
  },
];

/**
 * ResponsiveNav - Responsive navigation component
 *
 * Features:
 * - Always shows all 5 tabs (Papers, Blogs, Reports, YouTube, News)
 * - Icon-only action buttons (Import, Filter) on the right
 * - Horizontal scrolling on small screens
 * - Responsive text sizing
 */
export default function ResponsiveNav({
  activeTab,
  onTabChange,
  onImportUrlClick,
  onImportFileClick,
  onFilterClick,
  filterActive,
  sortBy,
  onSortChange,
  youtubeLibraryTab = 'genesis',
  onYouTubeLibraryTabChange,
  paperLibraryTab = 'recent',
  onPaperLibraryTabChange,
  className = '',
}: ResponsiveNavProps) {
  const { t } = useI18n();
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Tab label mapping for i18n
  const tabLabels: Record<TabType, string> = {
    youtube: t('explore.tabs.youtube'),
    papers: t('explore.tabs.papers'),
    blogs: t('explore.tabs.blogs'),
    reports: t('explore.tabs.reports'),
    policy: t('explore.tabs.policy'),
    news: t('explore.tabs.news'),
  };

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        importMenuRef.current &&
        !importMenuRef.current.contains(event.target as Node)
      ) {
        setShowImportMenu(false);
      }
      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(event.target as Node)
      ) {
        setShowSortMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const youtubeSubTabClass = (tab: YouTubeLibraryTabType) =>
    `whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm ${
      youtubeLibraryTab === tab
        ? 'bg-gray-900 text-white shadow-sm'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  const paperSubTabClass = (tab: PaperLibraryTabType) =>
    `whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm ${
      paperLibraryTab === tab
        ? 'bg-gray-900 text-white shadow-sm'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        {/* Main Tabs - Always visible, horizontal scroll on small screens */}
        <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1">
          {NAV_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  flex flex-shrink-0 items-center gap-1.5
                  whitespace-nowrap rounded-lg border px-2
                  py-1.5 text-xs font-medium
                  shadow-sm transition-all duration-200
                  sm:gap-2 sm:px-3
                  sm:py-2 sm:text-sm
                  md:px-4 md:py-2.5
                  ${isActive ? tab.color.active : tab.color.inactive}
                `}
              >
                <Icon className="h-3 w-3 flex-shrink-0 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">{tabLabels[tab.id]}</span>
              </button>
            );
          })}
        </div>

        {/* Action Buttons - Icon only */}
        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
          {/* Import Button - Icon only with dropdown */}
          <div className="relative" ref={importMenuRef}>
            <button
              onClick={() => setShowImportMenu(!showImportMenu)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-50 sm:h-10 sm:w-10"
              title={t('explore.import.title')}
              aria-label="Import"
            >
              <Plus className="h-4 w-4 flex-shrink-0" />
            </button>

            {/* Import Dropdown Menu */}
            {showImportMenu && (
              <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-lg border border-gray-200 bg-white shadow-lg">
                <div className="p-1">
                  <button
                    onClick={() => {
                      onImportUrlClick();
                      setShowImportMenu(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-blue-50"
                  >
                    <Link2 className="h-4 w-4 text-blue-600" />
                    <div className="text-left">
                      <p className="font-medium text-gray-900">
                        {t('explore.import.fromUrl')}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t('explore.import.fromUrlDesc')}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      onImportFileClick();
                      setShowImportMenu(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-green-50"
                  >
                    <FileUp className="h-4 w-4 text-green-600" />
                    <div className="text-left">
                      <p className="font-medium text-gray-900">
                        {t('explore.import.uploadFile')}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t('explore.import.uploadFileDesc')}
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Filter Button - Icon only with active indicator */}
          <button
            onClick={onFilterClick}
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors sm:h-10 sm:w-10 ${
              filterActive
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={t('explore.filters.advanced')}
            aria-label="Filter"
          >
            <Filter className="h-4 w-4 flex-shrink-0" />
            {filterActive && (
              <span className="absolute -right-1 -top-1 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
              </span>
            )}
          </button>

          {/* Sort Button - Icon only with dropdown */}
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 transition-colors hover:bg-gray-50 sm:h-10 sm:w-10"
              title={
                sortBy === 'trendingScore'
                  ? t('explore.sort.trending')
                  : sortBy === 'publishedAt'
                    ? t('explore.sort.latest')
                    : t('explore.sort.quality')
              }
              aria-label="Sort"
            >
              {sortBy === 'trendingScore' && (
                <TrendingUp className="h-4 w-4 flex-shrink-0" />
              )}
              {sortBy === 'publishedAt' && (
                <Clock className="h-4 w-4 flex-shrink-0" />
              )}
              {sortBy === 'qualityScore' && (
                <Star className="h-4 w-4 flex-shrink-0" />
              )}
            </button>

            {/* Sort Dropdown Menu */}
            {showSortMenu && (
              <div className="absolute right-0 top-full z-50 mt-2 w-36 rounded-lg border border-gray-200 bg-white shadow-lg">
                <div className="p-1">
                  <button
                    onClick={() => {
                      onSortChange('trendingScore');
                      setShowSortMenu(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      sortBy === 'trendingScore'
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <TrendingUp className="h-4 w-4" />
                    <span>{t('explore.sort.trending')}</span>
                  </button>
                  <button
                    onClick={() => {
                      onSortChange('publishedAt');
                      setShowSortMenu(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      sortBy === 'publishedAt'
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Clock className="h-4 w-4" />
                    <span>{t('explore.sort.latest')}</span>
                  </button>
                  <button
                    onClick={() => {
                      onSortChange('qualityScore');
                      setShowSortMenu(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      sortBy === 'qualityScore'
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Star className="h-4 w-4" />
                    <span>{t('explore.sort.quality')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {activeTab === 'youtube' && onYouTubeLibraryTabChange && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
            <button
              type="button"
              className={youtubeSubTabClass('genesis')}
              onClick={() => onYouTubeLibraryTabChange('genesis')}
            >
              GenesisPod YouTube
            </button>
            <button
              type="button"
              className={youtubeSubTabClass('solar')}
              onClick={() => onYouTubeLibraryTabChange('solar')}
            >
              Solar-harness 洞察
            </button>
          </div>
        </div>
      )}

      {activeTab === 'papers' && onPaperLibraryTabChange && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
            <button
              type="button"
              className={paperSubTabClass('recent')}
              onClick={() => onPaperLibraryTabChange('recent')}
            >
              最近趋势
            </button>
            <button
              type="button"
              className={paperSubTabClass('github')}
              onClick={() => onPaperLibraryTabChange('github')}
            >
              GitHub 趋势
            </button>
            <button
              type="button"
              className={paperSubTabClass('insights')}
              onClick={() => onPaperLibraryTabChange('insights')}
            >
              HF 洞察报告
            </button>
            <button
              type="button"
              className={paperSubTabClass('hot')}
              onClick={() => onPaperLibraryTabChange('hot')}
            >
              热门论文
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {paperLibraryTab === 'recent'
              ? '最近同步数据里的 HuggingFace / arXiv 热点趋势'
              : paperLibraryTab === 'github'
                ? 'Solar GitHub 数据里的开源社区技术趋势'
              : paperLibraryTab === 'insights'
                ? 'AI Influence 的 HuggingFace 论文洞察报告'
                : 'HuggingFace / arXiv 当前热门论文'}
          </p>
        </div>
      )}
    </div>
  );
}
