import { act, renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useToastStore, toast } from '../toastStore';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// No external deps to mock for toastStore

// ── Reset helpers ─────────────────────────────────────────────────────────────

function resetStore() {
  useToastStore.setState({ toasts: [] });
}

// ═════════════════════════════════════════════════════════════════════════════
// useToastStore
// ═════════════════════════════════════════════════════════════════════════════

describe('useToastStore', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start with an empty toasts array', () => {
      const { result } = renderHook(() => useToastStore());
      expect(result.current.toasts).toEqual([]);
    });
  });

  describe('addToast', () => {
    it('should add a toast and return its id', () => {
      const { result } = renderHook(() => useToastStore());

      let id = '';
      act(() => {
        id = result.current.addToast({ type: 'success', title: 'Done' });
      });

      expect(id).toMatch(/^toast-/);
      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].id).toBe(id);
    });

    it('should store type, title, and message on the toast', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({
          type: 'info',
          title: 'Hello',
          message: 'World',
        });
      });

      const t = result.current.toasts[0];
      expect(t.type).toBe('info');
      expect(t.title).toBe('Hello');
      expect(t.message).toBe('World');
    });

    it('should assign default duration 5000ms for non-error toasts', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({ type: 'success', title: 'OK' });
      });
      expect(result.current.toasts[0].duration).toBe(5000);

      act(() => {
        result.current.addToast({ type: 'warning', title: 'Warn' });
      });
      expect(result.current.toasts[1].duration).toBe(5000);

      act(() => {
        result.current.addToast({ type: 'info', title: 'FYI' });
      });
      expect(result.current.toasts[2].duration).toBe(5000);
    });

    it('should assign default duration 8000ms for error toasts', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({ type: 'error', title: 'Error!' });
      });

      expect(result.current.toasts[0].duration).toBe(8000);
    });

    it('should respect explicit duration override', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({
          type: 'success',
          title: 'Custom',
          duration: 2000,
        });
      });

      expect(result.current.toasts[0].duration).toBe(2000);
    });

    it('should NOT auto-dismiss when duration is 0', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({
          type: 'success',
          title: 'Sticky',
          duration: 0,
        });
      });

      act(() => {
        vi.advanceTimersByTime(60000);
      });

      expect(result.current.toasts).toHaveLength(1);
    });

    it('should auto-dismiss after the default duration for success toast', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({ type: 'success', title: 'Bye' });
      });
      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should auto-dismiss after 8000ms for error toast', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({ type: 'error', title: 'Oops' });
      });

      act(() => {
        vi.advanceTimersByTime(7999);
      });
      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.toasts).toHaveLength(0);
    });

    it('should not dismiss other toasts when one dismisses', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({
          type: 'success',
          title: 'Short',
          duration: 1000,
        });
      });
      act(() => {
        result.current.addToast({ type: 'info', title: 'Long', duration: 0 });
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].title).toBe('Long');
    });

    it('should generate unique ids for multiple toasts', () => {
      const { result } = renderHook(() => useToastStore());

      const ids: string[] = [];
      act(() => {
        ids.push(result.current.addToast({ type: 'success', title: 'A' }));
        ids.push(result.current.addToast({ type: 'info', title: 'B' }));
        ids.push(result.current.addToast({ type: 'warning', title: 'C' }));
      });

      const unique = new Set(ids);
      expect(unique.size).toBe(3);
    });
  });

  describe('removeToast', () => {
    it('should remove a toast by id', () => {
      const { result } = renderHook(() => useToastStore());

      let id = '';
      act(() => {
        id = result.current.addToast({ type: 'success', title: 'Remove me' });
      });

      act(() => {
        result.current.removeToast(id);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should not remove other toasts', () => {
      const { result } = renderHook(() => useToastStore());

      let id1 = '',
        id2 = '';
      act(() => {
        id1 = result.current.addToast({
          type: 'success',
          title: 'Keep me',
          duration: 0,
        });
        id2 = result.current.addToast({
          type: 'info',
          title: 'Remove me',
          duration: 0,
        });
      });

      act(() => {
        result.current.removeToast(id2);
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].id).toBe(id1);
    });

    it('should be a no-op when removing a non-existent id', () => {
      const { result } = renderHook(() => useToastStore());
      act(() => {
        result.current.addToast({
          type: 'success',
          title: 'Stay',
          duration: 0,
        });
      });

      act(() => {
        result.current.removeToast('nonexistent-id');
      });

      expect(result.current.toasts).toHaveLength(1);
    });
  });

  describe('clearAll', () => {
    it('should remove all toasts', () => {
      const { result } = renderHook(() => useToastStore());
      act(() => {
        result.current.addToast({ type: 'success', title: 'A', duration: 0 });
        result.current.addToast({ type: 'error', title: 'B', duration: 0 });
        result.current.addToast({ type: 'info', title: 'C', duration: 0 });
      });
      expect(result.current.toasts).toHaveLength(3);

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should be a no-op on empty toasts', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.toasts).toEqual([]);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// toast convenience methods
// ═════════════════════════════════════════════════════════════════════════════

describe('toast convenience methods', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('toast.success should add a success toast and return id', () => {
    let id = '';
    act(() => {
      id = toast.success('Success title', 'Success message');
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].title).toBe('Success title');
    expect(toasts[0].message).toBe('Success message');
    expect(id).toMatch(/^toast-/);
  });

  it('toast.error should add an error toast with 8000ms duration', () => {
    act(() => {
      toast.error('Error title');
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].duration).toBe(8000);
  });

  it('toast.warning should add a warning toast', () => {
    act(() => {
      toast.warning('Warning title', 'Watch out');
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].type).toBe('warning');
    expect(toasts[0].title).toBe('Warning title');
  });

  it('toast.info should add an info toast', () => {
    act(() => {
      toast.info('Info title');
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].type).toBe('info');
    expect(toasts[0].title).toBe('Info title');
    expect(toasts[0].message).toBeUndefined();
  });

  it('convenience methods should work without a message argument', () => {
    act(() => {
      toast.success('Title only');
      toast.error('Error only');
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(2);
    toasts.forEach((t) => expect(t.message).toBeUndefined());
  });
});
