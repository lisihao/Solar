'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MessageSquarePlus,
  Bug,
  Lightbulb,
  Zap,
  MessageCircle,
  Send,
  Loader2,
  X,
  Upload,
  AlertCircle,
} from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Button } from '@/components/ui/primitives/button';
import { useTranslation } from '@/lib/i18n';
import { createLogger } from '@/lib/utils/logger';
import { useFeedbackSubmit, type FeedbackType } from './useFeedbackSubmit';

const log = createLogger('FeedbackWidget');

// 与 app/feedback/page.tsx 保持一致的约束
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5; // 含截图在内
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
];

const FEEDBACK_TYPES: Array<{ value: FeedbackType; icon: typeof Bug }> = [
  { value: 'bug', icon: Bug },
  { value: 'feature', icon: Lightbulb },
  { value: 'improvement', icon: Zap },
  { value: 'other', icon: MessageCircle },
];

interface ExtraFile {
  file: File;
  preview?: string;
}

/**
 * 全局浮动反馈 widget。
 *
 * 核心价值：在「出问题的页面」一键截屏 + 文字反馈，记录的 url 是问题发生页
 * （截屏前捕获 window.location.href），而非 /feedback 页。
 *
 * 截屏：动态 import html2canvas（避免进首屏 bundle），截 document.body 后
 * canvas.toBlob('image/png') 得截图 File。截屏期间隐藏 widget 自身，避免截到按钮。
 *
 * 降级：html2canvas 在跨域 canvas / CSP 受限时会抛错 —— catch 后提示「截图失败，
 * 可手动上传」，弹窗仍打开，不阻断文字反馈（CLAUDE.md 错误路径完整原则）。
 *
 * 入口未在此挂载 —— 由主控决定挂到 providers.tsx / AppShell（见返回说明）。
 */
