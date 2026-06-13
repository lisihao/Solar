/**
 * Tests for lib/api/topic-insights.ts
 *
 * Uses raw fetch mocking (file uses its own fetchWithAuth, not apiClient).
 * vi.hoisted() ensures mock references are available before vi.mock factories run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const { mockGetAuthTokens, mockRefreshAccessToken, mockLogout } = vi.hoisted(
  () => ({
    mockGetAuthTokens: vi.fn(),
    mockRefreshAccessToken: vi.fn(),
    mockLogout: vi.fn(),
  })
);

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: mockGetAuthTokens,
  refreshAccessToken: mockRefreshAccessToken,
  logout: mockLogout,
}));

vi.mock('@/lib/utils/config', () => ({
  config: { apiBaseUrl: '' },
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
  // Use content-length: 0 to simulate empty responses (jsdom does not support status 204)
  return new Response('', { status, headers: { 'content-length': '0' } });
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import {
  createTopic,
  getTopics,
  getTopic,
  updateTopic,
  deleteTopic,
  triggerRefresh,
  getRefreshStatus,
  cancelRefresh,
  getDimensions,
  addDimension,
  updateDimension,
  deleteDimension,
  refreshDimension,
  reorderDimensions,
  getReports,
  getLatestReport,
  getReport,
  deleteReport,
  exportReport,
  compareReports,
  getReportRevisions,
  rollbackReport,
  getEvidence,
  getTemplates,
  getSchedule,
  updateSchedule,
  getLogs,
  getStats,
  leaderPlan,
  getMission,
  approveMissionPlan,
  cancelMission,
  UnauthorizedError,
  getEvidenceDetail,
  recalculateCredibilityScores,
  createFromTemplate,
  getExportJobStatus,
  sendLeaderMessage,
  aiEditReport,
  getCollaborators,
  checkEditPermission,
  applyToJoin,
  getPendingApplications,
  reviewApplication,
  getMyApplicationStatus,
  getMissionHealth,
  getMissionHealthById,
  canResumeMission,
  resumeMission,
  getResumableMissions,
  getAnnotationStats,
  // ---- Additional functions ----
  retryMission,
  getTeam,
  getResearchHistory,
  getReviewTasks,
  createReviewTasks,
  assignReviewTask,
  completeReviewTask,
  getReviewTaskStats,
  canPublishReport,
  getTodos,
  getTodoById,
  getTodoDetails,
  getTaskActivities,
  pauseTodo,
  resumeTodo,
  cancelTodo,
  retryTodo,
  executeTodo,
  prioritizeTodo,
  updateTodo,
  deleteTodo,
  createUserRequestTodo,
  recalculateTopicStats,
  updateTopicVisibility,
  getSharedTopic,
  getSharedTopicLatestReport,
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  resolveAnnotation,
  resolveAllAnnotations,
  getCredibilityReport,
  regenerateCredibilityReport,
  regenerateReportContent,
} from './api';
import {
  ResearchTopicType,
  ResearchTopicStatus,
  RefreshLogStatus,
  ResearchTodoStatus,
  ResearchTodoType,
} from '@/lib/types/topic-insights';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthTokens.mockReturnValue({ accessToken: 'test-token' });
  global.fetch = vi.fn();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchWithAuth - core behaviour', () => {
  it('attaches Authorization header when token present', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'topic-1' })
    );

    await getTopic('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/insight/topics/topic-1'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('omits Authorization header when no token', async () => {
    mockGetAuthTokens.mockReturnValue(null);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'topic-1' })
    );

    await getTopic('topic-1');

    const callHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][1].headers;
    expect(callHeaders).not.toHaveProperty('Authorization');
  });

  it('unwraps { success, data } envelope', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'topic-1', name: 'AI Trends' })
    );

    const result = await getTopic('topic-1');

    expect(result).toEqual({ id: 'topic-1', name: 'AI Trends' });
  });

  it('returns raw object when no envelope', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'topic-1', name: 'Raw' })
    );

    const result = await getTopic('topic-1');

    expect(result).toEqual({ id: 'topic-1', name: 'Raw' });
  });

  it('returns null for empty response with content-length: 0', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    const result = await deleteTopic('topic-1');

    expect(result == null || result === '').toBe(true);
  });

  it('throws error with message on non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse('Topic not found', 404)
    );

    await expect(getTopic('bad-id')).rejects.toThrow('Topic not found');
  });

  it('retries with refreshed token on 401 and succeeds', async () => {
    mockRefreshAccessToken.mockResolvedValue({ accessToken: 'new-token' });
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(wrappedResponse({ id: 'topic-1' }));

    const result = await getTopic('topic-1');

    expect(result).toEqual({ id: 'topic-1' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockRefreshAccessToken).toHaveBeenCalledOnce();
  });

  it('throws UnauthorizedError and calls logout when refresh fails', async () => {
    mockRefreshAccessToken.mockResolvedValue(null);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('', { status: 401 })
    );

    await expect(getTopic('topic-1')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  it('throws error for empty body response (proxy failure detection)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(getStats('topic-1')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Topics CRUD
// ---------------------------------------------------------------------------

describe('createTopic', () => {
  it('sends POST with dto body', async () => {
    const dto = { name: 'AI Market', type: 'MACRO' as const };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'new-topic', ...dto })
    );

    const result = await createTopic(dto as Parameters<typeof createTopic>[0]);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(dto) })
    );
    expect(result).toMatchObject({ id: 'new-topic' });
  });
});

describe('getTopics', () => {
  it('returns topics from { topics } envelope with pagination metadata', async () => {
    const topics = [{ id: 't1' }, { id: 't2' }];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ topics, total: 2 })
    );

    const result = await getTopics();

    expect(result).toEqual({ topics, total: 2, skip: 0, take: 20 });
  });

  it('wraps raw array response into GetTopicsResponse', async () => {
    const topics = [{ id: 't1' }];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(topics)
    );

    const result = await getTopics();

    expect(result).toEqual({ topics, total: 1, skip: 0, take: 1 });
  });

  it('appends query params for type and search', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getTopics({
      type: ResearchTopicType.MACRO,
      search: 'AI',
      skip: 10,
      take: 5,
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('type=MACRO');
    expect(calledUrl).toContain('search=AI');
    expect(calledUrl).toContain('skip=10');
    expect(calledUrl).toContain('take=5');
  });
});

describe('updateTopic', () => {
  it('sends PATCH with dto', async () => {
    const dto = { name: 'Updated Name' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'topic-1', ...dto })
    );

    await updateTopic('topic-1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(dto) })
    );
  });
});

describe('deleteTopic', () => {
  it('sends DELETE request', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await deleteTopic('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ---------------------------------------------------------------------------
// Refresh operations
// ---------------------------------------------------------------------------

describe('triggerRefresh', () => {
  it('sends POST to refresh endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ jobId: 'job-1', message: 'Refreshing' })
    );

    const result = await triggerRefresh('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/refresh'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ jobId: 'job-1' });
  });
});

describe('getRefreshStatus', () => {
  it('calls refresh/status endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ status: 'RUNNING' })
    );

    await getRefreshStatus('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/refresh/status'),
      expect.anything()
    );
  });
});

describe('cancelRefresh', () => {
  it('sends jobId in body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, message: 'Cancelled' })
    );

    await cancelRefresh('topic-1', 'job-xyz');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/refresh/cancel'),
      expect.objectContaining({ body: JSON.stringify({ jobId: 'job-xyz' }) })
    );
  });
});

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

describe('getDimensions', () => {
  it('calls dimensions endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'd1' }])
    );

    const result = await getDimensions('topic-1');

    expect(result).toEqual([{ id: 'd1' }]);
  });
});

describe('addDimension', () => {
  it('sends POST with dimension dto', async () => {
    const dto = { name: 'Market Size', prompt: 'Analyze market...' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'd2', ...dto })
    );

    await addDimension('topic-1', dto as Parameters<typeof addDimension>[1]);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/dimensions'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(dto) })
    );
  });
});

describe('updateDimension', () => {
  it('sends PATCH to dimension endpoint', async () => {
    const dto = { name: 'Updated Dim' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'd1', ...dto })
    );

    await updateDimension('topic-1', 'd1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/dimensions/d1'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('deleteDimension', () => {
  it('sends DELETE to dimension endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await deleteDimension('topic-1', 'd1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/dimensions/d1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('refreshDimension', () => {
  it('sends POST with options body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, message: 'Refreshing' })
    );

    await refreshDimension('topic-1', 'd1', {
      priority: 'high',
      regenerate: true,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/dimensions/d1/refresh'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('reorderDimensions', () => {
  it('sends POST to reorder endpoint', async () => {
    const dto = { dimensionIds: ['d2', 'd1'] };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'd2' }, { id: 'd1' }])
    );

    await reorderDimensions(
      'topic-1',
      dto as Parameters<typeof reorderDimensions>[1]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/dimensions/reorder'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

describe('getReports', () => {
  it('calls reports endpoint without params by default', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ reports: [], hasMore: false })
    );

    await getReports('topic-1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/topics/topic-1/reports');
    expect(calledUrl).not.toContain('?');
  });

  it('appends limit and cursor params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ reports: [], hasMore: false })
    );

    await getReports('topic-1', { limit: 10, cursor: 'abc' });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('cursor=abc');
  });
});

describe('getLatestReport', () => {
  it('calls reports/latest endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'r1' })
    );

    await getLatestReport('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/latest'),
      expect.anything()
    );
  });
});

describe('getReport', () => {
  it('calls specific report endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'r1' })
    );

    await getReport('topic-1', 'r1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/r1'),
      expect.anything()
    );
  });
});

describe('deleteReport', () => {
  it('sends DELETE to report endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, message: 'Deleted' })
    );

    await deleteReport('topic-1', 'r1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/r1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('exportReport', () => {
  it('sends POST to export endpoint with dto', async () => {
    const dto = { format: 'PDF' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ status: 'QUEUED', jobId: 'job-1' })
    );

    await exportReport(
      'topic-1',
      'r1',
      dto as Parameters<typeof exportReport>[2]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/r1/export'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('compareReports', () => {
  it('sends POST to compare endpoint', async () => {
    const dto = { reportId1: 'r1', reportId2: 'r2' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ changes: [] })
    );

    await compareReports(
      'topic-1',
      dto as unknown as Parameters<typeof compareReports>[1]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/compare'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getReportRevisions', () => {
  it('calls revisions endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'rev1' }])
    );

    const result = await getReportRevisions('topic-1', 'r1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/r1/revisions'),
      expect.anything()
    );
    expect(result).toEqual([{ id: 'rev1' }]);
  });
});

describe('rollbackReport', () => {
  it('sends POST with revisionNumber', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        report: { id: 'r1' },
        rolledBackFrom: 3,
        rolledBackTo: 1,
      })
    );

    await rollbackReport('topic-1', 'r1', 1);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/reports/r1/rollback'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ revisionNumber: 1 }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

describe('getEvidence', () => {
  it('calls evidence endpoint without params by default', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ evidence: [], total: 0, hasMore: false })
    );

    await getEvidence('topic-1', 'r1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/topics/topic-1/reports/r1/evidence');
  });

  it('appends filter params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ evidence: [], total: 0, hasMore: false })
    );

    await getEvidence('topic-1', 'r1', {
      dimensionId: 'd1',
      minCredibility: 0.8,
      page: 2,
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('dimensionId=d1');
    expect(calledUrl).toContain('minCredibility=0.8');
    expect(calledUrl).toContain('page=2');
  });
});

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

describe('getTemplates', () => {
  it('returns array directly when response is array', async () => {
    const templates = [{ id: 'tpl-1', name: 'Macro Template' }];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(templates)
    );

    const result = await getTemplates(
      'MACRO' as Parameters<typeof getTemplates>[0]
    );

    expect(result).toEqual(templates);
  });

  it('converts { type, dimensions } response into single template', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ type: 'MACRO', dimensions: [{ name: 'Economy' }] })
    );

    const result = await getTemplates(
      'MACRO' as Parameters<typeof getTemplates>[0]
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('宏观洞察模板');
    expect(result[0].dimensions).toEqual([{ name: 'Economy' }]);
  });

  it('returns empty array for unexpected response shape', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({})
    );

    const result = await getTemplates(
      'MACRO' as Parameters<typeof getTemplates>[0]
    );

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

describe('getSchedule', () => {
  it('calls schedule endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'sched-1', cron: '0 9 * * 1' })
    );

    await getSchedule('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/schedule'),
      expect.anything()
    );
  });
});

describe('updateSchedule', () => {
  it('sends PATCH with dto', async () => {
    const dto = { cron: '0 9 * * *', enabled: true };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'sched-1', ...dto })
    );

    await updateSchedule(
      'topic-1',
      dto as Parameters<typeof updateSchedule>[1]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/schedule'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

// ---------------------------------------------------------------------------
// Logs & Stats
// ---------------------------------------------------------------------------

describe('getLogs', () => {
  it('calls logs endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'log-1' }])
    );

    await getLogs('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/logs'),
      expect.anything()
    );
  });

  it('appends limit and status params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getLogs('topic-1', {
      limit: 20,
      status: 'SUCCESS' as unknown as RefreshLogStatus,
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('limit=20');
    expect(calledUrl).toContain('status=SUCCESS');
  });
});

describe('getStats', () => {
  it('calls stats endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ topicCount: 5, reportCount: 12 })
    );

    const result = await getStats('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/stats'),
      expect.anything()
    );
    expect(result).toMatchObject({ topicCount: 5 });
  });
});

// ---------------------------------------------------------------------------
// Mission / Leader API
// ---------------------------------------------------------------------------

describe('leaderPlan', () => {
  it('sends POST with options to leader/plan', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'mission-1' })
    );

    await leaderPlan('topic-1', { mode: 'fresh', researchDepth: 'thorough' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/leader/plan'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('sends empty body when no options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'mission-1' })
    );

    await leaderPlan('topic-1');

    const body = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .body;
    expect(body).toBe('{}');
  });
});

describe('getMission', () => {
  it('calls mission endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'mission-1', status: 'EXECUTING' })
    );

    await getMission('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/mission'),
      expect.anything()
    );
  });
});

describe('approveMissionPlan', () => {
  it('sends POST to approve-plan endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, message: 'Approved' })
    );

    await approveMissionPlan('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/mission/approve-plan'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('cancelMission', () => {
  it('sends POST to mission/cancel endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true })
    );

    await cancelMission('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/mission/cancel'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// UnauthorizedError class
// ---------------------------------------------------------------------------

describe('UnauthorizedError', () => {
  it('has status 401 and correct name', () => {
    const err = new UnauthorizedError('Session expired');

    expect(err.status).toBe(401);
    expect(err.name).toBe('UnauthorizedError');
    expect(err.message).toBe('Session expired');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Evidence detail + credibility
// ---------------------------------------------------------------------------

describe('getEvidenceDetail', () => {
  it('GETs evidence detail by reportId and evidenceId', async () => {
    const evidence = { id: 'ev-1', content: 'Evidence content' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse(evidence)
    );

    await getEvidenceDetail('topic-1', 'report-1', 'ev-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/report-1/evidence/ev-1'),
      expect.anything()
    );
  });
});

describe('recalculateCredibilityScores', () => {
  it('POSTs to recalculate-credibility endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ updated: 5 })
    );

    await recalculateCredibilityScores('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/topics/topic-1/reports/report-1/evidence/recalculate-credibility'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// Template - createFromTemplate
// ---------------------------------------------------------------------------

describe('createFromTemplate', () => {
  it('POSTs to create from template endpoint', async () => {
    const dto = { templateId: 'tmpl-1', name: 'My Research' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'topic-new', name: 'My Research' })
    );

    await createFromTemplate(
      dto as unknown as Parameters<typeof createFromTemplate>[0]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/from-template'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// Export job status
// ---------------------------------------------------------------------------

describe('getExportJobStatus', () => {
  it('GETs export job status by jobId using /api/v1/export/:jobId', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        jobId: 'job-1',
        status: 'COMPLETED',
        downloadUrl: 'https://cdn.example.com/report.pdf',
      })
    );

    await getExportJobStatus('job-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/export/job-1'),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// Leader messages
// ---------------------------------------------------------------------------

describe('sendLeaderMessage', () => {
  it('POSTs message content to /topics/:id/leader/message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ response: 'Understood.' })
    );

    await sendLeaderMessage('topic-1', 'Adjust focus on competitive analysis');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/leader/message'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// AI Edit Report
// ---------------------------------------------------------------------------

describe('aiEditReport', () => {
  it('POSTs to reports/:reportId/ai-edit endpoint', async () => {
    const req = { instruction: 'Make it more concise' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ editedContent: 'Concise content' })
    );

    await aiEditReport(
      'topic-1',
      'report-1',
      req as unknown as Parameters<typeof aiEditReport>[2]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/report-1/ai-edit'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// Collaborator API
// ---------------------------------------------------------------------------

describe('getCollaborators', () => {
  it('GETs collaborators list', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ collaborators: [], totalCount: 0 })
    );

    await getCollaborators('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/collaborators'),
      expect.anything()
    );
  });
});

describe('checkEditPermission', () => {
  it('returns true when user is the owner', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        owner: { id: 'user-owner' },
        collaborators: [],
        totalCount: 0,
      })
    );

    const result = await checkEditPermission('topic-1', 'user-owner');

    expect(result).toBe(true);
  });

  it('returns true when user is an EDITOR collaborator', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        owner: { id: 'different-owner' },
        collaborators: [
          { userId: 'user-editor', role: 'EDITOR', isActive: true },
        ],
        totalCount: 1,
      })
    );

    const result = await checkEditPermission('topic-1', 'user-editor');

    expect(result).toBe(true);
  });

  it('returns true when user is an ADMIN collaborator', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        owner: { id: 'different-owner' },
        collaborators: [
          { userId: 'user-admin', role: 'ADMIN', isActive: true },
        ],
        totalCount: 1,
      })
    );

    const result = await checkEditPermission('topic-1', 'user-admin');

    expect(result).toBe(true);
  });

  it('returns false when user is a VIEWER collaborator', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        owner: { id: 'different-owner' },
        collaborators: [
          { userId: 'user-viewer', role: 'VIEWER', isActive: true },
        ],
        totalCount: 1,
      })
    );

    const result = await checkEditPermission('topic-1', 'user-viewer');

    expect(result).toBe(false);
  });

  it('returns false when user is not in collaborators or owner', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        owner: { id: 'owner-1' },
        collaborators: [],
        totalCount: 0,
      })
    );

    const result = await checkEditPermission('topic-1', 'unknown-user');

    expect(result).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    const result = await checkEditPermission('topic-1', 'user-1');

    expect(result).toBe(false);
  });
});

describe('getAnnotationStats', () => {
  it('GETs annotation stats via /reports/:id/annotations/stats endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        total: 10,
        byStatus: { open: 5, resolved: 3, dismissed: 2 },
        byType: { comment: 4, suggestion: 3, issue: 2, reference: 1 },
      })
    );

    const result = await getAnnotationStats('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/topics/topic-1/reports/report-1/annotations/stats'
      ),
      expect.anything()
    );
    expect(result).toBeDefined();
  });
});

describe('applyToJoin', () => {
  it('POSTs application to /topics/:id/apply endpoint', async () => {
    const dto = { message: 'I want to collaborate' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'app-1', status: 'PENDING' })
    );

    await applyToJoin(
      'topic-1',
      dto as unknown as Parameters<typeof applyToJoin>[1]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/apply'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getPendingApplications', () => {
  it('GETs applications via /topics/:id/applications', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([{ id: 'app-1', userId: 'user-1', status: 'PENDING' }])
    );

    await getPendingApplications('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/applications'),
      expect.anything()
    );
  });
});

describe('reviewApplication', () => {
  it('POSTs review decision to /applications/:id/review', async () => {
    const dto = { decision: 'ACCEPTED' as const };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'app-1', status: 'ACCEPTED' })
    );

    await reviewApplication(
      'topic-1',
      'app-1',
      dto as unknown as Parameters<typeof reviewApplication>[2]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/applications/app-1/review'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getMyApplicationStatus', () => {
  it('GETs current user application status', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        status: 'PENDING',
        appliedAt: new Date().toISOString(),
      })
    );

    const result = await getMyApplicationStatus('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/my-application'),
      expect.anything()
    );
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Mission Health API
// ---------------------------------------------------------------------------

describe('getMissionHealth', () => {
  it('GETs mission health for topic using /topics/:id/health', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ health: { status: 'healthy' }, message: 'OK' })
    );

    await getMissionHealth('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/health'),
      expect.anything()
    );
  });
});

describe('getMissionHealthById', () => {
  it('GETs mission health using /topics/:id/missions/:missionId/health', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ health: { status: 'healthy' } })
    );

    await getMissionHealthById('topic-1', 'mission-123');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/missions/mission-123/health'),
      expect.anything()
    );
  });
});

describe('canResumeMission', () => {
  it('GETs canResume using /topics/:id/missions/:missionId/can-resume', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ canResume: true, missionId: 'mission-1' })
    );

    await canResumeMission('topic-1', 'mission-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/missions/mission-1/can-resume'),
      expect.anything()
    );
  });
});

describe('resumeMission', () => {
  it('GETs resumable missions via /resumable-missions endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        missions: [{ id: 'mission-1', topicId: 'topic-1' }],
        total: 1,
      })
    );

    const result = await getResumableMissions();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/resumable-missions'),
      expect.anything()
    );
    expect(result).toMatchObject({ missions: expect.any(Array), total: 1 });
  });
});

describe('getResumableMissions', () => {
  it('POSTs to resume using /topics/:id/missions/:missionId/resume', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, missionId: 'mission-1' })
    );

    await resumeMission('topic-1', 'mission-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/missions/mission-1/resume'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// retryMission
// ---------------------------------------------------------------------------

describe('retryMission', () => {
  it('POSTs to /topics/:id/mission/retry without taskIds', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ retriedTasks: 2 })
    );

    const result = await retryMission('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/mission/retry'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ retriedTasks: 2 });
  });

  it('POSTs to /topics/:id/mission/retry with taskIds', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ retriedTasks: 1 })
    );

    await retryMission('topic-1', ['task-a', 'task-b']);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/mission/retry'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// getTeam
// ---------------------------------------------------------------------------

describe('getTeam', () => {
  it('GETs team info via /topics/:id/team', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ members: [], leader: null })
    );

    await getTeam('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/team'),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// getResearchHistory
// ---------------------------------------------------------------------------

describe('getResearchHistory', () => {
  it('GETs research history without limit', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        timeline: [],
        totalMissions: 0,
        totalReports: 0,
      })
    );

    const result = await getResearchHistory('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/research-history'),
      expect.anything()
    );
    expect(result).toEqual([]);
  });

  it('appends limit param when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ timeline: [], totalMissions: 0, totalReports: 0 })
    );

    await getResearchHistory('topic-1', 10);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=10'),
      expect.anything()
    );
  });

  it('returns empty array when response is null/falsy', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse(null)
    );

    const result = await getResearchHistory('topic-1');
    expect(result).toEqual([]);
  });

  it('returns array directly when backend returns array', async () => {
    const items = [
      {
        id: 'h-1',
        type: 'mission',
        timestamp: '2024-01-01',
        status: 'COMPLETED',
      },
    ];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse(items)
    );

    const result = await getResearchHistory('topic-1');
    expect(Array.isArray(result)).toBe(true);
  });

  it('transforms timeline mission items into ResearchHistoryItem shape', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        timeline: [
          {
            id: 'mission-1',
            type: 'mission',
            timestamp: '2024-01-01T10:00:00Z',
            title: 'Research Run 1',
            description: 'Deep research on AI',
            status: 'COMPLETED',
            metadata: {
              completedTasks: 3,
              totalTasks: 5,
              dimensionsUpdated: ['dim-1', 'dim-2'],
              dimensionResults: [
                { dimensionName: 'dim-1', resultSummary: 'result' },
              ],
            },
          },
          {
            id: 'report-1',
            type: 'report',
            timestamp: '2024-01-01T11:00:00Z',
            title: 'Report',
            description: 'Generated report',
            status: 'COMPLETED',
          },
        ],
        totalMissions: 1,
        totalReports: 1,
      })
    );

    const result = await getResearchHistory('topic-1');

    // Only mission type items should be returned
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('mission-1');
    expect(result[0].missionId).toBe('mission-1');
    expect(result[0].topicId).toBe('topic-1');
    expect(result[0].dimensionsUpdated).toEqual(['dim-1', 'dim-2']);
    expect(result[0]._metadata?.completedTasks).toBe(3);
    expect(result[0]._metadata?.totalTasks).toBe(5);
  });

  it('maps various status values correctly', async () => {
    const makeItem = (status: string) => ({
      id: `m-${status}`,
      type: 'mission',
      timestamp: '2024-01-01T10:00:00Z',
      title: `Mission ${status}`,
      description: 'desc',
      status,
      metadata: {},
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        timeline: [
          makeItem('FAILED'),
          makeItem('CANCELLED'),
          makeItem('PLANNING'),
          makeItem('EXECUTING'),
          makeItem('UNKNOWN_XYZ'),
        ],
        totalMissions: 5,
        totalReports: 0,
      })
    );

    const result = await getResearchHistory('topic-1');
    const statuses = result.map((r) => r.status);
    expect(statuses).toContain('FAILED');
    expect(statuses).toContain('CANCELLED');
    expect(statuses).toContain('IN_PROGRESS'); // PLANNING -> IN_PROGRESS
  });

  it('returns empty array when timeline is missing from response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ totalMissions: 0, totalReports: 0 })
    );

    const result = await getResearchHistory('topic-1');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Review Tasks API
// ---------------------------------------------------------------------------

describe('getReviewTasks', () => {
  it('GETs review tasks via /topics/:id/reports/:rid/review-tasks', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([{ id: 'rt-1', sectionName: 'Intro' }])
    );

    await getReviewTasks('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/report-1/review-tasks'),
      expect.anything()
    );
  });
});

describe('createReviewTasks', () => {
  it('POSTs to /topics/:id/reports/:rid/review-tasks', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        created: 3,
        tasks: [{ id: 'rt-1', sectionName: 'Intro' }],
      })
    );

    const result = await createReviewTasks('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/report-1/review-tasks'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ created: 3 });
  });
});

describe('assignReviewTask', () => {
  it('PATCHes to /review-tasks/:taskId/assign', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'rt-1', assigneeName: 'Alice' })
    );

    await assignReviewTask(
      'topic-1',
      'report-1',
      'rt-1',
      'user-alice',
      'Alice'
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/review-tasks/rt-1/assign'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('completeReviewTask', () => {
  it('PATCHes to /review-tasks/:taskId/complete', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'rt-1', approved: true })
    );

    await completeReviewTask(
      'topic-1',
      'report-1',
      'rt-1',
      true,
      'Good work',
      90
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/review-tasks/rt-1/complete'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('getReviewTaskStats', () => {
  it('GETs review task stats via /review-tasks/stats', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        total: 5,
        pending: 2,
        inProgress: 1,
        completed: 2,
        approved: 1,
        rejected: 1,
        averageScore: 85,
      })
    );

    await getReviewTaskStats('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/review-tasks/stats'),
      expect.anything()
    );
  });
});

describe('canPublishReport', () => {
  it('GETs publish readiness via /review-tasks/can-publish', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ canPublish: true, pendingTasks: 0, rejectedTasks: 0 })
    );

    const result = await canPublishReport('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/review-tasks/can-publish'),
      expect.anything()
    );
    expect(result).toMatchObject({ canPublish: true });
  });
});

// ---------------------------------------------------------------------------
// TODO API
// ---------------------------------------------------------------------------

describe('getTodos', () => {
  it('GETs todos via /topics/:id/todos without options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ items: [], total: 0 })
    );

    await getTodos('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/todos'),
      expect.anything()
    );
  });

  it('appends missionId, status, and type params when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ items: [], total: 0 })
    );

    await getTodos('topic-1', {
      missionId: 'mission-1',
      status: [ResearchTodoStatus.PENDING, ResearchTodoStatus.IN_PROGRESS],
      type: [ResearchTodoType.DIMENSION_RESEARCH],
    });

    const url = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain('missionId=mission-1');
    expect(url).toContain('status=PENDING');
    expect(url).toContain('status=IN_PROGRESS');
    expect(url).toContain('type=DIMENSION_RESEARCH');
  });
});

describe('getTodoById', () => {
  it('GETs single todo via /topics/:id/todos/:todoId', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'todo-1', title: 'Research AI' })
    );

    await getTodoById('topic-1', 'todo-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/todos/todo-1'),
      expect.anything()
    );
  });
});

describe('getTodoDetails', () => {
  it('GETs todo details with activities', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ todo: { id: 'todo-1' }, activities: [] })
    );

    await getTodoDetails('topic-1', 'todo-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/todos/todo-1/details'),
      expect.anything()
    );
  });
});

describe('getTaskActivities', () => {
  it('GETs task activities via /topics/:id/tasks/:taskId/activities', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ task: { id: 'task-1' }, activities: [] })
    );

    await getTaskActivities('topic-1', 'task-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/tasks/task-1/activities'),
      expect.anything()
    );
  });
});

describe('pauseTodo', () => {
  it('POSTs to /todos/:todoId/pause', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, todo: { id: 'todo-1' } })
    );

    await pauseTodo('topic-1', 'todo-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/todos/todo-1/pause'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('resumeTodo', () => {
  it('POSTs to /todos/:todoId/resume', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, todo: { id: 'todo-1' } })
    );

    await resumeTodo('topic-1', 'todo-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/todos/todo-1/resume'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('cancelTodo', () => {
  it('POSTs to /todos/:todoId/cancel without reason', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, todo: { id: 'todo-1' } })
    );

    await cancelTodo('topic-1', 'todo-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/todos/todo-1/cancel'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('POSTs to /todos/:todoId/cancel with reason', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, todo: { id: 'todo-1' } })
    );

    await cancelTodo('topic-1', 'todo-1', 'No longer needed');

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.reason).toBe('No longer needed');
  });
});

describe('retryTodo', () => {
  it('POSTs to /todos/:todoId/retry', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, todo: { id: 'todo-1' } })
    );

    await retryTodo('topic-1', 'todo-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/todos/todo-1/retry'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('executeTodo', () => {
  it('POSTs to /todos/:todoId/execute', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        success: true,
        todo: { id: 'todo-1' },
        message: 'Started',
      })
    );

    const result = await executeTodo('topic-1', 'todo-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/todos/todo-1/execute'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ success: true });
  });
});

describe('prioritizeTodo', () => {
  it('PATCHes priority for a todo', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, todo: { id: 'todo-1' } })
    );

    await prioritizeTodo('topic-1', 'todo-1', 'high');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/todos/todo-1/priority'),
      expect.objectContaining({ method: 'PATCH' })
    );
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.priority).toBe('high');
  });
});

describe('updateTodo', () => {
  it('PATCHes todo title and description', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        success: true,
        todo: { id: 'todo-1', title: 'New Title' },
      })
    );

    await updateTodo('topic-1', 'todo-1', {
      title: 'New Title',
      description: 'New Desc',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/todos/todo-1'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('deleteTodo', () => {
  it('DELETEs a todo', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true })
    );

    await deleteTodo('topic-1', 'todo-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/todos/todo-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('createUserRequestTodo', () => {
  it('POSTs to /topics/:id/missions/:missionId/todos', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, todo: { id: 'todo-2' } })
    );

    await createUserRequestTodo(
      'topic-1',
      'mission-1',
      'Investigate more',
      'Details here'
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/missions/mission-1/todos'),
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.title).toBe('Investigate more');
    expect(body.description).toBe('Details here');
  });
});

// ---------------------------------------------------------------------------
// recalculateTopicStats
// ---------------------------------------------------------------------------

describe('recalculateTopicStats', () => {
  it('POSTs to /topics/:id/recalculate-stats', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'topic-1', totalReports: 5 })
    );

    await recalculateTopicStats('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/recalculate-stats'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// updateTopicVisibility
// ---------------------------------------------------------------------------

describe('updateTopicVisibility', () => {
  it('PATCHes visibility to PUBLIC', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, visibility: 'PUBLIC' })
    );

    const result = await updateTopicVisibility('topic-1', 'PUBLIC');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/visibility'),
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(result).toMatchObject({ visibility: 'PUBLIC' });
  });
});

// ---------------------------------------------------------------------------
// Public Shared Access (no auth)
// ---------------------------------------------------------------------------

describe('getSharedTopic', () => {
  it('fetches shared topic without auth and unwraps data field', async () => {
    const topicData = { id: 'topic-1', title: 'Public Topic' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, data: topicData })
    );

    const result = await getSharedTopic('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/shared/topics/topic-1')
    );
    expect(result).toEqual(topicData);
  });

  it('returns raw json when no data field', async () => {
    const topicData = { id: 'topic-1', title: 'Public Topic' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(topicData)
    );

    const result = await getSharedTopic('topic-1');
    expect(result).toEqual(topicData);
  });

  it('throws when fetch returns non-ok', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse('Not found', 404)
    );

    await expect(getSharedTopic('bad-id')).rejects.toThrow('Not found');
  });

  it('throws default message when error json fails to parse', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('not-json', { status: 500 })
    );

    await expect(getSharedTopic('topic-1')).rejects.toThrow(
      'Failed to fetch shared topic'
    );
  });
});

describe('getSharedTopicLatestReport', () => {
  it('fetches shared report without auth and unwraps data field', async () => {
    const reportData = { id: 'report-1', content: 'Report content' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, data: reportData })
    );

    const result = await getSharedTopicLatestReport('topic-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/shared/topics/topic-1/reports/latest')
    );
    expect(result).toEqual(reportData);
  });

  it('throws when fetch returns non-ok', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse('Report not found', 404)
    );

    await expect(getSharedTopicLatestReport('topic-1')).rejects.toThrow(
      'Report not found'
    );
  });
});

// ---------------------------------------------------------------------------
// Report Annotations
// ---------------------------------------------------------------------------

describe('getAnnotations', () => {
  it('GETs annotations without status filter', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([{ id: 'ann-1', content: 'Note' }])
    );

    await getAnnotations('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/reports/report-1/annotations'),
      expect.anything()
    );
  });

  it('appends status query param when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([])
    );

    await getAnnotations('topic-1', 'report-1', 'OPEN');

    const url = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(url).toContain('status=OPEN');
  });
});

describe('createAnnotation', () => {
  it('POSTs to /annotations endpoint', async () => {
    const dto = {
      content: 'This is a note',
      type: 'COMMENT' as const,
      startOffset: 10,
      endOffset: 20,
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'ann-1', ...dto })
    );

    await createAnnotation('topic-1', 'report-1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/reports/report-1/annotations'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('updateAnnotation', () => {
  it('PATCHes to /annotations/:annotationId', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'ann-1', content: 'Updated note' })
    );

    await updateAnnotation('topic-1', 'report-1', 'ann-1', {
      content: 'Updated note',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/annotations/ann-1'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('deleteAnnotation', () => {
  it('DELETEs /annotations/:annotationId', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true })
    );

    await deleteAnnotation('topic-1', 'report-1', 'ann-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/annotations/ann-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('resolveAnnotation', () => {
  it('POSTs to /annotations/:annotationId/resolve', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'ann-1', status: 'RESOLVED' })
    );

    await resolveAnnotation('topic-1', 'report-1', 'ann-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/annotations/ann-1/resolve'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('resolveAllAnnotations', () => {
  it('POSTs to /annotations/resolve-all without specific IDs', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse(5)
    );

    const result = await resolveAllAnnotations('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/annotations/resolve-all'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toBe(5);
  });

  it('POSTs with specific annotation IDs', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse(2)
    );

    await resolveAllAnnotations('topic-1', 'report-1', ['ann-1', 'ann-2']);

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.annotationIds).toEqual(['ann-1', 'ann-2']);
  });
});

// ---------------------------------------------------------------------------
// Credibility Report
// ---------------------------------------------------------------------------

describe('getCredibilityReport', () => {
  it('GETs credibility report via /reports/:id/credibility', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ overallScore: 85, breakdown: [] })
    );

    await getCredibilityReport('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/reports/report-1/credibility'),
      expect.anything()
    );
  });
});

describe('regenerateCredibilityReport', () => {
  it('POSTs to /reports/:id/credibility/regenerate', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ overallScore: 90 })
    );

    await regenerateCredibilityReport('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/credibility/regenerate'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('regenerateReportContent', () => {
  it('POSTs to /reports/:id/regenerate without feedback', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, report: { id: 'report-1' } })
    );

    await regenerateReportContent('topic-1', 'report-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/reports/report-1/regenerate'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('includes feedback in body when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, report: { id: 'report-1' } })
    );

    await regenerateReportContent(
      'topic-1',
      'report-1',
      'Please improve section 2'
    );

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.feedback).toBe('Please improve section 2');
  });
});

// ---------------------------------------------------------------------------
// fetchWithAuth - additional edge cases
// ---------------------------------------------------------------------------

describe('fetchWithAuth - additional edge cases', () => {
  it('throws error with text body when content-type is not json', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('Plain error message', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    await expect(getTopic('topic-1')).rejects.toThrow('Plain error message');
  });

  it('throws generic HTTP error when error body parsing fails', async () => {
    // Non-JSON body but content-type says json
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('{broken', {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(getTopic('topic-1')).rejects.toThrow('HTTP 500');
  });

  it('returns null for response with content-length 0 (simulated 204)', async () => {
    // jsdom does not support status 204, use content-length: 0 to simulate empty response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('', {
        status: 200,
        headers: { 'content-length': '0' },
      })
    );

    const result = await getStats('topic-1');
    expect(result == null || String(result) === '').toBe(true);
  });

  it('returns text when content-type is not application/json', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('some text content', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    const result = await getTopic('topic-1');
    expect(result).toBe('some text content');
  });

  it('returns null when JSON parse fails on response body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('not valid json ~~~~', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await getStats('topic-1');
    expect(result).toBeNull();
  });

  it('throws UnauthorizedError when refresh succeeds but second request still 401', async () => {
    mockRefreshAccessToken.mockResolvedValue({
      accessToken: 'refreshed-token',
    });
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }));

    await expect(getTopic('topic-1')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  it('truncates long plain text error to 200 chars', async () => {
    const longText = 'E'.repeat(300);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(longText, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    await expect(getTopic('topic-1')).rejects.toThrow('E'.repeat(200));
  });
});

// ---------------------------------------------------------------------------
// getTopics - status param
// ---------------------------------------------------------------------------

describe('getTopics - status param', () => {
  it('appends status param when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getTopics({ status: ResearchTopicStatus.ACTIVE });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('status=ACTIVE');
  });
});

// ---------------------------------------------------------------------------
// getTemplates - type name variations
// ---------------------------------------------------------------------------

describe('getTemplates - TECHNOLOGY and COMPANY types', () => {
  it('names template "技术趋势模板" for TECHNOLOGY type', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ type: 'TECHNOLOGY', dimensions: [{ name: 'Patents' }] })
    );

    const result = await getTemplates(
      'TECHNOLOGY' as Parameters<typeof getTemplates>[0]
    );

    expect(result[0].name).toBe('技术趋势模板');
    expect(result[0].type).toBe('TECHNOLOGY');
  });

  it('names template "企业追踪模板" for non-MACRO non-TECHNOLOGY type', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ type: 'COMPANY', dimensions: [{ name: 'Financials' }] })
    );

    const result = await getTemplates(
      'COMPANY' as Parameters<typeof getTemplates>[0]
    );

    expect(result[0].name).toBe('企业追踪模板');
  });
});

// ---------------------------------------------------------------------------
// getEvidence - remaining params
// ---------------------------------------------------------------------------

describe('getEvidence - sortBy and pageSize params', () => {
  it('appends sourceType, sortBy, and pageSize when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ evidence: [], total: 0, hasMore: false })
    );

    await getEvidence('topic-1', 'r1', {
      sourceType: 'news',
      sortBy: 'credibility',
      pageSize: 20,
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('sourceType=news');
    expect(calledUrl).toContain('sortBy=credibility');
    expect(calledUrl).toContain('pageSize=20');
  });
});

// ---------------------------------------------------------------------------
// getTeamMessages
// ---------------------------------------------------------------------------

describe('getTeamMessages', () => {
  it('GETs team messages without options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([{ id: 'msg-1', content: 'Hello' }])
    );

    await import('./api').then(({ getTeamMessages }) =>
      getTeamMessages('topic-1')
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/team-messages'),
      expect.anything()
    );
  });

  it('appends limit and missionId when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([])
    );

    await import('./api').then(({ getTeamMessages }) =>
      getTeamMessages('topic-1', { limit: 50, missionId: 'mission-abc' })
    );

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).toContain('missionId=mission-abc');
  });
});

// ---------------------------------------------------------------------------
// getAgentActivities
// ---------------------------------------------------------------------------

describe('getAgentActivities', () => {
  it('GETs agent activities without options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([{ id: 'act-1', agentName: 'Researcher' }])
    );

    await import('./api').then(({ getAgentActivities }) =>
      getAgentActivities('topic-1')
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/agent-activities'),
      expect.anything()
    );
  });

  it('appends limit, missionId, and agentRole when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([])
    );

    await import('./api').then(({ getAgentActivities }) =>
      getAgentActivities('topic-1', {
        limit: 30,
        missionId: 'mission-1',
        agentRole: 'researcher',
      })
    );

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('limit=30');
    expect(calledUrl).toContain('missionId=mission-1');
    expect(calledUrl).toContain('agentRole=researcher');
  });
});

// ---------------------------------------------------------------------------
// leaderChat
// ---------------------------------------------------------------------------

describe('leaderChat', () => {
  it('POSTs to /topics/:id/leader/chat with message', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        decisionType: 'DIRECT_ANSWER',
        understanding: 'OK',
        response: 'Got it',
      })
    );

    await import('./api').then(({ leaderChat }) =>
      leaderChat('topic-1', 'What is the status?')
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/topics/topic-1/leader/chat'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('includes missionId in body when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        decisionType: 'ACKNOWLEDGE',
        understanding: '',
        response: 'Ok',
      })
    );

    await import('./api').then(({ leaderChat }) =>
      leaderChat('topic-1', 'Pause research', 'mission-42')
    );

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.message).toBe('Pause research');
    expect(body.missionId).toBe('mission-42');
  });
});

// ---------------------------------------------------------------------------
// waitForExportCompletion
// ---------------------------------------------------------------------------

describe('waitForExportCompletion', () => {
  it('returns downloadUrl immediately when initial response is COMPLETED', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        status: 'COMPLETED',
        downloadUrl: 'https://cdn.example.com/file.pdf',
        jobId: 'job-1',
      })
    );

    await import('./api').then(({ waitForExportCompletion }) =>
      waitForExportCompletion('topic-1', 'report-1', {
        format: 'pdf',
      } as Parameters<typeof import('./api').exportReport>[2]).then((url) => {
        expect(url).toBe('https://cdn.example.com/file.pdf');
      })
    );
  });

  it('throws when initial response is FAILED', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        status: 'FAILED',
        error: 'Export failed due to timeout',
      })
    );

    await expect(
      import('./api').then(({ waitForExportCompletion }) =>
        waitForExportCompletion('topic-1', 'report-1', {
          format: 'pdf',
        } as Parameters<typeof import('./api').exportReport>[2])
      )
    ).rejects.toThrow('Export failed due to timeout');
  });

  it('throws when initial response has no jobId', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ status: 'QUEUED' })
    );

    await expect(
      import('./api').then(({ waitForExportCompletion }) =>
        waitForExportCompletion('topic-1', 'report-1', {
          format: 'pdf',
        } as Parameters<typeof import('./api').exportReport>[2])
      )
    ).rejects.toThrow('导出任务创建失败');
  });
});

// ---------------------------------------------------------------------------
// getSharedTopicLatestReport - raw json fallback
// ---------------------------------------------------------------------------

describe('getSharedTopicLatestReport - additional', () => {
  it('returns raw json when no data field present', async () => {
    const report = { id: 'report-1', content: 'content' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(report)
    );

    const result = await getSharedTopicLatestReport('topic-1');
    expect(result).toEqual(report);
  });

  it('throws fallback message when error json has no message field', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('not-json', { status: 500 })
    );

    await expect(getSharedTopicLatestReport('topic-1')).rejects.toThrow(
      'Failed to fetch shared report'
    );
  });
});

// ---------------------------------------------------------------------------
// triggerRefresh with dto
// ---------------------------------------------------------------------------

describe('triggerRefresh with dto', () => {
  it('sends dto body when provided', async () => {
    const dto = { priority: 'high', dimensions: ['dim-1'] };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ jobId: 'job-2', message: 'Refreshing with options' })
    );

    await triggerRefresh(
      'topic-1',
      dto as Parameters<typeof triggerRefresh>[1]
    );

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.priority).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// refreshDimension without options
// ---------------------------------------------------------------------------

describe('refreshDimension without options', () => {
  it('sends empty body when no options provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, message: 'Refreshing' })
    );

    await refreshDimension('topic-1', 'd1');

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body).toEqual({});
  });
});
