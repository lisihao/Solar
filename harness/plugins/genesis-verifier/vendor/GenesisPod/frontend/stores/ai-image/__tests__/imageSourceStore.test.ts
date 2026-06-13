import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useImageSourceStore } from '../imageSourceStore';
import type { ImageSourceItem } from '../imageSourceStore';

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

function makeSource(overrides: Partial<ImageSourceItem> = {}): ImageSourceItem {
  return {
    id: `source-${Date.now()}-${Math.random()}`,
    type: 'paper',
    title: 'Test Paper',
    url: 'https://example.com/paper',
    addedAt: new Date(),
    ...overrides,
  };
}

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useImageSourceStore.setState({ sources: [] });
}

// ═════════════════════════════════════════════════════════════════════════════
// useImageSourceStore
// ═════════════════════════════════════════════════════════════════════════════

describe('useImageSourceStore - initial state', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should start with empty sources array', () => {
    const { result } = renderHook(() => useImageSourceStore());
    expect(result.current.sources).toEqual([]);
  });
});

describe('useImageSourceStore - addSource', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
  });

  it('should add a new source', () => {
    const { result } = renderHook(() => useImageSourceStore());
    const source = makeSource({ id: 'src-1' });

    act(() => {
      result.current.addSource(source);
    });

    expect(result.current.sources).toHaveLength(1);
    expect(result.current.sources[0]).toEqual(source);
  });

  it('should NOT add a duplicate source (same id)', () => {
    const { result } = renderHook(() => useImageSourceStore());
    const source = makeSource({ id: 'src-dup' });

    act(() => {
      result.current.addSource(source);
    });
    act(() => {
      result.current.addSource(source);
    });

    expect(result.current.sources).toHaveLength(1);
  });

  it('should add sources with different ids', () => {
    const { result } = renderHook(() => useImageSourceStore());

    act(() => {
      result.current.addSource(makeSource({ id: 'src-1' }));
    });
    act(() => {
      result.current.addSource(makeSource({ id: 'src-2' }));
    });
    act(() => {
      result.current.addSource(makeSource({ id: 'src-3' }));
    });

    expect(result.current.sources).toHaveLength(3);
  });

  it('should cap sources at 10 items by removing the oldest (shift)', () => {
    const { result } = renderHook(() => useImageSourceStore());

    // Add 10 sources first
    act(() => {
      for (let i = 0; i < 10; i++) {
        result.current.addSource(makeSource({ id: `src-${i}` }));
      }
    });
    expect(result.current.sources).toHaveLength(10);

    // Adding the 11th should remove the oldest (index 0)
    const eleventh = makeSource({ id: 'src-10' });
    act(() => {
      result.current.addSource(eleventh);
    });

    expect(result.current.sources).toHaveLength(10);
    expect(
      result.current.sources.find((s) => s.id === 'src-0')
    ).toBeUndefined();
    expect(result.current.sources[result.current.sources.length - 1]).toEqual(
      eleventh
    );
  });

  it('should support all source types', () => {
    const { result } = renderHook(() => useImageSourceStore());
    const types: ImageSourceItem['type'][] = [
      'paper',
      'blog',
      'report',
      'youtube',
      'news',
      'project',
    ];

    act(() => {
      types.forEach((type, i) => {
        result.current.addSource(makeSource({ id: `src-${i}`, type }));
      });
    });

    expect(result.current.sources).toHaveLength(6);
    types.forEach((type, i) => {
      expect(result.current.sources[i].type).toBe(type);
    });
  });

  it('should store optional thumbnailUrl', () => {
    const { result } = renderHook(() => useImageSourceStore());
    const source = makeSource({
      id: 'src-thumb',
      thumbnailUrl: 'https://img.example.com/thumb.jpg',
    });

    act(() => {
      result.current.addSource(source);
    });

    expect(result.current.sources[0].thumbnailUrl).toBe(
      'https://img.example.com/thumb.jpg'
    );
  });
});

describe('useImageSourceStore - removeSource', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
  });

  it('should remove a source by id', () => {
    const { result } = renderHook(() => useImageSourceStore());
    act(() => {
      result.current.addSource(makeSource({ id: 'src-1' }));
    });

    act(() => {
      result.current.removeSource('src-1');
    });

    expect(result.current.sources).toHaveLength(0);
  });

  it('should only remove the matching source', () => {
    const { result } = renderHook(() => useImageSourceStore());
    act(() => {
      result.current.addSource(makeSource({ id: 'src-1', title: 'Keep me' }));
      result.current.addSource(makeSource({ id: 'src-2', title: 'Remove me' }));
    });

    act(() => {
      result.current.removeSource('src-2');
    });

    expect(result.current.sources).toHaveLength(1);
    expect(result.current.sources[0].title).toBe('Keep me');
  });

  it('should be a no-op when removing non-existent id', () => {
    const { result } = renderHook(() => useImageSourceStore());
    act(() => {
      result.current.addSource(makeSource({ id: 'src-1' }));
    });

    act(() => {
      result.current.removeSource('nonexistent');
    });

    expect(result.current.sources).toHaveLength(1);
  });

  it('should handle remove on empty sources gracefully', () => {
    const { result } = renderHook(() => useImageSourceStore());

    act(() => {
      result.current.removeSource('src-1');
    });

    expect(result.current.sources).toEqual([]);
  });
});

describe('useImageSourceStore - clearSources', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
  });

  it('should remove all sources', () => {
    const { result } = renderHook(() => useImageSourceStore());
    act(() => {
      result.current.addSource(makeSource({ id: 'src-1' }));
      result.current.addSource(makeSource({ id: 'src-2' }));
      result.current.addSource(makeSource({ id: 'src-3' }));
    });
    expect(result.current.sources).toHaveLength(3);

    act(() => {
      result.current.clearSources();
    });

    expect(result.current.sources).toEqual([]);
  });

  it('should be safe when sources is already empty', () => {
    const { result } = renderHook(() => useImageSourceStore());

    act(() => {
      result.current.clearSources();
    });

    expect(result.current.sources).toEqual([]);
  });
});

describe('useImageSourceStore - state invariants', () => {
  beforeEach(() => {
    resetStore();
    localStorageMock.clear();
  });

  it('should maintain source order after multiple add/remove operations', () => {
    const { result } = renderHook(() => useImageSourceStore());
    act(() => {
      result.current.addSource(makeSource({ id: 'a', title: 'A' }));
      result.current.addSource(makeSource({ id: 'b', title: 'B' }));
      result.current.addSource(makeSource({ id: 'c', title: 'C' }));
    });

    act(() => {
      result.current.removeSource('b');
    });

    expect(result.current.sources[0].id).toBe('a');
    expect(result.current.sources[1].id).toBe('c');
  });

  it('should allow re-adding a source after it was removed', () => {
    const { result } = renderHook(() => useImageSourceStore());
    const source = makeSource({ id: 'src-reuse' });

    act(() => {
      result.current.addSource(source);
    });
    act(() => {
      result.current.removeSource('src-reuse');
    });
    act(() => {
      result.current.addSource(source);
    });

    expect(result.current.sources).toHaveLength(1);
    expect(result.current.sources[0].id).toBe('src-reuse');
  });
});
