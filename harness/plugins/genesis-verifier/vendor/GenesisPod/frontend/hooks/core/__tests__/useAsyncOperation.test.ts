import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useAsyncOperation,
  useAsyncOperationWithCancel,
  useAsyncOperationWithRetry,
} from '../useAsyncOperation';

describe('useAsyncOperation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic functionality', () => {
    it('should initialize with default state', () => {
      const asyncFn = vi.fn().mockResolvedValue('data');
      const { result } = renderHook(() => useAsyncOperation(asyncFn));

      expect(result.current.data).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
    });

    it('should initialize with provided initial data', () => {
      const asyncFn = vi.fn().mockResolvedValue('new data');
      const { result } = renderHook(() =>
        useAsyncOperation(asyncFn, { initialData: 'initial' })
      );

      expect(result.current.data).toBe('initial');
      expect(result.current.isSuccess).toBe(true);
    });

    it('should execute async function and update state on success', async () => {
      const asyncFn = vi.fn().mockResolvedValue('success data');
      const onSuccess = vi.fn();

      const { result } = renderHook(() =>
        useAsyncOperation(asyncFn, { onSuccess })
      );

      await act(async () => {
        await result.current.execute();
      });

      expect(result.current.data).toBe('success data');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isError).toBe(false);
      expect(onSuccess).toHaveBeenCalledWith('success data');
    });

    it('should handle errors correctly', async () => {
      const asyncFn = vi.fn().mockRejectedValue(new Error('Test error'));
      const onError = vi.fn();

      const { result } = renderHook(() =>
        useAsyncOperation(asyncFn, { onError })
      );

      await act(async () => {
        await result.current.execute();
      });

      expect(result.current.data).toBeUndefined();
      expect(result.current.error).toBe('Test error');
      expect(result.current.isError).toBe(true);
      expect(result.current.isSuccess).toBe(false);
      expect(onError).toHaveBeenCalledWith('Test error');
    });

    it('should set loading state during execution', async () => {
      let resolvePromise: (value: string) => void;
      const asyncFn = vi.fn().mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolvePromise = resolve;
          })
      );

      const { result } = renderHook(() => useAsyncOperation(asyncFn));

      let promise: ReturnType<typeof result.current.execute>;
      act(() => {
        promise = result.current.execute();
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!('data');
        await promise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('should call onSettled regardless of success or failure', async () => {
      const onSettled = vi.fn();

      // Test success case
      const successFn = vi.fn().mockResolvedValue('data');
      const { result: successResult } = renderHook(() =>
        useAsyncOperation(successFn, { onSettled })
      );

      await act(async () => {
        await successResult.current.execute();
      });

      expect(onSettled).toHaveBeenCalledTimes(1);

      // Test failure case
      onSettled.mockClear();
      const errorFn = vi.fn().mockRejectedValue(new Error('error'));
      const { result: errorResult } = renderHook(() =>
        useAsyncOperation(errorFn, { onSettled })
      );

      await act(async () => {
        await errorResult.current.execute();
      });

      expect(onSettled).toHaveBeenCalledTimes(1);
    });

    it('should reset state correctly', async () => {
      const asyncFn = vi.fn().mockResolvedValue('data');
      const { result } = renderHook(() =>
        useAsyncOperation(asyncFn, { initialData: 'initial' })
      );

      await act(async () => {
        await result.current.execute();
      });

      expect(result.current.data).toBe('data');

      act(() => {
        result.current.reset();
      });

      expect(result.current.data).toBe('initial');
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('should allow manual data setting', () => {
      const asyncFn = vi.fn().mockResolvedValue('async data');
      const { result } = renderHook(() => useAsyncOperation(asyncFn));

      act(() => {
        result.current.setData('manual data');
      });

      expect(result.current.data).toBe('manual data');
    });

    it('should allow manual error setting', () => {
      const asyncFn = vi.fn().mockResolvedValue('data');
      const { result } = renderHook(() => useAsyncOperation(asyncFn));

      act(() => {
        result.current.setError('manual error');
      });

      expect(result.current.error).toBe('manual error');
      expect(result.current.isError).toBe(true);
    });

    it('should pass parameters to async function', async () => {
      const asyncFn = vi.fn().mockImplementation((params: { id: number }) => {
        return Promise.resolve(`data-${params.id}`);
      });

      const { result } = renderHook(() =>
        useAsyncOperation<string, { id: number }>(asyncFn)
      );

      await act(async () => {
        await result.current.execute({ id: 42 });
      });

      expect(asyncFn).toHaveBeenCalledWith({ id: 42 });
      expect(result.current.data).toBe('data-42');
    });
  });
});

describe('useAsyncOperationWithCancel', () => {
  it('should provide cancel functionality', () => {
    const asyncFn = vi.fn().mockResolvedValue('data');
    const { result } = renderHook(() => useAsyncOperationWithCancel(asyncFn));

    expect(result.current.cancel).toBeDefined();
    expect(typeof result.current.cancel).toBe('function');
  });

  it('should execute async function successfully', async () => {
    const asyncFn = vi.fn().mockResolvedValue('data');
    const { result } = renderHook(() => useAsyncOperationWithCancel(asyncFn));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe('data');
    expect(asyncFn).toHaveBeenCalled();
  });
});

describe('useAsyncOperationWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should retry on failure', async () => {
    let callCount = 0;
    const asyncFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.reject(new Error('Temporary error'));
      }
      return Promise.resolve('success');
    });

    const { result } = renderHook(() =>
      useAsyncOperationWithRetry(asyncFn, {
        maxRetries: 3,
        initialDelay: 100,
        jitter: false,
      })
    );

    const executePromise = act(async () => {
      const promise = result.current.execute();

      // Fast-forward through retry delays
      await vi.advanceTimersByTimeAsync(100); // First retry delay
      await vi.advanceTimersByTimeAsync(200); // Second retry delay

      return promise;
    });

    await executePromise;

    expect(asyncFn).toHaveBeenCalledTimes(3);
    expect(result.current.data).toBe('success');
    expect(result.current.retryCount).toBe(0); // Reset after success
  });

  it('should fail after max retries exceeded', async () => {
    const asyncFn = vi.fn().mockRejectedValue(new Error('Persistent error'));
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useAsyncOperationWithRetry(asyncFn, {
        maxRetries: 2,
        initialDelay: 100,
        jitter: false,
        onError,
      })
    );

    await act(async () => {
      const promise = result.current.execute();

      // Fast-forward through all retry delays
      await vi.advanceTimersByTimeAsync(100); // First retry
      await vi.advanceTimersByTimeAsync(200); // Second retry
      await vi.advanceTimersByTimeAsync(400); // Third attempt fails, no more retries

      try {
        await promise;
      } catch {
        // Expected to fail
      }
    });

    // Initial call + maxRetries
    expect(asyncFn).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBe('Persistent error');
    expect(onError).toHaveBeenCalledWith('Persistent error');
  });

  it('should initialize with zero retry count', () => {
    const asyncFn = vi.fn().mockResolvedValue('data');

    const { result } = renderHook(() =>
      useAsyncOperationWithRetry(asyncFn, {
        maxRetries: 3,
        initialDelay: 100,
      })
    );

    expect(result.current.retryCount).toBe(0);
  });

  it('should succeed on first try without retrying', async () => {
    const asyncFn = vi.fn().mockResolvedValue('success');

    const { result } = renderHook(() =>
      useAsyncOperationWithRetry(asyncFn, {
        maxRetries: 3,
        initialDelay: 100,
      })
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(asyncFn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe('success');
    expect(result.current.retryCount).toBe(0);
  });
});
