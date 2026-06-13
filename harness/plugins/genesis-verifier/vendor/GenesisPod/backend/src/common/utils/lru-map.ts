/**
 * LRU (Least Recently Used) Map
 *
 * A Map with a maximum size that automatically evicts the oldest entry
 * when the size limit is reached.
 *
 * Usage:
 * ```ts
 * const cache = new LruMap<string, number>(100);
 * cache.set('key', 42);
 * ```
 */
export class LruMap<K, V> extends Map<K, V> {
  constructor(private readonly maxSize: number) {
    super();
    if (maxSize <= 0) {
      throw new Error("maxSize must be positive");
    }
  }

  set(key: K, value: V): this {
    if (this.has(key)) {
      // Re-insert for LRU ordering (delete then add to move to end)
      this.delete(key);
    } else if (this.size >= this.maxSize) {
      // Delete the first (oldest) entry
      const firstKey = this.keys().next().value;
      if (firstKey !== undefined) {
        this.delete(firstKey);
      }
    }
    return super.set(key, value);
  }
}
