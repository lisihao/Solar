'use client';

import { useState, useCallback } from 'react';
import { Layers } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useTableManagement } from '@/hooks/domain';
import { AdminPageLayout } from '@/components/admin/layout';
import { toast, confirm } from '@/stores';
import TableStatsCards from './TableStatsCards';
import TableToolbar from './TableToolbar';
import TableDataGrid from './TableDataGrid';
import TableDetailModal from './TableDetailModal';
import TableDiagnosisPanel from './TableDiagnosisPanel';
// StorageInventoryPanel & BrokenResourcesCard 已拆到独立页：
//   /admin/storage   → 存储管理
//   /admin/resources → 资源管理
// Wave 4 精化 (2026-05-11): 拆出 TableManagementContent 供 /admin/data Tab 内嵌

/**
 * 数据表管理内容（不含 AdminPageLayout 包装）。
 *
 * 用于 /admin/data Tab=assets 内嵌；以及独立页 /admin/data-management 包到
 * AdminPageLayout 后渲染（见下方 TableManagementPage default export）。
 */
export function TableManagementContent() {
  const { t } = useTranslation();
  const [batchDiagnosing, setBatchDiagnosing] = useState(false);

  const {
    // Data
    tables,
    stats,
    total,
    page,
    pageSize,

    // Loading states
    loading,
    detailLoading,
    diagnosisLoading,

    // Error
    error,

    // Query state
    query,

    // Query actions
    updateSearch,
    updateCategory,
    updateHealthStatus,
    updateSort,
    updatePage,
    refresh,

    // Detail
    selectedTable,
    tableDetail,
    fetchTableDetail,
    closeTableDetail,

    // Diagnosis
    diagnosingTable,
    diagnosis,
    diagnoseTable,
    closeDiagnosis,
    batchDiagnose,

    // Cleanup
    cleaningTable,
    cleanupTable,
    batchCleanup,
    batchCleanupLoading,
  } = useTableManagement();

  // Handle batch diagnose
  const handleBatchDiagnose = useCallback(async () => {
    setBatchDiagnosing(true);
    try {
      const results = await batchDiagnose();
      if (results.length === 0) {
        toast.success(
          t('admin.tables.diagnosis.title'),
          t('admin.tables.diagnosis.noIssuesFound')
        );
      } else {
        toast.warning(
          t('admin.tables.diagnosis.title'),
          t('admin.tables.diagnosis.issuesFound', { count: results.length })
        );
      }
    } finally {
      setBatchDiagnosing(false);
    }
  }, [batchDiagnose, t]);

  // Handle cleanup from diagnosis panel
  const handleCleanupFromDiagnosis = useCallback(() => {
    if (diagnosingTable) {
      closeDiagnosis();
      cleanupTable(diagnosingTable);
    }
  }, [diagnosingTable, closeDiagnosis, cleanupTable]);

  // Handle batch cleanup
  const handleBatchCleanup = useCallback(async () => {
    const confirmed = await confirm({
      title: t('admin.tables.cleanup.confirmBatch'),
      type: 'warning',
    });
    if (!confirmed) return;

    const results = await batchCleanup();
    if (results.length > 0) {
      const totalFreed = results.reduce((sum, r) => sum + r.freedBytes, 0);
      const formattedSize =
        totalFreed > 1024 * 1024
          ? `${(totalFreed / 1024 / 1024).toFixed(2)} MB`
          : `${(totalFreed / 1024).toFixed(2)} KB`;
      toast.success(
        t('admin.tables.cleanup.success'),
        t('admin.tables.cleanup.batchSuccess', {
          count: results.length,
          size: formattedSize,
        })
      );
      // Refresh data after cleanup
      refresh();
    } else {
      toast.info(
        t('admin.tables.cleanup.title'),
        t('admin.tables.cleanup.noCleanableData')
      );
    }
  }, [batchCleanup, t, refresh]);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <TableStatsCards
        stats={stats}
        loading={loading}
        onCleanup={handleBatchCleanup}
        cleanupLoading={batchCleanupLoading}
      />

      {/* Toolbar */}
      <TableToolbar
        query={query}
        onSearchChange={updateSearch}
        onCategoryChange={updateCategory}
        onHealthStatusChange={updateHealthStatus}
        onRefresh={refresh}
        onBatchDiagnose={handleBatchDiagnose}
        loading={loading}
        diagnosing={batchDiagnosing}
      />

      {/* Error State */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {t('admin.tables.error')}: {error.message || String(error)}
        </div>
      )}

      {/* Data Grid */}
      <TableDataGrid
        tables={tables}
        query={query}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={loading}
        onSort={updateSort}
        onPageChange={updatePage}
        onViewDetail={fetchTableDetail}
        onDiagnose={diagnoseTable}
        onCleanup={cleanupTable}
        cleaningTable={cleaningTable}
      />

      {/* Detail Modal */}
      <TableDetailModal
        table={tableDetail}
        loading={detailLoading}
        open={!!selectedTable}
        onClose={closeTableDetail}
      />

      {/* Diagnosis Panel */}
      <TableDiagnosisPanel
        diagnosis={diagnosis}
        loading={diagnosisLoading}
        open={!!diagnosingTable}
        onClose={closeDiagnosis}
        onCleanup={handleCleanupFromDiagnosis}
      />
    </div>
  );
}

/**
 * 数据表管理独立页（含 AdminPageLayout 包装）。
 *
 * 通常通过 /admin/data-management 路由访问。Tab 内嵌请用 `TableManagementContent`。
 */
export default function TableManagementPage() {
  const { t } = useTranslation();
  return (
    <AdminPageLayout
      title={t('admin.tables.title')}
      description={t('admin.tables.description')}
      icon={Layers}
      domain="data"
      maxWidth="7xl"
    >
      <TableManagementContent />
    </AdminPageLayout>
  );
}
