import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// All vi.mock calls are hoisted to the top by Vitest, so they must stay here.
vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'http://test-api',
    apiBaseUrl: 'http://test-api',
    streamApiUrl: 'http://test-stream',
    workspaceAiV2Enabled: true,
  },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn().mockReturnValue({ Authorization: 'Bearer test' }),
}));

vi.mock('@/services/workspace/api', () => ({
  createWorkspace: vi.fn(),
  getWorkspace: vi.fn(),
  updateWorkspaceResources: vi.fn(),
}));

// Mock the Zustand store with a factory so each test gets a fresh state object
const mockSetWorkspaceId = vi.fn();
const mockSetResources = vi.fn();

const reportWorkspaceState = {
  resources: [] as { id: string; type: string; title: string }[],
  workspaceId: null as string | null,
  setWorkspaceId: mockSetWorkspaceId,
  setResources: mockSetResources,
  isExpanded: false,
  maxResources: 20,
  addResource: vi.fn(),
  removeResource: vi.fn(),
  clearAll: vi.fn(),
  toggleExpanded: vi.fn(),
  hasResource: vi.fn(),
  canAddMore: vi.fn(),
};

vi.mock('../useReportWorkspace', () => ({
  useReportWorkspace: vi.fn(() => reportWorkspaceState),
}));

import {
  createWorkspace,
  getWorkspace,
  updateWorkspaceResources,
} from '@/services/workspace/api';
import { useWorkspaceSync } from '../useWorkspaceSync';
import type { WorkspaceResponse } from '@/services/workspace/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkspace(
  overrides: Partial<WorkspaceResponse> = {}
): WorkspaceResponse {
  return {
    id: 'ws-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    resourceCount: 2,
    resources: [
      {
        id: 'wr-1',
        addedAt: '2026-01-01T00:00:00Z',
        metadata: {},
        resource: {
          id: 'r-1',
          title: 'Resource 1',
          type: 'article',
          abstract: 'Summary 1',
          aiSummary: null,
          thumbnailUrl: null,
        },
      },
      {
        id: 'wr-2',
        addedAt: '2026-01-01T00:00:00Z',
        metadata: {},
        resource: {
          id: 'r-2',
          title: 'Resource 2',
          type: 'article',
          abstract: 'Summary 2',
          aiSummary: null,
          thumbnailUrl: null,
        },
      },
    ],
    tasks: [],
    reports: [],
    ...overrides,
  };
}

