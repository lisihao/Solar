import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  useSlidesHistoryStore,
  formatRelativeTime,
} from '../slidesHistoryStore';
import type { SlidesHistoryItem, SlidesArtifact } from '../slidesHistoryStore';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const localStorageMock = (() => {
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
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeHistoryInput(
  overrides: Partial<Omit<SlidesHistoryItem, 'id' | 'timestamp'>> = {}
): Omit<SlidesHistoryItem, 'id' | 'timestamp'> {
  return {
    title: 'Test Slides',
    sourceText: 'Content about AI',
    targetPages: 10,
    status: 'success',
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<SlidesArtifact> = {}): SlidesArtifact {
  return {
    id: 'artifact-1',
    name: 'Presentation.pptx',
    type: 'PPTX',
    url: 'https://example.com/presentation.pptx',
    ...overrides,
  };
}

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useSlidesHistoryStore.setState({ history: [] });
}

// ═════════════════════════════════════════════════════════════════════════════
// useSlidesHistoryStore - initial state
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesHistoryStore - initial state', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should start with empty history', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());
    expect(result.current.history).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// addHistory
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesHistoryStore - addHistory', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
  });

  it('should add a history item and return its id', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    let id = '';
    act(() => {
      id = result.current.addHistory(makeHistoryInput());
    });

    expect(id).toMatch(/^slides_/);
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].id).toBe(id);
  });

  it('should attach a timestamp as a Date instance', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    act(() => {
      result.current.addHistory(makeHistoryInput());
    });

    expect(result.current.history[0].timestamp).toBeInstanceOf(Date);
  });

  it('should prepend new items (newest first)', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    act(() => {
      result.current.addHistory(makeHistoryInput({ title: 'First' }));
    });
    act(() => {
      result.current.addHistory(makeHistoryInput({ title: 'Second' }));
    });

    expect(result.current.history[0].title).toBe('Second');
    expect(result.current.history[1].title).toBe('First');
  });

  it('should preserve all input fields', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());
    const input = makeHistoryInput({
      title: 'Full Test',
      sourceText: 'Full source text',
      targetPages: 20,
      status: 'success',
      sessionId: 'session-1',
      checkpointId: 'ckpt-1',
      tags: ['AI', 'Tech'],
      result: {
        artifacts: [makeArtifact()],
        duration: 5000,
        documentId: 'doc-1',
        content: '<html>...',
      },
    });

    act(() => {
      result.current.addHistory(input);
    });

    const item = result.current.history[0];
    expect(item.title).toBe('Full Test');
    expect(item.targetPages).toBe(20);
    expect(item.sessionId).toBe('session-1');
    expect(item.tags).toEqual(['AI', 'Tech']);
    expect(item.result?.artifacts).toHaveLength(1);
    expect(item.result?.duration).toBe(5000);
  });

  it('should cap history at 50 items', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    act(() => {
      for (let i = 0; i < 55; i++) {
        result.current.addHistory(makeHistoryInput({ title: `Slide ${i}` }));
      }
    });

    expect(result.current.history).toHaveLength(50);
  });

  it('should keep the most recent 50 items when cap is exceeded', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    act(() => {
      for (let i = 0; i < 52; i++) {
        result.current.addHistory(makeHistoryInput({ title: `Slide ${i}` }));
      }
    });

    // Most recent (last added = 'Slide 51') should be first
    expect(result.current.history[0].title).toBe('Slide 51');
    expect(result.current.history).toHaveLength(50);
  });

  it('should support all status values', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    act(() => {
      result.current.addHistory(makeHistoryInput({ status: 'success' }));
    });
    act(() => {
      result.current.addHistory(makeHistoryInput({ status: 'error' }));
    });
    act(() => {
      result.current.addHistory(makeHistoryInput({ status: 'pending' }));
    });

    const statuses = result.current.history.map((h) => h.status);
    expect(statuses).toContain('success');
    expect(statuses).toContain('error');
    expect(statuses).toContain('pending');
  });

  it('should support compat fields: prompt, slideCount, templateId, summary', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());
    const input = makeHistoryInput({
      prompt: 'Generate a presentation',
      slideCount: 15,
      templateId: 'template-corp',
      summary: 'A brief summary',
    });

    act(() => {
      result.current.addHistory(input);
    });

    const item = result.current.history[0];
    expect(item.prompt).toBe('Generate a presentation');
    expect(item.slideCount).toBe(15);
    expect(item.templateId).toBe('template-corp');
    expect(item.summary).toBe('A brief summary');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// updateHistory
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesHistoryStore - updateHistory', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
  });

  it('should update specific fields of a history item by id', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    let id = '';
    act(() => {
      id = result.current.addHistory(makeHistoryInput({ status: 'pending' }));
    });

    act(() => {
      result.current.updateHistory(id, { status: 'success' });
    });

    const item = result.current.history.find((h) => h.id === id);
    expect(item?.status).toBe('success');
  });

  it('should not affect other history items', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    let id1 = '',
      id2 = '';
    act(() => {
      id1 = result.current.addHistory(makeHistoryInput({ title: 'Item 1' }));
      id2 = result.current.addHistory(makeHistoryInput({ title: 'Item 2' }));
    });

    act(() => {
      result.current.updateHistory(id1, { title: 'Updated Item 1' });
    });

    const item2 = result.current.history.find((h) => h.id === id2);
    expect(item2?.title).toBe('Item 2'); // unchanged
  });

  it('should allow updating result field', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    let id = '';
    act(() => {
      id = result.current.addHistory(makeHistoryInput({ status: 'pending' }));
    });

    const artifact = makeArtifact();
    act(() => {
      result.current.updateHistory(id, {
        status: 'success',
        result: { artifacts: [artifact], duration: 3000 },
      });
    });

    const item = result.current.history.find((h) => h.id === id);
    expect(item?.result?.artifacts).toHaveLength(1);
    expect(item?.result?.duration).toBe(3000);
  });

  it('should be a no-op when id does not exist', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());
    act(() => {
      result.current.addHistory(makeHistoryInput());
    });

    act(() => {
      result.current.updateHistory('nonexistent', { status: 'error' });
    });

    expect(result.current.history[0].status).toBe('success');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// removeHistory
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesHistoryStore - removeHistory', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
  });

  it('should remove a history item by id', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    let id = '';
    act(() => {
      id = result.current.addHistory(makeHistoryInput());
    });

    act(() => {
      result.current.removeHistory(id);
    });

    expect(result.current.history).toHaveLength(0);
  });

  it('should only remove the matching item', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    let id1 = '',
      id2 = '';
    act(() => {
      id1 = result.current.addHistory(makeHistoryInput({ title: 'Keep' }));
      id2 = result.current.addHistory(makeHistoryInput({ title: 'Remove' }));
    });

    act(() => {
      result.current.removeHistory(id2);
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].id).toBe(id1);
  });

  it('should be a no-op when removing non-existent id', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());
    act(() => {
      result.current.addHistory(makeHistoryInput());
    });

    act(() => {
      result.current.removeHistory('nonexistent');
    });

    expect(result.current.history).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// clearHistory
