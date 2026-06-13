'use client';

/**
 * Slides Engine - 主页面组件
 *
 * 根据设计文档 Section 7 实现：
 * - 浅色主题，与项目整体风格一致
 * - 两栏布局：对话面板 + 预览面板
 * - 底部进度条
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  History,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Brain,
  FileText,
  Send,
  ChevronDown,
  Layers,
  Eye,
  Palette,
  Grid3X3,
  Sparkles,
  RefreshCw,
  Trash2,
  LayoutGrid,
  List,
  Plus,
  FolderOpen,
  X,
  ArrowLeft,
  Home,
  Copy,
  Terminal,
  Play,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Check,
  MoreVertical,
  Crown,
  Search,
  PenTool,
  CheckCircle,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils/common';
import { useSlidesStore, selectOverallProgress } from '@/stores';
import {
  useSlideGenerationTeam,
  useCheckpoints,
  useSessions,
  useThemes,
  SessionWithCheckpoint,
} from '@/hooks/features/slides';
import type { SlideThemePreview } from '@/hooks/features/slides';
import type {
  GenerateRequest,
  PageState,
  PageOutline,
  GenerationProgress,
  OutlinePlan,
} from '@/lib/types/slides';
import type { GenerateTeamRequest } from '@/lib/types/slides-team';
import { AgentTeamPanel } from './AgentTeamPanel';
import { PhaseTimeline } from './PhaseTimeline';
import { AIAssistMenu } from './AIAssistMenu';
import {
  useSlidesHistoryStore,
  formatRelativeTime,
  SlidesHistoryItem,
} from '@/stores';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import { sanitizeSlideHtml } from '@/lib/utils/sanitize';
import { ThemeSelector } from './ThemeSelector';

// ★ 导入拆分后的组件
import { ConversationPanel, type ToolCallItem } from './SlidesEditor';
import { PreviewPanel } from './SlidesPreview';
import { PresentationMode } from './SlidesPresentation';
import { Header, HistoryPanel, ProgressBar } from './SlidesToolbar';
import { SessionsGallery } from './SlidesGallery';
import { SourceImportModal } from './SourceImportModal';
import type { SlidesSourceData } from '@/hooks/features/slides';

// ★ V5.0 新布局组件 (PRD Section 12)
import { SlidesWorkspace } from './SlidesWorkspace';

import { logger } from '@/lib/utils/logger';
import { useI18n } from '@/lib/i18n/i18n-context';
// ============================================================================
// 类型定义
// ============================================================================
// (ToolCallItem 已移至 SlidesEditor.tsx)

// ============================================================================
// 主组件
// ============================================================================

export function SlidesTab() {
  const { t } = useI18n();
  const { session, pages, generating, streamEvents, progress, outlinePlan } =
    useSlidesStore();
  const { themes } = useThemes();
  const completedPages = pages.filter((p) => p.status === 'completed');
  const { generateWithTeam, cancel, teamState, teamEvents } =
    useSlideGenerationTeam();
  const { createCheckpoint, checkpoints } = useCheckpoints();
  const { history, addHistory, updateHistory, removeHistory, clearHistory } =
    useSlidesHistoryStore();
  const { restoreCheckpoint, restoreBySessionId } = useCheckpoints();
  const {
    sessions: backendSessions,
    loading: sessionsLoading,
    refresh: refreshSessions,
    updateSession,
    deleteSession,
  } = useSessions();
  const { user } = useAuth();
  const [toolCalls, setToolCalls] = useState<ToolCallItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showNewForm, setShowNewForm] = useState(false);
  const [showPresentation, setShowPresentation] = useState(false);
  const currentHistoryIdRef = useRef<string | null>(null);

  // 重置回到历史记录画廊
  const handleBackToGallery = useCallback(() => {
    const { reset } = useSlidesStore.getState();
    reset();
    setShowNewForm(false);
    refreshSessions();
  }, [refreshSessions]);

  // 重新生成：重置到画廊并立即打开新建表单
  const handleRegenerate = useCallback(() => {
    const { reset } = useSlidesStore.getState();
    reset();
    refreshSessions();
    setShowNewForm(true);
  }, [refreshSessions]);

  // ★ 清理不一致的状态：如果 generating=true 但没有活跃的生成进程，重置状态
  // 这可能发生在页面刷新或中途关闭后重新打开时
  useEffect(() => {
    const store = useSlidesStore.getState();
    // 如果标记为生成中，但没有 teamState（即没有活跃的 SSE 连接），说明是残留状态
    if (store.generating && !teamState) {
      store.reset(); // 完全重置，回到画廊视图
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在挂载时执行一次

  // ★ 自动隐藏历史记录：当有活跃会话、页面内容或正在生成时
  useEffect(() => {
    if (session || pages.length > 0 || generating) {
      setShowHistory(false);
    }
  }, [session, pages.length, generating]);

  // 将 streamEvents 和 teamEvents 转换为 toolCalls
  // 精简版：只显示关键节点，Agent 状态由 AgentTeamPanel 负责
  // 目标：最多显示 5-8 个条目，而不是 20+ 个
  useEffect(() => {
    const calls: ToolCallItem[] = [];
    let hasExecutionStarted = false;
    let hasExecutionCompleted = false;
    let totalPagesGenerated = 0;

    // 只处理 teamEvents（新格式），忽略旧格式的 streamEvents
    teamEvents.forEach((event) => {
      const id = `team-${event.type}-${event.timestamp}`;

      // 1. 开始事件 - 只显示一次
      if (event.type === 'execution:started') {
        if (!hasExecutionStarted) {
          hasExecutionStarted = true;
          calls.push({
            id,
            type: 'step',
            title: '🚀 开始生成',
            status: 'completed',
            timestamp: new Date(event.timestamp),
          });
        }
      }
      // 2. 阶段完成事件 - 只显示主要阶段的完成（不显示开始）
      else if (event.type === 'phase:completed') {
        const eventData = event.data as {
          phase: string;
          result?: Record<string, unknown>;
        };

        // 只显示关键阶段完成
        const keyPhases = ['analyzing', 'planning', 'generating', 'reviewing'];
        if (keyPhases.includes(eventData.phase)) {
          const phaseNames: Record<string, string> = {
            analyzing: '📊 内容分析完成',
            planning: '📝 大纲规划完成',
            generating: '🎨 页面生成完成',
            reviewing: '✅ 质量检查完成',
          };
          calls.push({
            id,
            type: 'step',
            title: phaseNames[eventData.phase] || eventData.phase,
            status: 'completed',
            timestamp: new Date(event.timestamp),
          });
        }
      }
      // 3. 页面生成 - 只统计数量，不单独显示每页
      else if (event.type === 'slide:generated') {
        totalPagesGenerated++;
      }
      // 4. 完成事件 - 只显示一次
      else if (event.type === 'execution:completed') {
        if (!hasExecutionCompleted) {
          hasExecutionCompleted = true;
          const data = event.data as {
            totalPages?: number;
            totalTime?: number;
          };
          calls.push({
            id,
            type: 'checkpoint',
            title: '🎉 生成完成',
            content: data.totalPages
              ? `共 ${data.totalPages} 页，耗时 ${((data.totalTime || 0) / 1000).toFixed(1)}s`
              : totalPagesGenerated > 0
                ? `共 ${totalPagesGenerated} 页`
                : undefined,
            status: 'completed',
            timestamp: new Date(event.timestamp),
          });
        }
      }
      // 5. 失败事件
      else if (event.type === 'execution:failed') {
        const data = event.data as { error?: string };
        calls.push({
          id,
          type: 'step',
          title: '❌ 生成失败',
          content: data.error,
          status: 'error',
          timestamp: new Date(event.timestamp),
        });
      }
      // 其他事件（agent:*, phase:started, heartbeat 等）不显示在时间线
      // Agent 状态完全由 AgentTeamPanel 负责显示
    });

    setToolCalls(calls);
  }, [streamEvents, teamEvents]);

  const handleSendMessage = useCallback(async (message: string) => {
    const { addStreamEvent, pages, selectedPageIndex, session } =
      useSlidesStore.getState();

    // 添加用户消息事件
    addStreamEvent({
      type: 'user_message',
      timestamp: new Date(),
      data: {
        message,
        pageNumber: pages[selectedPageIndex]?.pageNumber,
      },
    });

    // 解析用户意图：提取页码和修改要求
    // 支持中文数字（一二三...）和阿拉伯数字
    const chineseNumMap: Record<string, number> = {
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
      十一: 11,
      十二: 12,
      十三: 13,
      十四: 14,
      十五: 15,
    };
    const chineseNumPattern = Object.keys(chineseNumMap).join('|');
    const pageMatch = message.match(
      new RegExp(
        `第\\s*(\\d+|${chineseNumPattern})\\s*页|page\\s*(\\d+)|(\\d+)\\s*页`,
        'i'
      )
    );
    let targetPageNumber: number | undefined;
    if (pageMatch) {
      const matched = pageMatch[1] || pageMatch[2] || pageMatch[3];
      targetPageNumber = chineseNumMap[matched] || parseInt(matched, 10);
    } else {
      targetPageNumber = pages[selectedPageIndex]?.pageNumber;
    }

    // 检查是否是 @leader 继续执行命令
    if (message.toLowerCase().includes('@leader') && message.includes('继续')) {
      addStreamEvent({
        type: 'system_message',
        timestamp: new Date(),
        data: {
          message: '正在通知 Leader 继续执行任务...',
          source: '系统',
        },
      });
      // TODO: 实际触发后端继续任务
      return;
    }

    // 如果有 session 和目标页面，调用重新渲染 API
    if (session?.id && targetPageNumber) {
      const targetPage = pages.find((p) => p.pageNumber === targetPageNumber);
      if (targetPage) {
        addStreamEvent({
          type: 'system_message',
          timestamp: new Date(),
          data: {
            message: `正在处理第 ${targetPageNumber} 页的修改请求...`,
            source: 'AI 助手',
          },
        });

        try {
          const response = await fetch(
            `/api/ai-office/slides/sessions/${session.id}/rerender/${targetPageNumber}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ feedback: message }),
            }
          );

          if (response.ok) {
            const apiResult = await response.json();
            // Handle wrapped response { success: true, data: {...} }
            const result = apiResult?.data ?? apiResult;
            addStreamEvent({
              type: 'system_message',
              timestamp: new Date(),
              data: {
                message: `第 ${targetPageNumber} 页已重新生成。${result.events?.length || 0} 个更新事件。`,
                source: 'AI 助手',
              },
            });
          } else {
            const errorData = await response.json().catch(() => ({}));
            addStreamEvent({
              type: 'system_message',
              timestamp: new Date(),
              data: {
                message: `修改请求失败: ${errorData.message || '请稍后重试'}`,
                source: '系统',
              },
            });
          }
        } catch (error) {
          addStreamEvent({
            type: 'system_message',
            timestamp: new Date(),
            data: {
              message: `网络错误，请检查连接后重试。`,
              source: '系统',
            },
          });
        }
        return;
      }
    }

    // 无法确定页面时的默认响应
    const currentPage = pages[selectedPageIndex];
    addStreamEvent({
      type: 'system_message',
      timestamp: new Date(),
      data: {
        message: currentPage
          ? `收到您对第 ${currentPage.pageNumber} 页的修改建议。请确保演示文稿已完成生成后再进行修改。`
          : '请先选择一个页面，或在消息中指定页码（如"修改第3页"）。',
        source: 'AI 助手',
      },
    });
  }, []);

  const handleCreateCheckpoint = useCallback(() => {
    createCheckpoint('用户保存点');
  }, [createCheckpoint]);

  // 智能标签生成 - 基于内容主题分析
  const handleSmartTags = useCallback(async () => {
    const { pages, addStreamEvent } = useSlidesStore.getState();
    if (pages.length === 0) return;

    // 收集所有页面的文本内容用于分析
    const allText = pages
      .map((p) => {
        // 从 HTML 中提取纯文本，但排除 style 和 script 标签内容
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = p.html || '';
        // 移除 style 和 script 标签
        tempDiv.querySelectorAll('style, script').forEach((el) => el.remove());
        return tempDiv.textContent || tempDiv.innerText || '';
      })
      .join(' ');

    // 提取中文词组（2-4字的有意义词汇）
    const chineseWords: string[] = [];
    const chinesePattern = /[\u4e00-\u9fa5]{2,6}/g;
    let match;
    while ((match = chinesePattern.exec(allText)) !== null) {
      chineseWords.push(match[0]);
    }

    // 提取英文单词（排除常见技术词汇）
    const englishWords = allText
      .replace(/[\u4e00-\u9fa5]/g, ' ')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4);

    // CSS/HTML/技术停用词（这些不是内容相关的）
    const techStopWords = new Set([
      // CSS 属性
      'slide',
      'container',
      'overflow',
      'hidden',
      'height',
      'width',
      'display',
      'flex',
      'grid',
      'margin',
      'padding',
      'border',
      'background',
      'color',
      'font',
      'size',
      'style',
      'class',
      'position',
      'absolute',
      'relative',
      'fixed',
      'center',
      'left',
      'right',
      'top',
      'bottom',
      'auto',
      'none',
      'block',
      'inline',
      'item',
      'items',
      'content',
      'justify',
      'align',
      'text',
      'weight',
      'bold',
      'normal',
      'italic',
      'rgba',
      'rgb',
      'hover',
      'active',
      'focus',
      'before',
      'after',
      'first',
      'last',
      // HTML 标签
      'div',
      'span',
      'section',
      'header',
      'footer',
      'main',
      'article',
      'html',
      'body',
      'head',
      'title',
      'meta',
      'link',
      'script',
      // 通用技术词
      'function',
      'return',
      'const',
      'let',
      'var',
      'import',
      'export',
      'true',
      'false',
      'null',
      'undefined',
      'object',
      'array',
      'string',
      'number',
      'boolean',
      'type',
      'interface',
      'class',
      'props',
    ]);

    // 中文停用词（包括PPT结构性词汇和占位符）
    const chineseStopWords = new Set([
      // 基础停用词
      '的',
      '了',
      '是',
      '在',
      '有',
      '和',
      '与',
      '等',
      '为',
      '中',
      '对',
      '个',
      '上',
      '下',
      '不',
      '也',
      '就',
      '都',
      '而',
      '及',
      '这',
      '那',
      '你',
      '我',
      '他',
      '她',
      '它',
      '们',
      '会',
      '能',
      '要',
      '从',
      '到',
      '以',
      '可',
      '被',
      '让',
      '把',
      '将',
      '向',
      '着',
      '过',
      '给',
      '但',
      '如',
      '很',
      '更',
      '最',
      '还',
      '只',
      '又',
      '已',
      '所',
      '每',
      '其',
      '此',
      '或',
      '并',
      '使',
      '因',
      // PPT结构性词汇（不是内容主题）
      '目录',
      '报告',
      '方案',
      '介绍',
      '概述',
      '总结',
      '结论',
      '分析',
      '内容',
      '标题',
      '副标题',
      '章节',
      '部分',
      '页面',
      '幻灯片',
      '演示',
      '文稿',
      '说明',
      '备注',
      '附录',
      '参考',
      '引用',
      '来源',
      '图片',
      '图表',
      '数据',
      '表格',
      // 占位符词汇
      '缺失',
      '待补充',
      '待完善',
      '待更新',
      '请输入',
      '请填写',
      '此处',
      '这里',
      '示例',
      '样例',
      '模板',
      '占位',
      '未知',
      '无',
      // 泛化动词
      '提供',
      '包括',
      '包含',
      '涉及',
      '实现',
      '完成',
      '进行',
      '开展',
      '推进',
      '促进',
      '加强',
      '提升',
      '优化',
      '改进',
      '支持',
      '帮助',
      '服务',
    ]);

    // 检查词是否包含停用词（只检查长度>=2的停用词，避免单字误过滤）
    const containsStopWord = (word: string) => {
      for (const stopWord of chineseStopWords) {
        if (stopWord.length >= 2 && word.includes(stopWord)) return true;
      }
      return false;
    };

    // 统计中文词频（过滤停用词和包含停用词的复合词）
    const chineseWordCount: Record<string, number> = {};
    chineseWords.forEach((w) => {
      if (!chineseStopWords.has(w) && !containsStopWord(w) && w.length >= 2) {
        chineseWordCount[w] = (chineseWordCount[w] || 0) + 1;
      }
    });

    // 统计英文词频（排除技术词汇）
    const englishWordCount: Record<string, number> = {};
    const commonStopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'to',
      'of',
      'in',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'and',
      'or',
      'but',
      'not',
      'this',
      'that',
      'these',
      'those',
      'it',
      'its',
      'as',
      'if',
      'then',
      'than',
      'so',
      'such',
      'what',
      'which',
      'who',
      'whom',
      'when',
      'where',
      'why',
      'how',
    ]);
    englishWords.forEach((w) => {
      if (!techStopWords.has(w) && !commonStopWords.has(w)) {
        englishWordCount[w] = (englishWordCount[w] || 0) + 1;
      }
    });

    // 获取高频中文词作为主要标签
    const chineseTags = Object.entries(chineseWordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([word]) => word);

    // 获取高频英文词作为补充标签（首字母大写）
    const englishTags = Object.entries(englishWordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));

    // 合并标签，优先中文
    const tags = [...chineseTags, ...englishTags].slice(0, 5);

    // 如果当前有 session，更新历史记录
    if (session?.id) {
      const historyItem = history.find(
        (h) => h.sessionId === session.id || h.checkpointId === session.id
      );
      if (historyItem) {
        updateHistory(historyItem.id, { tags });
      }
    }

    // 显示成功提示
    addStreamEvent({
      type: 'system_message',
      timestamp: new Date(),
      data: {
        message: `已生成智能标签：${tags.join('、') || '暂无标签'}`,
        source: 'AI 辅助',
      },
    });
  }, [session, history, updateHistory]);

  const handleGenerate = useCallback(
    (request: GenerateRequest) => {
      const historyId = addHistory({
        title: request.title,
        sourceText: request.sourceText.slice(0, 200),
        targetPages: request.targetPages || 10,
        status: 'pending',
      });
      currentHistoryIdRef.current = historyId;
      // 转换为 Team 请求格式
      const teamRequest: GenerateTeamRequest = {
        title: request.title,
        sourceText: request.sourceText,
        userRequirement: request.title, // 同时作为用户需求
        targetPages: request.targetPages,
        stylePreference: request.stylePreference,
        themeId: request.themeId,
      };
      generateWithTeam(teamRequest);
    },
    [generateWithTeam, addHistory]
  );

  // 监听 session 创建和完成事件，更新历史记录
  useEffect(() => {
    const historyId = currentHistoryIdRef.current;
    if (!historyId) return;

    // 查找最新的 session_created 和 complete 事件
    const sessionEvent = streamEvents.find((e) => e.type === 'session_created');
    const completeEvent = streamEvents.find((e) => e.type === 'complete');

    if (sessionEvent) {
      const sessionData = sessionEvent.data as {
        session: { id: string; title: string };
      };
      updateHistory(historyId, {
        sessionId: sessionData.session.id,
      });
    }

    if (completeEvent) {
      const completeData = completeEvent.data as {
        sessionId: string;
        checkpointId: string;
      };
      updateHistory(historyId, {
        status: 'success',
        sessionId: completeData.sessionId,
        checkpointId: completeData.checkpointId,
      });
      currentHistoryIdRef.current = null;
    }
  }, [streamEvents, updateHistory]);

  // 恢复历史记录（localStorage）
  const handleRestoreHistory = useCallback(
    async (item: SlidesHistoryItem) => {
      setRestoring(true);
      const { addStreamEvent } = useSlidesStore.getState();

      try {
        // 优先使用 checkpointId，如果没有则使用 sessionId
        if (item.checkpointId) {
          await restoreCheckpoint(item.checkpointId);
        } else if (item.sessionId) {
          await restoreBySessionId(item.sessionId);
        } else {
          // 没有 checkpointId 或 sessionId，显示错误
          addStreamEvent({
            type: 'system_message',
            timestamp: new Date(),
            data: {
              message: '此历史记录没有可恢复的会话信息',
              source: '系统',
            },
          });
          return;
        }

        // 恢复成功，添加成功消息
        addStreamEvent({
          type: 'system_message',
          timestamp: new Date(),
          data: {
            message: `已恢复: ${item.title || '演示文稿'}`,
            source: '系统',
          },
        });

        setShowHistory(false);
      } catch (err) {
        logger.error('[SlidesTab] Failed to restore:', err);
        const errorMessage = err instanceof Error ? err.message : '恢复失败';

        // 显示用户友好的错误消息
        addStreamEvent({
          type: 'system_message',
          timestamp: new Date(),
          data: {
            message: `恢复失败: ${errorMessage}。会话可能已被清理，请尝试重新生成。`,
            source: '系统',
          },
        });
      } finally {
        setRestoring(false);
      }
    },
    [restoreCheckpoint, restoreBySessionId]
  );

  // 恢复后端会话
  const handleRestoreSession = useCallback(
    async (sessionItem: SessionWithCheckpoint) => {
      setRestoring(true);
      const { addStreamEvent } = useSlidesStore.getState();

      try {
        if (sessionItem.latestCheckpoint?.id) {
          await restoreCheckpoint(sessionItem.latestCheckpoint.id);
        } else {
          await restoreBySessionId(sessionItem.id);
        }

        // 恢复成功，添加成功消息
        addStreamEvent({
          type: 'system_message',
          timestamp: new Date(),
          data: {
            message: `已恢复: ${sessionItem.title || '演示文稿'}`,
            source: '系统',
          },
        });

        setShowHistory(false);
        setShowNewForm(false);
      } catch (err) {
        logger.error('[SlidesTab] Failed to restore session:', err);
        const errorMessage = err instanceof Error ? err.message : '恢复失败';

        // 使用 streamEvent 显示错误消息，而不是 alert
        addStreamEvent({
          type: 'system_message',
          timestamp: new Date(),
          data: {
            message: `恢复失败: ${errorMessage}`,
            source: '系统',
          },
        });
      } finally {
        setRestoring(false);
      }
    },
    [restoreCheckpoint, restoreBySessionId]
  );

  // 初始状态 - 显示 Sessions 画廊或输入表单
  if (!session && pages.length === 0 && !generating) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-white">
        {/* 头部 */}
        <Header
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory(!showHistory)}
          onCreateCheckpoint={handleCreateCheckpoint}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onNewClick={() => setShowNewForm(true)}
          showViewToggle={true}
          onSmartTags={handleSmartTags}
        />

        {/* 历史记录面板 */}
        <HistoryPanel
          show={showHistory}
          history={history}
          onRemove={removeHistory}
          onClear={clearHistory}
          onRestore={handleRestoreHistory}
        />

        {/* 画廊始终渲染 */}
        <SessionsGallery
          backendSessions={backendSessions}
          localHistory={history}
          viewMode={viewMode}
          onRestoreSession={handleRestoreSession}
          onRestoreHistory={handleRestoreHistory}
          onNewClick={() => setShowNewForm(true)}
          loading={sessionsLoading}
          restoring={restoring}
          onUpdateSession={updateSession}
          onDeleteSession={deleteSession}
        />

        {/* Modal 浮层覆盖在画廊上 */}
        {showNewForm && (
          <CreateSlidesModal
            themes={themes}
            onClose={() => setShowNewForm(false)}
            onGenerate={(req) => {
              handleGenerate(req);
              setShowNewForm(false);
            }}
          />
        )}
      </div>
    );
  }

  // 生成中或已有内容 - 显示 V5.0 新布局 (PRD Section 12)
  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* 顶部标题栏 - 简化版 */}
      <header className="flex-shrink-0 border-b border-slate-200 bg-white">
        <div className="flex h-12 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToGallery}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              title="返回"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-orange-600">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-medium text-slate-800">
              {session?.title || t('office.slides.title')}
            </span>
          </div>

          {/* 中部：生成状态 */}
          <div className="flex items-center gap-2">
            {generating && (
              <div className="flex items-center gap-2 text-sm text-orange-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  正在生成 {completedPages.length}/{progress?.totalPages || '?'}{' '}
                  页
                </span>
              </div>
            )}
            {!generating && pages.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>
                  共 {pages.length} 页 ·{' '}
                  {formatRelativeTime(
                    new Date(session?.updatedAt || Date.now())
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {pages.length > 0 && (
              <button
                onClick={() => setShowPresentation(true)}
                className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"
              >
                <Play className="h-4 w-4" />
                {t('office.slides.presentation')}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* V5.0 新布局 - 左右分栏 */}
      <SlidesWorkspace
        className="flex-1"
        onGoBack={handleBackToGallery}
        onRegenerate={handleRegenerate}
      />

      {/* 演示模式 */}
      {showPresentation && (
        <PresentationMode
          pages={pages}
          onClose={() => setShowPresentation(false)}
        />
      )}
    </div>
  );
}

// ============================================================================
// PresentationMode 组件 - 全屏演示
// ============================================================================

function CreateSlidesModal({
  onGenerate,
  onClose,
  themes,
}: {
  onGenerate: (request: GenerateRequest) => void;
  onClose: () => void;
  themes: SlideThemePreview[];
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [targetPages, setTargetPages] = useState(10);
  const [themeId, setThemeId] = useState('genspark-dark');
  const [showImportModal, setShowImportModal] = useState(false);
  const { generating } = useSlidesStore();

  // Handle import from platform sources
  const handleImportData = useCallback(
    (data: SlidesSourceData) => {
      if (data.metadata?.title && !title) {
        setTitle(data.metadata.title);
      }
      // Append imported content to source text
      setSourceText((prev) => {
        const imported = data.sourceText || '';
        return prev ? `${prev}\n\n---\n\n${imported}` : imported;
      });
      setShowImportModal(false);
    },
    [title]
  );

  const handleSubmit = useCallback(() => {
    if (!title.trim() || !sourceText.trim()) return;
    onGenerate({
      title: title.trim(),
      sourceText: sourceText.trim(),
      targetPages,
      stylePreference: 'dark',
      themeId,
    });
  }, [title, sourceText, targetPages, themeId, onGenerate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        {/* Modal 内容区 */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              {t('office.slides.createNewPresentation')}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('office.slides.presentationTitle')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('office.slides.titlePlaceholder')}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">
                  {t('office.slides.materialContent')}
                </label>
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                >
                  <FolderOpen className="h-4 w-4" />
                  {t('office.slides.importFromPlatform')}
                </button>
              </div>
              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder={t('office.slides.contentPlaceholderLong')}
                rows={8}
                className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('office.slides.targetPages', { count: targetPages })}
              </label>
              <input
                type="range"
                min={5}
                max={30}
                value={targetPages}
                onChange={(e) => setTargetPages(parseInt(e.target.value))}
                className="w-full accent-orange-500"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-500">
                <span>{t('office.slides.pageCountWithN', { count: 5 })}</span>
                <span>{t('office.slides.pageCountWithN', { count: 30 })}</span>
              </div>
            </div>

            {/* 主题选择 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t('office.slides.themeStyle')}
              </label>
              <ThemeSelector
                value={themeId}
                onChange={setThemeId}
                themes={themes}
                className="rounded-lg border border-gray-200 bg-gray-50 p-3"
              />
            </div>
          </div>
        </div>

        {/* 固定底部按钮区 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-3 border-t border-gray-200 bg-white px-8 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            {t('office.slides.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={generating || !title.trim() || !sourceText.trim()}
            className={cn(
              'flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-medium transition-colors',
              generating || !title.trim() || !sourceText.trim()
                ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                : 'bg-orange-500 text-white hover:bg-orange-600'
            )}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('office.slides.generating')}
              </>
            ) : (
              <>
                <Layers className="h-4 w-4" />
                {t('office.slides.beginGeneration')}
              </>
            )}
          </button>
        </div>

        {/* V5.0: Source Import Modal */}
        <SourceImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImport={handleImportData}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Sessions 画廊组件
// ============================================================================

function getPhaseTitle(phase: string): string {
  const titles: Record<string, string> = {
    task_decomposition: '🧠 深度思考 - 任务分解',
    outline_planning: '📄 大纲规划',
    page_rendering: '🎨 页面渲染',
    quality_review: '✅ 质量检查',
  };
  return titles[phase] || phase;
}

function getStatusText(status: string): string {
  const texts: Record<string, string> = {
    pending: '等待中',
    generating: '生成中',
    completed: '已完成',
    error: '失败',
  };
  return texts[status] || status;
}

/**
 * 格式化 HTML 代码，添加缩进以提高可读性
 */
function formatHtmlCode(html: string): string {
  try {
    let formatted = '';
    let indent = 0;
    const lines = html.split(/>\s*</);

    lines.forEach((line, i) => {
      // 检测是否为自闭合标签或闭合标签
      const isClosingTag = line.match(/^\/\w/);
      const isSelfClosing = line.match(/\/$/);
      const isOpeningTag =
        line.match(/^<?\w/) && !isClosingTag && !isSelfClosing;

      if (isClosingTag) {
        indent = Math.max(0, indent - 1);
      }

      const prefix = i === 0 ? '' : '<';
      const suffix = i === lines.length - 1 ? '' : '>';
      formatted += '  '.repeat(indent) + prefix + line + suffix + '\n';

      if (isOpeningTag && !isSelfClosing) {
        indent++;
      }
    });

    return formatted.trim();
  } catch {
    return html; // 如果格式化失败，返回原始代码
  }
}

export default SlidesTab;
