'use client';

/**
 * useWritingTimeline — W4.6 派生层
 *
 * 从 writing.* 事件流派生两路数据：
 *   1. consistencyIssues — 所有 writing.consistency:issues_found 事件的聚合
 *   2. taskMessages      — 按事件类型映射为可渲染的时间线消息
 *
 * 设计约束：
 *   - 仅处理展示/派生层，不改变任何业务逻辑或数据流
 *   - processedEventCountRef 追踪已处理事件数，确保每次只追加新尾部事件
 *   - resetProcessedCount() 供调用方在 projectId 变更时重置游标
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MissionEvent } from './useMissionStream';

export type TimelineMessage = {
  id: string;
  type: 'user' | 'system' | 'agent' | 'progress';
  content: string;
  agent?: string;
  timestamp: Date;
  detail?: {
    type: 'chapter_content' | 'issues' | 'world_settings' | 'text';
    data:
      | string
      | Array<{
          type: string;
          severity: string;
          description: string;
          suggestion?: string;
        }>
      | Record<string, unknown>;
  };
};

export type ConsistencyIssueRecord = {
  chapterNumber: number;
  passed: boolean;
  issues: Array<{
    type: string;
    severity: string;
    description: string;
    suggestion?: string;
  }>;
  timestamp: string;
};

export function useWritingTimeline(writingEvents: MissionEvent[]) {
  const [taskMessages, setTaskMessages] = useState<TimelineMessage[]>([]);
  const taskMessagesEndRef = useRef<HTMLDivElement>(null);
  const processedEventCountRef = useRef(0);

  // [W4.6] Derive consistencyIssues from writing.* event stream.
  // New schema has no `passed` field; derive passed = issues.length === 0.
  // (writing.consistency:issues_found only fires when issues exist, so passed will always be false
  //  in practice — the "✓ 通过" green state is absent until backend emits a check_passed event.)
  const consistencyIssues = useMemo<ConsistencyIssueRecord[]>(() => {
    return writingEvents
      .filter((ev) => ev.type === 'writing.consistency:issues_found')
      .map((ev) => {
        const p = ev.payload as {
          chapterNumber: number;
          issues: Array<{
            type: string;
            severity: string;
            description: string;
            suggestion?: string;
          }>;
        };
        return {
          chapterNumber: p.chapterNumber ?? 0,
          passed: (p.issues?.length ?? 0) === 0,
          issues: p.issues ?? [],
          timestamp: new Date(ev.timestamp).toISOString(),
        };
      });
  }, [writingEvents]);

  // [W4.6] Map writing.* events to taskMessages increments.
  // Uses a ref to track how many events have already been processed,
  // appending only new tail events on each render to avoid re-processing.
  useEffect(() => {
    const start = processedEventCountRef.current;
    const newEvents = writingEvents.slice(start);
    if (newEvents.length === 0) return;
    processedEventCountRef.current = writingEvents.length;

    const messages: TimelineMessage[] = [];

    for (const ev of newEvents) {
      const p = ev.payload as Record<string, unknown>;
      const ts = new Date(ev.timestamp);
      let msg: TimelineMessage | null = null;

      switch (ev.type) {
        case 'writing.mission:started':
          msg = {
            id: `msg-ws-${ev.timestamp}`,
            type: 'system',
            content: '任务开始执行，AI 团队正在协作...',
            timestamp: ts,
          };
          break;

        case 'writing.agent:lifecycle': {
          const role = typeof p.role === 'string' ? p.role : '';
          const phase = typeof p.phase === 'string' ? p.phase : '';
          const phaseText =
            phase === 'started'
              ? '开始工作'
              : phase === 'completed'
                ? '完成工作'
                : phase === 'failed'
                  ? '工作失败'
                  : phase;
          if (role && phase) {
            msg = {
              id: `msg-ws-${ev.timestamp}-${role}`,
              type: 'agent',
              content: phaseText,
              agent: role,
              timestamp: ts,
            };
          }
          break;
        }

        case 'writing.chapter:started': {
          const chNum =
            typeof p.chapterNumber === 'number' ? p.chapterNumber : 0;
          const title = typeof p.title === 'string' ? p.title : '';
          msg = {
            id: `msg-ws-${ev.timestamp}-ch${chNum}-start`,
            type: 'agent',
            content: `开始创作第 ${chNum} 章：${title}`,
            agent: '作家',
            timestamp: ts,
          };
          break;
        }

        case 'writing.chapter:content': {
          const chNum =
            typeof p.chapterNumber === 'number' ? p.chapterNumber : 0;
          const title = typeof p.title === 'string' ? p.title : '';
          const content = typeof p.content === 'string' ? p.content : '';
          const wordCount = typeof p.wordCount === 'number' ? p.wordCount : 0;
          const preview = content.slice(0, 300);
          msg = {
            id: `msg-ws-${ev.timestamp}-ch${chNum}-content`,
            type: 'agent',
            content: `第 ${chNum} 章「${title}」内容生成中 (${wordCount} 字)`,
            agent: '作家',
            timestamp: ts,
            detail: {
              type: 'chapter_content',
              data: preview + (content.length > 300 ? '...' : ''),
            },
          };
          break;
        }

        case 'writing.chapter:completed': {
          const chNum =
            typeof p.chapterNumber === 'number' ? p.chapterNumber : 0;
          const wordCount = typeof p.wordCount === 'number' ? p.wordCount : 0;
          msg = {
            id: `msg-ws-${ev.timestamp}-ch${chNum}-done`,
            type: 'agent',
            content: `第 ${chNum} 章创作完成${wordCount ? ` (${wordCount} 字)` : ''}`,
            agent: '作家',
            timestamp: ts,
          };
          break;
        }

        case 'writing.consistency:check_started': {
          const chNum =
            typeof p.chapterNumber === 'number' ? p.chapterNumber : undefined;
          msg = {
            id: `msg-ws-${ev.timestamp}-consistency-start`,
            type: 'agent',
            content:
              chNum !== undefined
                ? `开始检查第 ${chNum} 章的一致性...`
                : '开始进行一致性检查...',
            agent: '检查员',
            timestamp: ts,
          };
          break;
        }

        case 'writing.consistency:issues_found': {
          const chNum =
            typeof p.chapterNumber === 'number' ? p.chapterNumber : 0;
          const issues = Array.isArray(p.issues)
            ? (p.issues as Array<{
                type: string;
                severity: string;
                description: string;
                suggestion?: string;
              }>)
            : [];
          msg = {
            id: `msg-ws-${ev.timestamp}-consistency-issues`,
            type: 'agent',
            content: `第 ${chNum} 章发现 ${issues.length} 个问题，点击展开查看详情`,
            agent: '一致性检查员',
            timestamp: ts,
            detail: {
              type: 'issues',
              data: issues,
            },
          };
          break;
        }

        case 'writing.consistency:fix_completed': {
          const chNum =
            typeof p.chapterNumber === 'number' ? p.chapterNumber : 0;
          const fixedIssues =
            typeof p.fixedIssues === 'number' ? p.fixedIssues : 0;
          msg = {
            id: `msg-ws-${ev.timestamp}-consistency-fix`,
            type: 'agent',
            content: `第 ${chNum} 章修复完成，已解决 ${fixedIssues} 个问题`,
            agent: '编辑',
            timestamp: ts,
          };
          break;
        }

        case 'writing.world:building_started':
          msg = {
            id: `msg-ws-${ev.timestamp}-world-start`,
            type: 'agent',
            content: '开始构建世界观设定...',
            agent: '守护者',
            timestamp: ts,
          };
          break;

        case 'writing.world:building_completed': {
          const settings =
            p.settings instanceof Object && !Array.isArray(p.settings)
              ? (p.settings as Record<string, unknown>)
              : undefined;
          msg = {
            id: `msg-ws-${ev.timestamp}-world-done`,
            type: 'agent',
            content: '世界观设定构建完成，点击展开查看',
            agent: '守护者',
            timestamp: ts,
            detail: settings
              ? { type: 'world_settings', data: settings }
              : undefined,
          };
          break;
        }

        case 'writing.keeper:context_ready': {
          const chNum =
            typeof p.chapterNumber === 'number' ? p.chapterNumber : 0;
          const ctx =
            p.context instanceof Object && !Array.isArray(p.context)
              ? (p.context as {
                  relevantCharacters?: string[];
                  relevantLocations?: string[];
                  previousEvents?: string[];
                  warnings?: string[];
                })
              : undefined;
          const contextSummary = ctx
            ? `角色: ${ctx.relevantCharacters?.length || 0}, 场景: ${ctx.relevantLocations?.length || 0}, 事件: ${ctx.previousEvents?.length || 0}${ctx.warnings?.length ? `, ${ctx.warnings.length} 条提醒` : ''}`
            : '';
          msg = {
            id: `msg-ws-${ev.timestamp}-keeper-ctx`,
            type: 'agent',
            content: `第 ${chNum} 章上下文准备完成 (${contextSummary})`,
            agent: '守护者',
            timestamp: ts,
            detail: ctx
              ? {
                  type: 'text',
                  data: [
                    ctx.relevantCharacters?.length
                      ? `相关角色: ${ctx.relevantCharacters.join(', ')}`
                      : '',
                    ctx.relevantLocations?.length
                      ? `相关场景: ${ctx.relevantLocations.join(', ')}`
                      : '',
                    ctx.previousEvents?.length
                      ? `前文事件: ${ctx.previousEvents.slice(0, 3).join('; ')}${ctx.previousEvents.length > 3 ? '...' : ''}`
                      : '',
                    ctx.warnings?.length
                      ? `注意事项: ${ctx.warnings.join('; ')}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join('\n'),
                }
              : undefined,
          };
          break;
        }

        case 'writing.mission:completed':
          msg = {
            id: `msg-ws-${ev.timestamp}-mission-done`,
            type: 'system',
            content: '任务完成！',
            timestamp: ts,
          };
          break;

        case 'writing.mission:failed': {
          const errMsg = typeof p.message === 'string' ? p.message : '未知错误';
          msg = {
            id: `msg-ws-${ev.timestamp}-mission-fail`,
            type: 'system',
            content: `任务失败：${errMsg}`,
            timestamp: ts,
          };
          break;
        }

        default:
          break;
      }

      if (msg) {
        messages.push(msg);
      }
    }

    if (messages.length > 0) {
      setTaskMessages((prev) => [...prev, ...messages]);
      // Auto scroll to bottom
      setTimeout(() => {
        taskMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingEvents]);

  const resetProcessedCount = useCallback(() => {
    processedEventCountRef.current = 0;
  }, []);

  return {
    consistencyIssues,
    taskMessages,
    setTaskMessages,
    taskMessagesEndRef,
    resetProcessedCount,
  };
}
