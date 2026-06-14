'use client';

/**
 * AI交互面板组件
 * 包含对话历史、输入框、快捷操作
 */

import React, { useState, useEffect, useRef } from 'react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  useChatStore,
  useDocumentStore,
  useResourceStore,
  useTaskStore,
  Task,
} from '@/stores/aiOfficeStore';
import type {
  Document as AiOfficeDocument,
  DocumentType,
} from '@/lib/types/ai-office';
import {
  Send,
  Paperclip,
  Sparkles,
  FileText,
  StopCircle,
  Bot,
  Zap,
  Copy,
  Quote,
} from 'lucide-react';
import DocumentGenerationWizard, {
  type GenerationConfig,
} from '../document/DocumentGenerationWizard';
import GenerationProgress from '../document/GenerationProgress';
import MessageRenderer from './MessageRenderer';
import { calculateSlideCount } from '@/lib/features/ai-office/ppt-utils';
import SlashCommandMenu, {
  SLASH_COMMANDS,
  parseSlashCommand,
  buildCommandPrompt,
  type SlashCommand,
} from './SlashCommandMenu';
import DOMPurify from 'isomorphic-dompurify';
import { formatDateSafe } from '@/lib/utils/date';

import { logger } from '@/lib/utils/logger';
export default function ChatPanel() {
  const [input, setInput] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  // 斜杠命令状态
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashSearch, setSlashSearch] = useState('');
  const [slashPosition, setSlashPosition] = useState({ top: 0, left: 0 });
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  const {
    isStreaming,
    setStreaming,
    addMessage,
    stopGeneration,
    shouldStopGeneration,
    agentMode,
    setAgentMode,
    agentStatus,
    setAgentStatus,
  } = useChatStore();
  const currentDocumentId =
    useDocumentStore((state) => state.currentDocumentId) || 'default';
  const messages = useChatStore(
    (state) => state.sessions[currentDocumentId] || []
  );
  const {
    addDocument,
    setCurrentDocument,
    setGenerating,
    isGenerating,
    saveVersion,
    generationSteps,
    currentStep,
    resourcesFound,
    estimatedTime,
    setGenerationSteps,
    updateGenerationStep,
    setCurrentStep,
    setResourcesFound,
  } = useDocumentStore();
  const selectedResourceIds = useResourceStore(
    (state) => state.selectedResourceIds
  );
  const resources = useResourceStore((state) => state.resources);
  const currentTaskId = useTaskStore((state) => state.currentTaskId);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // 检测 @ 提及和 / 斜杠命令
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInput(value);
    setCursorPosition(cursorPos);

    const textBeforeCursor = value.slice(0, cursorPos);

    // 检测斜杠命令（只在行首触发）
    const lastNewlineIndex = textBeforeCursor.lastIndexOf('\n');
    const currentLine = textBeforeCursor.slice(lastNewlineIndex + 1);

    if (currentLine.startsWith('/') && !currentLine.includes(' ')) {
      const searchQuery = currentLine.slice(1).toLowerCase();
      setSlashSearch(searchQuery);
      setShowSlashMenu(true);
      setSelectedSlashIndex(0);
      setShowMentionMenu(false);

      // 计算斜杠命令菜单位置
      if (inputRef.current) {
        const rect = inputRef.current.getBoundingClientRect();
        setSlashPosition({
          top: rect.top,
          left: rect.left + 20,
        });
      }
      return;
    } else {
      setShowSlashMenu(false);
    }

    // 查找当前光标位置的 @ 符号
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // 如果 @ 后面没有空格，显示提及菜单
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setMentionSearch(textAfterAt.toLowerCase());
        setShowMentionMenu(true);
        setSelectedMentionIndex(0); // 重置选中索引

        // 计算菜单位置（简化版，实际需要更精确的计算）
        if (inputRef.current) {
          const rect = inputRef.current.getBoundingClientRect();
          setMentionPosition({
            top: rect.top - 200,
            left: rect.left + 20,
          });
        }
      } else {
        setShowMentionMenu(false);
      }
    } else {
      setShowMentionMenu(false);
    }
  };

  // 选择斜杠命令
  const selectSlashCommand = (command: SlashCommand) => {
    // 替换当前输入为命令 + 空格
    setInput(command.command + ' ');
    setShowSlashMenu(false);

    // 聚焦回输入框
    setTimeout(() => {
      inputRef.current?.focus();
      const newCursorPos = command.command.length + 1;
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  // 获取过滤后的斜杠命令
  const filteredSlashCommands = SLASH_COMMANDS.filter((cmd) => {
    if (!slashSearch) return true;
    return (
      cmd.command.toLowerCase().includes('/' + slashSearch) ||
      cmd.title.toLowerCase().includes(slashSearch) ||
      cmd.description.toLowerCase().includes(slashSearch)
    );
  });

  // 过滤资源列表
  const filteredResources = resources.filter((r) => {
    const title = r.metadata?.title || '无标题';
    return title.toLowerCase().includes(mentionSearch);
  });

  // 选择提及项
  const selectMention = (resourceId: string | 'all') => {
    const textBeforeCursor = input.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      const mention =
        resourceId === 'all'
          ? '@all '
          : `@${resources.find((r) => r._id === resourceId)?.metadata?.title || resourceId} `;

      const newInput =
        input.slice(0, lastAtIndex) + mention + input.slice(cursorPosition);

      setInput(newInput);
      setShowMentionMenu(false);

      // 聚焦回输入框
      setTimeout(() => {
        inputRef.current?.focus();
        const newCursorPos = lastAtIndex + mention.length;
        inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  // 解析输入中的 @ 提及，返回被提及的资源ID列表
  const parseMentions = (text: string): string[] => {
    const mentionRegex = /@(all|[^\s@]+)/g;
    const mentions = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      const mentionText = match[1];
      if (mentionText === 'all') {
        return resources.map((r) => r._id); // @all 返回所有资源
      } else {
        // 查找匹配的资源
        const resource = resources.find(
          (r) => r.metadata?.title === mentionText || r._id === mentionText
        );
        if (resource) {
          mentions.push(resource._id);
        }
      }
    }

    return mentions;
  };

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    let userInput = input;
    setInput('');

    // 解析斜杠命令
    const { command: slashCommand, args: slashArgs } =
      parseSlashCommand(userInput);
    if (slashCommand) {
      // 构建增强的 prompt
      userInput = buildCommandPrompt(slashCommand, slashArgs, {
        selectedResourceCount: selectedResourceIds.length,
      });
      logger.debug('[ChatPanel] Slash command detected:', {
        commandId: slashCommand.id,
        args: slashArgs,
      });
    }

    // 任务管理：创建或更新任务
    const currentTaskId = useTaskStore.getState().currentTaskId;
    let taskId = currentTaskId;

    // 检测用户是否要生成文档（PPT、Word等）
    // 更灵活的检测：包含动词+文档类型 OR 只包含文档类型（如"一页PPT"）
    const hasDocumentType =
      /(ppt|powerpoint|演示文稿|幻灯片|word|文档|报告)/i.test(userInput);
    const hasActionVerb =
      /(生成|创建|制作|输出|写|撰写|做|准备|起草|编写|创作|一页|几页|页)/i.test(
        userInput
      );
    const isDocumentGenerationRequest =
      hasDocumentType && (hasActionVerb || hasDocumentType);

    // 检测是否是更新/补充当前文档的请求（而不是创建新文档）
    const isUpdateRequest =
      /重新生成|重新制作|重新创建|更新|修改|补充|增加|添加|完善|优化|刷新|regenerate|update|refresh|add|supplement/i.test(
        userInput
      );

    // 中文数字转阿拉伯数字
    const chineseToNumber = (chinese: string): number => {
      const map: Record<string, number> = {
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
        十: 10,
      };
      return map[chinese] || 0;
    };

    // 检测是否指定了要更新的页码
    let targetPages: number[] | null = null;

    // 匹配阿拉伯数字：第1页、第1-3页
    const arabicMatch = userInput.match(
      /第\s*(\d+)\s*页|第\s*(\d+)\s*[-到至]\s*(\d+)\s*页|slide\s*(\d+)|slides?\s*(\d+)\s*[-to]\s*(\d+)/i
    );

    // 匹配中文数字：第一页、第二页、第一到第三页
    const chineseMatch = userInput.match(
      /第\s*([一二三四五六七八九十]+)\s*页|第\s*([一二三四五六七八九十]+)\s*[-到至]\s*第?\s*([一二三四五六七八九十]+)\s*页/i
    );

    if (arabicMatch) {
      logger.debug('[ChatPanel] Arabic number page match:', arabicMatch);
      if (arabicMatch[1]) {
        targetPages = [parseInt(arabicMatch[1])];
      } else if (arabicMatch[2] && arabicMatch[3]) {
        const start = parseInt(arabicMatch[2]);
        const end = parseInt(arabicMatch[3]);
        targetPages = Array.from(
          { length: end - start + 1 },
          (_, i) => start + i
        );
      } else if (arabicMatch[4]) {
        targetPages = [parseInt(arabicMatch[4])];
      } else if (arabicMatch[5] && arabicMatch[6]) {
        const start = parseInt(arabicMatch[5]);
        const end = parseInt(arabicMatch[6]);
        targetPages = Array.from(
          { length: end - start + 1 },
          (_, i) => start + i
        );
      }
    } else if (chineseMatch) {
      logger.debug('[ChatPanel] Chinese number page match:', chineseMatch);
      if (chineseMatch[1]) {
        // 单页：第一页
        targetPages = [chineseToNumber(chineseMatch[1])];
      } else if (chineseMatch[2] && chineseMatch[3]) {
        // 范围：第一到第三页
        const start = chineseToNumber(chineseMatch[2]);
        const end = chineseToNumber(chineseMatch[3]);
        targetPages = Array.from(
          { length: end - start + 1 },
          (_, i) => start + i
        );
      }
    }

    if (targetPages) {
      logger.debug('[ChatPanel] Target pages detected:', targetPages);
    }

    // 检测文档类型
    const isPPTRequest = /ppt|powerpoint|演示文稿|幻灯片/i.test(userInput);
    const isWordRequest = /word|文档|报告/i.test(userInput) && !isPPTRequest;

    // 检测是否明确要求创建新文档
    const isExplicitNewDocumentRequest =
      /新建|创建新的|再生成一个|另外生成|new document/i.test(userInput);

    // 检查是否有当前活跃任务及其关联的文档
    const existingTask = currentTaskId
      ? useTaskStore.getState().tasks.find((t) => t._id === currentTaskId)
      : null;
    const hasExistingDocument = existingTask && existingTask.context.documentId;

    // 决定目标文档ID
    let targetDocumentId = currentDocumentId;

    // 决策逻辑：
    // 1. 如果明确要求创建新文档 → 创建新文档
    // 2. 如果是更新请求且有现有文档 → 更新现有文档（不创建新的）
    // 3. 如果是文档生成请求且没有现有文档 → 创建新文档
    // 4. 否则 → 不创建/更新文档
    const shouldUpdateExisting = isUpdateRequest && hasExistingDocument;
    const shouldCreateNewDocument =
      isExplicitNewDocumentRequest ||
      (isDocumentGenerationRequest && !shouldUpdateExisting);

    // 如果有现有文档且是更新请求，使用现有文档ID
    if (hasExistingDocument && isUpdateRequest && isDocumentGenerationRequest) {
      targetDocumentId = existingTask.context.documentId!;
      // 设置当前文档
      useDocumentStore.getState().setCurrentDocument(targetDocumentId);
      // 更新文档状态为生成中
      useDocumentStore.getState().updateDocument(targetDocumentId, {
        status: 'generating',
        updatedAt: new Date(),
      });
    } else if (shouldCreateNewDocument) {
      const documentType: DocumentType = isPPTRequest ? 'ppt' : 'article';
      const documentTitle = isPPTRequest ? '未命名演示文稿' : '未命名文档';

      // 如果是PPT，根据用户输入选择模板
      let templateId = 'corporate'; // 默认商务模板
      if (isPPTRequest) {
        const input = userInput.toLowerCase();
        if (input.includes('简约') || input.includes('简洁')) {
          templateId = 'minimal';
        } else if (input.includes('现代') || input.includes('渐变')) {
          templateId = 'modern';
        } else if (input.includes('创意') || input.includes('多彩')) {
          templateId = 'creative';
        } else if (input.includes('学术') || input.includes('教育')) {
          templateId = 'academic';
        } else if (input.includes('科技') || input.includes('技术')) {
          templateId = 'tech';
        } else if (input.includes('商务') || input.includes('企业')) {
          templateId = 'corporate';
        }
      }

      const newDocumentId = `doc-${Date.now()}`;
      const newDocument: AiOfficeDocument = {
        _id: newDocumentId,
        userId: 'current-user',
        type: documentType,
        title: documentTitle,
        status: 'generating' as const,
        resources: [],
        template: isPPTRequest
          ? {
              id: templateId,
              version: '1.0',
            }
          : undefined,
        aiConfig: {
          model: 'grok',
          language: 'zh-CN',
          detailLevel: 3,
          professionalLevel: 3,
        },
        generationHistory: [
          {
            timestamp: new Date(),
            action: 'create' as const,
            aiModel: 'grok',
          },
        ],
        versions: [],
        content: {
          markdown: '', // 统一使用markdown字段存储内容
        },
        metadata: {
          wordCount: 0,
          lastEditedBy: 'AI Assistant',
        },
        tags: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AiOfficeDocument;

      useDocumentStore.getState().addDocument(newDocument);
      useDocumentStore.getState().setCurrentDocument(newDocumentId);
      targetDocumentId = newDocumentId;
    }

    // 在确定targetDocumentId后创建用户消息
    const userMessage = {
      id: Date.now().toString(),
      documentId: targetDocumentId,
      role: 'user' as const,
      content: userInput,
      timestamp: new Date(),
    };

    // 添加用户消息到目标文档
    addMessage(targetDocumentId, userMessage);

    if (
      isDocumentGenerationRequest &&
      !isUpdateRequest &&
      selectedResourceIds.length === 0
    ) {
      // 如果没有选择资源，提示用户
      const hintMessage = {
        id: (Date.now() + 1).toString(),
        documentId: targetDocumentId,
        role: 'assistant' as const,
        content:
          '提示：检测到您想生成文档！建议先在左侧选择相关资源，然后我可以帮您生成更专业的内容。\n\n或者，您可以直接描述需求，我会尽力帮您生成。',
        timestamp: new Date(),
      };
      addMessage(targetDocumentId, hintMessage);
    }

    // 创建或更新任务（针对所有AI交互，不只是文档生成）
    // 决策逻辑：
    // 1. 如果明确要求创建新文档 → 创建新任务
    // 2. 如果是文档生成请求且不是更新请求 → 创建新任务
    // 3. 如果没有当前任务 → 创建新任务
    // 4. 否则 → 更新现有任务
    const shouldCreateNewTask =
      isExplicitNewDocumentRequest ||
      (isDocumentGenerationRequest && !isUpdateRequest) ||
      !currentTaskId;

    if (shouldCreateNewTask) {
      // 创建新任务
      const newTaskId = `task-${Date.now()}`;
      taskId = newTaskId;

      // 解析 @ 提及，获取资源列表
      const mentionedResourceIds = parseMentions(userInput || '');
      const resourceIdsToUse =
        mentionedResourceIds.length > 0
          ? mentionedResourceIds
          : selectedResourceIds;

      // 确定任务类型
      let taskType: 'article' | 'ppt' | 'summary' | 'analysis' = 'analysis';
      if (isDocumentGenerationRequest) {
        taskType = isPPTRequest ? 'ppt' : 'article';
      } else if (
        /总结|摘要|summary/i.test(userInput || '') ||
        resourceIdsToUse.length > 0
      ) {
        taskType = 'summary';
      }

      // 生成任务标题
      let taskTitle = '';
      const timeStr = formatDateSafe(new Date(), 'time');
      if (isDocumentGenerationRequest) {
        taskTitle = `${isPPTRequest ? 'PPT演示' : '文档'} - ${timeStr}`;
      } else if ((userInput || '').length > 30) {
        taskTitle = `${(userInput || '').substring(0, 30)}... - ${timeStr}`;
      } else {
        taskTitle = `${userInput || ''} - ${timeStr}`;
      }

      const newTask: Task = {
        _id: newTaskId,
        title: taskTitle,
        type: taskType,
        createdAt: new Date(),
        refreshedAt: new Date(),
        context: {
          resourceIds: resourceIdsToUse,
          documentId: targetDocumentId,
          chatMessages: [...messages, userMessage],
          prompt: userInput,
        },
        metadata: {},
      };

      useTaskStore.getState().addTask(newTask);
      useTaskStore.getState().setCurrentTask(newTaskId);
    } else {
      // 更新现有任务的上下文
      taskId = currentTaskId!;
      useTaskStore.getState().updateTask(taskId, {
        context: {
          resourceIds:
            useTaskStore.getState().tasks.find((t) => t._id === taskId)?.context
              .resourceIds || selectedResourceIds,
          documentId: targetDocumentId,
          chatMessages: [...messages, userMessage],
        },
        refreshedAt: new Date(), // 更新任务的刷新时间
      });
    }

    // 设置为正在生成状态
    setStreaming(true);

    try {
      // 解析 @ 提及，获取资源列表
      const mentionedResourceIds = parseMentions(userInput || '');

      // 如果有 @ 提及，使用提及的资源；否则使用选中的资源
      const resourceIdsToUse =
        mentionedResourceIds.length > 0
          ? mentionedResourceIds
          : useResourceStore.getState().selectedResourceIds;

      const selectedResources = useResourceStore
        .getState()
        .resources.filter((r) => resourceIdsToUse.includes(r._id));

      // 获取当前文档内容（用于更新场景）
      const currentDoc = targetDocumentId
        ? useDocumentStore
            .getState()
            .documents.find((d) => d._id === targetDocumentId)
        : null;
      const existingContent =
        currentDoc &&
        shouldUpdateExisting &&
        typeof currentDoc.content === 'object' &&
        currentDoc.content !== null &&
        'markdown' in currentDoc.content
          ? (currentDoc.content as { markdown: string }).markdown || ''
          : '';

      // 构建增强的prompt
      let enhancedPrompt = userInput || '';
      if (isDocumentGenerationRequest) {
        // 如果是文档生成请求，添加结构化输出指令
        if (isPPTRequest) {
          // 如果是更新现有PPT，包含现有内容并指示AI补充
          if (shouldUpdateExisting && existingContent) {
            // 检查是否是局部页面更新
            if (targetPages && targetPages.length > 0) {
              // 局部页面更新：提取指定页面
              const slides = existingContent
                .split(/^---$/m)
                .filter((s) => s.trim());
              const targetSlides: string[] = [];
              const otherSlides: string[] = [];

              slides.forEach((slide, index) => {
                if (targetPages.includes(index + 1)) {
                  targetSlides.push(slide);
                } else {
                  otherSlides.push(slide);
                }
              });

              enhancedPrompt = `【要更新的页面】第 ${targetPages.join(', ')} 页

【当前内容】
${targetSlides.join('\n---\n')}

---

【用户请求】
${userInput || ''}

【任务说明】
请只更新指定的第 ${targetPages.join(', ')} 页内容，保持其他页面不变。

【重要】请按以下格式输出：

第一部分：简要确认（1-2行）
格式：✅ 已更新第X页：[简要说明修改内容]

第二部分：分隔符
---UPDATE_CONTENT---

第三部分：更新后的幻灯片内容
只输出更新后的这几页完整内容，严格遵循Markdown格式。

【重要格式要求】幻灯片内容请严格按照以下Markdown格式，使用智能可视化传达信息：
`;
            } else {
              // 全文更新
              enhancedPrompt = `【当前PPT内容】
${existingContent}

---

【用户请求】
${userInput || ''}

【任务说明】
请基于用户的请求，对上述PPT内容进行补充或修改。输出完整的PPT内容（包括原有内容和新增内容），严格遵循以下格式：

【重要格式要求】请严格按照以下Markdown格式输出PPT内容，使用智能可视化传达信息：
`;
            }
          } else {
            // 创建新PPT
            enhancedPrompt = `${userInput || ''}

【重要格式要求】请严格按照以下Markdown格式输出PPT内容，使用智能可视化传达信息：
`;
          }

          // 添加格式示例（更新和新建都需要）
          enhancedPrompt += `
### Slide 1: [封面标题]
- 副标题或核心观点

---

### Slide 2: [流程步骤页标题]
<!-- FLOW -->
- **步骤1**：第一步描述
- **步骤2**：第二步描述
- **步骤3**：第三步描述
- **步骤4**：第四步描述

---

### Slide 3: [数据趋势页标题]
<!-- CHART:line -->
- 2020: 100
- 2021: 150
- 2022: 220
- 2023: 350
- 2024: 480

---

### Slide 4: [占比分布页标题]
<!-- CHART:pie -->
- A类: 35
- B类: 28
- C类: 22
- D类: 15

---

### Slide 5: [矩阵分析页标题]
<!-- MATRIX -->
- **高优先级-高价值**：核心项目，立即执行
- **高优先级-低价值**：短期任务，快速完成
- **低优先级-高价值**：战略储备，规划投入
- **低优先级-低价值**：暂缓执行，定期评估

---

### Slide 6: [常规内容页标题]
- 要点1：简洁表述
- 要点2：数据支撑（用**粗体**突出数字）
- 要点3：行动建议

---

【内容要求 - 智能可视化】
1. **基础格式**：
   - 每页幻灯片必须以 "### Slide X: " 开头（X为页码）
   - 使用 "---" 分隔不同幻灯片
   - 内容使用列表形式（- 开头），简洁专业

2. **可视化标记** - 根据内容类型选择合适的可视化方式：

   **流程图** - 当内容是步骤、流程、时间线时使用：
   <!-- FLOW -->
   - **步骤1**：描述
   - **步骤2**：描述
   - **步骤3**：描述

   **折线图** - 当展示趋势、变化时使用：
   <!-- CHART:line -->
   - 标签1: 数值1
   - 标签2: 数值2

   **饼图** - 当展示占比、分布时使用：
   <!-- CHART:pie -->
   - 类别A: 数值A
   - 类别B: 数值B

   **柱状图** - 当展示对比、排名时使用：
   <!-- CHART:bar -->
   - 项目1: 数值1
   - 项目2: 数值2

   **雷达图** - 当展示多维度评估时使用：
   <!-- CHART:radar -->
   - 维度1: 数值1
   - 维度2: 数值2
   - 维度3: 数值3

   **矩阵** - 当展示2x2分析、象限时使用：
   <!-- MATRIX -->
   - **象限1名称**：描述
   - **象限2名称**：描述
   - **象限3名称**：描述
   - **象限4名称**：描述

3. **专注内容价值**：
   - ✅ 使用智能可视化（流程图、图表、矩阵）传达信息
   - ✅ 数据用**加粗**，百分比/数字清晰呈现
   - ✅ 流程用数字序号和箭头（→）连接
   - ❌ 不要添加图片链接（系统将根据主题智能生成配图）
   - ❌ 不要长段落（超过2行）

【示例主题映射】
如果主题是"产品开发流程"，应该使用：
- 流程步骤 → <!-- FLOW -->
- 进度数据 → <!-- CHART:line -->
- 资源分配 → <!-- CHART:pie -->

如果主题是"市场分析"，应该使用：
- 趋势数据 → <!-- CHART:line -->
- 市场份额 → <!-- CHART:pie -->
- 竞品对比 → <!-- CHART:bar -->
- SWOT分析 → <!-- MATRIX -->

如果主题是"能力评估"，应该使用：
- 多维能力 → <!-- CHART:radar -->
- 发展阶段 → <!-- FLOW -->

请根据内容逻辑智能选择可视化方式，专注内容质量而非依赖图片。直接输出PPT内容，不要添加说明文字。`;
        } else {
          enhancedPrompt = `${userInput || ''}

【重要】请直接生成可用的文档内容，使用Markdown格式。`;
        }
      }

      // 获取当前文档的对话历史（用于上下文）
      const conversationHistory =
        useChatStore.getState().sessions[targetDocumentId] || [];

      // 调用AI Office API
      const response = await fetch('/api/ai-office/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: enhancedPrompt,
          resources: selectedResources,
          documentId: targetDocumentId,
          stream: true,
          isDocumentGeneration: isDocumentGenerationRequest,
          agentMode: agentMode, // Pass agent mode to API
          conversationHistory: conversationHistory, // 发送完整对话历史
        }),
      });

      if (!response.ok) {
        throw new Error('AI service request failed');
      }

      // 处理流式响应
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let aiContent = '';
      let isPartialUpdateWithSeparator = false; // 标记是否是带分隔符的局部更新
      let confirmationPart = ''; // 确认消息部分
      let contentPart = ''; // 实际内容部分

      // 创建AI消息
      const aiMessageId = (Date.now() + 1).toString();
      const aiMessage = {
        id: aiMessageId,
        documentId: targetDocumentId,
        role: 'assistant' as const,
        content: '',
        timestamp: new Date(),
      };
      addMessage(targetDocumentId, aiMessage);

      if (reader) {
        while (true) {
          // 检查是否需要停止
          if (useChatStore.getState().shouldStopGeneration) {
            reader.cancel();
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  aiContent += parsed.content;

                  // 检查是否包含分隔符（局部更新模式）
                  const separatorIndex = aiContent.indexOf(
                    '---UPDATE_CONTENT---'
                  );
                  if (separatorIndex !== -1 && !isPartialUpdateWithSeparator) {
                    // 检测到分隔符，切换到局部更新模式
                    isPartialUpdateWithSeparator = true;
                    logger.debug(
                      '[ChatPanel] Detected partial update separator'
                    );
                  }

                  // 根据模式更新消息内容
                  let displayContent = aiContent;
                  if (isPartialUpdateWithSeparator) {
                    const parts = aiContent.split('---UPDATE_CONTENT---');
                    confirmationPart = parts[0].trim();
                    contentPart = parts[1] ? parts[1].trim() : '';
                    displayContent = confirmationPart; // 只显示确认消息
                    logger.debug('[ChatPanel] Confirmation:', confirmationPart);
                    logger.debug(
                      '[ChatPanel] Content length:',
                      contentPart.length
                    );
                  }

                  // 更新消息内容（显示确认消息或完整内容）
                  useChatStore
                    .getState()
                    .updateMessage(targetDocumentId, aiMessageId, {
                      content: displayContent,
                    });

                  // 实时同步到文档
                  const currentDoc = useDocumentStore
                    .getState()
                    .documents.find((d) => d._id === targetDocumentId);
                  if (currentDoc) {
                    // 判断是局部更新还是全文更新
                    // 如果是带分隔符的局部更新，使用 contentPart；否则使用 aiContent
                    const contentForMerge = isPartialUpdateWithSeparator
                      ? contentPart
                      : aiContent;
                    let finalContent = contentForMerge;

                    if (
                      targetPages &&
                      targetPages.length > 0 &&
                      existingContent
                    ) {
                      logger.debug(
                        '[ChatPanel] Performing partial page update'
                      );
                      // 局部页面更新：合并页面
                      const existingSlides = existingContent
                        .split(/^---$/m)
                        .filter((s) => s.trim());
                      const newSlides = contentForMerge
                        .split(/^---$/m)
                        .filter((s) => s.trim());

                      logger.debug(
                        '[ChatPanel] Existing slides:',
                        existingSlides.length
                      );
                      logger.debug(
                        '[ChatPanel] New slides from AI:',
                        newSlides.length
                      );
                      logger.debug(
                        '[ChatPanel] Target pages to update:',
                        targetPages
                      );

                      // 替换指定页面
                      const mergedSlides = [...existingSlides];
                      targetPages.forEach((pageNum, index) => {
                        if (
                          newSlides[index] &&
                          pageNum <= mergedSlides.length
                        ) {
                          logger.debug(
                            `[ChatPanel] Replacing slide ${pageNum} with new content`
                          );
                          mergedSlides[pageNum - 1] = newSlides[index];
                        } else {
                          logger.warn(
                            `[ChatPanel] Cannot replace slide ${pageNum}: out of range or no new content`
                          );
                        }
                      });

                      finalContent = mergedSlides.join('\n\n---\n\n');
                      logger.debug(
                        '[ChatPanel] Merge complete. Total slides:',
                        mergedSlides.length
                      );
                    } else {
                      logger.debug(
                        '[ChatPanel] Full document update (no targetPages or no existingContent)'
                      );
                    }

                    // 计算 slideCount（如果是PPT文档）
                    let slideCount = currentDoc.metadata.slideCount;
                    if (currentDoc.type === 'ppt') {
                      slideCount = calculateSlideCount(finalContent);
                    }

                    useDocumentStore
                      .getState()
                      .updateDocument(targetDocumentId, {
                        content: {
                          ...currentDoc.content,
                          markdown: finalContent,
                        },
                        metadata: {
                          ...currentDoc.metadata,
                          wordCount: finalContent.length,
                          slideCount: slideCount,
                        },
                        updatedAt: new Date(),
                      });
                  }
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }
      }

      // 流式生成已经在过程中实时同步到文档，这里只需要结束生成状态
      setStreaming(false);

      // 获取最终的文档状态（确保是最新的）
      const finalDocument = useDocumentStore
        .getState()
        .documents.find((d) => d._id === targetDocumentId);

      // 如果是文档生成请求，更新文档状态并自动保存版本
      if (isDocumentGenerationRequest && finalDocument) {
        // 更新文档状态为已完成
        useDocumentStore.getState().updateDocument(targetDocumentId, {
          status: 'completed',
          updatedAt: new Date(),
        });

        // 立即保存版本（不使用 setTimeout，避免竞态条件）
        try {
          // 重新获取文档以确保状态最新
          const currentDocument = useDocumentStore
            .getState()
            .documents.find((d) => d._id === targetDocumentId);

          if (currentDocument) {
            // 判断是更新现有文档还是初始生成
            const wasExistingDoc = hasExistingDocument && isUpdateRequest;
            const versionDescription = wasExistingDoc
              ? `更新文档：${userInput.substring(0, 50)}${userInput.length > 50 ? '...' : ''}`
              : `初始生成：${currentDocument.title}`;

            saveVersion(
              targetDocumentId,
              'auto',
              'ai_generation',
              versionDescription
            );
          }
        } catch (error) {
          logger.error('Failed to save version:', error);
        }
      }

      // 更新任务为完成状态（包含文档内容快照）
      // 使用最终的文档状态，确保数据一致性
      if (taskId && finalDocument) {
        const allMessages =
          useChatStore.getState().sessions[targetDocumentId] || [];

        // 深拷贝文档内容、元数据和版本历史，避免引用问题
        const documentContentSnapshot = JSON.parse(
          JSON.stringify(finalDocument.content)
        );
        const documentMetadataSnapshot = JSON.parse(
          JSON.stringify(finalDocument.metadata)
        );
        const documentVersionsSnapshot = JSON.parse(
          JSON.stringify(finalDocument.versions || [])
        );

        logger.debug('[ChatPanel] Updating task with document snapshot:', {
          taskId,
          documentId: targetDocumentId,
          hasContent: !!documentContentSnapshot,
          hasMarkdown: !!documentContentSnapshot?.markdown,
          markdownLength: documentContentSnapshot?.markdown?.length || 0,
          slideCount: documentMetadataSnapshot?.slideCount,
          versionCount: documentVersionsSnapshot.length,
        });

        useTaskStore.getState().updateTask(taskId, {
          context: {
            resourceIds:
              useTaskStore.getState().tasks.find((t) => t._id === taskId)
                ?.context.resourceIds || selectedResourceIds,
            documentId: targetDocumentId,
            documentContent: documentContentSnapshot, // 保存文档内容快照
            documentMetadata: documentMetadataSnapshot, // 保存文档元数据快照
            documentVersions: documentVersionsSnapshot, // 保存文档版本历史快照
            chatMessages: allMessages,
          },
          metadata: {
            wordCount: aiContent.length,
          },
        });

        // 验证任务是否正确保存
        const savedTask = useTaskStore
          .getState()
          .tasks.find((t) => t._id === taskId);
        logger.debug('[ChatPanel] Task saved verification:', {
          taskId,
          hasDocumentContent: !!savedTask?.context.documentContent,
          contentMarkdownLength:
            (
              savedTask?.context.documentContent as
                | { markdown?: string }
                | undefined
            )?.markdown?.length || 0,
        });
      }
    } catch (error) {
      logger.error('AI chat error:', error);
      // 添加错误消息到目标文档
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        documentId: targetDocumentId,
        role: 'assistant' as const,
        content: '抱歉，AI服务暂时不可用，请稍后再试。',
        timestamp: new Date(),
      };
      addMessage(targetDocumentId, errorMessage);
      setStreaming(false);

      // 标记任务为失败
      if (taskId) {
        useTaskStore.getState().updateTask(taskId, {
          metadata: {
            description: `错误: ${error instanceof Error ? error.message : 'AI服务暂时不可用'}`,
          },
        });
      }
    }
  };

  // 生成文档
  const handleGenerateDocument = async (config: GenerationConfig) => {
    if (isStreaming || selectedResourceIds.length === 0) return;

    setGenerating(true);
    setStreaming(true);

    // 检查是否有当前活跃任务
    let taskId: string;
    const existingTask = currentTaskId
      ? useTaskStore.getState().tasks.find((t) => t._id === currentTaskId)
      : null;

    if (existingTask && existingTask.context.documentId) {
      // 有当前任务且有关联文档，在此任务下继续工作
      taskId = currentTaskId!;
      // 更新任务的 refreshedAt 时间
      useTaskStore.getState().updateTask(taskId, {
        refreshedAt: new Date(),
      });
    } else {
      // 创建新任务
      taskId = `task-${Date.now()}`;
      const newTask: Task = {
        _id: taskId,
        title: `${config.template.name} - ${formatDateSafe(new Date(), 'time')}`,
        type:
          config.template.name.includes('PPT') ||
          config.template.name.includes('演示')
            ? 'ppt'
            : 'article',
        createdAt: new Date(),
        refreshedAt: new Date(),
        context: {
          resourceIds: selectedResourceIds,
          chatMessages: messages,
          aiConfig: config.options,
          prompt: `生成${config.template.name}`,
        },
        metadata: {
          description: config.template.name,
        },
      };
      useTaskStore.getState().addTask(newTask);
      useTaskStore.getState().setCurrentTask(taskId);
    }

    // 初始化生成步骤
    const steps = [
      {
        id: 'prepare',
        name: '准备资源',
        status: 'processing' as const,
        message: '正在分析选中的资源...',
      },
      {
        id: 'expand',
        name: '智能扩展',
        status: 'pending' as const,
        message: '搜索相关图片、数据和文献',
      },
      {
        id: 'outline',
        name: '生成大纲',
        status: 'pending' as const,
        message: '根据模板和资源生成文档结构',
      },
      {
        id: 'content',
        name: '生成内容',
        status: 'pending' as const,
        message: 'AI正在编写文档内容',
      },
      {
        id: 'finalize',
        name: '完成',
        status: 'pending' as const,
        message: '整理和格式化文档',
      },
    ];
    setGenerationSteps(steps);
    setCurrentStep('prepare');

    try {
      // 获取选中的资源
      const selectedResources = useResourceStore
        .getState()
        .resources.filter((r) => selectedResourceIds.includes(r._id));

      // 步骤1: 准备资源 - 完成
      setTimeout(() => {
        updateGenerationStep('prepare', {
          status: 'completed',
          message: `已加载 ${selectedResources.length} 个资源`,
        });
        setCurrentStep('expand');
        updateGenerationStep('expand', {
          status: 'processing',
          message: '正在搜索扩展资源...',
        });
        // 更新任务进度
        useTaskStore.getState().updateTask(taskId, {
          metadata: { progress: 20 },
        });
      }, 1000);

      // 步骤2: 智能扩展 (模拟)
      setTimeout(() => {
        setResourcesFound(12); // 模拟找到12个扩展资源
        updateGenerationStep('expand', {
          status: 'completed',
          message: '找到 12 个相关资源',
        });
        setCurrentStep('outline');
        updateGenerationStep('outline', {
          status: 'processing',
          message: '正在生成文档大纲...',
        });
        // 更新任务进度
        useTaskStore.getState().updateTask(taskId, {
          metadata: { progress: 40 },
        });
      }, 3000);

      // 构建生成文档的提示
      const templateInfo = `文档类型：${config.template.name}\n详细程度：${config.options.detailLevel}/3\n语言风格：${config.options.tone}`;
      const sectionsInfo = config.template.sections
        .map((s) => `- ${s.title}: ${s.aiPrompt}`)
        .join('\n');

      const prompt =
        messages.length > 0
          ? `基于我们的对话和选中的资源，按照以下要求生成文档：\n\n${templateInfo}\n\n章节要求：\n${sectionsInfo}`
          : `请基于以下资源生成文档：\n${selectedResources.map((r, i) => `${i + 1}. ${r.metadata?.title || '无标题'}`).join('\n')}\n\n${templateInfo}\n\n章节要求：\n${sectionsInfo}`;

      // 调用AI Office API生成文档
      const response = await fetch('/api/ai-office/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: prompt,
          resources: selectedResources,
          generateDocument: true,
          stream: true,
          agentMode: agentMode, // Pass agent mode to API
        }),
      });

      if (!response.ok) {
        throw new Error('Document generation failed');
      }

      // 确定文档ID：如果是在现有任务下工作，使用现有文档；否则创建新文档
      let newDocumentId: string;
      if (existingTask && existingTask.context.documentId) {
        // 使用现有任务的文档
        newDocumentId = existingTask.context.documentId;
        setCurrentDocument(newDocumentId);
        // 更新文档状态为生成中
        useDocumentStore.getState().updateDocument(newDocumentId, {
          status: 'generating',
          updatedAt: new Date(),
        });
      } else {
        // 创建新文档
        newDocumentId = `doc-${Date.now()}`;
        const newDocument = {
          _id: newDocumentId,
          userId: 'current-user',
          type: 'article' as const,
          title: `${config.template.name} - ${formatDateSafe(new Date(), 'date')}`,
          status: 'generating' as const,
          resources: selectedResources.map((r) => ({
            resourceRef: {
              type: r.resourceType,
              collection: `resource-${r.resourceType}`,
              id: r._id,
            },
          })),
          aiConfig: {
            model: 'grok',
            language: 'zh-CN',
            detailLevel: 3,
            professionalLevel: 3,
          },
          generationHistory: [
            {
              timestamp: new Date(),
              action: 'create' as const,
              aiModel: 'grok',
            },
          ],
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

        addDocument(newDocument);
        setCurrentDocument(newDocumentId);
      }

      // 步骤3: 生成大纲完成，开始生成内容
      setTimeout(() => {
        updateGenerationStep('outline', {
          status: 'completed',
          message: '文档大纲已生成',
        });
        setCurrentStep('content');
        updateGenerationStep('content', {
          status: 'processing',
          message: 'AI正在编写文档内容...',
        });
        // 更新任务进度
        useTaskStore.getState().updateTask(taskId, {
          metadata: { progress: 60 },
        });
      }, 5000);

      // 处理流式响应
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let documentContent = '';

      if (reader) {
        while (true) {
          // 检查是否需要停止
          if (useChatStore.getState().shouldStopGeneration) {
            reader.cancel();
            // 标记文档状态为草稿
            useDocumentStore.getState().updateDocument(newDocumentId, {
              status: 'draft' as const,
            });
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  documentContent += parsed.content;
                  // 更新文档内容
                  useDocumentStore.getState().updateDocument(newDocumentId, {
                    content: {
                      markdown: documentContent,
                    },
                    metadata: {
                      wordCount: documentContent.length,
                    },
                  });
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }
      }

      // 步骤4: 内容生成完成，开始最后整理
      updateGenerationStep('content', {
        status: 'completed',
        message: '文档内容已生成',
      });
      setCurrentStep('finalize');
      updateGenerationStep('finalize', {
        status: 'processing',
        message: '正在整理和格式化...',
      });
      // 更新任务进度
      useTaskStore.getState().updateTask(taskId, {
        metadata: { progress: 90 },
      });

      // 短暂延迟后完成
      setTimeout(() => {
        updateGenerationStep('finalize', {
          status: 'completed',
          message: '文档生成完成！',
        });
        // 完成任务并保存上下文（包含文档内容快照）
        const finalDocument = useDocumentStore
          .getState()
          .documents.find((d) => d._id === newDocumentId);

        // 深拷贝文档内容和元数据
        const documentContentSnapshot = finalDocument?.content
          ? JSON.parse(JSON.stringify(finalDocument.content))
          : undefined;
        const documentMetadataSnapshot = finalDocument?.metadata
          ? JSON.parse(JSON.stringify(finalDocument.metadata))
          : undefined;

        useTaskStore.getState().updateTask(taskId, {
          context: {
            resourceIds: selectedResourceIds,
            documentId: newDocumentId,
            documentContent: documentContentSnapshot, // 保存文档内容快照
            documentMetadata: documentMetadataSnapshot, // 保存文档元数据快照
            chatMessages:
              useChatStore.getState().sessions[currentDocumentId] || [],
            aiConfig: config.options,
          },
          metadata: {
            progress: 100,
            wordCount: documentContent.length,
          },
        });
      }, 500);

      // 添加成功消息到聊天
      const successMessage = {
        id: Date.now().toString(),
        documentId: currentDocumentId,
        role: 'assistant' as const,
        content: '文档已生成完成！您可以在右侧面板查看和编辑。',
        timestamp: new Date(),
      };
      addMessage(currentDocumentId, successMessage);

      // 自动保存版本快照
      try {
        const versionDescription = existingTask
          ? `刷新文档：${config.template.name}`
          : `初始生成：${config.template.name}`;
        saveVersion(newDocumentId, 'auto', 'ai_generation', versionDescription);
      } catch (error) {
        logger.error('Failed to save version:', error);
      }

      setStreaming(false);
      setTimeout(() => setGenerating(false), 1500); // 延迟关闭进度显示，让用户看到完成状态
    } catch (error) {
      logger.error('Document generation error:', error);
      const errorMessage = {
        id: Date.now().toString(),
        documentId: currentDocumentId,
        role: 'assistant' as const,
        content: '抱歉，文档生成失败，请稍后再试。',
        timestamp: new Date(),
      };
      addMessage(currentDocumentId, errorMessage);
      setStreaming(false);
      setGenerating(false);
      // 标记任务为失败
      useTaskStore.getState().updateTask(taskId, {
        metadata: {
          error: error instanceof Error ? error.message : '文档生成失败',
        },
      });
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 标题栏 - 固定 */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 shadow-sm">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-base font-semibold text-gray-800">AI 智能助手</h3>
        </div>

        <div className="flex items-center space-x-3">
          {/* Agent Mode Toggle */}
          <button
            onClick={() =>
              setAgentMode(agentMode === 'basic' ? 'enhanced' : 'basic')
            }
            className={`group flex items-center space-x-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
              agentMode === 'enhanced'
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title={
              agentMode === 'enhanced'
                ? 'Multi-Agent增强模式已启用'
                : '点击启用Multi-Agent增强模式'
            }
          >
            {agentMode === 'enhanced' ? (
              <>
                <Bot className="h-3.5 w-3.5" />
                <span>增强</span>
                <Zap className="h-3 w-3 text-yellow-500" />
              </>
            ) : (
              <>
                <Bot className="h-3.5 w-3.5" />
                <span>基础</span>
              </>
            )}
          </button>

          {/* Status Display */}
          <div className="text-xs text-gray-500">
            {agentStatus ? (
              <span className="flex items-center space-x-1">
                <Bot className="h-3.5 w-3.5 animate-pulse text-blue-500" />
                <span className="text-blue-700">{agentStatus}</span>
              </span>
            ) : isStreaming ? (
              <span className="flex items-center space-x-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                <span>生成中...</span>
              </span>
            ) : (
              <span>就绪</span>
            )}
          </div>
        </div>
      </div>

      {/* 对话历史 */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-12 w-12" />}
            title="开始与AI对话"
            description="选择资源后，询问AI帮你生成文档"
          />
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`group flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className="max-w-[85%]">
                  <MessageRenderer
                    content={message.content}
                    role={message.role as 'user' | 'assistant'}
                  />
                  <div
                    className={`mt-1 flex items-center gap-2 text-xs ${
                      message.role === 'user'
                        ? 'justify-end text-gray-500'
                        : 'text-gray-500'
                    }`}
                  >
                    <span>{formatDateSafe(message.timestamp, 'time')}</span>
                    {/* Action buttons for AI messages */}
                    {message.role === 'assistant' && (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {/* Copy button */}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(message.content);
                            // Show a brief confirmation
                            const btn = document.getElementById(
                              `copy-btn-${message.id}`
                            );
                            if (btn) {
                              const originalContent = btn.textContent;
                              const span = btn.querySelector('span:last-child');
                              if (span) {
                                span.textContent = 'Copied!';
                                span.className = 'text-green-600';
                              }
                              setTimeout(() => {
                                if (span && originalContent) {
                                  span.textContent = 'Copy';
                                  span.className = '';
                                }
                              }, 1500);
                            }
                          }}
                          id={`copy-btn-${message.id}`}
                          className="flex items-center gap-1 rounded px-2 py-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                          title="Copy to clipboard"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy</span>
                        </button>
                        {/* Quote button - add as context for next message */}
                        <button
                          onClick={() => {
                            // Add quoted text to input for follow-up discussion
                            const quotedText = `> ${message.content.split('\n').slice(0, 3).join('\n> ')}${message.content.split('\n').length > 3 ? '\n> ...' : ''}\n\n`;
                            setInput((prev) => quotedText + prev);
                            inputRef.current?.focus();
                          }}
                          className="flex items-center gap-1 rounded px-2 py-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                          title="Quote this response for follow-up"
                        >
                          <Quote className="h-3.5 w-3.5" />
                          <span>Quote</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {isStreaming && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-gray-100 px-4 py-2 text-gray-900">
                  <div className="flex items-center space-x-2">
                    <div className="flex space-x-1">
                      <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 delay-100" />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400 delay-200" />
                    </div>
                    <span className="text-sm">AI正在思考...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 输入框 - 固定 */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-white p-4">
        {/* 斜杠命令菜单 */}
        <SlashCommandMenu
          isOpen={showSlashMenu}
          searchQuery={slashSearch}
          position={slashPosition}
          selectedIndex={selectedSlashIndex}
          onSelect={selectSlashCommand}
          onClose={() => setShowSlashMenu(false)}
          onNavigate={(direction) => {
            if (direction === 'up') {
              setSelectedSlashIndex((prev) =>
                prev > 0 ? prev - 1 : filteredSlashCommands.length - 1
              );
            } else {
              setSelectedSlashIndex((prev) =>
                prev < filteredSlashCommands.length - 1 ? prev + 1 : 0
              );
            }
          }}
        />

        {/* @ 提及菜单 */}
        {showMentionMenu && (
          <div
            className="fixed z-50 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
            style={{
              top: `${mentionPosition.top}px`,
              left: `${mentionPosition.left}px`,
              minWidth: '250px',
            }}
          >
            {/* @all 选项 */}
            <div
              onClick={() => selectMention('all')}
              className={`flex cursor-pointer items-center space-x-2 border-b border-gray-100 px-4 py-2 hover:bg-blue-50 ${
                selectedMentionIndex === 0 ? 'bg-blue-100' : ''
              }`}
            >
              <span className="font-semibold text-blue-600">@all</span>
              <span className="text-xs text-gray-500">
                ({resources.length} 个资源)
              </span>
            </div>

            {/* 资源列表 */}
            {filteredResources.length > 0 ? (
              filteredResources.map((resource, index) => (
                <div
                  key={resource._id}
                  onClick={() => selectMention(resource._id)}
                  className={`cursor-pointer px-4 py-2 hover:bg-blue-50 ${
                    selectedMentionIndex === index + 1 ? 'bg-blue-100' : ''
                  }`}
                >
                  <div className="text-sm font-medium text-gray-900">
                    {resource.metadata?.title || '无标题'}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {resource.resourceType}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-3 text-center text-sm text-gray-500">
                未找到匹配的资源
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              // 斜杠命令菜单键盘导航
              if (showSlashMenu) {
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSelectedSlashIndex((prev) =>
                    prev > 0 ? prev - 1 : filteredSlashCommands.length - 1
                  );
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSelectedSlashIndex((prev) =>
                    prev < filteredSlashCommands.length - 1 ? prev + 1 : 0
                  );
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (filteredSlashCommands[selectedSlashIndex]) {
                    selectSlashCommand(
                      filteredSlashCommands[selectedSlashIndex]
                    );
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowSlashMenu(false);
                } else if (e.key === 'Tab') {
                  e.preventDefault();
                  if (filteredSlashCommands[selectedSlashIndex]) {
                    selectSlashCommand(
                      filteredSlashCommands[selectedSlashIndex]
                    );
                  }
                }
              }
              // @ 提及菜单键盘导航
              else if (showMentionMenu) {
                const mentionOptions = [
                  'all',
                  ...filteredResources.map((r) => r._id),
                ];

                // 上箭头 - 向上选择
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSelectedMentionIndex((prev) =>
                    prev > 0 ? prev - 1 : mentionOptions.length - 1
                  );
                }
                // 下箭头 - 向下选择
                else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSelectedMentionIndex((prev) =>
                    prev < mentionOptions.length - 1 ? prev + 1 : 0
                  );
                }
                // Enter - 选择当前项
                else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  selectMention(mentionOptions[selectedMentionIndex]);
                }
                // ESC - 关闭菜单
                else if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowMentionMenu(false);
                }
              } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入 / 使用命令，@ 引用资源，或直接输入消息... (Enter 发送)"
            className="w-full resize-none rounded-xl border-2 border-gray-200 px-4 py-3 pb-12 pr-28 transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-0"
            rows={3}
            disabled={isStreaming}
          />
          <div className="absolute bottom-3 right-3 flex items-center space-x-2">
            <button
              className="rounded-lg p-2 transition-colors hover:bg-gray-100"
              title="附加资源"
              disabled={isStreaming}
            >
              <Paperclip className="h-5 w-5 text-gray-500" />
            </button>
            {isStreaming ? (
              <button
                onClick={stopGeneration}
                className="flex items-center space-x-1.5 rounded-lg bg-red-600 px-4 py-2 text-white shadow-sm transition-all hover:bg-red-700"
              >
                <StopCircle className="h-4 w-4" />
                <span className="font-medium">停止</span>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="flex items-center space-x-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2 text-white shadow-sm transition-all hover:from-blue-700 hover:to-blue-800 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300"
              >
                <Send className="h-4 w-4" />
                <span className="font-medium">发送</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 文档生成向导 */}
      <DocumentGenerationWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onGenerate={handleGenerateDocument}
        selectedResourceCount={selectedResourceIds.length}
      />

      {/* 生成进度组件 */}
      <GenerationProgress
        isVisible={isGenerating}
        currentStep={currentStep}
        steps={generationSteps}
        resourcesFound={resourcesFound}
        estimatedTime={estimatedTime || undefined}
        onCancel={() => {
          stopGeneration();
          setGenerating(false);
        }}
      />
    </div>
  );
}
