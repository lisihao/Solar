/**
 * Tests for lib/api/client.ts (ApiClient singleton)
 *
 * Strategy:
 * - globalThis.fetch is replaced with vi.fn() for each test
 * - config and auth utilities are mocked at the module boundary
 * - vi.hoisted() is used to declare mock fns before vi.mock factories run
 * - Fake timers are used to verify timeout / retry backoff behaviour
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references (must be declared before vi.mock calls)
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

vi.mock('@/lib/utils/config', () => ({
  config: {
    get apiUrl() {
      return 'http://localhost:4000/api/v1';
    },
  },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: mockGetAuthTokens,
  refreshAccessToken: mockRefreshAccessToken,
  logout: mockLogout,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Poll `assertion` every `intervalMs` until it passes or `timeoutMs` expires.
 * Used instead of a fixed setTimeout so tests pass in both vmThreads and forks
 * pool environments where microtask/timer scheduling differs.
 */
async function pollUntil(
  assertion: () => void,
  timeoutMs = 2000,
  intervalMs = 10
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

function makeJsonResponse(
  body: unknown,
  status = 200,
  statusText = 'OK'
): Response {
  const json = JSON.stringify(body);
  return new Response(json, {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeEmptyResponse(status = 200): Response {
  return new Response('', { status, statusText: 'OK' });
}

function makeErrorResponse(
  body: { message?: string; code?: string },
  status: number
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Import the client AFTER mocks are registered
// ---------------------------------------------------------------------------

import { apiClient } from '../client';

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ApiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockGetAuthTokens.mockReturnValue(null);
    mockRefreshAccessToken.mockResolvedValue(null);
    mockLogout.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // buildUrl
  // -------------------------------------------------------------------------

  describe('buildUrl behaviour', () => {
    it('should prepend baseUrl to a relative path without leading slash', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse({ ok: true }));
      await apiClient.get('users');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/users',
        expect.anything()
      );
    });

    it('should prepend baseUrl to a relative path with leading slash', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse({ ok: true }));
      await apiClient.get('/users');
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/users',
        expect.anything()
      );
    });

    it('should pass through full http:// URLs unchanged', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse({}));
      await apiClient.get('http://other.api.com/endpoint');
      expect(fetch).toHaveBeenCalledWith(
        'http://other.api.com/endpoint',
        expect.anything()
      );
    });

    it('should pass through full https:// URLs unchanged', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse({}));
      await apiClient.get('https://secure.api.com/data');
      expect(fetch).toHaveBeenCalledWith(
        'https://secure.api.com/data',
        expect.anything()
      );
    });
  });

  // -------------------------------------------------------------------------
  // Auth headers
  // -------------------------------------------------------------------------

  describe('auth headers', () => {
    it('should not include Authorization header when no tokens available', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse({}));
      await apiClient.get('/ping');
      const [, init] = vi.mocked(fetch).mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('should include Authorization header when tokens available', async () => {
      mockGetAuthTokens.mockReturnValue({
        accessToken: 'tok-abc',
        refreshToken: 'ref-xyz',
      });
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse({}));
      await apiClient.get('/secure');
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer tok-abc',
      });
    });
  });

  // -------------------------------------------------------------------------
  // HTTP methods
  // -------------------------------------------------------------------------

  describe('get()', () => {
    it('should make a GET request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse([1, 2, 3]));
      const result = await apiClient.get<number[]>('/items');
      expect(result).toEqual([1, 2, 3]);
      expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
        method: 'GET',
      });
    });
  });

  describe('post()', () => {
    it('should make a POST request with JSON body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse({ id: 1 }));
      const body = { name: 'test' };
      const result = await apiClient.post<{ id: number }>('/items', body);
      expect(result).toEqual({ id: 1 });
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init as RequestInit).method).toBe('POST');
      expect((init as RequestInit).body).toBe(JSON.stringify(body));
      expect((init as RequestInit).headers).toMatchObject({
        'Content-Type': 'application/json',
      });
    });

    it('should handle post() without body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse({ ok: true }));
      await apiClient.post('/trigger');
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init as RequestInit).body).toBeUndefined();
    });
  });

  describe('put()', () => {
    it('should make a PUT request with JSON body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({ updated: true })
      );
      await apiClient.put('/items/1', { name: 'updated' });
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init as RequestInit).method).toBe('PUT');
      expect((init as RequestInit).headers).toMatchObject({
        'Content-Type': 'application/json',
      });
    });
  });

  describe('delete()', () => {
    it('should make a DELETE request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeEmptyResponse());
      await apiClient.delete('/items/1');
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init as RequestInit).method).toBe('DELETE');
    });
  });

  describe('patch()', () => {
    it('should make a PATCH request with JSON body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({ patched: true })
      );
      await apiClient.patch('/items/1', { status: 'active' });
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init as RequestInit).method).toBe('PATCH');
      expect((init as RequestInit).headers).toMatchObject({
        'Content-Type': 'application/json',
      });
    });
  });

  describe('upload()', () => {
    it('should POST FormData without Content-Type header', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({ url: '/file' })
      );
      const fd = new FormData();
      fd.append('file', new Blob(['data']), 'test.txt');
      await apiClient.upload('/upload', fd);
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init as RequestInit).method).toBe('POST');
      // Content-Type must NOT be set so the browser can add multipart boundary
      const headers = (init as RequestInit).headers as
        | Record<string, string>
        | undefined;
      expect(headers?.['Content-Type']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Response unwrapping
  // -------------------------------------------------------------------------

  describe('auto-unwrap { success, data } responses', () => {
    it('should unwrap when only success + data keys present', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({ success: true, data: { id: 42 } })
      );
      const result = await apiClient.get<{ id: number }>('/resource');
      expect(result).toEqual({ id: 42 });
    });

    it('should unwrap when success + data + metadata present', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({ success: true, data: [1, 2], metadata: { v: 1 } })
      );
      const result = await apiClient.get('/resource');
      expect(result).toEqual([1, 2]);
    });

    it('should unwrap when success + data + message present', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeJsonResponse({ success: true, data: 'ok', message: 'done' })
      );
      const result = await apiClient.get('/resource');
      expect(result).toBe('ok');
    });

    it('should NOT unwrap when extra keys are present (e.g. pagination)', async () => {
      const paginated = {
        success: true,
        data: [1, 2],
        total: 100,
        hasMore: true,
      };
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse(paginated));
      const result = await apiClient.get('/resource');
      expect(result).toEqual(paginated);
    });

    it('should return {} for empty response body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeEmptyResponse(200));
      const result = await apiClient.get('/nothing');
      expect(result).toEqual({});
    });

    it('should return raw parsed value when not a { success, data } shape', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeJsonResponse([10, 20]));
      const result = await apiClient.get('/list');
      expect(result).toEqual([10, 20]);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('should throw ApiError with status and message for non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeErrorResponse({ message: 'Not found', code: 'NOT_FOUND' }, 404)
      );
      await expect(apiClient.get('/missing')).rejects.toMatchObject({
        message: 'Not found',
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('should include status for non-ok responses without message body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('{}', { status: 503, statusText: 'Service Unavailable' })
      );
      await expect(apiClient.get('/down')).rejects.toMatchObject({
        status: 503,
      });
    });
  });

  // -------------------------------------------------------------------------
  // 401 → token refresh → retry flow
  // -------------------------------------------------------------------------

  describe('401 handling', () => {
    // ★ 2026-05-06: 已登录用户场景（token 过期但 refresh 有效）。
    // 配合 client.ts:227-242 的"未登录直接 throw UNAUTHENTICATED"逻辑：只有
    // 已登录用户才走 refresh→retry→logout 链路；spec 这里都模拟已登录。
    beforeEach(() => {
      mockGetAuthTokens.mockReturnValue({
        accessToken: 'expired-tok',
        refreshToken: 'still-valid-ref',
      });
    });

    it('should refresh token and retry on 401, returning successful response', async () => {
      const newTokens = { accessToken: 'new-tok', refreshToken: 'new-ref' };
      mockRefreshAccessToken.mockResolvedValueOnce(newTokens);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response('{}', { status: 401, statusText: 'Unauthorized' })
        )
        .mockResolvedValueOnce(makeJsonResponse({ id: 1 }));

      const result = await apiClient.get<{ id: number }>('/protected');
      expect(result).toEqual({ id: 1 });
      expect(fetch).toHaveBeenCalledTimes(2);
      const [, retryInit] = vi.mocked(fetch).mock.calls[1];
      expect((retryInit as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer new-tok',
      });
    });

    it('should call logout when refresh succeeds but retry still returns 401', async () => {
      const newTokens = { accessToken: 'new-tok', refreshToken: 'new-ref' };
      mockRefreshAccessToken.mockResolvedValueOnce(newTokens);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response('{}', { status: 401, statusText: 'Unauthorized' })
        )
        .mockResolvedValueOnce(
          new Response('{}', { status: 401, statusText: 'Unauthorized' })
        );

      await expect(apiClient.get('/protected')).rejects.toMatchObject({
        code: 'SESSION_EXPIRED',
        status: 401,
      });
      expect(mockLogout).toHaveBeenCalled();
    });

    it('should call logout when refresh returns null', async () => {
      mockRefreshAccessToken.mockResolvedValueOnce(null);

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('{}', { status: 401, statusText: 'Unauthorized' })
      );

      await expect(apiClient.get('/protected')).rejects.toMatchObject({
        code: 'SESSION_EXPIRED',
      });
      expect(mockLogout).toHaveBeenCalled();
    });

    it('should unwrap { success, data } after a successful token refresh retry', async () => {
      const newTokens = { accessToken: 'fresh', refreshToken: 'r' };
      mockRefreshAccessToken.mockResolvedValueOnce(newTokens);

      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response('{}', { status: 401, statusText: 'Unauthorized' })
        )
        .mockResolvedValueOnce(
          makeJsonResponse({ success: true, data: { name: 'alice' } })
        );

      const result = await apiClient.get<{ name: string }>('/profile');
      expect(result).toEqual({ name: 'alice' });
    });
  });

  // -------------------------------------------------------------------------
  // Retry with exponential backoff
  // -------------------------------------------------------------------------

  describe('retry logic', () => {
    it('should retry the specified number of times before throwing', async () => {
      vi.useFakeTimers();

      vi.mocked(fetch).mockRejectedValue(new Error('network failure'));

      const promise = apiClient
        .get('/flaky', { retries: 2, retryDelay: 100 })
        .catch((e: Error) => e); // prevent unhandled rejection

      // Advance through backoff delays: attempt 0 fails → sleep 100*2^0=100ms
      // attempt 1 fails → sleep 100*2^1=200ms
      await vi.advanceTimersByTimeAsync(400);

      const result = await promise;
      expect((result as Error).message).toBe('network failure');
      expect(fetch).toHaveBeenCalledTimes(3); // initial + 2 retries

      vi.useRealTimers();
    });

    it('should succeed on a later retry without throwing', async () => {
      vi.useFakeTimers();

      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(makeJsonResponse({ recovered: true }));

      const promise = apiClient.get('/flaky', { retries: 1, retryDelay: 50 });

      await vi.advanceTimersByTimeAsync(100);

      const result = await promise;
      expect(result).toEqual({ recovered: true });
      expect(fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------

  describe('request timeout', () => {
    it('should abort the request after the specified timeout', async () => {
      vi.useFakeTimers();

      vi.mocked(fetch).mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = (init as RequestInit).signal;
            signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          })
      );

      // Catch the error immediately so it doesn't become an unhandled rejection
      const promise = apiClient
        .get('/slow', { timeout: 5000, retries: 0 })
        .catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(5001);

      const result = await promise;
      // DOMException does not extend Error in all environments (e.g. forks pool).
      // Assert by name/message which works regardless of prototype chain.
      expect(result).toBeTruthy();
      expect((result as { name: string }).name).toBe('AbortError');

      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // createSSEStream
  // -------------------------------------------------------------------------

  describe('createSSEStream()', () => {
    // Helper: build a mock EventSource constructor (must be a class/function, not arrow)
    function makeMockEventSourceClass(instance: Record<string, unknown>) {
      return function MockEventSource(this: unknown) {
        Object.assign(this as Record<string, unknown>, instance);
      };
    }

    it('should create an EventSource for the given path', () => {
      const mockClose = vi.fn();
      const mockAddEventListener = vi.fn();
      const mockRemoveEventListener = vi.fn();

      const instanceProps = {
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
        close: mockClose,
        onmessage: null,
        onerror: null,
      };
      const MockEventSource = vi.fn(makeMockEventSourceClass(instanceProps));
      vi.stubGlobal('EventSource', MockEventSource);

      const { close } = apiClient.createSSEStream('/events', {});

      expect(MockEventSource).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/events'
      );

      close();
      expect(mockRemoveEventListener).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });

    it('should invoke onProgress handler when "progress" event data is received', () => {
      const onProgress = vi.fn();
      let capturedHandler: ((e: MessageEvent) => void) | undefined;

      const addEventListenerMock = vi.fn(
        (type: string, handler: (e: MessageEvent) => void) => {
          if (type === 'progress') capturedHandler = handler;
        }
      );

      const instanceProps = {
        addEventListener: addEventListenerMock,
        removeEventListener: vi.fn(),
        close: vi.fn(),
        onmessage: null,
        onerror: null,
      };
      vi.stubGlobal(
        'EventSource',
        vi.fn(makeMockEventSourceClass(instanceProps))
      );

      apiClient.createSSEStream('/stream', { onProgress });

      const event = new MessageEvent('progress', {
        data: JSON.stringify({
          type: 'progress',
          phase: 'running',
          progress: 50,
          message: 'halfway',
        }),
      });
      capturedHandler?.(event);

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'progress', progress: 50 })
      );
    });

    it('should invoke onComplete handler when "complete" event data is received', () => {
      const onComplete = vi.fn();
      let capturedHandler: ((e: MessageEvent) => void) | undefined;

      const addEventListenerMock = vi.fn(
        (type: string, handler: (e: MessageEvent) => void) => {
          if (type === 'complete') capturedHandler = handler;
        }
      );

      const instanceProps = {
        addEventListener: addEventListenerMock,
        removeEventListener: vi.fn(),
        close: vi.fn(),
        onmessage: null,
        onerror: null,
      };
      vi.stubGlobal(
        'EventSource',
        vi.fn(makeMockEventSourceClass(instanceProps))
      );

      apiClient.createSSEStream('/stream', { onComplete });

      const event = new MessageEvent('complete', {
        data: JSON.stringify({ type: 'complete', result: { done: true } }),
      });
      capturedHandler?.(event);

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'complete' })
      );
    });

    it('should invoke onError when EventSource encounters an error', () => {
      const onError = vi.fn();

      // Use a plain object and capture it from outside the constructor
      let capturedInstance: { onerror: (() => void) | null } | null = null;

      function MockEventSourceWithOnerror(
        this: Record<string, unknown>,
        _url: string
      ) {
        this.addEventListener = vi.fn();
        this.removeEventListener = vi.fn();
        this.close = vi.fn();
        this.onmessage = null;
        this.onerror = null;
        capturedInstance = this as unknown as { onerror: (() => void) | null };
      }
      vi.stubGlobal('EventSource', vi.fn(MockEventSourceWithOnerror));

      apiClient.createSSEStream('/stream', { onError });

      // Trigger the onerror callback that was assigned by createSSEStream
      capturedInstance!.onerror?.();

      expect(onError).toHaveBeenCalledWith({
        type: 'error',
        error: 'SSE connection error',
        recoverable: false,
      });
    });

    it('should invoke onEvent for any received SSE event via onmessage', () => {
      const onEvent = vi.fn();
      let capturedInstance: {
        onmessage: ((e: MessageEvent) => void) | null;
      } | null = null;

      function MockEventSourceWithOnmessage(
        this: Record<string, unknown>,
        _url: string
      ) {
        this.addEventListener = vi.fn();
        this.removeEventListener = vi.fn();
        this.close = vi.fn();
        this.onmessage = null;
        this.onerror = null;
        capturedInstance = this as unknown as {
          onmessage: ((e: MessageEvent) => void) | null;
        };
      }
      vi.stubGlobal('EventSource', vi.fn(MockEventSourceWithOnmessage));

      apiClient.createSSEStream('/stream', { onEvent });

      const event = new MessageEvent('message', {
        data: JSON.stringify({ type: 'custom', payload: 42 }),
      });
      capturedInstance!.onmessage?.(event);

      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'custom', payload: 42 })
      );
    });
  });

  // -------------------------------------------------------------------------
  // postSSEStream
  // -------------------------------------------------------------------------

  describe('postSSEStream()', () => {
    // Helper: build a mock Response with a body that the getReader() API can consume.
    // We mock response.body?.getReader() directly since ReadableStream may not be
    // available in all Node.js vmThreads environments.
    function makeStreamResponse(chunks: string[]): Response {
      const encoder = new TextEncoder();
      const encoded = chunks.map((c) => encoder.encode(c));

      let callCount = 0;
      const readerMock = {
        read: vi.fn().mockImplementation(() => {
          if (callCount < encoded.length) {
            return Promise.resolve({
              done: false,
              value: encoded[callCount++],
            });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      };

      // Build a minimal body-like object
      const bodyMock = { getReader: () => readerMock };

      const response = {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: bodyMock,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
        headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      } as unknown as Response;

      return response;
    }

    it('should POST to the given path with SSE headers', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse([]));

      const { close } = await apiClient.postSSEStream(
        '/stream',
        { q: 'test' },
        {}
      );

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:4000/api/v1/stream',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          }),
        })
      );
      expect(typeof close).toBe('function');
      close();
    });

    it('should call onError when the response is not ok', async () => {
      const onError = vi.fn();

      vi.mocked(fetch).mockResolvedValueOnce(
        makeErrorResponse({ message: 'bad request' }, 400)
      );

      await apiClient.postSSEStream('/stream', {}, { onError });

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: expect.stringContaining('bad request'),
        })
      );
    });

    it('should parse SSE data lines and invoke onComplete handler', async () => {
      const onComplete = vi.fn();

      const sseBody = 'data: {"type":"complete","result":{"done":true}}\n\n';
      vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse([sseBody]));

      await apiClient.postSSEStream('/stream', {}, { onComplete });

      // Wait for the fire-and-forget processStream() to invoke the callback.
      // Poll instead of a fixed delay so the test works in both vmThreads and forks.
      await pollUntil(() => {
        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'complete' })
        );
      });
    });

    it('should parse progress events from SSE stream', async () => {
      const onProgress = vi.fn();

      const sseBody =
        'data: {"type":"progress","phase":"init","progress":10,"message":"starting"}\n\n';
      vi.mocked(fetch).mockResolvedValueOnce(makeStreamResponse([sseBody]));

      await apiClient.postSSEStream('/stream', {}, { onProgress });

      // Wait for the fire-and-forget processStream() to invoke the callback.
      // Poll instead of a fixed delay so the test works in both vmThreads and forks.
      await pollUntil(() => {
        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'progress', progress: 10 })
        );
      });
    });
  });
});
