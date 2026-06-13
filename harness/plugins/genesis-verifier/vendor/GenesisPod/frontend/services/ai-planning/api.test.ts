/**
 * Tests for lib/api/ai-planning.ts
 *
 * This module uses its own fetchWithAuth (raw fetch + getAuthTokens),
 * so we mock global.fetch and getAuthTokens directly.
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
// Setup fetch mock
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  createPlan,
  getPlans,
  getTemplates,
  getPlanDetail,
  advancePhase,
  retryPhase,
  cancelPhase,
  exportPlan,
  updatePlan,
  replanFromPhase,
  deletePlan,
} from './api';

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

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PLAN_SUMMARY = {
  id: 'plan-1',
  name: 'AI Research Plan',
  goal: 'Understand AI trends',
  templateId: 'tmpl-1',
  currentPhase: 1,
  totalPhases: 3,
  phaseStatus: {},
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  memberCount: 2,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthTokens.mockReturnValue({ accessToken: 'plan-token' });
});

// ---------------------------------------------------------------------------
// fetchWithAuth core behaviour
// ---------------------------------------------------------------------------

describe('fetchWithAuth - auth headers', () => {
  it('attaches Authorization header when token exists', async () => {
    mockFetch.mockResolvedValue(wrappedResponse([]));

    await getPlans();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer plan-token',
        }),
      })
    );
  });

  it('omits Authorization header when no token', async () => {
    mockGetAuthTokens.mockReturnValue(null);
    mockFetch.mockResolvedValue(jsonResponse([]));

    await getPlans();

    const headers = mockFetch.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('unwraps { success, data } envelope', async () => {
    mockFetch.mockResolvedValue(wrappedResponse([PLAN_SUMMARY]));

    const result = await getPlans();

    expect(result).toEqual([PLAN_SUMMARY]);
  });

  it('returns raw response when envelope is absent', async () => {
    mockFetch.mockResolvedValue(jsonResponse([PLAN_SUMMARY]));

    const result = await getPlans();

    expect(result).toEqual([PLAN_SUMMARY]);
  });

  it('throws on non-ok response with JSON error message', async () => {
    mockFetch.mockResolvedValue(errorResponse('Plan not found', 404));

    await expect(getPlanDetail('missing')).rejects.toThrow('Plan not found');
  });

  it('throws fallback message when error body has no message', async () => {
    mockFetch.mockResolvedValue(
      new Response('{}', {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(getPlanDetail('p-1')).rejects.toThrow('HTTP 500');
  });
});

// ---------------------------------------------------------------------------
// createPlan
// ---------------------------------------------------------------------------

describe('createPlan', () => {
  it('calls POST /api/v1/planning with DTO', async () => {
    mockFetch.mockResolvedValue(wrappedResponse({ planId: 'plan-1' }));

    const result = await createPlan({
      name: 'AI Research',
      goal: 'Understand AI',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'AI Research', goal: 'Understand AI' }),
      })
    );
    expect(result.planId).toBe('plan-1');
  });

  it('includes optional templateId and depth when provided', async () => {
    mockFetch.mockResolvedValue(wrappedResponse({ planId: 'plan-2' }));

    await createPlan({
      name: 'Research',
      goal: 'Goal',
      templateId: 'tmpl-1',
      depth: 'deep',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.templateId).toBe('tmpl-1');
    expect(body.depth).toBe('deep');
  });
});

// ---------------------------------------------------------------------------
// getPlans
// ---------------------------------------------------------------------------

describe('getPlans', () => {
  it('calls GET /api/v1/planning without search', async () => {
    mockFetch.mockResolvedValue(jsonResponse([PLAN_SUMMARY]));

    await getPlans();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning'),
      expect.anything()
    );
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).not.toContain('search=');
  });

  it('encodes search term into query string', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    await getPlans('AI trends');

    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('search=AI%20trends');
  });
});

// ---------------------------------------------------------------------------
// getTemplates
// ---------------------------------------------------------------------------

describe('getTemplates', () => {
  it('calls GET /api/v1/planning/templates', async () => {
    const templates = [
      {
        id: 'tmpl-1',
        name: 'Research',
        description: 'Research plan',
        icon: 'search',
      },
    ];
    mockFetch.mockResolvedValue(jsonResponse(templates));

    const result = await getTemplates();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning/templates'),
      expect.anything()
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('tmpl-1');
  });
});

// ---------------------------------------------------------------------------
// getPlanDetail
// ---------------------------------------------------------------------------

describe('getPlanDetail', () => {
  it('calls GET /api/v1/planning/:planId', async () => {
    const detail = {
      ...PLAN_SUMMARY,
      description: 'Detailed plan',
      depth: 'standard',
      autoAdvance: false,
      members: [],
      references: [],
    };
    mockFetch.mockResolvedValue(jsonResponse(detail));

    const result = await getPlanDetail('plan-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning/plan-1'),
      expect.anything()
    );
    expect(result.id).toBe('plan-1');
  });
});

// ---------------------------------------------------------------------------
// advancePhase
// ---------------------------------------------------------------------------

describe('advancePhase', () => {
  it('calls POST /api/v1/planning/:planId/advance', async () => {
    mockFetch.mockResolvedValue(wrappedResponse({ currentPhase: 2 }));

    const result = await advancePhase('plan-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning/plan-1/advance'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.currentPhase).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// retryPhase
// ---------------------------------------------------------------------------

describe('retryPhase', () => {
  it('calls POST /api/v1/planning/:planId/phase/:phase/retry', async () => {
    mockFetch.mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await retryPhase('plan-1', 2);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning/plan-1/phase/2/retry'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// cancelPhase
// ---------------------------------------------------------------------------

describe('cancelPhase', () => {
  it('calls POST /api/v1/planning/:planId/cancel', async () => {
    mockFetch.mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await cancelPhase('plan-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning/plan-1/cancel'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// exportPlan
// ---------------------------------------------------------------------------

describe('exportPlan', () => {
  it('returns raw text response', async () => {
    const markdownContent = '# Research Plan\n\n## Phase 1\n...';
    mockFetch.mockResolvedValue(new Response(markdownContent, { status: 200 }));

    const result = await exportPlan('plan-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning/plan-1/export'),
      expect.anything()
    );
    expect(result).toBe(markdownContent);
  });

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 403 }));

    await expect(exportPlan('plan-1')).rejects.toThrow(
      'Export failed: HTTP 403'
    );
  });
});

// ---------------------------------------------------------------------------
// updatePlan
// ---------------------------------------------------------------------------

describe('updatePlan', () => {
  it('calls PATCH /api/v1/planning/:planId with update fields', async () => {
    const updated = { ...PLAN_SUMMARY, name: 'Updated Plan' };
    mockFetch.mockResolvedValue(jsonResponse(updated));

    const result = await updatePlan('plan-1', { name: 'Updated Plan' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning/plan-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Plan' }),
      })
    );
    expect(result.name).toBe('Updated Plan');
  });
});

// ---------------------------------------------------------------------------
// replanFromPhase
// ---------------------------------------------------------------------------

describe('replanFromPhase', () => {
  it('calls POST /api/v1/planning/:planId/replan with startPhase', async () => {
    mockFetch.mockResolvedValue(wrappedResponse({ currentPhase: 2 }));

    const result = await replanFromPhase('plan-1', 2);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning/plan-1/replan'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ startPhase: 2 }),
      })
    );
    expect(result.currentPhase).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// deletePlan
// ---------------------------------------------------------------------------

describe('deletePlan', () => {
  it('calls DELETE /api/v1/planning/:planId', async () => {
    mockFetch.mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await deletePlan('plan-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/planning/plan-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});
