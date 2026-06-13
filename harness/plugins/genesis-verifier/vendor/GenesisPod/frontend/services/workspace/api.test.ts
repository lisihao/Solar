import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/utils/config', () => ({
  config: { apiUrl: 'http://localhost:4000/api/v1' },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi
    .fn()
    .mockReturnValue({ Authorization: 'Bearer test-token' }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  createWorkspace,
  getWorkspace,
  updateWorkspaceResources,
  createWorkspaceTask,
  getWorkspaceTask,
  listWorkspaceTemplates,
  generateWorkspaceReport,
} from '@/services/workspace/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeJsonResponse = (data: unknown, status = 200) => ({
  ok: true,
  status,
  json: vi.fn().mockResolvedValue(data),
  text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  statusText: 'OK',
});

const makeErrorResponse = (status: number, message: string) => ({
  ok: false,
  status,
  json: vi.fn().mockResolvedValue({ message }),
  text: vi.fn().mockResolvedValue(message),
  statusText: 'Error',
});

const makeWorkspaceResponse = (id = 'ws-1') => ({
  id,
  status: 'active',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  resourceCount: 2,
  resources: [],
  tasks: [],
  reports: [],
});

const makeTaskSummary = (id = 'task-1') => ({
  id,
  workspaceId: 'ws-1',
  templateId: 'tmpl-1',
  model: 'gpt-4o',
  status: 'pending',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  hasResult: false,
  hasError: false,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workspace API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // createWorkspace
  // ============================================================

  describe('createWorkspace', () => {
    it('posts to /workspaces with resourceIds', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse(makeWorkspaceResponse()));

      await createWorkspace(['res-1', 'res-2']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/workspaces',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ resourceIds: ['res-1', 'res-2'] }),
        })
      );
    });

    it('returns the workspace response', async () => {
      const ws = makeWorkspaceResponse('ws-42');
      mockFetch.mockResolvedValue(makeJsonResponse(ws));

      const result = await createWorkspace(['res-1']);
      expect(result.id).toBe('ws-42');
    });

    it('unwraps { success, data } envelope', async () => {
      const ws = makeWorkspaceResponse('ws-env');
      mockFetch.mockResolvedValue(
        makeJsonResponse({ success: true, data: ws })
      );

      const result = await createWorkspace([]);
      expect(result.id).toBe('ws-env');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Server error'));

      await expect(createWorkspace([])).rejects.toThrow('Server error');
    });

    it('includes Authorization header', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse(makeWorkspaceResponse()));

      await createWorkspace([]);

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers).toMatchObject({
        Authorization: 'Bearer test-token',
      });
    });
  });

  // ============================================================
  // getWorkspace
  // ============================================================

  describe('getWorkspace', () => {
    it('sends GET to /workspaces/:id', async () => {
      const ws = makeWorkspaceResponse('ws-5');
      mockFetch.mockResolvedValue(makeJsonResponse(ws));

      await getWorkspace('ws-5');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/workspaces/ws-5',
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });

    it('returns the workspace', async () => {
      const ws = makeWorkspaceResponse('ws-5');
      mockFetch.mockResolvedValue(makeJsonResponse(ws));

      const result = await getWorkspace('ws-5');
      expect(result.id).toBe('ws-5');
      expect(result.status).toBe('active');
    });

    it('throws on 404', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404, 'Not found'));
      await expect(getWorkspace('missing')).rejects.toThrow('Not found');
    });
  });

  // ============================================================
  // updateWorkspaceResources
  // ============================================================

  describe('updateWorkspaceResources', () => {
    it('sends PATCH with add/remove payload', async () => {
      const ws = makeWorkspaceResponse('ws-1');
      mockFetch.mockResolvedValue(makeJsonResponse(ws));

      await updateWorkspaceResources('ws-1', {
        addResourceIds: ['new-res'],
        removeResourceIds: ['old-res'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/workspaces/ws-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            addResourceIds: ['new-res'],
            removeResourceIds: ['old-res'],
          }),
        })
      );
    });

    it('returns updated workspace', async () => {
      const ws = makeWorkspaceResponse();
      mockFetch.mockResolvedValue(makeJsonResponse(ws));

      const result = await updateWorkspaceResources('ws-1', {
        addResourceIds: [],
      });
      expect(result).toEqual(ws);
    });
  });

  // ============================================================
  // createWorkspaceTask
  // ============================================================

  describe('createWorkspaceTask', () => {
    it('posts to /workspaces/:id/tasks', async () => {
      const task = makeTaskSummary('task-99');
      mockFetch.mockResolvedValue(makeJsonResponse(task));

      await createWorkspaceTask('ws-1', {
        templateId: 'tmpl-1',
        model: 'gpt-4o',
        question: 'What is AI?',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/workspaces/ws-1/tasks',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('returns the task summary', async () => {
      const task = makeTaskSummary('task-5');
      mockFetch.mockResolvedValue(makeJsonResponse(task));

      const result = await createWorkspaceTask('ws-1', {
        templateId: 'tmpl-1',
        model: '',
      });

      expect(result.id).toBe('task-5');
      expect(result.hasResult).toBe(false);
    });
  });

  // ============================================================
  // getWorkspaceTask
  // ============================================================

  describe('getWorkspaceTask', () => {
    it('sends GET to /workspaces/:wsId/tasks/:taskId', async () => {
      const task = makeTaskSummary('task-1');
      mockFetch.mockResolvedValue(makeJsonResponse(task));

      await getWorkspaceTask('ws-1', 'task-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/workspaces/ws-1/tasks/task-1',
        expect.any(Object)
      );
    });

    it('returns the task', async () => {
      const task = makeTaskSummary('task-1');
      mockFetch.mockResolvedValue(makeJsonResponse(task));

      const result = await getWorkspaceTask('ws-1', 'task-1');
      expect(result.id).toBe('task-1');
      expect(result.status).toBe('pending');
    });
  });

  // ============================================================
  // listWorkspaceTemplates
  // ============================================================

  describe('listWorkspaceTemplates', () => {
    it('sends GET to /workspaces/templates without category', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse([]));

      await listWorkspaceTemplates();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/workspaces/templates',
        expect.any(Object)
      );
    });

    it('appends category query param when provided', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse([]));

      await listWorkspaceTemplates('analysis');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/workspaces/templates?category=analysis',
        expect.any(Object)
      );
    });

    it('encodes special characters in category', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse([]));

      await listWorkspaceTemplates('research & analysis');

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('research%20%26%20analysis');
    });

    it('returns template array', async () => {
      const templates = [
        { id: 'tmpl-1', name: 'Analysis', category: 'analysis', version: 1 },
        { id: 'tmpl-2', name: 'Summary', category: 'summary', version: 1 },
      ];
      mockFetch.mockResolvedValue(makeJsonResponse(templates));

      const result = await listWorkspaceTemplates();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('tmpl-1');
    });
  });

  // ============================================================
  // generateWorkspaceReport
  // ============================================================

  describe('generateWorkspaceReport', () => {
    it('posts to /reports/generate', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ id: 'report-1' }));

      await generateWorkspaceReport({
        taskId: 'task-1',
        templateId: 'tmpl-1',
        userId: 'user-1',
        title: 'My Report',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/reports/generate',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('includes all payload fields', async () => {
      mockFetch.mockResolvedValue(makeJsonResponse({ id: 'report-1' }));

      await generateWorkspaceReport({
        taskId: 'task-1',
        templateId: 'tmpl-1',
        userId: 'user-1',
        title: 'Q1 Report',
        notes: 'Important findings',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.taskId).toBe('task-1');
      expect(body.title).toBe('Q1 Report');
      expect(body.notes).toBe('Important findings');
    });

    it('returns 204 as undefined', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: vi.fn(),
        text: vi.fn().mockResolvedValue(''),
        statusText: 'No Content',
      });

      const result = await generateWorkspaceReport({
        taskId: 'task-1',
        templateId: 'tmpl-1',
        userId: 'user-1',
      });

      expect(result).toBeUndefined();
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(400, 'Bad request'));
      await expect(
        generateWorkspaceReport({ taskId: '', templateId: '', userId: '' })
      ).rejects.toThrow();
    });
  });
});
