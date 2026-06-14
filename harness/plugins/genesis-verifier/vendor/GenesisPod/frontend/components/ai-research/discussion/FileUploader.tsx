'use client';

import React, { useState, useCallback } from 'react';
import {
  Upload,
  X,
  File,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface UploadedSource {
  id: string;
  url?: string;
  title?: string;
  content?: string;
  type: string;
  fileName?: string;
}

interface UploadError {
  fileName: string;
  error: string;
}

interface UploadResponse {
  sources?: UploadedSource[];
  errors?: UploadError[];
}

interface FileUploaderProps {
  projectId: string;
  onFilesUploaded: (sources: UploadedSource[]) => void;
  onClose: () => void;
}

interface UploadingFile {
  file: File;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
];

export function FileUploader({
  projectId,
  onFilesUploaded,
  onClose,
}: FileUploaderProps) {
  const [files, setFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (f) => ACCEPTED_TYPES.includes(f.type) || f.name.endsWith('.md')
    );

    setFiles((prev) => [
      ...prev,
      ...droppedFiles.map((file) => ({ file, status: 'pending' as const })),
    ]);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;

      const selectedFiles = Array.from(e.target.files);
      setFiles((prev) => [
        ...prev,
        ...selectedFiles.map((file) => ({ file, status: 'pending' as const })),
      ]);
    },
    []
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = async () => {
    if (files.length === 0) return;

    setIsUploading(true);

    const formData = new FormData();
    files.forEach((f) => {
      if (f.status === 'pending') {
        formData.append('files', f.file);
      }
    });

    // Mark all as uploading
    setFiles((prev) =>
      prev.map((f) =>
        f.status === 'pending' ? { ...f, status: 'uploading' as const } : f
      )
    );

    try {
      const tokens = JSON.parse(localStorage.getItem('auth_tokens') || '{}');
      const res = await fetch(
        `${API_BASE}/api/v1/ai-studio/projects/${projectId}/sources/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
          },
          body: formData,
        }
      );

      if (!res.ok) throw new Error('Upload failed');

      const result = (await res.json()) as UploadResponse;

      // Update file statuses
      setFiles((prev) =>
        prev.map((f) => ({
          ...f,
          status: result.errors?.some((e) => e.fileName === f.file.name)
            ? ('failed' as const)
            : ('completed' as const),
          error: result.errors?.find((e) => e.fileName === f.file.name)?.error,
        }))
      );

      onFilesUploaded(result.sources || []);
    } catch (error) {
      setFiles((prev) =>
        prev.map((f) => ({
          ...f,
          status: 'failed' as const,
          error: 'Upload failed',
        }))
      );
    } finally {
      setIsUploading(false);
    }
  };

  const getFileIcon = (file: File) => {
    if (file.type === 'application/pdf') {
      return <FileText className="h-5 w-5 text-red-500" />;
    }
    if (file.type.includes('word')) {
      return <FileText className="h-5 w-5 text-blue-500" />;
    }
    return <File className="h-5 w-5 text-gray-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? 'border-purple-500 bg-purple-50'
            : 'border-gray-300 hover:border-purple-400'
        }`}
      >
        <Upload className="mx-auto mb-3 h-10 w-10 text-gray-400" />
        <p className="mb-2 text-gray-600">
          Drag and drop files here, or{' '}
          <label className="cursor-pointer text-purple-600 hover:underline">
            browse
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.txt,.md"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
        </p>
        <p className="text-xs text-gray-400">
          Supports PDF, Word (.docx, .doc), TXT, Markdown • Max 50MB per file
        </p>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">
            Selected files ({files.length})
          </h4>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  {getFileIcon(f.file)}
                  <div>
                    <p className="max-w-[200px] truncate text-sm font-medium text-gray-900">
                      {f.file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(f.file.size)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {f.status === 'uploading' && (
                    <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                  )}
                  {f.status === 'completed' && (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  )}
                  {f.status === 'failed' && (
                    <div title={f.error}>
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    </div>
                  )}
                  {f.status === 'pending' && (
                    <button
                      onClick={() => removeFile(i)}
                      className="rounded p-1 hover:bg-gray-200"
                    >
                      <X className="h-4 w-4 text-gray-400" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          onClick={handleUpload}
          disabled={
            files.length === 0 ||
            isUploading ||
            files.every((f) => f.status !== 'pending')
          }
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {isUploading && <Loader2 className="h-4 w-4 animate-spin" />}
          Upload & Parse
        </button>
      </div>
    </div>
  );
}
