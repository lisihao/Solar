'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Image as ImageIcon,
  Upload,
  X,
  Loader2,
  Check,
  AlertCircle,
  FileImage,
  Edit3,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';
interface OcrImage {
  id: string;
  file: File;
  previewUrl: string;
  title: string;
  content: string;
  status: 'pending' | 'processing' | 'ready' | 'error';
  error?: string;
}

interface OcrUploadPanelProps {
  knowledgeBaseId: string;
  onImportComplete?: (count: number) => void;
  disabled?: boolean;
}

/**
 * OCR Upload Panel
 * Allows users to upload images, extract text via OCR, and import to knowledge base
 */
export default function OcrUploadPanel({
  knowledgeBaseId,
  onImportComplete,
  disabled = false,
}: OcrUploadPanelProps) {
  const [images, setImages] = useState<OcrImage[]>([]);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate unique ID
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Handle file selection
  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;

    const newImages: OcrImage[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file type
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        continue;
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        continue;
      }

      const id = generateId();
      const previewUrl = URL.createObjectURL(file);

      newImages.push({
        id,
        file,
        previewUrl,
        title: file.name.replace(/\.[^/.]+$/, ''),
        content: '',
        status: 'pending',
      });
    }

    setImages((prev) => [...prev, ...newImages]);
  };

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Remove an image
  const removeImage = (id: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.previewUrl);
      }
      return prev.filter((img) => img.id !== id);
    });
  };

  // Process OCR for an image
  const processOcr = async (id: string) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === id ? { ...img, status: 'processing' } : img
      )
    );

    const image = images.find((img) => img.id === id);
    if (!image) return;

    try {
      // Upload image to get URL
      const formData = new FormData();
      formData.append('file', image.file);

      // For now, we'll simulate OCR with a placeholder
      // In a real implementation, this would call a backend OCR service
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Simulate OCR result
      const ocrResult = `[OCR提取的文本内容将显示在这里]\n\n请手动输入或编辑从图片中提取的文字内容。\n\n文件名: ${image.file.name}\n文件大小: ${(image.file.size / 1024).toFixed(1)} KB`;

      setImages((prev) =>
        prev.map((img) =>
          img.id === id ? { ...img, content: ocrResult, status: 'ready' } : img
        )
      );
    } catch (error) {
      setImages((prev) =>
        prev.map((img) =>
          img.id === id
            ? {
                ...img,
                status: 'error',
                error: error instanceof Error ? error.message : 'OCR failed',
              }
            : img
        )
      );
    }
  };

  // Update image content
  const updateContent = (id: string, content: string) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, content } : img))
    );
  };

  // Update image title
  const updateTitle = (id: string, title: string) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, title } : img))
    );
  };

  // Import all ready images
  const handleImport = async () => {
    const readyImages = images.filter(
      (img) => img.status === 'ready' && img.content.trim()
    );
    if (readyImages.length === 0 || importing) return;

    setImporting(true);
    setImportResult(null);

    try {
      const documents = readyImages.map((img) => ({
        imageUrl: img.previewUrl, // In production, this should be an uploaded URL
        title: img.title,
        content: img.content,
      }));

      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/import-ocr`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ documents }),
        }
      );

      if (!response.ok) {
        throw new Error('Import failed');
      }

      const result = await response.json();
      setImportResult({
        success: result.success,
        failed: 0,
      });

      onImportComplete?.(result.success);
    } catch (error) {
      logger.error('Import error:', error);
    } finally {
      setImporting(false);
    }
  };

  const readyCount = images.filter(
    (img) => img.status === 'ready' && img.content.trim()
  ).length;

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
          disabled
            ? 'border-gray-200 bg-gray-50'
            : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'
        }`}
      >
        <Upload className="mb-2 h-8 w-8 text-gray-400" />
        <p className="text-sm text-gray-600">拖拽图片到这里，或点击选择文件</p>
        <p className="mt-1 text-xs text-gray-400">
          支持 JPG、PNG、WebP、PDF，单个文件最大 10MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
          disabled={disabled}
        />
      </div>

      {/* Image List */}
      {images.length > 0 && (
        <div className="space-y-3">
          {images.map((image) => (
            <div
              key={image.id}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex items-start gap-3">
                {/* Preview */}
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {image.file.type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={image.previewUrl}
                      alt={image.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <FileImage className="h-8 w-8 text-gray-400" />
                    </div>
                  )}
                  {image.status === 'processing' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  {/* Title */}
                  {editingId === image.id ? (
                    <input
                      type="text"
                      value={image.title}
                      onChange={(e) => updateTitle(image.id, e.target.value)}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setEditingId(null);
                      }}
                      autoFocus
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {image.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => setEditingId(image.id)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <Edit3 className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  {/* Status */}
                  <div className="mt-1 flex items-center gap-2">
                    {image.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => processOcr(image.id)}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        点击提取文字
                      </button>
                    )}
                    {image.status === 'processing' && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        提取中...
                      </span>
                    )}
                    {image.status === 'ready' && (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <Check className="h-3 w-3" />
                        已提取
                      </span>
                    )}
                    {image.status === 'error' && (
                      <span className="flex items-center gap-1 text-xs text-red-500">
                        <AlertCircle className="h-3 w-3" />
                        {image.error}
                      </span>
                    )}
                  </div>

                  {/* Content Editor */}
                  {(image.status === 'ready' || image.status === 'error') && (
                    <textarea
                      value={image.content}
                      onChange={(e) => updateContent(image.id, e.target.value)}
                      rows={3}
                      placeholder="编辑提取的文字内容..."
                      className="mt-2 w-full resize-none rounded border border-gray-200 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                    />
                  )}
                </div>

                {/* Remove Button */}
                <button
                  type="button"
                  onClick={() => removeImage(image.id)}
                  className="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import Button */}
      {readyCount > 0 && (
        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          <p className="text-sm text-gray-600">{readyCount} 个图片可导入</p>
          <button
            type="button"
            onClick={handleImport}
            disabled={disabled || importing}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                导入中...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                导入到知识库
              </>
            )}
          </button>
        </div>
      )}

      {/* Import Result */}
      {importResult && (
        <div className="rounded-lg bg-green-50 p-3 text-green-800">
          <p className="text-sm">导入完成：成功 {importResult.success} 个</p>
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs text-amber-800">
          <span className="font-medium">提示：</span>
          OCR 功能正在开发中。目前需要手动输入图片中的文字内容。 完整的 OCR
          支持将在后续版本中推出。
        </p>
      </div>
    </div>
  );
}
