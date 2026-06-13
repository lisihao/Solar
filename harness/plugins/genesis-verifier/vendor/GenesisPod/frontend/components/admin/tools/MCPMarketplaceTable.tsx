'use client';

/**
 * MCPMarketplaceTable —— 工具管理 Tab 2: MCP 工具市场
 *
 * 2026-05-11 W3r: 参考 SkillsMarketplaceTab，市场卡片风格 + 已安装/启用标识
 *
 * 卡片来源：
 *   - PRESET_MCP_SERVERS（前端固定列表）：业界常用 MCP 服务器（brave-search /
 *     github / postgres / slack / google-drive 等），按 category 分组
 *   - 用户已手动添加但不在预设的 server：归到"自定义"分组，仍以卡片呈现
 *
 * 卡片状态判断：
 *   - 已安装（installed=true）：通过 GET /admin/ai/mcp-servers 返回的列表里
 *     有同 serverId 的记录
 *   - 已连接（connected=true）：已安装且 backend 报 connected
 *
 * 操作：
 *   - 未安装：点击「安装」→ 弹层填写环境变量 → POST /admin/ai/mcp-servers
 *   - 已安装：连接 / 断开 / 删除
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  Search,
  Plus,
  Power,
  PowerOff,
  Trash2,
  CheckCircle,
  X,
  Globe,
  Github,
  FileText,
  Database,
  Code,
  MessageSquare,
  Zap,
  Cloud,
  Server,
  Settings,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { confirm } from '@/stores';

// ──────────────── types ────────────────

type IconComponent = React.ComponentType<{ className?: string }>;

interface EnvVarRequirement {
  name: string;
  description: string;
  required: boolean;
}

interface PresetMCPServer {
  serverId: string;
  name: string;
  description: string;
  transport: 'stdio' | 'sse';
  command: string;
  args: string[];
  icon: IconComponent;
  category: 'search' | 'dev' | 'productivity' | 'data' | 'communication';
  officialUrl?: string;
  requiredEnvVars?: EnvVarRequirement[];
}

interface MCPServer {
  serverId: string;
  name: string;
  description?: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  connected?: boolean;
  autoConnect?: boolean;
  toolCount?: number;
  tools?: Array<{ name: string; description?: string }>;
  env?: Record<string, string>;
}

// ──────────────── preset list ────────────────

const PRESET_MCP_SERVERS: PresetMCPServer[] = [
  {
    serverId: 'brave-search',
    name: 'Brave Search',
    description: '使用 Brave Search API 进行 Web 搜索（注重隐私）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    icon: Search,
    category: 'search',
    officialUrl: 'https://github.com/anthropics/mcp-servers',
    requiredEnvVars: [
      {
        name: 'BRAVE_API_KEY',
        description: 'Brave Search API Key',
        required: true,
      },
    ],
  },
  {
    serverId: 'duckduckgo-search',
    name: 'DuckDuckGo Search',
    description: '免费 Web 搜索，无需 API Key',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-ddg-search'],
    icon: Globe,
    category: 'search',
    officialUrl: 'https://github.com/anthropics/mcp-servers',
  },
  {
    serverId: 'google-search',
    name: 'Google Search',
    description: '使用 Google Custom Search API 进行 Web 搜索',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-search'],
    icon: Search,
    category: 'search',
    requiredEnvVars: [
      { name: 'GOOGLE_API_KEY', description: 'Google API Key', required: true },
      {
        name: 'GOOGLE_CSE_ID',
        description: 'Google Custom Search Engine ID',
        required: true,
      },
    ],
  },
  {
    serverId: 'github',
    name: 'GitHub',
    description: 'GitHub 仓库访问 — issues / PRs / 代码搜索',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    icon: Github,
    category: 'dev',
    officialUrl: 'https://github.com/anthropics/mcp-servers',
    requiredEnvVars: [
      {
        name: 'GITHUB_TOKEN',
        description: 'GitHub Personal Access Token',
        required: true,
      },
    ],
  },
  {
    serverId: 'gitlab',
    name: 'GitLab',
    description: 'GitLab 仓库访问与管理',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gitlab'],
    icon: Code,
    category: 'dev',
    requiredEnvVars: [
      {
        name: 'GITLAB_TOKEN',
        description: 'GitLab Personal Access Token',
        required: true,
      },
      {
        name: 'GITLAB_URL',
        description: 'GitLab 实例 URL（gitlab.com 可选）',
        required: false,
      },
    ],
  },
  {
    serverId: 'filesystem',
    name: 'Filesystem',
    description: '本地文件系统访问 — 读写文件 / 搜索',
    transport: 'stdio',
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '--allow-write',
      '.',
    ],
    icon: FileText,
    category: 'dev',
    officialUrl: 'https://github.com/anthropics/mcp-servers',
  },
  {
    serverId: 'sqlite',
    name: 'SQLite',
    description: 'SQLite 数据库查询与管理',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    icon: Database,
    category: 'data',
    requiredEnvVars: [
      {
        name: 'SQLITE_DB_PATH',
        description: 'SQLite 数据库文件路径',
        required: true,
      },
    ],
  },
  {
    serverId: 'postgres',
    name: 'PostgreSQL',
    description: 'PostgreSQL 数据库查询与管理',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    icon: Database,
    category: 'data',
    requiredEnvVars: [
      {
        name: 'POSTGRES_URL',
        description: 'PostgreSQL 连接 URL',
        required: true,
      },
    ],
  },
  {
    serverId: 'memory',
    name: 'Memory',
    description: '持久化记忆存储（AI 上下文）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    icon: Zap,
    category: 'productivity',
  },
  {
    serverId: 'puppeteer',
    name: 'Puppeteer',
    description: '浏览器自动化与网页抓取',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    icon: Globe,
    category: 'productivity',
  },
  {
    serverId: 'fetch',
    name: 'Fetch',
    description: 'HTTP 请求与网页内容拉取',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    icon: Cloud,
    category: 'productivity',
  },
  {
    serverId: 'slack',
    name: 'Slack',
    description: 'Slack 工作区集成 — 消息 / 频道 / 用户',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    icon: MessageSquare,
    category: 'communication',
    requiredEnvVars: [
      {
        name: 'SLACK_BOT_TOKEN',
        description: 'Slack Bot OAuth Token (xoxb-...)',
        required: true,
      },
      {
        name: 'SLACK_TEAM_ID',
        description: 'Slack 工作区 / Team ID',
        required: false,
      },
    ],
  },
  {
    serverId: 'google-drive',
    name: 'Google Drive',
    description: 'Google Drive 文件访问与管理',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-google-drive'],
    icon: Cloud,
    category: 'productivity',
    requiredEnvVars: [
      {
        name: 'GOOGLE_CLIENT_ID',
        description: 'Google OAuth Client ID',
        required: true,
      },
      {
        name: 'GOOGLE_CLIENT_SECRET',
        description: 'Google OAuth Client Secret',
        required: true,
      },
    ],
  },
];

const CATEGORY_LABELS: Record<PresetMCPServer['category'], string> = {
  search: '搜索',
  dev: '开发',
  data: '数据',
  productivity: '生产力',
  communication: '通讯',
};

const CATEGORY_ORDER: PresetMCPServer['category'][] = [
  'search',
  'dev',
  'data',
  'productivity',
  'communication',
];

// ──────────────── component ────────────────

export function MCPMarketplaceTable() {
  const [installed, setInstalled] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);
  const [installingPreset, setInstallingPreset] =
    useState<PresetMCPServer | null>(null);
  const [editingEnvPreset, setEditingEnvPreset] = useState<{
    preset: PresetMCPServer;
    initialEnv: Record<string, string>;
  } | null>(null);
  const [showCustomAdd, setShowCustomAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.apiUrl}/admin/ai/mcp-servers`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const data = raw?.data ?? raw;
      setInstalled(Array.isArray(data?.servers) ? data.servers : []);
    } catch (e) {
      setError((e as Error).message);
      logger.error('[MCPMarketplaceTable] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const installedMap = useMemo(() => {
    const m = new Map<string, MCPServer>();
    for (const s of installed) m.set(s.serverId, s);
    return m;
  }, [installed]);

  const customServers = useMemo(() => {
    const presetIds = new Set(PRESET_MCP_SERVERS.map((p) => p.serverId));
    return installed.filter((s) => !presetIds.has(s.serverId));
  }, [installed]);

  const presetByCategory = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<PresetMCPServer['category'], PresetMCPServer[]>();
    for (const p of PRESET_MCP_SERVERS) {
      if (
        q &&
        !p.serverId.toLowerCase().includes(q) &&
        !p.name.toLowerCase().includes(q) &&
        !p.description.toLowerCase().includes(q)
      )
        continue;
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      items: map.get(cat) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [search]);

  const connectServer = async (serverId: string) => {
    setActingId(serverId);
    try {
      const res = await fetch(
        `${config.apiUrl}/admin/ai/mcp-servers/${serverId}/connect`,
        { method: 'POST', headers: { ...getAuthHeader() } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActingId(null);
    }
  };

  const disconnectServer = async (serverId: string) => {
    setActingId(serverId);
    try {
      const res = await fetch(
        `${config.apiUrl}/admin/ai/mcp-servers/${serverId}/disconnect`,
        { method: 'POST', headers: { ...getAuthHeader() } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActingId(null);
    }
  };

  const deleteServer = async (serverId: string) => {
    if (
      !(await confirm({
        title: `删除 MCP 服务器 ${serverId}？`,
        type: 'danger',
      }))
    )
      return;
    setActingId(serverId);
    try {
      const res = await fetch(
        `${config.apiUrl}/admin/ai/mcp-servers/${serverId}`,
        { method: 'DELETE', headers: { ...getAuthHeader() } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActingId(null);
    }
  };

  const installPreset = async (
    preset: PresetMCPServer,
    env: Record<string, string>
  ) => {
    const res = await fetch(`${config.apiUrl}/admin/ai/mcp-servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({
        serverId: preset.serverId,
        name: preset.name,
        description: preset.description,
        transport: preset.transport,
        command: preset.command,
        args: preset.args,
        enabled: true,
        autoConnect: false,
        env: Object.keys(env).length > 0 ? env : undefined,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  };

  const addCustom = async (
    server: Omit<MCPServer, 'connected' | 'toolCount' | 'tools'>
  ) => {
    const res = await fetch(`${config.apiUrl}/admin/ai/mcp-servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(server),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  };

  const updateEnv = async (serverId: string, env: Record<string, string>) => {
    const res = await fetch(
      `${config.apiUrl}/admin/ai/mcp-servers/${serverId}/env`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ env }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            name={`mcp-search-${Math.random().toString(36).slice(2, 10)}`}
            autoComplete="new-password"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 MCP 服务器..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCustomAdd(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          添加自定义
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
        <span className="text-xs text-gray-500">
          预设 {PRESET_MCP_SERVERS.length} · 已安装 {installed.length}
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          错误：{error}
        </div>
      )}

      {presetByCategory.map(({ category, items }) => (
        <div key={category}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            {CATEGORY_LABELS[category]}（{items.length}）
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <PresetCard
                key={p.serverId}
                preset={p}
                installed={installedMap.get(p.serverId)}
                acting={actingId === p.serverId}
                onInstall={() => setInstallingPreset(p)}
                onEditEnv={() =>
                  setEditingEnvPreset({
                    preset: p,
                    initialEnv: installedMap.get(p.serverId)?.env ?? {},
                  })
                }
                onConnect={() => void connectServer(p.serverId)}
                onDisconnect={() => void disconnectServer(p.serverId)}
                onDelete={() => void deleteServer(p.serverId)}
              />
            ))}
          </div>
        </div>
      ))}

      {customServers.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            自定义（{customServers.length}）
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {customServers.map((s) => (
              <CustomCard
                key={s.serverId}
                server={s}
                acting={actingId === s.serverId}
                onConnect={() => void connectServer(s.serverId)}
                onDisconnect={() => void disconnectServer(s.serverId)}
                onDelete={() => void deleteServer(s.serverId)}
              />
            ))}
          </div>
        </div>
      )}

      {installingPreset && (
        <InstallPresetDialog
          preset={installingPreset}
          mode="install"
          onClose={() => setInstallingPreset(null)}
          onSubmit={async (env) => {
            await installPreset(installingPreset, env);
            setInstallingPreset(null);
          }}
        />
      )}

      {editingEnvPreset && (
        <InstallPresetDialog
          preset={editingEnvPreset.preset}
          mode="edit"
          initialEnv={editingEnvPreset.initialEnv}
          onClose={() => setEditingEnvPreset(null)}
          onSubmit={async (env) => {
            await updateEnv(editingEnvPreset.preset.serverId, env);
            setEditingEnvPreset(null);
          }}
        />
      )}

      {showCustomAdd && (
        <AddCustomServerDialog
          onClose={() => setShowCustomAdd(false)}
          onAdd={async (server) => {
            await addCustom(server);
            setShowCustomAdd(false);
          }}
        />
      )}
    </div>
  );
}

// ──────────────── cards ────────────────

function PresetCard({
  preset,
  installed,
  acting,
  onInstall,
  onEditEnv,
  onConnect,
  onDisconnect,
  onDelete,
}: {
  preset: PresetMCPServer;
  installed: MCPServer | undefined;
  acting: boolean;
  onInstall: () => void;
  onEditEnv: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
}) {
  const Icon = preset.icon;
  const isInstalled = !!installed;
  const isConnected = installed?.connected ?? false;
  const isEnabled = installed?.enabled ?? false;
  const needsEnv =
    (preset.requiredEnvVars ?? []).filter((e) => e.required).length > 0;

  return (
    <div className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md">
      {isInstalled && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          {isConnected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
              <CheckCircle className="h-3 w-3" />
              已连接
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
              <CheckCircle className="h-3 w-3" />
              已安装
            </span>
          )}
        </div>
      )}

      <div className="mb-3 flex items-start gap-3 pr-20">
        <div className="rounded-lg bg-gray-100 p-2">
          <Icon className="h-5 w-5 text-gray-700" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-gray-900">
            {preset.name}
          </h3>
          <p className="font-mono mt-0.5 text-[11px] text-gray-500">
            {preset.serverId}
          </p>
        </div>
      </div>

      <p className="mb-3 line-clamp-2 flex-1 text-xs text-gray-600">
        {preset.description}
      </p>

      <div className="mb-3 flex items-center gap-2 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5">
          <Server className="h-3 w-3" />
          {preset.transport}
        </span>
        {needsEnv && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700">
            <Settings className="h-3 w-3" />
            需配置 env
          </span>
        )}
      </div>

      {isInstalled ? (
        <div className="flex items-center gap-1.5">
          {isConnected ? (
            <button
              type="button"
              onClick={onDisconnect}
              disabled={acting}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <PowerOff className="h-3 w-3" />
              断开
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              disabled={acting || !isEnabled}
              title={!isEnabled ? '已禁用' : '连接'}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {acting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Power className="h-3 w-3" />
              )}
              连接
            </button>
          )}
          {needsEnv && (
            <button
              type="button"
              onClick={onEditEnv}
              disabled={acting}
              title="编辑环境变量"
              className="rounded-md border border-gray-300 bg-white p-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Settings className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={acting}
            title="删除"
            className="rounded-md border border-gray-300 bg-white p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onInstall}
          disabled={acting}
          className="inline-flex items-center justify-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          安装
        </button>
      )}
    </div>
  );
}

function CustomCard({
  server,
  acting,
  onConnect,
  onDisconnect,
  onDelete,
}: {
  server: MCPServer;
  acting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative flex flex-col rounded-xl border border-gray-200 bg-white p-4">
      <div className="absolute right-3 top-3">
        {server.connected ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
            <CheckCircle className="h-3 w-3" />
            已连接
          </span>
        ) : (
          <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
            未连接
          </span>
        )}
      </div>

      <div className="mb-3 flex items-start gap-3 pr-20">
        <div className="rounded-lg bg-gray-100 p-2">
          <Server className="h-5 w-5 text-gray-700" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-gray-900">
            {server.name}
          </h3>
          <p className="font-mono mt-0.5 text-[11px] text-gray-500">
            {server.serverId}
          </p>
        </div>
      </div>

      <p className="mb-3 line-clamp-2 flex-1 text-xs text-gray-600">
        {server.description || '—'}
      </p>

      <div className="mb-3 flex items-center gap-2 text-[11px] text-gray-500">
        <span className="rounded-md bg-gray-50 px-1.5 py-0.5">
          {server.transport}
        </span>
        <span>{server.toolCount ?? 0} 工具</span>
      </div>

      <div className="flex items-center gap-1.5">
        {server.connected ? (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={acting}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <PowerOff className="h-3 w-3" />
            断开
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={acting}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {acting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Power className="h-3 w-3" />
            )}
            连接
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={acting}
          title="删除"
          className="rounded-md border border-gray-300 bg-white p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ──────────────── dialogs ────────────────

function InstallPresetDialog({
  preset,
  mode = 'install',
  initialEnv,
  onClose,
  onSubmit,
}: {
  preset: PresetMCPServer;
  mode?: 'install' | 'edit';
  initialEnv?: Record<string, string>;
  onClose: () => void;
  onSubmit: (env: Record<string, string>) => Promise<void>;
}) {
  const [env, setEnv] = useState<Record<string, string>>(initialEnv ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredVars = preset.requiredEnvVars ?? [];
  const allRequiredFilled = requiredVars
    .filter((v) => v.required)
    .every((v) => env[v.name]?.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(env);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const titlePrefix = mode === 'edit' ? '编辑配置' : '安装';
  const submitLabel = mode === 'edit' ? '保存' : '安装';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {titlePrefix}：{preset.name}
            </h3>
            <p className="font-mono mt-0.5 text-xs text-gray-500">
              {preset.serverId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <p className="text-sm text-gray-600">{preset.description}</p>

          {requiredVars.length === 0 ? (
            <p className="rounded-md bg-gray-50 p-3 text-xs text-gray-600">
              该 MCP 服务器无需额外环境变量配置。
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-700">环境变量</p>
              {requiredVars.map((v) => (
                <div key={v.name} className="space-y-1">
                  <label className="block text-xs font-medium text-gray-700">
                    {v.name}
                    {v.required && <span className="ml-1 text-red-500">*</span>}
                  </label>
                  <input
                    type={
                      /token|key|secret|password/i.test(v.name)
                        ? 'password'
                        : 'text'
                    }
                    value={env[v.name] ?? ''}
                    onChange={(e) =>
                      setEnv((prev) => ({ ...prev, [v.name]: e.target.value }))
                    }
                    placeholder={v.description}
                    required={v.required}
                    className="font-mono w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-gray-500">{v.description}</p>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !allRequiredFilled}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddCustomServerDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (
    server: Omit<MCPServer, 'connected' | 'toolCount' | 'tools'>
  ) => Promise<void>;
}) {
  const [serverId, setServerId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'sse'>('stdio');
  const [command, setCommand] = useState('npx');
  const [argsText, setArgsText] = useState('');
  const [url, setUrl] = useState('');
  const [autoConnect, setAutoConnect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onAdd({
        serverId,
        name,
        description: description || undefined,
        transport,
        command: transport === 'stdio' ? command : undefined,
        args:
          transport === 'stdio'
            ? argsText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        url: transport === 'sse' ? url : undefined,
        enabled: true,
        autoConnect,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-900">
            添加自定义 MCP 服务器
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 px-6 py-5">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">
              serverId <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              placeholder="my-mcp-server"
              className="font-mono w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">
              名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP Server"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">
              描述
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700">
              传输
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTransport('stdio')}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  transport === 'stdio'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                STDIO
              </button>
              <button
                type="button"
                onClick={() => setTransport('sse')}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  transport === 'sse'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                SSE
              </button>
            </div>
          </div>

          {transport === 'stdio' ? (
            <>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">
                  command
                </label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="font-mono w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700">
                  args（逗号分隔）
                </label>
                <input
                  type="text"
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder="-y, @modelcontextprotocol/server-example"
                  className="font-mono w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700">
                URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp-server.example.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={autoConnect}
              onChange={(e) => setAutoConnect(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-700">自动连接</span>
          </label>

          {error && (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !serverId || !name}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
