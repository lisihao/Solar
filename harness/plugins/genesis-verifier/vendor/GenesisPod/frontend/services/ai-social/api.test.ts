/**
 * Tests for lib/api/ai-social.ts
 *
 * Uses raw fetch mocking (file uses its own fetchWithAuth with AbortController timeout).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const { mockGetAuthTokens } = vi.hoisted(() => ({
  mockGetAuthTokens: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: mockGetAuthTokens,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function wrappedResponse(data: unknown, status = 200): Response {
  return jsonResponse({ success: true, data }, status);
}

function emptyResponse(status = 200): Response {
  return new Response('', { status });
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------
import {
  getConnections,
  getConnection,
  getConnectionByPlatform,
  upsertConnection,
  deleteConnection,
  testConnection,
  refreshConnection,
  initConnection,
  verifyConnection,
  getContents,
  getContent,
  createContent,
  updateContent,
  deleteContent,
  processUrl,
  processSource,
  regenerateContent,
  checkCompliance,
  approveContent,
  rejectContent,
  requestRevision,
  resubmitForReview,
  publishContent,
  scheduleContent,
  cancelSchedule,
  getPublishLogs,
  getExploreSources,
  getResearchSources,
  getOfficeSources,
  getWritingSources,
  xhsGetLoginStatus,
  xhsListFeeds,
  xhsSearchFeeds,
  xhsGetFeedDetail,
  xhsPostComment,
  xhsGetUserProfile,
  getContentVersions,
  generateVersion,
  generateAllVersions,
  updateVersion,
  deleteVersion,
} from './api';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthTokens.mockReturnValue({ accessToken: 'test-token' });
  global.fetch = vi.fn();
});

// ---------------------------------------------------------------------------
// fetchWithAuth: core behaviour
// ---------------------------------------------------------------------------

describe('fetchWithAuth - core behaviour', () => {
  it('attaches Authorization header', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getConnections();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('omits Authorization header when no token', async () => {
    mockGetAuthTokens.mockReturnValue(null);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getConnections();

    const headers = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers;
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('unwraps { success, data } envelope', async () => {
    const conn = { id: 'conn-1', platformType: 'WECHAT_MP' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse(conn)
    );

    const result = await getConnection('conn-1');

    expect(result).toEqual(conn);
  });

  it('returns empty object for empty body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    const result = await deleteContent('c1');

    expect(result).toEqual({});
  });

  it('throws ApiError on non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse('Not found', 404)
    );

    await expect(getContent('bad-id')).rejects.toThrow('Not found');
  });

  it('converts 502 status to human-readable message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await expect(getContent('c1')).rejects.toThrow(
      'Service temporarily unavailable'
    );
  });

  it('converts 504 status to timeout message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('<html>Gateway Timeout</html>', {
        status: 504,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await expect(getContent('c1')).rejects.toThrow('Request timed out');
  });
});

// ---------------------------------------------------------------------------
// Platform Connection API
// ---------------------------------------------------------------------------

describe('getConnections', () => {
  it('calls connections endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'conn-1' }])
    );

    const result = await getConnections();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/connections'),
      expect.anything()
    );
    expect(result).toEqual([{ id: 'conn-1' }]);
  });
});

describe('getConnection', () => {
  it('calls connection by id endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'conn-1' })
    );

    await getConnection('conn-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/connections/conn-1'),
      expect.anything()
    );
  });
});

describe('getConnectionByPlatform', () => {
  it('calls platform-specific connection endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'conn-1', platformType: 'WECHAT_MP' })
    );

    await getConnectionByPlatform('WECHAT_MP');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-social/connections/platform/WECHAT_MP'
      ),
      expect.anything()
    );
  });
});

describe('upsertConnection', () => {
  it('sends POST to platform connection endpoint', async () => {
    const config = { cookies: 'session=abc' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'conn-1', platformType: 'WECHAT_MP' })
    );

    await upsertConnection('WECHAT_MP', config);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-social/connections/platform/WECHAT_MP'
      ),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(config) })
    );
  });
});

describe('deleteConnection', () => {
  it('sends DELETE to platform connection endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await deleteConnection('XIAOHONGSHU');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/connections/XIAOHONGSHU'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('testConnection', () => {
  it('sends POST to test endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, message: 'Connected' })
    );

    const result = await testConnection('conn-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/connections/conn-1/test'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ success: true });
  });
});

describe('refreshConnection', () => {
  it('sends POST to refresh endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'conn-1' })
    );

    await refreshConnection('conn-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/connections/conn-1/refresh'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('initConnection', () => {
  it('sends POST to init endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ status: 'pending', message: 'Scan QR code' })
    );

    const result = await initConnection('WECHAT_MP');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/connections/WECHAT_MP/init'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ status: 'pending' });
  });
});

describe('verifyConnection', () => {
  it('sends POST to verify endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ status: 'success', message: 'Connected' })
    );

    const result = await verifyConnection('WECHAT_MP');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/connections/WECHAT_MP/verify'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ status: 'success' });
  });
});

// ---------------------------------------------------------------------------
// Content API
// ---------------------------------------------------------------------------

describe('getContents', () => {
  it('calls contents endpoint without params by default', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        contents: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
      })
    );

    const result = await getContents();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/api/v1/ai-social/contents');
    expect(calledUrl).not.toContain('?');
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('transforms backend response format to { items, total }', async () => {
    const contents = [{ id: 'c1' }, { id: 'c2' }];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        contents,
        pagination: { total: 42, page: 1, limit: 20, totalPages: 3 },
      })
    );

    const result = await getContents();

    expect(result.items).toEqual(contents);
    expect(result.total).toBe(42);
  });

  it('appends status, contentType, and limit params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        contents: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
      })
    );

    await getContents({
      status: 'DRAFT',
      contentType: 'WECHAT_ARTICLE',
      limit: 10,
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('status=DRAFT');
    expect(calledUrl).toContain('contentType=WECHAT_ARTICLE');
    expect(calledUrl).toContain('limit=10');
  });

  it('converts offset to page number', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        contents: [],
        pagination: { total: 0, page: 3, limit: 20, totalPages: 0 },
      })
    );

    await getContents({ offset: 40, limit: 20 });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('page=3');
  });
});

describe('getContent', () => {
  it('calls content by id endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'c1', title: 'My Article' })
    );

    await getContent('c1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1'),
      expect.anything()
    );
  });
});

describe('createContent', () => {
  it('sends POST with content dto', async () => {
    const dto = {
      contentType: 'WECHAT_ARTICLE' as const,
      title: 'Test Article',
      content: 'Article body',
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'c-new', ...dto })
    );

    const result = await createContent(dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(dto) })
    );
    expect(result).toMatchObject({ id: 'c-new' });
  });
});

describe('updateContent', () => {
  it('sends PATCH with partial dto', async () => {
    const dto = { title: 'Updated Title' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'c1', ...dto })
    );

    await updateContent('c1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(dto) })
    );
  });
});

describe('deleteContent', () => {
  it('sends DELETE to content endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await deleteContent('c1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ---------------------------------------------------------------------------
// AI Engine API
// ---------------------------------------------------------------------------

describe('processUrl', () => {
  it('sends POST with url dto', async () => {
    const dto = {
      url: 'https://example.com',
      targetType: 'WECHAT_ARTICLE' as const,
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        content: { id: 'c1' },
        checkResult: { passed: true, issues: [], checkedAt: '' },
        message: 'Done',
      })
    );

    await processUrl(dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/ai/process-url'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(dto) })
    );
  });
});

describe('processSource', () => {
  it('sends POST with source dto', async () => {
    const dto = {
      sourceType: 'AI_RESEARCH' as const,
      sourceId: 'res-1',
      targetType: 'WECHAT_ARTICLE' as const,
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        content: { id: 'c1' },
        checkResult: { passed: true, issues: [], checkedAt: '' },
        message: 'Done',
      })
    );

    await processSource(dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/ai/process-source'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('regenerateContent', () => {
  it('sends POST to regenerate endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        content: { id: 'c1' },
        checkResult: { passed: true, issues: [], checkedAt: '' },
        message: 'Regenerated',
      })
    );

    await regenerateContent('c1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/ai/regenerate/c1'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('checkCompliance', () => {
  it('sends POST to compliance check endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ passed: true, issues: [], checkedAt: '2025-01-01' })
    );

    const result = await checkCompliance('c1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1/check'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ passed: true });
  });
});

// ---------------------------------------------------------------------------
// Review API
// ---------------------------------------------------------------------------

describe('approveContent', () => {
  it('sends POST to approve endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'c1', reviewStatus: 'APPROVED' })
    );

    await approveContent('c1', 'Looks good');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1/approve'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ note: 'Looks good' }),
      })
    );
  });
});

describe('rejectContent', () => {
  it('sends POST to reject endpoint with note', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'c1', reviewStatus: 'REJECTED' })
    );

    await rejectContent('c1', 'Needs revision');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1/reject'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ note: 'Needs revision' }),
      })
    );
  });
});

describe('requestRevision', () => {
  it('uses reject endpoint (backend shares endpoint)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'c1', reviewStatus: 'REJECTED' })
    );

    await requestRevision('c1', 'Please update the title');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1/reject'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('resubmitForReview', () => {
  it('sends POST to resubmit endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'c1', reviewStatus: 'PENDING' })
    );

    await resubmitForReview('c1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1/resubmit'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// Publish API
// ---------------------------------------------------------------------------

describe('publishContent', () => {
  it('sends POST to publish endpoint', async () => {
    const dto = { connectionId: 'conn-1' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        success: true,
        externalUrl: 'https://mp.weixin.qq.com/s/xxx',
      })
    );

    const result = await publishContent('c1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1/publish'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ success: true });
  });

  it('sends empty body when no dto provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true })
    );

    await publishContent('c1');

    const body = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .body;
    expect(body).toBe('{}');
  });
});

describe('scheduleContent', () => {
  it('sends POST with scheduledAt and connectionId', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'c1', scheduledAt: '2025-12-25T09:00:00Z' })
    );

    await scheduleContent('c1', '2025-12-25T09:00:00Z', 'conn-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1/schedule'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          scheduledAt: '2025-12-25T09:00:00Z',
          connectionId: 'conn-1',
        }),
      })
    );
  });
});

describe('cancelSchedule', () => {
  it('sends POST to cancel endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'c1', scheduledAt: null })
    );

    await cancelSchedule('c1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1/cancel'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getPublishLogs', () => {
  it('calls publish logs endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'log-1', action: 'PUBLISH', status: 'SUCCESS' }])
    );

    const result = await getPublishLogs('c1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c1/logs'),
      expect.anything()
    );
    expect(result).toEqual([
      { id: 'log-1', action: 'PUBLISH', status: 'SUCCESS' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Source discovery APIs
// ---------------------------------------------------------------------------

describe('getExploreSources', () => {
  it('calls explore sources endpoint and transforms response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([
        {
          id: 'src-1',
          title: 'My Article',
          sourceUrl: 'https://example.com',
          type: 'article',
          thumbnailUrl: 'https://img.com/t.jpg',
        },
      ])
    );

    const result = await getExploreSources({ limit: 10 });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/sources/explore?limit=10'),
      expect.anything()
    );
    expect(result.items[0].id).toBe('src-1');
    expect(result.items[0].url).toBe('https://example.com');
    expect(result.total).toBe(1);
  });

  it('handles non-array response gracefully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(null)
    );

    const result = await getExploreSources();

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('calls endpoint without params when no options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getExploreSources();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/sources/explore'),
      expect.anything()
    );
  });
});

describe('getResearchSources', () => {
  it('calls research sources endpoint and transforms response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([
        {
          id: 'r-1',
          title: 'Research Item',
          type: 'research',
          createdAt: '2026-01-01',
        },
      ])
    );

    const result = await getResearchSources({ limit: 5 });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/sources/research'),
      expect.anything()
    );
    expect(result.items[0].id).toBe('r-1');
    expect(result.total).toBe(1);
  });

  it('handles empty array response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );
    const result = await getResearchSources();
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('getOfficeSources', () => {
  it('calls office sources endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([
        {
          id: 'o-1',
          name: 'Office Doc',
          type: 'pptx',
          updatedAt: '2026-02-01',
        },
      ])
    );

    const result = await getOfficeSources();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/sources/office'),
      expect.anything()
    );
    expect(result.items[0].id).toBe('o-1');
    expect(result.items[0].title).toBe('Office Doc');
  });
});

describe('getWritingSources', () => {
  it('calls writing sources endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([
        {
          id: 'w-1',
          title: 'My Novel',
          type: 'story',
          createdAt: '2026-01-15',
        },
      ])
    );

    const result = await getWritingSources({ limit: 20 });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/sources/writing'),
      expect.anything()
    );
    expect(result.items[0].id).toBe('w-1');
    expect(result.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Xiaohongshu (XHS) MCP API
// ---------------------------------------------------------------------------

describe('xhsGetLoginStatus', () => {
  it('calls xhs login-status endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        loggedIn: true,
        userId: 'xhs-user-1',
        nickname: 'TestUser',
      })
    );

    const result = await xhsGetLoginStatus();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/xhs/login-status'),
      expect.anything()
    );
    expect(result.loggedIn).toBe(true);
  });
});

describe('xhsListFeeds', () => {
  it('calls xhs feeds endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'feed-1', title: 'Test Feed' }])
    );

    const result = await xhsListFeeds();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/xhs/feeds'),
      expect.anything()
    );
    expect(result).toHaveLength(1);
  });
});

describe('xhsSearchFeeds', () => {
  it('calls xhs search endpoint with encoded keyword', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'feed-2', title: 'Search Result' }])
    );

    await xhsSearchFeeds('美食攻略');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/xhs/search?keyword='),
      expect.anything()
    );
  });
});

describe('xhsGetFeedDetail', () => {
  it('calls xhs feed detail endpoint with feedId and xsecToken', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'feed-1', title: 'Detailed Feed', comments: [] })
    );

    await xhsGetFeedDetail('feed-1', 'token-abc');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/xhs/feeds/feed-1'),
      expect.anything()
    );
  });
});

describe('xhsPostComment', () => {
  it('sends POST to xhs comment endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true })
    );

    await xhsPostComment('feed-1', 'token-abc', 'Nice post!');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/xhs/feeds/feed-1/comment'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('xhsGetUserProfile', () => {
  it('calls xhs user profile endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ userId: 'user-1', nickname: 'XHSUser' })
    );

    await xhsGetUserProfile('user-1', 'token-abc');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/xhs/users/user-1'),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// Content Version API
// ---------------------------------------------------------------------------

describe('getContentVersions', () => {
  it('calls content versions endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        versions: [
          {
            id: 'v-1',
            contentId: 'c-1',
            platformType: 'WECHAT_MP',
            title: 'Test',
            content: 'Content',
          },
        ],
      })
    );

    const result = await getContentVersions('c-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-social/contents/c-1/versions'),
      expect.anything()
    );
    expect(result.versions).toHaveLength(1);
  });
});

describe('generateVersion', () => {
  it('sends POST to generate version endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ version: { id: 'v-2', platformType: 'WECHAT_MP' } })
    );

    await generateVersion('c-1', 'WECHAT_MP');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-social/contents/c-1/versions/generate'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('generateAllVersions', () => {
  it('sends POST to generate-all endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ versions: [] })
    );

    await generateAllVersions('c-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-social/contents/c-1/versions/generate-all'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('updateVersion', () => {
  it('sends PATCH to version-specific endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ version: { id: 'v-1', title: 'Updated Title' } })
    );

    await updateVersion('c-1', 'WECHAT_MP', { title: 'Updated Title' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-social/contents/c-1/versions/wechat_mp'
      ),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('deleteVersion', () => {
  it('sends DELETE to version-specific endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true })
    );

    await deleteVersion('c-1', 'XIAOHONGSHU');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-social/contents/c-1/versions/xiaohongshu'
      ),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
