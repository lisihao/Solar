'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Upload,
  FileText,
  File,
} from 'lucide-react';

type ResourceType =
  | 'PAPER'
  | 'BLOG'
  | 'NEWS'
  | 'YOUTUBE_VIDEO'
  | 'REPORT'
  | 'EVENT'
  | 'RSS';

interface ImportFileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  onImportSuccess: () => void;
  apiBaseUrl: string;
}

type DialogStep = 'select-file' | 'preview' | 'uploading';

const RESOURCE_TYPE_DISPLAY = {
  papers: {
    name: 'Academic Paper',
    type: 'PAPER' as ResourceType,
    accept: '.pdf',
  },
  blogs: {
    name: 'Research Blog',
    type: 'BLOG' as ResourceType,
    accept: '.pdf,.html,.htm',
  },
  reports: {
    name: 'Industry Report',
    type: 'REPORT' as ResourceType,
    accept: '.pdf',
  },
  youtube: {
    name: 'YouTube Video',
    type: 'YOUTUBE_VIDEO' as ResourceType,
    accept: '',
  },
  news: {
    name: 'Tech News',
    type: 'NEWS' as ResourceType,
    accept: '.pdf,.html,.htm',
  },
};

const SUPPORTED_FORMATS = [
  { ext: '.pdf', name: 'PDF Documents', icon: FileText, disabled: false },
  { ext: '.html/.htm', name: 'HTML Files', icon: File, disabled: false },
];

