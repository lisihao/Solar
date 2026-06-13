/**
 * Timeout utilities
 *
 * Provides a reusable withTimeout wrapper to replace inline Promise.race patterns.
 */

/**
 * Error thrown when a promise exceeds the specified timeout.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Race a promise against a timeout.
 *
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param message - Optional error message (defaults to "Operation timed out after {ms}ms")
 * @returns The resolved value of the promise
 * @throws TimeoutError if the timeout expires first
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message?: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () =>
        reject(
          new TimeoutError(message || `Operation timed out after ${ms}ms`),
        ),
      ms,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Race a promise against a timeout, resolving with a fallback value instead of throwing.
 *
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param fallback - Value to return on timeout
 * @returns The resolved value or the fallback
 */
export async function withTimeoutFallback<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(fallback), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
