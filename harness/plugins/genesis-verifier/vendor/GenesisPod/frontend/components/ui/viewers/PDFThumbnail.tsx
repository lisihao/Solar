'use client';

import { useEffect, useRef, useState } from 'react';

import { logger } from '@/lib/utils/logger';
interface PDFThumbnailProps {
  pdfUrl: string;
  alt: string;
  className?: string;
}

export default function PDFThumbnail({
  pdfUrl,
  alt,
  className = '',
}: PDFThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderPDF() {
      if (!canvasRef.current || !pdfUrl) return;

      try {
        setLoading(true);
        setError(false);

        // Dynamic import of pdfjs-dist to avoid SSR issues
        const pdfjsLib = await import('pdfjs-dist');

        // Configure worker - use unpkg which has latest versions
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

        // Load PDF document
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        if (cancelled) return;

        // Get first page
        const page = await pdf.getPage(1);

        if (cancelled) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        // Calculate scale to fit container
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          canvas.width / viewport.width,
          canvas.height / viewport.height
        );
        const scaledViewport = page.getViewport({ scale });

        // Set canvas dimensions
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        // Render PDF page
        await page.render({
          canvas: canvas,
          canvasContext: context,
          viewport: scaledViewport,
        }).promise;

        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        logger.error('Failed to render PDF thumbnail:', err);
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    }

    void renderPDF();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className}`}
      >
        <svg
          className="h-12 w-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`h-full w-full object-cover ${loading ? 'opacity-0' : 'opacity-100'}`}
        width={400}
        height={566}
        aria-label={alt}
      />
    </div>
  );
}
