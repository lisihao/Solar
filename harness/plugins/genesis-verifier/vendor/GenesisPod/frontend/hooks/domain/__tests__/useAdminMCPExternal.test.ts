import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
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

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

import { useAdminMCPExternal } from '../useAdminMCPExternal';
import { useApiGet } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';

const mockUseApiGet = vi.mocked(useApiGet);

const makeServer = (id = 'server-1') => ({
  id,
  serverId: `mcp-server-${id}`,
  name: 'GitHub MCP',
  description: 'GitHub integration server',
  transport: 'http',
  url: 'https://mcp.github.com',
  enabled: true,
  autoConnect: true,
  metadata: {},
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  connectionStatus: {
    status: 'connected' as const,
    connectedAt: '2024-01-01T00:00:00Z',
  },
});

const makeApiGetMock = (data = [makeServer()]) => ({
  data,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(data),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
});

describe('useAdminMCPExternal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiGet.mockReturnValue(makeApiGetMock() as never);
  });

  it('should initialize with servers from API', () => {
    const { result } = renderHook(() => useAdminMCPExternal());

    expect(result.current.servers).toHaveLength(1);
    expect(result.current.servers[0].name).toBe('GitHub MCP');
    expect(result.current.loading).toBe(false);
    expect(result.current.actionLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should return empty array when no servers', () => {
    mockUseApiGet.mockReturnValue(makeApiGetMock([]) as never);

    const { result } = renderHook(() => useAdminMCPExternal());

    expect(result.current.servers).toEqual([]);
  });

  it('should return empty array when data is undefined', () => {
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      data: undefined,
    } as never);

    const { result } = renderHook(() => useAdminMCPExternal());

    expect(result.current.servers).toEqual([]);
  });

  it('should reflect loading state', () => {
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      loading: true,
    } as never);

    const { result } = renderHook(() => useAdminMCPExternal());

    expect(result.current.loading).toBe(true);
  });

  it('should add server via apiClient.post and refetch', async () => {
    const refetchMock = vi
      .fn()
      .mockResolvedValue([makeServer(), makeServer('server-2')]);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refetchMock,
    } as never);
    vi.mocked(apiClient).post.mockResolvedValue(makeServer('server-2'));

    const { result } = renderHook(() => useAdminMCPExternal());

    const newServerData = {
      serverId: 'new-server',
      name: 'New MCP Server',
      transport: 'http',
      url: 'https://new-mcp.example.com',
    };

    await act(async () => {
      await result.current.addServer(newServerData);
    });

    expect(vi.mocked(apiClient).post).toHaveBeenCalledWith(
      '/admin/mcp/external-servers',
      newServerData
    );
    expect(refetchMock).toHaveBeenCalled();
  });

  it('should update server via apiClient.patch and refetch', async () => {
    const refetchMock = vi.fn().mockResolvedValue([makeServer()]);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refetchMock,
    } as never);
    vi.mocked(apiClient).patch.mockResolvedValue({
      ...makeServer(),
      name: 'Updated Name',
    });

    const { result } = renderHook(() => useAdminMCPExternal());

    await act(async () => {
      await result.current.updateServer('server-1', { name: 'Updated Name' });
    });

    expect(vi.mocked(apiClient).patch).toHaveBeenCalledWith(
      '/admin/mcp/external-servers/server-1',
      { name: 'Updated Name' }
    );
    expect(refetchMock).toHaveBeenCalled();
  });

  it('should remove server via apiClient.delete and refetch', async () => {
    const refetchMock = vi.fn().mockResolvedValue([]);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refetchMock,
    } as never);
    vi.mocked(apiClient).delete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAdminMCPExternal());

    await act(async () => {
      await result.current.removeServer('server-1');
    });

    expect(vi.mocked(apiClient).delete).toHaveBeenCalledWith(
      '/admin/mcp/external-servers/server-1'
    );
    expect(refetchMock).toHaveBeenCalled();
  });

  it('should connect server via apiClient.post and refetch', async () => {
    const refetchMock = vi.fn().mockResolvedValue([makeServer()]);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refetchMock,
    } as never);
    vi.mocked(apiClient).post.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAdminMCPExternal());

    await act(async () => {
      await result.current.connectServer('server-1');
    });

    expect(vi.mocked(apiClient).post).toHaveBeenCalledWith(
      '/admin/mcp/external-servers/server-1/connect'
    );
    expect(refetchMock).toHaveBeenCalled();
  });

  it('should disconnect server via apiClient.post and refetch', async () => {
    const refetchMock = vi.fn().mockResolvedValue([makeServer()]);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refetchMock,
    } as never);
    vi.mocked(apiClient).post.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAdminMCPExternal());

    await act(async () => {
      await result.current.disconnectServer('server-1');
    });

    expect(vi.mocked(apiClient).post).toHaveBeenCalledWith(
      '/admin/mcp/external-servers/server-1/disconnect'
    );
    expect(refetchMock).toHaveBeenCalled();
  });

  it('should list tools via apiClient.get', async () => {
    const tools = [
      { name: 'search_code', description: 'Search code', inputSchema: {} },
      { name: 'create_pr', description: 'Create PR', inputSchema: {} },
    ];
    vi.mocked(apiClient).get.mockResolvedValue(tools);

    const { result } = renderHook(() => useAdminMCPExternal());

    let resultTools;
    await act(async () => {
      resultTools = await result.current.listTools('server-1');
    });

    expect(vi.mocked(apiClient).get).toHaveBeenCalledWith(
      '/admin/mcp/external-servers/server-1/tools'
    );
    expect(resultTools).toEqual(tools);
  });

  it('should return empty array from listTools when API returns null/undefined', async () => {
    vi.mocked(apiClient).get.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAdminMCPExternal());

    let resultTools;
    await act(async () => {
      resultTools = await result.current.listTools('server-1');
    });

    expect(resultTools).toEqual([]);
  });

  it('should set actionLoading true during operations and reset after', async () => {
    let resolveAction: (value: unknown) => void;
    const actionPromise = new Promise((resolve) => {
      resolveAction = resolve;
    });

    vi.mocked(apiClient).post.mockReturnValue(actionPromise);
    const refetchMock = vi.fn().mockResolvedValue([]);
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      execute: refetchMock,
    } as never);

    const { result } = renderHook(() => useAdminMCPExternal());

    // Start operation but don't await
    let operationPromise: Promise<void>;
    act(() => {
      operationPromise = result.current.connectServer('server-1');
    });

    // Check loading state is true while operation is pending
    expect(result.current.actionLoading).toBe(true);

    // Resolve the operation
    await act(async () => {
      resolveAction!({ success: true });
      await operationPromise;
    });

    expect(result.current.actionLoading).toBe(false);
  });

  it('should reflect error from useApiGet', () => {
    const mockError = { message: 'Server error', status: 500 };
    mockUseApiGet.mockReturnValue({
      ...makeApiGetMock(),
      error: mockError as never,
    } as never);

    const { result } = renderHook(() => useAdminMCPExternal());

    expect(result.current.error).toEqual(mockError);
  });
});
