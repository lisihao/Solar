'use client';

/**
 * SourceLink —— 引用来源 / 搜索结果统一卡片。
 *
 * 智能 title 提取：title 缺失时尝试从 snippet/content 抠 <title> 或第一个非空句。
 * URL 弱化为右下角域名 chip，防止"reuters.com 大字 + reuters.com 小字"重复。
 */

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface SourceLinkProps {
  title?: string;
  url?: string;
  snippet?: string;
  /** 引用次数（多次引用同 url 时显示） */
  hits?: number;
  className?: string;
}

function extractFallbackTitle(snippet?: string, url?: string): string {
  if (snippet) {
    // 1. <title> 标签
    const titleTag = snippet.match(/<title>([^<]{4,150})<\/title>/i);
    if (titleTag) return titleTag[1].trim();
    // 2. JS-required 占位 → 跳过
    if (
      snippet.toLowerCase().includes('javascript') &&
      snippet.toLowerCase().includes('enable')
    ) {
      // skip and fallback to url path
    } else {
      // 3. 第一个非空句（截到 60 字）
      const firstSentence = snippet
        .replace(/\s+/g, ' ')
        .trim()
        .split(/[.。!?！？\n]/)[0]
        ?.trim();
      if (
        firstSentence &&
        firstSentence.length >= 6 &&
        firstSentence.length <= 120
      ) {
        return firstSentence;
      }
    }
  }
  // 4. URL 路径最后一段（去 query / hash）
  if (url) {
    try {
      const u = new URL(url);
      const seg = u.pathname.split('/').filter(Boolean).pop() ?? '';
      const decoded = decodeURIComponent(seg).replace(/[-_]+/g, ' ');
      if (decoded.length >= 4 && decoded.length <= 100) {
        return decoded;
      }
      return u.hostname.replace(/^www\./, '');
    } catch {
      return url.slice(0, 80);
    }
  }
  return '(无标题)';
}

function safeHostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function SourceLink({
  title,
  url,
  snippet,
  hits,
  className,
}: SourceLinkProps) {
  const display =
    title && title.trim().length > 2 && title !== safeHostname(url)
      ? title
      : extractFallbackTitle(snippet, url);
  const host = safeHostname(url);
  const safeUrl = url && /^https?:\/\//i.test(url) ? url : undefined;

  const Inner = (
    <>
      <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-gray-900 group-hover:text-violet-700">
        {display}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-400">
        {host && <span className="font-mono truncate">{host}</span>}
        {hits !== undefined && hits > 1 && (
          <span className="rounded-full bg-violet-50 px-1.5 text-violet-600 ring-1 ring-violet-100">
            引用 {hits} 次
          </span>
        )}
        {safeUrl && (
          <ExternalLink className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
    </>
  );
  return safeUrl ? (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group block rounded-md border border-gray-200 bg-white px-3 py-2 transition-all hover:border-violet-300 hover:bg-violet-50/30',
        className
      )}
    >
      {Inner}
    </a>
  ) : (
    <div
      className={cn(
        'block rounded-md border border-gray-200 bg-white px-3 py-2',
        className
      )}
    >
      {Inner}
    </div>
  );
}
