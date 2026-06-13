'use client';

/**
 * PromptBar 组件
 * Genspark 风格的极简输入框
 *
 * 特性:
 * - 单行/多行自动切换
 * - 文件上传支持 (拖拽/点击)
 * - URL 自动识别
 * - @资源 提及
 * - 快捷命令 (/ppt, /doc, /design)
 * - @Agent 提及（触发特定 Agent 执行任务）
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Paperclip,
  Link,
  X,
  Loader2,
  Sparkles,
  FileText,
  Image as ImageIcon,
  Presentation,
  Crown,
  Search,
  PenTool,
  CheckCircle,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { cn } from '@/lib/utils/common';
import { AgentType, UploadedFile } from '@/lib/features/ai-office/agents/types';

interface PromptBarProps {
  placeholder?: string;
  agentType?: AgentType;
  onSubmit: (data: {
    prompt: string;
    files?: UploadedFile[];
    urls?: string[];
  }) => void;
  isProcessing?: boolean;
  suggestions?: string[];
  showAgentHint?: boolean;
  className?: string;
  autoFocus?: boolean;
  /** 初始提示语，用于模板填充等场景 */
  initialPrompt?: string;
}

// 快捷命令定义
const QUICK_COMMANDS = [
  { cmd: '/ppt', agent: AgentType.SLIDES, icon: Presentation, label: 'PPT' },
  { cmd: '/doc', agent: AgentType.DOCS, icon: FileText, label: '文档' },
  { cmd: '/design', agent: AgentType.DESIGNER, icon: ImageIcon, label: '设计' },
];

// @ Mention 选项定义
const MENTION_OPTIONS = [
  {
    id: 'leader',
    label: '@leader',
    description: '让 Leader 分发任务给团队',
    icon: Crown,
    color: 'text-amber-500',
  },
  {
    id: 'analyst',
    label: '@analyst',
    description: '让分析师分析内容',
    icon: Search,
    color: 'text-blue-500',
  },
  {
    id: 'writer',
    label: '@writer',
    description: '让写手修改或重写内容',
    icon: PenTool,
    color: 'text-green-500',
  },
  {
    id: 'reviewer',
    label: '@reviewer',
    description: '让审核员检查质量',
    icon: CheckCircle,
    color: 'text-purple-500',
  },
  {
    id: 'team',
    label: '@team',
    description: '通知整个团队',
    icon: Users,
    color: 'text-orange-500',
  },
];

