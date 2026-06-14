/// <reference types="@testing-library/jest-dom" />

/**
 * useFeedbackSubmit unit tests
 *
 * Covers:
 *  - submit builds FormData with type/title/description/url/userAgent + files
 *  - submit success sets submitted + feedbackId (unwraps { success, data })
 *  - submit failure (response not ok) sets error + throws, never swallowed
 *  - reset clears state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFeedbackSubmit } from '../useFeedbackSubmit';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('useFeedbackSubmit', () => {
  it('builds FormData with all fields incl. url + files and unwraps data', async () => {
    let captured: FormData | undefined;
    global.fetch = vi.fn(async (_url, init) => {
      captured = init?.body as FormData;
      return {
        ok: true,
        json: async () => ({ success: true, data: { feedbackId: 'fb-1' } }),
      } as Response;
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useFeedbackSubmit());

    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    await act(async () => {
      const res = await result.current.submit({
        type: 'bug',
        title: 'T',
        description: 'D',
        url: 'https://app.test/problem-page',
        files: [file],
      });
      expect(res.feedbackId).toBe('fb-1');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/feedback',
      expect.objectContaining({ method: 'POST' })
    );
    expect(captured).toBeInstanceOf(FormData);
    expect(captured?.get('type')).toBe('bug');
    expect(captured?.get('title')).toBe('T');
    expect(captured?.get('description')).toBe('D');
    expect(captured?.get('url')).toBe('https://app.test/problem-page');
    expect(captured?.get('userAgent')).toBeTruthy();
    expect(captured?.getAll('files')).toHaveLength(1);

    expect(result.current.submitted).toBe(true);
    expect(result.current.feedbackId).toBe('fb-1');
    expect(result.current.error).toBeNull();
  });

  it('sets error and throws when response not ok (not swallowed)', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'boom' }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useFeedbackSubmit());

    await act(async () => {
      await expect(
        result.current.submit({
          type: 'other',
          title: 'T',
          description: 'D',
          url: 'https://app.test/x',
        })
      ).rejects.toThrow('boom');
    });

    expect(result.current.error).toBe('boom');
    expect(result.current.submitted).toBe(false);
  });

  it('reset clears state', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ feedbackId: 'fb-2' }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useFeedbackSubmit());
    await act(async () => {
      await result.current.submit({
        type: 'bug',
        title: 'T',
        description: 'D',
        url: 'https://app.test/x',
      });
    });
    expect(result.current.submitted).toBe(true);

    act(() => result.current.reset());
    expect(result.current.submitted).toBe(false);
    expect(result.current.feedbackId).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
