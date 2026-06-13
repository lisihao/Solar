'use client';

/**
 * AdminDataTable — admin 薄壳，复用通用 `common/tables/DataTable`（标准 22 §2.4 第①层）。
 * 历史上 admin 各表各写 `<table>`；统一后 admin 数据网格请用本壳或直接 DataTable。
 */
export {
  DataTable as default,
  type ColumnDef,
  type DataTableProps,
} from '@/components/common/tables/DataTable';
