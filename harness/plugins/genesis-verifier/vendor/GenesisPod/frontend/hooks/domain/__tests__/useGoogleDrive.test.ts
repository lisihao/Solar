import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/services/google-drive/api', () => ({
  getConnections: vi.fn(),
  disconnectGoogleDrive: vi.fn().mockResolvedValue({ success: true }),
  getConnectUrl: vi
    .fn()
    .mockResolvedValue({ url: 'https://accounts.google.com/oauth' }),
  triggerSync: vi
    .fn()
    .mockResolvedValue({ success: true, syncId: 'sync-1', connectionIds: [] }),
  getSyncStatus: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status?: number
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

vi.mock('@/lib/cache', () => ({
  apiCache: {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    keys: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('../../core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiDelete: vi.fn(),
  useApiPut: vi.fn(),
  useApiMutation: vi.fn(),
}));

import { useGoogleDrive } from '../useGoogleDrive';
import { useApiGet, useApiPost, useApiDelete } from '../../core';
import {
  getConnectUrl,
  disconnectGoogleDrive,
  triggerSync,
} from '@/services/google-drive/api';

const mockUseApiGet = vi.mocked(useApiGet);
const mockUseApiPost = vi.mocked(useApiPost);
const mockUseApiDelete = vi.mocked(useApiDelete);
const mockGetConnectUrl = vi.mocked(getConnectUrl);
const mockDisconnectGoogleDrive = vi.mocked(disconnectGoogleDrive);
const mockTriggerSync = vi.mocked(triggerSync);

const makeConnection = (id = 'conn-1') => ({
  id,
  email: 'user@example.com',
  displayName: 'Test User',
  photoUrl: null,
  status: 'ACTIVE' as const,
  lastSyncAt: null,
  lastError: null,
  syncConfig: {
    autoSync: true,
    syncInterval: 3600,
    syncOnStartup: false,
    includedFolders: [],
    excludedFolders: [],
    fileTypes: [],
    maxFileSize: 100,
  },
  filesCount: 5,
  foldersCount: 2,
  totalSize: 2048,
  createdAt: '2024-01-01T00:00:00Z',
});

/**
 * Sets up mockUseApiGet to return different values based on the URL path argument.
 * This is more robust than call-count ordering since the hook may call useApiGet
 * multiple times per render/effect cycle.
 */
function setupApiGetMocks(
  opts: {
    connections?: ReturnType<typeof makeConnection>[];
    connectionsMockOverrides?: Record<string, unknown>;
    syncStatuses?: unknown[];
    syncMockOverrides?: Record<string, unknown>;
  } = {}
) {
  const {
    connections = [makeConnection()],
    connectionsMockOverrides = {},
    syncStatuses = [],
    syncMockOverrides = {},
  } = opts;

  const fetchConnectionsMock = vi.fn().mockResolvedValue({ connections });
  const fetchSyncStatusMock = vi
    .fn()
    .mockResolvedValue({ status: syncStatuses });

  mockUseApiGet.mockImplementation((path: string) => {
    if (path.includes('/google-drive/connections')) {
      return {
        data: { connections },
        loading: false,
        error: null,
        execute: fetchConnectionsMock,
        refresh: vi.fn(),
        reset: vi.fn(),
        setData: vi.fn(),
        ...connectionsMockOverrides,
      } as never;
    }
    // sync status path
    return {
      data: { status: syncStatuses },
      loading: false,
      error: null,
      execute: fetchSyncStatusMock,
      refresh: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      ...syncMockOverrides,
    } as never;
  });

  return { fetchConnectionsMock, fetchSyncStatusMock };
}

describe('useGoogleDrive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiGetMocks();
    mockUseApiPost.mockReturnValue({
      data: undefined,
      loading: false,
      error: null,
      execute: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
    } as never);
    mockUseApiDelete.mockReturnValue({
      data: undefined,
      loading: false,
      error: null,
      execute: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
    } as never);
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useGoogleDrive());

    expect(result.current.connections).toHaveLength(1);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.syncStatus).toBeNull();
    expect(result.current.isSyncing).toBe(false);
  });

  it('should return empty connections when none exist', () => {
    setupApiGetMocks({ connections: [] });

    const { result } = renderHook(() => useGoogleDrive());

    expect(result.current.connections).toEqual([]);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connection).toBeNull();
  });

  it('should return first connection as default connection', () => {
    const conn1 = makeConnection('conn-1');
    const conn2 = makeConnection('conn-2');
    setupApiGetMocks({ connections: [conn1, conn2] });

    const { result } = renderHook(() => useGoogleDrive());

    expect(result.current.connection?.id).toBe('conn-1');
  });

  it('should return specific connection when connectionId is provided', () => {
    const conn1 = makeConnection('conn-1');
    const conn2 = makeConnection('conn-2');
    setupApiGetMocks({ connections: [conn1, conn2] });

    const { result } = renderHook(() =>
      useGoogleDrive({ connectionId: 'conn-2' })
    );

    expect(result.current.connection?.id).toBe('conn-2');
  });

  it('should call getConnectUrl when connect is invoked', async () => {
    mockGetConnectUrl.mockResolvedValue({
      url: 'https://accounts.google.com/oauth?state=abc',
    });

    const { result } = renderHook(() => useGoogleDrive());

    // The hook sets window.location.href — jsdom may throw "Not implemented: navigation..."
    // We verify getConnectUrl was called regardless of the navigation side-effect.
    try {
      await act(async () => {
        await result.current.connect();
      });
    } catch {
      // expected in jsdom
    }

    expect(mockGetConnectUrl).toHaveBeenCalled();
  });

  it('should throw when getConnectUrl fails', async () => {
    mockGetConnectUrl.mockRejectedValue(new Error('Failed to get URL'));

    const { result } = renderHook(() => useGoogleDrive());

    await expect(
      act(async () => {
        await result.current.connect();
      })
    ).rejects.toThrow('Failed to get URL');
  });

  it('should call disconnectGoogleDrive and refresh connections on disconnect', async () => {
    const { fetchConnectionsMock } = setupApiGetMocks();

    const { result } = renderHook(() => useGoogleDrive());

    await act(async () => {
      await result.current.disconnect('conn-1');
    });

    expect(mockDisconnectGoogleDrive).toHaveBeenCalledWith('conn-1');
    expect(fetchConnectionsMock).toHaveBeenCalled();
  });

  it('should throw when disconnect fails', async () => {
    mockDisconnectGoogleDrive.mockRejectedValue(new Error('Disconnect failed'));

    const { result } = renderHook(() => useGoogleDrive());

    await expect(
      act(async () => {
        await result.current.disconnect('conn-1');
      })
    ).rejects.toThrow('Disconnect failed');
  });

  it('should call both execute functions on refresh', async () => {
    const { fetchConnectionsMock, fetchSyncStatusMock } = setupApiGetMocks();

    const { result } = renderHook(() => useGoogleDrive());

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchConnectionsMock).toHaveBeenCalled();
    expect(fetchSyncStatusMock).toHaveBeenCalled();
  });

  it('should call triggerSync API when triggerSync is called', async () => {
    setupApiGetMocks();

    const { result } = renderHook(() => useGoogleDrive());

    // triggerSync internally waits 500ms then fetches status.
    // We only verify the triggerSync API call is made here.
    // Use a short real timer with a promise that resolves after the wait.
    await act(async () => {
      const p = result.current.triggerSync('conn-1', false);
      // Advance real time by awaiting a resolved promise to flush microtasks
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      await p;
    });

    expect(mockTriggerSync).toHaveBeenCalledWith('conn-1', false);
  }, 15000);

  it('should find connection by id with getConnectionById', () => {
    const conn1 = makeConnection('conn-1');
    const conn2 = makeConnection('conn-2');
    setupApiGetMocks({ connections: [conn1, conn2] });

    const { result } = renderHook(() => useGoogleDrive());

    expect(result.current.getConnectionById('conn-2')?.id).toBe('conn-2');
    expect(result.current.getConnectionById('nonexistent')).toBeUndefined();
  });

  it('should reflect sync status isSyncing when connection is syncing', () => {
    const syncStatusEntry = {
      connectionId: 'conn-1',
      email: 'user@example.com',
      displayName: 'Test User',
      status: 'syncing',
      lastSyncAt: null,
      lastError: null,
      isSyncing: true,
      lastSync: null,
    };
    setupApiGetMocks({ syncStatuses: [syncStatusEntry] });

    const { result } = renderHook(() => useGoogleDrive());

    expect(result.current.syncStatus?.isSyncing).toBe(true);
    expect(result.current.isSyncing).toBe(true);
  });

  it('should reflect loading state when connections are loading', () => {
    setupApiGetMocks({ connectionsMockOverrides: { loading: true } });

    const { result } = renderHook(() => useGoogleDrive());

    expect(result.current.loading).toBe(true);
  });

  it('should reflect error from connections API', () => {
    const mockError = { message: 'Unauthorized', status: 401 };
    setupApiGetMocks({ connectionsMockOverrides: { error: mockError } });

    const { result } = renderHook(() => useGoogleDrive());

    expect(result.current.error).toEqual(mockError);
  });
});
