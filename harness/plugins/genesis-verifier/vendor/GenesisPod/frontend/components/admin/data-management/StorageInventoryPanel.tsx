'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { toast } from '@/stores';
import { ConfirmDialog } from '@/components/ui/dialogs/ConfirmDialog';
import StorageStatsCards from './StorageStatsCards';
import StorageToolbar from './StorageToolbar';
import StoragePipelineGrid from './StoragePipelineGrid';
import StorageR2DetailDrawer from './StorageR2DetailDrawer';

interface TableStat {
  table: string;
  rows: number;
  totalBytes: number;
  totalHuman: string;
}

interface OffloadFieldStat {
  table: string;
  field: string;
  uriField: string;
  r2Prefix: string;
  totalRows: number;
  rowsWithUri: number;
  rowsWithDbContent: number;
}

interface R2PrefixStat {
  prefix: string;
  objects: number;
  bytes: number;
  bytesHuman: string;
}

interface StorageInventory {
  database: {
    totalBytes: number;
    totalHuman: string;
    tables: TableStat[];
  };
  offloadFields: OffloadFieldStat[];
  r2: {
    configured: boolean;
    bucket: string | null;
    totalObjects: number;
    totalBytes: number;
    totalHuman: string;
    byPrefix: R2PrefixStat[];
  };
  generatedAt: string;
}

interface TrendPoint {
  at: string;
  dbMb: number;
  r2Mb: number;
  r2Objects: number;
}

interface R2PrefixDetail {
  prefix: string;
  objects: number;
  bytes: number;
  bytesHuman: string;
  managed: boolean;
  targetCount: number;
  dbRows: number;
  migratedRows: number;
  remainingRows: number;
}

