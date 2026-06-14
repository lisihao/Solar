'use client';

/**
 * 文档编辑器组件
 * 参考Google Docs、腾讯文档等业界最佳实践设计
 */

import React, { useState, useEffect, useRef } from 'react';
import { useDocumentStore } from '@/stores/aiOfficeStore';
import { toast } from '@/stores';
import {
  getTemplateById,
  PPTTemplate,
} from '@/lib/features/ai-office/ppt-templates';
import type { Document } from '@/lib/types/ai-office';
import {
  FileDown,
  FileText,
  Presentation,
  Download,
  Check,
  Cloud,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Eye,
  Image as ImageIcon,
  History,
} from 'lucide-react';
import VersionHistory from './VersionHistory';
import VersionSelector from './VersionSelector';
import { parseMarkdownToEnhancedSlides } from '@/lib/features/ai-office/markdown-parser';
import EnhancedSlideRenderer from './EnhancedSlideRenderer';
import ResearchPageRenderer from './ResearchPageRenderer';
import { getResearchPageTemplateById } from '@/lib/templates/research-page-templates';

import { logger } from '@/lib/utils/logger';
// 旧版 Slide 类型定义（仅供后备使用）
interface Slide {
  title: string;
  content: string[];
  images?: string[];
  layout: 'content' | 'image-full' | 'image-left' | 'image-right';
}