function setStoreState(overrides: Partial<typeof reportWorkspaceState>) {
  Object.assign(reportWorkspaceState, overrides);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkspaceSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to default state
    reportWorkspaceState.resources = [];
    reportWorkspaceState.workspaceId = null;
    reportWorkspaceState.setWorkspaceId = mockSetWorkspaceId;
    reportWorkspaceState.setResources = mockSetResources;
  });

  describe('initial state', () => {
    it('starts with null workspace', () => {
      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      expect(result.current.workspace).toBeNull();
    });

    it('starts with syncing false', () => {
      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      expect(result.current.syncing).toBe(false);
    });

    it('starts with null error', () => {
      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      expect(result.current.error).toBeNull();
    });

    it('isEnabled is true when config.workspaceAiV2Enabled is true', () => {
      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      expect(result.current.isEnabled).toBe(true);
    });
  });

  describe('ensureWorkspace (syncWorkspace)', () => {
    it('does nothing when resources are empty and no workspaceId', async () => {
      setStoreState({ resources: [], workspaceId: null });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      await act(async () => {
        await result.current.ensureWorkspace();
      });

      expect(createWorkspace).not.toHaveBeenCalled();
    });

    it('creates workspace when no workspaceId and resources meet minResources', async () => {
      const workspace = makeWorkspace();
      vi.mocked(createWorkspace).mockResolvedValue(workspace);
      setStoreState({
        resources: [
          { id: 'r-1', type: 'article', title: 'Resource 1' },
          { id: 'r-2', type: 'article', title: 'Resource 2' },
        ],
        workspaceId: null,
      });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false, minResources: 2 })
      );

      await act(async () => {
        await result.current.ensureWorkspace();
      });

      expect(createWorkspace).toHaveBeenCalledWith(['r-1', 'r-2']);
      expect(result.current.workspace).toEqual(workspace);
      expect(mockSetWorkspaceId).toHaveBeenCalledWith('ws-1');
    });

    it('does not create workspace when resources count is below minResources', async () => {
      setStoreState({
        resources: [{ id: 'r-1', type: 'article', title: 'Resource 1' }],
        workspaceId: null,
      });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false, minResources: 2 })
      );

      await act(async () => {
        await result.current.ensureWorkspace();
      });

      expect(createWorkspace).not.toHaveBeenCalled();
    });

    it('fetches existing workspace when workspaceId is present and resources match', async () => {
      const workspace = makeWorkspace();
      vi.mocked(getWorkspace).mockResolvedValue(workspace);
      setStoreState({
        resources: [
          { id: 'r-1', type: 'article', title: 'Resource 1' },
          { id: 'r-2', type: 'article', title: 'Resource 2' },
        ],
        workspaceId: 'ws-1',
      });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      await act(async () => {
        await result.current.ensureWorkspace();
      });

      expect(getWorkspace).toHaveBeenCalledWith('ws-1');
      expect(result.current.workspace).toEqual(workspace);
    });

    it('updates workspace when store has extra resource not in backend', async () => {
      const initialWorkspace = makeWorkspace();
      const updatedWorkspace = makeWorkspace({ id: 'ws-1', resourceCount: 3 });

      vi.mocked(getWorkspace).mockResolvedValue(initialWorkspace);
      vi.mocked(updateWorkspaceResources).mockResolvedValue(updatedWorkspace);
      setStoreState({
        resources: [
          { id: 'r-1', type: 'article', title: 'Resource 1' },
          { id: 'r-2', type: 'article', title: 'Resource 2' },
          { id: 'r-3', type: 'article', title: 'Resource 3' },
        ],
        workspaceId: 'ws-1',
      });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      await act(async () => {
        await result.current.ensureWorkspace();
      });

      expect(updateWorkspaceResources).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ addResourceIds: ['r-3'] })
      );
      expect(result.current.workspace).toEqual(updatedWorkspace);
    });

    it('removes resource from workspace when it is in backend but not in store', async () => {
      const initialWorkspace = makeWorkspace();
      const updatedWorkspace = makeWorkspace({ resourceCount: 1 });

      vi.mocked(getWorkspace).mockResolvedValue(initialWorkspace);
      vi.mocked(updateWorkspaceResources).mockResolvedValue(updatedWorkspace);
      setStoreState({
        // Only r-1 remains in store; r-2 should be removed
        resources: [{ id: 'r-1', type: 'article', title: 'Resource 1' }],
        workspaceId: 'ws-1',
      });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      await act(async () => {
        await result.current.ensureWorkspace();
      });

      expect(updateWorkspaceResources).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ removeResourceIds: ['r-2'] })
      );
    });

    it('sets error state when createWorkspace throws an Error', async () => {
      vi.mocked(createWorkspace).mockRejectedValue(
        new Error('Service unavailable')
      );
      setStoreState({
        resources: [
          { id: 'r-1', type: 'article', title: 'R1' },
          { id: 'r-2', type: 'article', title: 'R2' },
        ],
        workspaceId: null,
      });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false, minResources: 2 })
      );
      await act(async () => {
        await result.current.ensureWorkspace();
      });

      expect(result.current.error).toBe('Service unavailable');
    });

    it('sets generic error message when a non-Error is thrown', async () => {
      vi.mocked(createWorkspace).mockRejectedValue('string failure');
      setStoreState({
        resources: [
          { id: 'r-1', type: 'article', title: 'R1' },
          { id: 'r-2', type: 'article', title: 'R2' },
        ],
        workspaceId: null,
      });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false, minResources: 2 })
      );
      await act(async () => {
        await result.current.ensureWorkspace();
      });

      expect(result.current.error).toBe('工作区同步失败');
    });

    it('syncing is false after operation completes', async () => {
      const workspace = makeWorkspace();
      vi.mocked(createWorkspace).mockResolvedValue(workspace);
      setStoreState({
        resources: [
          { id: 'r-1', type: 'article', title: 'R1' },
          { id: 'r-2', type: 'article', title: 'R2' },
        ],
        workspaceId: null,
      });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false, minResources: 2 })
      );
      await act(async () => {
        await result.current.ensureWorkspace();
      });

      expect(result.current.syncing).toBe(false);
    });
  });

  describe('refresh', () => {
    it('fetches workspace when workspaceId is set', async () => {
      const workspace = makeWorkspace();
      vi.mocked(getWorkspace).mockResolvedValue(workspace);
      setStoreState({ workspaceId: 'ws-1' });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      await act(async () => {
        await result.current.refresh();
      });

      expect(getWorkspace).toHaveBeenCalledWith('ws-1');
      expect(result.current.workspace).toEqual(workspace);
    });

    it('does nothing when workspaceId is null', async () => {
      setStoreState({ workspaceId: null });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      await act(async () => {
        await result.current.refresh();
      });

      expect(getWorkspace).not.toHaveBeenCalled();
    });

    it('sets error when refresh fetch fails', async () => {
      vi.mocked(getWorkspace).mockRejectedValue(new Error('Not found'));
      setStoreState({ workspaceId: 'ws-1' });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      await act(async () => {
        await result.current.refresh();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Not found');
      });
    });

    it('sets generic error when non-Error is thrown during refresh', async () => {
      vi.mocked(getWorkspace).mockRejectedValue(42);
      setStoreState({ workspaceId: 'ws-1' });

      const { result } = renderHook(() =>
        useWorkspaceSync({ autoSync: false })
      );
      await act(async () => {
        await result.current.refresh();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('工作区刷新失败');
      });
    });
  });
});
