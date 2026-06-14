'use client';

/**
 * ExportDropdown - Genspark 风格导出下拉菜单
 * 支持多种导出格式：PPTX、PDF、PNG
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDownIcon,
  ArrowDownTrayIcon,
  DocumentIcon,
  PhotoIcon,
  ArrowsPointingOutIcon,
  LinkIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { config } from '@/lib/utils/config';
import { cn } from '@/lib/utils/common';
import { getAuthHeader } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';
import { toast } from '@/stores';
interface ExportDropdownProps {
  documentId: string;
  documentTitle: string;
  slideCount: number;
  onFullscreen?: () => void;
  disabled?: boolean;
}

type ExportFormat = 'pptx' | 'pdf' | 'png';

interface ExportOption {
  id: ExportFormat | 'fullscreen' | 'copyLink';
  label: string;
  description: string;
  icon: React.ElementType;
  available: boolean;
}

export default function ExportDropdown({
  documentId,
  documentTitle,
  slideCount,
  onFullscreen,
  disabled = false,
}: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(
    null
  );
  const [copySuccess, setCopySuccess] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const exportOptions: ExportOption[] = [
    {
      id: 'pptx',
      label: '导出 PPTX',
      description: 'PowerPoint 演示文稿格式',
      icon: DocumentIcon,
      available: true,
    },
    {
      id: 'pdf',
      label: '导出 PDF',
      description: '便携式文档格式',
      icon: DocumentIcon,
      available: true,
    },
    {
      id: 'png',
      label: '导出图片',
      description: '每页导出为 PNG 图片',
      icon: PhotoIcon,
      available: true,
    },
    {
      id: 'fullscreen',
      label: '全屏预览',
      description: '幻灯片放映模式',
      icon: ArrowsPointingOutIcon,
      available: !!onFullscreen,
    },
    {
      id: 'copyLink',
      label: '复制分享链接',
      description: '获取可分享的链接',
      icon: LinkIcon,
      available: true,
    },
  ];

  const handleExport = async (format: ExportFormat) => {
    if (isExporting) return;

    setIsExporting(true);
    setExportingFormat(format);

    try {
      const response = await fetch(
        `${config.apiUrl}/ai-office/slides/${documentId}/export`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ format }),
        }
      );

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      // 获取文件名
      const contentDisposition = response.headers.get('content-disposition');
      let filename = `${documentTitle}.${format}`;
      if (contentDisposition) {
        const matches = contentDisposition.match(
          /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
        );
        if (matches?.[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      // 下载文件
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setIsOpen(false);
    } catch (error) {
      logger.error('Export error:', error);
      toast.error(
        `导出失败: ${error instanceof Error ? error.message : '未知错误'}`
      );
    } finally {
      setIsExporting(false);
      setExportingFormat(null);
    }
  };

  const handleCopyLink = async () => {
    const shareUrl = `${window.location.origin}/ai-office/slides/${documentId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      logger.error('Failed to copy:', err);
    }
  };

  const handleOptionClick = (option: ExportOption) => {
    if (option.id === 'fullscreen' && onFullscreen) {
      onFullscreen();
      setIsOpen(false);
    } else if (option.id === 'copyLink') {
      handleCopyLink();
    } else if (['pptx', 'pdf', 'png'].includes(option.id)) {
      handleExport(option.id as ExportFormat);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* 触发器按钮 */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || isExporting}
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
          disabled || isExporting
            ? 'cursor-not-allowed bg-gray-100 text-gray-400'
            : 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
        )}
      >
        {isExporting ? (
          <>
            <svg
              className="h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>导出中...</span>
          </>
        ) : (
          <>
            <ArrowDownTrayIcon className="h-4 w-4" />
            <span>查看和导出</span>
            <ChevronDownIcon
              className={cn(
                'h-4 w-4 transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          </>
        )}
      </button>

      {/* 下拉菜单 */}
      {isOpen && !isExporting && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5">
          {/* 头部信息 */}
          <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
            <div className="truncate text-sm font-medium text-gray-900">
              {documentTitle || '未命名演示文稿'}
            </div>
            <div className="mt-0.5 text-xs text-gray-500">
              {slideCount} 页幻灯片
            </div>
          </div>

          {/* 导出选项列表 */}
          <div className="py-1">
            {exportOptions
              .filter((opt) => opt.available)
              .map((option, index) => {
                const Icon = option.icon;
                const isLoading = isExporting && exportingFormat === option.id;
                const showCheck = option.id === 'copyLink' && copySuccess;

                return (
                  <button
                    key={option.id}
                    onClick={() => handleOptionClick(option)}
                    disabled={isLoading}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      'hover:bg-gray-50',
                      isLoading && 'cursor-wait opacity-50',
                      // 在 fullscreen 前添加分隔线
                      option.id === 'fullscreen' && 'border-t border-gray-100'
                    )}
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100">
                      {showCheck ? (
                        <CheckIcon className="h-4 w-4 text-green-600" />
                      ) : (
                        <Icon className="h-4 w-4 text-gray-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900">
                        {showCheck ? '已复制' : option.label}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {option.description}
                      </div>
                    </div>
                    {isLoading && (
                      <svg
                        className="h-4 w-4 animate-spin text-blue-600"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
