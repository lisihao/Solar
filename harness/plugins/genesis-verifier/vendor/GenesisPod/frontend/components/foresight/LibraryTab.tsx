'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils/common';
import {
  DataTable,
  type ColumnDef,
} from '@/components/common/tables/DataTable';
import type {
  ForesightCard,
  ForesightLayerDef,
  ForesightOverview,
} from '@/services/foresight/api';
import { SENS_META, STAGE_META, type CardPendingState } from './foresight-meta';

interface LibraryTabProps {
  overview: ForesightOverview;
  layers: ForesightLayerDef[];
  pending: Map<string, CardPendingState>;
  onSelectCard: (cardId: string) => void;
}

const selectCls =
  'border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 focus:border-gray-700 focus:outline-none';

/** 假设库 —— 全量假设的运营视图：搜索 + 四维筛选 + 实时状态（canonical DataTable） */
export function LibraryTab({
  overview,
  layers,
  pending,
  onSelectCard,
}: LibraryTabProps) {
  const [search, setSearch] = useState('');
  const [layer, setLayer] = useState('');
  const [stage, setStage] = useState('');
  const [sens, setSens] = useState('');
  const [status, setStatus] = useState('');

  const rows = useMemo(
    () =>
      overview.cards.filter((c) => {
        const p = pending.get(c.id);
        if (
          search &&
          !(c.title + c.claim).toLowerCase().includes(search.toLowerCase())
        )
          return false;
        if (layer && c.layer !== layer) return false;
        if (stage && c.stage !== stage) return false;
        if (sens && c.sens !== sens) return false;
        if (status === 'ok' && p) return false;
        if (status === 'dirty' && !p) return false;
        return true;
      }),
    [overview.cards, pending, search, layer, stage, sens, status]
  );

  const columns: ColumnDef<ForesightCard>[] = useMemo(
    () => [
      {
        id: 'cardKey',
        header: '编号',
        accessorKey: 'cardKey',
        sortable: true,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-gray-400">{row.cardKey}</span>
        ),
      },
      {
        id: 'title',
        header: '假设',
        accessorKey: 'title',
        cell: ({ row }) => (
          <span className="font-semibold text-gray-900">
            {row.title}
            {row.scenarios && row.scenarios.length > 0 && (
              <span className="font-mono ml-1.5 border border-violet-400 px-1 text-xs text-violet-700">
                分叉
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'layer',
        header: '层级',
        accessorKey: 'layer',
        sortable: true,
        cell: ({ row }) => (
          <span className="text-xs text-gray-600">
            {row.layer} {layers.find((l) => l.id === row.layer)?.name}
          </span>
        ),
      },
      {
        id: 'stage',
        header: '阶段',
        cell: ({ row }) => (
          <span
            className={cn(
              'font-mono border px-1.5 text-xs',
              STAGE_META[row.stage]?.cls
            )}
          >
            {STAGE_META[row.stage]?.label}
          </span>
        ),
      },
      {
        id: 'sens',
        header: '敏感度',
        cell: ({ row }) => (
          <span
            className={cn(
              'font-mono border px-1.5 text-xs',
              SENS_META[row.sens]?.cls
            )}
          >
            {SENS_META[row.sens]?.label}
          </span>
        ),
      },
      {
        id: 'conf',
        header: '置信度',
        accessorKey: 'conf',
        sortable: true,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="inline-block h-1 w-16 bg-gray-100">
              <span
                className="block h-full bg-amber-500"
                style={{ width: `${row.conf * 100}%` }}
              />
            </span>
            <span className="font-mono text-xs text-gray-500">
              {row.conf.toFixed(2)}
            </span>
          </span>
        ),
      },
      {
        id: 'horizon',
        header: 'Horizon',
        accessorKey: 'horizon',
        sortable: true,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-gray-500">{row.horizon}</span>
        ),
      },
      {
        id: 'sources',
        header: '信源',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-gray-500">
            ×{row.sources.length}
          </span>
        ),
      },
      {
        id: 'status',
        header: '状态',
        cell: ({ row }) => {
          const p = pending.get(row.id);
          if (p?.isSource)
            return (
              <span className="font-mono border border-red-600 bg-red-600 px-1.5 text-xs font-semibold text-white">
                信号命中
              </span>
            );
          if (p)
            return (
              <span className="font-mono border border-amber-500 bg-amber-500 px-1.5 text-xs font-semibold text-white">
                待复核
              </span>
            );
          return (
            <span className="font-mono border border-emerald-300 px-1.5 text-xs text-emerald-700">
              稳固
            </span>
          );
        },
      },
    ],
    [pending, layers]
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索假设标题 / 断言…"
          className={cn(selectCls, 'min-w-60')}
        />
        <select
          value={layer}
          onChange={(e) => setLayer(e.target.value)}
          className={selectCls}
        >
          <option value="">全部层级</option>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.id} {l.name}
            </option>
          ))}
        </select>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className={selectCls}
        >
          <option value="">全部阶段</option>
          {Object.entries(STAGE_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          value={sens}
          onChange={(e) => setSens(e.target.value)}
          className={selectCls}
        >
          <option value="">全部敏感度</option>
          <option value="high">高敏</option>
          <option value="mid">中敏</option>
          <option value="low">低敏</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={selectCls}
        >
          <option value="">全部状态</option>
          <option value="ok">稳固</option>
          <option value="dirty">待复核</option>
        </select>
        <span className="font-mono ml-auto text-xs text-gray-500">
          {rows.length} / {overview.cards.length} 条
        </span>
      </div>

      <DataTable<ForesightCard>
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        onRowClick={(row) => onSelectCard(row.id)}
        emptyState={{
          title: '没有匹配的假设',
          description: '调整筛选条件，或在图谱中新建假设卡',
        }}
      />
    </div>
  );
}
