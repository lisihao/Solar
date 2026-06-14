'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Compass,
  Database,
  Plus,
  Pause,
  Play,
  Activity,
  AlertCircle,
  Settings,
  X,
  Save,
  Zap,
  ChevronDown,
  ChevronRight,
  FileText,
  Newspaper,
  BookOpen,
  Github,
  Video,
  Rss,
  Calendar,
  CheckCircle,
  ExternalLink,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  getDataSources,
  updateDataSource,
  createCollectionTask,
  executeTask,
  createDataSource,
  getCollectionTask,
  fixRssUrls,
  DataSource,
  CollectionTask,
} from '@/services/data-collection/api';
import BatchCollectionDrawer from '@/components/admin/data-collection/BatchCollectionDrawer';
import SchedulerPanel from '@/components/admin/data-collection/SchedulerPanel';
import { Modal } from '@/components/ui';

import { logger } from '@/lib/utils/logger';
import { toast } from '@/stores';
// Extended type for edit form with schedule fields
interface EditFormData extends Partial<DataSource> {
  scheduleFrequency?: string;
  scheduleTime?: string;
}

interface RunNowConfig {
  keywords?: string;
  dateFrom?: string;
  dateTo?: string;
  maxResults?: number;
  category?: string;
  language?: string;
}

// Category configuration with color mapping - ALIGNED WITH EXPLORE TABS
const CATEGORY_COLORS = {
  PAPER: { bg: 'bg-blue-100', text: 'text-blue-600', icon: 'text-blue-600' },
  BLOG: {
    bg: 'bg-purple-100',
    text: 'text-purple-600',
    icon: 'text-purple-600',
  },
  REPORT: {
    bg: 'bg-green-100',
    text: 'text-green-600',
    icon: 'text-green-600',
  },
  YOUTUBE_VIDEO: {
    bg: 'bg-red-100',
    text: 'text-red-600',
    icon: 'text-red-600',
  },
  POLICY: {
    bg: 'bg-indigo-100',
    text: 'text-indigo-600',
    icon: 'text-indigo-600',
  },
  NEWS: {
    bg: 'bg-orange-100',
    text: 'text-orange-600',
    icon: 'text-orange-600',
  },
} as const;

const CATEGORIES = [
  {
    id: 'PAPER' as const,
    name: 'Papers',
    icon: BookOpen,
    description: 'Academic papers',
  },
  {
    id: 'BLOG' as const,
    name: 'Blogs',
    icon: FileText,
    description: 'Company blogs',
  },
  {
    id: 'REPORT' as const,
    name: 'Reports',
    icon: FileText,
    description: 'Research reports',
  },
  {
    id: 'YOUTUBE_VIDEO' as const,
    name: 'YouTube',
    icon: Video,
    description: 'Video tutorials',
  },
  {
    id: 'POLICY' as const,
    name: 'Policy',
    icon: FileText,
    description: 'US tech policy',
  },
  {
    id: 'NEWS' as const,
    name: 'News',
    icon: Newspaper,
    description: 'Industry news',
  },
] as const;

// Predefined source templates - VERIFIED RSS FEEDS ONLY
const SOURCE_TEMPLATES: Record<
  string,
  Array<{ name: string; url: string; type: string }>
