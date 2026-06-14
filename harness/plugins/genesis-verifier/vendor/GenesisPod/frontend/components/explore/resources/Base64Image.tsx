/**
 * Base64 Image Component
 * Displays base64-encoded images with loading and error states
 */

import { useState } from 'react';

interface Base64ImageProps {
  src: string;
  alt: string;
}

export function Base64Image({ src, alt }: Base64ImageProps) {
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  if (imgError) {
    return (
      <div className="my-3 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
        <span className="block text-red-600">Image failed to load</span>
        <span className="mt-1 block text-xs text-gray-500">{imgError}</span>
        <a
          href={src}
          download={`generated-image-${Date.now()}.png`}
          className="mt-2 inline-block text-sm text-blue-600 hover:underline"
        >
          Download Image
        </a>
      </div>
    );
  }

  return (
    <div className="my-3">
      {!imgLoaded && (
        <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`max-w-full rounded-lg shadow-md ${imgLoaded ? 'block' : 'hidden'}`}
        onLoad={() => setImgLoaded(true)}
        onError={() => {
          const sizeKB = Math.round(src.length / 1024);
          setImgError(`Failed to decode (${sizeKB} KB)`);
        }}
      />
      {imgLoaded && (
        <a
          href={src}
          download={`generated-image-${Date.now()}.png`}
          className="mt-2 inline-block text-sm text-blue-600 hover:underline"
        >
          Download Image
        </a>
      )}
    </div>
  );
}
