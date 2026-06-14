/**
 * Table Management Hook
 * Provides state management and API calls for database table management
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useApiGet } from '../core';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

// Table Category Enum
export type TableCategory =
  | 'USER'
  | 'RESOURCE'
  | 'AI_SESSION'
  | 'AI_CONFIG'
  | 'NOTIFICATION'
  | 'LOG'
  | 'SYSTEM'
  | 'ANALYTICS'
  | 'EXTERNAL'
  | 'CACHE'
  | 'KNOWLEDGE'
  | 'INGESTION'
  | 'OFFICE'
  | 'RESEARCH'
  | 'OTHER';

// Health Status
export type HealthStatus = 'healthy' | 'warning' | 'critical';

// Cleanup Policy
export interface CleanupPolicy {
  type: 'age' | 'status' | 'orphan' | 'size' | 'none';
  field?: string;
  threshold?: number;
  condition?: string;
  description?: string;
}

// Table Info
export interface TableInfo {
  name: string;
  displayName: string;
  category: TableCategory;
  rowCount: number;
  sizeBytes: number;
  sizeFormatted: string;
  dataSizeBytes: number;
  indexSizeBytes: number;
  toastSizeBytes: number;
  lastUpdated: string | null;
  cleanableRows: number;
  cleanableBytes: number;
  healthStatus: HealthStatus;
  hasCleanupPolicy: boolean;
  cleanupPolicy?: CleanupPolicy;
  description?: string;
}

// Table Column
export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  references?: string;
}

// Table Constraint
export interface TableConstraint {
  name: string;
  type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK' | 'INDEX';
  columns: string[];
  references?: string;
}

// Table Detail (extends TableInfo)
export interface TableDetail extends TableInfo {
  schema: TableColumn[];
  sampleData: Record<string, unknown>[];
  relatedTables: string[];
  constraints: TableConstraint[];
}

// Diagnosis Issue
export interface DiagnosisIssue {
  severity: 'info' | 'warning' | 'critical';
  type: string;
  message: string;
  details?: Record<string, unknown>;
}

// Table Diagnosis
export interface TableDiagnosis {
  tableName: string;
  analyzedAt: string;
  issues: DiagnosisIssue[];
  recommendations: string[];
  healthScore: number;
  cleanupSuggestion?: {
    estimatedRows: number;
    estimatedBytes: number;
    query: string;
    description: string;
  };
}

// Cleanup Result
export interface CleanupResult {
  success: boolean;
  tableName: string;
  deletedCount: number;
  freedBytes: number;
  freedFormatted: string;
  message: string;
  duration: number;
}

// Table Stats
export interface TableStats {
  totalTables: number;
  totalRows: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
  cleanableSizeBytes: number;
  cleanableSizeFormatted: string;
  lastAnalyzed: string;
  byCategory: Record<
    TableCategory,
    {
      count: number;
      rows: number;
      sizeBytes: number;
    }
  >;
  healthSummary: {
    healthy: number;
    warning: number;
    critical: number;
  };
}

// Table List Response
export interface TableListResponse {
  tables: TableInfo[];
  total: number;
  page: number;
  pageSize: number;
  stats: TableStats;
}

// Query Options
export interface TableListQuery {
  search?: string;
  category?: TableCategory;
  sortBy?:
    | 'name'
    | 'rows'
    | 'size'
    | 'updated'
    | 'status'
    | 'category'
    | 'cleanable';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  healthStatus?: HealthStatus;
}

// Refresh interval in milliseconds
const REFRESH_INTERVAL = 30000; // 30 seconds

export function useTableManagement(initialQuery?: TableListQuery) {
  // Query state
  const [query, setQuery] = useState<TableListQuery>({
    search: '',
    category: undefined,
    sortBy: 'size',
    sortOrder: 'desc',
    page: 1,
    pageSize: 50,
    healthStatus: undefined,
    ...initialQuery,
  });

  // Build query string from query object
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.category) params.set('category', query.category);
    if (query.sortBy) params.set('sortBy', query.sortBy);
    if (query.sortOrder) params.set('sortOrder', query.sortOrder);
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    if (query.healthStatus) params.set('healthStatus', query.healthStatus);
    return params.toString();
  }, [query]);

  // Fetch table list
  const {
    data: listData,
    loading: listLoading,
    error: listError,
    execute: fetchList,
  } = useApiGet<TableListResponse>(`/admin/tables?${queryString}`, {
    immediate: true,
  });

  // Selected table detail
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableDetail, setTableDetail] = useState<TableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Diagnosis state
  const [diagnosingTable, setDiagnosingTable] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<TableDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);

  // Cleanup state
  const [cleaningTable, setCleaningTable] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(
    null
  );

  // Batch diagnose loading state
  const [batchDiagnoseLoading, setBatchDiagnoseLoading] = useState(false);

  // Auto-refresh with visibility check
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchList();
      }
    }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchList]);

  // Refetch when query changes
  useEffect(() => {
    fetchList();
  }, [queryString, fetchList]);

  // Update search with debounce
  const updateSearch = useCallback((search: string) => {
    setQuery((prev) => ({ ...prev, search, page: 1 }));
  }, []);

  // Update category filter
  const updateCategory = useCallback((category: TableCategory | undefined) => {
    setQuery((prev) => ({ ...prev, category, page: 1 }));
  }, []);

  // Update health status filter
  const updateHealthStatus = useCallback(
    (healthStatus: HealthStatus | undefined) => {
      setQuery((prev) => ({ ...prev, healthStatus, page: 1 }));
    },
    []
  );

  // Update sorting
  const updateSort = useCallback(
    (sortBy: TableListQuery['sortBy'], sortOrder?: 'asc' | 'desc') => {
      setQuery((prev) => ({
        ...prev,
        sortBy,
        sortOrder:
          sortOrder ??
          (prev.sortBy === sortBy && prev.sortOrder === 'desc'
            ? 'asc'
            : 'desc'),
      }));
    },
    []
  );

  // Update page
  const updatePage = useCallback((page: number) => {
    setQuery((prev) => ({ ...prev, page }));
  }, []);

  // Update page size
  const updatePageSize = useCallback((pageSize: number) => {
    setQuery((prev) => ({ ...prev, pageSize, page: 1 }));
  }, []);

  // Fetch table detail
  const fetchTableDetail = useCallback(async (tableName: string) => {
    setSelectedTable(tableName);
    setDetailLoading(true);
    try {
      const response = await fetch(
        `${config.apiUrl}/admin/tables/${tableName}`,
        {
          headers: getAuthHeader(),
        }
      );
      const data = await response.json();
      if (data.success) {
        setTableDetail(data.data);
      }
    } catch {
      // Error handled silently, detail will be null
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Close table detail
  const closeTableDetail = useCallback(() => {
    setSelectedTable(null);
    setTableDetail(null);
  }, []);

  // Diagnose a table
  const diagnoseTable = useCallback(async (tableName: string) => {
    setDiagnosingTable(tableName);
    setDiagnosisLoading(true);
    try {
      const response = await fetch(
        `${config.apiUrl}/admin/tables/${tableName}/diagnose`,
        {
          method: 'POST',
          headers: getAuthHeader(),
        }
      );
      const data = await response.json();
      if (data.success) {
        setDiagnosis(data.data);
      }
    } catch {
      // Error handled silently, diagnosis will be null
    } finally {
      setDiagnosisLoading(false);
    }
  }, []);

  // Close diagnosis
  const closeDiagnosis = useCallback(() => {
    setDiagnosingTable(null);
    setDiagnosis(null);
  }, []);

  // Cleanup a table
  const cleanupTable = useCallback(
    async (tableName: string) => {
      setCleaningTable(tableName);
      try {
        const response = await fetch(
          `${config.apiUrl}/admin/tables/${tableName}/cleanup`,
          {
            method: 'POST',
            headers: getAuthHeader(),
          }
        );
        const data = await response.json();
        if (data.success) {
          setCleanupResult(data.data);
          // Refresh list after cleanup
          await fetchList();
        }
      } catch {
        // Error handled silently
      } finally {
        setCleaningTable(null);
      }
    },
    [fetchList]
  );

  // Batch diagnose all tables
  const batchDiagnose = useCallback(async (): Promise<TableDiagnosis[]> => {
    setBatchDiagnoseLoading(true);
    try {
      const response = await fetch(
        `${config.apiUrl}/admin/tables/batch-diagnose`,
        {
          method: 'POST',
          headers: getAuthHeader(),
        }
      );
      const data = await response.json();
      if (data.success) {
        return data.data;
      }
      return [];
    } catch {
      return [];
    } finally {
      setBatchDiagnoseLoading(false);
    }
  }, []);

  // Clear cleanup result
  const clearCleanupResult = useCallback(() => {
    setCleanupResult(null);
  }, []);

  // Batch cleanup all cleanable tables
  const [batchCleanupLoading, setBatchCleanupLoading] = useState(false);
  const batchCleanup = useCallback(async (): Promise<CleanupResult[]> => {
    setBatchCleanupLoading(true);
    try {
      const response = await fetch(
        `${config.apiUrl}/admin/tables/batch-cleanup`,
        {
          method: 'POST',
          headers: getAuthHeader(),
        }
      );
      const data = await response.json();
      if (data.success) {
        // Refresh list after cleanup
        await fetchList();
        return data.data?.results || [];
      }
      return [];
    } catch {
      return [];
    } finally {
      setBatchCleanupLoading(false);
    }
  }, [fetchList]);

  return {
    // Data
    tables: listData?.tables ?? [],
    stats: listData?.stats ?? null,
    total: listData?.total ?? 0,
    page: listData?.page ?? 1,
    pageSize: listData?.pageSize ?? 50,

    // Loading states
    loading: listLoading,
    detailLoading,
    diagnosisLoading,
    cleanupLoading: !!cleaningTable,
    batchDiagnoseLoading,

    // Error
    error: listError,

    // Query state
    query,

    // Query actions
    updateSearch,
    updateCategory,
    updateHealthStatus,
    updateSort,
    updatePage,
    updatePageSize,
    refresh: fetchList,

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
    cleanupResult,
    cleanupTable,
    clearCleanupResult,
    batchCleanup,
    batchCleanupLoading,
  };
}
