'use client';

import { useState, useEffect, useCallback } from 'react';
import { confirm } from '@/stores';
import Link from 'next/link';
import {
  Plus,
  Check,
  ChevronRight,
  Loader2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useGoogleDrive } from '@/hooks/domain/useGoogleDrive';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import {
  getConnections,
  getConnectUrl,
  disconnectNotion,
  NotionConnection,
} from '@/services/notion/api';
import ClientDate from '@/components/common/ClientDate';
import { LoadingState } from '@/components/ui/states/LoadingState';
import { logger } from '@/lib/utils/logger';

const NotionLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.62c-.094-.42.14-1.026.793-1.073l3.456-.233 4.763 7.279V9.014l-1.215-.14c-.093-.513.28-.886.747-.933l3.223-.186z" />
  </svg>
);

const DriveLogo = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

/**
 * 集成 /me/integrations — Notion / Google Drive / 飞书 统一连接器行。
 *
 * 每个连接器同构：图标 + 名称 + 描述 + 状态徽章 + 操作；已连接态在下方展开
 * 明细（多工作区 / 多账号 / 绑定信息）。三者视觉一致（设计 §3.2）。
 */
export function IntegrationsSection() {
  return (
    <div className="space-y-4">
      <NotionConnector />
      <DriveConnector />
      <FeishuConnector />
    </div>
  );
}

// ───────────────────────── 统一行外壳 ─────────────────────────

interface ConnectorRowProps {
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  description: string;
  connected: boolean;
  statusLabel: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  loading?: boolean;
}

function ConnectorRow({
  icon,
  iconBg,
  name,
  description,
  connected,
  statusLabel,
  actions,
  children,
  loading,
}: ConnectorRowProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900">{name}</p>
            <p className="truncate text-sm text-gray-500">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
              connected
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {connected && <Check className="h-3 w-3" />}
            {statusLabel}
          </span>
          {actions}
        </div>
      </div>
      {loading ? (
        <div className="border-t border-gray-100">
          <LoadingState />
        </div>
      ) : (
        children && (
          <div className="border-t border-gray-100 p-4">{children}</div>
        )
      )}
    </div>
  );
}