> = {
  PAPER: [
    {
      name: 'arXiv cs.AI',
      url: 'https://rss.arxiv.org/rss/cs.AI',
      type: 'ARXIV',
    },
    {
      name: 'arXiv cs.LG',
      url: 'https://rss.arxiv.org/rss/cs.LG',
      type: 'ARXIV',
    },
    {
      name: 'arXiv cs.CL',
      url: 'https://rss.arxiv.org/rss/cs.CL',
      type: 'ARXIV',
    },
  ],
  BLOG: [
    // 已验证有效的RSS源
    {
      name: 'NVIDIA Technical Blog',
      url: 'https://developer.nvidia.com/blog/feed',
      type: 'RSS',
    },
    {
      name: 'Google AI Blog',
      url: 'https://ai.googleblog.com/feeds/posts/default',
      type: 'RSS',
    },
    {
      name: 'OpenAI Blog',
      url: 'https://openai.com/blog/rss/',
      type: 'RSS',
    },
    {
      name: 'Hugging Face Blog',
      url: 'https://huggingface.co/blog/feed.xml',
      type: 'RSS',
    },
    {
      name: 'Weights & Biases',
      url: 'https://wandb.ai/fully-connected/rss.xml',
      type: 'RSS',
    },
    {
      name: 'One Useful Thing',
      url: 'https://www.oneusefulthing.org/feed',
      type: 'RSS',
    },
  ],
  REPORT: [
    {
      name: 'SemiAnalysis',
      url: 'https://semianalysis.substack.com/feed',
      type: 'RSS',
    },
    {
      name: 'Epoch AI Research',
      url: 'https://epochai.substack.com/feed',
      type: 'RSS',
    },
  ],
  YOUTUBE_VIDEO: [
    {
      name: 'Y Combinator',
      url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCcefcZRL2oaA_uBNeo5UOWg',
      type: 'YOUTUBE',
    },
    {
      name: 'BG2Pod',
      url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC-yRDvpR99LUc5l7i7jLzew',
      type: 'YOUTUBE',
    },
    {
      name: 'Bloomberg Technology',
      url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCrM7B7SL_g1edFOnmj-SDKg',
      type: 'YOUTUBE',
    },
    {
      name: 'Valley 101',
      url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UChnNjLyx_5rk_iDPQ2BQDQA',
      type: 'YOUTUBE',
    },
  ],
  POLICY: [
    {
      name: 'AI Now Institute',
      url: 'https://ainowinstitute.org/category/news/feed',
      type: 'RSS',
    },
    {
      name: 'EU AI Act Newsletter',
      url: 'https://artificialintelligenceact.substack.com/feed',
      type: 'RSS',
    },
  ],
  NEWS: [
    {
      name: 'Ars Technica',
      url: 'https://feeds.arstechnica.com/arstechnica/index',
      type: 'RSS',
    },
    {
      name: 'Hacker News',
      url: 'https://news.ycombinator.com/rss',
      type: 'RSS',
    },
    {
      name: '404 Media',
      url: 'https://www.404media.co/rss',
      type: 'RSS',
    },
  ],
};