export default function StorageInventoryPanel() {
  const [data, setData] = useState<StorageInventory | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [r2DetailPrefix, setR2DetailPrefix] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, trendRes] = await Promise.all([
        fetch(`${config.apiUrl}/admin/storage-inventory`, {
          headers: getAuthHeader(),
        }),
        fetch(`${config.apiUrl}/admin/storage-inventory/trend?days=30`, {
          headers: getAuthHeader(),
        }),
      ]);
      if (!invRes.ok) {
        if (invRes.status === 401) throw new Error('UNAUTHORIZED');
        throw new Error(`HTTP ${invRes.status}`);
      }
      const invRaw = (await invRes.json()) as
        | StorageInventory
        | { success?: boolean; data?: StorageInventory };
      const payload =
        (invRaw as { data?: StorageInventory }).data !== undefined
          ? (invRaw as { data: StorageInventory }).data
          : (invRaw as StorageInventory);
      setData(payload);

      if (trendRes.ok) {
        const trendRaw = (await trendRes.json()) as
          | TrendPoint[]
          | { data?: TrendPoint[] };
        setTrend(Array.isArray(trendRaw) ? trendRaw : (trendRaw.data ?? []));
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(
        msg === 'UNAUTHORIZED'
          ? '未授权访问存储管理接口。'
          : '存储管理数据获取失败。'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const exportJson = useCallback(() => {
    if (!data) return;
    const blob = new Blob(
      [JSON.stringify({ inventory: data, trend }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storage-inventory-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, trend]);

  const confirmRun = useCallback(async () => {
    setTriggering(true);
    setConfirmOpen(false);
    try {
      const response = await fetch(
        `${config.apiUrl}/admin/storage-inventory/run-offload`,
        {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          body: '{}',
        }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      toast.success('Offload 已触发', '后台已经开始执行 DB 到 R2 的迁移批次。');
      for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await load();
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error('Offload 触发失败', msg);
    } finally {
      setTriggering(false);
    }
  }, [load]);

  const relative = useMemo(() => {
    if (!data?.generatedAt) return '';
    const diff = Math.max(0, now - new Date(data.generatedAt).getTime());
    if (diff < 60_000) return '刚刚';
    const minutes = Math.round(diff / 60_000);
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.round(hours / 24)} 天前`;
  }, [data, now]);

  const derived = useMemo(() => {
    if (!data) return null;
    const offloadFields = [...data.offloadFields].sort((a, b) =>
      `${a.table}.${a.field}`.localeCompare(`${b.table}.${b.field}`)
    );
    const registeredPrefixMap = new Map<
      string,
      {
        targetCount: number;
        dbRows: number;
        migratedRows: number;
        remainingRows: number;
      }
    >();
    for (const row of offloadFields) {
      const entry = registeredPrefixMap.get(row.r2Prefix) ?? {
        targetCount: 0,
        dbRows: 0,
        migratedRows: 0,
        remainingRows: 0,
      };
      entry.targetCount += 1;
      entry.dbRows += row.totalRows;
      entry.migratedRows += row.rowsWithUri;
      entry.remainingRows += row.rowsWithDbContent;
      registeredPrefixMap.set(row.r2Prefix, entry);
    }
    const prefixDetailMap = new Map<string, R2PrefixDetail>();
    const allPrefixes = new Set<string>([
      ...Array.from(registeredPrefixMap.keys()),
      ...(data.r2.byPrefix ?? []).map((r) => r.prefix),
    ]);
    for (const prefix of allPrefixes) {
      const live = data.r2.byPrefix.find((r) => r.prefix === prefix);
      const reg = registeredPrefixMap.get(prefix);
      prefixDetailMap.set(prefix, {
        prefix,
        objects: live?.objects ?? 0,
        bytes: live?.bytes ?? 0,
        bytesHuman: live?.bytesHuman ?? '0 B',
        targetCount: reg?.targetCount ?? 0,
        managed: Boolean(reg),
        dbRows: reg?.dbRows ?? 0,
        migratedRows: reg?.migratedRows ?? 0,
        remainingRows: reg?.remainingRows ?? 0,
      });
    }
    const observedOnlyPrefixes = Array.from(prefixDetailMap.values()).filter(
      (r) => !r.managed
    ).length;
    return {
      offloadFields,
      managedPrefixCount: registeredPrefixMap.size,
      observedPrefixCount: data.r2.byPrefix.length,
      observedOnlyPrefixes,
      prefixDetailMap,
    };
  }, [data]);

  // 30-day delta (current - earliest in trend window).
  const trendDelta = useMemo(() => {
    if (trend.length < 2)
      return { dbDeltaMb: null, r2DeltaMb: null, r2ObjectsDelta: null };
    const first = trend[0];
    const last = trend[trend.length - 1];
    return {
      dbDeltaMb: last.dbMb - first.dbMb,
      r2DeltaMb: last.r2Mb - first.r2Mb,
      r2ObjectsDelta: last.r2Objects - first.r2Objects,
    };
  }, [trend]);

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="animate-pulse text-sm text-gray-500">
          正在加载存储状态视图...
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <div className="flex items-center justify-between gap-4">
          <span>{error}</span>
          <button
            onClick={() => void load()}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  if (!data || !derived) return null;

  const selectedR2Detail =
    r2DetailPrefix !== null
      ? (derived.prefixDetailMap.get(r2DetailPrefix) ?? null)
      : null;

  return (
    <div className="space-y-6">
      <StorageStatsCards
        dbSizeFormatted={data.database.totalHuman}
        dbTableCount={data.database.tables.length}
        r2SizeFormatted={data.r2.totalHuman}
        r2ObjectCount={data.r2.totalObjects}
        r2Configured={data.r2.configured}
        r2Bucket={data.r2.bucket}
        managedTargets={derived.offloadFields.length}
        managedPrefixes={derived.managedPrefixCount}
        observedPrefixes={derived.observedPrefixCount}
        observedOnlyPrefixes={derived.observedOnlyPrefixes}
        dbDeltaMb={trendDelta.dbDeltaMb}
        r2DeltaMb={trendDelta.r2DeltaMb}
        r2ObjectsDelta={trendDelta.r2ObjectsDelta}
        loading={loading}
      />

      <StorageToolbar
        onRefresh={() => void load()}
        onExport={exportJson}
        onRun={() => setConfirmOpen(true)}
        loading={loading}
        triggering={triggering}
        canRun={data.r2.configured}
        generatedAtRelative={relative}
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <StoragePipelineGrid
        rows={derived.offloadFields}
        loading={loading}
        onShowR2Detail={(prefix) => setR2DetailPrefix(prefix)}
      />

      <StorageR2DetailDrawer
        open={r2DetailPrefix !== null}
        onClose={() => setR2DetailPrefix(null)}
        detail={selectedR2Detail}
        bucket={data.r2.bucket}
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmRun}
        title="确认立即运行 Offload"
        description="这会触发一次后台 DB 到 R2 的迁移扫描，适合在新增能力接入后做一次手工验证。"
        type="info"
        confirmText="立即执行"
        loading={triggering}
      />
    </div>
  );
}