function RowButton({
  onClick,
  disabled,
  variant = 'secondary',
  icon: Icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  const styles =
    variant === 'primary'
      ? 'bg-gray-900 text-white hover:bg-gray-800'
      : variant === 'danger'
        ? 'text-red-600 hover:bg-red-50'
        : 'border border-gray-300 text-gray-700 hover:bg-gray-50';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${styles}`}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

// ───────────────────────── Notion ─────────────────────────

function NotionConnector() {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<NotionConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getConnections();
      setConnections(result.connections);
    } catch (error) {
      logger.error('Failed to fetch Notion connections:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const result = await getConnectUrl();
      window.location.href = result.url;
    } catch (error) {
      logger.error('Failed to connect Notion:', error);
      setConnecting(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (
      !(await confirm({
        title: t('profile.integrations.disconnectConfirm'),
        type: 'danger',
      }))
    )
      return;
    try {
      await disconnectNotion(id);
      await fetchConnections();
    } catch (error) {
      logger.error('Failed to disconnect Notion:', error);
    }
  };

  const connected = connections.length > 0;

  return (
    <ConnectorRow
      icon={<NotionLogo className="h-6 w-6 text-white" />}
      iconBg="bg-gray-900"
      name={t('profile.integrations.notionIntegration')}
      description={t('profile.integrations.notionDesc')}
      connected={connected}
      statusLabel={
        connected
          ? `${connections.length} ${t('me.integrations.workspaces')}`
          : t('me.integrations.notConnected')
      }
      loading={loading}
      actions={
        connected ? (
          <RowButton onClick={handleConnect} disabled={connecting} icon={Plus}>
            {t('profile.integrations.addWorkspace')}
          </RowButton>
        ) : (
          <RowButton
            onClick={handleConnect}
            disabled={connecting}
            variant="primary"
          >
            {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('profile.integrations.connectNotion')}
          </RowButton>
        )
      }
    >
      {connected && (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {conn.workspaceName || 'Notion Workspace'}
                </p>
                <p className="text-xs text-gray-500">
                  {conn.pagesCount || 0} {t('me.integrations.pages')}
                  {conn.lastSyncAt && (
                    <>
                      {' · '}
                      <ClientDate date={conn.lastSyncAt} format="date" />
                    </>
                  )}
                </p>
              </div>
              <RowButton
                onClick={() => handleDisconnect(conn.id)}
                variant="danger"
              >
                {t('profile.integrations.disconnect')}
              </RowButton>
            </div>
          ))}
          <Link
            href="/library?tab=notion"
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            {t('profile.integrations.viewNotionPages')}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </ConnectorRow>
  );
}

// ───────────────────────── Google Drive ─────────────────────────

function DriveConnector() {
  const { t } = useTranslation();
  const { connections, isConnected, loading, connect, disconnect, refresh } =
    useGoogleDrive();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connect();
    } catch (error) {
      logger.error('Failed to connect Google Drive:', error);
      setConnecting(false);
    }
  };

  const handleDisconnect = async (id: string, email: string) => {
    if (
      !(await confirm({
        title: t('me.integrations.driveDisconnectConfirm', { email }),
        type: 'danger',
      }))
    )
      return;
    try {
      await disconnect(id);
      await refresh();
    } catch (error) {
      logger.error('Failed to disconnect Google Drive:', error);
    }
  };

  return (
    <ConnectorRow
      icon={<DriveLogo className="h-6 w-6" />}
      iconBg="bg-white ring-1 ring-gray-200"
      name={t('me.integrations.drive')}
      description={t('me.integrations.driveDesc')}
      connected={isConnected}
      statusLabel={
        isConnected
          ? `${connections.length} ${t('me.integrations.accounts')}`
          : t('me.integrations.notConnected')
      }
      loading={loading && !isConnected}
      actions={
        isConnected ? (
          <RowButton onClick={handleConnect} disabled={connecting} icon={Plus}>
            {t('me.integrations.addAccount')}
          </RowButton>
        ) : (
          <RowButton
            onClick={handleConnect}
            disabled={connecting}
            variant="primary"
          >
            {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('me.integrations.connect')}
          </RowButton>
        )
      }
    >
      {isConnected && (
        <div className="space-y-2">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                {conn.photoUrl ? (
                  <img
                    src={conn.photoUrl}
                    alt={conn.email}
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-600">
                    {(conn.displayName || conn.email).charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {conn.displayName || conn.email}
                  </p>
                  <p className="truncate text-xs text-gray-500">{conn.email}</p>
                </div>
              </div>
              <RowButton
                onClick={() => handleDisconnect(conn.id, conn.email)}
                variant="danger"
              >
                {t('profile.integrations.disconnect')}
              </RowButton>
            </div>
          ))}
          <Link
            href="/library?tab=google-drive"
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            {t('me.integrations.viewFiles')}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </ConnectorRow>
  );
}

// ───────────────────────── 飞书 ─────────────────────────

function FeishuConnector() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bound, setBound] = useState(false);
  const [boundId, setBoundId] = useState<string | null>(null);
  const [openId, setOpenId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiUrl}/feishu-data-source/binding`, {
        headers: { ...getAuthHeader() },
      });
      if (res.ok) {
        const result = (await res.json()) as {
          data?: { isBound?: boolean; feishuOpenId?: string | null };
          isBound?: boolean;
          feishuOpenId?: string | null;
        };
        const data = 'data' in result && result.data ? result.data : result;
        setBound(!!data.isBound);
        setBoundId(data.feishuOpenId ?? null);
      }
    } catch (err) {
      logger.error('Failed to fetch Feishu binding:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleBind = async () => {
    if (!openId.trim()) {
      setError(t('profile.integrations.feishu.enterOpenId'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${config.apiUrl}/feishu-data-source/binding`, {
        method: 'PATCH',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ feishuOpenId: openId.trim() }),
      });
      if (res.ok) {
        setShowForm(false);
        setOpenId('');
        await fetchStatus();
      } else {
        setError(t('profile.integrations.feishu.bindFailed'));
      }
    } catch (err) {
      logger.error('Failed to bind Feishu:', err);
      setError(t('profile.integrations.feishu.bindFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleUnbind = async () => {
    if (
      !(await confirm({
        title: t('profile.integrations.feishu.confirmUnbind'),
        type: 'danger',
      }))
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`${config.apiUrl}/feishu-data-source/binding`, {
        method: 'DELETE',
        headers: { ...getAuthHeader() },
      });
      if (res.ok) await fetchStatus();
    } catch (err) {
      logger.error('Failed to unbind Feishu:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConnectorRow
      icon={<Zap className="h-6 w-6 text-blue-600" />}
      iconBg="bg-blue-100"
      name={t('profile.integrations.feishu.title')}
      description={t('profile.integrations.feishu.description')}
      connected={bound}
      statusLabel={
        bound
          ? t('profile.integrations.feishu.connected')
          : t('me.integrations.notConnected')
      }
      loading={loading}
      actions={
        bound ? (
          <RowButton onClick={handleUnbind} disabled={busy} variant="danger">
            {t('profile.integrations.disconnect')}
          </RowButton>
        ) : (
          <RowButton onClick={() => setShowForm((v) => !v)} variant="primary">
            {t('profile.integrations.feishu.bind')}
          </RowButton>
        )
      }
    >
      {bound && boundId && (
        <p className="text-sm text-gray-600">
          {t('profile.integrations.feishu.boundTo')}: {boundId}
        </p>
      )}
      {!bound && showForm && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            {t('profile.integrations.feishu.openIdLabel')}
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={openId}
              onChange={(e) => setOpenId(e.target.value)}
              placeholder={t('profile.integrations.feishu.openIdPlaceholder')}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <RowButton
              onClick={handleBind}
              disabled={busy || !openId.trim()}
              variant="primary"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('profile.integrations.feishu.bind')}
            </RowButton>
          </div>
          <p className="text-xs text-gray-500">
            {t('profile.integrations.feishu.openIdHelp')}
          </p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </ConnectorRow>
  );
}
