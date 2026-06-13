'use client';

import { ExternalLink } from 'lucide-react';
import { AdminDrawer } from '@/components/admin/shared';

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

interface StorageR2DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  detail: R2PrefixDetail | null;
  bucket: string | null;
}

export default function StorageR2DetailDrawer({
  open,
  onClose,
  detail,
  bucket,
}: StorageR2DetailDrawerProps) {
  const bucketUrl =
    bucket && detail
      ? `https://dash.cloudflare.com/?to=/:account/r2/default/buckets/${bucket}?prefix=${encodeURIComponent(detail.prefix)}`
      : null;

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      title="R2 前缀详情"
      description={detail?.prefix}
      size="md"
    >
      {detail ? (
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="对象数" value={detail.objects.toLocaleString()} />
            <Stat label="占用空间" value={detail.bytesHuman} />
            <Stat label="目标字段" value={String(detail.targetCount)} />
            <Stat
              label="管理状态"
              value={detail.managed ? '受管' : '仅观测'}
              tone={detail.managed ? 'emerald' : 'amber'}
            />
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-600">
              迁移进度
            </p>
            <div className="space-y-2 text-sm">
              <Row label="DB 总行数" value={detail.dbRows.toLocaleString()} />
              <Row
                label="已迁移到 R2"
                value={detail.migratedRows.toLocaleString()}
                tone="emerald"
              />
              <Row
                label="DB 中仍待迁"
                value={
                  detail.remainingRows > 0
                    ? detail.remainingRows.toLocaleString()
                    : '0'
                }
                tone={detail.remainingRows > 0 ? 'amber' : 'gray'}
              />
            </div>
          </div>

          {bucketUrl && (
            <a
              href={bucketUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              在 Cloudflare R2 Dashboard 中打开
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      ) : (
        <div className="p-5 text-sm text-gray-500">未选择前缀</div>
      )}
    </AdminDrawer>
  );
}

function Stat({
  label,
  value,
  tone = 'gray',
}: {
  label: string;
  value: string;
  tone?: 'gray' | 'emerald' | 'amber';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : 'text-gray-900';
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function Row({
  label,
  value,
  tone = 'gray',
}: {
  label: string;
  value: string;
  tone?: 'gray' | 'emerald' | 'amber';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : 'text-gray-700';
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}
