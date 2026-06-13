'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  Radio,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Zap,
  Server,
  Key,
  Users,
  Wrench,
  AlertTriangle,
  Plus,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Power,
  PowerOff,
  Pencil,
} from 'lucide-react';
import { Tabs } from '@/components/ui/tabs';
import { Modal } from '@/components/ui/dialogs/Modal';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { useAdminSecrets } from '@/hooks/domain/useAdminSecrets';
import {
  useAdminMCPExternal,
  ExternalMCPServer,
  MCPExternalTool,
} from '@/hooks/domain/useAdminMCPExternal';
import { confirm } from '@/stores';
import { TruncatedCell } from '@/components/common/tables';

// ==================== Types ====================

interface MCPServerStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  activeSessions: number;
  metrics24h: {
    totalCalls: number;
    successRate: number;
    avgDuration: number;
  };
}

interface MCPServerMetrics {
  totalCalls: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgDuration: number;
  byTool: Record<
    string,
    { calls: number; errors: number; avgDuration: number }
  >;
  byApiKey: Record<string, { calls: number; lastUsed: string }>;
  recentErrors: Array<{
    toolName: string;
    errorType: string;
    timestamp: string;
  }>;
}

interface MCPSession {
  sessionId: string;
  clientInfo?: { name: string; version: string };
  createdAt: string;
}

// ==================== Helpers ====================

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDuration(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function getStatusConfig(status: string) {
  switch (status) {
    case 'healthy':
      return {
        icon: CheckCircle,
        color: 'text-green-600',
        bg: 'bg-green-50',
        border: 'border-green-200',
        label: 'Healthy',
      };
    case 'degraded':
      return {
        icon: AlertCircle,
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        label: 'Degraded',
      };
    default:
      return {
        icon: XCircle,
        color: 'text-red-600',
        bg: 'bg-red-50',
        border: 'border-red-200',
        label: 'Unhealthy',
      };
  }
}

// ==================== Sub-Components ====================

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'blue',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color?: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    red: 'text-red-600',
    purple: 'text-purple-600',
    amber: 'text-amber-600',
    cyan: 'text-cyan-600',
    slate: 'text-slate-600',
  };

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
        <Icon className={`h-8 w-8 ${colorClasses[color]} opacity-50`} />
      </div>
    </div>
  );
}

// ==================== Main Component ====================

