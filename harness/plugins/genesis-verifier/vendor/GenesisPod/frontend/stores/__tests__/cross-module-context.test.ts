import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock sessionStorage with a simple in-memory implementation
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
});

import { useCrossModuleContext } from '../cross-module-context';

const makePayloadInput = (overrides = {}) => ({
  sourceModule: 'ask',
  query: 'What is AI?',
  contextData: {
    summary: 'A brief summary of AI concepts.',
    entities: ['AI', 'Machine Learning'],
    relatedTopics: ['Deep Learning', 'Neural Networks'],
    sourceMessageId: 'msg-001',
  },
  ...overrides,
});

describe('cross-module-context store', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    // Reset store to initial state
    act(() => {
      useCrossModuleContext.getState().clearContext();
    });
  });

  it('should initialize with null payload', () => {
    const state = useCrossModuleContext.getState();
    expect(state.payload).toBeNull();
  });

  it('should set context and add TTL automatically', () => {
    const beforeTime = Date.now();

    act(() => {
      useCrossModuleContext.getState().setContext(makePayloadInput());
    });

    const state = useCrossModuleContext.getState();
    expect(state.payload).not.toBeNull();
    expect(state.payload?.sourceModule).toBe('ask');
    expect(state.payload?.query).toBe('What is AI?');
    // expiresAt should be approximately 30 minutes from now
    expect(state.payload?.expiresAt).toBeGreaterThan(
      beforeTime + 29 * 60 * 1000
    );
    expect(state.payload?.expiresAt).toBeLessThan(beforeTime + 31 * 60 * 1000);
  });

  it('should include contextData in the stored payload', () => {
    act(() => {
      useCrossModuleContext.getState().setContext(makePayloadInput());
    });

    const payload = useCrossModuleContext.getState().payload;
    expect(payload?.contextData?.summary).toBe(
      'A brief summary of AI concepts.'
    );
    expect(payload?.contextData?.entities).toEqual(['AI', 'Machine Learning']);
    expect(payload?.contextData?.relatedTopics).toEqual([
      'Deep Learning',
      'Neural Networks',
    ]);
    expect(payload?.contextData?.sourceMessageId).toBe('msg-001');
  });

  it('should return context via getContext when not expired', () => {
    act(() => {
      useCrossModuleContext.getState().setContext(makePayloadInput());
    });

    const context = useCrossModuleContext.getState().getContext();
    expect(context).not.toBeNull();
    expect(context?.query).toBe('What is AI?');
  });

  it('should return null from getContext when no payload is set', () => {
    const context = useCrossModuleContext.getState().getContext();
    expect(context).toBeNull();
  });

  it('should return null and clear payload when context is expired', () => {
    // Set context with a past expiresAt
    act(() => {
      useCrossModuleContext.setState({
        payload: {
          sourceModule: 'research',
          query: 'Old query',
          expiresAt: Date.now() - 1000, // already expired
        },
      });
    });

    const context = useCrossModuleContext.getState().getContext();
    expect(context).toBeNull();
    // Payload should be cleared after expiry check
    expect(useCrossModuleContext.getState().payload).toBeNull();
  });

  it('should clear context', () => {
    act(() => {
      useCrossModuleContext.getState().setContext(makePayloadInput());
    });

    expect(useCrossModuleContext.getState().payload).not.toBeNull();

    act(() => {
      useCrossModuleContext.getState().clearContext();
    });

    expect(useCrossModuleContext.getState().payload).toBeNull();
  });

  it('should overwrite existing context when setContext is called again', () => {
    act(() => {
      useCrossModuleContext
        .getState()
        .setContext(
          makePayloadInput({ sourceModule: 'ask', query: 'First query' })
        );
    });

    act(() => {
      useCrossModuleContext
        .getState()
        .setContext(
          makePayloadInput({ sourceModule: 'research', query: 'Second query' })
        );
    });

    const state = useCrossModuleContext.getState();
    expect(state.payload?.query).toBe('Second query');
    expect(state.payload?.sourceModule).toBe('research');
  });

  it('should work with minimal payload (no contextData)', () => {
    act(() => {
      useCrossModuleContext.getState().setContext({
        sourceModule: 'teams',
        query: 'Simple query',
      });
    });

    const context = useCrossModuleContext.getState().getContext();
    expect(context?.sourceModule).toBe('teams');
    expect(context?.query).toBe('Simple query');
    expect(context?.contextData).toBeUndefined();
  });

  it('should persist context across multiple getContext calls', () => {
    act(() => {
      useCrossModuleContext.getState().setContext(makePayloadInput());
    });

    const first = useCrossModuleContext.getState().getContext();
    const second = useCrossModuleContext.getState().getContext();

    expect(first).toEqual(second);
    // Payload should still be set (not cleared on valid read)
    expect(useCrossModuleContext.getState().payload).not.toBeNull();
  });

  it('should have expiresAt exactly 30 minutes from now', () => {
    vi.useFakeTimers();
    const now = new Date('2024-06-01T12:00:00Z');
    vi.setSystemTime(now);

    act(() => {
      useCrossModuleContext.getState().setContext(makePayloadInput());
    });

    const expectedExpiry = now.getTime() + 30 * 60 * 1000;
    expect(useCrossModuleContext.getState().payload?.expiresAt).toBe(
      expectedExpiry
    );

    vi.useRealTimers();
  });
});
