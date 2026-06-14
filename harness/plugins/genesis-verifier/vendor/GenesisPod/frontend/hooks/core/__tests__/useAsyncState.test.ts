import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useAsyncState,
  useAsyncStateWithRetry,
  useAsyncArrayState,
  createAsyncSlice,
} from '../useAsyncState';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// No external deps to mock

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveAfter<T>(value: T, delay = 0): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), delay));
}

function rejectAfter(error: string, delay = 0): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(error)), delay)
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// useAsyncState
// ═════════════════════════════════════════════════════════════════════════════

describe('useAsyncState - initial state', () => {
  it('should start with undefined data, not loading, no error', () => {
    const { result } = renderHook(() => useAsyncState<string>());

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('should use initialData when provided', () => {
    const { result } = renderHook(() => useAsyncState<string>('hello'));

    expect(result.current.data).toBe('hello');
    expect(result.current.isSuccess).toBe(true); // data !== undefined && !error
  });
});

describe('useAsyncState - execute', () => {
  it('should set isLoading true during async operation', async () => {
    const { result } = renderHook(() => useAsyncState<string>());

    let resolvePromise!: (v: string) => void;
    const pending = new Promise<string>((res) => {
      resolvePromise = res;
    });

    act(() => {
      void result.current.execute(() => pending);
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolvePromise('done');
      await pending;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('should set data on successful async operation', async () => {
    const { result } = renderHook(() => useAsyncState<string>());

    await act(async () => {
      await result.current.execute(() => Promise.resolve('success value'));
    });

    expect(result.current.data).toBe('success value');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isError).toBe(false);
  });

  it('should return the resolved value from execute', async () => {
    const { result } = renderHook(() => useAsyncState<number>());

    let returnValue: number | undefined;
    await act(async () => {
      returnValue = await result.current.execute(() => Promise.resolve(42));
    });

    expect(returnValue).toBe(42);
  });

  it('should set error on failed async operation', async () => {
    const { result } = renderHook(() => useAsyncState<string>());

    await act(async () => {
      await result.current.execute(() =>
        Promise.reject(new Error('fetch failed'))
      );
    });

    expect(result.current.error).toBe('fetch failed');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(true);
    expect(result.current.isSuccess).toBe(false);
  });

  it('should return undefined when the operation fails', async () => {
    const { result } = renderHook(() => useAsyncState<string>());

    let returnValue: string | undefined = 'sentinel';
    await act(async () => {
      returnValue = await result.current.execute(() =>
        Promise.reject(new Error('error'))
      );
    });

    expect(returnValue).toBeUndefined();
  });

  it('should clear previous error on new execute call', async () => {
    const { result } = renderHook(() => useAsyncState<string>());

    await act(async () => {
      await result.current.execute(() =>
        Promise.reject(new Error('first error'))
      );
    });
    expect(result.current.error).toBe('first error');

    await act(async () => {
      await result.current.execute(() => Promise.resolve('success'));
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe('success');
  });

  it('should call onSuccess callback with data', async () => {
    const { result } = renderHook(() => useAsyncState<string>());
    const onSuccess = vi.fn();

    await act(async () => {
      await result.current.execute(() => Promise.resolve('result data'), {
        onSuccess,
      });
    });

    expect(onSuccess).toHaveBeenCalledWith('result data');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('should call onError callback with error message', async () => {
    const { result } = renderHook(() => useAsyncState<string>());
    const onError = vi.fn();

    await act(async () => {
      await result.current.execute(() => Promise.reject(new Error('bang')), {
        onError,
      });
    });

    expect(onError).toHaveBeenCalledWith('bang');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('should call onSettled callback after success', async () => {
    const { result } = renderHook(() => useAsyncState<string>());
    const onSettled = vi.fn();

    await act(async () => {
      await result.current.execute(() => Promise.resolve('ok'), { onSettled });
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('should call onSettled callback after failure', async () => {
    const { result } = renderHook(() => useAsyncState<string>());
    const onSettled = vi.fn();

    await act(async () => {
      await result.current.execute(() => Promise.reject(new Error('err')), {
        onSettled,
      });
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('should handle non-Error exceptions with string conversion', async () => {
    const { result } = renderHook(() => useAsyncState<string>());

    await act(async () => {
      await result.current.execute(() => Promise.reject('raw string error'));
    });

    expect(result.current.error).toBe('raw string error');
  });
});

describe('useAsyncState - reset', () => {
  it('should reset state to initial values', async () => {
    const { result } = renderHook(() => useAsyncState<string>('initial'));

    await act(async () => {
      await result.current.execute(() => Promise.resolve('changed'));
    });
    expect(result.current.data).toBe('changed');

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBe('initial');
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('should reset error state', async () => {
    const { result } = renderHook(() => useAsyncState<string>());

    await act(async () => {
      await result.current.execute(() => Promise.reject(new Error('oops')));
    });
    expect(result.current.error).toBe('oops');

    act(() => {
      result.current.reset();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isError).toBe(false);
  });
});

describe('useAsyncState - setData / setError', () => {
  it('should set data directly', () => {
    const { result } = renderHook(() => useAsyncState<number>());

    act(() => {
      result.current.setData(99);
    });

    expect(result.current.data).toBe(99);
  });

  it('should set error directly', () => {
    const { result } = renderHook(() => useAsyncState<number>());

    act(() => {
      result.current.setError('manual error');
    });

    expect(result.current.error).toBe('manual error');
    expect(result.current.isError).toBe(true);
  });

  it('should clear error by setting null via setError', () => {
    const { result } = renderHook(() => useAsyncState<number>());
    act(() => {
      result.current.setError('error');
    });

    act(() => {
      result.current.setError(null);
    });

    expect(result.current.error).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useAsyncStateWithRetry
// ═════════════════════════════════════════════════════════════════════════════

describe('useAsyncStateWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should succeed on the first attempt without retrying', async () => {
    const { result } = renderHook(() => useAsyncStateWithRetry<string>());

    await act(async () => {
      await result.current.execute(() => Promise.resolve('first try'));
    });

    expect(result.current.data).toBe('first try');
    expect(result.current.error).toBeNull();
  });

  it('should expose retryCount (initially 0)', () => {
    const { result } = renderHook(() => useAsyncStateWithRetry<string>());
    expect(result.current.retryCount).toBe(0);
  });

  it('should inherit base state fields', () => {
    const { result } = renderHook(() => useAsyncStateWithRetry<string>('init'));
    expect(result.current.data).toBe('init');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// useAsyncArrayState
// ═════════════════════════════════════════════════════════════════════════════

type Item = { _id: string; name: string };

describe('useAsyncArrayState - initial state', () => {
  it('should start with empty items', () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());

    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.count).toBe(0);
  });

  it('should use provided initialData', () => {
    const initial: Item[] = [{ _id: 'a', name: 'Alpha' }];
    const { result } = renderHook(() => useAsyncArrayState<Item>(initial));

    expect(result.current.items).toEqual(initial);
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.count).toBe(1);
  });
});

describe('useAsyncArrayState - addItem', () => {
  it('should add a new item', () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());
    const item: Item = { _id: 'id-1', name: 'Alpha' };

    act(() => {
      result.current.addItem(item);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toEqual(item);
  });

  it('should NOT add duplicate items (same _id)', () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());
    const item: Item = { _id: 'dup', name: 'Dup' };

    act(() => {
      result.current.addItem(item);
    });
    act(() => {
      result.current.addItem(item);
    });

    expect(result.current.items).toHaveLength(1);
  });

  it('should add multiple unique items', () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());

    act(() => {
      result.current.addItem({ _id: 'a', name: 'A' });
    });
    act(() => {
      result.current.addItem({ _id: 'b', name: 'B' });
    });

    expect(result.current.count).toBe(2);
  });
});

describe('useAsyncArrayState - addItems', () => {
  it('should add multiple items at once', () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());
    const items: Item[] = [
      { _id: 'a', name: 'A' },
      { _id: 'b', name: 'B' },
    ];

    act(() => {
      result.current.addItems(items);
    });

    expect(result.current.items).toHaveLength(2);
  });

  it('should skip items that already exist', () => {
    const { result } = renderHook(() =>
      useAsyncArrayState<Item>([{ _id: 'a', name: 'A' }])
    );

    act(() => {
      result.current.addItems([
        { _id: 'a', name: 'A duplicate' },
        { _id: 'b', name: 'B new' },
      ]);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.find((i) => i._id === 'a')?.name).toBe('A'); // original kept
    expect(result.current.items.find((i) => i._id === 'b')?.name).toBe('B new');
  });

  it('should be a no-op when all items are duplicates', () => {
    const existing: Item[] = [{ _id: 'x', name: 'X' }];
    const { result } = renderHook(() => useAsyncArrayState<Item>(existing));

    act(() => {
      result.current.addItems([{ _id: 'x', name: 'X copy' }]);
    });

    expect(result.current.items).toHaveLength(1);
  });
});

describe('useAsyncArrayState - removeItem', () => {
  it('should remove an item by _id', () => {
    const { result } = renderHook(() =>
      useAsyncArrayState<Item>([
        { _id: 'a', name: 'A' },
        { _id: 'b', name: 'B' },
      ])
    );

    act(() => {
      result.current.removeItem('a');
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]._id).toBe('b');
  });

  it('should be a no-op for non-existent id', () => {
    const { result } = renderHook(() =>
      useAsyncArrayState<Item>([{ _id: 'a', name: 'A' }])
    );

    act(() => {
      result.current.removeItem('nonexistent');
    });

    expect(result.current.items).toHaveLength(1);
  });
});

describe('useAsyncArrayState - updateItem', () => {
  it('should update fields of matching item', () => {
    const { result } = renderHook(() =>
      useAsyncArrayState<Item>([{ _id: 'a', name: 'Old' }])
    );

    act(() => {
      result.current.updateItem('a', { name: 'New' });
    });

    expect(result.current.items[0].name).toBe('New');
    expect(result.current.items[0]._id).toBe('a'); // id preserved
  });

  it('should not affect other items', () => {
    const { result } = renderHook(() =>
      useAsyncArrayState<Item>([
        { _id: 'a', name: 'A' },
        { _id: 'b', name: 'B' },
      ])
    );

    act(() => {
      result.current.updateItem('a', { name: 'A updated' });
    });

    expect(result.current.items[1].name).toBe('B');
  });
});

describe('useAsyncArrayState - load', () => {
  it('should set items from async function with deduplication', async () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());
    const items: Item[] = [
      { _id: 'a', name: 'A' },
      { _id: 'a', name: 'A dup' }, // duplicate
      { _id: 'b', name: 'B' },
    ];

    await act(async () => {
      await result.current.load(() => Promise.resolve(items));
    });

    expect(result.current.items).toHaveLength(2); // deduped
    expect(result.current.items[0]._id).toBe('a');
    expect(result.current.items[1]._id).toBe('b');
    expect(result.current.isLoading).toBe(false);
  });

  it('should set error on failure', async () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());

    await act(async () => {
      await result.current.load(() => Promise.reject(new Error('load error')));
    });

    expect(result.current.error).toBe('load error');
    expect(result.current.isLoading).toBe(false);
  });

  it('should call onSuccess with deduplicated items', async () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());
    const onSuccess = vi.fn();
    const items: Item[] = [{ _id: 'a', name: 'A' }];

    await act(async () => {
      await result.current.load(() => Promise.resolve(items), { onSuccess });
    });

    expect(onSuccess).toHaveBeenCalledWith(items);
  });

  it('should call onError on failure', async () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());
    const onError = vi.fn();

    await act(async () => {
      await result.current.load(() => Promise.reject(new Error('err')), {
        onError,
      });
    });

    expect(onError).toHaveBeenCalledWith('err');
  });

  it('should call onSettled regardless of success or failure', async () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());
    const onSettledSuccess = vi.fn();
    const onSettledError = vi.fn();

    await act(async () => {
      await result.current.load(() => Promise.resolve([]), {
        onSettled: onSettledSuccess,
      });
    });
    expect(onSettledSuccess).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.load(() => Promise.reject(new Error('x')), {
        onSettled: onSettledError,
      });
    });
    expect(onSettledError).toHaveBeenCalledTimes(1);
  });
});

describe('useAsyncArrayState - reset', () => {
  it('should reset items to initialData', () => {
    const initial: Item[] = [{ _id: 'init', name: 'Initial' }];
    const { result } = renderHook(() => useAsyncArrayState<Item>(initial));
    act(() => {
      result.current.addItem({ _id: 'added', name: 'Added' });
    });
    expect(result.current.count).toBe(2);

    act(() => {
      result.current.reset();
    });

    expect(result.current.items).toEqual(initial);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useAsyncArrayState - setItems', () => {
  it('should replace items array directly', () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());
    const newItems: Item[] = [
      { _id: 'x', name: 'X' },
      { _id: 'y', name: 'Y' },
    ];

    act(() => {
      result.current.setItems(newItems);
    });

    expect(result.current.items).toEqual(newItems);
  });
});

describe('useAsyncArrayState - isEmpty / count', () => {
  it('isEmpty should be true when items is empty', () => {
    const { result } = renderHook(() => useAsyncArrayState<Item>());
    expect(result.current.isEmpty).toBe(true);
  });

  it('isEmpty should be false when items has entries', () => {
    const { result } = renderHook(() =>
      useAsyncArrayState<Item>([{ _id: 'a', name: 'A' }])
    );
    expect(result.current.isEmpty).toBe(false);
  });

  it('count should reflect the number of items', () => {
    const { result } = renderHook(() =>
      useAsyncArrayState<Item>([
        { _id: 'a', name: 'A' },
        { _id: 'b', name: 'B' },
        { _id: 'c', name: 'C' },
      ])
    );
    expect(result.current.count).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createAsyncSlice
// ═════════════════════════════════════════════════════════════════════════════

describe('createAsyncSlice', () => {
  it('should return initial slice with isLoading=false and error=null', () => {
    const setState = vi.fn();
    const slice = createAsyncSlice(
      setState as Parameters<typeof createAsyncSlice>[0]
    );

    expect(slice.isLoading).toBe(false);
    expect(slice.error).toBeNull();
  });

  it('setLoading should call set with new isLoading value', () => {
    const setState = vi.fn();
    const slice = createAsyncSlice(
      setState as Parameters<typeof createAsyncSlice>[0]
    );

    slice.setLoading(true);

    expect(setState).toHaveBeenCalledTimes(1);
    const updater = setState.mock.calls[0][0];
    expect(updater(slice)).toEqual({ isLoading: true });
  });

  it('setError should call set with new error value', () => {
    const setState = vi.fn();
    const slice = createAsyncSlice(
      setState as Parameters<typeof createAsyncSlice>[0]
    );

    slice.setError('network error');

    const updater = setState.mock.calls[0][0];
    expect(updater(slice)).toEqual({ error: 'network error' });
  });

  it('clearError should call set with null error', () => {
    const setState = vi.fn();
    const slice = createAsyncSlice(
      setState as Parameters<typeof createAsyncSlice>[0]
    );

    slice.clearError();

    const updater = setState.mock.calls[0][0];
    expect(updater(slice)).toEqual({ error: null });
  });
});
