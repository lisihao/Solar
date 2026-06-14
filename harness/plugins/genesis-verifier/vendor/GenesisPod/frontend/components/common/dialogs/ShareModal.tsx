'use client';

import { useTranslation } from '@/lib/i18n';
import { toast } from '@/stores';
import { CopyButton } from '@/components/ui/primitives/CopyButton';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  shareUrl: string;
  title: string;
  description?: string;
  imageUrl?: string;
}

export default function ShareModal({
  isOpen,
  onClose,
  shareUrl,
  title,
  description,
  imageUrl,
}: ShareModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);
  const encodedDescription = encodeURIComponent(description || '');

  const shareOptions = [
    {
      id: 'wechat',
      name: t('share.wechat'),
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 01.598.082l1.584.926a.272.272 0 00.14.045c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.49.49 0 01.177-.554C23.212 18.153 24 16.673 24 14.994c0-3.378-3.166-6.136-7.062-6.136zm-2.805 2.753c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982z" />
        </svg>
      ),
      color: 'bg-green-500 hover:bg-green-600 text-white',
      onClick: () => {
        // WeChat requires QR code generation, show a message
        toast.info(t('share.wechatTip'));
      },
    },
    {
      id: 'weibo',
      name: t('share.weibo'),
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.979-.394 7.413 1.404 7.671 4.018.259 2.6-2.759 5.049-6.739 5.443zm-2.756-3.09c-.652-.086-1.399.283-1.689.835-.295.558-.146 1.185.506 1.396.659.218 1.479-.101 1.776-.693.292-.596.057-1.449-.593-1.538zm1.616-.937c-.236-.041-.507.104-.619.338-.107.233-.047.483.163.565.217.084.481-.039.596-.271.111-.232.08-.56-.14-.632zm9.832-3.169c-.199.085-.322.249-.316.449.01.301.258.537.605.567a1.88 1.88 0 001.328-.369c.244-.185.362-.441.314-.682-.066-.318-.383-.548-.77-.548-.143 0-.285.036-.413.104-.259.137-.548.215-.84.215-.154 0-.284-.029-.408-.085-.248-.109-.538-.162-.826-.168-.471-.008-.877.188-1.006.489-.137.324.044.681.408.799.255.083.53.103.807.062.223-.034.424-.117.6-.245.133-.093.196-.126.358-.126.068 0 .159.01.159.038zm-.908-2.616c-.247-.152-.551-.209-.856-.153-.254.046-.465.177-.585.347-.16.227-.14.531.048.682.164.131.391.16.589.069.103-.048.178-.068.325-.102.106-.024.213-.009.321.046.109.056.232.083.355.083.187 0 .363-.073.488-.209.173-.188.171-.504-.024-.68-.078-.071-.16-.108-.26-.126-.141-.026-.281-.05-.401-.057zm3.42 1.418c-.232-.23-.617-.258-.882-.064-.265.193-.316.548-.11.793.177.211.467.279.718.162.285-.132.42-.469.274-.733-.016-.059-.064-.109-.109-.158h.109zm-2.08-.614c.231-.23.274-.584.095-.823-.174-.234-.492-.283-.733-.11-.265.19-.301.555-.082.793.218.24.577.28.82.14h-.1z" />
        </svg>
      ),
      color: 'bg-red-500 hover:bg-red-600 text-white',
      onClick: () => {
        window.open(
          `https://service.weibo.com/share/share.php?url=${encodedUrl}&title=${encodedTitle}`,
          '_blank',
          'width=600,height=400'
        );
      },
    },
    {
      id: 'twitter',
      name: t('share.twitter'),
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      ),
      color: 'bg-black hover:bg-gray-800 text-white',
      onClick: () => {
        window.open(
          `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
          '_blank',
          'width=600,height=400'
        );
      },
    },
    {
      id: 'facebook',
      name: t('share.facebook'),
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      ),
      color: 'bg-blue-600 hover:bg-blue-700 text-white',
      onClick: () => {
        window.open(
          `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
          '_blank',
          'width=600,height=400'
        );
      },
    },
    {
      id: 'linkedin',
      name: t('share.linkedin'),
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      ),
      color: 'bg-blue-700 hover:bg-blue-800 text-white',
      onClick: () => {
        window.open(
          `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
          '_blank',
          'width=600,height=400'
        );
      },
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {t('share.title')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Preview */}
        <div className="mb-6 rounded-xl bg-gray-50 p-4">
          <div className="flex gap-3">
            {imageUrl && (
              <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-200">
                <img
                  src={imageUrl}
                  alt={title}
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium text-gray-900">{title}</h3>
              {description && (
                <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                  {description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Share URL */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            {t('share.shareLink')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
            />
            <CopyButton
              value={shareUrl}
              label={t('share.copy')}
              copiedLabel={t('share.copied')}
            />
          </div>
        </div>

        {/* Share Options */}
        <div>
          <label className="mb-3 block text-sm font-medium text-gray-700">
            {t('share.shareTo')}
          </label>
          <div className="grid grid-cols-3 gap-3">
            {shareOptions.map((option) => (
              <button
                key={option.id}
                onClick={option.onClick}
                className={`flex flex-col items-center gap-2 rounded-xl p-3 transition-colors ${option.color}`}
              >
                {option.icon}
                <span className="text-xs font-medium">{option.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Note for private content */}
        <p className="mt-4 text-center text-xs text-gray-500">
          {t('share.publicNote')}
        </p>
      </div>
    </div>
  );
}
