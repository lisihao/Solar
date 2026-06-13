'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

import { logger } from '@/lib/utils/logger';
// 动态导入 pdfjs-dist，仅在客户端加载
const loadPdfJs = async () => {
  if (typeof window === 'undefined') return null;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  return pdfjs;
};

interface PdfThumbnailProps {
  pdfUrl: string;
  className?: string;
}

/**
 * 客户端PDF缩略图组件
 * 使用 PDF.js 在浏览器中渲染PDF第一页作为缩略图
 */
export default function PdfThumbnail({
  pdfUrl,
  className = 'h-full w-full',
}: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const renderPdf = async () => {
      if (!canvasRef.current) return;

      try {
        setIsLoading(true);
        setError(false);

        // 动态加载 pdfjs（仅客户端）
        const pdfjsLib = await loadPdfJs();
        if (!pdfjsLib) {
          setError(true);
          setIsLoading(false);
          return;
        }

        // 加载PDF文档
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        // 获取第一页
        const page = await pdf.getPage(1);

        // 计算缩放比例
        const canvas = canvasRef.current;
        const viewport = page.getViewport({ scale: 1 });

        // 设置canvas尺寸以适应容器
        const container = canvas.parentElement;
        if (!container) return;

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const scale = Math.min(
          containerWidth / viewport.width,
          containerHeight / viewport.height
        );

        const scaledViewport = page.getViewport({ scale });

        // 设置canvas尺寸
        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;

        // 渲染PDF页面
        const context = canvas.getContext('2d');
        if (!context) return;

        const renderContext = {
          canvasContext: context,
          viewport: scaledViewport,
          canvas: canvas,
        };

        await page.render(renderContext).promise;

        if (isMounted) {
          setIsLoading(false);
        }
      } catch (err) {
        logger.error('Failed to render PDF:', err);
        if (isMounted) {
          setError(true);
          setIsLoading(false);
        }
      }
    };

    renderPdf();

    return () => {
      isMounted = false;
    };
  }, [pdfUrl]);

  if (error) {
    return null; // 返回null让父组件显示fallback图标
  }

  return (
    <div className={`relative ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`${className} bg-white object-contain ${isLoading ? 'opacity-0' : 'opacity-100'}`}
      />
    </div>
  );
}
