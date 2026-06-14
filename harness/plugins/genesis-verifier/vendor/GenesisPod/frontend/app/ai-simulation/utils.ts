export function safeJson<T = unknown>(
  input: string | object | null | undefined,
  fallback: T
): T {
  if (input === null || input === undefined) {
    return fallback;
  }
  // If input is already an object, return it directly
  if (typeof input === 'object') {
    return input as T;
  }
  // If input is a string, try to parse it
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}