export default function ConfigPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [editForm, setEditForm] = useState<EditFormData>({});
  const [runNowSource, setRunNowSource] = useState<DataSource | null>(null);
  const [runNowConfig, setRunNowConfig] = useState<RunNowConfig>({
    maxResults: 10,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [showSourcesModal, setShowSourcesModal] = useState<string | null>(null);
  const [showAddSourceModal, setShowAddSourceModal] = useState<string | null>(
    null
  );
  const [newSourceForm, setNewSourceForm] = useState({
    name: '',
    description: '',
    baseUrl: '',
    apiEndpoint: '',
    type: 'RSS',
    template: '',
    scheduleFrequency: 'daily', // manual | hourly | daily | weekly
    scheduleTime: '06:00', // HH:mm format for daily/weekly
    minDurationMinutes: 15, // YouTube视频最小时长（分钟），默认15分钟
  });
  const [runningTasks, setRunningTasks] = useState<Map<string, CollectionTask>>(
    new Map()
  );
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showBatchDrawer, setShowBatchDrawer] = useState(false);
  const [batchCategory, setBatchCategory] = useState<
    (typeof CATEGORIES)[number] | null
  >(null);
  const [isFixingRss, setIsFixingRss] = useState(false);
  const [fixRssResult, setFixRssResult] = useState<{
    fixed: string[];
    failed: string[];
    skipped: string[];
  } | null>(null);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    async function fetchSources() {
      try {
        setLoading(true);
        const response = await getDataSources();
        setSources(response.data);
      } catch (err) {
        logger.error('Failed to fetch sources:', err);
        setError(err instanceof Error ? err.message : 'Failed to load sources');
      } finally {
        setLoading(false);
      }
    }

    fetchSources();
  }, []);

  // Poll running tasks for status updates
  useEffect(() => {
    if (runningTasks.size === 0) return;

    const interval = setInterval(async () => {
      const updatedTasks = new Map(runningTasks);
      let hasChanges = false;

      for (const [taskId, task] of runningTasks.entries()) {
        if (task.status === 'RUNNING' || task.status === 'PENDING') {
          try {
            const task = await getCollectionTask(taskId);
            updatedTasks.set(taskId, task);
            hasChanges = true;

            // Remove completed/failed tasks after 5 seconds
            if (task.status === 'COMPLETED' || task.status === 'FAILED') {
              setTimeout(() => {
                setRunningTasks((prev) => {
                  const next = new Map(prev);
                  next.delete(taskId);
                  return next;
                });
              }, 5000);
            }
          } catch (err) {
            logger.error(`Failed to fetch task ${taskId}:`, err);
          }
        }
      }

      if (hasChanges) {
        setRunningTasks(updatedTasks);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [runningTasks]);

  const formatRelativeTime = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Group sources by category
  const groupedSources = CATEGORIES.map((category) => ({
    ...category,
    sources: sources.filter((source) => source.category === category.id),
  }));

  const handleToggleStatus = async (source: DataSource) => {
    try {
      const newStatus = source.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      await updateDataSource(source.id, { status: newStatus });
      setSources((prev) =>
        prev.map((s) => (s.id === source.id ? { ...s, status: newStatus } : s))
      );
    } catch (err) {
      logger.error('Failed to toggle source status:', err);
      toast.error('Failed to update source status');
    }
  };

  const handleEdit = (source: DataSource) => {
    setEditingSource(source);
    // Extract schedule from crawlerConfig if it exists
    const crawlerConfig = source.crawlerConfig as Record<
      string,
      unknown
    > | null;
    const schedule = crawlerConfig?.schedule as {
      frequency?: string;
      time?: string;
      enabled?: boolean;
    } | null;

    setEditForm({
      name: source.name,
      description: source.description,
      baseUrl: source.baseUrl,
      apiEndpoint: source.apiEndpoint,
      keywords: source.keywords,
      categories: source.categories,
      languages: source.languages,
      minQualityScore: source.minQualityScore,
      crawlerConfig: crawlerConfig || {},
      scheduleFrequency: schedule?.frequency || 'manual',
      scheduleTime: schedule?.time || '06:00',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingSource) return;

    try {
      // Build updated crawler config with schedule
      const existingConfig =
        (editForm.crawlerConfig as Record<string, unknown>) || {};
      const updatedCrawlerConfig = {
        ...existingConfig,
        schedule: {
          frequency: editForm.scheduleFrequency || 'manual',
          time: editForm.scheduleTime || '06:00',
          enabled: editForm.scheduleFrequency !== 'manual',
        },
      };

      // Extract schedule fields from editForm (they're not part of DataSource)
      const { scheduleFrequency, scheduleTime, ...dataSourceFields } = editForm;

      await updateDataSource(editingSource.id, {
        ...dataSourceFields,
        crawlerConfig: updatedCrawlerConfig,
      });
      const response = await getDataSources();
      setSources(response.data);
      setEditingSource(null);
      setEditForm({});
    } catch (err) {
      logger.error('Failed to update source:', err);
      toast.error('Failed to update source configuration');
    }
  };

  const handleCancelEdit = () => {
    setEditingSource(null);
    setEditForm({});
  };

  const handleRunNow = (source: DataSource) => {
    setRunNowSource(source);
    setRunNowConfig({
      maxResults: 10,
      category: source.categories?.[0] || '',
      language: source.languages?.[0] || '',
    });
  };

  const handleRunNowSubmit = async () => {
    if (!runNowSource || isRunning) return;

    try {
      setIsRunning(true);

      const sourceConfig: Record<string, unknown> = {
        maxResults: runNowConfig.maxResults || 10,
      };

      if (runNowSource.type === 'ARXIV') {
        if (runNowConfig.category) {
          sourceConfig.category = runNowConfig.category;
        }
      } else if (runNowSource.type === 'GITHUB') {
        if (runNowConfig.language) {
          sourceConfig.language = runNowConfig.language;
        }
        sourceConfig.since = 'daily';
      }

      if (runNowConfig.keywords) {
        sourceConfig.keywords = runNowConfig.keywords
          .split(',')
          .map((k) => k.trim());
      }

      if (runNowConfig.dateFrom) {
        sourceConfig.dateFrom = runNowConfig.dateFrom;
      }
      if (runNowConfig.dateTo) {
        sourceConfig.dateTo = runNowConfig.dateTo;
      }

      const taskName = `Manual: ${runNowSource.name} - ${new Date().toLocaleString()}`;
      const taskResponse = await createCollectionTask({
        sourceId: runNowSource.id,
        name: taskName,
        description: `Manual collection task triggered by user`,
        type: 'MANUAL',
        sourceConfig,
        deduplicationRules: {},
      });

      await executeTask(taskResponse.id);

      // Track the running task
      setRunningTasks((prev) =>
        new Map(prev).set(taskResponse.id, taskResponse)
      );
      setSelectedTaskId(taskResponse.id);
      setShowProgressModal(true);

      setNotification({
        type: 'success',
        message: `Collection task started: ${taskName}`,
      });
      setTimeout(() => setNotification(null), 3000);

      setRunNowSource(null);
      setRunNowConfig({ maxResults: 10 });
    } catch (err) {
      logger.error('Failed to run collection task:', err);
      setNotification({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to start collection task',
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleCancelRunNow = () => {
    setRunNowSource(null);
    setRunNowConfig({ maxResults: 10 });
  };

  const handleRunAllCategory = async (
    category: (typeof CATEGORIES)[number]
  ) => {
    // Open drawer with category sources
    setBatchCategory(category);
    setShowBatchDrawer(true);
  };

  const handleAddSource = async () => {
    if (!showAddSourceModal) return;

    try {
      // Build crawler config with schedule settings
      const crawlerConfig: Record<string, unknown> = {
        schedule: {
          frequency: newSourceForm.scheduleFrequency,
          time: newSourceForm.scheduleTime,
          enabled: newSourceForm.scheduleFrequency !== 'manual',
        },
      };

      // Determine crawler type based on source type
      const crawlerType =
        newSourceForm.type === 'RSS'
          ? 'RSS'
          : newSourceForm.type === 'YOUTUBE'
            ? 'RSS' // YouTube uses RSS feeds
            : 'API';

      // For RSS and YouTube types, set rssUrl in crawlerConfig
      // This is required for the backend RSS service to fetch data
      if (newSourceForm.type === 'RSS' || newSourceForm.type === 'YOUTUBE') {
        crawlerConfig.rssUrl = newSourceForm.baseUrl;
      }

      // For YouTube, add minimum duration filter (convert minutes to seconds)
      if (
        newSourceForm.type === 'YOUTUBE' &&
        newSourceForm.minDurationMinutes > 0
      ) {
        crawlerConfig.minDurationSeconds =
          newSourceForm.minDurationMinutes * 60;
      }

      await createDataSource({
        name: newSourceForm.name,
        description: newSourceForm.description,
        type: newSourceForm.type,
        category: showAddSourceModal,
        baseUrl: newSourceForm.baseUrl,
        apiEndpoint: newSourceForm.apiEndpoint,
        crawlerType,
        crawlerConfig,
        minQualityScore: 7.0,
        status:
          newSourceForm.scheduleFrequency === 'manual' ? 'PAUSED' : 'ACTIVE',
        isVerified: false,
      });

      const response = await getDataSources();
      setSources(response.data);
      setShowAddSourceModal(null);
      setNewSourceForm({
        name: '',
        description: '',
        baseUrl: '',
        apiEndpoint: '',
        type: 'RSS',
        template: '',
        scheduleFrequency: 'daily',
        scheduleTime: '06:00',
        minDurationMinutes: 15,
      });
      toast.success('Data source added successfully!');
    } catch (err) {
      logger.error('Failed to add source:', err);
      toast.error(
        err instanceof Error ? err.message : 'Failed to add data source'
      );
    }
  };

  const handleSelectTemplate = (
    template: (typeof SOURCE_TEMPLATES)[string][number]
  ) => {
    setNewSourceForm({
      ...newSourceForm,
      name: template.name,
      baseUrl: template.url,
      apiEndpoint: template.type === 'RSS' ? '' : '/api/v1/data',
      type: template.type,
    });
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center p-8">
        <div className="text-center">
          <Activity className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-2 text-sm text-gray-500">Loading sources...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center p-8">
        <div className="text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
          <p className="mt-2 text-sm text-gray-900">{error}</p>
        </div>
      </div>
    );
  }

  // Handle Fix RSS URLs
  async function handleFixRssUrls() {
    try {
      setIsFixingRss(true);
      setFixRssResult(null);
      setNotification(null);
      const fixResult = await fixRssUrls();
      setFixRssResult(fixResult);

      // Refresh sources after fix
      const sourcesResponse = await getDataSources();
      setSources(sourcesResponse.data);

      setNotification({
        type: 'success',
        message: `RSS URLs Fixed! ${fixResult.fixed.length} fixed, ${fixResult.skipped.length} skipped, ${fixResult.failed.length} failed`,
      });

      // Auto-hide after 5 seconds
      setTimeout(() => setNotification(null), 5000);
    } catch (err) {
      logger.error('Failed to fix RSS URLs:', err);
      setNotification({
        type: 'error',
        message:
          'Failed to fix RSS URLs. Please check the console for details.',
      });
    } finally {
      setIsFixingRss(false);
    }
  }

  return (
    <AdminPageLayout
      title={t('admin.dataCollection.title')}
      description={t('admin.dataCollection.description')}
      icon={Compass}
      domain="data"
      actions={
        <button
          onClick={handleFixRssUrls}
          disabled={isFixingRss}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Settings className="h-5 w-5" />
          {isFixingRss ? 'Fixing...' : 'Fix RSS URLs'}
        </button>
      }
    >
      {/* Notification Banner */}
      {notification && (
        <div
          className={`rounded-lg p-4 ${
            notification.type === 'success'
              ? 'border border-green-200 bg-green-50 text-green-800'
              : notification.type === 'error'
                ? 'border border-red-200 bg-red-50 text-red-800'
                : 'border border-blue-200 bg-blue-50 text-blue-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{notification.message}</p>
            <button
              onClick={() => setNotification(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Scheduler Panel */}
      <SchedulerPanel
        onRefresh={async () => {
          const response = await getDataSources();
          setSources(response.data);
        }}
      />

      {/* Category Cards Grid - 3x2 Layout for symmetry */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {groupedSources.map((group) => {
          const CategoryIcon = group.icon;
          const activeCount = group.sources.filter(
            (s) => s.status === 'ACTIVE'
          ).length;
          const pausedCount = group.sources.filter(
            (s) => s.status === 'PAUSED'
          ).length;
          const colors = CATEGORY_COLORS[group.id];

          const failedCount = group.sources.filter(
            (s) => s.status === 'FAILED'
          ).length;
          const maintenanceCount = group.sources.filter(
            (s) => s.status === 'MAINTENANCE'
          ).length;

          return (
            <div
              key={group.id}
              className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Card Header - Increased Height */}
              <div className="flex min-h-[200px] flex-col p-6">
                <div className="flex items-start justify-between">
                  <div className={`rounded-lg ${colors.bg} p-2.5`}>
                    <CategoryIcon className={`h-6 w-6 ${colors.icon}`} />
                  </div>
                  {group.sources.length > 0 && (
                    <button
                      onClick={() => handleRunAllCategory(group)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                    >
                      <Zap className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                      Run All
                    </button>
                  )}
                </div>

                <h3 className="mt-4 text-lg font-semibold text-gray-900">
                  {group.name}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {group.description}
                </p>

                {/* Stats - Fixed Layout with proper spacing */}
                <div className="mt-auto space-y-2 pt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Sources</span>
                    <span className="font-semibold text-gray-900">
                      {group.sources.length}
                    </span>
                  </div>
                  {group.sources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {activeCount > 0 && (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {activeCount} Active
                        </span>
                      )}
                      {pausedCount > 0 && (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                          {pausedCount} Paused
                        </span>
                      )}
                      {failedCount > 0 && (
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          {failedCount} Failed
                        </span>
                      )}
                      {maintenanceCount > 0 && (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                          {maintenanceCount} Maintenance
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer - Fixed Height */}
              <div className="flex h-[56px] items-center justify-between border-t border-gray-100 bg-gray-50 px-6">
                <button
                  onClick={() => setShowSourcesModal(group.id)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  <Settings className="-mt-0.5 mr-1 inline h-4 w-4" />
                  Manage
                </button>
                <button
                  onClick={() => setShowAddSourceModal(group.id)}
                  className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                >
                  <Plus className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Manage Sources Modal */}
      <Modal
        open={!!showSourcesModal}
        onClose={() => setShowSourcesModal(null)}
        title={`${CATEGORIES.find((c) => c.id === showSourcesModal)?.name} Sources`}
        subtitle="Manage data sources for this category"
        size="2xl"
      >
        {groupedSources.find((g) => g.id === showSourcesModal)?.sources
          .length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Database className="h-12 w-12" />}
            title="No sources configured"
            action={{
              label: 'Add First Source',
              onClick: () => {
                setShowSourcesModal(null);
                setShowAddSourceModal(showSourcesModal);
              },
            }}
          />
        ) : (
          <div className="space-y-3">
            {groupedSources
              .find((g) => g.id === showSourcesModal)
              ?.sources.map((source) => (
                <div
                  key={source.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900">
                          {source.name}
                        </h4>
                        {source.status === 'ACTIVE' && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Active
                          </span>
                        )}
                        {source.status === 'PAUSED' && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                            Paused
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {source.description}
                      </p>
                      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Database className="h-3.5 w-3.5" />
                          {source.totalCollected.toLocaleString()} collected
                        </span>
                        <span>
                          Last sync: {formatRelativeTime(source.lastSuccessAt)}
                        </span>
                        <a
                          href={source.baseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {source.baseUrl}
                        </a>
                      </div>
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      <button
                        onClick={() => handleRunNow(source)}
                        className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                      >
                        <Zap className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                        Run
                      </button>
                      <button
                        onClick={() => handleEdit(source)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <Settings className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleStatus(source)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {source.status === 'ACTIVE' ? (
                          <>
                            <Pause className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                            Pause
                          </>
                        ) : (
                          <>
                            <Play className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                            Resume
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </Modal>

      {/* Add Source Modal */}
      <Modal
        open={!!showAddSourceModal}
        onClose={() => {
          setShowAddSourceModal(null);
          setNewSourceForm({
            name: '',
            description: '',
            baseUrl: '',
            apiEndpoint: '',
            type: 'RSS',
            template: '',
            scheduleFrequency: 'daily',
            scheduleTime: '06:00',
            minDurationMinutes: 15,
          });
        }}
        title={`Add ${CATEGORIES.find((c) => c.id === showAddSourceModal)?.name} Source`}
        subtitle="Configure a new data source for collection"
        size="lg"
        contentClassName="space-y-6"
        footer={
          <>
            <button
              onClick={() => {
                setShowAddSourceModal(null);
                setNewSourceForm({
                  name: '',
                  description: '',
                  baseUrl: '',
                  apiEndpoint: '',
                  type: 'RSS',
                  template: '',
                  scheduleFrequency: 'daily',
                  scheduleTime: '06:00',
                  minDurationMinutes: 15,
                });
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleAddSource}
              disabled={!newSourceForm.name || !newSourceForm.baseUrl}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle className="-mt-0.5 mr-1.5 inline h-4 w-4" />
              Add Source
            </button>
          </>
        }
      >
        {/* Templates */}
        {showAddSourceModal &&
          SOURCE_TEMPLATES[showAddSourceModal] &&
          SOURCE_TEMPLATES[showAddSourceModal].length > 0 && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Quick Templates
              </label>
              <div className="grid grid-cols-2 gap-2">
                {SOURCE_TEMPLATES[showAddSourceModal].map(
                  (
                    template: { name: string; url: string; type: string },
                    idx: number
                  ) => (
                    <button
                      key={idx}
                      onClick={() => handleSelectTemplate(template)}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:border-blue-500 hover:bg-blue-50"
                    >
                      <div className="font-medium text-gray-900">
                        {template.name}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {template.url}
                      </div>
                    </button>
                  )
                )}
              </div>
            </div>
          )}

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Source Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={newSourceForm.name}
              onChange={(e) =>
                setNewSourceForm({
                  ...newSourceForm,
                  name: e.target.value,
                })
              }
              placeholder="e.g., Google AI Blog"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              value={newSourceForm.description}
              onChange={(e) =>
                setNewSourceForm({
                  ...newSourceForm,
                  description: e.target.value,
                })
              }
              placeholder="Brief description of this data source"
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Source Type <span className="text-red-500">*</span>
            </label>
            <select
              value={newSourceForm.type}
              onChange={(e) =>
                setNewSourceForm({
                  ...newSourceForm,
                  type: e.target.value,
                })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="RSS">RSS Feed</option>
              <option value="YOUTUBE">YouTube Channel</option>
              <option value="CUSTOM">Custom API</option>
              <option value="ARXIV">arXiv API</option>
              <option value="GITHUB">GitHub</option>
              <option value="HACKERNEWS">HackerNews</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Base URL <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              value={newSourceForm.baseUrl}
              onChange={(e) =>
                setNewSourceForm({
                  ...newSourceForm,
                  baseUrl: e.target.value,
                })
              }
              placeholder="https://example.com/rss"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              API Endpoint (Optional)
            </label>
            <input
              type="text"
              value={newSourceForm.apiEndpoint}
              onChange={(e) =>
                setNewSourceForm({
                  ...newSourceForm,
                  apiEndpoint: e.target.value,
                })
              }
              placeholder="/api/v1/data"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Schedule Configuration */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">
                Collection Schedule
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-600">
                  Frequency
                </label>
                <select
                  value={newSourceForm.scheduleFrequency}
                  onChange={(e) =>
                    setNewSourceForm({
                      ...newSourceForm,
                      scheduleFrequency: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="manual">Manual Only</option>
                  <option value="hourly">Every Hour</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              {(newSourceForm.scheduleFrequency === 'daily' ||
                newSourceForm.scheduleFrequency === 'weekly') && (
                <div>
                  <label className="mb-2 block text-xs font-medium text-gray-600">
                    Time (UTC+8)
                  </label>
                  <input
                    type="time"
                    value={newSourceForm.scheduleTime}
                    onChange={(e) =>
                      setNewSourceForm({
                        ...newSourceForm,
                        scheduleTime: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {newSourceForm.scheduleFrequency === 'manual'
                ? 'You will need to manually trigger collection'
                : newSourceForm.scheduleFrequency === 'hourly'
                  ? 'Collection will run every hour automatically'
                  : `Collection will run ${newSourceForm.scheduleFrequency} at ${newSourceForm.scheduleTime}`}
            </p>
          </div>

          {/* YouTube Duration Filter - Only show for YouTube type */}
          {newSourceForm.type === 'YOUTUBE' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Video className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium text-gray-700">
                  Video Duration Filter
                </span>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-600">
                  Minimum Video Duration (minutes)
                </label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={newSourceForm.minDurationMinutes}
                  onChange={(e) =>
                    setNewSourceForm({
                      ...newSourceForm,
                      minDurationMinutes: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {newSourceForm.minDurationMinutes > 0
                  ? `Videos shorter than ${newSourceForm.minDurationMinutes} minutes will be skipped`
                  : 'All videos will be collected (no duration filter)'}
              </p>
            </div>
          )}
        </div>
      </Modal>

      {/* Edit Source Modal */}
      <Modal
        open={!!editingSource}
        onClose={handleCancelEdit}
        title="Edit Data Source"
        subtitle={editingSource?.name}
        size="xl"
        contentClassName="space-y-6"
        footer={
          <>
            <button
              onClick={handleCancelEdit}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Save className="-mt-0.5 mr-1.5 inline h-4 w-4" />
              Save Changes
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              type="text"
              value={editForm.name || ''}
              onChange={(e) =>
                setEditForm({ ...editForm, name: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              value={editForm.description || ''}
              onChange={(e) =>
                setEditForm({ ...editForm, description: e.target.value })
              }
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Base URL
            </label>
            <input
              type="url"
              value={editForm.baseUrl || ''}
              onChange={(e) =>
                setEditForm({ ...editForm, baseUrl: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              API Endpoint
            </label>
            <input
              type="text"
              value={editForm.apiEndpoint || ''}
              onChange={(e) =>
                setEditForm({ ...editForm, apiEndpoint: e.target.value })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Keywords (comma-separated)
            </label>
            <input
              type="text"
              value={editForm.keywords?.join(', ') || ''}
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  keywords: e.target.value
                    .split(',')
                    .map((k) => k.trim())
                    .filter(Boolean),
                })
              }
              placeholder="AI, machine learning, deep learning"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Minimum Quality Score (0-100)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={editForm.minQualityScore || 0}
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  minQualityScore: parseInt(e.target.value) || 0,
                })
              }
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Schedule Configuration */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">
                Collection Schedule
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-600">
                  Frequency
                </label>
                <select
                  value={editForm.scheduleFrequency || 'manual'}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      scheduleFrequency: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="manual">Manual Only</option>
                  <option value="hourly">Every Hour</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              {(editForm.scheduleFrequency === 'daily' ||
                editForm.scheduleFrequency === 'weekly') && (
                <div>
                  <label className="mb-2 block text-xs font-medium text-gray-600">
                    Time (UTC+8)
                  </label>
                  <input
                    type="time"
                    value={editForm.scheduleTime || '06:00'}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        scheduleTime: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {editForm.scheduleFrequency === 'manual' ||
              !editForm.scheduleFrequency
                ? 'You will need to manually trigger collection'
                : editForm.scheduleFrequency === 'hourly'
                  ? 'Collection will run every hour automatically'
                  : `Collection will run ${editForm.scheduleFrequency} at ${editForm.scheduleTime || '06:00'}`}
            </p>
          </div>
        </div>
      </Modal>

      {/* Run Now Modal */}
      <Modal
        open={!!runNowSource}
        onClose={handleCancelRunNow}
        closeButtonDisabled={isRunning}
        title="Run Collection Now"
        subtitle={runNowSource?.name}
        size="lg"
        contentClassName="space-y-4"
        footer={
          <>
            <button
              onClick={handleCancelRunNow}
              disabled={isRunning}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRunNowSubmit}
              disabled={isRunning}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <Activity className="-mt-0.5 mr-1.5 inline h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Zap className="-mt-0.5 mr-1.5 inline h-4 w-4" />
                  Run Collection
                </>
              )}
            </button>
          </>
        }
      >
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-900">
            Configure collection parameters for this manual run. The task will
            execute immediately.
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Max Results
          </label>
          <input
            type="number"
            min="1"
            max="100"
            value={runNowConfig.maxResults || 10}
            onChange={(e) =>
              setRunNowConfig({
                ...runNowConfig,
                maxResults: parseInt(e.target.value) || 10,
              })
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={isRunning}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Keywords (Optional)
          </label>
          <input
            type="text"
            value={runNowConfig.keywords || ''}
            onChange={(e) =>
              setRunNowConfig({
                ...runNowConfig,
                keywords: e.target.value,
              })
            }
            placeholder="AI, machine learning"
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={isRunning}
          />
        </div>
      </Modal>

      {/* Progress Modal */}
      <Modal
        open={
          !!(
            showProgressModal &&
            selectedTaskId &&
            runningTasks.get(selectedTaskId)
          )
        }
        onClose={() => setShowProgressModal(false)}
        title="Collection Progress"
        subtitle={
          selectedTaskId
            ? `Task: ${runningTasks.get(selectedTaskId)?.name || ''}`
            : ''
        }
        size="lg"
        contentClassName="space-y-6"
        footer={
          <button
            onClick={() => setShowProgressModal(false)}
            className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
          >
            Close
          </button>
        }
      >
        {selectedTaskId &&
          (() => {
            const task = runningTasks.get(selectedTaskId);
            if (!task) return null;
            const statusColors: Record<string, string> = {
              PENDING: 'bg-gray-100 text-gray-700',
              RUNNING: 'bg-blue-100 text-blue-700',
              COMPLETED: 'bg-emerald-100 text-emerald-700',
              FAILED: 'bg-red-100 text-red-700',
              CANCELLED: 'bg-gray-100 text-gray-700',
              PAUSED: 'bg-yellow-100 text-yellow-700',
            };

            return (
              <>
                {/* Status Badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusColors[task.status]}`}
                    >
                      {task.status === 'RUNNING' && (
                        <Activity className="mr-1.5 inline h-4 w-4 animate-spin" />
                      )}
                      {task.status === 'COMPLETED' && (
                        <CheckCircle className="mr-1.5 inline h-4 w-4" />
                      )}
                      {task.status === 'FAILED' && (
                        <AlertCircle className="mr-1.5 inline h-4 w-4" />
                      )}
                      {task.status}
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">Progress</span>
                    <span className="text-gray-600">
                      {Math.round(task.progress)}%
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full transition-all duration-500 ${
                        task.status === 'COMPLETED'
                          ? 'bg-emerald-500'
                          : task.status === 'FAILED'
                            ? 'bg-red-500'
                            : 'bg-blue-500'
                      }`}
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                </div>

                {/* Statistics */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="text-2xl font-bold text-gray-900">
                      {task.totalItems.toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Total Items
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-emerald-50 p-4">
                    <div className="text-2xl font-bold text-emerald-700">
                      {task.successItems.toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">Success</div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="text-2xl font-bold text-gray-600">
                      {task.duplicateItems.toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">Duplicates</div>
                  </div>
                </div>

                {/* Error Message */}
                {task.status === 'FAILED' && task.errorMessage && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
                      <div className="flex-1">
                        <div className="font-medium text-red-900">Error</div>
                        <div className="mt-1 text-sm text-red-700">
                          {task.errorMessage}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Timing Info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {task.startedAt && (
                    <div>
                      <span className="text-gray-500">Started:</span>{' '}
                      <span className="font-medium text-gray-900">
                        {new Date(task.startedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                  {task.completedAt && (
                    <div>
                      <span className="text-gray-500">Completed:</span>{' '}
                      <span className="font-medium text-gray-900">
                        {new Date(task.completedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Log Area - Simplified */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-medium text-gray-900">
                    Activity Log
                  </div>
                  <div className="font-mono space-y-1 text-xs text-gray-600">
                    {task.startedAt && (
                      <div>
                        [{new Date(task.startedAt).toLocaleTimeString()}] Task
                        started
                      </div>
                    )}
                    {task.status === 'COMPLETED' && task.completedAt && (
                      <div className="text-emerald-600">
                        [{new Date(task.completedAt).toLocaleTimeString()}] ✓
                        Collection completed - {task.successItems} items
                        collected
                      </div>
                    )}
                    {task.status === 'FAILED' && (
                      <div className="text-red-600">
                        [{new Date().toLocaleTimeString()}] ✗ Collection failed
                      </div>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
      </Modal>

      {/* Batch Collection Drawer */}
      {batchCategory && (
        <BatchCollectionDrawer
          isOpen={showBatchDrawer}
          onClose={() => {
            setShowBatchDrawer(false);
            setBatchCategory(null);
          }}
          categoryName={batchCategory.name}
          sources={sources.filter((s) => s.category === batchCategory.id)}
        />
      )}
    </AdminPageLayout>
  );
}
