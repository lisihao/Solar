import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockError, mockWarn } = vi.hoisted(() => ({
  mockError: vi.fn(),
  mockWarn: vi.fn(),
}));

const { mockPublishByokError } = vi.hoisted(() => ({
  mockPublishByokError: vi.fn(),
}));

vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'http://localhost:4000/api/v1',
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: mockError,
    warn: mockWarn,
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/byok/event-bus', () => ({
  publishByokError: mockPublishByokError,
}));

import { streamAskMessage } from '../ai-ask-stream';

function makeStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const encoded = chunks.map((c) => encoder.encode(c));
  let index = 0;
  const reader = {
    read: vi.fn().mockImplementation(() => {
      if (index < encoded.length) {
        return Promise.resolve({ done: false, value: encoded[index++] });
      }
      return Promise.resolve({ done: true, value: undefined });
    }),
  };

  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

describe('streamAskMessage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns backend-truth envelopes from done event', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeStreamResponse([
        'data: {"type":"sources","sources":[{"documentTitle":"Doc","excerpt":"Ex","score":0.9}]}\n\n',
        'data: {"type":"chunk","content":"Hello"}\n\n',
        'data: {"type":"done","userMessageId":"u1","assistantMessageId":"a1","tokensUsed":42,"fullContent":"Hello world","userMessage":{"id":"u1","content":"Question","createdAt":"2026-05-10T10:00:00.000Z","modelId":"m-user","modelName":"User Model"},"assistantMessage":{"id":"a1","content":"Hello world","createdAt":"2026-05-10T10:00:01.000Z","modelId":"m-final","modelName":"Final Model","tokens":42}}\n\n',
      ])
    );

    const chunks: string[] = [];
    const result = await streamAskMessage(
      'session-1',
      'token-1',
      { content: 'Question', modelId: 'requested-model', webSearch: false },
      (accumulated) => chunks.push(accumulated)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(chunks).toEqual(['Hello']);
    expect(result.userMessage).toEqual({
      id: 'u1',
      content: 'Question',
      createdAt: '2026-05-10T10:00:00.000Z',
      modelId: 'm-user',
      modelName: 'User Model',
    });
    expect(result.assistantMessage).toEqual({
      id: 'a1',
      content: 'Hello world',
      createdAt: '2026-05-10T10:00:01.000Z',
      modelId: 'm-final',
      modelName: 'Final Model',
      tokens: 42,
    });
    expect(result.ragSources).toHaveLength(1);
  });

  it('notifies caller about stream status phases before chunks arrive', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeStreamResponse([
        'data: {"type":"status","stage":"rag"}\n\n',
        'data: {"type":"status","stage":"generating"}\n\n',
        'data: {"type":"chunk","content":"Hello"}\n\n',
        'data: {"type":"done","userMessageId":"u1","assistantMessageId":"a1","tokensUsed":1,"fullContent":"Hello","userMessage":{"id":"u1","content":"Question","createdAt":"2026-05-10T10:00:00.000Z"},"assistantMessage":{"id":"a1","content":"Hello","createdAt":"2026-05-10T10:00:01.000Z","tokens":1}}\n\n',
      ])
    );

    const statuses: string[] = [];
    const result = await streamAskMessage(
      'session-1',
      'token-1',
      { content: 'Question', webSearch: false },
      undefined,
      (stage) => statuses.push(stage)
    );

    expect(result.ok).toBe(true);
    expect(statuses).toEqual(['rag', 'generating']);
  });

  it('publishes BYOK guidance when stream fails with quota error before done', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeStreamResponse([
        'data: {"type":"error","message":"所选模型 Provider 余额或配额已耗尽，请检查 BYOK 配置、充值或切换到可用模型后重试。","code":"QUOTA_EXCEEDED","meta":{"status":402,"providerMessage":"Request failed with status code 402"}}\n\n',
      ])
    );

    const result = await streamAskMessage('session-1', 'token-1', {
      content: 'Question',
      webSearch: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.byok).toBe(true);
    expect(result.status).toBe(402);
    expect(mockPublishByokError).toHaveBeenCalledWith({
      code: 'QUOTA_EXCEEDED',
      message:
        '所选模型 Provider 余额或配额已耗尽，请检查 BYOK 配置、充值或切换到可用模型后重试。',
      details: {
        meta: {
          status: 402,
          providerMessage: 'Request failed with status code 402',
        },
      },
    });
  });

  it('fails closed when stream cut AND reconcile finds no persisted reply', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeStreamResponse(['data: {"type":"chunk","content":"Partial"}\n\n'])
      )
      // 对账 GET：库里没有本轮回复 → 仍判失败
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      } as unknown as Response);

    const result = await streamAskMessage(
      'session-1',
      'token-1',
      { content: 'Question', webSearch: false },
      undefined,
      { maxAttempts: 1, delayMs: 0 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('未收到完成事件');
    expect(result.partialContent).toBe('Partial');
  });

  it('recovers persisted reply via reconcile when stream is cut (proxy)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeStreamResponse(['data: {"type":"chunk","content":"Partial"}\n\n'])
      )
      // 后端在客户端断开后仍跑完并入库 → 对账 GET 捞到本轮回复
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            messages: [
              {
                id: 'u1',
                role: 'user',
                content: 'Question',
                createdAt: '2026-05-21T10:00:00.000Z',
              },
              {
                id: 'a1',
                role: 'assistant',
                content: 'Full recovered answer',
                createdAt: '2026-05-21T10:00:05.000Z',
                modelId: 'm-final',
                modelName: 'Final Model',
                tokens: 12,
              },
            ],
          }),
      } as unknown as Response);

    const result = await streamAskMessage(
      'session-1',
      'token-1',
      { content: 'Question', webSearch: false },
      undefined,
      { maxAttempts: 1, delayMs: 0 }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistantMessage.id).toBe('a1');
    expect(result.assistantMessage.content).toBe('Full recovered answer');
    expect(result.assistantMessage.tokens).toBe(12);
  });

  it('parses a trailing done frame even if EOF arrives without final delimiter', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeStreamResponse([
        'data: {"type":"done","userMessageId":"u1","assistantMessageId":"a1","tokensUsed":7,"fullContent":"Done","userMessage":{"id":"u1","content":"Question","createdAt":"2026-05-10T10:00:00.000Z"},"assistantMessage":{"id":"a1","content":"Done","createdAt":"2026-05-10T10:00:01.000Z","tokens":7}}',
      ])
    );

    const result = await streamAskMessage('session-1', 'token-1', {
      content: 'Question',
      webSearch: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistantMessage.content).toBe('Done');
    expect(result.assistantMessage.tokens).toBe(7);
  });

  it('prefers persisted done envelope when error is followed by done', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeStreamResponse([
        'data: {"type":"error","message":"Failed to get response. Please try again."}\n\n',
        'data: {"type":"done","userMessageId":"u1","assistantMessageId":"a-err","tokensUsed":0,"fullContent":"Error: Failed to get response. Please try again.","userMessage":{"id":"u1","content":"Question","createdAt":"2026-05-10T10:00:00.000Z"},"assistantMessage":{"id":"a-err","content":"Error: Failed to get response. Please try again.","createdAt":"2026-05-10T10:00:01.000Z","modelId":"m-final","modelName":"Final Model","tokens":0}}\n\n',
      ])
    );

    const result = await streamAskMessage('session-1', 'token-1', {
      content: 'Question',
      webSearch: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistantMessage.id).toBe('a-err');
    expect(result.assistantMessage.content).toContain('Failed to get response');
    expect(result.assistantMessage.modelId).toBe('m-final');
  });

  it('preserves an explicit empty-string assistant payload from backend truth', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeStreamResponse([
        'data: {"type":"chunk","content":"Partial"}\n\n',
        'data: {"type":"done","userMessageId":"u1","assistantMessageId":"a-empty","tokensUsed":0,"fullContent":"Partial","userMessage":{"id":"u1","content":"Question","createdAt":"2026-05-10T10:00:00.000Z"},"assistantMessage":{"id":"a-empty","content":"","createdAt":"2026-05-10T10:00:01.000Z","tokens":0}}\n\n',
      ])
    );

    const result = await streamAskMessage('session-1', 'token-1', {
      content: 'Question',
      webSearch: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assistantMessage.content).toBe('');
  });
});
