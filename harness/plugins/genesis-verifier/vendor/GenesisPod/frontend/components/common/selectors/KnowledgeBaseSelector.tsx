'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Database,
  Check,
  ChevronDown,
  Search,
  User,
  Users,
  X,
  Loader2,
  Plus,
  ExternalLink,
} from 'lucide-react';
import { type KnowledgeBase } from '@/hooks/domain/useKnowledgeBase';
import { apiClient, type ApiError } from '@/lib/api/client';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n/i18n-context';

import { logger } from '@/lib/utils/logger';
export interface KnowledgeBaseSelectorProps {
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  multiple?: boolean;
  maxSelections?: number;
  placeholder?: string;
  disabled?: boolean;
  filterType?: 'PERSONAL' | 'TEAM' | 'ALL';
  compact?: boolean;
  onlyReady?: boolean;
  className?: string;
}

export default function KnowledgeBaseSelector({
  selectedIds,
  onSelectionChange,
  multiple = false,
  maxSelections = 5,
  placeholder,
  disabled = false,
  filterType = 'ALL',
  compact = false,
  onlyReady = true,
  className = '',
}: KnowledgeBaseSelectorProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    openUpward: false,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  // Track if component is mounted (for portal)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Update dropdown position when opening
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownHeight = 320; // Approximate max height of dropdown
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUpward = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

      setDropdownPosition({
        top: openUpward ? rect.top - 4 : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        openUpward,
      });
    }
  }, [isOpen]);

  const displayPlaceholder = placeholder || t('knowledgeBase.select');

  // 获取知识库列表
  const fetchKnowledgeBases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<KnowledgeBase[]>('/rag/knowledge-bases');
      setKnowledgeBases(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('[KBSelector] Failed to fetch:', err);
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, []);

  // 过滤知识库
  const filteredKBs = knowledgeBases.filter((kb) => {
    if (filterType !== 'ALL') {
      const kbType = kb.type || 'PERSONAL';
      if (kbType !== filterType) return false;
    }
    if (onlyReady && kb.status !== 'READY') return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        kb.name.toLowerCase().includes(query) ||
        kb.description?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const selectedKBs = knowledgeBases.filter((kb) =>
    selectedIds.includes(kb.id)
  );

  const handleToggle = useCallback(
    (kb: KnowledgeBase) => {
      if (disabled) return;
      if (multiple) {
        if (selectedIds.includes(kb.id)) {
          onSelectionChange(selectedIds.filter((id) => id !== kb.id));
        } else if (selectedIds.length < maxSelections) {
          onSelectionChange([...selectedIds, kb.id]);
        }
      } else {
        onSelectionChange(selectedIds.includes(kb.id) ? [] : [kb.id]);
        setIsOpen(false);
      }
    },
    [disabled, multiple, selectedIds, maxSelections, onSelectionChange]
  );

  const handleRemove = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onSelectionChange(selectedIds.filter((i) => i !== id));
    },
    [selectedIds, onSelectionChange]
  );

  const handleClearAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelectionChange([]);
    },
    [onSelectionChange]
  );

  // 下拉框打开时获取数据
  useEffect(() => {
    if (isOpen) {
      fetchKnowledgeBases();
    } else {
      setSearchQuery('');
    }
  }, [isOpen, fetchKnowledgeBases]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.kb-selector')) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen]);

  const getTypeIcon = (type?: string) => {
    if (type === 'TEAM') {
      return <Users className="h-3.5 w-3.5 text-purple-500" />;
    }
    return <User className="h-3.5 w-3.5 text-blue-500" />;
  };

  const getSourceTypeLabel = (sourceType: string) => {
    return t(`knowledgeBase.sourceTypes.${sourceType}`) || sourceType;
  };

  // 下拉内容
  const renderDropdownContent = () => (
    <div className="rounded-lg border border-gray-200 bg-white shadow-lg">
      {/* 搜索框 */}
      <div className="border-b border-gray-100 p-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('knowledgeBase.search')}
            className="w-full rounded-md border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="max-h-64 overflow-y-auto p-2">
        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        )}

        {error && (
          <div className="py-4 text-center text-sm text-red-500">
            {t('knowledgeBase.loadFailed')}
            <button
              onClick={fetchKnowledgeBases}
              className="ml-2 text-blue-600 hover:underline"
            >
              {t('knowledgeBase.retry')}
            </button>
          </div>
        )}

        {!loading && !error && filteredKBs.length === 0 && (
          <div className="py-4 text-center text-sm text-gray-500">
            {searchQuery
              ? t('knowledgeBase.noMatch')
              : t('knowledgeBase.noAvailable')}
          </div>
        )}

        {!loading &&
          !error &&
          filteredKBs.map((kb) => {
            const isSelected = selectedIds.includes(kb.id);
            const isDisabled =
              !isSelected && multiple && selectedIds.length >= maxSelections;

            return (
              <button
                key={kb.id}
                type="button"
                onClick={() => !isDisabled && handleToggle(kb)}
                disabled={isDisabled}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  isSelected
                    ? 'bg-blue-50 text-blue-700'
                    : isDisabled
                      ? 'cursor-not-allowed opacity-50'
                      : 'hover:bg-gray-50'
                }`}
              >
                <div
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded ${
                    multiple ? 'rounded' : 'rounded-full'
                  } border ${
                    isSelected
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-gray-300'
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3 text-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {getTypeIcon(kb.type)}
                    <span className="truncate font-medium text-gray-900">
                      {kb.name}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                    <span>{getSourceTypeLabel(kb.sourceType)}</span>
                    <span>•</span>
                    <span>
                      {t('knowledgeBase.docCount', {
                        count: String(kb._count?.documents ?? 0),
                      })}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
      </div>

      {/* 底部 */}
      <div className="border-t border-gray-100 p-2">
        <Link
          href="/library?tab=personal-kb"
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-2 text-sm text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
        >
          <Plus className="h-4 w-4" />
          {t('knowledgeBase.createNew')}
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );

  // Compact 模式
  if (compact) {
    return (
      <div className={`kb-selector relative ${className}`}>
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
            selectedIds.length > 0
              ? 'text-blue-600 hover:bg-blue-50'
              : 'text-gray-500 hover:bg-gray-100'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <Database className="h-4 w-4" />
          {selectedIds.length > 0 ? (
            <span className="whitespace-nowrap">{selectedIds.length}</span>
          ) : (
            <span className="whitespace-nowrap">{displayPlaceholder}</span>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-1 w-72">
            {renderDropdownContent()}
          </div>
        )}
      </div>
    );
  }

  // Full 模式
  return (
    <div className={`kb-selector space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          {t('knowledgeBase.title')}
          {multiple && (
            <span className="ml-1 text-xs text-gray-400">
              ({t('knowledgeBase.maxCount', { count: maxSelections })})
            </span>
          )}
        </label>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            className="text-xs text-gray-500 hover:text-red-600"
          >
            {t('knowledgeBase.clearAll')}
          </button>
        )}
      </div>

      {selectedKBs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedKBs.map((kb) => (
            <div
              key={kb.id}
              className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-sm text-blue-700"
            >
              {getTypeIcon(kb.type)}
              <span className="max-w-32 truncate">{kb.name}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => handleRemove(kb.id, e)}
                  className="ml-1 rounded-full p-0.5 hover:bg-blue-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || (multiple && selectedIds.length >= maxSelections)}
        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors ${
          isOpen
            ? 'border-blue-500 ring-1 ring-blue-500'
            : 'border-gray-300 hover:border-gray-400'
        } ${disabled ? 'cursor-not-allowed bg-gray-50 opacity-50' : 'bg-white'}`}
      >
        <div className="flex items-center gap-2 text-gray-500">
          <Database className="h-4 w-4" />
          <span>
            {selectedIds.length === 0
              ? displayPlaceholder
              : multiple && selectedIds.length < maxSelections
                ? t('knowledgeBase.addMore')
                : t('knowledgeBase.maxReached')}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen &&
        mounted &&
        createPortal(
          <div
            className="kb-selector fixed z-[9999]"
            style={{
              ...(dropdownPosition.openUpward
                ? { bottom: window.innerHeight - dropdownPosition.top }
                : { top: dropdownPosition.top }),
              left: dropdownPosition.left,
              width: dropdownPosition.width,
            }}
          >
            {renderDropdownContent()}
          </div>,
          document.body
        )}
    </div>
  );
}
