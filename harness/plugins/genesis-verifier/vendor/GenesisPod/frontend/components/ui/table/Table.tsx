'use client';

import { cn } from '@/lib/utils/common';

/**
 * ui/table — 纯展示表格样式原语（标准 22 §2.4 第②层）。
 * 给静态/不交互的表用（markdown 表、对比、用量、可信度等）。
 * 交互型数据网格（排序/分页/搜索）请用 common/tables/DataTable，勿用本组件。
 *
 * 设计取向：**薄壳 + 可覆盖**。只统一「overflow/border 容器」这层重复样板 +
 * 提供组件词汇 + R8 合规出口；各单元格的 padding/配色/字号由调用方 className 决定
 * （展示表各有语义主题：紧凑事实表 / 暗色 / 风险红等，强行统一会破坏语境）。
 */

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** 是否包一层带边框圆角的容器（默认 false，贴合多数内嵌展示表；列表型可设 true）。 */
  bordered?: boolean;
  containerClassName?: string;
}

export function Table({
  bordered = false,
  className,
  containerClassName,
  children,
  ...props
}: TableProps) {
  const table = (
    <table className={cn('w-full', className)} {...props}>
      {children}
    </table>
  );

  if (bordered) {
    return (
      <div
        className={cn(
          'overflow-hidden rounded-lg border border-gray-200',
          containerClassName
        )}
      >
        <div className="overflow-x-auto">{table}</div>
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto', containerClassName)}>{table}</div>
  );
}

export function THead({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn(className)} {...props}>
      {children}
    </thead>
  );
}

export function TBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn(className)} {...props}>
      {children}
    </tbody>
  );
}

interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** 行 hover 高亮（列表/可点击行用） */
  hoverable?: boolean;
}

export function Tr({ hoverable, className, children, ...props }: TrProps) {
  return (
    <tr
      className={cn(
        hoverable && 'transition-colors hover:bg-gray-50',
        className
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export function Th({
  className,
  children,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn('text-left font-medium', className)} {...props}>
      {children}
    </th>
  );
}

export function Td({
  className,
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn(className)} {...props}>
      {children}
    </td>
  );
}