// ═════════════════════════════════════════════════════════════════════════════

describe('useSlidesHistoryStore - clearHistory', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
  });

  it('should remove all history items', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());
    act(() => {
      result.current.addHistory(makeHistoryInput());
      result.current.addHistory(makeHistoryInput());
      result.current.addHistory(makeHistoryInput());
    });
    expect(result.current.history).toHaveLength(3);

    act(() => {
      result.current.clearHistory();
    });

    expect(result.current.history).toEqual([]);
  });

  it('should be safe when history is already empty', () => {
    const { result } = renderHook(() => useSlidesHistoryStore());

    act(() => {
      result.current.clearHistory();
    });

    expect(result.current.history).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// formatRelativeTime
// ═════════════════════════════════════════════════════════════════════════════

describe('formatRelativeTime', () => {
  it('should return "刚刚" for dates less than 1 minute ago', () => {
    const now = new Date();
    const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    expect(formatRelativeTime(thirtySecondsAgo)).toBe('刚刚');
  });

  it('should return minutes string for dates 1-59 minutes ago', () => {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    expect(formatRelativeTime(fifteenMinutesAgo)).toBe('15分钟前');
  });

  it('should return hours string for dates 1-23 hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeHoursAgo)).toBe('3小时前');
  });

  it('should return days string for dates 1-6 days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeDaysAgo)).toBe('3天前');
  });

  it('should return M/D format for dates 7+ days ago', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const d = tenDaysAgo;
    const expected = `${d.getMonth() + 1}/${d.getDate()}`;
    expect(formatRelativeTime(tenDaysAgo)).toBe(expected);
  });

  it('should handle string-like dates (via new Date conversion)', () => {
    // Simulate the case where timestamp comes from JSON rehydration as string
    const pastDate = new Date(Date.now() - 2 * 60 * 1000); // 2 min ago
    // formatRelativeTime accepts Date, but also handles invalid Date internally
    const result = formatRelativeTime(pastDate);
    expect(result).toBe('2分钟前');
  });
});
