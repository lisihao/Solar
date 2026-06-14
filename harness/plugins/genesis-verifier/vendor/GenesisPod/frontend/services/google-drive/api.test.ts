/**
 * Tests for lib/api/google-drive.ts
 *
 * All network calls are made through apiClient (from ./client) and use
 * getAuthHeader (from ../utils/auth). Both are mocked at the module level.
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
  connectGoogleDrive,
  disconnectGoogleDrive,
  getConnections,
  getConnection,
  updateConnection,
  listFiles,
  getFile,
  refreshFile,
  linkToResource,
  unlinkFromResource,
  importFiles,
  getImportProgress,
  exportResources,
  getExportProgress,
  triggerSync,
  syncBidirectional,
  resolveConflict,
  linkResourceToFile,
  unlinkResourceFromSync,
  getSyncStatus,
  getSyncHistory,
  getConfig,
} from './api';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthHeader.mockReturnValue({ Authorization: 'Bearer test-token' });
});

const AUTH_HEADERS = { headers: { Authorization: 'Bearer test-token' } };

// ---------------------------------------------------------------------------
// Connection Management
// ---------------------------------------------------------------------------

describe('getConnectUrl', () => {
  it('calls GET /google-drive/connect', async () => {
    mockGet.mockResolvedValue({
      url: 'https://accounts.google.com/o/oauth2/auth',
    });

    const result = await getConnectUrl();

    expect(mockGet).toHaveBeenCalledWith('/google-drive/connect', AUTH_HEADERS);
    expect(result.url).toContain('google.com');
  });
});

describe('connectGoogleDrive', () => {
  it('calls POST /google-drive/connect with code', async () => {
    mockPost.mockResolvedValue({
      success: true,
      connectionId: 'c-1',
      email: 'user@test.com',
      message: 'Connected',
    });

    const result = await connectGoogleDrive(
      'auth-code',
      'https://app.example.com/callback'
    );

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/connect',
      { code: 'auth-code', redirectUri: 'https://app.example.com/callback' },
      AUTH_HEADERS
    );
    expect(result.success).toBe(true);
    expect(result.connectionId).toBe('c-1');
  });

  it('calls POST without redirectUri when omitted', async () => {
    mockPost.mockResolvedValue({
      success: true,
      connectionId: 'c-1',
      email: 'u@t.com',
      message: 'ok',
    });

    await connectGoogleDrive('code-only');

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/connect',
      { code: 'code-only', redirectUri: undefined },
      AUTH_HEADERS
    );
  });
});

describe('disconnectGoogleDrive', () => {
  it('calls DELETE /google-drive/disconnect/:id', async () => {
    mockDelete.mockResolvedValue({ success: true });

    const result = await disconnectGoogleDrive('conn-99');

    expect(mockDelete).toHaveBeenCalledWith(
      '/google-drive/disconnect/conn-99',
      AUTH_HEADERS
    );
    expect(result.success).toBe(true);
  });
});

describe('getConnections', () => {
  it('calls GET /google-drive/connections', async () => {
    mockGet.mockResolvedValue({
      connections: [{ id: 'c-1', email: 'a@b.com' }],
    });

    const result = await getConnections();

    expect(mockGet).toHaveBeenCalledWith(
      '/google-drive/connections',
      AUTH_HEADERS
    );
    expect(result.connections).toHaveLength(1);
  });
});

describe('getConnection', () => {
  it('calls GET /google-drive/connections/:id', async () => {
    mockGet.mockResolvedValue({ connection: { id: 'c-1', email: 'a@b.com' } });

    await getConnection('c-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/google-drive/connections/c-1',
      AUTH_HEADERS
    );
  });
});

describe('updateConnection', () => {
  it('calls PATCH /google-drive/connections/:id with syncConfig', async () => {
    mockPatch.mockResolvedValue({ connection: { id: 'c-1' } });

    await updateConnection('c-1', { autoSync: true, syncInterval: 60 });

    expect(mockPatch).toHaveBeenCalledWith(
      '/google-drive/connections/c-1',
      { syncConfig: { autoSync: true, syncInterval: 60 } },
      AUTH_HEADERS
    );
  });
});

// ---------------------------------------------------------------------------
// File Operations
// ---------------------------------------------------------------------------

describe('listFiles', () => {
  it('builds query string from params', async () => {
    mockGet.mockResolvedValue({
      files: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await listFiles({
      connectionId: 'c-1',
      search: 'report',
      page: 2,
      limit: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    });

    const url: string = mockGet.mock.calls[0][0];
    expect(url).toContain('connectionId=c-1');
    expect(url).toContain('search=report');
    expect(url).toContain('page=2');
    expect(url).toContain('limit=20');
    expect(url).toContain('sortBy=name');
    expect(url).toContain('sortOrder=asc');
  });

  it('omits undefined params from query string', async () => {
    mockGet.mockResolvedValue({
      files: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await listFiles({});

    const url: string = mockGet.mock.calls[0][0];
    expect(url).not.toContain('connectionId');
    expect(url).not.toContain('search');
  });
});

describe('getFile', () => {
  it('calls GET /google-drive/files/:id', async () => {
    mockGet.mockResolvedValue({ file: { id: 'f-1', name: 'doc.pdf' } });

    await getFile('f-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/google-drive/files/f-1',
      AUTH_HEADERS
    );
  });
});

describe('refreshFile', () => {
  it('calls POST /google-drive/files/:id/refresh', async () => {
    mockPost.mockResolvedValue({ file: { id: 'f-1' } });

    await refreshFile('f-1');

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/files/f-1/refresh',
      {},
      AUTH_HEADERS
    );
  });
});

describe('linkToResource', () => {
  it('calls POST /google-drive/files/:id/link with resourceId', async () => {
    mockPost.mockResolvedValue({ success: true });

    await linkToResource('f-1', 'r-1');

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/files/f-1/link',
      { resourceId: 'r-1' },
      AUTH_HEADERS
    );
  });
});

describe('unlinkFromResource', () => {
  it('calls DELETE /google-drive/files/:id/link', async () => {
    mockDelete.mockResolvedValue({ success: true });

    await unlinkFromResource('f-1');

    expect(mockDelete).toHaveBeenCalledWith(
      '/google-drive/files/f-1/link',
      AUTH_HEADERS
    );
  });
});

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

describe('importFiles', () => {
  it('calls POST /google-drive/import with params', async () => {
    mockPost.mockResolvedValue({
      success: true,
      importId: 'imp-1',
      totalFiles: 2,
      status: 'pending',
    });

    const params = { connectionId: 'c-1', fileIds: ['f-1', 'f-2'] };
    const result = await importFiles(params);

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/import',
      params,
      AUTH_HEADERS
    );
    expect(result.importId).toBe('imp-1');
  });
});

describe('getImportProgress', () => {
  it('calls GET /google-drive/import/:id', async () => {
    mockGet.mockResolvedValue({
      progress: {
        importId: 'imp-1',
        status: 'completed',
        totalFiles: 2,
        processedFiles: 2,
        successCount: 2,
        failedCount: 0,
        errors: [],
        resourceIds: [],
        startedAt: '',
        completedAt: '',
      },
    });

    await getImportProgress('imp-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/google-drive/import/imp-1',
      AUTH_HEADERS
    );
  });
});

describe('exportResources', () => {
  it('calls POST /google-drive/export with params', async () => {
    mockPost.mockResolvedValue({
      success: true,
      exportId: 'exp-1',
      totalResources: 1,
      status: 'pending',
    });

    const params = {
      connectionId: 'c-1',
      resourceIds: ['r-1'],
      targetFolderId: 'folder-1',
      format: 'pdf' as const,
    };
    const result = await exportResources(params);

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/export',
      params,
      AUTH_HEADERS
    );
    expect(result.exportId).toBe('exp-1');
  });
});

describe('getExportProgress', () => {
  it('calls GET /google-drive/export/:id', async () => {
    mockGet.mockResolvedValue({
      progress: {
        exportId: 'exp-1',
        status: 'completed',
        totalResources: 1,
        processedResources: 1,
        successCount: 1,
        failedCount: 0,
        errors: [],
        driveFileIds: [],
        targetFolderId: 'f',
        startedAt: '',
        completedAt: '',
      },
    });

    await getExportProgress('exp-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/google-drive/export/exp-1',
      AUTH_HEADERS
    );
  });
});

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

describe('triggerSync', () => {
  it('calls POST /google-drive/sync with connectionId and fullSync', async () => {
    mockPost.mockResolvedValue({
      success: true,
      syncId: 's-1',
      connectionIds: ['c-1'],
    });

    const result = await triggerSync('c-1', true);

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/sync',
      { connectionId: 'c-1', fullSync: true },
      AUTH_HEADERS
    );
    expect(result.success).toBe(true);
  });

  it('uses fullSync=false by default', async () => {
    mockPost.mockResolvedValue({
      success: true,
      syncId: 's-1',
      connectionIds: [],
    });

    await triggerSync();

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/sync',
      { connectionId: undefined, fullSync: false },
      AUTH_HEADERS
    );
  });
});

describe('syncBidirectional', () => {
  it('calls POST /google-drive/sync with direction', async () => {
    mockPost.mockResolvedValue({
      success: true,
      imported: 1,
      exported: 0,
      conflicts: [],
      errors: [],
      syncedAt: '',
      message: 'done',
    });

    await syncBidirectional('import');

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/sync',
      { direction: 'import' },
      AUTH_HEADERS
    );
  });
});

describe('resolveConflict', () => {
  it('calls POST /google-drive/sync/resolve', async () => {
    mockPost.mockResolvedValue({ success: true, message: 'Resolved' });

    const result = await resolveConflict('conflict-1', 'keep_local');

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/sync/resolve',
      { conflictId: 'conflict-1', resolution: 'keep_local' },
      AUTH_HEADERS
    );
    expect(result.success).toBe(true);
  });
});

describe('linkResourceToFile', () => {
  it('calls POST /google-drive/sync/link', async () => {
    mockPost.mockResolvedValue({ success: true, message: 'Linked' });

    await linkResourceToFile('r-1', 'gf-1');

    expect(mockPost).toHaveBeenCalledWith(
      '/google-drive/sync/link',
      { resourceId: 'r-1', googleFileId: 'gf-1' },
      AUTH_HEADERS
    );
  });
});

describe('unlinkResourceFromSync', () => {
  it('calls DELETE /google-drive/sync/link/:resourceId', async () => {
    mockDelete.mockResolvedValue({ success: true, message: 'Unlinked' });

    await unlinkResourceFromSync('r-1');

    expect(mockDelete).toHaveBeenCalledWith(
      '/google-drive/sync/link/r-1',
      AUTH_HEADERS
    );
  });
});

describe('getSyncStatus', () => {
  it('includes connectionId query param when provided', async () => {
    mockGet.mockResolvedValue({ status: [] });

    await getSyncStatus('c-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/google-drive/sync/status?connectionId=c-1',
      AUTH_HEADERS
    );
  });

  it('omits query param when connectionId is not provided', async () => {
    mockGet.mockResolvedValue({ status: [] });

    await getSyncStatus();

    expect(mockGet).toHaveBeenCalledWith(
      '/google-drive/sync/status',
      AUTH_HEADERS
    );
  });
});

describe('getSyncHistory', () => {
  it('calls GET with connectionId and limit', async () => {
    mockGet.mockResolvedValue({ history: [] });

    await getSyncHistory('c-1', 5);

    expect(mockGet).toHaveBeenCalledWith(
      '/google-drive/sync/history/c-1?limit=5',
      AUTH_HEADERS
    );
  });

  it('uses limit=10 by default', async () => {
    mockGet.mockResolvedValue({ history: [] });

    await getSyncHistory('c-1');

    expect(mockGet).toHaveBeenCalledWith(
      '/google-drive/sync/history/c-1?limit=10',
      AUTH_HEADERS
    );
  });
});

describe('getConfig', () => {
  it('calls GET /google-drive/config', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      callbackUrl: 'https://app.example.com/callback',
    });

    const result = await getConfig();

    expect(mockGet).toHaveBeenCalledWith('/google-drive/config', AUTH_HEADERS);
    expect(result.configured).toBe(true);
  });
});