export function PromptBar({
  placeholder = '描述你想要创建的内容...',
  agentType,
  onSubmit,
  isProcessing = false,
  suggestions = [],
  showAgentHint = true,
  className,
  autoFocus = false,
  initialPrompt = '',
}: PromptBarProps) {
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  // @ Mention 状态
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当 initialPrompt 改变时更新 prompt
  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
      // 聚焦输入框
      textareaRef.current?.focus();
    }
  }, [initialPrompt]);

  // 自动调整高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 200)}px`;
    }
  }, [prompt]);

  // 检测快捷命令
  useEffect(() => {
    if (prompt.startsWith('/')) {
      setShowCommands(true);
    } else {
      setShowCommands(false);
    }
  }, [prompt]);

  // ★ 检测 @ mention
  useEffect(() => {
    const text = prompt;
    const lastAtIndex = text.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const afterAt = text.slice(lastAtIndex + 1);
      // 如果 @ 后面没有空格，说明用户正在输入 mention
      if (!afterAt.includes(' ')) {
        setShowMentionMenu(true);
        setMentionFilter(afterAt.toLowerCase());
        setSelectedMentionIndex(0); // 重置选中索引
      } else {
        setShowMentionMenu(false);
        setMentionFilter('');
      }
    } else {
      setShowMentionMenu(false);
      setMentionFilter('');
    }
  }, [prompt]);

  // ★ 过滤后的 mention 选项
  const filteredMentionOptions = useMemo(() => {
    if (!mentionFilter) return MENTION_OPTIONS;
    return MENTION_OPTIONS.filter(
      (opt) =>
        opt.id.toLowerCase().includes(mentionFilter) ||
        opt.label.toLowerCase().includes(mentionFilter) ||
        opt.description.toLowerCase().includes(mentionFilter)
    );
  }, [mentionFilter]);

  // ★ 处理 mention 选择
  const handleMentionSelect = useCallback(
    (option: (typeof MENTION_OPTIONS)[0]) => {
      const lastAtIndex = prompt.lastIndexOf('@');
      if (lastAtIndex !== -1) {
        // 替换 @ 后面的内容为选中的 mention
        const newPrompt = prompt.slice(0, lastAtIndex) + option.label + ' ';
        setPrompt(newPrompt);
      }
      setShowMentionMenu(false);
      setMentionFilter('');
      textareaRef.current?.focus();
    },
    [prompt]
  );

  // 提交处理
  const handleSubmit = useCallback(() => {
    if (!prompt.trim() && files.length === 0) return;
    if (isProcessing) return;

    onSubmit({
      prompt: prompt.trim(),
      files: files.length > 0 ? files : undefined,
      urls: urls.length > 0 ? urls : undefined,
    });

    // 清空输入
    setPrompt('');
    setFiles([]);
    setUrls([]);
  }, [prompt, files, urls, isProcessing, onSubmit]);

  // 键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // ★ 处理 mention 菜单导航
    if (showMentionMenu && filteredMentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex((prev) =>
          prev < filteredMentionOptions.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex((prev) =>
          prev > 0 ? prev - 1 : filteredMentionOptions.length - 1
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleMentionSelect(filteredMentionOptions[selectedMentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionMenu(false);
        return;
      }
    }

    // 正常的 Enter 提交
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // 文件处理
  const handleFiles = useCallback((fileList: FileList) => {
    const newFiles: UploadedFile[] = Array.from(fileList).map((file) => ({
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      mimeType: file.type,
      size: file.size,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  // 拖拽处理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // 删除文件
  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // 获取 Agent 图标
  const getAgentIcon = () => {
    switch (agentType) {
      case AgentType.SLIDES:
        return '📊';
      case AgentType.DOCS:
        return '📄';
      case AgentType.DESIGNER:
        return '🎨';
      default:
        return '✨';
    }
  };

  return (
    <div className={cn('relative w-full', className)}>
      {/* 主输入区域 */}
      <div
        className={cn(
          'relative rounded-2xl border bg-card shadow-lg transition-all duration-200',
          isDragOver && 'border-primary ring-2 ring-primary/20',
          isProcessing && 'opacity-75'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 文件预览 */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border p-3">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-sm"
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="max-w-[150px] truncate">{file.name}</span>
                <button
                  onClick={() => removeFile(file.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 输入框 */}
        <div className="flex items-end gap-2 p-3">
          {/* Agent 图标 - 在窄容器中隐藏 */}
          {showAgentHint && (
            <div className="hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg sm:flex">
              {getAgentIcon()}
            </div>
          )}

          {/* 文本输入 */}
          <div className="min-w-[100px] flex-1">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isProcessing}
              autoFocus={autoFocus}
              className="w-full resize-none border-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              rows={1}
              style={{
                minHeight: '24px',
                maxHeight: '200px',
                wordBreak: 'break-word',
              }}
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-shrink-0 items-center gap-2">
            {/* 添加文件 */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />

            {/* 添加链接 */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              disabled={isProcessing}
            >
              <Link className="h-5 w-5" />
            </Button>

            {/* 发送按钮 */}
            <Button
              type="button"
              size="icon"
              className="rounded-full bg-primary hover:bg-primary/90"
              onClick={handleSubmit}
              disabled={isProcessing || (!prompt.trim() && files.length === 0)}
            >
              {isProcessing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* 快捷命令提示 */}
      <AnimatePresence>
        {showCommands && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border bg-card p-2 shadow-lg"
          >
            <div className="flex items-center gap-2 text-sm">
              {QUICK_COMMANDS.filter((cmd) =>
                cmd.cmd.startsWith(prompt.toLowerCase())
              ).map((cmd) => (
                <button
                  key={cmd.cmd}
                  className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 transition-colors hover:bg-muted/80"
                  onClick={() => {
                    setPrompt('');
                    setShowCommands(false);
                    // 触发 Agent 切换
                  }}
                >
                  <cmd.icon className="h-4 w-4" />
                  <span>{cmd.label}</span>
                  <span className="text-muted-foreground">{cmd.cmd}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ★ @ Mention 菜单 */}
      <AnimatePresence>
        {showMentionMenu && filteredMentionOptions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-lg border bg-card p-2 shadow-lg"
          >
            <div className="mb-2 px-2 text-xs text-muted-foreground">
              提及 Agent（使用 ↑↓ 选择，Enter 确认）
            </div>
            <div className="space-y-1">
              {filteredMentionOptions.map((option, index) => (
                <button
                  key={option.id}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                    index === selectedMentionIndex
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => handleMentionSelect(option)}
                  onMouseEnter={() => setSelectedMentionIndex(index)}
                >
                  <option.icon
                    className={cn('h-5 w-5 flex-shrink-0', option.color)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {option.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {filteredMentionOptions.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                没有匹配的 Agent
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 建议提示 */}
      {suggestions.length > 0 && !showCommands && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((suggestion, i) => (
            <button
              key={i}
              className="flex items-center gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setPrompt(suggestion)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default PromptBar;
