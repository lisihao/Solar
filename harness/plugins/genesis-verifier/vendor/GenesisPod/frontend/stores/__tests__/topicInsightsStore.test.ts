import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTopicInsightsStore } from '../topicInsightsStore';
import * as api from '@/services/topic-insights/api';
import type {
  ResearchTopic,
  TopicDimension,
  TopicReport,
} from '@/lib/types/topic-insights';

// Mock the API module — use importOriginal to include all exports
vi.mock('@/services/topic-insights/api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/topic-insights/api')>();
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mocked[key] =
      typeof actual[key as keyof typeof actual] === 'function'
        ? vi.fn()
        : actual[key as keyof typeof actual];
  }
  return mocked;
});

// Mock logger
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockApi = vi.mocked(api);

/** Wrap a topics array into the paginated response format */
const wrapTopics = (topics: ResearchTopic[]): api.GetTopicsResponse => ({
  topics,
  total: topics.length,
  skip: 0,
  take: 20,
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeTopic = (overrides: Partial<ResearchTopic> = {}): ResearchTopic =>
  ({
    id: 'topic-1',
    name: 'Test Topic',
    description: 'A test research topic',
    type: 'PUBLIC' as ResearchTopic['type'],
    createdById: 'user-1',
    createdBy: {
      id: 'user-1',
      username: 'testuser',
      fullName: 'Test User',
      avatarUrl: null,
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }) as ResearchTopic;

const makeDimension = (
  overrides: Partial<TopicDimension> = {}
): TopicDimension =>
  ({
    id: 'dim-1',
    topicId: 'topic-1',
    name: 'Test Dimension',
    description: 'A test dimension',
    order: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }) as TopicDimension;

const makeReport = (overrides: Partial<TopicReport> = {}): TopicReport =>
  ({
    id: 'report-1',
    topicId: 'topic-1',
    title: 'Test Report',
    content: 'Report content',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }) as TopicReport;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStore() {
  return renderHook(() => useTopicInsightsStore());
}

function resetStore() {
  const { result } = getStore();
  act(() => {
    result.current.resetStore();
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('topicInsightsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set safe default implementations so any incidental call to the API
    // (e.g. triggered by store internals during resetStore) returns a valid
    // shape instead of undefined.  Individual tests override these as needed.
    mockApi.getTopics.mockResolvedValue(wrapTopics([]));
    mockApi.getTopic.mockResolvedValue(makeTopic());
    mockApi.createTopic.mockResolvedValue(makeTopic());
    mockApi.updateTopic.mockResolvedValue(makeTopic());
    mockApi.deleteTopic.mockResolvedValue(undefined);
    mockApi.getDimensions.mockResolvedValue([]);
    mockApi.addDimension.mockResolvedValue(makeDimension());
    mockApi.updateDimension.mockResolvedValue(makeDimension());
    mockApi.deleteDimension.mockResolvedValue(undefined);
    mockApi.getReports.mockResolvedValue({
      reports: [],
      hasMore: false,
      nextCursor: undefined,
    });
    mockApi.getLatestReport.mockResolvedValue(makeReport());
    mockApi.deleteReport.mockResolvedValue({ success: true, message: '' });
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  // ── Initial State ───────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('should have empty topics list', () => {
      const { result } = getStore();
      expect(result.current.topics).toEqual([]);
    });

    it('should have null currentTopic', () => {
      const { result } = getStore();
      expect(result.current.currentTopic).toBeNull();
    });

    it('should have all loading flags as false', () => {
      const { result } = getStore();
      expect(result.current.isLoadingTopics).toBe(false);
      expect(result.current.isLoadingDimensions).toBe(false);
      expect(result.current.isLoadingReports).toBe(false);
      expect(result.current.isLoadingEvidence).toBe(false);
      expect(result.current.isLoadingMission).toBe(false);
      expect(result.current.isLoadingTodos).toBe(false);
    });

    it('should have null error', () => {
      const { result } = getStore();
      expect(result.current.error).toBeNull();
    });

    it('should have empty dimensions list', () => {
      const { result } = getStore();
      expect(result.current.dimensions).toEqual([]);
    });

    it('should have empty reports list', () => {
      const { result } = getStore();
      expect(result.current.reports).toEqual([]);
      expect(result.current.currentReport).toBeNull();
      expect(result.current.hasMoreReports).toBe(false);
      expect(result.current.reportsCursor).toBeNull();
    });
  });

  // ── Topics ──────────────────────────────────────────────────────────────────

  describe('fetchTopics', () => {
    it('should set topics on success', async () => {
      const topics = [
        makeTopic({ id: 'topic-1' }),
        makeTopic({ id: 'topic-2' }),
      ];
      mockApi.getTopics.mockResolvedValue(wrapTopics(topics));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });

      expect(result.current.topics).toEqual(topics);
      expect(result.current.isLoadingTopics).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set isLoadingTopics=true during fetch', async () => {
      let resolveTopics!: (v: api.GetTopicsResponse) => void;
      const promise = new Promise<api.GetTopicsResponse>((res) => {
        resolveTopics = res;
      });
      mockApi.getTopics.mockReturnValue(promise);

      const { result } = getStore();
      act(() => {
        result.current.fetchTopics();
      });

      expect(result.current.isLoadingTopics).toBe(true);

      await act(async () => {
        resolveTopics(wrapTopics([]));
        await promise;
      });

      expect(result.current.isLoadingTopics).toBe(false);
    });

    it('should set error and clear loading on failure', async () => {
      mockApi.getTopics.mockRejectedValue(new Error('Network error'));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics().catch(() => {});
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.isLoadingTopics).toBe(false);
    });

    it('should throw on failure', async () => {
      mockApi.getTopics.mockRejectedValue(new Error('Network error'));

      const { result } = getStore();
      await expect(
        act(async () => result.current.fetchTopics())
      ).rejects.toThrow('Network error');
    });

    it('should pass options to API', async () => {
      mockApi.getTopics.mockResolvedValue(wrapTopics([]));
      const { result } = getStore();

      await act(async () => {
        await result.current.fetchTopics({ search: 'test' } as Parameters<
          typeof result.current.fetchTopics
        >[0]);
      });

      expect(mockApi.getTopics).toHaveBeenCalledWith({
        search: 'test',
        skip: 0,
        take: 20,
      });
    });
  });

  describe('fetchTopic', () => {
    it('should set currentTopic and update topics list', async () => {
      const existing = makeTopic({ id: 'topic-1', name: 'Old Name' });
      const updated = makeTopic({ id: 'topic-1', name: 'New Name' });

      // Seed topics
      mockApi.getTopics.mockResolvedValue(wrapTopics([existing]));
      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });

      mockApi.getTopic.mockResolvedValue(updated);
      await act(async () => {
        await result.current.fetchTopic('topic-1');
      });

      expect(result.current.currentTopic).toEqual(updated);
      expect(result.current.topics[0]).toEqual(updated);
    });

    it('should set error on failure', async () => {
      mockApi.getTopic.mockRejectedValue(new Error('Not found'));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopic('topic-x').catch(() => {});
      });

      expect(result.current.error).toBe('Not found');
    });
  });

  describe('createTopic', () => {
    it('should prepend new topic to topics list', async () => {
      const existing = makeTopic({ id: 'topic-1' });
      const newTopic = makeTopic({ id: 'topic-new', name: 'New Topic' });

      mockApi.getTopics.mockResolvedValue(wrapTopics([existing]));
      mockApi.createTopic.mockResolvedValue(newTopic);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });
      await act(async () => {
        await result.current.createTopic({ name: 'New Topic' } as Parameters<
          typeof result.current.createTopic
        >[0]);
      });

      expect(result.current.topics[0]).toEqual(newTopic);
      expect(result.current.topics[1]).toEqual(existing);
    });

    it('should return the newly created topic', async () => {
      const newTopic = makeTopic({ id: 'topic-new' });
      mockApi.createTopic.mockResolvedValue(newTopic);

      const { result } = getStore();
      let returnedTopic!: ResearchTopic;
      await act(async () => {
        returnedTopic = await result.current.createTopic({
          name: 'New',
        } as Parameters<typeof result.current.createTopic>[0]);
      });

      expect(returnedTopic).toEqual(newTopic);
    });
  });

  describe('updateTopic', () => {
    it('should update topic in list', async () => {
      const original = makeTopic({ id: 'topic-1', name: 'Original' });
      const updated = makeTopic({ id: 'topic-1', name: 'Updated' });

      mockApi.getTopics.mockResolvedValue(wrapTopics([original]));
      mockApi.updateTopic.mockResolvedValue(updated);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });
      await act(async () => {
        await result.current.updateTopic('topic-1', {
          name: 'Updated',
        } as Parameters<typeof result.current.updateTopic>[1]);
      });

      expect(result.current.topics[0].name).toBe('Updated');
    });

    it('should update currentTopic if it matches', async () => {
      const original = makeTopic({ id: 'topic-1', name: 'Original' });
      const updated = makeTopic({ id: 'topic-1', name: 'Updated' });

      mockApi.getTopics.mockResolvedValue(wrapTopics([original]));
      mockApi.updateTopic.mockResolvedValue(updated);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });
      act(() => {
        result.current.setCurrentTopic(original);
      });

      await act(async () => {
        await result.current.updateTopic('topic-1', {
          name: 'Updated',
        } as Parameters<typeof result.current.updateTopic>[1]);
      });

      expect(result.current.currentTopic?.name).toBe('Updated');
    });
  });

  describe('patchTopic', () => {
    it('should locally update topic without calling API', async () => {
      const original = makeTopic({ id: 'topic-1', name: 'Original' });
      mockApi.getTopics.mockResolvedValue(wrapTopics([original]));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });

      act(() => {
        result.current.patchTopic('topic-1', { name: 'Patched' });
      });

      expect(result.current.topics[0].name).toBe('Patched');
      expect(mockApi.updateTopic).not.toHaveBeenCalled();
    });

    it('should also update currentTopic if it matches', async () => {
      const original = makeTopic({ id: 'topic-1', name: 'Original' });
      mockApi.getTopics.mockResolvedValue(wrapTopics([original]));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });
      act(() => {
        result.current.setCurrentTopic(original);
      });

      act(() => {
        result.current.patchTopic('topic-1', { name: 'Patched' });
      });

      expect(result.current.currentTopic?.name).toBe('Patched');
    });
  });

  describe('deleteTopic', () => {
    it('should remove topic from list', async () => {
      const t1 = makeTopic({ id: 'topic-1' });
      const t2 = makeTopic({ id: 'topic-2' });
      mockApi.getTopics.mockResolvedValue(wrapTopics([t1, t2]));
      mockApi.deleteTopic.mockResolvedValue(undefined);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });
      await act(async () => {
        await result.current.deleteTopic('topic-1');
      });

      expect(result.current.topics).toHaveLength(1);
      expect(result.current.topics[0].id).toBe('topic-2');
    });

    it('should clear currentTopic if it was deleted', async () => {
      const t1 = makeTopic({ id: 'topic-1' });
      mockApi.getTopics.mockResolvedValue(wrapTopics([t1]));
      mockApi.deleteTopic.mockResolvedValue(undefined);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });
      act(() => {
        result.current.setCurrentTopic(t1);
      });

      await act(async () => {
        await result.current.deleteTopic('topic-1');
      });

      expect(result.current.currentTopic).toBeNull();
    });
  });

  describe('setCurrentTopic', () => {
    it('should set currentTopic', () => {
      const topic = makeTopic();
      const { result } = getStore();

      act(() => {
        result.current.setCurrentTopic(topic);
      });

      expect(result.current.currentTopic).toEqual(topic);
    });

    it('should clear currentTopic when null is passed', () => {
      const topic = makeTopic();
      const { result } = getStore();

      act(() => {
        result.current.setCurrentTopic(topic);
      });
      act(() => {
        result.current.setCurrentTopic(null);
      });

      expect(result.current.currentTopic).toBeNull();
    });
  });

  // ── Dimensions ──────────────────────────────────────────────────────────────

  describe('fetchDimensions', () => {
    it('should set dimensions on success', async () => {
      const dims = [
        makeDimension({ id: 'dim-1' }),
        makeDimension({ id: 'dim-2' }),
      ];
      mockApi.getDimensions.mockResolvedValue(dims);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchDimensions('topic-1');
      });

      expect(result.current.dimensions).toEqual(dims);
      expect(result.current.isLoadingDimensions).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set isLoadingDimensions=true during fetch', async () => {
      let resolve!: (v: TopicDimension[]) => void;
      const promise = new Promise<TopicDimension[]>((res) => {
        resolve = res;
      });
      mockApi.getDimensions.mockReturnValue(promise);

      const { result } = getStore();
      act(() => {
        result.current.fetchDimensions('topic-1');
      });

      expect(result.current.isLoadingDimensions).toBe(true);

      await act(async () => {
        resolve([]);
        await promise;
      });
      expect(result.current.isLoadingDimensions).toBe(false);
    });

    it('should set error and clear loading on failure', async () => {
      mockApi.getDimensions.mockRejectedValue(new Error('Dimensions error'));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchDimensions('topic-1').catch(() => {});
      });

      expect(result.current.error).toBe('Dimensions error');
      expect(result.current.isLoadingDimensions).toBe(false);
    });
  });

  describe('addDimension', () => {
    it('should append new dimension to list', async () => {
      const existing = makeDimension({ id: 'dim-1' });
      const newDim = makeDimension({ id: 'dim-new' });

      mockApi.getDimensions.mockResolvedValue([existing]);
      mockApi.addDimension.mockResolvedValue(newDim);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchDimensions('topic-1');
      });
      await act(async () => {
        await result.current.addDimension('topic-1', {
          name: 'New Dim',
        } as Parameters<typeof result.current.addDimension>[1]);
      });

      expect(result.current.dimensions).toHaveLength(2);
      expect(result.current.dimensions[1]).toEqual(newDim);
    });
  });

  describe('updateDimension', () => {
    it('should update dimension in list', async () => {
      const original = makeDimension({ id: 'dim-1', name: 'Original' });
      const updated = makeDimension({ id: 'dim-1', name: 'Updated' });

      mockApi.getDimensions.mockResolvedValue([original]);
      mockApi.updateDimension.mockResolvedValue(updated);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchDimensions('topic-1');
      });
      await act(async () => {
        await result.current.updateDimension('topic-1', 'dim-1', {
          name: 'Updated',
        } as Parameters<typeof result.current.updateDimension>[2]);
      });

      expect(result.current.dimensions[0].name).toBe('Updated');
    });
  });

  describe('deleteDimension', () => {
    it('should remove dimension from list', async () => {
      const d1 = makeDimension({ id: 'dim-1' });
      const d2 = makeDimension({ id: 'dim-2' });

      mockApi.getDimensions.mockResolvedValue([d1, d2]);
      mockApi.deleteDimension.mockResolvedValue(undefined);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchDimensions('topic-1');
      });
      await act(async () => {
        await result.current.deleteDimension('topic-1', 'dim-1');
      });

      expect(result.current.dimensions).toHaveLength(1);
      expect(result.current.dimensions[0].id).toBe('dim-2');
    });
  });

  // ── Reports ─────────────────────────────────────────────────────────────────

  describe('fetchReports', () => {
    it('should set reports on success', async () => {
      const reports = [makeReport({ id: 'r-1' }), makeReport({ id: 'r-2' })];
      mockApi.getReports.mockResolvedValue({
        reports,
        hasMore: false,
        nextCursor: undefined,
      });

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchReports('topic-1');
      });

      expect(result.current.reports).toEqual(reports);
      expect(result.current.isLoadingReports).toBe(false);
      expect(result.current.hasMoreReports).toBe(false);
    });

    it('should set hasMoreReports and cursor for pagination', async () => {
      const reports = [makeReport()];
      mockApi.getReports.mockResolvedValue({
        reports,
        hasMore: true,
        nextCursor: 'cursor-abc',
      });

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchReports('topic-1');
      });

      expect(result.current.hasMoreReports).toBe(true);
      expect(result.current.reportsCursor).toBe('cursor-abc');
    });

    it('should append reports when loadMore=true', async () => {
      const first = [makeReport({ id: 'r-1' })];
      const second = [makeReport({ id: 'r-2' })];

      mockApi.getReports.mockResolvedValueOnce({
        reports: first,
        hasMore: true,
        nextCursor: 'cursor-1',
      });
      mockApi.getReports.mockResolvedValueOnce({
        reports: second,
        hasMore: false,
        nextCursor: undefined,
      });

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchReports('topic-1');
      });
      await act(async () => {
        await result.current.fetchReports('topic-1', true);
      });

      expect(result.current.reports).toHaveLength(2);
      expect(result.current.reports[0].id).toBe('r-1');
      expect(result.current.reports[1].id).toBe('r-2');
    });

    it('should set error for non-404 failures', async () => {
      mockApi.getReports.mockRejectedValue(new Error('Server error'));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchReports('topic-1').catch(() => {});
      });

      expect(result.current.error).toBe('Server error');
      expect(result.current.isLoadingReports).toBe(false);
    });

    it('should NOT set error for "No reports found" (expected for new topics)', async () => {
      mockApi.getReports.mockRejectedValue(new Error('No reports found'));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchReports('topic-1');
      });

      expect(result.current.error).toBeNull();
      expect(result.current.isLoadingReports).toBe(false);
    });

    it('should NOT set error for 404 responses', async () => {
      mockApi.getReports.mockRejectedValue(new Error('404 Not Found'));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchReports('topic-1');
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchLatestReport', () => {
    it('should set currentReport on success', async () => {
      const report = makeReport();
      mockApi.getLatestReport.mockResolvedValue(report);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchLatestReport('topic-1');
      });

      expect(result.current.currentReport).toEqual(report);
    });

    it('should set currentReport=null and NO error for "Report not found"', async () => {
      // Pre-set a report so we can verify it gets cleared
      const { result } = getStore();
      act(() => {
        result.current.setCurrentReport(makeReport());
      });

      mockApi.getLatestReport.mockRejectedValue(new Error('Report not found'));
      await act(async () => {
        await result.current.fetchLatestReport('topic-1');
      });

      expect(result.current.currentReport).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should set error for non-404 failures', async () => {
      mockApi.getLatestReport.mockRejectedValue(
        new Error('Service unavailable')
      );

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchLatestReport('topic-1');
      });

      expect(result.current.error).toBe('Service unavailable');
    });
  });

  describe('setCurrentReport', () => {
    it('should set currentReport', () => {
      const report = makeReport();
      const { result } = getStore();

      act(() => {
        result.current.setCurrentReport(report);
      });

      expect(result.current.currentReport).toEqual(report);
    });

    it('should clear currentReport when null is passed', () => {
      const report = makeReport();
      const { result } = getStore();

      act(() => {
        result.current.setCurrentReport(report);
      });
      act(() => {
        result.current.setCurrentReport(null);
      });

      expect(result.current.currentReport).toBeNull();
    });
  });

  describe('deleteReport', () => {
    it('should remove report from list', async () => {
      const r1 = makeReport({ id: 'r-1' });
      const r2 = makeReport({ id: 'r-2' });

      mockApi.getReports.mockResolvedValue({
        reports: [r1, r2],
        hasMore: false,
        nextCursor: undefined,
      });
      mockApi.deleteReport.mockResolvedValue({ success: true, message: '' });

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchReports('topic-1');
      });
      await act(async () => {
        await result.current.deleteReport('topic-1', 'r-1');
      });

      expect(result.current.reports).toHaveLength(1);
      expect(result.current.reports[0].id).toBe('r-2');
    });
  });

  // ── UI Actions ──────────────────────────────────────────────────────────────

  describe('clearError', () => {
    it('should clear the error state', async () => {
      mockApi.getTopics.mockRejectedValue(new Error('Some error'));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics().catch(() => {});
      });
      expect(result.current.error).toBe('Some error');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('resetStore', () => {
    it('should reset all state to initial values', async () => {
      const topics = [makeTopic()];
      mockApi.getTopics.mockResolvedValue(wrapTopics(topics));

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });
      expect(result.current.topics).toHaveLength(1);

      act(() => {
        result.current.resetStore();
      });

      expect(result.current.topics).toEqual([]);
      expect(result.current.currentTopic).toBeNull();
      expect(result.current.dimensions).toEqual([]);
      expect(result.current.reports).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.isLoadingTopics).toBe(false);
    });
  });

  describe('resetTopicData', () => {
    it('should clear topic-specific data but preserve topics list', async () => {
      const topics = [makeTopic({ id: 't-1' }), makeTopic({ id: 't-2' })];
      const dims = [makeDimension()];

      mockApi.getTopics.mockResolvedValue(wrapTopics(topics));
      mockApi.getDimensions.mockResolvedValue(dims);

      const { result } = getStore();
      await act(async () => {
        await result.current.fetchTopics();
      });
      await act(async () => {
        await result.current.fetchDimensions('t-1');
      });

      expect(result.current.topics).toHaveLength(2);
      expect(result.current.dimensions).toHaveLength(1);

      act(() => {
        result.current.resetTopicData();
      });

      // Topics list preserved
      expect(result.current.topics).toHaveLength(2);
      // Topic-specific data cleared
      expect(result.current.dimensions).toEqual([]);
      expect(result.current.reports).toEqual([]);
      expect(result.current.currentReport).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.isRefreshing).toBe(false);
    });
  });
});
