/**
 * SWR Hooks Tests for AI Social Module
 *
 * Basic smoke tests to verify SWR hooks functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useSocialConnectionsSWR,
  useSocialConnectionSWR,
  useSocialConnectionByPlatformSWR,
  useSocialContentsSWR,
  useSocialContentSWR,
  useSocialPublishLogsSWR,
  mutateConnections,
  mutateContents,
  invalidateConnectionsCaches,
  invalidateContentsCaches,
} from '../useSocialSWR';
import type {
  UseSocialConnectionsResult,
  UseSocialContentsResult,
} from '../useSocialSWR';
import * as api from '@/services/ai-social/api';

// Mock the API
vi.mock('@/services/ai-social/api', () => ({
  getConnections: vi.fn(),
  getConnection: vi.fn(),
  getConnectionByPlatform: vi.fn(),
  getContents: vi.fn(),
  getContent: vi.fn(),
  getPublishLogs: vi.fn(),
}));

describe('useSocialConnectionsSWR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch connections successfully', async () => {
    const mockConnections = [
      {
        id: '1',
        userId: 'user-1',
        platformType: 'WECHAT_MP' as const,
        accountId: 'account-1',
        accountName: 'Test Account',
        avatarUrl: null,
        isActive: true,
        sessionData: null,
        lastCheckAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    vi.mocked(api.getConnections).mockResolvedValue(mockConnections as any);

    const { result } = renderHook(() => useSocialConnectionsSWR());

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.connections).toEqual([]);

    // Wait for data to load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.connections).toEqual(mockConnections);
    expect(api.getConnections).toHaveBeenCalledTimes(1);
  });
});

describe('useSocialContentsSWR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch contents successfully', async () => {
    const mockData = {
      items: [
        {
          id: '1',
          userId: 'user-1',
          connectionId: null,
          title: 'Test Content',
          content: 'Test content body',
          contentType: 'WECHAT_ARTICLE' as const,
          sourceType: 'MANUAL' as const,
          sourceId: null,
          externalUrl: null,
          status: 'DRAFT' as const,
          reviewStatus: 'NOT_SUBMITTED' as const,
          scheduledAt: null,
          publishedAt: null,
          platformArticleId: null,
          platformArticleUrl: null,
          coverImage: null,
          excerpt: null,
          tags: [],
          metadata: null,
          retryCount: 0,
          lastError: null,
          complianceCheckedAt: null,
          complianceResult: null,
          aiGeneratedAt: null,
          aiModelUsed: null,
          aiPrompt: null,
          regenerationCount: 0,
          reviewedBy: null,
          reviewedAt: null,
          reviewNotes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    };

    vi.mocked(api.getContents).mockResolvedValue(mockData as any);

    const { result } = renderHook(() => useSocialContentsSWR());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.contents).toEqual(mockData.items);
    expect(result.current.total).toBe(1);
  });

  it('should support filtering by status', async () => {
    const mockData = {
      items: [],
      total: 0,
    };

    vi.mocked(api.getContents).mockResolvedValue(mockData);

    const { result } = renderHook(() =>
      useSocialContentsSWR({ status: 'PUBLISHED' })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(api.getContents).toHaveBeenCalledWith({ status: 'PUBLISHED' });
  });
});

// ---------------------------------------------------------------------------
// useSocialConnectionSWR
// ---------------------------------------------------------------------------
describe('useSocialConnectionSWR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null connection when id is null', () => {
    const { result } = renderHook(() => useSocialConnectionSWR(null));
    expect(result.current.connection).toBeNull();
  });

  it('does not fetch when enabled=false', () => {
    const { result } = renderHook(() =>
      useSocialConnectionSWR('conn-1', false)
    );
    expect(result.current.connection).toBeNull();
    expect(api.getConnection).not.toHaveBeenCalled();
  });

  it('fetches connection by id when enabled', async () => {
    const mockConn = { id: 'conn-1', platformType: 'WECHAT_MP' as const };
    vi.mocked(api.getConnection).mockResolvedValue(
      mockConn as ReturnType<typeof api.getConnection> extends Promise<infer T>
        ? T
        : never
    );

    const { result } = renderHook(() => useSocialConnectionSWR('conn-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.connection).toEqual(mockConn);
    expect(api.getConnection).toHaveBeenCalledWith('conn-1');
  });

  it('exposes refresh function', async () => {
    vi.mocked(api.getConnection).mockResolvedValue(
      null as unknown as Awaited<ReturnType<typeof api.getConnection>>
    );

    const { result } = renderHook(() => useSocialConnectionSWR('conn-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(typeof result.current.refresh).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// useSocialConnectionByPlatformSWR
// ---------------------------------------------------------------------------
describe('useSocialConnectionByPlatformSWR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when platformType is null', () => {
    const { result } = renderHook(() => useSocialConnectionByPlatformSWR(null));
    expect(result.current.connection).toBeNull();
  });

  it('does not fetch when enabled=false', () => {
    const { result } = renderHook(() =>
      useSocialConnectionByPlatformSWR('WECHAT_MP', false)
    );
    expect(result.current.connection).toBeNull();
    expect(api.getConnectionByPlatform).not.toHaveBeenCalled();
  });

  it('fetches connection by platform type when enabled', async () => {
    const mockConn = { id: 'conn-2', platformType: 'XIAOHONGSHU' as const };
    vi.mocked(api.getConnectionByPlatform).mockResolvedValue(
      mockConn as ReturnType<
        typeof api.getConnectionByPlatform
      > extends Promise<infer T>
        ? T
        : never
    );

    const { result } = renderHook(() =>
      useSocialConnectionByPlatformSWR('XIAOHONGSHU')
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.connection).toEqual(mockConn);
    expect(api.getConnectionByPlatform).toHaveBeenCalledWith('XIAOHONGSHU');
  });
});

// ---------------------------------------------------------------------------
// useSocialContentSWR
// ---------------------------------------------------------------------------
describe('useSocialContentSWR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null content when id is null', () => {
    const { result } = renderHook(() => useSocialContentSWR(null));
    expect(result.current.content).toBeNull();
  });

  it('does not fetch when enabled=false', () => {
    const { result } = renderHook(() =>
      useSocialContentSWR('content-1', false)
    );
    expect(result.current.content).toBeNull();
    expect(api.getContent).not.toHaveBeenCalled();
  });

  it('fetches content by id when enabled', async () => {
    const mockContent = { id: 'content-1', title: 'Test' };
    vi.mocked(api.getContent).mockResolvedValue(
      mockContent as ReturnType<typeof api.getContent> extends Promise<infer T>
        ? T
        : never
    );

    const { result } = renderHook(() => useSocialContentSWR('content-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.content).toEqual(mockContent);
    expect(api.getContent).toHaveBeenCalledWith('content-1');
  });
});

// ---------------------------------------------------------------------------
// useSocialPublishLogsSWR
// ---------------------------------------------------------------------------
describe('useSocialPublishLogsSWR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty logs when contentId is null', () => {
    const { result } = renderHook(() => useSocialPublishLogsSWR(null));
    expect(result.current.logs).toEqual([]);
  });

  it('does not fetch when enabled=false', () => {
    const { result } = renderHook(() =>
      useSocialPublishLogsSWR('content-1', false)
    );
    expect(result.current.logs).toEqual([]);
    expect(api.getPublishLogs).not.toHaveBeenCalled();
  });

  it('fetches publish logs for content when enabled', async () => {
    const mockLogs = [
      { id: 'log-1', contentId: 'content-1', status: 'SUCCESS' as const },
    ];
    vi.mocked(api.getPublishLogs).mockResolvedValue(
      mockLogs as ReturnType<typeof api.getPublishLogs> extends Promise<infer T>
        ? T
        : never
    );

    const { result } = renderHook(() => useSocialPublishLogsSWR('content-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.logs).toEqual(mockLogs);
    expect(api.getPublishLogs).toHaveBeenCalledWith('content-1');
  });

  it('exposes refresh function', async () => {
    vi.mocked(api.getPublishLogs).mockResolvedValue(
      [] as ReturnType<typeof api.getPublishLogs> extends Promise<infer T>
        ? T
        : never
    );

    const { result } = renderHook(() => useSocialPublishLogsSWR('content-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(typeof result.current.refresh).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// useSocialConnectionsSWR - disabled state
// ---------------------------------------------------------------------------
describe('useSocialConnectionsSWR - disabled state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch when enabled=false', () => {
    const { result } = renderHook(() => useSocialConnectionsSWR(false));
    expect(result.current.connections).toEqual([]);
    expect(api.getConnections).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// mutateConnections utility
// ---------------------------------------------------------------------------
describe('mutateConnections', () => {
  it('calls mutate with the updater function', async () => {
    const mockConn = { id: 'c1' } as Record<string, unknown>;
    const currentData = [{ id: 'c1' }];
    const mockMutate = vi
      .fn()
      .mockImplementation(
        async (
          updater: (
            c: typeof currentData | undefined
          ) => typeof currentData | undefined
        ) => {
          return updater(currentData);
        }
      ) as unknown as UseSocialConnectionsResult['mutate'];

    await mutateConnections(mockMutate, (current) => [
      ...current,
      { id: 'c2' } as (typeof current)[0],
    ]);

    expect(mockMutate).toHaveBeenCalled();
  });

  it('handles undefined current data gracefully', async () => {
    const mockMutate = vi
      .fn()
      .mockImplementation(async (updater: (c: undefined) => undefined) => {
        return updater(undefined);
      }) as unknown as UseSocialConnectionsResult['mutate'];

    // Should not throw
    await expect(
      mutateConnections(mockMutate, (current) => current)
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// mutateContents utility
// ---------------------------------------------------------------------------
describe('mutateContents', () => {
  it('calls mutate with the updater function', async () => {
    const currentData = { items: [], total: 0 };
    const mockMutate = vi
      .fn()
      .mockImplementation(
        async (
          updater: (
            c: typeof currentData | undefined
          ) => typeof currentData | undefined
        ) => {
          return updater(currentData);
        }
      ) as unknown as UseSocialContentsResult['mutate'];

    await mutateContents(mockMutate, (current) => ({
      ...current,
      total: current.total + 1,
    }));

    expect(mockMutate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// invalidateConnectionsCaches utility
// ---------------------------------------------------------------------------
describe('invalidateConnectionsCaches', () => {
  it('calls mutate with a matcher for connections key', () => {
    const mockMutate = vi.fn().mockResolvedValue(undefined);

    invalidateConnectionsCaches(mockMutate);

    expect(mockMutate).toHaveBeenCalledWith(expect.any(Function), undefined, {
      revalidate: true,
    });

    // Verify the matcher function works correctly
    const matcher = mockMutate.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher('/social/connections')).toBe(true);
    expect(matcher('/social/contents')).toBe(false);
    expect(matcher(123)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// invalidateContentsCaches utility
// ---------------------------------------------------------------------------
describe('invalidateContentsCaches', () => {
  it('calls mutate with a matcher for contents key', () => {
    const mockMutate = vi.fn().mockResolvedValue(undefined);

    invalidateContentsCaches(mockMutate);

    expect(mockMutate).toHaveBeenCalledWith(expect.any(Function), undefined, {
      revalidate: true,
    });

    // Verify the matcher function works correctly
    const matcher = mockMutate.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher('/social/contents')).toBe(true);
    expect(matcher('/social/connections')).toBe(false);
  });
});
