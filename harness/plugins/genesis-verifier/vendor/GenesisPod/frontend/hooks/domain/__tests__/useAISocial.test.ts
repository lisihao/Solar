/**
 * Tests for hooks/domain/useAISocial.ts
 *
 * Covers all six sub-hooks exported from the file plus the combined useAISocial
 * hook. Every API call is mocked at the @/services/ai-social/api module boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const {
  mockGetConnections,
  mockGetConnection,
  mockGetConnectionByPlatform,
  mockUpsertConnection,
  mockDeleteConnection,
  mockTestConnection,
  mockRefreshConnection,
  mockInitConnection,
  mockVerifyConnection,
  mockGetContents,
  mockGetContent,
  mockCreateContent,
  mockUpdateContent,
  mockDeleteContent,
  mockProcessUrl,
  mockProcessSource,
  mockRegenerateContent,
  mockCheckCompliance,
  mockApproveContent,
  mockRejectContent,
  mockRequestRevision,
  mockResubmitForReview,
  mockPublishContent,
  mockScheduleContent,
  mockCancelSchedule,
  mockGetPublishLogs,
  mockGetExploreSources,
  mockGetResearchSources,
  mockGetOfficeSources,
  mockGetWritingSources,
  mockXhsGetLoginStatus,
  mockXhsListFeeds,
  mockXhsSearchFeeds,
  mockXhsGetFeedDetail,
  mockXhsPostComment,
  mockXhsGetUserProfile,
} = vi.hoisted(() => ({
  mockGetConnections: vi.fn(),
  mockGetConnection: vi.fn(),
  mockGetConnectionByPlatform: vi.fn(),
  mockUpsertConnection: vi.fn(),
  mockDeleteConnection: vi.fn(),
  mockTestConnection: vi.fn(),
  mockRefreshConnection: vi.fn(),
  mockInitConnection: vi.fn(),
  mockVerifyConnection: vi.fn(),
  mockGetContents: vi.fn(),
  mockGetContent: vi.fn(),
  mockCreateContent: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockDeleteContent: vi.fn(),
  mockProcessUrl: vi.fn(),
  mockProcessSource: vi.fn(),
  mockRegenerateContent: vi.fn(),
  mockCheckCompliance: vi.fn(),
  mockApproveContent: vi.fn(),
  mockRejectContent: vi.fn(),
  mockRequestRevision: vi.fn(),
  mockResubmitForReview: vi.fn(),
  mockPublishContent: vi.fn(),
  mockScheduleContent: vi.fn(),
  mockCancelSchedule: vi.fn(),
  mockGetPublishLogs: vi.fn(),
  mockGetExploreSources: vi.fn(),
  mockGetResearchSources: vi.fn(),
  mockGetOfficeSources: vi.fn(),
  mockGetWritingSources: vi.fn(),
  mockXhsGetLoginStatus: vi.fn(),
  mockXhsListFeeds: vi.fn(),
  mockXhsSearchFeeds: vi.fn(),
  mockXhsGetFeedDetail: vi.fn(),
  mockXhsPostComment: vi.fn(),
  mockXhsGetUserProfile: vi.fn(),
}));

vi.mock('@/services/ai-social/api', () => ({
  getConnections: mockGetConnections,
  getConnection: mockGetConnection,
  getConnectionByPlatform: mockGetConnectionByPlatform,
  upsertConnection: mockUpsertConnection,
  deleteConnection: mockDeleteConnection,
  testConnection: mockTestConnection,
  refreshConnection: mockRefreshConnection,
  initConnection: mockInitConnection,
  verifyConnection: mockVerifyConnection,
  getContents: mockGetContents,
  getContent: mockGetContent,
  createContent: mockCreateContent,
  updateContent: mockUpdateContent,
  deleteContent: mockDeleteContent,
  processUrl: mockProcessUrl,
  processSource: mockProcessSource,
  regenerateContent: mockRegenerateContent,
  checkCompliance: mockCheckCompliance,
  approveContent: mockApproveContent,
  rejectContent: mockRejectContent,
  requestRevision: mockRequestRevision,
  resubmitForReview: mockResubmitForReview,
  publishContent: mockPublishContent,
  scheduleContent: mockScheduleContent,
  cancelSchedule: mockCancelSchedule,
  getPublishLogs: mockGetPublishLogs,
  getExploreSources: mockGetExploreSources,
  getResearchSources: mockGetResearchSources,
  getOfficeSources: mockGetOfficeSources,
  getWritingSources: mockGetWritingSources,
  xhsGetLoginStatus: mockXhsGetLoginStatus,
  xhsListFeeds: mockXhsListFeeds,
  xhsSearchFeeds: mockXhsSearchFeeds,
  xhsGetFeedDetail: mockXhsGetFeedDetail,
  xhsPostComment: mockXhsPostComment,
  xhsGetUserProfile: mockXhsGetUserProfile,
}));

import {
  useSocialConnections,
  useSocialContents,
  useSocialAIEngine,
  useSocialReview,
  useSocialPublish,
  useSocialSources,
  useXhsFeatures,
  useAISocial,
} from '../useAISocial';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONN = {
  id: 'conn-1',
  platformType: 'XIAOHONGSHU' as const,
  status: 'ACTIVE',
};

const CONTENT = { id: 'c-1', title: 'Test', status: 'DRAFT' };

beforeEach(() => {
  vi.resetAllMocks();
});

// ===========================================================================
// useSocialConnections
// ===========================================================================

describe('useSocialConnections', () => {
  it('fetchConnections - sets connections on success', async () => {
    mockGetConnections.mockResolvedValue([CONN]);

    const { result } = renderHook(() => useSocialConnections());

    await act(async () => {
      await result.current.fetchConnections();
    });

    expect(result.current.connections).toEqual([CONN]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetchConnections - sets error on failure', async () => {
    mockGetConnections.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSocialConnections());

    await act(async () => {
      await result.current.fetchConnections();
    });

    expect(result.current.connections).toEqual([]);
    expect(result.current.error).toBe('Network error');
  });

  it('saveConnection - upserts and deduplicates existing connection', async () => {
    mockGetConnections.mockResolvedValue([CONN]);
    const updated = { ...CONN, status: 'ACTIVE' };
    mockUpsertConnection.mockResolvedValue(updated);

    const { result } = renderHook(() => useSocialConnections());
    await act(async () => {
      await result.current.fetchConnections();
    });

    await act(async () => {
      await result.current.saveConnection('XIAOHONGSHU', { cookies: 'x=1' });
    });

    // existing connection should be updated (not duplicated)
    expect(result.current.connections).toHaveLength(1);
    expect(result.current.connections[0]).toEqual(updated);
  });

  it('saveConnection - appends when connection is new', async () => {
    mockGetConnections.mockResolvedValue([]);
    mockUpsertConnection.mockResolvedValue(CONN);

    const { result } = renderHook(() => useSocialConnections());
    await act(async () => {
      await result.current.saveConnection('XIAOHONGSHU', { cookies: 'x=1' });
    });

    expect(result.current.connections).toHaveLength(1);
  });

  it('removeConnection - filters connection by platformType', async () => {
    mockGetConnections.mockResolvedValue([CONN]);
    mockDeleteConnection.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSocialConnections());
    await act(async () => {
      await result.current.fetchConnections();
    });
    await act(async () => {
      await result.current.removeConnection('XIAOHONGSHU');
    });

    expect(result.current.connections).toHaveLength(0);
  });

  it('removeConnection - returns false on error', async () => {
    mockDeleteConnection.mockRejectedValue(new Error('Delete failed'));

    const { result } = renderHook(() => useSocialConnections());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.removeConnection('XIAOHONGSHU');
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('Delete failed');
  });

  it('startConnection - returns result and adds new connection when status=existing', async () => {
    mockInitConnection.mockResolvedValue({
      status: 'existing',
      connection: CONN,
    });

    const { result } = renderHook(() => useSocialConnections());
    let res: unknown;
    await act(async () => {
      res = await result.current.startConnection('XIAOHONGSHU');
    });

    expect(res).toMatchObject({ status: 'existing' });
    expect(result.current.connections).toHaveLength(1);
  });

  it('checkConnection - updates existing connection in state', async () => {
    const updated = { ...CONN, status: 'VERIFIED' };
    mockGetConnections.mockResolvedValue([CONN]);
    mockVerifyConnection.mockResolvedValue({
      status: 'success',
      connection: updated,
    });

    const { result } = renderHook(() => useSocialConnections());
    await act(async () => {
      await result.current.fetchConnections();
    });
    await act(async () => {
      await result.current.checkConnection('XIAOHONGSHU');
    });

    expect(result.current.connections[0]).toEqual(updated);
  });
});

// ===========================================================================
// useSocialContents
// ===========================================================================

describe('useSocialContents', () => {
  it('fetchContents - sets items and total', async () => {
    mockGetContents.mockResolvedValue({ items: [CONTENT], total: 1 });

    const { result } = renderHook(() => useSocialContents());

    await act(async () => {
      await result.current.fetchContents({ limit: 10, offset: 0 });
    });

    expect(result.current.contents).toEqual([CONTENT]);
    expect(result.current.total).toBe(1);
    expect(result.current.loading).toBe(false);
  });

  it('fetchContents - sets error on failure', async () => {
    mockGetContents.mockRejectedValue(new Error('Fetch failed'));

    const { result } = renderHook(() => useSocialContents());
    await act(async () => {
      await result.current.fetchContents();
    });

    expect(result.current.error).toBe('Fetch failed');
    expect(result.current.contents).toEqual([]);
  });

  it('addContent - prepends content and increments total', async () => {
    mockCreateContent.mockResolvedValue(CONTENT);

    const { result } = renderHook(() => useSocialContents());
    await act(async () => {
      await result.current.addContent({
        title: 'Test',
        platformType: 'XIAOHONGSHU',
      } as never);
    });

    expect(result.current.contents[0]).toEqual(CONTENT);
    expect(result.current.total).toBe(1);
  });

  it('editContent - updates matching content in state', async () => {
    const updated = { ...CONTENT, title: 'Updated' };
    mockGetContents.mockResolvedValue({ items: [CONTENT], total: 1 });
    mockUpdateContent.mockResolvedValue(updated);

    const { result } = renderHook(() => useSocialContents());
    await act(async () => {
      await result.current.fetchContents();
    });
    await act(async () => {
      await result.current.editContent('c-1', { title: 'Updated' });
    });

    expect(result.current.contents[0].title).toBe('Updated');
  });

  it('removeContent - removes content and decrements total', async () => {
    mockGetContents.mockResolvedValue({ items: [CONTENT], total: 1 });
    mockDeleteContent.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSocialContents());
    await act(async () => {
      await result.current.fetchContents();
    });
    await act(async () => {
      await result.current.removeContent('c-1');
    });

    expect(result.current.contents).toHaveLength(0);
    expect(result.current.total).toBe(0);
  });
});

// ===========================================================================
// useSocialAIEngine
// ===========================================================================

describe('useSocialAIEngine', () => {
  it('processFromUrl - returns result and clears loading', async () => {
    const res = { id: 'c-1', generatedContent: 'text' };
    mockProcessUrl.mockResolvedValue(res);

    const { result } = renderHook(() => useSocialAIEngine());
    let value: unknown;
    await act(async () => {
      value = await result.current.processFromUrl({
        url: 'https://example.com',
        platformType: 'XIAOHONGSHU',
      } as unknown as Parameters<typeof result.current.processFromUrl>[0]);
    });

    expect(value).toEqual(res);
    expect(result.current.loading).toBe(false);
  });

  it('processFromUrl - sets error and re-throws', async () => {
    mockProcessUrl.mockRejectedValue(new Error('Bad URL'));

    const { result } = renderHook(() => useSocialAIEngine());

    let thrown: Error | undefined;
    await act(async () => {
      try {
        await result.current.processFromUrl({
          url: '',
          platformType: 'XIAOHONGSHU',
        } as unknown as Parameters<typeof result.current.processFromUrl>[0]);
      } catch (e) {
        thrown = e as Error;
      }
    });

    expect(thrown?.message).toBe('Bad URL');
    expect(result.current.error).toBe('Bad URL');
  });

  it('regenerate - returns regenerated content', async () => {
    mockRegenerateContent.mockResolvedValue({
      ...CONTENT,
      title: 'Regenerated',
    });

    const { result } = renderHook(() => useSocialAIEngine());
    let val: unknown;
    await act(async () => {
      val = await result.current.regenerate('c-1');
    });

    expect(val).toMatchObject({ title: 'Regenerated' });
  });

  it('checkCompliance - returns compliance result', async () => {
    mockCheckCompliance.mockResolvedValue({ passed: true, issues: [] });

    const { result } = renderHook(() => useSocialAIEngine());
    let val: unknown;
    await act(async () => {
      val = await result.current.checkCompliance('c-1');
    });

    expect(val).toMatchObject({ passed: true });
  });
});

// ===========================================================================
// useSocialReview
// ===========================================================================

describe('useSocialReview', () => {
  it('approve - calls approveContent API', async () => {
    mockApproveContent.mockResolvedValue({
      ...CONTENT,
      reviewStatus: 'APPROVED',
    });

    const { result } = renderHook(() => useSocialReview());
    await act(async () => {
      await result.current.approve('c-1', 'Looks good');
    });

    expect(mockApproveContent).toHaveBeenCalledWith('c-1', 'Looks good');
  });

  it('reject - sets error on failure', async () => {
    mockRejectContent.mockRejectedValue(new Error('Reject error'));

    const { result } = renderHook(() => useSocialReview());
    await act(async () => {
      await result.current.reject('c-1', 'Bad');
    });

    expect(result.current.error).toBe('Reject error');
  });

  it('requestRevision - calls requestRevision API', async () => {
    mockRequestRevision.mockResolvedValue({
      ...CONTENT,
      reviewStatus: 'REVISION_REQUESTED',
    });

    const { result } = renderHook(() => useSocialReview());
    await act(async () => {
      await result.current.requestRevision('c-1', 'Please revise');
    });

    expect(mockRequestRevision).toHaveBeenCalledWith('c-1', 'Please revise');
  });

  it('resubmit - calls resubmitForReview API', async () => {
    mockResubmitForReview.mockResolvedValue({
      ...CONTENT,
      reviewStatus: 'PENDING',
    });

    const { result } = renderHook(() => useSocialReview());
    let val: unknown;
    await act(async () => {
      val = await result.current.resubmit('c-1');
    });

    expect(val).toMatchObject({ reviewStatus: 'PENDING' });
  });
});

// ===========================================================================
// useSocialPublish
// ===========================================================================

describe('useSocialPublish', () => {
  it('publish - returns success result', async () => {
    mockPublishContent.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useSocialPublish());
    let val: unknown;
    await act(async () => {
      val = await result.current.publish('c-1', 'conn-1');
    });

    expect(val).toMatchObject({ success: true });
    expect(mockPublishContent).toHaveBeenCalledWith('c-1', {
      connectionId: 'conn-1',
    });
  });

  it('publish - returns error object on failure', async () => {
    mockPublishContent.mockRejectedValue(new Error('Publish failed'));

    const { result } = renderHook(() => useSocialPublish());
    let val: unknown;
    await act(async () => {
      val = await result.current.publish('c-1');
    });

    expect(val).toMatchObject({
      success: false,
      errorMessage: 'Publish failed',
    });
  });

  it('schedule - calls scheduleContent with correct params', async () => {
    mockScheduleContent.mockResolvedValue({
      ...CONTENT,
      scheduledAt: '2026-01-01',
    });

    const { result } = renderHook(() => useSocialPublish());
    await act(async () => {
      await result.current.schedule('c-1', '2026-01-01', 'conn-1');
    });

    expect(mockScheduleContent).toHaveBeenCalledWith(
      'c-1',
      '2026-01-01',
      'conn-1'
    );
  });

  it('unschedule - calls cancelSchedule API', async () => {
    mockCancelSchedule.mockResolvedValue({ ...CONTENT, scheduledAt: null });

    const { result } = renderHook(() => useSocialPublish());
    await act(async () => {
      await result.current.unschedule('c-1');
    });

    expect(mockCancelSchedule).toHaveBeenCalledWith('c-1');
  });

  it('fetchLogs - sets logs in state', async () => {
    const logs = [{ id: 'l-1', status: 'SUCCESS' }];
    mockGetPublishLogs.mockResolvedValue(logs);

    const { result } = renderHook(() => useSocialPublish());
    await act(async () => {
      await result.current.fetchLogs('c-1');
    });

    expect(result.current.logs).toEqual(logs);
  });
});

// ===========================================================================
// useSocialSources
// ===========================================================================

describe('useSocialSources', () => {
  it('fetchExplore - returns explore sources', async () => {
    mockGetExploreSources.mockResolvedValue({
      items: [{ id: 's-1' }],
      total: 1,
    });

    const { result } = renderHook(() => useSocialSources());
    let val: unknown;
    await act(async () => {
      val = await result.current.fetchExplore({ limit: 5 });
    });

    expect(val).toMatchObject({ total: 1 });
    expect(result.current.loading).toBe(false);
  });

  it('fetchResearch - returns empty on error', async () => {
    mockGetResearchSources.mockRejectedValue(new Error('Research error'));

    const { result } = renderHook(() => useSocialSources());
    let val: unknown;
    await act(async () => {
      val = await result.current.fetchResearch();
    });

    expect(val).toEqual({ items: [], total: 0 });
    expect(result.current.error).toBe('Research error');
  });

  it('fetchOffice - calls getOfficeSources', async () => {
    mockGetOfficeSources.mockResolvedValue({ items: [], total: 0 });

    const { result } = renderHook(() => useSocialSources());
    await act(async () => {
      await result.current.fetchOffice();
    });

    expect(mockGetOfficeSources).toHaveBeenCalled();
  });

  it('fetchWriting - calls getWritingSources', async () => {
    mockGetWritingSources.mockResolvedValue({ items: [], total: 0 });

    const { result } = renderHook(() => useSocialSources());
    await act(async () => {
      await result.current.fetchWriting({ offset: 0 });
    });

    expect(mockGetWritingSources).toHaveBeenCalledWith({ offset: 0 });
  });
});

// ===========================================================================
// useXhsFeatures
// ===========================================================================

describe('useXhsFeatures', () => {
  it('getLoginStatus - returns login status', async () => {
    mockXhsGetLoginStatus.mockResolvedValue({ loggedIn: true });

    const { result } = renderHook(() => useXhsFeatures());
    let val: unknown;
    await act(async () => {
      val = await result.current.getLoginStatus();
    });

    expect(val).toEqual({ loggedIn: true });
  });

  it('getLoginStatus - returns loggedIn:false on error', async () => {
    mockXhsGetLoginStatus.mockRejectedValue(new Error('XHS error'));

    const { result } = renderHook(() => useXhsFeatures());
    let val: unknown;
    await act(async () => {
      val = await result.current.getLoginStatus();
    });

    expect(val).toEqual({ loggedIn: false });
  });

  it('listFeeds - returns feeds on success', async () => {
    const feeds = [{ id: 'f-1', title: 'Feed' }];
    mockXhsListFeeds.mockResolvedValue(feeds);

    const { result } = renderHook(() => useXhsFeatures());
    let val: unknown;
    await act(async () => {
      val = await result.current.listFeeds();
    });

    expect(val).toEqual(feeds);
  });

  it('searchFeeds - passes keyword to API', async () => {
    mockXhsSearchFeeds.mockResolvedValue([]);

    const { result } = renderHook(() => useXhsFeatures());
    await act(async () => {
      await result.current.searchFeeds('travel');
    });

    expect(mockXhsSearchFeeds).toHaveBeenCalledWith('travel');
  });

  it('getFeedDetail - returns feed detail', async () => {
    const detail = { id: 'f-1', content: 'Full content' };
    mockXhsGetFeedDetail.mockResolvedValue(detail);

    const { result } = renderHook(() => useXhsFeatures());
    let val: unknown;
    await act(async () => {
      val = await result.current.getFeedDetail('f-1', 'token-x');
    });

    expect(val).toEqual(detail);
    expect(mockXhsGetFeedDetail).toHaveBeenCalledWith('f-1', 'token-x');
  });

  it('postComment - returns success result', async () => {
    mockXhsPostComment.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useXhsFeatures());
    let val: unknown;
    await act(async () => {
      val = await result.current.postComment('f-1', 'token-x', 'Great post!');
    });

    expect(val).toEqual({ success: true });
  });

  it('getUserProfile - returns user profile', async () => {
    const profile = { userId: 'u-1', nickname: 'Tester' };
    mockXhsGetUserProfile.mockResolvedValue(profile);

    const { result } = renderHook(() => useXhsFeatures());
    let val: unknown;
    await act(async () => {
      val = await result.current.getUserProfile('u-1', 'tok');
    });

    expect(val).toEqual(profile);
  });
});

// ===========================================================================
// useAISocial (combined)
// ===========================================================================

describe('useAISocial', () => {
  it('exposes all sub-hooks', () => {
    const { result } = renderHook(() => useAISocial());

    expect(result.current).toHaveProperty('connections');
    expect(result.current).toHaveProperty('contents');
    expect(result.current).toHaveProperty('aiEngine');
    expect(result.current).toHaveProperty('review');
    expect(result.current).toHaveProperty('publish');
    expect(result.current).toHaveProperty('sources');
    expect(result.current).toHaveProperty('xhs');
  });

  it('connections sub-hook is functional', async () => {
    mockGetConnections.mockResolvedValue([CONN]);

    const { result } = renderHook(() => useAISocial());
    await act(async () => {
      await result.current.connections.fetchConnections();
    });

    expect(result.current.connections.connections).toEqual([CONN]);
  });
});
