/**
 * Tests for lib/api/ai-writing.ts
 *
 * Uses raw fetch mocking (file uses its own fetchWithAuth, not apiClient).
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
  getStylePresets,
  getRecommendedStyles,
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getVolumes,
  createVolume,
  getChapters,
  getChapter,
  updateChapter,
  createChapter,
  getStoryBible,
  updateStoryBible,
  getCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  getRelationshipGraph,
  startMission,
  getMissionStatus,
  cancelMission,
  getProjectMissions,
  getMissionLogs,
  startChapterWriting,
  getChapterRevisions,
  updateChapterContent,
  aiEditChapter,
  compareRevisions,
  rollbackRevision,
  ApiError,
  // Annotation APIs
  getChapterAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  resolveAnnotations,
  // Import APIs
  parseImport,
  confirmImport,
  getImportStatus,
  getImportHistory,
  cancelImport,
  // DOME/SCORE APIs
  getCompletionAnalysis,
  getTimelineConflicts,
  getChapterTimelineConflicts,
  getHierarchicalSummaries,
  generateSummaries,
  getScratchpad,
  getAnalysisDashboard,
} from './api';
import type { AnnotationStatus, AnnotationType } from './api';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthTokens.mockReturnValue({ accessToken: 'test-token' });
  global.fetch = vi.fn();
});

// ---------------------------------------------------------------------------
// Tests: fetchWithAuth internals
// ---------------------------------------------------------------------------

describe('fetchWithAuth - core behaviour', () => {
  it('sets Authorization header', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ presets: [] })
    );

    await getStylePresets();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('omits Authorization when no token', async () => {
    mockGetAuthTokens.mockReturnValue(null);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ presets: [] })
    );

    await getStylePresets();

    const headers = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers;
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('unwraps { success, data } envelope', async () => {
    const project = { id: 'p1', name: 'Fantasy Novel' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse(project)
    );

    const result = await getProject('p1');

    expect(result).toEqual(project);
  });

  it('returns empty object for empty response body', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    const result = await deleteProject('p1');

    expect(result).toEqual({});
  });

  it('throws ApiError on non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse('Project not found', 404)
    );

    await expect(getProject('bad-id')).rejects.toBeInstanceOf(ApiError);
  });

  it('ApiError carries the HTTP status code', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse('Unauthorized', 403)
    );

    let thrown: unknown;
    try {
      await getProject('p1');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Style Presets
// ---------------------------------------------------------------------------

describe('getStylePresets', () => {
  it('calls style-presets endpoint and returns data', async () => {
    const presets = [{ id: 's1', name: 'Literary Fiction' }];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ presets })
    );

    const result = await getStylePresets();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/style-presets'),
      expect.anything()
    );
    expect(result).toMatchObject({ presets });
  });
});

describe('getRecommendedStyles', () => {
  it('appends genre param to URL', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ genre: 'fantasy', recommended: [], all: [] })
    );

    await getRecommendedStyles('fantasy');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('genre=fantasy');
  });

  it('encodes special characters in genre', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ genre: 'sci fi', recommended: [], all: [] })
    );

    await getRecommendedStyles('sci fi');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('sci%20fi');
  });
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

describe('getProjects', () => {
  it('calls projects endpoint without params by default', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ items: [], nextCursor: undefined })
    );

    await getProjects();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/api/v1/ai-writing/projects');
    expect(calledUrl).not.toContain('?');
  });

  it('appends status, limit, and cursor params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ items: [] })
    );

    await getProjects({ status: 'WRITING', limit: 5, cursor: 'cur-abc' });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('status=WRITING');
    expect(calledUrl).toContain('limit=5');
    expect(calledUrl).toContain('cursor=cur-abc');
  });
});

describe('getProject', () => {
  it('calls project by id endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'p1', name: 'Epic Fantasy' })
    );

    await getProject('p1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1'),
      expect.anything()
    );
  });
});

describe('createProject', () => {
  it('sends POST with dto', async () => {
    const dto = { name: 'New Novel', genre: 'fantasy', targetWords: 80000 };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'p-new', ...dto })
    );

    const result = await createProject(dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(dto) })
    );
    expect(result).toMatchObject({ id: 'p-new' });
  });
});

describe('updateProject', () => {
  it('sends PATCH with partial dto', async () => {
    const dto = { name: 'Updated Novel' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'p1', ...dto })
    );

    await updateProject('p1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(dto) })
    );
  });
});

describe('deleteProject', () => {
  it('sends DELETE to project endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await deleteProject('p1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ---------------------------------------------------------------------------
// Volumes & Chapters
// ---------------------------------------------------------------------------

describe('getVolumes', () => {
  it('calls volumes endpoint for a project', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'v1' }])
    );

    await getVolumes('p1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1/volumes'),
      expect.anything()
    );
  });
});

describe('createVolume', () => {
  it('sends POST with volume dto', async () => {
    const dto = { title: 'Volume 1', volumeNumber: 1 };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'v-new', ...dto })
    );

    await createVolume('p1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1/volumes'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getChapters', () => {
  it('calls chapters endpoint for a volume', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'ch1' }])
    );

    await getChapters('v1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/volumes/v1/chapters'),
      expect.anything()
    );
  });
});

describe('getChapter', () => {
  it('calls chapter by id endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'ch1', title: 'Prologue' })
    );

    await getChapter('ch1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/chapters/ch1'),
      expect.anything()
    );
  });
});

describe('updateChapter', () => {
  it('sends PATCH with chapter content', async () => {
    const dto = { title: 'New Title', content: 'Once upon a time...' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'ch1', ...dto })
    );

    await updateChapter('ch1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/chapters/ch1'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(dto) })
    );
  });
});

describe('createChapter', () => {
  it('sends POST to volume chapters endpoint', async () => {
    const dto = { title: 'Chapter 1', chapterNumber: 1 };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'ch-new', ...dto })
    );

    await createChapter('v1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/volumes/v1/chapters'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// Story Bible
// ---------------------------------------------------------------------------

describe('getStoryBible', () => {
  it('calls bible endpoint for project', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'bible-1', projectId: 'p1' })
    );

    await getStoryBible('p1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1/bible'),
      expect.anything()
    );
  });
});

describe('updateStoryBible', () => {
  it('sends PATCH to bible endpoint', async () => {
    const dto = { premise: 'A world where dragons rule' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'bible-1', ...dto })
    );

    await updateStoryBible('p1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1/bible'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

describe('getCharacters', () => {
  it('calls characters endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'char-1' }])
    );

    await getCharacters('p1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1/characters'),
      expect.anything()
    );
  });
});

describe('createCharacter', () => {
  it('sends POST with character dto', async () => {
    const dto = {
      name: 'Aragorn',
      role: 'hero',
      description: 'Ranger of the north',
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'char-new', ...dto })
    );

    await createCharacter('p1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1/characters'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('updateCharacter', () => {
  it('sends PATCH to character endpoint', async () => {
    const dto = { description: 'King of Gondor' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'char-1', ...dto })
    );

    await updateCharacter('p1', 'char-1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/p1/characters/char-1'
      ),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('deleteCharacter', () => {
  it('sends DELETE to character endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await deleteCharacter('p1', 'char-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/p1/characters/char-1'
      ),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('getRelationshipGraph', () => {
  it('calls relationship graph endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ nodes: [], edges: [] })
    );

    await getRelationshipGraph('p1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/p1/relationships/graph'
      ),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// AI Missions
// ---------------------------------------------------------------------------

describe('startMission', () => {
  it('sends POST with mission dto', async () => {
    const dto = { prompt: 'Write chapter 1', missionType: 'chapter' as const };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        success: true,
        missionId: 'm1',
        projectId: 'p1',
        message: 'Started',
        missionType: 'chapter',
      })
    );

    const result = await startMission('p1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1/missions'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({ missionId: 'm1' });
  });
});

describe('getMissionStatus', () => {
  it('calls mission status endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        id: 'm1',
        status: 'IN_PROGRESS',
        missionType: 'chapter',
        startedAt: '2025-01-01',
      })
    );

    await getMissionStatus('m1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/missions/m1'),
      expect.anything()
    );
  });
});

describe('cancelMission', () => {
  it('sends POST to cancel endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true })
    );

    await cancelMission('m1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/missions/m1/cancel'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getProjectMissions', () => {
  it('calls project missions endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ items: [], total: 0 })
    );

    await getProjectMissions('p1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/p1/missions'),
      expect.anything()
    );
  });
});

describe('getMissionLogs', () => {
  it('calls mission logs endpoint without params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ items: [], total: 0 })
    );

    await getMissionLogs('m1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/api/v1/ai-writing/missions/m1/logs');
    expect(calledUrl).not.toContain('?');
  });

  it('appends limit and offset params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ items: [], total: 0 })
    );

    await getMissionLogs('m1', 50, 10);

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).toContain('offset=10');
  });
});

// ---------------------------------------------------------------------------
// Writing Actions & Revisions
// ---------------------------------------------------------------------------

describe('startChapterWriting', () => {
  it('sends POST to chapter write endpoint', async () => {
    const dto = { prompt: 'Continue the story' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, message: 'Writing started' })
    );

    await startChapterWriting('ch1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/chapters/ch1/write'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getChapterRevisions', () => {
  it('calls revisions endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ items: [], total: 0 })
    );

    await getChapterRevisions('ch1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/chapters/ch1/revisions'),
      expect.anything()
    );
  });
});

describe('updateChapterContent', () => {
  it('sends PATCH to content endpoint', async () => {
    const dto = { content: 'Updated content', changeSummary: 'Fixed typos' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        chapter: { id: 'ch1', content: dto.content, wordCount: 100 },
        revision: { id: 'rev1' },
      })
    );

    await updateChapterContent('ch1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/chapters/ch1/content'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(dto) })
    );
  });
});

describe('aiEditChapter', () => {
  it('sends POST to ai-edit endpoint', async () => {
    const dto = {
      operation: 'polish' as const,
      userFeedback: 'Make it more poetic',
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        chapter: { id: 'ch1', content: '...', wordCount: 200 },
        revision: { id: 'rev2' },
        changes: [],
      })
    );

    await aiEditChapter('ch1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/chapters/ch1/ai-edit'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('compareRevisions', () => {
  it('calls diff endpoint with both revision IDs', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        revision1: {},
        revision2: {},
        diff: { additions: [], deletions: [], changes: [] },
      })
    );

    await compareRevisions('ch1', 'rev1', 'rev2');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain(
      '/api/v1/ai-writing/chapters/ch1/revisions/diff'
    );
    expect(calledUrl).toContain('v1=rev1');
    expect(calledUrl).toContain('v2=rev2');
  });
});

describe('rollbackRevision', () => {
  it('sends POST to rollback endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        chapter: { id: 'ch1', content: '...', wordCount: 150 },
        newRevision: { id: 'rev3' },
      })
    );

    await rollbackRevision('ch1', 'rev1', 'Reverting bad AI edit');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/chapters/ch1/revisions/rev1/rollback'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// ApiError class
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('carries status code and message', () => {
    const err = new ApiError('Not Found', 404);

    expect(err.status).toBe(404);
    expect(err.message).toBe('Not Found');
    expect(err.name).toBe('ApiError');
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Annotation APIs
// ---------------------------------------------------------------------------

describe('getChapterAnnotations', () => {
  it('calls annotations endpoint without status param by default', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [], total: 0 })
    );

    await getChapterAnnotations('chapter-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/chapters/chapter-1/annotations'
      ),
      expect.anything()
    );
  });

  it('includes status param when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [], total: 0 })
    );

    await getChapterAnnotations('chapter-1', 'OPEN' as AnnotationStatus);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('?status=OPEN'),
      expect.anything()
    );
  });
});

describe('createAnnotation', () => {
  it('sends POST with annotation dto', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'ann-1', content: 'Fix this' })
    );

    await createAnnotation('chapter-1', {
      startOffset: 10,
      endOffset: 20,
      content: 'Fix this',
      type: 'COMMENT' as AnnotationType,
      selectedText: 'the text',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/chapters/chapter-1/annotations'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('updateAnnotation', () => {
  it('sends PATCH to annotation-specific endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ id: 'ann-1', content: 'Updated' })
    );

    await updateAnnotation('chapter-1', 'ann-1', { content: 'Updated' });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/chapters/chapter-1/annotations/ann-1'
      ),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('deleteAnnotation', () => {
  it('sends DELETE to annotation-specific endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true })
    );

    await deleteAnnotation('chapter-1', 'ann-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/chapters/chapter-1/annotations/ann-1'
      ),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('resolveAnnotations', () => {
  it('sends POST with annotationIds', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ resolved: 3 })
    );

    await resolveAnnotations('chapter-1', ['ann-1', 'ann-2', 'ann-3']);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/chapters/chapter-1/annotations/resolve'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// Import APIs
// ---------------------------------------------------------------------------

describe('parseImport', () => {
  it('sends POST to import/parse endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        success: true,
        importId: 'import-1',
        preview: { totalChapters: 10, totalWords: 5000, chapters: [] },
      })
    );

    await parseImport('project-1', {
      source: 'PASTE',
      content: 'Chapter content',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/project-1/import/parse'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('confirmImport', () => {
  it('sends POST to import confirm endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true, importId: 'import-1' })
    );

    await confirmImport('project-1', 'import-1', {
      targetVolumeId: 'vol-1',
      startChapterNumber: 1,
      selectedChapters: [0, 1, 2],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/project-1/import/import-1/confirm'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getImportStatus', () => {
  it('calls import status endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        id: 'import-1',
        status: 'COMPLETED',
        source: 'PASTE',
        totalChapters: 5,
        totalWords: 2000,
        createdAt: '2026-01-01',
        completedAt: '2026-01-01',
      })
    );

    await getImportStatus('project-1', 'import-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/project-1/import/import-1'
      ),
      expect.anything()
    );
  });
});

describe('getImportHistory', () => {
  it('calls import history endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ items: [], total: 0 })
    );

    await getImportHistory('project-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/project-1/import/history'
      ),
      expect.anything()
    );
  });
});

describe('cancelImport', () => {
  it('sends DELETE to cancel import', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ success: true })
    );

    await cancelImport('project-1', 'import-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/project-1/import/import-1'
      ),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ---------------------------------------------------------------------------
// DOME/SCORE Enhanced Features APIs
// ---------------------------------------------------------------------------

describe('getCompletionAnalysis', () => {
  it('calls completion-analysis endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        projectId: 'proj-1',
        analysis: {
          isComplete: false,
          confidence: 0.3,
          signals: [],
          recommendation: 'Continue',
        },
        analyzedAt: '2026-01-01',
      })
    );

    await getCompletionAnalysis('proj-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/proj-1/completion-analysis'
      ),
      expect.anything()
    );
  });
});

describe('getTimelineConflicts', () => {
  it('calls timeline-conflicts endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        projectId: 'proj-1',
        conflicts: [],
        totalConflicts: 0,
        analyzedAt: '2026-01-01',
      })
    );

    await getTimelineConflicts('proj-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/proj-1/timeline-conflicts'
      ),
      expect.anything()
    );
  });
});

describe('getChapterTimelineConflicts', () => {
  it('calls chapter timeline-conflicts endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        chapterId: 'ch-1',
        conflicts: [],
        totalConflicts: 0,
        analyzedAt: '2026-01-01',
      })
    );

    await getChapterTimelineConflicts('ch-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/chapters/ch-1/timeline-conflicts'
      ),
      expect.anything()
    );
  });
});

describe('getHierarchicalSummaries', () => {
  it('calls hierarchical-summaries without options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        projectId: 'proj-1',
        context: {
          recentChapters: [],
          mediumChapters: [],
          distantContext: '',
          estimatedTokens: 0,
        },
        formattedContext: '',
      })
    );

    await getHierarchicalSummaries('proj-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/proj-1/hierarchical-summaries'
      ),
      expect.anything()
    );
  });

  it('includes query params when options provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        projectId: 'proj-1',
        context: {
          recentChapters: [],
          mediumChapters: [],
          distantContext: '',
          estimatedTokens: 0,
        },
        formattedContext: '',
      })
    );

    await getHierarchicalSummaries('proj-1', {
      currentChapter: 5,
      targetTokens: 2000,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('currentChapter=5'),
      expect.anything()
    );
  });
});

describe('generateSummaries', () => {
  it('sends POST to generate-summaries endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ projectId: 'proj-1', updatedCount: 5, message: 'Done' })
    );

    await generateSummaries('proj-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/proj-1/generate-summaries'
      ),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getScratchpad', () => {
  it('calls scratchpad endpoint without options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ projectId: 'proj-1', entries: [], totalEntries: 0 })
    );

    await getScratchpad('proj-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai-writing/projects/proj-1/scratchpad'),
      expect.anything()
    );
  });

  it('includes type and limit params when provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ projectId: 'proj-1', entries: [], totalEntries: 0 })
    );

    await getScratchpad('proj-1', { type: 'QUESTION', limit: 10 });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('type=QUESTION'),
      expect.anything()
    );
  });
});

describe('getAnalysisDashboard', () => {
  it('calls analysis-dashboard endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        projectId: 'proj-1',
        projectName: 'Test Project',
        completion: null,
        conflicts: {
          total: 0,
          highSeverity: 0,
          mediumSeverity: 0,
          lowSeverity: 0,
          recentConflicts: [],
        },
        agentActivity: { recentEntries: [], totalEntries: 0 },
        analyzedAt: '2026-01-01',
      })
    );

    await getAnalysisDashboard('proj-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/ai-writing/projects/proj-1/analysis-dashboard'
      ),
      expect.anything()
    );
  });
});
