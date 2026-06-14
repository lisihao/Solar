export {
  default as TableManagementPage,
  TableManagementContent,
} from './TableManagementPage';
export { default as TableStatsCards } from './TableStatsCards';
export { default as TableToolbar } from './TableToolbar';
export { default as TableDataGrid } from './TableDataGrid';
export { default as TableDetailModal } from './TableDetailModal';
export { default as TableDiagnosisPanel } from './TableDiagnosisPanel';
export { default as StorageInventoryPanel } from './StorageInventoryPanel';
export { default as StorageStatsCards } from './StorageStatsCards';
export { default as StorageToolbar } from './StorageToolbar';
export { default as StoragePipelineGrid } from './StoragePipelineGrid';
export { default as StorageR2DetailDrawer } from './StorageR2DetailDrawer';
// Legacy 子视图（StorageCatalogGrid / StorageDatabaseGrid / StorageTrendPanel）
// 在 2026-05-11 重构后从 StorageInventoryPanel 移除；文件保留作为兜底，
// 如需独立小工具页可再次引用。
export { default as StorageCatalogGrid } from './StorageCatalogGrid';
export { default as StorageDatabaseGrid } from './StorageDatabaseGrid';
export { default as StorageTrendPanel } from './StorageTrendPanel';
export { default as BrokenResourcesCard } from './BrokenResourcesCard';
