'use client';

import { useState, useMemo } from 'react';
import { useTranslation } from '@/lib/i18n';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  TrendingUp,
  RefreshCw,
  ExternalLink,
  Star,
  Download,
  Calendar,
  Loader2,
  Target,
  Wrench,
  Code,
  FlaskConical,
  BookOpen,
  Database,
  Rocket,
  Lock,
  Bot,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { StatCard } from '@/components/ui/cards';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  useAISkills,
  type TimelineDataPoint,
} from '@/hooks/domain/useSkillsMP';

// Categories with icons
const categories = [
  {
    id: 'all',
    color: 'bg-gray-100',
    activeColor: 'from-violet-500 to-purple-600',
  },
  {
    id: 'tools',
    color: 'bg-blue-50',
    activeColor: 'from-blue-500 to-blue-600',
  },
  {
    id: 'development',
    color: 'bg-green-50',
    activeColor: 'from-green-500 to-green-600',
  },
  {
    id: 'testing',
    color: 'bg-purple-50',
    activeColor: 'from-purple-500 to-purple-600',
  },
  {
    id: 'documentation',
    color: 'bg-amber-50',
    activeColor: 'from-amber-500 to-amber-600',
  },
  {
    id: 'database',
    color: 'bg-cyan-50',
    activeColor: 'from-cyan-500 to-cyan-600',
  },
  {
    id: 'devops',
    color: 'bg-orange-50',
    activeColor: 'from-orange-500 to-orange-600',
  },
  {
    id: 'security',
    color: 'bg-red-50',
    activeColor: 'from-red-500 to-red-600',
  },
  {
    id: 'ai-agents',
    color: 'bg-indigo-50',
    activeColor: 'from-indigo-500 to-indigo-600',
  },
];

// Category icon mapping
const categoryIcons: Record<string, LucideIcon> = {
  all: Target,
  tools: Wrench,
  development: Code,
  testing: FlaskConical,
  documentation: BookOpen,
  database: Database,
  devops: Rocket,
  security: Lock,
  'ai-agents': Bot,
};

function SkillCategoryIcon({
  categoryId,
  className,
}: {
  categoryId: string;
  className?: string;
}) {
  const Icon = categoryIcons[categoryId] || Package;
  return <Icon className={className} />;
}

// Default timeline data for when API returns empty
const defaultTimelineData: TimelineDataPoint[] = (() => {
  const data: TimelineDataPoint[] = [];
  let cumulative = 0;
  const baseDate = new Date('2024-11-01');
  const counts = [
    2500, 3200, 4100, 5800, 7200, 9500, 12000, 18000, 28000, 38000, 45000,
    52000,
  ];

  for (let i = 0; i < counts.length; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i * 7);
    const count = counts[i];
    cumulative += count;
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    data.push({
      date: `${month}-${day}`,
      count,
      cumulative,
    });
  }
  return data;
})();

// Chart type options
type ChartType = 'area' | 'bar';

// Custom Tooltip component
interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-sm text-violet-600">
          {payload[0].value.toLocaleString()} skills
        </p>
      </div>
    );
  }
  return null;
}

