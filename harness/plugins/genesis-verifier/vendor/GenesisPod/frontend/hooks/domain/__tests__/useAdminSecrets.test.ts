import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/core', () => ({
  useApiGet: vi.fn(),
  useApiPost: vi.fn(),
  useApiPut: vi.fn(),
  useApiDelete: vi.fn(),
  useApiMutation: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { useApiGet, useApiPost } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import { useAdminSecrets } from '../useAdminSecrets';
import type { Secret } from '../useAdminSecrets';

const makeDefaultGet = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

const makeDefaultPost = (overrides = {}) => ({
  data: null,
  loading: false,
  error: null,
  execute: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  reset: vi.fn(),
  setData: vi.fn(),
  ...overrides,
});

const makeSecret = (overrides: Partial<Secret> = {}): Secret => ({
  id: 'secret-1',
  name: 'OPENAI_API_KEY',
  displayName: 'OpenAI API Key',
  category: 'AI_MODEL',
  description: 'OpenAI API key for GPT models',
  provider: 'OpenAI',
  isActive: true,
  maskedValue: '****-xxxx',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  lastAccessedAt: null,
  accessCount: 0,
  expiresAt: null,
  lastRotatedAt: null,
  ...overrides,
});

describe('useAdminSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());
  });

  it('returns empty secrets array when data is null', () => {
    const { result } = renderHook(() => useAdminSecrets());
    expect(result.current.secrets).toEqual([]);
    expect(result.current.secretNames).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns secrets list when data is available', () => {
    const secrets = [
      makeSecret(),
      makeSecret({ id: 'secret-2', name: 'ANTHROPIC_API_KEY' }),
    ];
    vi.mocked(useApiGet)
      .mockReturnValueOnce(makeDefaultGet({ data: secrets }))
      .mockReturnValueOnce(
        makeDefaultGet({ data: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] })
      );

    const { result } = renderHook(() => useAdminSecrets());
    expect(result.current.secrets).toHaveLength(2);
    expect(result.current.secrets[0].name).toBe('OPENAI_API_KEY');
  });

  it('returns secretNames when names API responds', () => {
    const names = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
    vi.mocked(useApiGet)
      .mockReturnValueOnce(makeDefaultGet())
      .mockReturnValueOnce(makeDefaultGet({ data: names }));

    const { result } = renderHook(() => useAdminSecrets());
    expect(result.current.secretNames).toEqual(names);
  });

  it('exposes loading=true when list is loading', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ loading: true }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    expect(result.current.loading).toBe(true);
    expect(result.current.isRefreshing).toBe(true);
  });

  it('exposes error from list API', () => {
    const error = { message: 'Forbidden', status: 403 } as never;
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet({ error }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    expect(result.current.error).not.toBeNull();
  });

  it('createSecret calls execute and refreshes secrets on success', async () => {
    const newSecret = makeSecret();
    const mockCreateExecute = vi.fn().mockResolvedValue(newSecret);
    const mockRefreshSecrets = vi.fn().mockResolvedValue(undefined);
    const mockRefreshNames = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useApiGet)
      .mockReturnValueOnce(makeDefaultGet({ execute: mockRefreshSecrets }))
      .mockReturnValueOnce(makeDefaultGet({ execute: mockRefreshNames }));
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultPost({ execute: mockCreateExecute })
    );

    const { result } = renderHook(() => useAdminSecrets());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.createSecret({
        name: 'NEW_KEY',
        displayName: 'New Key',
        value: 'secret-value',
        category: 'AI_MODEL',
      });
    });

    expect(returned).toEqual(newSecret);
    expect(mockCreateExecute).toHaveBeenCalled();
    expect(mockRefreshSecrets).toHaveBeenCalled();
    expect(mockRefreshNames).toHaveBeenCalled();
  });

  it('createSecret does not refresh when execute returns null', async () => {
    const mockCreateExecute = vi.fn().mockResolvedValue(null);
    const mockRefreshSecrets = vi.fn();

    vi.mocked(useApiGet)
      .mockReturnValueOnce(makeDefaultGet({ execute: mockRefreshSecrets }))
      .mockReturnValueOnce(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(
      makeDefaultPost({ execute: mockCreateExecute })
    );

    const { result } = renderHook(() => useAdminSecrets());
    await act(async () => {
      await result.current.createSecret({
        name: 'NEW_KEY',
        displayName: 'New Key',
        value: 'secret',
      });
    });

    expect(mockRefreshSecrets).not.toHaveBeenCalled();
  });

  it('updateSecret calls apiClient.patch and refreshes on success', async () => {
    const updatedSecret = makeSecret({ displayName: 'Updated Name' });
    const mockRefreshSecrets = vi.fn().mockResolvedValue(undefined);
    vi.mocked(apiClient.patch).mockResolvedValue(updatedSecret);
    vi.mocked(useApiGet)
      .mockReturnValueOnce(makeDefaultGet({ execute: mockRefreshSecrets }))
      .mockReturnValueOnce(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.updateSecret('OPENAI_API_KEY', {
        displayName: 'Updated Name',
      });
    });

    expect(returned).toEqual(updatedSecret);
    expect(vi.mocked(apiClient.patch)).toHaveBeenCalledWith(
      '/admin/secrets/OPENAI_API_KEY',
      { displayName: 'Updated Name' }
    );
    expect(mockRefreshSecrets).toHaveBeenCalled();
    expect(result.current.isUpdating).toBe(false);
  });

  it('deleteSecret calls apiClient.delete and refreshes secrets and names', async () => {
    const mockRefreshSecrets = vi.fn().mockResolvedValue(undefined);
    const mockRefreshNames = vi.fn().mockResolvedValue(undefined);
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);
    vi.mocked(useApiGet)
      .mockReturnValueOnce(makeDefaultGet({ execute: mockRefreshSecrets }))
      .mockReturnValueOnce(makeDefaultGet({ execute: mockRefreshNames }));
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    await act(async () => {
      await result.current.deleteSecret('OPENAI_API_KEY');
    });

    expect(vi.mocked(apiClient.delete)).toHaveBeenCalledWith(
      '/admin/secrets/OPENAI_API_KEY'
    );
    expect(mockRefreshSecrets).toHaveBeenCalled();
    expect(mockRefreshNames).toHaveBeenCalled();
    expect(result.current.isDeleting).toBe(false);
  });

  it('getSecretValue returns the value on success', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ value: 'sk-test-key-12345' });
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    let value: unknown;
    await act(async () => {
      value = await result.current.getSecretValue('OPENAI_API_KEY');
    });

    expect(value).toBe('sk-test-key-12345');
    expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith(
      '/admin/secrets/OPENAI_API_KEY/value'
    );
    expect(result.current.isGettingValue).toBe(false);
    expect(result.current.getValueError).toBeNull();
  });

  it('getSecretValue sets error and returns null on failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Unauthorized'));
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    let value: unknown;
    await act(async () => {
      value = await result.current.getSecretValue('OPENAI_API_KEY');
    });

    expect(value).toBeNull();
    expect(result.current.getValueError).toBe('Unauthorized');
    expect(result.current.isGettingValue).toBe(false);
  });

  it('getAccessLogs returns logs from API', async () => {
    const logs = [
      {
        id: 'log-1',
        secretId: 'secret-1',
        action: 'READ',
        actionStatus: 'SUCCESS',
        secretName: 'OPENAI_API_KEY',
        userId: 'user-1',
        userEmail: 'admin@example.com',
        ipAddress: '127.0.0.1',
        timestamp: '2026-01-01T00:00:00Z',
      },
    ];
    vi.mocked(apiClient.get).mockResolvedValue(logs);
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.getAccessLogs('OPENAI_API_KEY');
    });

    expect(returned).toEqual(logs);
    expect(result.current.isLoadingLogs).toBe(false);
  });

  it('getVersions returns version list from API', async () => {
    const versions = [
      {
        id: 'v-1',
        version: 1,
        checksum: 'abc123',
        createdBy: 'admin',
        createdAt: '2026-01-01T00:00:00Z',
        changeNote: 'Initial',
        isCurrent: true,
      },
    ];
    vi.mocked(apiClient.get).mockResolvedValue(versions);
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.getVersions('OPENAI_API_KEY');
    });

    expect(returned).toEqual(versions);
    expect(result.current.isLoadingVersions).toBe(false);
  });

  it('rollbackVersion calls apiClient.post and refreshes secrets', async () => {
    const mockRefreshSecrets = vi.fn().mockResolvedValue(undefined);
    vi.mocked(apiClient.post).mockResolvedValue(undefined);
    vi.mocked(useApiGet)
      .mockReturnValueOnce(makeDefaultGet({ execute: mockRefreshSecrets }))
      .mockReturnValueOnce(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    await act(async () => {
      await result.current.rollbackVersion('OPENAI_API_KEY', 1);
    });

    expect(vi.mocked(apiClient.post)).toHaveBeenCalledWith(
      '/admin/secrets/OPENAI_API_KEY/rollback/1'
    );
    expect(mockRefreshSecrets).toHaveBeenCalled();
    expect(result.current.isRollingBack).toBe(false);
  });

  it('exposes getVersionValue which returns value or null on error', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ value: 'old-secret-value' });
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost());

    const { result } = renderHook(() => useAdminSecrets());
    let value: unknown;
    await act(async () => {
      value = await result.current.getVersionValue('OPENAI_API_KEY', 1);
    });

    expect(value).toBe('old-secret-value');
  });

  it('exposes combined loading state across create/update/delete', () => {
    vi.mocked(useApiGet).mockReturnValue(makeDefaultGet());
    vi.mocked(useApiPost).mockReturnValue(makeDefaultPost({ loading: true }));

    const { result } = renderHook(() => useAdminSecrets());
    expect(result.current.loading).toBe(true);
    expect(result.current.isCreating).toBe(true);
  });
});
