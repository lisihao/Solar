'use client';

/**
 * Shared Image Page
 *
 * Public page for viewing shared images (no login required)
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { config } from '@/lib/utils/config';
import { useTranslation } from '@/lib/i18n';
import ClientDate from '@/components/common/ClientDate';

interface SharedImage {
  id: string;
  imageUrl: string;
  prompt: string;
  enhancedPrompt?: string;
  width: number;
  height: number;
  createdAt: string;
  userName?: string;
}

// Icons
const LoaderIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const AlertIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

const ImageIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
    />
  </svg>
);

async function fetchPublicImage(id: string): Promise<SharedImage | null> {
  const response = await fetch(`${config.apiUrl}/ai-image/public/${id}`);
  const result = await response.json();
  // Handle wrapped response { success: true, data: {...} }
  const data = result?.data ?? result;

  // Check if we got a valid image or an error response
  if (data?.success === false || !data?.id) {
    return null;
  }

  return data;
}

export default function SharedImagePage() {
  const params = useParams();
  const imageId = params?.id as string;
  const { t } = useTranslation();

  const [image, setImage] = useState<SharedImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imageId) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const imageData = await fetchPublicImage(imageId);

        if (!imageData) {
          setError('Image not found or not public');
          return;
        }

        setImage(imageData);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load image, please check the link'
        );
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [imageId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <LoaderIcon className="h-10 w-10 animate-spin text-blue-500" />
          <p className="text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !image) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="mx-4 max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
          <AlertIcon className="mx-auto mb-4 h-12 w-12 text-red-500" />
          <h1 className="mb-2 text-xl font-semibold text-gray-900">
            {t('share.imageNotAccessible')}
          </h1>
          <p className="mb-6 text-gray-600">
            {error || t('share.imageNotPublic')}
          </p>
          <a
            href="/"
            className="inline-block rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
          >
            {t('common.backToHome')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-md">
              <ImageIcon className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <span className="mb-1 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-600">
                AI {t('aiImage.title')}
              </span>
              <h1 className="line-clamp-2 text-xl font-bold text-gray-900">
                {image.prompt}
              </h1>
              {image.userName && (
                <p className="mt-1 text-sm text-gray-500">
                  {t('share.createdBy')} {image.userName}
                </p>
              )}
            </div>
          </div>

          {/* Meta Info */}
          <div className="mt-4 flex items-center gap-6 text-sm text-gray-500">
            <span>
              {image.width} x {image.height}
            </span>
            <span>
              {t('share.createdAt')}:{' '}
              <ClientDate date={image.createdAt} format="date" />
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          {/* Image */}
          <div className="flex items-center justify-center bg-gray-100 p-4">
            <img
              src={image.imageUrl}
              alt={image.prompt}
              className="max-h-[70vh] rounded-lg object-contain shadow-md"
              style={{
                aspectRatio: `${image.width}/${image.height}`,
              }}
            />
          </div>

          {/* Details */}
          <div className="border-t p-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">
              {t('share.promptUsed')}
            </h2>
            <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
              {image.prompt}
            </p>

            {image.enhancedPrompt && image.enhancedPrompt !== image.prompt && (
              <>
                <h2 className="mb-2 mt-4 text-sm font-semibold text-gray-900">
                  {t('share.enhancedPrompt')}
                </h2>
                <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                  {image.enhancedPrompt}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-400">
          <p>{t('share.poweredBy', { brandName: config.brand.fullName })}</p>
        </div>
      </main>
    </div>
  );
}
