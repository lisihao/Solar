'use client';

/**
 * AIAssistMenu - AI 辅助功能菜单
 *
 * 提供 AI 辅助管理功能：
 * - 智能标签：自动生成分类标签
 * - 内容优化：AI 建议改进
 * - 重新组织：优化页面结构
 * - AI 对话：与 AI 讨论修改
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wand2, Tags, ChevronDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n/i18n-context';

interface AIAssistMenuProps {
  onSmartTags?: () => Promise<void>;
  disabled?: boolean;
  className?: string;
}

interface MenuItem {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  color: string;
  action: 'smartTags';
}

function getMenuItems(t: (key: string) => string): MenuItem[] {
  return [
    {
      id: 'smart-tags',
      icon: Tags,
      label: t('office.slides.smartTags'),
      description: t('office.slides.smartTagsDesc'),
      color: 'text-blue-600',
      action: 'smartTags',
    },
  ];
}

export function AIAssistMenu({
  onSmartTags,
  disabled = false,
  className,
}: AIAssistMenuProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleAction = async (item: MenuItem) => {
    if (loading) return;

    setLoading(item.id);

    try {
      if (item.action === 'smartTags' && onSmartTags) {
        await onSmartTags();
      }
    } finally {
      setLoading(null);
      setIsOpen(false);
    }
  };

  return (
    <div ref={menuRef} className={cn('relative', className)}>
      {/* 触发按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all',
          'border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50',
          'text-purple-700 hover:from-purple-100 hover:to-pink-100',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isOpen && 'ring-2 ring-purple-300'
        )}
      >
        <Wand2 className="h-4 w-4" />
        <span>{t('office.slides.aiAssist')}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {/* 下拉菜单 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute right-0 top-full z-50 mt-2 w-64',
              'rounded-xl border border-gray-200 bg-white shadow-xl'
            )}
          >
            {/* 菜单头部 */}
            <div className="border-b border-gray-100 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-purple-100 p-1.5">
                    <Wand2 className="h-4 w-4 text-purple-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">
                    {t('office.slides.aiAssistTitle')}
                  </span>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {t('office.slides.aiAssistDesc')}
              </p>
            </div>

            {/* 菜单项 */}
            <div className="p-2">
              {getMenuItems(t).map((item) => {
                const Icon = item.icon;
                const isLoading = loading === item.id;
                const isDisabled =
                  isLoading || (item.action === 'smartTags' && !onSmartTags);

                return (
                  <button
                    key={item.id}
                    onClick={() => handleAction(item)}
                    disabled={isDisabled}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                      'hover:bg-gray-50',
                      isDisabled && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                        'bg-gray-50'
                      )}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      ) : (
                        <Icon className={cn('h-4 w-4', item.color)} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-800">
                        {item.label}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {item.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default AIAssistMenu;
