'use client';

import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils/common';
import { Tooltip } from '@/components/ui/feedback/Tooltip';

/**
 * TruncatedCell — 表格单元格「单行截断 + 悬浮看全文」原语（标准 22 表格归一）。
 *
 * 解决全系统数据行表的通病：单元格内容过长把行撑高 / 换行。本组件强制单行,
 * 超出宽度用省略号截断,**仅在真正溢出时**才挂 Tooltip 显示完整内容
 * （短内容不弹提示,避免噪音）。溢出检测走 ResizeObserver,列宽变化自动重判。
 *
 * 用法（必须给宽度约束,否则自动表格列会被内容撑开而不截断）：
 *   <TruncatedCell className="max-w-[220px]">{m.modelId}</TruncatedCell>
 *   <TruncatedCell className="max-w-[180px]" tooltip={fullReason}>{shortLabel}</TruncatedCell>
 *
 * 仅负责「文本截断」这一层；彩色标识请用 ui/badges/StatusBadge、关键词用 ui/tag/Tag。
 */

export interface TruncatedCellProps {
  children: React.ReactNode;
  /**
   * Tooltip 内容。不传则:children 为字符串时用 children 本身;否则不弹（无可展示全文）。
   * children 是复杂节点（带图标等）时,显式传 tooltip 文案。
   */
  tooltip?: React.ReactNode;
  /** 截断容器 className —— **务必含宽度约束**（如 max-w-[200px] / w-full + 父级 table-fixed）。 */
  className?: string;
  /** Tooltip 方向,默认 top */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export function TruncatedCell({
  children,
  tooltip,
  className,
  side = 'top',
}: TruncatedCellProps) {
  const [overflow, setOverflow] = useState(false);
  const roRef = useRef<ResizeObserver | null>(null);

  // ref 回调:节点变化时（含被 Tooltip Slot 包裹后 DOM 重建）重新挂 ResizeObserver,
  // 避免「先测量裸 span、包裹后观察的是旧节点」的失效问题。
  const measureRef = useCallback((el: HTMLSpanElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver !== 'undefined') {
      roRef.current = new ResizeObserver(check);
      roRef.current.observe(el);
    }
  }, []);

  const node = (
    <span ref={measureRef} className={cn('block truncate', className)}>
      {children}
    </span>
  );

  const tip = tooltip ?? (typeof children === 'string' ? children : undefined);

  if (!tip || !overflow) return node;

  return (
    <Tooltip content={tip} side={side}>
      {node}
    </Tooltip>
  );
}

export default TruncatedCell;