export default function MCPServerPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MCPServerStatus | null>(null);
  const [metrics, setMetrics] = useState<MCPServerMetrics | null>(null);
  const [sessions, setSessions] = useState<MCPSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'tools' | 'metrics' | 'sessions' | 'apiKeys' | 'external'
  >('overview');

  // API Keys state
  const {
    secrets,
    createSecret,
    deleteSecret,
    getSecretValue,
    isCreating,
    isDeleting,
    isGettingValue,
  } = useAdminSecrets();
  const mcpApiKeys = secrets.filter((s) => s.category === 'MCP');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [revealingKey, setRevealingKey] = useState<string | null>(null);

  // External MCP state
  const {
    servers: externalServers,
    loading: externalLoading,
    actionLoading: externalActionLoading,
    refetch: refetchExternal,
    addServer: addExternalServer,
    updateServer: updateExternalServer,
    removeServer: removeExternalServer,
    connectServer: connectExternalServer,
    disconnectServer: disconnectExternalServer,
    listTools: listExternalTools,
  } = useAdminMCPExternal();
  const [showAddExternalModal, setShowAddExternalModal] = useState(false);
  const [editingExternal, setEditingExternal] =
    useState<ExternalMCPServer | null>(null);
  const [externalForm, setExternalForm] = useState({
    serverId: '',
    name: '',
    description: '',
    transport: 'sse',
    url: '',
    enabled: true,
    autoConnect: false,
  });
  const [viewingToolsServer, setViewingToolsServer] = useState<string | null>(
    null
  );
  const [discoveredTools, setDiscoveredTools] = useState<MCPExternalTool[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const headers = getAuthHeader();

      const [statusRes, metricsRes, sessionsRes] = await Promise.all([
        fetch(`${config.apiUrl}/admin/mcp-server/status`, { headers }).catch(
          () => null
        ),
        fetch(`${config.apiUrl}/admin/mcp-server/metrics`, { headers }).catch(
          () => null
        ),
        fetch(`${config.apiUrl}/admin/mcp-server/sessions`, {
          headers,
        }).catch(() => null),
      ]);

      if (statusRes?.ok) {
        const data = await statusRes.json();
        setStatus(data?.data ?? data);
      }

      if (metricsRes?.ok) {
        const data = await metricsRes.json();
        setMetrics(data?.data ?? data);
      }

      if (sessionsRes?.ok) {
        const data = await sessionsRes.json();
        const parsed = data?.data ?? data;
        setSessions(parsed?.sessions ?? []);
      }

      setError(null);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('admin.mcpServer.errors.fetchFailed');
      setError(message);
      logger.error('Failed to fetch MCP Server data:', err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => void fetchData(), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const statusCfg = status ? getStatusConfig(status.status) : null;
  const StatusIcon = statusCfg?.icon ?? AlertCircle;

  const renderOverviewTab = () => (
    <>
      {/* Server Status Banner */}
      {status && statusCfg && (
        <div
          className={`mb-6 flex items-center gap-4 rounded-lg border p-4 ${statusCfg.bg} ${statusCfg.border}`}
        >
          <StatusIcon className={`h-8 w-8 ${statusCfg.color}`} />
          <div>
            <h3 className={`text-lg font-semibold ${statusCfg.color}`}>
              {t(`admin.mcpServer.status.${status.status}`)}
            </h3>
            <p className="text-sm text-gray-600">
              {t('admin.mcpServer.status.uptime')}:{' '}
              {formatUptime(status.uptime)}
              {' / '}
              {status.toolCount}{' '}
              {t('admin.mcpServer.status.toolCount').toLowerCase()}
              {' / '}
              {status.activeSessions}{' '}
              {t('admin.mcpServer.status.activeSessions').toLowerCase()}
            </p>
          </div>
        </div>
      )}

      {/* 24h Stats Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          title={t('admin.mcpServer.status.toolCount')}
          value={status?.toolCount ?? 0}
          icon={Wrench}
          color="blue"
        />
        <StatCard
          title={t('admin.mcpServer.status.totalCalls')}
          value={status?.metrics24h?.totalCalls ?? 0}
          icon={Zap}
          color="purple"
        />
        <StatCard
          title={t('admin.mcpServer.status.successRate')}
          value={`${(status?.metrics24h?.successRate ?? 100).toFixed(1)}%`}
          icon={CheckCircle}
          color="green"
        />
        <StatCard
          title={t('admin.mcpServer.status.avgDuration')}
          value={formatDuration(status?.metrics24h?.avgDuration ?? 0)}
          icon={Clock}
          color="amber"
        />
      </div>

      {/* Tool Quick View */}
      {status?.tools && status.tools.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            {t('admin.mcpServer.tools.title')}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {status.tools.map((tool) => {
              const toolMetrics = metrics?.byTool?.[tool.name];
              return (
                <div
                  key={tool.name}
                  className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-blue-50 p-2">
                      <Wrench className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-mono truncate text-sm font-semibold text-gray-900">
                        {tool.name}
                      </h4>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                        {tool.description}
                      </p>
                      {toolMetrics && (
                        <div className="mt-2 flex gap-3 text-xs text-gray-400">
                          <span>
                            {toolMetrics.calls}{' '}
                            {t('admin.mcpServer.tools.calls').toLowerCase()}
                          </span>
                          {toolMetrics.errors > 0 && (
                            <span className="text-red-500">
                              {toolMetrics.errors}{' '}
                              {t('admin.mcpServer.tools.errors').toLowerCase()}
                            </span>
                          )}
                          <span>{formatDuration(toolMetrics.avgDuration)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Errors */}
      {metrics?.recentErrors && metrics.recentErrors.length > 0 && (
        <div>
          <h3 className="mb-3 text-lg font-semibold text-gray-900">
            {t('admin.mcpServer.metrics.recentErrors')}
          </h3>
          <div className="rounded-lg bg-white shadow">
            <div className="overflow-x-auto">
              <Table className="w-full text-left text-sm">
                <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <Tr>
                    <Th className="px-4 py-3">
                      {t('admin.mcpServer.tools.name')}
                    </Th>
                    <Th className="px-4 py-3">
                      {t('admin.mcpServer.metrics.errorType')}
                    </Th>
                    <Th className="px-4 py-3">
                      {t('admin.mcpServer.metrics.timestamp')}
                    </Th>
                  </Tr>
                </THead>
                <TBody className="divide-y">
                  {metrics.recentErrors.map((err, i) => (
                    <Tr key={i} className="hover:bg-gray-50">
                      <Td className="font-mono px-4 py-3 text-sm text-gray-900">
                        <TruncatedCell className="max-w-[200px] text-gray-900">
                          {err.toolName}
                        </TruncatedCell>
                      </Td>
                      <Td className="px-4 py-3">
                        <span className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                          {err.errorType}
                        </span>
                      </Td>
                      <Td className="px-4 py-3 text-gray-500">
                        <TruncatedCell className="max-w-[180px] text-gray-500">
                          {formatDate(err.timestamp)}
                        </TruncatedCell>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const renderToolsTab = () => (
    <>
      {status?.tools && status.tools.length > 0 ? (
        <div className="space-y-4">
          {status.tools.map((tool) => {
            const toolMetrics = metrics?.byTool?.[tool.name];
            return (
              <div
                key={tool.name}
                className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-mono text-base font-semibold text-gray-900">
                      {tool.name}
                    </h4>
                    <p className="mt-1 text-sm text-gray-500">
                      {tool.description}
                    </p>
                  </div>
                  {toolMetrics && (
                    <div className="flex gap-4 text-right">
                      <div>
                        <p className="text-xs text-gray-400">
                          {t('admin.mcpServer.tools.calls')}
                        </p>
                        <p className="text-lg font-bold text-blue-600">
                          {toolMetrics.calls}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">
                          {t('admin.mcpServer.tools.errors')}
                        </p>
                        <p
                          className={`text-lg font-bold ${toolMetrics.errors > 0 ? 'text-red-600' : 'text-green-600'}`}
                        >
                          {toolMetrics.errors}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">
                          {t('admin.mcpServer.tools.avgDuration')}
                        </p>
                        <p className="text-lg font-bold text-purple-600">
                          {formatDuration(toolMetrics.avgDuration)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500">
          <Wrench className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          No tools registered
        </div>
      )}
    </>
  );

  const renderMetricsTab = () => (
    <>
      {metrics && metrics.totalCalls > 0 ? (
        <>
          {/* Summary Cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              title={t('admin.mcpServer.status.totalCalls')}
              value={metrics.totalCalls}
              icon={Zap}
              color="blue"
            />
            <StatCard
              title={t('admin.mcpServer.status.successRate')}
              value={`${metrics.successRate.toFixed(1)}%`}
              icon={CheckCircle}
              color="green"
            />
            <StatCard
              title={t('admin.mcpServer.status.avgDuration')}
              value={formatDuration(metrics.avgDuration)}
              icon={Clock}
              color="purple"
            />
            <StatCard
              title={t('admin.mcpServer.tools.errors')}
              value={metrics.errorCount}
              icon={AlertTriangle}
              color="red"
            />
          </div>

          {/* By Tool */}
          {Object.keys(metrics.byTool).length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-lg font-semibold text-gray-900">
                {t('admin.mcpServer.metrics.byTool')}
              </h3>
              <div className="rounded-lg bg-white shadow">
                <div className="overflow-x-auto">
                  <Table className="w-full text-left text-sm">
                    <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                      <Tr>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.tools.name')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.tools.calls')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.tools.errors')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.tools.avgDuration')}
                        </Th>
                      </Tr>
                    </THead>
                    <TBody className="divide-y">
                      {Object.entries(metrics.byTool).map(
                        ([toolName, stats]) => (
                          <Tr key={toolName} className="hover:bg-gray-50">
                            <Td className="font-mono px-4 py-3 text-sm text-gray-900">
                              <TruncatedCell className="max-w-[220px] text-gray-900">
                                {toolName}
                              </TruncatedCell>
                            </Td>
                            <Td className="px-4 py-3 font-bold text-blue-600">
                              {stats.calls}
                            </Td>
                            <Td
                              className={`px-4 py-3 font-bold ${stats.errors > 0 ? 'text-red-600' : 'text-green-600'}`}
                            >
                              {stats.errors}
                            </Td>
                            <Td className="px-4 py-3 text-purple-600">
                              {formatDuration(stats.avgDuration)}
                            </Td>
                          </Tr>
                        )
                      )}
                    </TBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {/* By API Key */}
          {Object.keys(metrics.byApiKey).length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-lg font-semibold text-gray-900">
                {t('admin.mcpServer.metrics.byApiKey')}
              </h3>
              <div className="rounded-lg bg-white shadow">
                <div className="overflow-x-auto">
                  <Table className="w-full text-left text-sm">
                    <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                      <Tr>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.metrics.apiKey')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.tools.calls')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.metrics.lastUsed')}
                        </Th>
                      </Tr>
                    </THead>
                    <TBody className="divide-y">
                      {Object.entries(metrics.byApiKey).map(
                        ([apiKey, stats]) => (
                          <Tr key={apiKey} className="hover:bg-gray-50">
                            <Td className="font-mono px-4 py-3 text-sm text-gray-900">
                              <div className="flex items-center gap-2">
                                <Key className="h-4 w-4 shrink-0 text-gray-400" />
                                <TruncatedCell className="max-w-[200px] text-gray-900">
                                  {apiKey}
                                </TruncatedCell>
                              </div>
                            </Td>
                            <Td className="px-4 py-3 font-bold text-blue-600">
                              {stats.calls}
                            </Td>
                            <Td className="px-4 py-3 text-gray-500">
                              <TruncatedCell className="max-w-[180px] text-gray-500">
                                {formatDate(stats.lastUsed)}
                              </TruncatedCell>
                            </Td>
                          </Tr>
                        )
                      )}
                    </TBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {/* Recent Errors */}
          {metrics.recentErrors.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold text-gray-900">
                {t('admin.mcpServer.metrics.recentErrors')}
              </h3>
              <div className="rounded-lg bg-white shadow">
                <div className="overflow-x-auto">
                  <Table className="w-full text-left text-sm">
                    <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                      <Tr>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.tools.name')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.metrics.errorType')}
                        </Th>
                        <Th className="px-4 py-3">
                          {t('admin.mcpServer.metrics.timestamp')}
                        </Th>
                      </Tr>
                    </THead>
                    <TBody className="divide-y">
                      {metrics.recentErrors.map((err, i) => (
                        <Tr key={i} className="hover:bg-gray-50">
                          <Td className="font-mono px-4 py-3 text-sm text-gray-900">
                            <TruncatedCell className="max-w-[200px] text-gray-900">
                              {err.toolName}
                            </TruncatedCell>
                          </Td>
                          <Td className="px-4 py-3">
                            <span className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                              {err.errorType}
                            </span>
                          </Td>
                          <Td className="px-4 py-3 text-gray-500">
                            <TruncatedCell className="max-w-[180px] text-gray-500">
                              {formatDate(err.timestamp)}
                            </TruncatedCell>
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500">
          <Server className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          {t('admin.mcpServer.metrics.noData')}
        </div>
      )}
    </>
  );

  const renderSessionsTab = () => (
    <>
      {sessions.length > 0 ? (
        <div className="rounded-lg bg-white shadow">
          <div className="overflow-x-auto">
            <Table className="w-full text-left text-sm">
              <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <Tr>
                  <Th className="px-4 py-3">
                    {t('admin.mcpServer.sessions.sessionId')}
                  </Th>
                  <Th className="px-4 py-3">
                    {t('admin.mcpServer.sessions.client')}
                  </Th>
                  <Th className="px-4 py-3">
                    {t('admin.mcpServer.sessions.createdAt')}
                  </Th>
                </Tr>
              </THead>
              <TBody className="divide-y">
                {sessions.map((session) => (
                  <Tr key={session.sessionId} className="hover:bg-gray-50">
                    <Td className="font-mono px-4 py-3 text-xs text-gray-900">
                      <TruncatedCell className="max-w-[220px] text-gray-900">
                        {session.sessionId}
                      </TruncatedCell>
                    </Td>
                    <Td className="px-4 py-3">
                      {session.clientInfo ? (
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 shrink-0 text-gray-400" />
                          <TruncatedCell className="max-w-[160px] text-gray-900">
                            {session.clientInfo.name}
                          </TruncatedCell>
                          <span className="shrink-0 text-xs text-gray-400">
                            v{session.clientInfo.version}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </Td>
                    <Td className="px-4 py-3 text-gray-500">
                      <TruncatedCell className="max-w-[180px] text-gray-500">
                        {formatDate(session.createdAt)}
                      </TruncatedCell>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500">
          <Users className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          {t('admin.mcpServer.sessions.noSessions')}
        </div>
      )}
    </>
  );

  // ==================== API Keys Helpers ====================

  function generateApiKey(): string {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    // base64url encode
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function handleCreateApiKey() {
    if (!newKeyName.trim()) return;
    const key = generateApiKey();
    const result = await createSecret({
      name: `mcp-key-${Date.now()}`,
      displayName: newKeyName.trim(),
      value: key,
      category: 'MCP',
      description: 'MCP API Key',
    });
    if (result) {
      setGeneratedKey(key);
    }
  }

  async function handleDeleteApiKey(secret: {
    name: string;
    displayName: string;
  }) {
    const message = t('admin.mcpServer.apiKeys.deleteConfirm').replace(
      '{{name}}',
      secret.displayName
    );
    if (!(await confirm({ title: message, type: 'danger' }))) return;
    await deleteSecret(secret.name);
    setRevealedKeys((prev) => {
      const next = { ...prev };
      delete next[secret.name];
      return next;
    });
  }

  async function handleRevealKey(name: string) {
    if (revealedKeys[name]) {
      setRevealedKeys((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      return;
    }
    setRevealingKey(name);
    const value = await getSecretValue(name);
    if (value) {
      setRevealedKeys((prev) => ({ ...prev, [name]: value }));
    }
    setRevealingKey(null);
  }

  function handleCloseCreateModal() {
    setShowCreateModal(false);
    setNewKeyName('');
    setGeneratedKey(null);
    setCopiedKey(false);
  }

  async function handleCopyKey(text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  const connectionConfigExample = `{
  "plugins": {
    "entries": {
      "mcp-adapter": {
        "enabled": true,
        "config": {
          "servers": [{
            "name": "genesis",
            "transport": "http",
            "url": "https://<your-domain>/api/v1/mcp",
            "headers": {
              "Authorization": "Bearer <your-api-key>"
            }
          }]
        }
      }
    }
  }
}`;

  const renderApiKeysTab = () => (
    <>
      {/* Header with Generate button */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {t('admin.mcpServer.apiKeys.title')}
          </h3>
          <p className="text-sm text-gray-500">
            {t('admin.mcpServer.apiKeys.description')}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          {t('admin.mcpServer.apiKeys.generate')}
        </button>
      </div>

      {/* API Key List Table */}
      {mcpApiKeys.length > 0 ? (
        <div className="mb-6 rounded-lg bg-white shadow">
          <div className="overflow-x-auto">
            <Table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[28%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[18%]" />
                <col className="w-[14%]" />
              </colgroup>
              <THead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <Tr>
                  <Th className="px-4 py-3">
                    {t('admin.mcpServer.apiKeys.name')}
                  </Th>
                  <Th className="px-4 py-3">
                    {t('admin.mcpServer.apiKeys.key')}
                  </Th>
                  <Th className="px-4 py-3">
                    {t('admin.mcpServer.apiKeys.status')}
                  </Th>
                  <Th className="px-4 py-3">
                    {t('admin.mcpServer.apiKeys.usage')}
                  </Th>
                  <Th className="px-4 py-3">
                    {t('admin.mcpServer.apiKeys.lastUsed')}
                  </Th>
                  <Th className="px-4 py-3">
                    {t('admin.mcpServer.apiKeys.actions')}
                  </Th>
                </Tr>
              </THead>
              <TBody className="divide-y">
                {mcpApiKeys.map((secret) => {
                  const keyUsage = metrics?.byApiKey?.[secret.maskedValue];
                  return (
                    <Tr key={secret.id} className="hover:bg-gray-50">
                      <Td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 shrink-0 text-gray-400" />
                          <TruncatedCell className="max-w-[160px] font-medium text-gray-900">
                            {secret.displayName}
                          </TruncatedCell>
                        </div>
                      </Td>
                      <Td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600">
                            {revealedKeys[secret.name] ?? secret.maskedValue}
                          </code>
                          <button
                            onClick={() => handleRevealKey(secret.name)}
                            disabled={revealingKey === secret.name}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            title={t('admin.mcpServer.apiKeys.reveal')}
                          >
                            {revealedKeys[secret.name] ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {revealedKeys[secret.name] && (
                            <button
                              onClick={() =>
                                handleCopyKey(revealedKeys[secret.name])
                              }
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </Td>
                      <Td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            secret.isActive
                              ? 'bg-green-50 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {secret.isActive
                            ? t('admin.mcpServer.apiKeys.active')
                            : t('admin.mcpServer.apiKeys.inactive')}
                        </span>
                      </Td>
                      <Td className="px-4 py-3 text-gray-600">
                        {keyUsage?.calls ?? secret.accessCount ?? 0}
                      </Td>
                      <Td className="px-4 py-3 text-gray-500">
                        {keyUsage?.lastUsed
                          ? formatDate(keyUsage.lastUsed)
                          : secret.lastAccessedAt
                            ? formatDate(secret.lastAccessedAt)
                            : t('admin.mcpServer.apiKeys.never')}
                      </Td>
                      <Td className="px-4 py-3">
                        <button
                          onClick={() => handleDeleteApiKey(secret)}
                          disabled={isDeleting}
                          className="rounded p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500">
          <Key className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          {t('admin.mcpServer.apiKeys.noKeys')}
        </div>
      )}

      {/* Connection Config Example */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h4 className="mb-1 text-sm font-semibold text-gray-900">
          {t('admin.mcpServer.apiKeys.connectionConfig')}
        </h4>
        <p className="mb-3 text-xs text-gray-500">
          {t('admin.mcpServer.apiKeys.connectionConfigDesc')}
        </p>
        <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">
          <code>{connectionConfigExample}</code>
        </pre>
      </div>

      {/* Create Modal */}
      <Modal
        open={showCreateModal}
        onClose={handleCloseCreateModal}
        title={t('admin.mcpServer.apiKeys.createTitle')}
        size="md"
        footer={
          !generatedKey ? (
            <>
              <button
                onClick={handleCloseCreateModal}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('common.cancel') || 'Cancel'}
              </button>
              <button
                onClick={() => void handleCreateApiKey()}
                disabled={!newKeyName.trim() || isCreating}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t('admin.mcpServer.apiKeys.create')}
              </button>
            </>
          ) : (
            <button
              onClick={handleCloseCreateModal}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              {t('common.close') || 'Close'}
            </button>
          )
        }
      >
        {!generatedKey ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.mcpServer.apiKeys.displayName')}
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t('admin.mcpServer.apiKeys.displayNamePlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateApiKey();
              }}
            />
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.mcpServer.apiKeys.generatedKey')}
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
                {generatedKey}
              </code>
              <button
                onClick={() => void handleCopyKey(generatedKey)}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedKey
                  ? t('admin.mcpServer.apiKeys.copied')
                  : t('common.copy') || 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-600">
              {t('admin.mcpServer.apiKeys.copyWarning')}
            </p>
          </div>
        )}
      </Modal>
    </>
  );

  // ==================== External MCP Helpers ====================

  function resetExternalForm() {
    setExternalForm({
      serverId: '',
      name: '',
      description: '',
      transport: 'sse',
      url: '',
      enabled: true,
      autoConnect: false,
    });
  }

  function openAddExternalModal() {
    resetExternalForm();
    setEditingExternal(null);
    setShowAddExternalModal(true);
  }

  function openEditExternalModal(server: ExternalMCPServer) {
    setExternalForm({
      serverId: server.serverId,
      name: server.name,
      description: server.description ?? '',
      transport: server.transport,
      url: server.url ?? '',
      enabled: server.enabled,
      autoConnect: server.autoConnect,
    });
    setEditingExternal(server);
    setShowAddExternalModal(true);
  }

  function closeExternalModal() {
    setShowAddExternalModal(false);
    setEditingExternal(null);
    resetExternalForm();
  }

  async function handleSaveExternalServer() {
    if (
      !externalForm.serverId.trim() ||
      !externalForm.name.trim() ||
      !externalForm.url.trim()
    )
      return;
    try {
      if (editingExternal) {
        await updateExternalServer(editingExternal.id, {
          name: externalForm.name,
          description: externalForm.description || undefined,
          transport: externalForm.transport,
          url: externalForm.url,
          enabled: externalForm.enabled,
          autoConnect: externalForm.autoConnect,
        });
      } else {
        await addExternalServer({
          serverId: externalForm.serverId,
          name: externalForm.name,
          description: externalForm.description || undefined,
          transport: externalForm.transport,
          url: externalForm.url,
          enabled: externalForm.enabled,
          autoConnect: externalForm.autoConnect,
        });
      }
      closeExternalModal();
    } catch {
      // Error handled by hook
    }
  }

  async function handleDeleteExternalServer(server: ExternalMCPServer) {
    if (
      !(await confirm({
        title: `Remove external MCP server "${server.name}"?`,
        type: 'danger',
      }))
    )
      return;
    await removeExternalServer(server.id);
  }

  async function handleViewExternalTools(server: ExternalMCPServer) {
    if (viewingToolsServer === server.id) {
      setViewingToolsServer(null);
      setDiscoveredTools([]);
      return;
    }
    try {
      setViewingToolsServer(server.id);
      const tools = await listExternalTools(server.id);
      setDiscoveredTools(tools);
    } catch {
      setDiscoveredTools([]);
    }
  }

  function getConnectionStatusBadge(
    status: ExternalMCPServer['connectionStatus']['status']
  ) {
    switch (status) {
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            {t('admin.mcpExternal.status.connected') || 'Connected'}
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            {t('admin.mcpExternal.status.error') || 'Error'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
            {t('admin.mcpExternal.status.disconnected') || 'Disconnected'}
          </span>
        );
    }
  }

  const renderExternalTab = () => (
    <>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {t('admin.mcpExternal.title') || 'External MCP Servers'}
          </h3>
          <p className="text-sm text-gray-500">
            {t('admin.mcpExternal.description') ||
              'Connect to external MCP servers to extend available tools'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refetchExternal()}
            className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={openAddExternalModal}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            {t('admin.mcpExternal.addServer') || 'Add Server'}
          </button>
        </div>
      </div>

      {/* Server List */}
      {externalLoading ? (
        <div className="p-8 text-center text-gray-500">
          {t('common.loading') || 'Loading...'}
        </div>
      ) : externalServers.length > 0 ? (
        <div className="space-y-4">
          {externalServers.map((server) => (
            <div
              key={server.id}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <Globe className="h-5 w-5 shrink-0 text-blue-500" />
                    <h4 className="truncate text-base font-semibold text-gray-900">
                      {server.name}
                    </h4>
                    {getConnectionStatusBadge(server.connectionStatus.status)}
                    {!server.enabled && (
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-500">
                        {t('admin.mcpExternal.disabled') || 'Disabled'}
                      </span>
                    )}
                  </div>
                  {server.description && (
                    <p className="mt-1 text-sm text-gray-500">
                      {server.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-400">
                    <span>
                      ID:{' '}
                      <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-600">
                        {server.serverId}
                      </code>
                    </span>
                    <span>
                      Transport:{' '}
                      <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-600">
                        {server.transport}
                      </code>
                    </span>
                    {server.url && (
                      <span className="truncate">
                        URL:{' '}
                        <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-600">
                          {server.url}
                        </code>
                      </span>
                    )}
                    {server.autoConnect && (
                      <span className="text-blue-500">Auto-connect</span>
                    )}
                  </div>
                  {server.connectionStatus.error && (
                    <p className="mt-2 rounded bg-red-50 px-3 py-1.5 text-xs text-red-600">
                      {server.connectionStatus.error}
                    </p>
                  )}
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  {server.connectionStatus.status === 'connected' ? (
                    <>
                      <button
                        onClick={() => void handleViewExternalTools(server)}
                        disabled={externalActionLoading}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        title={t('admin.mcpExternal.viewTools') || 'View Tools'}
                      >
                        <Wrench className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => void disconnectExternalServer(server.id)}
                        disabled={externalActionLoading}
                        className="flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50"
                        title={
                          t('admin.mcpExternal.disconnect') || 'Disconnect'
                        }
                      >
                        <PowerOff className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => void connectExternalServer(server.id)}
                      disabled={externalActionLoading || !server.enabled}
                      className="flex items-center gap-1 rounded-lg border border-green-300 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                      title={t('admin.mcpExternal.connect') || 'Connect'}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => openEditExternalModal(server)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    title={t('common.edit') || 'Edit'}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => void handleDeleteExternalServer(server)}
                    disabled={externalActionLoading}
                    className="rounded p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
                    title={t('common.delete') || 'Delete'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Discovered Tools Panel */}
              {viewingToolsServer === server.id && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <h5 className="mb-2 text-sm font-medium text-gray-700">
                    {t('admin.mcpExternal.discoveredTools') ||
                      'Discovered Tools'}{' '}
                    ({discoveredTools.length})
                  </h5>
                  {discoveredTools.length > 0 ? (
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                      {discoveredTools.map((tool) => (
                        <div
                          key={tool.name}
                          className="rounded-lg border border-gray-100 bg-gray-50 p-3"
                        >
                          <h6 className="font-mono truncate text-xs font-semibold text-gray-800">
                            {tool.name}
                          </h6>
                          <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                            {tool.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">
                      {t('admin.mcpExternal.noTools') || 'No tools discovered'}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-gray-50 p-8 text-center text-sm text-gray-500">
          <Globe className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          {t('admin.mcpExternal.noServers') ||
            'No external MCP servers configured'}
        </div>
      )}

      {/* Add/Edit External Server Modal */}
      <Modal
        open={showAddExternalModal}
        onClose={closeExternalModal}
        title={
          editingExternal
            ? t('admin.mcpExternal.editServer') || 'Edit External Server'
            : t('admin.mcpExternal.addServer') || 'Add External Server'
        }
        size="md"
        footer={
          <>
            <button
              onClick={closeExternalModal}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('common.cancel') || 'Cancel'}
            </button>
            <button
              onClick={() => void handleSaveExternalServer()}
              disabled={
                !externalForm.serverId.trim() ||
                !externalForm.name.trim() ||
                !externalForm.url.trim() ||
                externalActionLoading
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {editingExternal
                ? t('common.save') || 'Save'
                : t('admin.mcpExternal.addServer') || 'Add Server'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Server ID */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.mcpExternal.form.serverId') || 'Server ID'}
            </label>
            <input
              type="text"
              value={externalForm.serverId}
              onChange={(e) =>
                setExternalForm((f) => ({ ...f, serverId: e.target.value }))
              }
              disabled={!!editingExternal}
              placeholder="my-external-tools"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>

          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.mcpExternal.form.name') || 'Name'}
            </label>
            <input
              type="text"
              value={externalForm.name}
              onChange={(e) =>
                setExternalForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="My External Tools Server"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.mcpExternal.form.description') || 'Description'}
            </label>
            <input
              type="text"
              value={externalForm.description}
              onChange={(e) =>
                setExternalForm((f) => ({
                  ...f,
                  description: e.target.value,
                }))
              }
              placeholder="Optional description"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Transport */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.mcpExternal.form.transport') || 'Transport'}
            </label>
            <select
              value={externalForm.transport}
              onChange={(e) =>
                setExternalForm((f) => ({
                  ...f,
                  transport: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="sse">SSE</option>
              <option value="http">HTTP (Streamable)</option>
            </select>
          </div>

          {/* URL */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('admin.mcpExternal.form.url') || 'Server URL'}
            </label>
            <input
              type="url"
              value={externalForm.url}
              onChange={(e) =>
                setExternalForm((f) => ({ ...f, url: e.target.value }))
              }
              placeholder="https://mcp.example.com/sse"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Toggles */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={externalForm.enabled}
                onChange={(e) =>
                  setExternalForm((f) => ({
                    ...f,
                    enabled: e.target.checked,
                  }))
                }
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              {t('admin.mcpExternal.form.enabled') || 'Enabled'}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={externalForm.autoConnect}
                onChange={(e) =>
                  setExternalForm((f) => ({
                    ...f,
                    autoConnect: e.target.checked,
                  }))
                }
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              {t('admin.mcpExternal.form.autoConnect') || 'Auto-connect'}
            </label>
          </div>
        </div>
      </Modal>
    </>
  );

  const tabs = [
    'overview',
    'tools',
    'metrics',
    'sessions',
    'apiKeys',
    'external',
  ] as const;

  const refreshAction = (
    <button
      onClick={() => void fetchData()}
      className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
    >
      <RefreshCw className="h-4 w-4" />
      {t('common.refresh') || 'Refresh'}
    </button>
  );

  const body = (
    <div>
      {embedded && <div className="mb-4 flex justify-end">{refreshAction}</div>}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}

      {/* Tabs */}
      <Tabs
        className="mb-6"
        items={tabs.map((tab) => ({
          key: tab,
          label: t(`admin.mcpServer.tabs.${tab}`),
        }))}
        value={activeTab}
        onChange={(k) => setActiveTab(k as typeof activeTab)}
      />

      {loading ? (
        <div className="p-8 text-center text-gray-500">
          {t('common.loading')}
        </div>
      ) : (
        <>
          {activeTab === 'overview' && renderOverviewTab()}
          {activeTab === 'tools' && renderToolsTab()}
          {activeTab === 'metrics' && renderMetricsTab()}
          {activeTab === 'sessions' && renderSessionsTab()}
          {activeTab === 'apiKeys' && renderApiKeysTab()}
          {activeTab === 'external' && renderExternalTab()}
        </>
      )}
    </div>
  );

  // ★ 2026-05-12: 嵌入模式 (/admin/system?tab=settings 内) 跳过外层 AdminPageLayout.
  if (embedded) return body;

  return (
    <AdminPageLayout
      title={t('admin.mcpServer.title')}
      description={t('admin.mcpServer.description')}
      icon={Radio}
      domain="system"
      actions={refreshAction}
    >
      {body}
    </AdminPageLayout>
  );
}
