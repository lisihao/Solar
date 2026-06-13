/**
 * Tests for lib/api/notion.ts
 *
 * All network calls are made through apiClient and use getAuthHeader.
 * Both are mocked at the module level.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const { mockGet, mockPost, mockPatch, mockDelete, mockGetAuthHeader } =
  vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockPost: vi.fn(),
    mockPatch: vi.fn(),
    mockDelete: vi.fn(),
    mockGetAuthHeader: vi.fn(),
  }));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    delete: mockDelete,
  },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: mockGetAuthHeader,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  getConnectUrl,
  connectNotion,
  disconnectNotion,
  getConnections,
  getConnection,
  updateConnection,
  triggerSync,
  getSyncStatus,
  getSyncHistory,
  getPendingChanges,
  syncBidirectional,
  resolveConflict,
  getPages,
  getPage,
  updatePage,
  pushToNotion,
  linkToResource,
  unlinkFromResource,
  getDatabases,
  getDatabase,
  getConfig,
} from './api';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthHeader.mockReturnValue({ Authorization: 'Bearer notion-token' });
});

const AUTH_HEADERS = { headers: { Authorization: 'Bearer notion-token' } };

// ---------------------------------------------------------------------------
// Connection Management
// ---------------------------------------------------------------------------

describe('getConnectUrl', () => {
  it('calls GET /notion/connect', async () => {
    mockGet.mockResolvedValue({
      url: 'https://api.notion.com/v1/oauth/authorize',
    });

    const result = await getConnectUrl();

    expect(mockGet).toHaveBeenCalledWith('/notion/connect', AUTH_HEADERS);
    expect(result.url).toContain('notion.com');
  });
});

describe('connectNotion', () => {
  it('calls POST /notion/connect with code and redirectUri', async () => {
    mockPost.mockResolvedValue({
      success: true,
      connectionId: 'n-conn-1',
      workspaceName: 'My Workspace',
      message: 'Connected',
    });

    const result = await connectNotion(
      'notion-code',
      'https://app.example.com/callback'
    );

    expect(mockPost).toHaveBeenCalledWith(
      '/notion/connect',
      { code: 'notion-code', redirectUri: 'https://app.example.com/callback' },
      AUTH_HEADERS
    );
    expect(result.success).toBe(true);
    expect(result.workspaceName).toBe('My Workspace');
  });

  it('omits redirectUri when not provided', async () => {
    mockPost.mockResolvedValue({
      success: true,
      connectionId: 'n-1',
      workspaceName: 'WS',
      message: 'ok',
    });

    await connectNotion('code-only');

    expect(mockPost).toHaveBeenCalledWith(
      '/notion/connect',
      { code: 'code-only', redirectUri: undefined },
      AUTH_HEADERS
    );
  });
});

describe('disconnectNotion', () => {
  it('calls DELETE /notion/disconnect/:connectionId', async () => {
    mockDelete.mockResolvedValue({ success: true });

    const result = await disconnectNotion('n-conn-1');

    expect(mockDelete).toHaveBeenCalledWith(
      '/notion/disconnect/n-conn-1',
      AUTH_HEADERS
    );
    expect(result.success).toBe(true);
  });
});

describe('getConnections', () => {
  it('calls GET /notion/connections and returns connections array', async () => {
    const conn = { id: 'n-conn-1', workspaceName: 'Work', status: 'ACTIVE' };
    mockGet.mockResolvedValue({ connections: [conn] });

    const result = await getConnections();

    expect(mockGet).toHaveBeenCalledWith('/notion/connections', AUTH_HEADERS);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject(conn);
  });
});

describe('getConnection', () => {
  it('calls GET /notion/connections/:id', async () => {
    mockGet.mockResolvedValue({
      connection: { id: 'n-conn-1', workspaceName: 'Work', status: 'ACTIVE' },
    });

    await getConnection('n-conn-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/notion/connections/n-conn-1',
      AUTH_HEADERS
    );
  });
});

describe('updateConnection', () => {
  it('calls PATCH /notion/connections/:id with syncConfig', async () => {
    mockPatch.mockResolvedValue({ connection: { id: 'n-conn-1' } });

    await updateConnection('n-conn-1', { autoSync: false, syncPages: true });

    expect(mockPatch).toHaveBeenCalledWith(
      '/notion/connections/n-conn-1',
      { syncConfig: { autoSync: false, syncPages: true } },
      AUTH_HEADERS
    );
  });
});

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

describe('triggerSync', () => {
  it('calls POST /notion/sync with connectionId and fullSync', async () => {
    mockPost.mockResolvedValue({
      success: true,
      syncId: 'sync-1',
      connectionIds: ['n-conn-1'],
    });

    const result = await triggerSync('n-conn-1', true);

    expect(mockPost).toHaveBeenCalledWith(
      '/notion/sync',
      { connectionId: 'n-conn-1', fullSync: true },
      AUTH_HEADERS
    );
    expect(result.syncId).toBe('sync-1');
  });

  it('uses fullSync=false by default', async () => {
    mockPost.mockResolvedValue({
      success: true,
      syncId: 's-1',
      connectionIds: [],
    });

    await triggerSync();

    expect(mockPost).toHaveBeenCalledWith(
      '/notion/sync',
      { connectionId: undefined, fullSync: false },
      AUTH_HEADERS
    );
  });
});

describe('getSyncStatus', () => {
  it('appends connectionId query param when provided', async () => {
    mockGet.mockResolvedValue({ status: [] });

    await getSyncStatus('n-conn-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/notion/sync/status?connectionId=n-conn-1',
      AUTH_HEADERS
    );
  });

  it('omits query param when connectionId is not provided', async () => {
    mockGet.mockResolvedValue({ status: [] });

    await getSyncStatus();

    expect(mockGet).toHaveBeenCalledWith('/notion/sync/status', AUTH_HEADERS);
  });
});

describe('getSyncHistory', () => {
  it('calls GET with connectionId and limit', async () => {
    mockGet.mockResolvedValue({ history: [] });

    await getSyncHistory('n-conn-1', 20);

    expect(mockGet).toHaveBeenCalledWith(
      '/notion/sync/history/n-conn-1?limit=20',
      AUTH_HEADERS
    );
  });

  it('defaults limit to 10', async () => {
    mockGet.mockResolvedValue({ history: [] });

    await getSyncHistory('n-conn-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/notion/sync/history/n-conn-1?limit=10',
      AUTH_HEADERS
    );
  });
});

describe('getPendingChanges', () => {
  it('calls GET /notion/sync/pending with connectionId', async () => {
    mockGet.mockResolvedValue({
      pendingChanges: { localChanges: 2, remoteChanges: 1, conflicts: 0 },
    });

    const result = await getPendingChanges('n-conn-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/notion/sync/pending?connectionId=n-conn-1',
      AUTH_HEADERS
    );
    expect(result.pendingChanges.localChanges).toBe(2);
  });

  it('omits connectionId param when not provided', async () => {
    mockGet.mockResolvedValue({
      pendingChanges: { localChanges: 0, remoteChanges: 0, conflicts: 0 },
    });

    await getPendingChanges();

    expect(mockGet).toHaveBeenCalledWith('/notion/sync/pending', AUTH_HEADERS);
  });
});

describe('syncBidirectional', () => {
  it('calls POST /notion/sync/bidirectional with connectionId and direction', async () => {
    mockPost.mockResolvedValue({
      success: true,
      pagesProcessed: 5,
      pagesCreated: 2,
      pagesUpdated: 3,
      pagesPushed: 1,
      conflicts: [],
      errors: [],
      message: 'Sync complete',
    });

    const result = await syncBidirectional('n-conn-1', 'both');

    expect(mockPost).toHaveBeenCalledWith(
      '/notion/sync/bidirectional',
      { connectionId: 'n-conn-1', direction: 'both' },
      AUTH_HEADERS
    );
    expect(result.pagesProcessed).toBe(5);
  });
});

describe('resolveConflict', () => {
  it('calls POST /notion/sync/resolve with keep_remote resolution', async () => {
    mockPost.mockResolvedValue({ success: true, message: 'Conflict resolved' });

    const result = await resolveConflict('page-1', 'keep_remote');

    expect(mockPost).toHaveBeenCalledWith(
      '/notion/sync/resolve',
      { pageId: 'page-1', resolution: 'keep_remote' },
      AUTH_HEADERS
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

describe('getPages', () => {
  it('builds query string from params', async () => {
    mockGet.mockResolvedValue({
      pages: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });

    await getPages({
      connectionId: 'n-conn-1',
      search: 'meeting',
      page: 2,
      limit: 10,
    });

    const url: string = mockGet.mock.calls[0][0];
    expect(url).toContain('connectionId=n-conn-1');
    expect(url).toContain('search=meeting');
    expect(url).toContain('page=2');
    expect(url).toContain('limit=10');
  });

  it('omits undefined params', async () => {
    mockGet.mockResolvedValue({
      pages: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });

    await getPages({});

    const url: string = mockGet.mock.calls[0][0];
    expect(url).not.toContain('connectionId');
    expect(url).not.toContain('search');
  });
});

describe('getPage', () => {
  it('calls GET /notion/pages/:id', async () => {
    mockGet.mockResolvedValue({ page: { id: 'p-1', title: 'My Page' } });

    await getPage('p-1');

    expect(mockGet).toHaveBeenCalledWith('/notion/pages/p-1', AUTH_HEADERS);
  });
});

describe('updatePage', () => {
  it('calls PATCH /notion/pages/:id with blocks', async () => {
    const blocks = [{ type: 'paragraph', text: 'Hello' }];
    mockPatch.mockResolvedValue({ page: { id: 'p-1' } });

    await updatePage('p-1', blocks);

    expect(mockPatch).toHaveBeenCalledWith(
      '/notion/pages/p-1',
      { blocks },
      AUTH_HEADERS
    );
  });
});

describe('pushToNotion', () => {
  it('calls POST /notion/pages/:id/push', async () => {
    mockPost.mockResolvedValue({ success: true });

    const result = await pushToNotion('p-1');

    expect(mockPost).toHaveBeenCalledWith(
      '/notion/pages/p-1/push',
      {},
      AUTH_HEADERS
    );
    expect(result.success).toBe(true);
  });
});

describe('linkToResource', () => {
  it('calls POST /notion/pages/:id/link with resourceId', async () => {
    mockPost.mockResolvedValue({ success: true });

    await linkToResource('p-1', 'res-1');

    expect(mockPost).toHaveBeenCalledWith(
      '/notion/pages/p-1/link',
      { resourceId: 'res-1' },
      AUTH_HEADERS
    );
  });
});

describe('unlinkFromResource', () => {
  it('calls DELETE /notion/pages/:id/link', async () => {
    mockDelete.mockResolvedValue({ success: true });

    await unlinkFromResource('p-1');

    expect(mockDelete).toHaveBeenCalledWith(
      '/notion/pages/p-1/link',
      AUTH_HEADERS
    );
  });
});

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

describe('getDatabases', () => {
  it('calls GET /notion/databases with connectionId', async () => {
    mockGet.mockResolvedValue({ databases: [{ id: 'db-1', title: 'Tasks' }] });

    const result = await getDatabases('n-conn-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/notion/databases?connectionId=n-conn-1',
      AUTH_HEADERS
    );
    expect(result.databases).toHaveLength(1);
  });

  it('calls GET /notion/databases without query param when no connectionId', async () => {
    mockGet.mockResolvedValue({ databases: [] });

    await getDatabases();

    expect(mockGet).toHaveBeenCalledWith('/notion/databases', AUTH_HEADERS);
  });
});

describe('getDatabase', () => {
  it('calls GET /notion/databases/:id', async () => {
    mockGet.mockResolvedValue({ database: { id: 'db-1', title: 'Tasks' } });

    await getDatabase('db-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/notion/databases/db-1',
      AUTH_HEADERS
    );
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe('getConfig', () => {
  it('calls GET /notion/config and returns configuration', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      callbackUrl: 'https://app.example.com/callback',
    });

    const result = await getConfig();

    expect(mockGet).toHaveBeenCalledWith('/notion/config', AUTH_HEADERS);
    expect(result.configured).toBe(true);
    expect(result.callbackUrl).toBeTruthy();
  });
});
