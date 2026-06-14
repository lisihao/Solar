'use client';

/**
 * ChapterImportModal - 章节导入弹窗
 *
 * 功能:
 * - 粘贴文本导入
 * - 预览解析结果
 * - 选择要导入的章节
 * - 设置导入选项
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  Clipboard,
  File,
  FileText,
  Library,
  FileCode,
  Globe,
  Download,
  ClipboardList,
  Check,
} from 'lucide-react';
import {
  parseImport,
  confirmImport,
  getImportStatus,
  getImportHistory,
  createVolume,
  type ImportSource,
  type ChapterPatternType,
  type ConflictStrategy,
  type ChapterPreview,
  type ImportStatusResponse,
  type ImportHistoryItem,
} from '@/services/ai-writing/api';
import { formatDateSafe } from '@/lib/utils/date';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui';
import { Modal } from '@/components/ui/dialogs/Modal';

interface ChapterImportModalProps {
  projectId: string;
  volumes: Array<{ id: string; title: string; volumeNumber: number }>;
  onSuccess?: () => void;
  onClose: () => void;
}

type Step = 'input' | 'preview' | 'importing' | 'complete' | 'history';

const IMPORT_SOURCES: Record<ImportSource, { label: string; icon: ReactNode }> =
  {
    PASTE: { label: '粘贴文本', icon: <Clipboard className="h-3.5 w-3.5" /> },
    FILE_TXT: { label: 'TXT 文件', icon: <File className="h-3.5 w-3.5" /> },
    FILE_DOCX: {
      label: 'Word 文档',
      icon: <FileText className="h-3.5 w-3.5" />,
    },
    FILE_EPUB: {
      label: 'EPUB 电子书',
      icon: <Library className="h-3.5 w-3.5" />,
    },
    FILE_MD: { label: 'Markdown', icon: <FileCode className="h-3.5 w-3.5" /> },
    URL_QIDIAN: {
      label: '起点中文网',
      icon: <Globe className="h-3.5 w-3.5" />,
    },
    URL_JJWXC: { label: '晋江文学城', icon: <Globe className="h-3.5 w-3.5" /> },
    URL_FANQIE: { label: '番茄小说', icon: <Globe className="h-3.5 w-3.5" /> },
    URL_OTHER: { label: '其他网站', icon: <Globe className="h-3.5 w-3.5" /> },
  };

const PATTERN_OPTIONS: Record<ChapterPatternType, string> = {
  auto: '自动检测',
  standard_chinese: '标准中文 (第X章)',
  chapter_number: '章节编号 (Chapter X)',
  numbered: '数字编号 (1. 2. 3.)',
  custom: '自定义正则',
};

export default function ChapterImportModal({
  projectId,
  volumes,
  onSuccess,
  onClose,
}: ChapterImportModalProps) {
  const [step, setStep] = useState<Step>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 本地卷列表（可能包含自动创建的卷）
  const [localVolumes, setLocalVolumes] = useState(volumes);
  const [isCreatingVolume, setIsCreatingVolume] = useState(false);

  // 输入状态
  const [source, setSource] = useState<ImportSource>('PASTE');
  const [content, setContent] = useState('');
  const [chapterPattern, setChapterPattern] =
    useState<ChapterPatternType>('auto');
  const [customPattern, setCustomPattern] = useState('');

  // 预览状态
  const [importId, setImportId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    totalChapters: number;
    totalWords: number;
    chapters: ChapterPreview[];
  } | null>(null);
  const [selectedChapters, setSelectedChapters] = useState<number[]>([]);

  // 导入配置
  const [targetVolumeId, setTargetVolumeId] = useState<string>(
    volumes[0]?.id || ''
  );
  const [startChapterNumber, setStartChapterNumber] = useState(1);
  const [conflictStrategy, setConflictStrategy] =
    useState<ConflictStrategy>('skip');
  const [runConsistencyCheck, setRunConsistencyCheck] = useState(true);
  const [extractToBible, setExtractToBible] = useState(true);

  // 导入进度
  const [importStatus, setImportStatus] = useState<ImportStatusResponse | null>(
    null
  );

  // 历史记录
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);

  // ★ 当没有卷时，自动创建默认卷
  useEffect(() => {
    const autoCreateDefaultVolume = async () => {
      if (
        volumes.length === 0 &&
        !isCreatingVolume &&
        localVolumes.length === 0
      ) {
        setIsCreatingVolume(true);
        try {
          const newVolume = await createVolume(projectId, {
            title: '正文',
            volumeNumber: 1,
          });
          setLocalVolumes([
            {
              id: newVolume.id,
              title: newVolume.title,
              volumeNumber: newVolume.volumeNumber,
            },
          ]);
          setTargetVolumeId(newVolume.id);
        } catch (err) {
          setError('自动创建默认卷失败，请手动创建卷后再导入');
        } finally {
          setIsCreatingVolume(false);
        }
      }
    };
    autoCreateDefaultVolume();
  }, [volumes, projectId, isCreatingVolume, localVolumes.length]);

  // ★ 同步外部 volumes 变化
  useEffect(() => {
    if (volumes.length > 0) {
      setLocalVolumes(volumes);
      if (!targetVolumeId) {
        setTargetVolumeId(volumes[0].id);
      }
    }
  }, [volumes, targetVolumeId]);

  // 解析导入内容
  const handleParse = async () => {
    if (!content.trim()) {
      setError('请输入要导入的内容');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const result = await parseImport(projectId, {
        source,
        content,
        chapterPattern,
        customPattern: chapterPattern === 'custom' ? customPattern : undefined,
      });

      setImportId(result.importId);
      setPreview(result.preview);
      setSelectedChapters(result.preview.chapters.map((c) => c.index));
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败');
    } finally {
      setLoading(false);
    }
  };

  // 确认导入
  const handleConfirmImport = async () => {
    if (!importId || !targetVolumeId || selectedChapters.length === 0) return;

    try {
      setLoading(true);
      setError(null);

      await confirmImport(projectId, importId, {
        targetVolumeId,
        startChapterNumber,
        selectedChapters,
        conflictStrategy,
        postProcess: {
          runConsistencyCheck,
          extractToBible,
        },
      });

      setStep('importing');
      pollImportStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
      setLoading(false);
    }
  };

  // 轮询导入状态
  const pollImportStatus = useCallback(async () => {
    if (!importId) return;

    try {
      const status = await getImportStatus(projectId, importId);
      setImportStatus(status);

      if (status.status === 'COMPLETED') {
        setStep('complete');
        setLoading(false);
      } else if (status.status === 'FAILED') {
        setError('导入失败');
        setLoading(false);
      } else {
        // 继续轮询
        setTimeout(pollImportStatus, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取状态失败');
      setLoading(false);
    }
  }, [importId, projectId]);

  // 加载历史记录
  const loadHistory = async () => {
    try {
      setLoading(true);
      const result = await getImportHistory(projectId);
      setHistory(result.items);
      setStep('history');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载历史失败');
    } finally {
      setLoading(false);
    }
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (!preview) return;
    if (selectedChapters.length === preview.chapters.length) {
      setSelectedChapters([]);
    } else {
      setSelectedChapters(preview.chapters.map((c) => c.index));
    }
  };

  // 格式化时间
  const formatTime = (dateStr: string) => {
    return formatDateSafe(dateStr, 'datetime');
  };

  const subtitle =
    step === 'input'
      ? '粘贴或上传内容以导入章节'
      : step === 'preview'
        ? '预览解析结果并选择要导入的章节'
        : step === 'importing'
          ? '正在导入中...'
          : step === 'complete'
            ? '导入完成'
            : '导入历史记录';

  const footerButtons = (
    <div className="flex w-full items-center justify-between">
      <button
        onClick={() => {
          if (step === 'preview') {
            setStep('input');
          } else if (step === 'history') {
            setStep('input');
          } else {
            onClose();
          }
        }}
        className="rounded px-4 py-2 text-gray-600 hover:bg-gray-100"
      >
        {step === 'preview' || step === 'history' ? '← 返回' : '取消'}
      </button>

      <div className="flex gap-2">
        {step === 'input' && (
          <button
            onClick={handleParse}
            disabled={loading || !content.trim()}
            className="rounded bg-violet-600 px-4 py-2 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? '解析中...' : '解析内容'}
          </button>
        )}

        {step === 'preview' && (
          <button
            onClick={handleConfirmImport}
            disabled={
              loading || selectedChapters.length === 0 || !targetVolumeId
            }
            className="rounded bg-violet-600 px-4 py-2 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {loading ? '导入中...' : `导入 ${selectedChapters.length} 个章节`}
          </button>
        )}

        {step === 'complete' && (
          <button
            onClick={() => {
              onSuccess?.();
              onClose();
            }}
            className="rounded bg-violet-600 px-4 py-2 text-white hover:bg-violet-700"
          >
            完成
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          <span>导入章节</span>
          {step === 'input' && (
            <button
              onClick={loadHistory}
              className="ml-2 flex items-center gap-1 rounded px-2 py-1 text-sm font-normal text-gray-600 hover:bg-gray-100"
            >
              <ClipboardList className="h-3.5 w-3.5" /> 历史记录
            </button>
          )}
        </span>
      }
      subtitle={subtitle}
      size="2xl"
      footer={footerButtons}
      footerClassName="px-6 py-4"
    >
      {/* 错误提示 */}
      {error && (
        <div className="mb-4 rounded bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            关闭
          </button>
        </div>
      )}

      {/* 内容区 */}
      <div className="space-y-4">
        {/* 步骤1: 输入 */}
        {step === 'input' && (
          <div className="space-y-6">
            {/* 来源选择 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                导入来源
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(IMPORT_SOURCES)
                  .filter(([key]) =>
                    ['PASTE', 'FILE_TXT', 'FILE_MD'].includes(key)
                  )
                  .map(([key, config]) => (
                    <button
                      key={key}
                      onClick={() => setSource(key as ImportSource)}
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        source === key
                          ? 'border-violet-400 bg-violet-50 text-violet-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {config.icon} {config.label}
                    </button>
                  ))}
              </div>
            </div>

            {/* 章节分割模式 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                章节分割模式
              </label>
              <select
                value={chapterPattern}
                onChange={(e) =>
                  setChapterPattern(e.target.value as ChapterPatternType)
                }
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              >
                {Object.entries(PATTERN_OPTIONS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              {chapterPattern === 'custom' && (
                <input
                  type="text"
                  value={customPattern}
                  onChange={(e) => setCustomPattern(e.target.value)}
                  placeholder="输入正则表达式..."
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              )}
            </div>

            {/* 内容输入 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                内容 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="粘贴要导入的小说内容...

支持的格式:
第一章 开端
内容...

第二章 发展
内容..."
                className="h-64 w-full rounded-lg border border-gray-200 p-4 text-sm focus:border-violet-400 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                已输入 {content.length.toLocaleString()} 字符
              </p>
            </div>
          </div>
        )}

        {/* 步骤2: 预览 */}
        {step === 'preview' && preview && (
          <div className="space-y-6">
            {/* 统计 */}
            <div className="flex items-center justify-between rounded-lg bg-gray-50 p-4">
              <div className="flex gap-6">
                <div>
                  <p className="text-2xl font-bold text-violet-600">
                    {preview.totalChapters}
                  </p>
                  <p className="text-sm text-gray-500">章节</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-violet-600">
                    {preview.totalWords.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-500">总字数</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">
                    {selectedChapters.length}
                  </p>
                  <p className="text-sm text-gray-500">已选择</p>
                </div>
              </div>
              <button
                onClick={toggleSelectAll}
                className="rounded px-3 py-1.5 text-sm text-violet-600 hover:bg-violet-50"
              >
                {selectedChapters.length === preview.chapters.length
                  ? '取消全选'
                  : '全选'}
              </button>
            </div>

            {/* 章节列表 */}
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {preview.chapters.map((chapter) => (
                <label
                  key={chapter.index}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    selectedChapters.includes(chapter.index)
                      ? 'border-violet-300 bg-violet-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedChapters.includes(chapter.index)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedChapters([
                          ...selectedChapters,
                          chapter.index,
                        ]);
                      } else {
                        setSelectedChapters(
                          selectedChapters.filter((i) => i !== chapter.index)
                        );
                      }
                    }}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-violet-600"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">
                        {chapter.title}
                      </span>
                      <span className="text-xs text-gray-400">
                        {chapter.wordCount.toLocaleString()} 字
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                      {chapter.preview}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {/* 导入配置 */}
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-200 p-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  目标卷
                </label>
                <select
                  value={targetVolumeId}
                  onChange={(e) => setTargetVolumeId(e.target.value)}
                  className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
                  disabled={isCreatingVolume}
                >
                  {isCreatingVolume ? (
                    <option value="">创建默认卷中...</option>
                  ) : localVolumes.length === 0 ? (
                    <option value="">暂无可用卷</option>
                  ) : (
                    localVolumes.map((v) => (
                      <option key={v.id} value={v.id}>
                        第{v.volumeNumber}卷 {v.title}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  起始章节号
                </label>
                <input
                  type="number"
                  min={1}
                  value={startChapterNumber}
                  onChange={(e) =>
                    setStartChapterNumber(parseInt(e.target.value) || 1)
                  }
                  className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  冲突处理
                </label>
                <select
                  value={conflictStrategy}
                  onChange={(e) =>
                    setConflictStrategy(e.target.value as ConflictStrategy)
                  }
                  className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="skip">跳过已存在</option>
                  <option value="overwrite">覆盖已存在</option>
                  <option value="append">追加内容</option>
                </select>
              </div>

              <div className="flex flex-col justify-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={runConsistencyCheck}
                    onChange={(e) => setRunConsistencyCheck(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-violet-600"
                  />
                  导入后检查一致性
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={extractToBible}
                    onChange={(e) => setExtractToBible(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-violet-600"
                  />
                  自动提取设定到圣经
                </label>
              </div>
            </div>
          </div>
        )}

        {/* 步骤3: 导入中 */}
        {step === 'importing' && importStatus && (
          <div className="flex flex-col items-center justify-center py-12">
            <LoadingState size="lg" text="正在导入..." />
            {importStatus.progress && (
              <div className="mt-4 w-full max-w-md">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>
                    {importStatus.progress.current} /{' '}
                    {importStatus.progress.total}
                  </span>
                  <span>{importStatus.progress.currentChapter}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{
                      width: `${(importStatus.progress.current / importStatus.progress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 步骤4: 完成 */}
        {step === 'complete' && importStatus && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <p className="text-lg font-medium text-gray-800">导入完成</p>
            {importStatus.result && (
              <div className="mt-4 text-center text-sm text-gray-500">
                <p>
                  成功导入 {importStatus.result.importedChapterIds.length}{' '}
                  个章节
                </p>
                {importStatus.result.skippedCount > 0 && (
                  <p>跳过 {importStatus.result.skippedCount} 个章节</p>
                )}
                {importStatus.result.errors.length > 0 && (
                  <p className="text-red-500">
                    失败 {importStatus.result.errors.length} 个章节
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 历史记录 */}
        {step === 'history' && (
          <div className="space-y-3">
            {history.length === 0 ? (
              <EmptyState size="sm" title="暂无导入历史" />
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-gray-200 bg-white p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{IMPORT_SOURCES[item.source].icon}</span>
                      <span className="font-medium text-gray-800">
                        {item.fileName || IMPORT_SOURCES[item.source].label}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          item.status === 'COMPLETED'
                            ? 'bg-green-100 text-green-700'
                            : item.status === 'FAILED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {formatTime(item.createdAt)}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-4 text-sm text-gray-500">
                    <span>{item.totalChapters} 章节</span>
                    <span>{item.totalWords.toLocaleString()} 字</span>
                    <span>导入 {item.importedChapterIds.length} 章</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