// 保留旧的解析函数作为后备
function parseMarkdownToSlides_Legacy(markdown: string): Slide[] {
  const slides: Slide[] = [];
  const lines = markdown.split('\n');
  let currentSlide: Slide | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测幻灯片标题（支持多种格式）
    // ### Slide 1, ## 第X页, #### 第X页, ### 封面, ## Slide X: 标题
    const slideHeaderMatch = trimmed.match(
      /^#{2,4}\s*(Slide\s*\d+|第\s*\d+\s*[页页]|封面|目录|.*页[:：])/i
    );

    if (slideHeaderMatch) {
      if (currentSlide) {
        // 在推送前确定最终布局
        finalizeSlideLayout(currentSlide);
        slides.push(currentSlide);
      }
      // 提取标题（冒号后的内容，或整个标题）
      const titleMatch =
        trimmed.match(/[:：]\s*(.+)/) || trimmed.match(/^#{2,4}\s*(.+)/);
      currentSlide = {
        title: titleMatch
          ? titleMatch[1].trim()
          : trimmed.replace(/^#{2,4}\s*/, ''),
        content: [],
        images: [],
        layout: 'content',
      };
    } else if (trimmed === '---') {
      // 分隔符，开始新幻灯片
      if (currentSlide) {
        finalizeSlideLayout(currentSlide);
        slides.push(currentSlide);
        currentSlide = null;
      }
    } else if (currentSlide && trimmed) {
      // 检测图片 ![alt](url)
      const imageMatch = trimmed.match(/!\[.*?\]\((.+?)\)/);
      if (imageMatch) {
        currentSlide.images = currentSlide.images || [];
        currentSlide.images.push(imageMatch[1]);
        // 暂不决定布局，等所有内容解析完再决定
      } else {
        // 添加内容行
        currentSlide.content.push(line);
      }
    } else if (!currentSlide && trimmed && !trimmed.startsWith('#')) {
      // 如果还没有幻灯片，创建第一张
      currentSlide = {
        title: 'Slide ' + (slides.length + 1),
        content: [line],
        images: [],
        layout: 'content',
      };
    }
  }

  if (currentSlide) {
    finalizeSlideLayout(currentSlide);
    slides.push(currentSlide);
  }

  return slides;
}

// 在幻灯片内容完全解析后，确定最佳布局
function finalizeSlideLayout(slide: Slide) {
  const hasImages = slide.images && slide.images.length > 0;
  const hasContent = slide.content.length > 0;

  if (!hasImages) {
    // 没有图片，纯文本布局
    slide.layout = 'content';
  } else if (!hasContent) {
    // 只有图片，没有文本
    slide.layout = 'image-full';
  } else {
    // 既有图片又有文本，使用图文混排布局
    // 根据图片索引决定左右位置
    slide.layout =
      (slide.images?.length || 0) % 2 === 1 ? 'image-left' : 'image-right';
  }
}

export default function DocumentEditor() {
  const currentDocumentId = useDocumentStore(
    (state) => state.currentDocumentId
  );
  const documents = useDocumentStore((state) => state.documents);
  const updateDocument = useDocumentStore((state) => state.updateDocument);

  const currentDocument = documents.find((d) => d._id === currentDocumentId);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [exportLoading, setExportLoading] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [thumbnailsCollapsed, setThumbnailsCollapsed] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingContent, setEditingContent] = useState('');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // 获取当前文档的模板配置
  const template: PPTTemplate = currentDocument?.template?.id
    ? getTemplateById(currentDocument.template.id)
    : getTemplateById('corporate'); // 默认使用商务模板

  // 当文档切换时更新内容和标题
  useEffect(() => {
    logger.debug('[DocumentEditor] useEffect triggered');
    logger.debug('[DocumentEditor] currentDocument:', !!currentDocument);
    logger.debug('[DocumentEditor] currentDocumentId:', currentDocumentId);

    if (currentDocument) {
      const markdown =
        typeof currentDocument.content === 'object' &&
        currentDocument.content !== null &&
        'markdown' in currentDocument.content
          ? (currentDocument.content as { markdown: string }).markdown || ''
          : '';
      logger.debug(
        '[DocumentEditor] Setting content from document, length:',
        markdown.length
      );
      logger.debug('[DocumentEditor] Document type:', currentDocument.type);
      logger.debug('[DocumentEditor] Document title:', currentDocument.title);

      if (currentDocument.type === 'article') {
        setContent(markdown);
      } else if (currentDocument.type === 'ppt') {
        // PPT类型也使用markdown字段存储内容
        setContent(markdown);
      }
      setTitle(currentDocument.title || '未命名演示文稿');
    } else {
      logger.debug('[DocumentEditor] No current document, clearing content');
      setContent('');
      setTitle('');
    }
  }, [currentDocument, currentDocumentId]);

  // 自动保存（防抖） - 内容
  useEffect(() => {
    if (!currentDocumentId || !currentDocument) return;

    setIsSaving(true);
    const timer = setTimeout(() => {
      const currentMarkdown =
        typeof currentDocument.content === 'object' &&
        currentDocument.content !== null &&
        'markdown' in currentDocument.content
          ? (currentDocument.content as { markdown: string }).markdown || ''
          : '';

      if (
        currentDocument.type === 'article' &&
        (content !== currentMarkdown || title !== currentDocument.title)
      ) {
        updateDocument(currentDocumentId, {
          title: title,
          content: {
            markdown: content,
          },
          metadata: {
            wordCount: content.length,
          },
          updatedAt: new Date(),
        });
        setLastSaved(new Date());
      }
      setIsSaving(false);
    }, 1000);

    return () => {
      clearTimeout(timer);
      setIsSaving(false);
    };
  }, [content, title, currentDocumentId, currentDocument, updateDocument]);

  // 点击外部关闭导出菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(event.target as Node)
      ) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showExportMenu]);

  // 导出文档
  const handleExport = async (
    format: 'word' | 'pdf' | 'ppt' | 'markdown' | 'html' | 'latex'
  ) => {
    if (!currentDocument) return;

    setShowExportMenu(false); // 关闭菜单
    setExportLoading(format);

    try {
      const markdown =
        typeof currentDocument.content === 'object' &&
        currentDocument.content !== null &&
        'markdown' in currentDocument.content
          ? (currentDocument.content as { markdown: string }).markdown || ''
          : '';

      const response = await fetch('/api/ai-office/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentId: currentDocument._id,
          format,
          content: markdown,
          title: currentDocument.title,
          templateId: currentDocument.template?.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // 文件扩展名映射
      const extensionMap: Record<typeof format, string> = {
        word: 'docx',
        ppt: 'pptx',
        pdf: 'pdf',
        markdown: 'md',
        html: 'html',
        latex: 'tex',
      };

      a.download = `${currentDocument.title}.${extensionMap[format]}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      logger.error('Export error:', error);
      toast.error('导出失败，请稍后重试');
    } finally {
      setExportLoading(null);
    }
  };

  // 创建新空白文档
  const handleCreateBlankDocument = () => {
    const newDocument: Document = {
      _id: `doc_${Date.now()}`,
      userId: 'current_user', // TODO: 从认证系统获取
      type: 'article',
      title: '未命名文档',
      status: 'draft',
      resources: [],
      aiConfig: {
        model: 'gpt-4',
        language: 'zh-CN',
        detailLevel: 3,
        professionalLevel: 3,
      },
      generationHistory: [],
      versions: [],
      metadata: {
        wordCount: 0,
      },
      content: {
        markdown: '',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 添加文档到store
    useDocumentStore.getState().addDocument(newDocument);
    // 设置为当前文档
    useDocumentStore.getState().setCurrentDocument(newDocument._id);
  };

  if (!currentDocument) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-6xl">📄</div>
          <p className="mb-4 text-lg font-medium text-gray-700">准备开始创作</p>
          <p className="mb-6 text-sm text-gray-500">
            选择资源并与AI对话，使用 @ 提及开始创作
          </p>
          {/* 新建空白文档按钮 */}
          <button
            onClick={handleCreateBlankDocument}
            className="inline-flex items-center space-x-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <FileText className="h-4 w-4" />
            <span>新建空白文档</span>
          </button>
          <p className="mt-3 text-xs text-gray-400">
            或者与AI对话让AI帮你生成文档
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* 顶部工具栏 - 简洁专业设计 */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between px-6 py-3">
          {/* 左侧：文档标题 */}
          <div className="flex min-w-0 flex-1 items-center space-x-3">
            <FileText className="h-5 w-5 flex-shrink-0 text-gray-400" />
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={currentDocument.status === 'generating'}
              className="flex-1 rounded border-none bg-transparent px-2 py-1 text-base font-medium text-gray-900 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              placeholder="未命名文档"
            />
          </div>

          {/* 右侧：操作区 */}
          <div className="flex items-center space-x-4">
            {/* 保存状态 */}
            <div className="flex items-center space-x-1.5 text-xs text-gray-500">
              {isSaving ? (
                <>
                  <Cloud className="h-3.5 w-3.5 animate-pulse" />
                  <span>保存中</span>
                </>
              ) : lastSaved ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-600" />
                  <span>已保存</span>
                </>
              ) : null}
            </div>

            {/* 字数统计 */}
            <div className="text-xs text-gray-400">
              {currentDocument.metadata?.wordCount || 0} 字
            </div>

            {/* Genspark 风格版本选择器 */}
            {currentDocumentId && (
              <VersionSelector
                documentId={currentDocumentId}
                onOpenHistory={() => setShowVersionHistory(true)}
              />
            )}

            {/* 导出按钮（下拉菜单） */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={exportLoading !== null}
                className="flex items-center space-x-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                <span>{exportLoading ? '导出中...' : '导出'}</span>
                <ChevronDown className="h-4 w-4" />
              </button>

              {/* 下拉菜单 */}
              {showExportMenu && (
                <div className="absolute right-0 z-10 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5">
                  <div className="py-1" role="menu">
                    <button
                      onClick={() => handleExport('word')}
                      className="flex w-full items-center space-x-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                      role="menuitem"
                    >
                      <FileText className="h-4 w-4 text-blue-600" />
                      <div className="flex-1 text-left">
                        <div className="font-medium">Word 文档</div>
                        <div className="text-xs text-gray-400">.docx</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleExport('ppt')}
                      className="flex w-full items-center space-x-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                      role="menuitem"
                    >
                      <Presentation className="h-4 w-4 text-orange-600" />
                      <div className="flex-1 text-left">
                        <div className="font-medium">PowerPoint</div>
                        <div className="text-xs text-gray-400">.pptx</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleExport('pdf')}
                      className="flex w-full items-center space-x-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                      role="menuitem"
                    >
                      <Download className="h-4 w-4 text-red-600" />
                      <div className="flex-1 text-left">
                        <div className="font-medium">PDF 文档</div>
                        <div className="text-xs text-gray-400">.pdf</div>
                      </div>
                    </button>
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={() => handleExport('markdown')}
                      className="flex w-full items-center space-x-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                      role="menuitem"
                    >
                      <FileDown className="h-4 w-4 text-gray-600" />
                      <div className="flex-1 text-left">
                        <div className="font-medium">Markdown</div>
                        <div className="text-xs text-gray-400">.md</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleExport('html')}
                      className="flex w-full items-center space-x-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                      role="menuitem"
                    >
                      <FileText className="h-4 w-4 text-green-600" />
                      <div className="flex-1 text-left">
                        <div className="font-medium">HTML 网页</div>
                        <div className="text-xs text-gray-400">.html</div>
                      </div>
                    </button>
                    <button
                      onClick={() => handleExport('latex')}
                      className="flex w-full items-center space-x-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                      role="menuitem"
                    >
                      <FileText className="h-4 w-4 text-purple-600" />
                      <div className="flex-1 text-left">
                        <div className="font-medium">LaTeX 文档</div>
                        <div className="text-xs text-gray-400">.tex</div>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 文档编辑区域 */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {currentDocument?.type === 'ppt' ? (
          // PPT 幻灯片预览 - 左右布局
          (() => {
            const slides = parseMarkdownToEnhancedSlides(content);
            if (slides.length === 0) {
              return (
                <div className="flex h-full items-center justify-center text-gray-400">
                  <div className="text-center">
                    <Presentation className="mx-auto mb-4 h-16 w-16" />
                    <p>AI正在生成幻灯片内容...</p>
                  </div>
                </div>
              );
            }

            const currentSlide = slides[currentSlideIndex] || slides[0];

            return (
              <div className="flex h-full flex-col">
                {/* 顶部缩略图区域 - 可折叠 */}
                <div
                  className={`border-b border-gray-200 bg-white transition-all duration-300 ${
                    thumbnailsCollapsed ? 'h-0 overflow-hidden' : 'h-auto'
                  }`}
                >
                  <div className="p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase text-gray-500">
                        所有幻灯片 ({slides.length})
                      </div>
                      <button
                        onClick={() =>
                          setThumbnailsCollapsed(!thumbnailsCollapsed)
                        }
                        className="rounded p-1 transition-colors hover:bg-gray-100"
                        title={
                          thumbnailsCollapsed ? '展开缩略图' : '收起缩略图'
                        }
                      >
                        <ChevronUp className="h-4 w-4 text-gray-500" />
                      </button>
                    </div>

                    {/* 水平滚动缩略图 */}
                    <div className="relative">
                      <div className="scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 flex space-x-2 overflow-x-auto pb-2">
                        {slides.map((slide, idx) => (
                          <div
                            key={idx}
                            className={`group relative w-40 flex-shrink-0 rounded-lg border-2 transition-all ${
                              idx === currentSlideIndex
                                ? 'border-blue-500 bg-blue-50 shadow-md'
                                : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'
                            }`}
                          >
                            <button
                              onClick={() => setCurrentSlideIndex(idx)}
                              className="w-full p-2 text-left"
                            >
                              <div className="mb-1 flex items-center justify-between">
                                <div className="text-xs font-medium text-gray-500">
                                  第 {idx + 1} 页
                                </div>
                                {idx === currentSlideIndex && (
                                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500">
                                    <Check className="h-3 w-3 text-white" />
                                  </div>
                                )}
                              </div>
                              <div className="mb-1 line-clamp-2 text-xs font-semibold leading-tight text-gray-900">
                                {slide.title}
                              </div>
                              {/* Content preview */}
                              {slide.content && slide.content.length > 0 && (
                                <div className="line-clamp-2 text-xs leading-tight text-gray-600">
                                  {Array.isArray(slide.content)
                                    ? slide.content.join(' ').substring(0, 60)
                                    : String(slide.content).substring(0, 60)}
                                  ...
                                </div>
                              )}
                            </button>

                            {/* Quick edit button - appears on hover */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentSlideIndex(idx);
                                setIsEditMode(true);
                              }}
                              className="absolute bottom-1 right-1 hidden rounded bg-white px-2 py-1 text-xs font-medium text-blue-600 shadow-sm transition-all hover:bg-blue-50 group-hover:block"
                              title="编辑此页"
                            >
                              <Edit3 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 折叠状态下显示的展开按钮 */}
                {thumbnailsCollapsed && (
                  <div className="border-b border-gray-200 bg-white">
                    <button
                      onClick={() => setThumbnailsCollapsed(false)}
                      className="flex w-full items-center justify-center space-x-2 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50"
                    >
                      <span>展开缩略图</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {/* 主幻灯片预览区域 */}
                <div className="flex flex-1 flex-col p-8">
                  {/* 导航栏 */}
                  <div className="mb-6 flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                      幻灯片 {currentSlideIndex + 1} / {slides.length}
                    </div>
                    <div className="flex items-center space-x-2">
                      {/* 编辑/预览模式切换 */}
                      <button
                        onClick={() => {
                          if (isEditMode) {
                            // 保存编辑内容
                            if (editingContent !== content) {
                              setContent(editingContent);
                            }
                          } else {
                            setEditingContent(content);
                          }
                          setIsEditMode(!isEditMode);
                        }}
                        className={`flex items-center space-x-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                          isEditMode
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'border border-gray-300 hover:bg-white'
                        }`}
                      >
                        {isEditMode ? (
                          <>
                            <Eye className="h-4 w-4" />
                            <span>预览</span>
                          </>
                        ) : (
                          <>
                            <Edit3 className="h-4 w-4" />
                            <span>编辑</span>
                          </>
                        )}
                      </button>

                      {/* 翻页按钮 */}
                      <button
                        onClick={() =>
                          setCurrentSlideIndex(
                            Math.max(0, currentSlideIndex - 1)
                          )
                        }
                        disabled={currentSlideIndex === 0}
                        className="flex items-center space-x-1 rounded-lg border border-gray-300 px-4 py-2 text-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        <span>上一页</span>
                      </button>
                      <button
                        onClick={() =>
                          setCurrentSlideIndex(
                            Math.min(slides.length - 1, currentSlideIndex + 1)
                          )
                        }
                        disabled={currentSlideIndex === slides.length - 1}
                        className="flex items-center space-x-1 rounded-lg border border-gray-300 px-4 py-2 text-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span>下一页</span>
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* 幻灯片预览/编辑 */}
                  <div className="flex flex-1 items-center justify-center">
                    {isEditMode ? (
                      // 编辑模式 - 显示markdown编辑器
                      <div className="flex h-full w-full max-w-5xl flex-col">
                        <div className="flex-1 rounded-2xl bg-white p-6 shadow-2xl">
                          <textarea
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            className="font-mono h-full w-full resize-none rounded-lg border border-gray-200 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="在此编辑幻灯片内容（Markdown格式）&#x0A;&#x0A;示例：&#x0A;### Slide 1: 标题&#x0A;- 要点1&#x0A;- 要点2&#x0A;![图片](https://example.com/image.jpg)&#x0A;&#x0A;---&#x0A;&#x0A;### Slide 2: 下一页标题&#x0A;..."
                          />
                        </div>
                      </div>
                    ) : (
                      // 预览模式 - 使用增强渲染器
                      <EnhancedSlideRenderer
                        slide={currentSlide}
                        template={template}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })()
        ) : currentDocument?.type === 'article' ? (
          // 普通文档编辑器
          <div className="mx-auto max-w-4xl rounded-lg bg-white shadow-sm">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={currentDocument?.status === 'generating'}
              className="w-full resize-none border-none p-12 text-base leading-relaxed text-gray-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50"
              placeholder="开始撰写您的文档..."
              style={{
                minHeight: '842px',
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", "Microsoft YaHei", sans-serif',
                fontSize: '16px',
                lineHeight: '1.75',
              }}
            />
          </div>
        ) : null}
      </div>

      {/* Version History Modal */}
      {showVersionHistory && currentDocumentId && (
        <VersionHistory
          documentId={currentDocumentId}
          onClose={() => setShowVersionHistory(false)}
        />
      )}
    </div>
  );
}
