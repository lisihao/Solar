'use client';

import { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { Input } from '@/components/ui/form';

/**
 * DataTable — 通用交互数据网格（标准 22 §2.4 第①层）。
 * 含搜索 / 排序 / 分页 / 空态 / 加载骨架 / 行点击。主题中性（focus 走 canonical Input）。
 * admin 经 `admin/shared/AdminDataTable` 薄壳复用本组件。
 * 纯展示表请用 ui/table 原语，勿用本组件（过度抽象）。
 */

// Column definition
export interface ColumnDef<T> {
  id: string;
  header: string | React.ReactNode;
  accessorKey?: keyof T;
  accessorFn?: (row: T) => unknown;
  cell?: (props: { row: T; value: unknown }) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
}

interface EmptyStateConfig {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: (keyof T)[];
  pagination?: {
    pageSize?: number;
    pageSizeOptions?: number[];
  };
  emptyState?: EmptyStateConfig;
  onRowClick?: (row: T) => void;
  getRowId?: (row: T) => string;
  className?: string;
}

type SortDirection = 'asc' | 'desc' | null;

export function DataTable<T>({
  data,
  columns,
  loading = false,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchKeys,
  pagination,
  emptyState,
  onRowClick,
  getRowId,
  className,
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(pagination?.pageSize ?? 10);

  const filteredData = useMemo(() => {
    if (!searchQuery || !searchable) return data;

    const query = searchQuery.toLowerCase();
    return data.filter((row) => {
      const keysToSearch =
        searchKeys ?? (Object.keys(row as object) as (keyof T)[]);
      return keysToSearch.some((key) => {
        const value = row[key];
        if (value == null) return false;
        return String(value).toLowerCase().includes(query);
      });
    });
  }, [data, searchQuery, searchable, searchKeys]);

  const sortedData = useMemo(() => {
    if (!sortColumn || !sortDirection) return filteredData;

    const column = columns.find((col) => col.id === sortColumn);
    if (!column) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aValue = column.accessorFn
        ? column.accessorFn(a)
        : column.accessorKey
          ? a[column.accessorKey]
          : null;
      const bValue = column.accessorFn
        ? column.accessorFn(b)
        : column.accessorKey
          ? b[column.accessorKey]
          : null;

      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return sortDirection === 'asc' ? 1 : -1;
      if (bValue == null) return sortDirection === 'asc' ? -1 : 1;

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortColumn, sortDirection, columns]);

  const paginatedData = useMemo(() => {
    if (!pagination) return sortedData;
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize, pagination]);

  const totalPages = pagination ? Math.ceil(sortedData.length / pageSize) : 1;

  const handleSort = (columnId: string) => {
    if (sortColumn === columnId) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnId);
      setSortDirection('asc');
    }
  };

  const getCellValue = (row: T, column: ColumnDef<T>) => {
    if (column.accessorFn) return column.accessorFn(row);
    if (column.accessorKey) return row[column.accessorKey];
    return null;
  };

  const EmptyIcon = emptyState?.icon;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Search */}
      {searchable && (
        <Input
          type="text"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentPage(1);
          }}
        />
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    className={cn(
                      'px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500',
                      column.sortable &&
                        'cursor-pointer select-none hover:bg-gray-100',
                      column.headerClassName
                    )}
                    onClick={
                      column.sortable ? () => handleSort(column.id) : undefined
                    }
                  >
                    <div className="flex items-center gap-1">
                      {column.header}
                      {column.sortable && (
                        <span className="text-gray-400">
                          {sortColumn === column.id ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {loading ? (
                Array.from({ length: pageSize }).map((_, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column.id} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-gray-200" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12">
                    <div className="flex flex-col items-center justify-center text-center">
                      {EmptyIcon && (
                        <EmptyIcon className="mb-3 h-12 w-12 text-gray-300" />
                      )}
                      <h3 className="text-sm font-medium text-gray-900">
                        {emptyState?.title ?? 'No data'}
                      </h3>
                      {emptyState?.description && (
                        <p className="mt-1 text-sm text-gray-500">
                          {emptyState.description}
                        </p>
                      )}
                      {emptyState?.action && (
                        <div className="mt-4">{emptyState.action}</div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedData.map((row, index) => {
                  const rowId = getRowId ? getRowId(row) : index;
                  return (
                    <tr
                      key={rowId}
                      className={cn(
                        'transition-colors hover:bg-gray-50',
                        onRowClick && 'cursor-pointer'
                      )}
                      onClick={() => onRowClick?.(row)}
                    >
                      {columns.map((column) => {
                        const value = getCellValue(row, column);
                        return (
                          <td
                            key={column.id}
                            className={cn(
                              'whitespace-nowrap px-4 py-3 text-sm text-gray-900',
                              column.className
                            )}
                          >
                            {column.cell
                              ? column.cell({ row, value })
                              : (value as React.ReactNode)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>
              Showing {(currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, sortedData.length)} of{' '}
              {sortedData.length}
            </span>
            {pagination.pageSizeOptions && (
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="rounded border border-gray-200 px-2 py-1 text-sm"
              >
                {pagination.pageSizeOptions.map((size) => (
                  <option key={size} value={size}>
                    {size} per page
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-sm text-gray-700">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