export function ImportFileDialog({
  isOpen,
  onClose,
  activeTab,
  onImportSuccess,
  apiBaseUrl,
}: ImportFileDialogProps) {
  const [step, setStep] = useState<DialogStep>('select-file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [editedTitle, setEditedTitle] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  if (!isOpen) return null;

  const resourceTypeInfo = RESOURCE_TYPE_DISPLAY[
    activeTab as keyof typeof RESOURCE_TYPE_DISPLAY
  ] || {
    name: 'Resource',
    type: 'PAPER' as ResourceType,
    accept: '.pdf',
  };

  const handleClose = () => {
    setStep('select-file');
    setSelectedFile(null);
    setError('');
    setEditedTitle('');
    setUploadProgress(0);
    onClose();
  };

  const handleFileSelect = (file: File) => {
    // Validate file type
    const allowedExtensions = resourceTypeInfo.accept
      .split(',')
      .filter(Boolean);
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (
      allowedExtensions.length > 0 &&
      !allowedExtensions.some((ext) => ext === fileExtension)
    ) {
      setError(`Invalid file type. Please select: ${resourceTypeInfo.accept}`);
      return;
    }

    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      setError('File size exceeds 50MB limit');
      return;
    }

    setSelectedFile(file);
    setEditedTitle(file.name.replace(/\.[^/.]+$/, '')); // Remove extension for title
    setError('');
    setStep('preview');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsLoading(true);
    setStep('uploading');
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('resourceType', resourceTypeInfo.type);
      formData.append('title', editedTitle || selectedFile.name);

      // Simulated progress (since fetch doesn't support upload progress natively)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      const response = await fetch(
        `${apiBaseUrl}/api/v1/data-management/import-file`,
        {
          method: 'POST',
          body: formData,
        }
      );

      clearInterval(progressInterval);
      setUploadProgress(100);

      const result = await response.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      // Success
      setTimeout(() => {
        handleClose();
        onImportSuccess();
      }, 500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setStep('preview');
      setUploadProgress(0);
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">
            Import {resourceTypeInfo.name}
            {step === 'select-file' && ' - Select File'}
            {step === 'preview' && ' - Preview'}
            {step === 'uploading' && ' - Uploading'}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={isLoading}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {/* Step indicator */}
          <div className="mb-4 flex gap-2">
            <div
              className={`h-1 flex-1 rounded ${step === 'select-file' ? 'bg-blue-600' : 'bg-gray-300'}`}
            />
            <div
              className={`h-1 flex-1 rounded ${step === 'preview' ? 'bg-blue-600' : 'bg-gray-300'}`}
            />
            <div
              className={`h-1 flex-1 rounded ${step === 'uploading' ? 'bg-blue-600' : 'bg-gray-300'}`}
            />
          </div>

          {/* Step 1: Select File */}
          {step === 'select-file' && (
            <div className="space-y-4">
              {/* Drag & Drop Zone */}
              <div
                className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={resourceTypeInfo.accept}
                  onChange={handleInputChange}
                  className="hidden"
                />
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-4 text-sm text-gray-600">
                  Drag and drop your file here, or{' '}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="font-medium text-blue-600 hover:text-blue-700"
                  >
                    browse
                  </button>
                </p>
                <p className="mt-2 text-xs text-gray-500">
                  Maximum file size: 50MB
                </p>
              </div>

              {/* Supported Formats */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h4 className="mb-3 text-sm font-semibold text-gray-700">
                  Supported Formats
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  {SUPPORTED_FORMATS.map((format) => {
                    const Icon = format.icon;
                    return (
                      <div
                        key={format.ext}
                        className={`flex items-center gap-2 rounded-lg border p-3 ${
                          format.disabled
                            ? 'border-gray-200 bg-gray-100 text-gray-400'
                            : 'border-gray-300 bg-white text-gray-700'
                        }`}
                      >
                        <Icon size={20} />
                        <div>
                          <p className="text-xs font-medium">{format.ext}</p>
                          <p className="text-xs">{format.name}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Instructions */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <h4 className="mb-2 font-semibold text-blue-900">
                  📋 Instructions
                </h4>
                <ul className="space-y-1 text-sm text-blue-800">
                  <li>✓ Upload PDF files for papers and reports</li>
                  <li>✓ System will extract text and metadata automatically</li>
                  <li>✓ You can edit the title in the next step</li>
                  <li>✓ AI analysis will be available after import</li>
                </ul>
              </div>

              {error && (
                <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                  <AlertCircle size={20} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Error</p>
                    <p className="text-sm">{error}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 'preview' && selectedFile && (
            <div className="space-y-4">
              {/* File Info */}
              <div className="rounded-lg bg-gray-50 p-4">
                <h4 className="mb-3 flex items-center gap-2 font-semibold">
                  <CheckCircle2 size={18} className="text-green-600" />
                  File Selected
                </h4>
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-blue-100">
                    <FileText size={32} className="text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {selectedFile.name}
                    </p>
                    <p className="text-sm text-gray-500">
                      {formatFileSize(selectedFile.size)} •{' '}
                      {selectedFile.type || 'Unknown type'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setStep('select-file');
                    }}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Edit Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Resource Title
                </label>
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="Enter a title for this resource"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  This title will be displayed in your library
                </p>
              </div>

              {/* Resource Type Info */}
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Resource Type</span>
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                    {resourceTypeInfo.name}
                  </span>
                </div>
              </div>

              {error && (
                <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                  <AlertCircle size={20} className="flex-shrink-0" />
                  <p className="text-sm">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Uploading */}
          {step === 'uploading' && (
            <div className="space-y-4 py-8 text-center">
              <Loader2
                size={48}
                className="mx-auto animate-spin text-blue-600"
              />
              <div>
                <p className="text-lg font-semibold text-gray-900">
                  Uploading...
                </p>
                <p className="text-sm text-gray-500">
                  Please wait while we process your file
                </p>
              </div>

              {/* Progress Bar */}
              <div className="mx-auto max-w-xs">
                <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {uploadProgress}% complete
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t px-6 py-4">
          {step === 'preview' && (
            <button
              onClick={() => {
                setSelectedFile(null);
                setError('');
                setStep('select-file');
              }}
              disabled={isLoading}
              className="rounded border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              Back
            </button>
          )}

          {step !== 'uploading' && (
            <button
              onClick={handleClose}
              disabled={isLoading}
              className="rounded border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          )}

          {step === 'preview' && (
            <button
              onClick={handleUpload}
              disabled={!selectedFile || !editedTitle.trim() || isLoading}
              className="ml-auto flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Upload size={16} />
              Upload & Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