export default function AISkillsTab() {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'stars' | 'downloads' | 'name'>('stars');
  const [chartType, setChartType] = useState<ChartType>('area');
  const [showCumulative, setShowCumulative] = useState(false);

  // Fetch data from API
  const {
    stats,
    timeline,
    skills,
    featuredSkills,
    isLoading,
    isSyncing,
    sync,
  } = useAISkills({
    query: searchQuery,
    category: selectedCategory,
    sortBy,
    limit: 100,
  });

  // Use default timeline if API returns empty
  const chartData = timeline.length > 0 ? timeline : defaultTimelineData;

  // Filter skills locally for immediate response
  const filteredSkills = useMemo(() => {
    let result = skills;

    // Additional local filtering if needed
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (skill) =>
          skill.name?.toLowerCase().includes(q) ||
          skill.description?.toLowerCase().includes(q) ||
          skill.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    if (selectedCategory !== 'all') {
      result = result.filter((skill) => skill.category === selectedCategory);
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'stars') return (b.stars || 0) - (a.stars || 0);
      if (sortBy === 'downloads') {
        const parseDownloads = (d?: string) => {
          if (!d) return 0;
          return (
            parseFloat(d.replace(/[^0-9.]/g, '')) *
            (d.includes('M') ? 1000000 : d.includes('K') ? 1000 : 1)
          );
        };
        return parseDownloads(b.downloads) - parseDownloads(a.downloads);
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    return result;
  }, [skills, searchQuery, selectedCategory, sortBy]);

  const formatStars = (stars: number) => {
    if (stars >= 1000000) return `${(stars / 1000000).toFixed(1)}M`;
    if (stars >= 1000) return `${(stars / 1000).toFixed(1)}K`;
    return stars.toString();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Chart data key based on cumulative toggle
  const chartDataKey = showCumulative ? 'cumulative' : 'count';

  const handleSync = async () => {
    await sync();
  };

  return (
    <div className="px-8 py-6">
      {/* Search Bar */}
      <div className="mb-6 flex gap-4">
        <div className="relative flex-1">
          <svg
            className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
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
          <input
            type="text"
            placeholder={t('aiSkills.search.placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) =>
            setSortBy(e.target.value as 'stars' | 'downloads' | 'name')
          }
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition-all focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
        >
          <option value="stars">{t('aiSkills.sort.byStars')}</option>
          <option value="downloads">{t('aiSkills.sort.byDownloads')}</option>
          <option value="name">{t('aiSkills.sort.byName')}</option>
        </select>
      </div>

      {/* Stats Cards */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Total Skills Card */}
        <StatCard
          label="Total Skills"
          value={
            isLoading ? (
              <span className="text-gray-300">--</span>
            ) : (
              (stats?.totalSkills ?? 66541).toLocaleString()
            )
          }
          icon={<Star className="h-5 w-5" />}
          tone="violet"
          trend={{
            direction: 'up',
            value: `+${stats?.weeklyGrowth ?? 12.5}% this week`,
          }}
        />

        {/* Sync Status Card */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">
                {t('aiSkills.lastSync')}
              </p>
              <p className="mt-1 text-lg font-semibold text-gray-900">
                {formatDate(stats?.lastUpdated ?? null)}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100">
              <Calendar className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <button
            onClick={() => void handleSync()}
            disabled={isSyncing}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50"
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>

        {/* Featured Skills Card */}
        <StatCard
          label={t('aiSkills.featured')}
          value={
            isLoading ? (
              <span className="text-gray-300">--</span>
            ) : (
              (stats?.featuredCount ?? featuredSkills.length)
            )
          }
          hint="Curated skills for your workflow"
          icon={<Download className="h-5 w-5" />}
          tone="amber"
        />
      </div>

      {/* Trend Chart */}
      <div className="mb-8 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Skills Timeline
            </h3>
            <p className="text-sm text-gray-500">
              Based on skill last push time
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Cumulative Toggle */}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={showCumulative}
                onChange={(e) => setShowCumulative(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
              />
              <span className="text-sm text-gray-600">Cumulative</span>
            </label>
            {/* Chart Type Toggle */}
            <div className="flex rounded-lg border border-gray-200 p-1">
              <button
                onClick={() => setChartType('area')}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  chartType === 'area'
                    ? 'bg-violet-100 text-violet-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Area
              </button>
              <button
                onClick={() => setChartType('bar')}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  chartType === 'bar'
                    ? 'bg-violet-100 text-violet-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Bar
              </button>
            </div>
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'area' ? (
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorSkills" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  stroke="#9ca3af"
                  fontSize={12}
                  tickLine={false}
                />
                <YAxis
                  stroke="#9ca3af"
                  fontSize={12}
                  tickLine={false}
                  tickFormatter={(value) =>
                    value >= 1000 ? `${(value / 1000).toFixed(0)}K` : value
                  }
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey={chartDataKey}
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorSkills)"
                />
              </AreaChart>
            ) : (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  stroke="#9ca3af"
                  fontSize={12}
                  tickLine={false}
                />
                <YAxis
                  stroke="#9ca3af"
                  fontSize={12}
                  tickLine={false}
                  tickFormatter={(value) =>
                    value >= 1000 ? `${(value / 1000).toFixed(0)}K` : value
                  }
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey={chartDataKey}
                  fill="#8b5cf6"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Categories */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                selectedCategory === category.id
                  ? `bg-gradient-to-r ${category.activeColor} text-white shadow-md`
                  : `${category.color} text-gray-700 hover:shadow-sm`
              }`}
            >
              <SkillCategoryIcon categoryId={category.id} className="h-4 w-4" />
              <span>{t(`aiSkills.categories.${category.id}`)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
          <span className="ml-3 text-gray-500">Loading skills...</span>
        </div>
      )}

      {/* Featured Section */}
      {!isLoading &&
        selectedCategory === 'all' &&
        !searchQuery &&
        featuredSkills.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Star className="h-5 w-5 text-amber-500" />
              {t('aiSkills.featured')}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {featuredSkills.slice(0, 6).map((skill) => (
                <a
                  key={skill.id}
                  href={skill.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-violet-200 hover:shadow-lg"
                >
                  <div className="absolute right-3 top-3">
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                      {t('aiSkills.featuredBadge')}
                    </span>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-50 to-purple-100">
                      <SkillCategoryIcon
                        categoryId={skill.category}
                        className="h-6 w-6 text-violet-600"
                      />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 group-hover:text-violet-600">
                        {skill.name}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                        {skill.description}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Star
                          className="h-3.5 w-3.5 text-amber-400"
                          fill="currentColor"
                        />
                        {formatStars(skill.stars)}
                      </span>
                      <span className="text-gray-400">by {skill.author}</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

      {/* Skills Grid */}
      {!isLoading && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {t(`aiSkills.categories.${selectedCategory}`)}
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({filteredSkills.length} {t('aiSkills.skills')})
              </span>
            </h2>
          </div>

          {filteredSkills.length === 0 ? (
            <EmptyState
              type="search"
              title={t('aiSkills.empty.title')}
              description={t('aiSkills.empty.description')}
              action={
                <button
                  onClick={() => void handleSync()}
                  disabled={isSyncing}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                >
                  {isSyncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {isSyncing ? 'Syncing...' : 'Sync from SkillsMP'}
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredSkills.map((skill) => (
                <a
                  key={skill.id}
                  href={skill.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-violet-50 to-purple-100">
                      <SkillCategoryIcon
                        categoryId={skill.category}
                        className="h-5 w-5 text-violet-600"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-medium text-gray-900 group-hover:text-violet-600">
                        {skill.name}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="flex items-center gap-0.5">
                          <Star
                            className="h-3.5 w-3.5 text-amber-400"
                            fill="currentColor"
                          />
                          {formatStars(skill.stars)}
                        </span>
                        <span className="text-gray-300">|</span>
                        <span>{skill.author}</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-gray-500">
                    {skill.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {skill.tags?.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-gray-50 pt-3">
                    {skill.downloads && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        {skill.downloads} downloads
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-400 group-hover:text-violet-500">
                      {t('aiSkills.view')} →
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {/* SkillsMP Attribution */}
      <section className="mt-12 overflow-hidden rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 p-8 text-center text-white">
        <h2 className="text-xl font-bold">{t('aiSkills.attribution.title')}</h2>
        <p className="mt-2 text-violet-100">
          {t('aiSkills.attribution.description')}
        </p>
        <a
          href="https://skillsmp.com"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-violet-600 transition-all hover:bg-violet-50 hover:shadow-lg"
        >
          <ExternalLink className="h-4 w-4" />
          {t('aiSkills.attribution.button')}
        </a>
      </section>
    </div>
  );
}
