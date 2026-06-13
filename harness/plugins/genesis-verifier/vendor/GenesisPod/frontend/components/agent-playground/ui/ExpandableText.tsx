'use client';

/**
 * ExpandableText —— 长文本默认截断，点击"展开全文"显示全部。
 * 同时把 markdown link [label](url) + 裸 URL 转成可点击 <a>。
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils/common';

interface ExpandableTextProps {
  text: string;
  /** 默认折叠后显示的字符数 */
  maxChars?: number;
  className?: string;
}

function linkifyBare(text: string, baseKey: number): React.ReactNode {
  const urlRe = /(https?:\/\/[^\s)）]+)/g;
  const parts = text.split(urlRe);
  return (
    <React.Fragment key={`bare-${baseKey}`}>
      {parts.map((p, i) => {
        if (urlRe.test(p)) {
          urlRe.lastIndex = 0;
          return (
            <a
              key={i}
              href={p}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-violet-700 underline-offset-2 hover:underline"
            >
              {p.length > 60 ? p.slice(0, 60) + '…' : p}
            </a>
          );
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </React.Fragment>
  );
}

export function linkifyText(text: string): React.ReactNode[] {
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = mdLink.exec(text)) !== null) {
    if (m.index > lastIdx) {
      nodes.push(linkifyBare(text.slice(lastIdx, m.index), key++));
    }
    nodes.push(
      <a
        key={`md-${key++}`}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-violet-700 underline-offset-2 hover:underline"
      >
        {m[1]}
      </a>
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    nodes.push(linkifyBare(text.slice(lastIdx), key++));
  }
  return nodes;
}

export function ExpandableText({
  text,
  maxChars = 240,
  className,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= maxChars) {
    return <span className={className}>{linkifyText(text)}</span>;
  }
  return (
    <span className={cn(className)}>
      {expanded ? linkifyText(text) : linkifyText(text.slice(0, maxChars))}
      {!expanded && '…'}{' '}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        className="text-violet-600 hover:text-violet-800 hover:underline"
      >
        {expanded ? '收起' : '展开全文'}
      </button>
    </span>
  );
}
