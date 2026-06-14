'use client';

import { useState, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import {
  HardDrive,
  FileText,
  Bookmark,
  StickyNote,
  Image as ImageIcon,
  RefreshCw,
  Loader2,
  FolderOpen,
  Zap,
  Sparkles,
  Plug,
} from 'lucide-react';
import RAGStatusIndicator, {
  RAGServiceStatus,
} from '../knowledge-base/RAGStatusIndicator';
import FeishuDataSourcePanel from '../import-panels/FeishuDataSourcePanel';
import ConnectorCard from './ConnectorCard';
import ContentSummaryCard from './ContentSummaryCard';
import SectionTitle from '../_design/SectionTitle';
import {
  CONNECTOR_STATUS_TOKENS,
  type ConnectorState,
} from '../_design/tokens';
import { type VerticalNavGroup } from '../../ui/nav';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils/common';

import { logger } from '@/lib/utils/logger';

type DataSourceSubTab =
  | 'overview'
  | 'bookmarks'
  | 'notes'
  | 'images'
  | 'notion'
  | 'google-drive'
  | 'feishu';

interface DataSourcesTabProps {
  initialSubTab?: DataSourceSubTab;
  onSubTabChange?: (subTab: DataSourceSubTab) => void;
  renderBookmarks?: () => React.ReactNode;
  renderNotes?: () => React.ReactNode;
  renderImages?: () => React.ReactNode;
  renderNotion?: () => React.ReactNode;
  renderGoogleDrive?: () => React.ReactNode;
  renderFeishu?: () => React.ReactNode;
  /** AI 整理面板（仅书签 / 笔记 / 图片），渲染在内容列表上方 */
  renderOrganizePanel?: (
    subTab: 'bookmarks' | 'notes' | 'images'
  ) => React.ReactNode;
  /** 用户内容计数（书签 / 笔记 / 图片）— 由 page.tsx 透传 */
  contentCounts?: {
    bookmarks?: number;
    notes?: number;
    images?: number;
  };
}

interface DataSourceStatus {
  type: string;
  isConnected: boolean;
  lastSyncAt?: string;
  itemCount?: number;
  lastError?: string;
  needsReauth?: boolean;
  account?: string;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return '刚刚同步';
  if (diffMins < 60) return `${diffMins} 分钟前同步`;
  if (diffHours < 24) return `${diffHours} 小时前同步`;
  return `${diffDays} 天前同步`;
}

function deriveConnectorState(s: DataSourceStatus | undefined): ConnectorState {
  if (!s) return 'disconnected';
  if (s.needsReauth) return 'needs_reauth';
  if (s.lastError) return 'error';
  if (s.isConnected) return 'connected';
  return 'disconnected';
}

/** 真实的 OAuth 外部连接器（仅用于"X / N 已连接"分母） */
const EXTERNAL_CONNECTORS = ['GOOGLE_DRIVE', 'NOTION', 'FEISHU'] as const;

// ─── API 响应类型 ──────────────────────────────────────────
interface EmbeddingConfigResponse {
  modelId?: string;
  provider?: string;
  dimensions?: number;
}

interface GoogleDriveConnectionPayload {
  status?: string;
  lastSyncAt?: string;
  email?: string;
  lastError?: string;
}
interface GoogleDriveConnectionResponse {
  data?: { connection?: GoogleDriveConnectionPayload };
  connection?: GoogleDriveConnectionPayload;
}

interface NotionConnectionPayload {
  workspaceName?: string;
}
interface NotionConnectionsResponse {
  data?: { connections?: NotionConnectionPayload[] };
  connections?: NotionConnectionPayload[];
}

interface FeishuStatusPayload {
  isConnected?: boolean;
  stats?: { totalItems?: number };
  tenantName?: string;
}
interface FeishuStatusResponse {
  data?: FeishuStatusPayload;
  isConnected?: boolean;
  stats?: { totalItems?: number };
  tenantName?: string;
}

/**
 * Data Sources Tab — 数据源中心 (Connections Hub)
 * 三段式：我的内容 → 外部连接 → 可添加
 */
export default function DataSourcesTab({
  initialSubTab = 'overview',
  onSubTabChange,
  renderBookmarks,
  renderNotes,
  renderImages,
  renderNotion,
  renderGoogleDrive,
  renderFeishu,
  renderOrganizePanel,
  contentCounts,
}: DataSourcesTabProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [activeSubTab, setActiveSubTab] =
    useState<DataSourceSubTab>(initialSubTab);

  useEffect(() => {
    onSubTabChange?.(activeSubTab);
  }, [activeSubTab, onSubTabChange]);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [dataSourceStatuses, setDataSourceStatuses] = useState<
    Record<string, DataSourceStatus>
  >({});
  const [ragServiceStatus, setRagServiceStatus] = useState<RAGServiceStatus>({
    embedding: { status: 'loading' },
    database: { status: 'loading' },
  });

  const fetchRAGServiceStatus = async () => {
    try {
      const embeddingResponse = await fetch(
        `${config.apiUrl}/rag/embedding-config`,
        { headers: { ...getAuthHeader() } }
      );
      if (embeddingResponse.ok) {
        const embeddingData =
          (await embeddingResponse.json()) as EmbeddingConfigResponse;
        setRagServiceStatus((prev) => ({
          ...prev,
          embedding: {
            status: 'ok',
            modelId: embeddingData.modelId,
            provider: embeddingData.provider,
            dimensions: embeddingData.dimensions,
          },
        }));
      } else {
        setRagServiceStatus((prev) => ({
          ...prev,
          embedding: {
            status: 'error',
            error: t('dataSources.errors.embeddingConfigFailed'),
          },
        }));
      }
    } catch {
      setRagServiceStatus((prev) => ({
        ...prev,
        embedding: {
          status: 'error',
          error: t('dataSources.errors.embeddingConnectionFailed'),
        },
      }));
    }

    setRagServiceStatus((prev) => ({
      ...prev,
      database: { status: 'ok' },
    }));
  };

  useEffect(() => {
    void fetchDataSourceStatuses();
    void fetchRAGServiceStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDataSourceStatuses = async () => {
    setLoading(true);
    try {
      const statuses: Record<string, DataSourceStatus> = {};

      // Google Drive
      try {
        const gdResponse = await fetch(
          `${config.apiUrl}/google-drive/connection`,
          { headers: { ...getAuthHeader() } }
        );
        if (gdResponse.ok) {
          const gdData =
            (await gdResponse.json()) as GoogleDriveConnectionResponse;
          const connection = gdData.data?.connection ?? gdData.connection;
          const isActive = !!connection && connection.status === 'ACTIVE';
          const needsReauth = !!connection && !isActive;
          statuses['GOOGLE_DRIVE'] = {
            type: 'GOOGLE_DRIVE',
            isConnected: isActive,
            lastSyncAt: connection?.lastSyncAt,
            account: connection?.email,
            lastError: needsReauth
              ? connection?.lastError || t('dataSources.errors.authExpired')
              : undefined,
            needsReauth,
          };
        } else {
          statuses['GOOGLE_DRIVE'] = {
            type: 'GOOGLE_DRIVE',
            isConnected: false,
          };
        }
      } catch {
        statuses['GOOGLE_DRIVE'] = {
          type: 'GOOGLE_DRIVE',
          isConnected: false,
        };
      }

      // Notion
      try {
        const notionResponse = await fetch(
          `${config.apiUrl}/notion/connections`,
          { headers: { ...getAuthHeader() } }
        );
        if (notionResponse.ok) {
          const notionData =
            (await notionResponse.json()) as NotionConnectionsResponse;
          const connections =
            notionData.data?.connections ?? notionData.connections ?? [];
          const hasConnections = connections.length > 0;
          statuses['NOTION'] = {
            type: 'NOTION',
            isConnected: hasConnections,
            itemCount: connections.length,
            account: connections[0]?.workspaceName,
          };
        } else {
          statuses['NOTION'] = { type: 'NOTION', isConnected: false };
        }
      } catch {
        statuses['NOTION'] = { type: 'NOTION', isConnected: false };
      }

      // Feishu
      try {
        const feishuResponse = await fetch(
          `${config.apiUrl}/feishu-data-source/status`,
          { headers: { ...getAuthHeader() } }
        );
        if (feishuResponse.ok) {
          const feishuData =
            (await feishuResponse.json()) as FeishuStatusResponse;
          const feishuPayload: FeishuStatusPayload =
            feishuData.data ?? feishuData;
          statuses['FEISHU'] = {
            type: 'FEISHU',
            isConnected: feishuPayload.isConnected === true,
            itemCount: feishuPayload.stats?.totalItems || 0,
            account: feishuPayload.tenantName,
          };
        } else {
          statuses['FEISHU'] = { type: 'FEISHU', isConnected: false };
        }
      } catch {
        statuses['FEISHU'] = { type: 'FEISHU', isConnected: false };
      }

      setDataSourceStatuses(statuses);
    } catch (error) {
      logger.error('Failed to fetch data source statuses:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (type: string) => {
    setSyncing(type);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await fetchDataSourceStatuses();
    } catch (error) {
      logger.error(`Failed to sync ${type}:`, error);
    } finally {
      setSyncing(null);
    }
  };

  // 连接器状态点（复用 CONNECTOR_STATUS_TOKENS 的 dot 配色）
  const connectorDot = (type: string) => {
    const state = deriveConnectorState(dataSourceStatuses[type]);
    return (
      <span
        className={`h-1.5 w-1.5 rounded-full ${CONNECTOR_STATUS_TOKENS[state].dot}`}
      />
    );
  };

  // 左侧二级菜单：概览（独立）→ 我的内容 → 外部连接（与概览页分段语义一致）
  const navGroups: VerticalNavGroup[] = [
    {
      items: [
        {
          key: 'overview',
          label: t('dataSources.tabs.overview'),
          icon: FolderOpen,
        },
      ],
    },
    {
      title: '我的内容',
      items: [
        {
          key: 'bookmarks',
          label: t('dataSources.tabs.bookmarks'),
          icon: Bookmark,
          count: contentCounts?.bookmarks,
        },
        {
          key: 'notes',
          label: t('dataSources.tabs.notes'),
          icon: StickyNote,
          count: contentCounts?.notes,
        },
        {
          key: 'images',
          label: t('dataSources.tabs.images'),
          icon: ImageIcon,
          count: contentCounts?.images,
        },
      ],
    },
    {
      title: '外部连接',
      items: [
        {
          key: 'notion',
          label: 'Notion',
          icon: FileText,
          trailing: connectorDot('NOTION'),
        },
        {
          key: 'google-drive',
          label: 'Google Drive',
          icon: HardDrive,
          trailing: connectorDot('GOOGLE_DRIVE'),
        },
        {
          key: 'feishu',
          label: '飞书',
          icon: Zap,
          trailing: connectorDot('FEISHU'),
        },
      ],
    },
  ];

  // 书签 / 笔记 / 图片：AI 整理面板置于列表上方
  const withOrganize = (
    subTab: 'bookmarks' | 'notes' | 'images',
    content: React.ReactNode
  ) => (
    <div className="space-y-5">
      {renderOrganizePanel?.(subTab)}
      {content}
    </div>
  );

  const renderSubTabContent = () => {
    switch (activeSubTab) {
      case 'bookmarks':
        return withOrganize('bookmarks', renderBookmarks?.() ?? null);
      case 'notes':
        return withOrganize('notes', renderNotes?.() ?? null);
      case 'images':
        return withOrganize('images', renderImages?.() ?? null);
      case 'notion':
        return renderNotion ? renderNotion() : null;
      case 'google-drive':
        return renderGoogleDrive ? renderGoogleDrive() : null;
      case 'feishu':
        return renderFeishu ? renderFeishu() : <FeishuDataSourcePanel />;
      default:
        return renderOverview();
    }
  };

  const renderOverview = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
        </div>
      );
    }

    const gdStatus = dataSourceStatuses['GOOGLE_DRIVE'];
    const notionStatus = dataSourceStatuses['NOTION'];
    const feishuStatus = dataSourceStatuses['FEISHU'];

    const connectedCount = EXTERNAL_CONNECTORS.filter(
      (key) => dataSourceStatuses[key]?.isConnected
    ).length;

    return (
      <div className="space-y-6">
        {/* Hub overview bar */}
        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-gradient-to-r from-violet-50/40 via-white to-purple-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm">
              <Plug className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">数据源中心</p>
              <p className="mt-0.5 text-xs text-gray-500">
                <span className="font-medium text-gray-700">
                  {connectedCount}
                </span>{' '}
                / {EXTERNAL_CONNECTORS.length} 已连接 ·{' '}
                <span className="font-medium text-gray-700">
                  {(contentCounts?.bookmarks ?? 0) +
                    (contentCounts?.notes ?? 0) +
                    (contentCounts?.images ?? 0)}
                </span>{' '}
                项已收录
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RAGStatusIndicator
              status={ragServiceStatus}
              onRefresh={() => {
                void fetchRAGServiceStatus();
              }}
            />
            <button
              onClick={() => {
                void fetchDataSourceStatuses();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </button>
          </div>
        </div>

        {/* Section 1: 我的内容 */}
        <section>
          <SectionTitle
            icon={Sparkles}
            title="我的内容"
            description="在 Genesis 内创建或收藏的资源"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ContentSummaryCard
              icon={Bookmark}
              iconBg="bg-orange-50 text-orange-600"
              name="书签"
              count={contentCounts?.bookmarks ?? 0}
              caption="从 Explore 页面收藏"
              onClick={() => setActiveSubTab('bookmarks')}
            />
            <ContentSummaryCard
              icon={StickyNote}
              iconBg="bg-amber-50 text-amber-600"
              name="笔记"
              count={contentCounts?.notes ?? 0}
              caption="个人笔记与摘录"
              onClick={() => setActiveSubTab('notes')}
            />
            <ContentSummaryCard
              icon={ImageIcon}
              iconBg="bg-pink-50 text-pink-600"
              name="图片"
              count={contentCounts?.images ?? 0}
              caption="收藏的图片素材"
              onClick={() => setActiveSubTab('images')}
            />
          </div>
        </section>

        {/* Section 2: 外部连接 */}
        <section>
          <SectionTitle
            icon={Plug}
            title="外部连接"
            description="授权第三方平台，自动同步内容到知识库"
            count={connectedCount}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ConnectorCard
              icon={HardDrive}
              iconBg="bg-emerald-50 text-emerald-600"
              name="Google Drive"
              description="同步 Drive 文件、文件夹"
              account={
                gdStatus?.isConnected ? gdStatus.account || '已连接' : undefined
              }
              state={deriveConnectorState(gdStatus)}
              metrics={
                gdStatus?.isConnected
                  ? [
                      { value: gdStatus.itemCount ?? '—', label: '文件' },
                      { value: '—', label: '文件夹' },
                      { value: '自动', label: '同步' },
                    ]
                  : undefined
              }
              lastSyncLabel={
                gdStatus?.lastSyncAt
                  ? formatRelativeTime(gdStatus.lastSyncAt)
                  : undefined
              }
              errorMessage={gdStatus?.lastError}
              syncing={syncing === 'GOOGLE_DRIVE'}
              onBrowse={() => setActiveSubTab('google-drive')}
              onSync={() => {
                void handleSync('GOOGLE_DRIVE');
              }}
              onSettings={() => {
                router.push('/me/integrations');
              }}
              onConnect={() => {
                router.push('/me/integrations');
              }}
            />

            <ConnectorCard
              icon={FileText}
              iconBg="bg-gray-100 text-gray-700"
              name="Notion"
              description="同步 Notion 页面与数据库"
              account={
                notionStatus?.isConnected
                  ? notionStatus.account || '已连接'
                  : undefined
              }
              state={deriveConnectorState(notionStatus)}
              metrics={
                notionStatus?.isConnected
                  ? [
                      { value: notionStatus.itemCount ?? '—', label: '工作区' },
                      { value: '—', label: '页面' },
                      { value: '自动', label: '同步' },
                    ]
                  : undefined
              }
              syncing={syncing === 'NOTION'}
              onBrowse={() => setActiveSubTab('notion')}
              onSync={() => {
                void handleSync('NOTION');
              }}
              onSettings={() => {
                router.push('/me/integrations');
              }}
              onConnect={() => {
                router.push('/me/integrations');
              }}
            />

            <ConnectorCard
              icon={Zap}
              iconBg="bg-blue-50 text-blue-600"
              name="飞书"
              description="同步飞书云文档与知识空间"
              account={
                feishuStatus?.isConnected
                  ? feishuStatus.account || '已连接'
                  : undefined
              }
              state={deriveConnectorState(feishuStatus)}
              metrics={
                feishuStatus?.isConnected
                  ? [
                      { value: feishuStatus.itemCount ?? 0, label: '文档' },
                      { value: '—', label: '空间' },
                      { value: '自动', label: '同步' },
                    ]
                  : undefined
              }
              syncing={syncing === 'FEISHU'}
              onBrowse={() => setActiveSubTab('feishu')}
              onSync={() => {
                void handleSync('FEISHU');
              }}
              onSettings={() => {
                router.push('/me/integrations');
              }}
              onConnect={() => {
                router.push('/me/integrations');
              }}
            />
          </div>
        </section>

        {/* Section 3: 即将支持 */}
        <section>
          <SectionTitle
            icon={Sparkles}
            title="即将支持"
            description="更多协作平台正在路上"
          />
          <div className="flex flex-wrap gap-2">
            {['Slack', 'GitHub', 'Linear', 'Confluence', 'Dropbox', 'Jira'].map(
              (label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-200 bg-gray-50/60 px-3 py-1.5 text-xs font-medium text-gray-500"
                >
                  {label}
                  <span className="rounded-full bg-gray-200/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                    即将
                  </span>
                </span>
              )
            )}
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 顶部子 tab chips（横向，学 Agent 市场分类条；取代左侧竖向导航占位，内容拉满整宽） */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-4">
        {navGroups.map((group, gi) => (
          <Fragment key={gi}>
            {gi > 0 && (
              <span className="mx-1 h-5 w-px bg-gray-200" aria-hidden />
            )}
            {group.items.map((item) => {
              const active = activeSubTab === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveSubTab(item.key as DataSourceSubTab)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'border-violet-300 bg-violet-50 text-violet-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  )}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  <span>{item.label}</span>
                  {typeof item.count === 'number' && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-[11px] font-semibold',
                        active
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-gray-100 text-gray-500'
                      )}
                    >
                      {item.count}
                    </span>
                  )}
                  {item.trailing}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* 内容区（整宽） */}
      <div className="min-w-0">{renderSubTabContent()}</div>
    </div>
  );
}
