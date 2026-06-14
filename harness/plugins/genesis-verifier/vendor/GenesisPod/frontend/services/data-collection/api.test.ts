/**
 * Tests for lib/api/data-collection.ts
 *
 * Uses raw fetch mocking since this file builds its own request() helper
 * (not apiClient). Auth is handled via getAuthHeader from lib/utils/auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const { mockGetAuthHeader, mockConfigApiUrl } = vi.hoisted(() => ({
  mockGetAuthHeader: vi.fn(),
  mockConfigApiUrl: '/api/v1',
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: mockGetAuthHeader,
}));

vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: '/api/v1',
  },
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
  // jsdom does not support 204 in the Response constructor, use 200 with empty body
  return new Response('', { status });
}

function errorResponse(message: string, status: number): Response {
  return new Response(message, { status });
}

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------
import {
  getDashboardStats,
  getDataSources,
  getDataSource,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  testDataSource,
  getDataSourceStats,
  fixRssUrls,
  getCollectionTasks,
  getCollectionTask,
  createCollectionTask,
  executeTask,
  pauseTask,
  resumeTask,
  cancelTask,
  getRunningTasks,
  getSystemMetrics,
  getTaskLogs,
  getQualityIssues,
  getQualityStats,
  assessResourceQuality,
  batchAssessQuality,
  updateReviewStatus,
  getHistory,
  getHistoryStats,
  getTaskHistory,
  deleteHistory,
  cleanOldHistory,
  getSchedulerStatus,
  updateSchedulerConfig,
  triggerCollection,
} from './api';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthHeader.mockReturnValue({ Authorization: 'Bearer test-token' });
  global.fetch = vi.fn();
});

// ---------------------------------------------------------------------------
// request() internals
// ---------------------------------------------------------------------------

describe('request helper — core behaviour', () => {
  it('attaches Authorization header from getAuthHeader', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        sourceStats: {},
        taskStats: {},
        todayStats: {},
        qualityMetrics: {},
        recentTasks: [],
        timeSeries: [],
      })
    );

    await getDashboardStats();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('calls the correct base URL + path', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        sourceStats: {},
        taskStats: {},
        todayStats: {},
        qualityMetrics: {},
        recentTasks: [],
        timeSeries: [],
      })
    );

    await getDashboardStats();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/api/v1/data-collection/dashboard');
  });

  it('auto-unwraps { success, data } envelope', async () => {
    const innerData = { id: 'src-1', name: 'HN' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse(innerData)
    );

    const result = await getDataSource('src-1');

    expect(result).toEqual(innerData);
  });

  it('returns raw JSON when no success wrapper', async () => {
    const raw = [{ id: 'src-1' }];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(raw)
    );

    const result = await getDataSources();

    // raw array returned directly
    expect(result).toEqual(raw);
  });

  it('returns undefined for 204 No Content using json with null body', async () => {
    // jsdom does not allow creating a Response with status 204.
    // The data-collection request() helper checks response.status === 204 and
    // returns undefined. We simulate this by mocking fetch to resolve with a
    // plain object that has status 204 and ok=true.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      text: async () => '',
    } as unknown as Response);

    const result = await deleteDataSource('src-1');

    expect(result).toBeUndefined();
  });

  it('throws Error on non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse('Source not found', 404)
    );

    await expect(getDataSource('bad-id')).rejects.toThrow('Source not found');
  });

  it('throws with status text when body is empty on non-ok', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('', { status: 500, statusText: 'Internal Server Error' })
    );

    await expect(getDashboardStats()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

describe('getDashboardStats', () => {
  it('calls dashboard endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        sourceStats: { total: 5 },
        taskStats: {},
        todayStats: {},
        qualityMetrics: {},
        recentTasks: [],
        timeSeries: [],
      })
    );

    const result = await getDashboardStats();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/dashboard');
    expect(result.sourceStats.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Data Sources
// ---------------------------------------------------------------------------

describe('getDataSources', () => {
  it('calls sources endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );

    await getDataSources();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/sources');
  });
});

describe('getDataSource', () => {
  it('calls source by id endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'src-1', name: 'Hacker News' })
    );

    await getDataSource('src-1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/sources/src-1');
  });
});

describe('createDataSource', () => {
  it('sends POST with source data', async () => {
    const sourceData = {
      name: 'New Source',
      type: 'RSS',
      category: 'tech',
      baseUrl: 'https://example.com',
      crawlerType: 'RSS',
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'src-new', ...sourceData })
    );

    await createDataSource(sourceData);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/sources'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(sourceData),
      })
    );
  });
});

describe('updateDataSource', () => {
  it('sends PUT to source endpoint', async () => {
    const updates = { name: 'Updated Source' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'src-1', ...updates })
    );

    await updateDataSource('src-1', updates);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/sources/src-1'),
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(updates) })
    );
  });
});

describe('deleteDataSource', () => {
  it('sends DELETE to source endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      text: async () => '',
    } as unknown as Response);

    await deleteDataSource('src-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/sources/src-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('testDataSource', () => {
  it('sends POST to test endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Connection successful' })
    );

    const result = await testDataSource('src-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/sources/src-1/test'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ message: 'Connection successful' });
  });
});

describe('getDataSourceStats', () => {
  it('calls stats endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ total: 10 })
    );

    await getDataSourceStats();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/sources/stats');
  });
});

describe('fixRssUrls', () => {
  it('sends POST to fix-rss-urls endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ fixed: ['src-1'], failed: [], skipped: [] })
    );

    const result = await fixRssUrls();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/sources/fix-rss-urls'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.fixed).toEqual(['src-1']);
  });
});

// ---------------------------------------------------------------------------
// Collection Tasks
// ---------------------------------------------------------------------------

describe('getCollectionTasks', () => {
  it('calls tasks endpoint without params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );

    await getCollectionTasks();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/tasks');
    expect(calledUrl).not.toContain('?');
  });

  it('appends status and sourceId params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );

    await getCollectionTasks({ status: 'RUNNING', sourceId: 'src-1' });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('status=RUNNING');
    expect(calledUrl).toContain('sourceId=src-1');
  });
});

describe('getCollectionTask', () => {
  it('calls task by id endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'task-1', status: 'RUNNING' })
    );

    await getCollectionTask('task-1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/tasks/task-1');
  });
});

describe('createCollectionTask', () => {
  it('sends POST with task data', async () => {
    const taskData = {
      sourceId: 'src-1',
      name: 'Manual Collection',
      type: 'MANUAL' as const,
      sourceConfig: {},
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'task-new', ...taskData })
    );

    await createCollectionTask(taskData);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tasks'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(taskData),
      })
    );
  });
});

describe('executeTask', () => {
  it('sends POST to execute endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Task started' })
    );

    const result = await executeTask('task-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tasks/task-1/execute'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.message).toBe('Task started');
  });
});

describe('pauseTask', () => {
  it('sends POST to pause endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Task paused' })
    );

    await pauseTask('task-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tasks/task-1/pause'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('resumeTask', () => {
  it('sends POST to resume endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Task resumed' })
    );

    await resumeTask('task-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tasks/task-1/resume'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('cancelTask', () => {
  it('sends POST to cancel endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Task cancelled' })
    );

    await cancelTask('task-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/tasks/task-1/cancel'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

describe('getRunningTasks', () => {
  it('calls running tasks endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );

    await getRunningTasks();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/monitor/running');
  });
});

describe('getSystemMetrics', () => {
  it('calls metrics endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ cpu: 50, memory: 75 })
    );

    await getSystemMetrics();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/monitor/metrics');
  });
});

describe('getTaskLogs', () => {
  it('calls task logs endpoint without params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getTaskLogs('task-1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/monitor/logs/task-1');
    expect(calledUrl).not.toContain('?');
  });

  it('appends level and limit params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getTaskLogs('task-1', { level: 'ERROR', limit: 50 });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('level=ERROR');
    expect(calledUrl).toContain('limit=50');
  });
});

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

describe('getQualityIssues', () => {
  it('calls quality issues endpoint without params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );

    await getQualityIssues();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/quality/issues');
    expect(calledUrl).not.toContain('?');
  });

  it('appends severity and reviewStatus params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );

    await getQualityIssues({
      severity: 'HIGH',
      reviewStatus: 'PENDING',
      limit: 10,
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('severity=HIGH');
    expect(calledUrl).toContain('reviewStatus=PENDING');
    expect(calledUrl).toContain('limit=10');
  });
});

describe('getQualityStats', () => {
  it('calls quality stats endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        totalIssues: 5,
        byType: {},
        bySeverity: {},
        byReviewStatus: {},
        avgQualityScore: 0.8,
        trends: [],
      })
    );

    await getQualityStats();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/quality/stats');
  });
});

describe('assessResourceQuality', () => {
  it('sends POST to assess endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ score: 0.85 })
    );

    await assessResourceQuality('resource-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/quality/assess/resource-1'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('batchAssessQuality', () => {
  it('calls batch assess endpoint without limit', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Done', assessed: 10 })
    );

    await batchAssessQuality();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/quality/batch-assess');
    expect(calledUrl).not.toContain('?');
  });

  it('appends limit param when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Done', assessed: 5 })
    );

    await batchAssessQuality(5);

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('limit=5');
  });
});

describe('updateReviewStatus', () => {
  it('sends PUT with status and note', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Updated' })
    );

    await updateReviewStatus('resource-1', 'RESOLVED', 'Fixed by team');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/quality/review/resource-1'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ status: 'RESOLVED', note: 'Fixed by team' }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe('getHistory', () => {
  it('calls history endpoint without params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );

    await getHistory();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/history');
    expect(calledUrl).not.toContain('?');
  });

  it('appends all filter params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );

    await getHistory({
      status: 'COMPLETED',
      sourceId: 'src-1',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      limit: 20,
      offset: 40,
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('status=COMPLETED');
    expect(calledUrl).toContain('sourceId=src-1');
    expect(calledUrl).toContain('startDate=2024-01-01');
    expect(calledUrl).toContain('endDate=2024-01-31');
    expect(calledUrl).toContain('limit=20');
    expect(calledUrl).toContain('offset=40');
  });
});

describe('getHistoryStats', () => {
  it('calls history stats without period', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        period: 'week',
        totalTasks: 10,
        completedTasks: 8,
        failedTasks: 2,
        totalCollected: 500,
        totalDuplicates: 20,
        totalFailed: 10,
        successRate: 0.8,
        avgDuration: 60,
      })
    );

    await getHistoryStats();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/history/stats');
    expect(calledUrl).not.toContain('?');
  });

  it('appends period param when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ period: 'month' })
    );

    await getHistoryStats('month');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('period=month');
  });
});

describe('getTaskHistory', () => {
  it('calls task history endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'hist-1' })
    );

    await getTaskHistory('hist-1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/history/hist-1');
  });
});

describe('deleteHistory', () => {
  it('sends DELETE to history endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      text: async () => '',
    } as unknown as Response);

    await deleteHistory('hist-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/history/hist-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('cleanOldHistory', () => {
  it('sends DELETE to cleanup endpoint without days', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Cleaned', cleaned: 5 })
    );

    await cleanOldHistory();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/history/cleanup/old');
    expect(calledUrl).not.toContain('?');
  });

  it('appends days param when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'Cleaned', cleaned: 3 })
    );

    await cleanOldHistory(30);

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('days=30');
  });
});

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

describe('getSchedulerStatus', () => {
  it('calls scheduler status endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        enabled: true,
        schedulers: [],
        activeExecutions: 0,
        defaultInterval: '24h',
        timezone: 'UTC',
      })
    );

    const result = await getSchedulerStatus();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/scheduler/status');
    expect(result.enabled).toBe(true);
  });
});

describe('updateSchedulerConfig', () => {
  it('sends PUT with config data', async () => {
    const config = { enabled: false, defaultInterval: '12h' as const };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        enabled: false,
        schedulers: [],
        activeExecutions: 0,
        defaultInterval: '12h',
        timezone: 'UTC',
      })
    );

    await updateSchedulerConfig(config);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/scheduler/config'),
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(config) })
    );
  });
});

describe('triggerCollection', () => {
  it('sends POST to trigger endpoint with resource type', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        resourceType: 'arxiv',
        success: true,
        message: 'Triggered',
        taskIds: ['t1'],
      })
    );

    const result = await triggerCollection('arxiv');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/scheduler/trigger/arxiv'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.success).toBe(true);
    expect(result.resourceType).toBe('arxiv');
  });
});
