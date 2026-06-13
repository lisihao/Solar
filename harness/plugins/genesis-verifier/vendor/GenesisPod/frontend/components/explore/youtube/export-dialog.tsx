'use client';

import React, { useState } from 'react';
import { SubtitleExportOptions } from '@/hooks';
import { Modal } from '@/components/ui/dialogs/Modal';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: SubtitleExportOptions) => void;
  isLoading?: boolean;
}

export function ExportDialog({
  isOpen,
  onClose,
  onExport,
  isLoading = false,
}: ExportDialogProps) {
  const [options, setOptions] = useState<SubtitleExportOptions>({
    format: 'bilingual-side',
    includeTimestamps: true,
    includeVideoUrl: true,
    includeMetadata: true,
  });

  const handleExport = () => {
    onExport(options);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="导出字幕为 PDF"
      subtitle="选择导出格式和选项"
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleExport}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg border border-transparent bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-violet-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin text-white"
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
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <span>导出中...</span>
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span>导出 PDF</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Format Selection */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-800">
            导出格式
          </label>
          <div className="space-y-2">
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all ${options.format === 'bilingual-side' ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50'}`}
            >
              <input
                type="radio"
                name="format"
                value="bilingual-side"
                checked={options.format === 'bilingual-side'}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    format: e.target.value as SubtitleExportOptions['format'],
                  })
                }
                className="h-4 w-4 text-violet-600 focus:ring-violet-500"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">
                  双语并排
                </div>
                <div className="text-xs text-gray-500">
                  英文和中文左右两列对照显示
                </div>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all ${options.format === 'bilingual-stack' ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50'}`}
            >
              <input
                type="radio"
                name="format"
                value="bilingual-stack"
                checked={options.format === 'bilingual-stack'}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    format: e.target.value as SubtitleExportOptions['format'],
                  })
                }
                className="h-4 w-4 text-violet-600 focus:ring-violet-500"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">
                  双语上下
                </div>
                <div className="text-xs text-gray-500">
                  英文在上，中文在下依次排列
                </div>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all ${options.format === 'english-only' ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50'}`}
            >
              <input
                type="radio"
                name="format"
                value="english-only"
                checked={options.format === 'english-only'}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    format: e.target.value as SubtitleExportOptions['format'],
                  })
                }
                className="h-4 w-4 text-violet-600 focus:ring-violet-500"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">仅英文</div>
                <div className="text-xs text-gray-500">只导出英文原文字幕</div>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all ${options.format === 'chinese-only' ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50'}`}
            >
              <input
                type="radio"
                name="format"
                value="chinese-only"
                checked={options.format === 'chinese-only'}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    format: e.target.value as SubtitleExportOptions['format'],
                  })
                }
                className="h-4 w-4 text-violet-600 focus:ring-violet-500"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">仅中文</div>
                <div className="text-xs text-gray-500">只导出中文翻译字幕</div>
              </div>
            </label>
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-800">
            附加选项
          </label>

          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all ${options.includeTimestamps ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50'}`}
          >
            <input
              type="checkbox"
              checked={options.includeTimestamps}
              onChange={(e) =>
                setOptions({
                  ...options,
                  includeTimestamps: e.target.checked,
                })
              }
              className="h-4 w-4 rounded text-violet-600 focus:ring-violet-500"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">
                包含时间戳
              </div>
              <div className="text-xs text-gray-500">
                显示每段字幕的时间标记
              </div>
            </div>
          </label>

          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all ${options.includeVideoUrl ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50'}`}
          >
            <input
              type="checkbox"
              checked={options.includeVideoUrl}
              onChange={(e) =>
                setOptions({ ...options, includeVideoUrl: e.target.checked })
              }
              className="h-4 w-4 rounded text-violet-600 focus:ring-violet-500"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">
                包含视频链接
              </div>
              <div className="text-xs text-gray-500">
                在文档头部添加 YouTube 视频链接
              </div>
            </div>
          </label>

          <label
            className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all ${options.includeMetadata ? 'border-violet-500 bg-violet-50' : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50'}`}
          >
            <input
              type="checkbox"
              checked={options.includeMetadata}
              onChange={(e) =>
                setOptions({ ...options, includeMetadata: e.target.checked })
              }
              className="h-4 w-4 rounded text-violet-600 focus:ring-violet-500"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">
                包含元信息
              </div>
              <div className="text-xs text-gray-500">
                显示视频标题和导出日期
              </div>
            </div>
          </label>
        </div>
      </div>
    </Modal>
  );
}
