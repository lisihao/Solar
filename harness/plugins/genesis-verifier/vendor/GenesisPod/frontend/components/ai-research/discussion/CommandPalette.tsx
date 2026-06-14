'use client';

/**
 * CommandPalette - Cmd+K 命令面板
 * 支持快速命令、斜杠命令、搜索和导航
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { logger } from '@/lib/utils/logger';
import { useI18n } from '@/lib/i18n';
import {
  Search,
  TrendingUp,
  GitCompare,
  FileText,
  Presentation,
  Network,
  Lightbulb,
  Clock,
  Command,
  ArrowRight,
  Sparkles,
  BookOpen,
  BarChart3,
  Zap,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';

export interface CommandItem {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  category: 'action' | 'navigation' | 'search' | 'recent';
  shortcut?: string;
  keywords?: string[];
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteCommand?: (command: CommandItem) => void;
  customCommands?: CommandItem[];
}

// Command definitions with i18n keys
const getCommandDefinitions = (
  t: (key: string) => string
): Omit<CommandItem, 'action'>[] => [
  {
    id: 'trend',
    title: t('topicResearch.deepResearch.commandPalette.trend.title'),
    description: t(
      'topicResearch.deepResearch.commandPalette.trend.description'
    ),
    icon: <TrendingUp className="h-4 w-4" />,
    category: 'action',
    shortcut: '/trend',
    keywords: ['trend', 'analysis', 'report', '趋势', '分析'],
  },
  {
    id: 'compare',
    title: t('topicResearch.deepResearch.commandPalette.compare.title'),
    description: t(
      'topicResearch.deepResearch.commandPalette.compare.description'
    ),
    icon: <GitCompare className="h-4 w-4" />,
    category: 'action',
    shortcut: '/compare',
    keywords: ['compare', 'vs', 'diff', '对比', '比较'],
  },
  {
    id: 'summary',
    title: t('topicResearch.deepResearch.commandPalette.summary.title'),
    description: t(
      'topicResearch.deepResearch.commandPalette.summary.description'
    ),
    icon: <FileText className="h-4 w-4" />,
    category: 'action',
    shortcut: '/summary',
    keywords: ['summary', 'abstract', '摘要', '总结'],
  },
  {
    id: 'ppt',
    title: t('topicResearch.deepResearch.commandPalette.ppt.title'),
    description: t('topicResearch.deepResearch.commandPalette.ppt.description'),
    icon: <Presentation className="h-4 w-4" />,
    category: 'action',
    shortcut: '/ppt',
    keywords: ['ppt', 'slides', 'presentation', '演示', '幻灯片'],
  },
  {
    id: 'graph',
    title: t('topicResearch.deepResearch.commandPalette.graph.title'),
    description: t(
      'topicResearch.deepResearch.commandPalette.graph.description'
    ),
    icon: <Network className="h-4 w-4" />,
    category: 'action',
    shortcut: '/graph',
    keywords: ['graph', 'network', 'visualization', '图谱', '关系'],
  },
  {
    id: 'insights',
    title: t('topicResearch.deepResearch.commandPalette.insights.title'),
    description: t(
      'topicResearch.deepResearch.commandPalette.insights.description'
    ),
    icon: <Lightbulb className="h-4 w-4" />,
    category: 'action',
    shortcut: '/insights',
    keywords: ['insights', 'findings', '洞察', '发现'],
  },
  {
    id: 'hype-cycle',
    title: t('topicResearch.deepResearch.commandPalette.hypeCycle.title'),
    description: t(
      'topicResearch.deepResearch.commandPalette.hypeCycle.description'
    ),
    icon: <BarChart3 className="h-4 w-4" />,
    category: 'navigation',
    keywords: ['hype', 'cycle', 'maturity', 'gartner'],
  },
  {
    id: 'research-plan',
    title: t('topicResearch.deepResearch.commandPalette.researchPlan.title'),
    description: t(
      'topicResearch.deepResearch.commandPalette.researchPlan.description'
    ),
    icon: <BookOpen className="h-4 w-4" />,
    category: 'navigation',
    keywords: ['research', 'plan', 'progress', '研究', '计划'],
  },
  {
    id: 'quick-insights',
    title: t('topicResearch.deepResearch.commandPalette.quickInsights.title'),
    description: t(
      'topicResearch.deepResearch.commandPalette.quickInsights.description'
    ),
    icon: <Zap className="h-4 w-4" />,
    category: 'action',
    keywords: ['quick', 'fast', '快速'],
  },
];

const getCategoryLabels = (
  t: (key: string) => string
): Record<string, string> => ({
  action: t('topicResearch.deepResearch.commandPalette.categories.action'),
  navigation: t(
    'topicResearch.deepResearch.commandPalette.categories.navigation'
  ),
  search: t('topicResearch.deepResearch.commandPalette.categories.search'),
  recent: t('topicResearch.deepResearch.commandPalette.categories.recent'),
});

const CATEGORY_ORDER = ['recent', 'action', 'navigation', 'search'];

export default function CommandPalette({
  isOpen,
  onClose,
  onExecuteCommand,
  customCommands = [],
}: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 加载最近使用的命令
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('command-palette-recent');
      if (saved) {
        setRecentCommands(JSON.parse(saved));
      }
    }
  }, []);

  // 保存最近使用的命令
  const saveRecentCommand = useCallback((commandId: string) => {
    setRecentCommands((prev) => {
      const updated = [
        commandId,
        ...prev.filter((id) => id !== commandId),
      ].slice(0, 5);
      if (typeof window !== 'undefined') {
        localStorage.setItem('command-palette-recent', JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  // 合并默认命令和自定义命令
  const allCommands = useMemo(() => {
    const defaultCommands = getCommandDefinitions(t);
    const defaultWithActions = defaultCommands.map((cmd) => ({
      ...cmd,
      action: () => {
        logger.debug(`Execute command: ${cmd.id}`);
        onExecuteCommand?.({
          ...cmd,
          action: () => {},
        } as CommandItem);
      },
    }));
    return [...defaultWithActions, ...customCommands];
  }, [customCommands, onExecuteCommand, t]);

  // 过滤和排序命令
  const filteredCommands = useMemo(() => {
    let commands = allCommands;

    // 搜索过滤
    if (query) {
      const lowerQuery = query.toLowerCase();
      commands = commands.filter(
        (cmd) =>
          cmd.title.toLowerCase().includes(lowerQuery) ||
          cmd.description.toLowerCase().includes(lowerQuery) ||
          cmd.keywords?.some((kw) => kw.toLowerCase().includes(lowerQuery))
      );
    }

    // 添加 recent 分类
    const recentSet = new Set(recentCommands);
    commands = commands.map((cmd) => ({
      ...cmd,
      category: recentSet.has(cmd.id) && !query ? 'recent' : cmd.category,
    }));

    // 按分类排序
    commands.sort((a, b) => {
      const orderA = CATEGORY_ORDER.indexOf(a.category);
      const orderB = CATEGORY_ORDER.indexOf(b.category);
      return orderA - orderB;
    });

    return commands;
  }, [allCommands, query, recentCommands]);

  // 按分类分组
  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    for (const cmd of filteredCommands) {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category].push(cmd);
    }
    return groups;
  }, [filteredCommands]);

  // 执行命令
  const executeCommand = useCallback(
    (command: CommandItem) => {
      saveRecentCommand(command.id);
      command.action();
      onClose();
      setQuery('');
    },
    [saveRecentCommand, onClose]
  );

  // 键盘导航
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            executeCommand(filteredCommands[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          setQuery('');
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, executeCommand, onClose]);

  // 聚焦输入框
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // 滚动到选中项
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.querySelector(
        '[data-selected="true"]'
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  let flatIndex = -1;
  const categoryLabels = getCategoryLabels(t);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/4 z-50 w-full max-w-xl -translate-x-1/2 transform">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
          {/* Search Header */}
          <div className="flex items-center border-b border-gray-200 px-4">
            <Search className="h-5 w-5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(
                'topicResearch.deepResearch.commandPalette.inputPlaceholder'
              )}
              className="flex-1 border-0 bg-transparent px-3 py-4 text-gray-900 placeholder-gray-400 outline-none"
            />
            <kbd className="hidden rounded bg-gray-100 px-2 py-1 text-xs text-gray-500 sm:inline">
              ESC
            </kbd>
          </div>

          {/* Command List */}
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {filteredCommands.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Sparkles className="h-8 w-8" />}
                title={t('topicResearch.deepResearch.commandPalette.noResults')}
                description={t(
                  'topicResearch.deepResearch.commandPalette.tryCommands'
                )}
              />
            ) : (
              CATEGORY_ORDER.map((category) => {
                const commands = groupedCommands[category];
                if (!commands?.length) return null;

                return (
                  <div key={category} className="mb-2">
                    <div className="px-2 py-1 text-xs font-medium uppercase text-gray-500">
                      {categoryLabels[category]}
                    </div>
                    {commands.map((command) => {
                      flatIndex++;
                      const isSelected = flatIndex === selectedIndex;
                      const currentIndex = flatIndex;

                      return (
                        <button
                          key={command.id}
                          data-selected={isSelected}
                          onClick={() => executeCommand(command)}
                          onMouseEnter={() => setSelectedIndex(currentIndex)}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                            isSelected
                              ? 'bg-blue-50 text-blue-900'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                              isSelected
                                ? 'bg-blue-100 text-blue-600'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {command.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {command.title}
                              </span>
                              {command.shortcut && (
                                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                                  {command.shortcut}
                                </code>
                              )}
                            </div>
                            <p className="truncate text-sm text-gray-500">
                              {command.description}
                            </p>
                          </div>
                          {isSelected && (
                            <ArrowRight className="h-4 w-4 text-blue-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2">
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-gray-200 px-1.5 py-0.5">↑</kbd>
                <kbd className="rounded bg-gray-200 px-1.5 py-0.5">↓</kbd>
                <span>
                  {t('topicResearch.deepResearch.commandPalette.navigate')}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-gray-200 px-1.5 py-0.5">Enter</kbd>
                <span>
                  {t('topicResearch.deepResearch.commandPalette.select')}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Command className="h-3 w-3" />
              <span>
                {t('topicResearch.deepResearch.commandPalette.openCommand')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Hook for using command palette
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((prev) => !prev),
  };
}
