'use client';

import { useState } from 'react';
import {
  Upload,
  FileText,
  AlertCircle,
  ExternalLink,
  FolderOpen,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';

interface FileUploadPanelProps {
  knowledgeBaseId: string;
  onImportComplete?: (count: number) => void;
}

/**
 * FileUploadPanel - 手动上传文件到知识库
 * 目前引导用户通过 AI Research 或 Explore 页面上传文件
 */
export default function FileUploadPanel({
  knowledgeBaseId,
  onImportComplete,
}: FileUploadPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* 上传提示区域 */}
      <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <div className="space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
            <Upload className="h-8 w-8 text-blue-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              上传文档到知识库
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              支持 PDF、Word、TXT、Markdown 等格式
            </p>
          </div>
        </div>
      </div>

      {/* 推荐方式 */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">推荐上传方式：</p>

        {/* 方式1: 通过 AI Research */}
        <Link
          href="/ai-research"
          className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-blue-300 hover:bg-blue-50"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100">
            <FileText className="h-6 w-6 text-purple-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-gray-900">通过 AI Research 上传</p>
            <p className="mt-0.5 text-sm text-gray-500">
              创建研究项目，上传文件后可导入到知识库
            </p>
          </div>
          <ExternalLink className="h-5 w-5 text-gray-400" />
        </Link>

        {/* 方式2: 通过 Explore 页面 */}
        <Link
          href="/explore"
          className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-blue-300 hover:bg-blue-50"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100">
            <FolderOpen className="h-6 w-6 text-green-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-gray-900">通过 Explore 页面上传</p>
            <p className="mt-0.5 text-sm text-gray-500">
              上传 PDF 文档，然后添加到知识库
            </p>
          </div>
          <ExternalLink className="h-5 w-5 text-gray-400" />
        </Link>
      </div>

      {/* 说明 */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">温馨提示</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
              <li>文件上传后会自动解析内容并向量化</li>
              <li>处理完成后即可在 AI 问答中使用</li>
              <li>也可以使用 URL 抓取、Google Drive 等方式导入内容</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
