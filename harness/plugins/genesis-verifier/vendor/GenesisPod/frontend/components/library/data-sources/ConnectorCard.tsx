'use client';

import {
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import {
  CONNECTOR_STATUS_TOKENS,
  type ConnectorState,
} from '../_design/tokens';
import StatusDot from '../_design/StatusDot';

interface ConnectorMetric {
  value: string | number;
  label: string;
}

interface ConnectorCardProps {
  icon: LucideIcon;
  iconBg?: string; // e.g. 'bg-blue-50 text-blue-600'
  name: string;
  description?: string;
  /** 已连接时显示的账号身份（邮箱、租户名等） */
  account?: string;
  state: ConnectorState;
  metrics?: ConnectorMetric[];
  lastSyncLabel?: string;
  errorMessage?: string;
  syncing?: boolean;
  onBrowse?: () => void;
  onSettings?: () => void;
  onSync?: () => void;
  onConnect?: () => void;
}

/**
 * 数据源连接器卡片（Notion / Google Drive / 飞书等）
 * 完整的微型管理面板：状态、账号、指标、同步信息、3 个核心动作
 */
export default function ConnectorCard({
  icon: Icon,
  iconBg = 'bg-violet-50 text-violet-600',
  name,
  description,
  account,
  state,
  metrics,
  lastSyncLabel,
  errorMessage,
  syncing,
  onBrowse,
  onSettings,
  onSync,
  onConnect,
}: ConnectorCardProps) {
  const statusToken = CONNECTOR_STATUS_TOKENS[syncing ? 'syncing' : state];
  const isConnected = state === 'connected';
  const needsReauth = state === 'needs_reauth';

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${iconBg} transition-transform duration-200 group-hover:scale-105`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h4 className="truncate text-base font-semibold text-gray-900">
              {name}
            </h4>
            {(account || description) && (
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {account || description}
              </p>
            )}
          </div>
        </div>
        <StatusDot token={statusToken} />
      </div>

      {/* Metrics（已连接时显示） */}
      {isConnected && metrics && metrics.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-gray-50/70 px-3 py-2.5">
          {metrics.map((m, i) => (
            <div key={i} className="flex flex-col items-center text-center">
              <span className="text-base font-semibold text-gray-900">
                {m.value}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-gray-500">
                {m.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 错误信息 / 同步信息 */}
      <div className="mt-3 min-h-[20px] text-xs">
        {errorMessage ? (
          <p className="line-clamp-1 text-amber-600">{errorMessage}</p>
        ) : isConnected && lastSyncLabel ? (
          <p className="text-gray-500">{lastSyncLabel}</p>
        ) : !isConnected && description && account ? (
          <p className="line-clamp-1 text-gray-500">{description}</p>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        {isConnected ? (
          <>
            {onBrowse && (
              <button
                onClick={onBrowse}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
              >
                <FolderOpen className="h-4 w-4" />
                浏览
              </button>
            )}
            {onSync && (
              <button
                onClick={onSync}
                disabled={syncing}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                title="立即同步"
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
            )}
            {onSettings && (
              <button
                onClick={onSettings}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50"
                title="设置"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
          </>
        ) : needsReauth ? (
          <button
            onClick={onConnect}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
          >
            <RefreshCw className="h-4 w-4" />
            重新授权
          </button>
        ) : (
          <button
            onClick={onConnect}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100"
          >
            <ExternalLink className="h-4 w-4" />
            立即连接
          </button>
        )}
      </div>
    </div>
  );
}
