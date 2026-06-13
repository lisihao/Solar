/**
 * Tests for lib/api/ai-teams.ts
 *
 * Uses raw fetch mocking (file uses its own fetchWithAuth).
 * API_BASE comes from process.env.NEXT_PUBLIC_API_URL.
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
  // ai-teams fetchWithAuth calls response.json() directly, so return valid JSON
  return new Response('null', {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
  createTopic,
  getTopics,
  getTopicById,
  updateTopic,
  archiveTopic,
  deleteTopic,
  getMembers,
  addMember,
  addMemberByEmail,
  addMembers,
  updateMember,
  removeMember,
  leaveTopic,
  getAIMembers,
  addAIMember,
  updateAIMember,
  removeAIMember,
  getMessages,
  sendMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  markAsRead,
  generateAIResponse,
  getResources,
  addResource,
  removeResource,
  getSummaries,
  generateSummary,
  deleteSummary,
  createMission,
  getMissions,
  getMissionById,
  cancelMission,
  pauseMission,
  resumeMission,
  retryMission,
  deleteMission,
  getMissionLogs,
  getFullReport,
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
  it('prepends API_BASE (from env) to URL', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([])
    );

    await getTopics();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/api/v1/topics');
  });

  it('sets Authorization header', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse([])
    );

    await getTopics();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('unwraps { success, data } envelope', async () => {
    const topics = [{ id: 't1', name: 'Strategy Room' }];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse(topics)
    );

    const result = await getTopics();

    expect(result).toEqual(topics);
  });

  it('returns raw data when no envelope', async () => {
    const topics = [{ id: 't1' }];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(topics)
    );

    const result = await getTopics();

    expect(result).toEqual(topics);
  });

  it('throws on non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorResponse('Not found', 404)
    );

    await expect(getTopicById('bad')).rejects.toThrow('Not found');
  });
});

// ---------------------------------------------------------------------------
// Topic CRUD
// ---------------------------------------------------------------------------

describe('createTopic', () => {
  it('sends POST with dto', async () => {
    const dto = { name: 'AI Research Team', type: 'TEAM' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 't-new', ...dto })
    );

    const result = await createTopic(dto as Parameters<typeof createTopic>[0]);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(dto) })
    );
    expect(result).toMatchObject({ id: 't-new' });
  });
});

describe('getTopics', () => {
  it('calls topics endpoint without params by default', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getTopics();

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).not.toContain('?');
  });

  it('appends type and search params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([])
    );

    await getTopics({
      type: 'TEAM' as Parameters<typeof getTopics>[0] extends { type?: infer T }
        ? T
        : never,
      search: 'AI',
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('type=TEAM');
    expect(calledUrl).toContain('search=AI');
  });
});

describe('getTopicById', () => {
  it('calls topic by id endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 't1' })
    );

    await getTopicById('t1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1'),
      expect.anything()
    );
  });
});

describe('updateTopic', () => {
  it('sends PATCH with dto', async () => {
    const dto = { name: 'Renamed' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 't1', ...dto })
    );

    await updateTopic('t1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('archiveTopic', () => {
  it('sends POST to archive endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 't1', status: 'ARCHIVED' })
    );

    await archiveTopic('t1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/archive'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('deleteTopic', () => {
  it('sends DELETE to topic endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await deleteTopic('t1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ---------------------------------------------------------------------------
// Member API
// ---------------------------------------------------------------------------

describe('getMembers', () => {
  it('calls members endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'm1' }])
    );

    await getMembers('t1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/members'),
      expect.anything()
    );
  });
});

describe('addMember', () => {
  it('sends POST with member dto', async () => {
    const dto = { userId: 'u1', role: 'MEMBER' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'm-new', ...dto })
    );

    await addMember('t1', dto as Parameters<typeof addMember>[1]);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/members'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('addMemberByEmail', () => {
  it('sends POST with email to invite endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'm-new' })
    );

    await addMemberByEmail(
      't1',
      'user@example.com',
      'MEMBER' as Parameters<typeof addMemberByEmail>[2]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/members/invite'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('addMembers', () => {
  it('sends POST with userIds to batch endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ added: 3 })
    );

    const result = await addMembers('t1', ['u1', 'u2', 'u3']);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/members/batch'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toEqual({ added: 3 });
  });
});

describe('updateMember', () => {
  it('sends PATCH to member endpoint', async () => {
    const dto = { role: 'ADMIN' as Parameters<typeof updateMember>[2]['role'] };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'm1', ...dto })
    );

    await updateMember('t1', 'm1', dto);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/members/m1'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('removeMember', () => {
  it('sends DELETE to member endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await removeMember('t1', 'm1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/members/m1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('leaveTopic', () => {
  it('sends POST to leave endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await leaveTopic('t1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/leave'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ---------------------------------------------------------------------------
// AI Member API
// ---------------------------------------------------------------------------

describe('getAIMembers', () => {
  it('calls ai-members endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'ai-m1' }])
    );

    await getAIMembers('t1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/ai-members'),
      expect.anything()
    );
  });
});

describe('addAIMember', () => {
  it('sends POST with AI member dto', async () => {
    const dto = { agentId: 'agent-researcher', name: 'Dr. Research' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'ai-m-new', ...dto })
    );

    await addAIMember(
      't1',
      dto as unknown as Parameters<typeof addAIMember>[1]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/ai-members'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('updateAIMember', () => {
  it('sends PATCH to ai-member endpoint', async () => {
    const dto = { name: 'Updated AI Name' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'ai-m1', ...dto })
    );

    await updateAIMember(
      't1',
      'ai-m1',
      dto as Parameters<typeof updateAIMember>[2]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/ai-members/ai-m1'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('removeAIMember', () => {
  it('sends DELETE to ai-member endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await removeAIMember('t1', 'ai-m1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/ai-members/ai-m1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ---------------------------------------------------------------------------
// Message API
// ---------------------------------------------------------------------------

describe('getMessages', () => {
  it('calls messages endpoint without params by default', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ messages: [], nextCursor: null })
    );

    await getMessages('t1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/api/v1/topics/t1/messages');
    expect(calledUrl).not.toContain('?');
  });

  it('appends cursor and limit params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ messages: [] })
    );

    await getMessages('t1', { cursor: 'msg-50', limit: 20 });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('cursor=msg-50');
    expect(calledUrl).toContain('limit=20');
  });
});

describe('sendMessage', () => {
  it('sends POST with message dto', async () => {
    const dto = { content: 'Hello team!' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'msg-new', ...dto })
    );

    await sendMessage('t1', dto as Parameters<typeof sendMessage>[1]);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/messages'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(dto) })
    );
  });
});

describe('deleteMessage', () => {
  it('sends DELETE to message endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await deleteMessage('t1', 'msg-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/messages/msg-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('addReaction', () => {
  it('sends POST with emoji', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'react-1', emoji: '👍' })
    );

    await addReaction('t1', 'msg-1', '👍');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/messages/msg-1/reactions'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ emoji: '👍' }),
      })
    );
  });
});

describe('removeReaction', () => {
  it('sends DELETE to reaction endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await removeReaction('t1', 'msg-1', '👍');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/messages/msg-1/reactions/👍'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('markAsRead', () => {
  it('sends POST with optional messageId', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await markAsRead('t1', 'msg-10');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/read'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messageId: 'msg-10' }),
      })
    );
  });
});

describe('generateAIResponse', () => {
  it('sends POST with aiMemberId and context', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'msg-ai', content: 'AI response' })
    );

    await generateAIResponse('t1', 'ai-m1', ['msg-1', 'msg-2']);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/ai/generate'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          aiMemberId: 'ai-m1',
          contextMessageIds: ['msg-1', 'msg-2'],
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Resource API
// ---------------------------------------------------------------------------

describe('getResources', () => {
  it('calls resources endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'res-1' }])
    );

    await getResources('t1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/resources'),
      expect.anything()
    );
  });
});

describe('addResource', () => {
  it('sends POST with resource dto', async () => {
    const dto = { title: 'Research Paper', url: 'https://arxiv.org/pdf/1234' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'res-new', ...dto })
    );

    await addResource(
      't1',
      dto as unknown as Parameters<typeof addResource>[1]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/resources'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('removeResource', () => {
  it('sends DELETE to resource endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await removeResource('t1', 'res-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/resources/res-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ---------------------------------------------------------------------------
// Summary API
// ---------------------------------------------------------------------------

describe('getSummaries', () => {
  it('calls summaries endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ id: 'sum-1' }])
    );

    await getSummaries('t1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/summaries'),
      expect.anything()
    );
  });
});

describe('generateSummary', () => {
  it('sends POST with summary dto', async () => {
    const dto = { prompt: "Summarize today's discussion" };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'sum-new', content: 'Summary...' })
    );

    await generateSummary('t1', dto as Parameters<typeof generateSummary>[1]);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/summaries'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('deleteSummary', () => {
  it('sends DELETE to summary endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      emptyResponse(200)
    );

    await deleteSummary('t1', 'sum-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/summaries/sum-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

// ---------------------------------------------------------------------------
// Team Mission API
// ---------------------------------------------------------------------------

describe('createMission', () => {
  it('sends POST with mission dto', async () => {
    const dto = { goal: 'Research competitors', assignedAgentId: 'ai-m1' };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'mission-new', ...dto })
    );

    await createMission(
      't1',
      dto as unknown as Parameters<typeof createMission>[1]
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/missions'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getMissions', () => {
  it('calls missions endpoint without params by default', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ missions: [], total: 0 })
    );

    await getMissions('t1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/api/v1/topics/t1/missions');
    expect(calledUrl).not.toContain('?');
  });

  it('appends status, limit, and offset params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ missions: [], total: 0 })
    );

    await getMissions('t1', {
      status: 'RUNNING' as Parameters<typeof getMissions>[1] extends {
        status?: infer S;
      }
        ? S
        : never,
      limit: 10,
      offset: 20,
    });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('status=RUNNING');
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('offset=20');
  });
});

describe('getMissionById', () => {
  it('calls mission by id endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'mission-1' })
    );

    await getMissionById('t1', 'mission-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/missions/mission-1'),
      expect.anything()
    );
  });
});

describe('cancelMission', () => {
  it('sends POST to cancel endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ id: 'mission-1', status: 'CANCELLED' })
    );

    await cancelMission('t1', 'mission-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/missions/mission-1/cancel'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('pauseMission', () => {
  it('sends POST to pause endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        success: true,
        message: 'Paused',
        previousStatus: 'RUNNING',
      })
    );

    await pauseMission('t1', 'mission-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/missions/mission-1/pause'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('resumeMission', () => {
  it('sends POST to resume endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, message: 'Resumed', status: 'RUNNING' })
    );

    await resumeMission('t1', 'mission-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/missions/mission-1/resume'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('retryMission', () => {
  it('sends POST to retry endpoint with options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        success: true,
        message: 'Retrying',
        mode: 'full',
        previousStatus: 'FAILED',
      })
    );

    await retryMission('t1', 'mission-1', {
      mode: 'full',
      reason: 'Fixing config',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/missions/mission-1/retry'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('sends empty body when no options', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        success: true,
        message: 'Retrying',
        mode: 'continue',
        previousStatus: 'FAILED',
      })
    );

    await retryMission('t1', 'mission-1');

    const body = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .body;
    expect(body).toBe('{}');
  });
});

describe('deleteMission', () => {
  it('sends DELETE to mission endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ success: true, message: 'Deleted' })
    );

    await deleteMission('t1', 'mission-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/topics/t1/missions/mission-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

describe('getMissionLogs', () => {
  it('calls mission logs endpoint without params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ logs: [], total: 0 })
    );

    await getMissionLogs('t1', 'mission-1');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('/api/v1/topics/t1/missions/mission-1/logs');
    expect(calledUrl).not.toContain('?');
  });

  it('appends limit and offset params', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({ logs: [], total: 0 })
    );

    await getMissionLogs('t1', 'mission-1', { limit: 50, offset: 100 });

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(calledUrl).toContain('limit=50');
    expect(calledUrl).toContain('offset=100');
  });
});

describe('getFullReport', () => {
  it('calls full-report endpoint', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      wrappedResponse({
        success: true,
        message: 'Report ready',
        fullContent: '# Report',
        taskCount: 10,
        totalWords: 5000,
      })
    );

    const result = await getFullReport('t1', 'mission-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/topics/t1/missions/mission-1/full-report'
      ),
      expect.anything()
    );
    expect(result).toMatchObject({ success: true, taskCount: 10 });
  });
});