export function FeedbackWidget() {
  const { t } = useTranslation();
  const submitState = useFeedbackSubmit();

  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hideTrigger, setHideTrigger] = useState(false);

  const [feedbackType, setFeedbackType] = useState<FeedbackType>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(
    null
  );
  const [screenshotError, setScreenshotError] = useState(false);
  const [extraFiles, setExtraFiles] = useState<ExtraFile[]>([]);
  // 出问题页面的 URL —— 必须在截屏「之前」捕获
  const [capturedUrl, setCapturedUrl] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 卸载时清理所有 object URL，避免内存泄漏
  useEffect(() => {
    return () => {
      if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
      extraFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    };
    // 仅在卸载时清理；运行期清理在各 setter 处单独处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 截当前页面 → PNG File。失败抛错由调用方处理降级。 */
  const captureScreenshot = useCallback(async (): Promise<File> => {
    // 隐藏 widget 自身，避免把浮动按钮截进去
    setHideTrigger(true);
    try {
      // 动态 import：html2canvas 体积大，懒加载避免进首屏 bundle
      const mod = await import('html2canvas');
      const html2canvas = mod.default;
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        // 限制比例，避免超大页面生成过大图片
        scale: Math.min(window.devicePixelRatio || 1, 2),
      });

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!blob) throw new Error('canvas.toBlob returned null');

      return new File([blob], `screenshot-${Date.now()}.png`, {
        type: 'image/png',
      });
    } finally {
      setHideTrigger(false);
    }
  }, []);

  /** 点击浮动按钮：先捕获 url（出问题页）→ 尝试截屏 → 打开弹窗 */
  const handleOpen = useCallback(async () => {
    // 截屏前捕获：保证是问题发生的页面
    setCapturedUrl(window.location.href);
    setCapturing(true);
    setScreenshotError(false);

    try {
      const file = await captureScreenshot();
      setScreenshot(file);
      setScreenshotPreview(URL.createObjectURL(file));
    } catch (err) {
      // 降级：截图失败不阻断文字反馈
      log.warn('screenshot capture failed, falling back to manual upload', err);
      setScreenshot(null);
      setScreenshotPreview(null);
      setScreenshotError(true);
    } finally {
      setCapturing(false);
      setOpen(true);
    }
  }, [captureScreenshot]);

  const handleRetake = useCallback(async () => {
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshot(null);
    setScreenshotPreview(null);
    setScreenshotError(false);
    setCapturing(true);
    // 关闭弹窗以便截到干净页面，截完再开
    setOpen(false);
    try {
      const file = await captureScreenshot();
      setScreenshot(file);
      setScreenshotPreview(URL.createObjectURL(file));
    } catch (err) {
      log.warn('screenshot retake failed', err);
      setScreenshotError(true);
    } finally {
      setCapturing(false);
      setOpen(true);
    }
  }, [captureScreenshot, screenshotPreview]);

  const removeScreenshot = useCallback(() => {
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshot(null);
    setScreenshotPreview(null);
  }, [screenshotPreview]);

  const handleExtraFiles = useCallback(
    (list: FileList) => {
      const screenshotCount = screenshot ? 1 : 0;
      const next: ExtraFile[] = [];
      for (const file of Array.from(list)) {
        if (screenshotCount + extraFiles.length + next.length >= MAX_FILES) {
          setFileError(t('feedback.maxFiles', { count: MAX_FILES }));
          break;
        }
        if (file.size > MAX_FILE_SIZE) {
          setFileError(t('feedback.allowedFiles'));
          continue;
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
          setFileError(t('feedback.allowedFiles'));
          continue;
        }
        next.push({
          file,
          preview: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : undefined,
        });
      }
      if (next.length > 0) {
        setExtraFiles((prev) => [...prev, ...next]);
        setFileError(null);
      }
    },
    [screenshot, extraFiles.length, t]
  );

  const removeExtraFile = useCallback((index: number) => {
    setExtraFiles((prev) => {
      const copy = [...prev];
      const [removed] = copy.splice(index, 1);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  }, []);

  const resetAll = useCallback(() => {
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    extraFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setScreenshot(null);
    setScreenshotPreview(null);
    setScreenshotError(false);
    setExtraFiles([]);
    setTitle('');
    setDescription('');
    setFeedbackType('bug');
    setFileError(null);
    setCapturedUrl('');
    submitState.reset();
  }, [screenshotPreview, extraFiles, submitState]);

  const handleClose = useCallback(() => {
    setOpen(false);
    resetAll();
  }, [resetAll]);

  const handleSubmit = useCallback(async () => {
    const files: File[] = [];
    if (screenshot) files.push(screenshot);
    files.push(...extraFiles.map((f) => f.file));

    try {
      await submitState.submit({
        type: feedbackType,
        title,
        description,
        url: capturedUrl, // 出问题的页面，截屏前捕获
        files,
      });
      // 成功后短暂展示成功态再关闭
      setOpen(false);
      resetAll();
    } catch {
      // 错误已由 hook 写入 submitState.error，弹窗保持打开展示
    }
  }, [
    screenshot,
    extraFiles,
    submitState,
    feedbackType,
    title,
    description,
    capturedUrl,
    resetAll,
  ]);

  const canSubmit =
    !!title.trim() && !!description.trim() && !submitState.submitting;

  return (
    <>
      {/* 浮动触发按钮：右下角，z-[60] 高于 SideDrawer/Modal 的 z-50（抽屉打开时反馈入口仍可达）；
          截屏期间隐藏；弹窗打开期间隐藏（防止重复点击重新截屏覆盖草稿） */}
      {!hideTrigger && !open && (
        <button
          type="button"
          onClick={handleOpen}
          disabled={capturing}
          aria-label={t('feedback.openFeedback')}
          data-export-exclude
          className="fixed bottom-6 right-6 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 disabled:opacity-60"
        >
          {capturing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <MessageSquarePlus className="h-5 w-5" />
          )}
        </button>
      )}

      <Modal
        open={open}
        onClose={handleClose}
        title={t('feedback.quickFeedback')}
        subtitle={capturedUrl || undefined}
        size="lg"
        closeButtonDisabled={submitState.submitting}
        // 防误触：点遮罩不关闭，避免正在填写的反馈被一键点丢（只能 X / 取消显式关闭）
        closeOnOverlayClick={false}
        footer={
          <>
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={submitState.submitting}
            >
              {t('feedback.cancel')}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {submitState.submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('feedback.submitting')}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {t('feedback.submit')}
                </>
              )}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {/* 提交错误（不静默吞掉） */}
          {submitState.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{submitState.error}</span>
            </div>
          )}

          {/* 截图预览 / 截图失败降级 */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              {t('feedback.screenshotPreview')}
            </p>
            {screenshotPreview ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotPreview}
                  alt={t('feedback.screenshotPreview')}
                  className="max-h-48 rounded-lg border border-gray-200 object-contain"
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRetake()}
                    disabled={capturing}
                  >
                    {t('feedback.retakeScreenshot')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={removeScreenshot}
                    disabled={capturing}
                  >
                    {t('feedback.removeScreenshot')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                {screenshotError
                  ? t('feedback.screenshotFailed')
                  : t('feedback.capturing')}
              </div>
            )}
          </div>

          {/* 反馈类型 */}
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">
              {t('feedback.whatType')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {FEEDBACK_TYPES.map(({ value, icon: Icon }) => {
                const selected = feedbackType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFeedbackType(value)}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors ${
                      selected
                        ? 'border-primary bg-primary/5 text-gray-900'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${selected ? 'text-primary' : 'text-gray-500'}`}
                    />
                    {t(`feedback.feedbackType.${value}`)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 标题 */}
          <div>
            <label
              htmlFor="feedback-widget-title"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              {t('feedback.feedbackTitle')}
            </label>
            <input
              id="feedback-widget-title"
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('feedback.titlePlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* 描述 */}
          <div>
            <label
              htmlFor="feedback-widget-desc"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              {t('feedback.feedbackDescription')}
            </label>
            <textarea
              id="feedback-widget-desc"
              value={description}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t(`feedback.descriptionPlaceholder.${feedbackType}`)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* 追加附件 */}
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <Upload className="h-4 w-4" />
              {t('feedback.addAttachment')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ALLOWED_TYPES.join(',')}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleExtraFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {fileError && (
              <p className="mt-1 text-xs text-red-600">{fileError}</p>
            )}
            {extraFiles.length > 0 && (
              <ul className="mt-2 space-y-1">
                {extraFiles.map((f, i) => (
                  <li
                    key={`${f.file.name}-${i}`}
                    className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700"
                  >
                    <span className="truncate">{f.file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeExtraFile(i)}
                      aria-label={t('feedback.removeScreenshot')}
                      className="ml-2 rounded p-0.5 text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

export default FeedbackWidget;
