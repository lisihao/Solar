'use client';

/**
 * MissionTaskList — mission 详情「任务列表」内容无关 canonical（标准 21 / 下沉自 playground）。
 *
 * 平台定风格（bordered Card + table-fixed + 灰头 + 分隔行 + 状态左侧色条 + 选中态 + 行点击），
 * 业务定内容（列定义 + 数据 + 行状态色条 getRowClassName + 行点击→Drawer）。
 * 表 chrome 与 agent-playground MissionTodoBoard 同款；research 子状态/origin badge 等由
 * column.render 注入。
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/common';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states';

export interface MissionTaskColumn<T> {
  key: string;
  /** 表头文案 */
  label: ReactNode;
  /** 列宽 + 对齐 class（如 'w-12 text-center' / 'w-[36%]'），同时作用于表头与单元格 */
  className?: string;
  /** 单元格渲染（业务注入：标题/角色/状态徽标/操作等） */
  render: (item: T, index: number) => ReactNode;
}

export interface MissionTaskListProps<T> {
  items: T[];
  columns: MissionTaskColumn<T>[];
  /** 取每行唯一 key（默认取 item.id） */
  getRowKey?: (item: T) => string;
  /** 当前选中行 key（高亮 ring） */
  selectedKey?: string | null;
  /** 行点击（通常 → 打开 Drawer 明细）；不传则行不可点 */
  onRowClick?: (item: T) => void;
  /** 行状态色条 / 底色（业务按状态返回，如 'border-l-4 border-l-emerald-400'） */
  getRowClassName?: (item: T, selected: boolean) => string | undefined;
  /** 空态 */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  className?: string;
}

export function MissionTaskList<T>({
  items,
  columns,
  getRowKey,
  selectedKey,
  onRowClick,
  getRowClassName,
  emptyTitle = '暂无任务',
  emptyDescription,
  emptyIcon,
  className,
}: MissionTaskListProps<T>) {
  const keyOf = (item: T, i: number): string =>
    getRowKey?.(item) ?? (item as { id?: string }).id ?? String(i);

  if (items.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          icon={emptyIcon}
        />
      </div>
    );
  }

  return (
    <div className={cn('p-4', className)}>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <Table className="w-full table-fixed">
          <THead className="border-b border-gray-200 bg-gray-50/80">
            <Tr>
              {columns.map((col) => (
                <Th
                  key={col.key}
                  className={cn(
                    'px-3 py-2.5 text-left text-xs font-semibold text-gray-600',
                    col.className
                  )}
                >
                  {col.label}
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody className="divide-y divide-gray-100 bg-white">
            {items.map((item, i) => {
              const rowKey = keyOf(item, i);
              const selected = selectedKey != null && rowKey === selectedKey;
              return (
                <Tr
                  key={rowKey}
                  onClick={onRowClick ? () => onRowClick(item) : undefined}
                  className={cn(
                    'transition-all',
                    onRowClick && 'cursor-pointer hover:bg-violet-50/30',
                    getRowClassName?.(item, selected),
                    selected && 'ring-2 ring-violet-400'
                  )}
                >
                  {columns.map((col) => (
                    <Td
                      key={col.key}
                      className={cn('px-3 py-2 text-sm', col.className)}
                    >
                      {col.render(item, i)}
                    </Td>
                  ))}
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
