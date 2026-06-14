/**
 * Tests for lib/api/global-ai-bar.ts
 *
 * Uses raw fetch mocking; module uses fetch directly (not apiClient).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const { mockGetAuthHeader } = vi.hoisted(() => ({
  mockGetAuthHeader: vi.fn(),
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: mockGetAuthHeader,
}));

vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'https://api.example.com/api/v1',
  },
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------
import { sendQuickAsk } from './api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthHeader.mockReturnValue({ Authorization: 'Bearer test-token' });
  global.fetch = vi.fn();
});

// ---------------------------------------------------------------------------
// sendQuickAsk
// ---------------------------------------------------------------------------
describe('sendQuickAsk', () => {
  it('creates a session and sends a message, returns answer and sessionId', async () => {
    const sessionId = 'session-abc-123';
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    // First call: create session
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: sessionId } }));
    // Second call: send message
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: {
          assistantMessage: { content: 'Here is your answer' },
        },
      })
    );

    const result = await sendQuickAsk('What is AI?');

    expect(result.sessionId).toBe(sessionId);
    expect(result.answer).toBe('Here is your answer');
  });

  it('calls session creation endpoint with POST', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'sid-1' } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { assistantMessage: { content: 'OK' } } })
    );

    await sendQuickAsk('Test query');

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall[0]).toContain('/ask/sessions');
    expect(firstCall[1]).toMatchObject({ method: 'POST' });
  });

  it('truncates title to 80 chars in session creation body', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const longQuery = 'A'.repeat(100);

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'sid-1' } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { assistantMessage: { content: 'OK' } } })
    );

    await sendQuickAsk(longQuery);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      title: string;
    };
    expect(body.title.length).toBe(80);
  });

  it('sends query as content in message POST', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const query = 'What is machine learning?';

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'sid-1' } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { assistantMessage: { content: 'It is...' } } })
    );

    await sendQuickAsk(query);

    const msgBody = JSON.parse(fetchMock.mock.calls[1][1].body as string) as {
      content: string;
    };
    expect(msgBody.content).toBe(query);
  });

  it('throws error when session creation fails', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 })
    );

    await expect(sendQuickAsk('test')).rejects.toThrow(
      'Session creation failed (401)'
    );
  });

  it('throws error when no session ID returned', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }));

    await expect(sendQuickAsk('test')).rejects.toThrow(
      'No session ID in response'
    );
  });

  it('throws error when message send fails', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'sid-1' } }));
    fetchMock.mockResolvedValueOnce(
      new Response('Server Error', { status: 500 })
    );
    // Cleanup DELETE call
    fetchMock.mockResolvedValue(jsonResponse({ success: true }));

    await expect(sendQuickAsk('test')).rejects.toThrow(
      'Message send failed (500)'
    );
  });

  it('handles session ID at root level (not wrapped in data)', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'sid-root' }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ assistantMessage: { content: 'Answer' } })
    );

    const result = await sendQuickAsk('query');

    expect(result.sessionId).toBe('sid-root');
    expect(result.answer).toBe('Answer');
  });

  it('returns empty string answer when assistantMessage is missing', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'sid-1' } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: {} }));

    const result = await sendQuickAsk('query');

    expect(result.answer).toBe('');
    expect(result.sessionId).toBe('sid-1');
  });

  it('includes Authorization header in requests', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'sid-1' } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { assistantMessage: { content: 'ok' } } })
    );

    await sendQuickAsk('hello');

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer test-token',
    });
  });

  it('sends Content-Type application/json in requests', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'sid-1' } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { assistantMessage: { content: 'ok' } } })
    );

    await sendQuickAsk('hello');

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });
});
