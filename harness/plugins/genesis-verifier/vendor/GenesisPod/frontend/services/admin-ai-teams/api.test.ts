/**
 * Tests for lib/api/admin-ai-teams.ts
 *
 * All calls go through apiClient which does NOT use getAuthHeader in this
 * module (unlike google-drive / notion). apiClient is mocked directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const { mockGet, mockPost, mockPatch, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPatch: vi.fn(),
  mockDelete: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    delete: mockDelete,
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import {
  createTeam,
  getTeams,
  getTeam,
  updateTeam,
  deleteTeam,
  addMember,
  updateMember,
  deleteMember,
  reorderMembers,
  getAvailableTools,
  getAvailableSkills,
  getBuiltInRoles,
  getWorkStyles,
  generateTeamConfig,
  getActiveTemplates,
  getTemplateById,
} from './api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TEAM = {
  id: 't-1',
  name: 'research-team',
  displayName: 'Research Team',
  status: 'ACTIVE' as const,
  isSystem: false,
  sortOrder: 0,
  members: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const MEMBER = {
  id: 'm-1',
  teamId: 't-1',
  name: 'researcher',
  displayName: 'Researcher',
  roleId: 'role-analyst',
  isLeader: false,
  capabilities: [],
  expertiseAreas: [],
  sortOrder: 0,
  minCount: 1,
  maxCount: 3,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Team CRUD
// ---------------------------------------------------------------------------

describe('createTeam', () => {
  it('calls POST /admin/ai-teams with DTO', async () => {
    mockPost.mockResolvedValue(TEAM);

    const dto = { name: 'research-team', displayName: 'Research Team' };
    const result = await createTeam(dto);

    expect(mockPost).toHaveBeenCalledWith('/admin/ai-teams', dto);
    expect(result).toEqual(TEAM);
  });
});

describe('getTeams', () => {
  it('calls GET /admin/ai-teams without params when no options', async () => {
    mockGet.mockResolvedValue({ items: [TEAM], total: 1 });

    const result = await getTeams();

    expect(mockGet).toHaveBeenCalledWith('/admin/ai-teams');
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('appends status query param when provided', async () => {
    mockGet.mockResolvedValue({ items: [], total: 0 });

    await getTeams({ status: 'ACTIVE' });

    const url: string = mockGet.mock.calls[0][0];
    expect(url).toContain('status=ACTIVE');
  });

  it('appends category query param when provided', async () => {
    mockGet.mockResolvedValue({ items: [], total: 0 });

    await getTeams({ category: 'research' });

    const url: string = mockGet.mock.calls[0][0];
    expect(url).toContain('category=research');
  });

  it('appends includeMembers query param when provided', async () => {
    mockGet.mockResolvedValue({ items: [], total: 0 });

    await getTeams({ includeMembers: true });

    const url: string = mockGet.mock.calls[0][0];
    expect(url).toContain('includeMembers=true');
  });

  it('combines multiple query params', async () => {
    mockGet.mockResolvedValue({ items: [], total: 0 });

    await getTeams({
      status: 'DRAFT',
      category: 'sales',
      includeMembers: false,
    });

    const url: string = mockGet.mock.calls[0][0];
    expect(url).toContain('status=DRAFT');
    expect(url).toContain('category=sales');
    expect(url).toContain('includeMembers=false');
  });
});

describe('getTeam', () => {
  it('calls GET /admin/ai-teams/:id', async () => {
    mockGet.mockResolvedValue(TEAM);

    const result = await getTeam('t-1');

    expect(mockGet).toHaveBeenCalledWith('/admin/ai-teams/t-1');
    expect(result.id).toBe('t-1');
  });
});

describe('updateTeam', () => {
  it('calls PATCH /admin/ai-teams/:id with update DTO', async () => {
    const updated = { ...TEAM, displayName: 'Updated Team' };
    mockPatch.mockResolvedValue(updated);

    const result = await updateTeam('t-1', { displayName: 'Updated Team' });

    expect(mockPatch).toHaveBeenCalledWith('/admin/ai-teams/t-1', {
      displayName: 'Updated Team',
    });
    expect(result.displayName).toBe('Updated Team');
  });
});

describe('deleteTeam', () => {
  it('calls DELETE /admin/ai-teams/:id', async () => {
    mockDelete.mockResolvedValue({ success: true, message: 'Team deleted' });

    const result = await deleteTeam('t-1');

    expect(mockDelete).toHaveBeenCalledWith('/admin/ai-teams/t-1');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Team deleted');
  });
});

// ---------------------------------------------------------------------------
// Member API
// ---------------------------------------------------------------------------

describe('addMember', () => {
  it('calls POST /admin/ai-teams/:teamId/members with DTO', async () => {
    mockPost.mockResolvedValue(MEMBER);

    const dto = {
      name: 'researcher',
      displayName: 'Researcher',
      roleId: 'role-analyst',
    };
    const result = await addMember('t-1', dto);

    expect(mockPost).toHaveBeenCalledWith('/admin/ai-teams/t-1/members', dto);
    expect(result.id).toBe('m-1');
  });
});

describe('updateMember', () => {
  it('calls PATCH /admin/ai-teams/members/:memberId with update DTO', async () => {
    const updated = {
      ...MEMBER,
      displayName: 'Lead Researcher',
      isLeader: true,
    };
    mockPatch.mockResolvedValue(updated);

    const result = await updateMember('m-1', {
      displayName: 'Lead Researcher',
      isLeader: true,
    });

    expect(mockPatch).toHaveBeenCalledWith('/admin/ai-teams/members/m-1', {
      displayName: 'Lead Researcher',
      isLeader: true,
    });
    expect(result.isLeader).toBe(true);
  });
});

describe('deleteMember', () => {
  it('calls DELETE /admin/ai-teams/members/:memberId', async () => {
    mockDelete.mockResolvedValue({ success: true, message: 'Member removed' });

    const result = await deleteMember('m-1');

    expect(mockDelete).toHaveBeenCalledWith('/admin/ai-teams/members/m-1');
    expect(result.success).toBe(true);
  });
});

describe('reorderMembers', () => {
  it('calls POST /admin/ai-teams/:teamId/reorder with memberIds', async () => {
    mockPost.mockResolvedValue(TEAM);

    const ids = ['m-2', 'm-1', 'm-3'];
    const result = await reorderMembers('t-1', ids);

    expect(mockPost).toHaveBeenCalledWith('/admin/ai-teams/t-1/reorder', {
      memberIds: ids,
    });
    expect(result.id).toBe('t-1');
  });
});

// ---------------------------------------------------------------------------
// Utility API
// ---------------------------------------------------------------------------

describe('getAvailableTools', () => {
  it('calls GET /admin/ai-teams/tools', async () => {
    mockGet.mockResolvedValue({
      builtIn: [
        { id: 'web-search', name: 'Web Search', description: 'Search the web' },
      ],
    });

    const result = await getAvailableTools();

    expect(mockGet).toHaveBeenCalledWith('/admin/ai-teams/tools');
    expect(result.builtIn).toHaveLength(1);
    expect(result.builtIn[0].id).toBe('web-search');
  });
});

describe('getAvailableSkills', () => {
  it('calls GET /admin/ai-teams/skills', async () => {
    mockGet.mockResolvedValue({
      analysis: [{ id: 'data-analysis', name: 'Data Analysis' }],
    });

    const result = await getAvailableSkills();

    expect(mockGet).toHaveBeenCalledWith('/admin/ai-teams/skills');
    expect(result).toHaveProperty('analysis');
  });
});

describe('getBuiltInRoles', () => {
  it('calls GET /admin/ai-teams/roles and returns leaders/members', async () => {
    mockGet.mockResolvedValue({
      leaders: [
        { id: 'team-lead', name: 'Team Lead', description: 'Leads the team' },
      ],
      members: [
        { id: 'analyst', name: 'Analyst', description: 'Analyzes data' },
      ],
    });

    const result = await getBuiltInRoles();

    expect(mockGet).toHaveBeenCalledWith('/admin/ai-teams/roles');
    expect(result.leaders).toHaveLength(1);
    expect(result.members).toHaveLength(1);
  });
});

describe('getWorkStyles', () => {
  it('calls GET /admin/ai-teams/work-styles', async () => {
    mockGet.mockResolvedValue([
      {
        id: 'autonomous',
        name: 'Autonomous',
        description: 'Works independently',
      },
      {
        id: 'collaborative',
        name: 'Collaborative',
        description: 'Works with others',
      },
    ]);

    const result = await getWorkStyles();

    expect(mockGet).toHaveBeenCalledWith('/admin/ai-teams/work-styles');
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AI Configuration
// ---------------------------------------------------------------------------

describe('generateTeamConfig', () => {
  it('calls POST /admin/ai-teams/generate-config with team params', async () => {
    const generated = {
      members: [
        {
          name: 'lead',
          displayName: 'Team Lead',
          roleId: 'team-lead',
          isLeader: true,
        },
      ],
    };
    mockPost.mockResolvedValue(generated);

    const result = await generateTeamConfig({
      teamName: 'Research Squad',
      teamDescription: 'Deep research on AI topics',
      category: 'research',
    });

    expect(mockPost).toHaveBeenCalledWith('/admin/ai-teams/generate-config', {
      teamName: 'Research Squad',
      teamDescription: 'Deep research on AI topics',
      category: 'research',
    });
    expect(result.members).toHaveLength(1);
    expect(result.members[0].isLeader).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

describe('getActiveTemplates', () => {
  it('calls GET /ai-teams/templates without category', async () => {
    mockGet.mockResolvedValue([TEAM]);

    const result = await getActiveTemplates();

    expect(mockGet).toHaveBeenCalledWith('/ai-teams/templates');
    expect(result).toHaveLength(1);
  });

  it('appends category query param when provided', async () => {
    mockGet.mockResolvedValue([]);

    await getActiveTemplates('research');

    expect(mockGet).toHaveBeenCalledWith(
      '/ai-teams/templates?category=research'
    );
  });
});

describe('getTemplateById', () => {
  it('calls GET /ai-teams/templates/:id', async () => {
    mockGet.mockResolvedValue(TEAM);

    const result = await getTemplateById('t-1');

    expect(mockGet).toHaveBeenCalledWith('/ai-teams/templates/t-1');
    expect(result.id).toBe('t-1');
  });
});
