'use client';

/**
 * useReportRevisions - 通用报告版本历史 Hook
 *
 * 抽自 Topic Insights `TopicContentPanel.allRevisions`（L629-693）的版本合并逻辑。
 *
 * 解决问题：
 * - 把"当前版本（report）"+ "历史版本数组（revisions）"合并成统一时间线
 * - 排除重复（按 ID 去重）
 * - 计算字数差（wordCountDelta）
 * - 按 version 降序排列（最新在前）
 *
 * 适用场景：
 * - AI Writing 段落级回滚
 * - AI Research 多轮迭代版本对比
 * - 任何「当前 + 历史」二元模型的版本系统
 *
 * 不在 Hook 层做的：
 * - 调 API 拉历史（业务侧自行 fetch，把数据传进来）
 * - rollback 触发（业务侧 callback）
 * - diff 计算（diff UI 是另一组件的职责）
 */

import { useMemo } from 'react';

/** 当前最新报告输入 */
export interface CurrentReportInput {
  id: string;
  version: number;
  /** 报告字数（一般用 fullReport.length 或精确字数） */
  wordCount?: number;
  /** 来源数（用于描述行展示） */
  totalSources?: number;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

/** 历史版本输入 */
export interface RevisionInput {
  id: string;
  version: number;
  summary?: string;
  author?: string;
  wordCount?: number;
  totalSources?: number;
  createdAt: string | Date;
}

/** 合并后的版本条目 */
export interface ReportRevisionEntry {
  id: string;
  version: number;
  /** 显示标题，默认 "v{version}" */
  title: string;
  /** 摘要 */
  summary: string;
  /** 变更类型 */
  changeType: 'create' | 'edit' | 'ai_edit' | 'rollback';
  /** 描述（如 "X sources · Y chars"） */
  changeDescription: string;
  /** 作者 */
  author: string;
  /** 创建时间（ISO 字符串，确保 SSR 一致） */
  createdAt: string;
  /** 字数 */
  wordCount: number;
  /** 与上一版本的字数差（正负数） */
  wordCountDelta: number;
}

export interface UseReportRevisionsOptions {
  /** 当前最新报告（可选，没有则只用 revisions） */
  current?: CurrentReportInput | null;
  /** 历史版本数组 */
  revisions: RevisionInput[];
  /**
   * 描述行格式化器，默认 "X sources · Y chars" 英文格式。
   * 调用方可替换为 i18n 版本。
   */
  formatDescription?: (entry: { sources: number; chars: number }) => string;
  /**
   * 是否计算与上一版本的 wordCountDelta。
   * 默认 false（保持与原 TI TopicContentPanel.allRevisions 行为一致：所有条目 delta=0）。
   * 设为 true 时按 version 降序计算实际差值，新模块按需开启。
   */
  computeDelta?: boolean;
}

// 默认格式与 TI 原 TopicContentPanel.allRevisions 完全一致，
// 包括 sources=0 时也输出 "0 sources · X chars"，确保幂等替换零回归。
const DEFAULT_FORMAT = ({
  sources,
  chars,
}: {
  sources: number;
  chars: number;
}) => `${sources} sources · ${chars} chars`;

function toIsoString(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.toISOString();
}

export function useReportRevisions({
  current,
  revisions,
  formatDescription = DEFAULT_FORMAT,
  computeDelta = false,
}: UseReportRevisionsOptions): ReportRevisionEntry[] {
  return useMemo(() => {
    const result: ReportRevisionEntry[] = [];
    const existingIds = new Set(revisions.map((r) => r.id));

    // 当前版本：仅当 ID 未在 revisions 中时插入
    if (current && !existingIds.has(current.id)) {
      const sources = current.totalSources ?? 0;
      const chars = current.wordCount ?? 0;
      result.push({
        id: current.id,
        version: current.version,
        title: `v${current.version}`,
        summary: '',
        changeType: 'edit',
        changeDescription: formatDescription({ sources, chars }),
        author: '',
        createdAt: toIsoString(current.updatedAt ?? current.createdAt),
        wordCount: chars,
        wordCountDelta: 0,
      });
    }

    // 历史版本
    revisions.forEach((rev, idx) => {
      const sources = rev.totalSources ?? 0;
      const chars = rev.wordCount ?? 0;
      result.push({
        id: rev.id,
        version: rev.version,
        title: `v${rev.version}`,
        summary: rev.summary || '',
        // 最早的版本视为 'create'，其他为 'edit'
        changeType: idx === revisions.length - 1 ? 'create' : 'edit',
        changeDescription:
          sources > 0
            ? formatDescription({ sources, chars })
            : rev.summary || '',
        author: rev.author || '',
        createdAt: toIsoString(rev.createdAt),
        wordCount: chars,
        wordCountDelta: 0,
      });
    });

    // 按 version 降序排序
    result.sort((a, b) => b.version - a.version);

    // 计算 wordCountDelta（默认关闭以保持与 TI 原行为幂等）
    if (computeDelta) {
      for (let i = 0; i < result.length - 1; i++) {
        result[i].wordCountDelta =
          result[i].wordCount - result[i + 1].wordCount;
      }
    }

    return result;
  }, [current, revisions, formatDescription, computeDelta]);
}
