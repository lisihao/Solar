'use client';

/**
 * AI Slides V5.0 - Source Import Modal
 *
 * Modal for importing content from platform sources:
 * - AI Research reports
 * - AI Writing projects
 * - AI Teams discussions
 * - Library resources
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Search,
  BookOpen,
  PenTool,
  Users,
  Image as ImageIcon,
  FileText,
  Loader2,
  Check,
  ChevronRight,
  AlertCircle,
  Calendar,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { formatDateSafe } from '@/lib/utils/date';
import {
  useDataImport,
  type SlidesSourceType,
  type SourceListItem,
  type SlidesSourceData,
} from '@/hooks/features/slides';

// ============================================
// Types
// ============================================

interface SourceImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: SlidesSourceData) => void;
}

interface TabConfig {
  id: SlidesSourceType;
  label: string;
  icon: React.ReactNode;
  description: string;
}

// ============================================
// Constants
// ============================================

const TABS: TabConfig[] = [
  {
    id: 'research',
    label: 'AI Research',
    icon: <Search className="h-4 w-4" />,
    description: '从洞察报告导入',
  },
  {
    id: 'research-project',
    label: 'AI 研究',
    icon: <FileText className="h-4 w-4" />,
    description: '从研究项目导入',
  },
  {
    id: 'writing',
    label: 'AI Writing',
    icon: <PenTool className="h-4 w-4" />,
    description: '从写作项目导入',
  },
  {
    id: 'teams',
    label: 'AI Teams',
    icon: <Users className="h-4 w-4" />,
    description: '从团队讨论导入',
  },
  {
    id: 'library',
    label: '资源库',
    icon: <ImageIcon className="h-4 w-4" />,
    description: '从资源库导入',
  },
];

// ============================================
// Component
// ============================================

export function SourceImportModal({
  isOpen,
  onClose,
  onImport,
}: SourceImportModalProps) {
  const [activeTab, setActiveTab] = useState<SlidesSourceType>('research');
  const [sources, setSources] = useState<SourceListItem[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [importing, setImporting] = useState(false);

  const {
    loading,
    error,
    fetchSources,
    importFromResearch,
    importFromResearchProject,
    importFromWriting,
    importFromTeams,
  } = useDataImport();

  // Fetch sources when tab changes
  useEffect(() => {
    if (isOpen) {
      fetchSources(activeTab).then((data) => {
        setSources(data);
        setSelectedSource(null);
      });
    }
  }, [isOpen, activeTab, fetchSources]);

  // Filter sources by search query
  const filteredSources = sources.filter((source) =>
    source.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle import
  const handleImport = useCallback(async () => {
    if (!selectedSource) return;

    setImporting(true);

    try {
      let data: SlidesSourceData | null = null;

      switch (activeTab) {
        case 'research':
          data = await importFromResearch(selectedSource);
          break;
        case 'research-project':
          data = await importFromResearchProject(selectedSource);
          break;
        case 'writing':
          data = await importFromWriting(selectedSource);
          break;
        case 'teams':
          data = await importFromTeams(selectedSource);
          break;
        // Library imports assets, not full source data
        default:
          break;
      }

      if (data) {
        onImport(data);
        onClose();
      }
    } finally {
      setImporting(false);
    }
  }, [
    activeTab,
    selectedSource,
    importFromResearch,
    importFromResearchProject,
    importFromWriting,
    importFromTeams,
    onImport,
    onClose,
  ]);

  // Format date
  const formatDate = (dateString: string) => {
    return formatDateSafe(dateString, 'date');
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative z-10 flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">导入素材</h2>
              <p className="text-sm text-gray-500">从平台内其他模块导入内容</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left: Tabs */}
            <div className="w-56 flex-shrink-0 border-r border-gray-200 bg-gray-50 p-4">
              <div className="space-y-1">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                      activeTab === tab.id
                        ? 'bg-orange-100 text-orange-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg',
                        activeTab === tab.id ? 'bg-orange-200' : 'bg-gray-200'
                      )}
                    >
                      {tab.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{tab.label}</div>
                      <div className="truncate text-xs opacity-70">
                        {tab.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Source List */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Search */}
              <div className="border-b border-gray-200 p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索..."
                    className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* List */}
              <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                  </div>
                ) : error ? (
                  <div className="flex h-full flex-col items-center justify-center text-gray-500">
                    <AlertCircle className="mb-2 h-8 w-8" />
                    <p className="text-sm">{error}</p>
                  </div>
                ) : filteredSources.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-gray-500">
                    <FileText className="mb-2 h-8 w-8" />
                    <p className="text-sm">
                      {searchQuery ? '没有找到匹配的内容' : '暂无可导入的内容'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredSources.map((source) => (
                      <button
                        key={source.id}
                        onClick={() => setSelectedSource(source.id)}
                        className={cn(
                          'flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-all',
                          selectedSource === source.id
                            ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        )}
                      >
                        {/* Icon/Thumbnail */}
                        <div
                          className={cn(
                            'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg',
                            selectedSource === source.id
                              ? 'bg-orange-100 text-orange-600'
                              : 'bg-gray-100 text-gray-500'
                          )}
                        >
                          {source.thumbnailUrl ? (
                            <img
                              src={source.thumbnailUrl}
                              alt={source.title}
                              className="h-full w-full rounded-lg object-cover"
                            />
                          ) : (
                            <BookOpen className="h-5 w-5" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-medium text-gray-900">
                              {source.title}
                            </h3>
                            {selectedSource === source.id && (
                              <Check className="h-4 w-4 flex-shrink-0 text-orange-600" />
                            )}
                          </div>
                          {source.preview && (
                            <p className="mt-0.5 truncate text-xs text-gray-500">
                              {source.preview}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(source.createdAt)}
                            </span>
                            {source.metadata?.pageCount !== undefined && (
                              <span className="flex items-center gap-1">
                                <Layers className="h-3 w-3" />
                                {source.metadata.pageCount}{' '}
                                {activeTab === 'research'
                                  ? '个维度'
                                  : activeTab === 'research-project'
                                    ? '个输出'
                                    : activeTab === 'writing'
                                      ? '卷'
                                      : activeTab === 'teams'
                                        ? '条消息'
                                        : '项'}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Arrow */}
                        <ChevronRight
                          className={cn(
                            'h-5 w-5 flex-shrink-0 transition-colors',
                            selectedSource === source.id
                              ? 'text-orange-500'
                              : 'text-gray-300'
                          )}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4">
            <div className="text-sm text-gray-500">
              {selectedSource ? (
                <span>已选择 1 项内容</span>
              ) : (
                <span>请选择要导入的内容</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={!selectedSource || importing}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  selectedSource && !importing
                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                    : 'cursor-not-allowed bg-gray-200 text-gray-400'
                )}
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    导入中...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    导入
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default SourceImportModal;
