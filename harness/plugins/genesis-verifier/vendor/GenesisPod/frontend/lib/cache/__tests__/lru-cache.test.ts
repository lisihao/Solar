import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache, apiCache } from '../lru-cache';

describe('LRUCache', () => {
  let cache: LRUCache<string, unknown>;

  beforeEach(() => {
    cache = new LRUCache<string, unknown>({ maxSize: 3, defaultTTL: 1000 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('should set and get values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete values', () => {
      cache.set('key1', 'value1');
      expect(cache.delete('key1')).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });

    it('should return correct size', () => {
      expect(cache.size).toBe(0);
      cache.set('key1', 'value1');
      expect(cache.size).toBe(1);
      cache.set('key2', 'value2');
      expect(cache.size).toBe(2);
    });

    it('should return all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.keys()).toEqual(['key1', 'key2']);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used item when max size reached', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Cache is full (maxSize = 3), adding key4 should evict key1
      cache.set('key4', 'value4');

      expect(cache.size).toBe(3);
      expect(cache.get('key1')).toBeUndefined(); // Evicted
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('should move accessed item to most recently used', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1, making it most recently used
      cache.get('key1');

      // Adding key4 should now evict key2 (oldest after key1 was accessed)
      cache.set('key4', 'value4');

      expect(cache.get('key1')).toBe('value1'); // Still exists
      expect(cache.get('key2')).toBeUndefined(); // Evicted
      expect(cache.get('key3')).toBe('value3');
      expect(cache.get('key4')).toBe('value4');
    });

    it('should update existing key without counting as new entry', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Update existing key
      cache.set('key1', 'updated1');

      expect(cache.size).toBe(3);
      expect(cache.get('key1')).toBe('updated1');
    });
  });

  describe('TTL expiration', () => {
    it('should return undefined for expired items', () => {
      cache.set('key1', 'value1', 500); // 500ms TTL

      // Before expiration
      expect(cache.get('key1')).toBe('value1');

      // Advance time past TTL
      vi.advanceTimersByTime(600);

      // After expiration
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should use default TTL when not specified', () => {
      cache.set('key1', 'value1'); // Uses default 1000ms TTL

      vi.advanceTimersByTime(900);
      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(200);
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should remove expired items on has() check', () => {
      cache.set('key1', 'value1', 500);

      expect(cache.has('key1')).toBe(true);

      vi.advanceTimersByTime(600);

      expect(cache.has('key1')).toBe(false);
    });

    it('should cleanup expired entries', () => {
      cache.set('key1', 'value1', 500);
      cache.set('key2', 'value2', 1500);
      cache.set('key3', 'value3', 500);

      vi.advanceTimersByTime(1000);

      const cleaned = cache.cleanup();

      expect(cleaned).toBe(2); // key1 and key3 expired
      expect(cache.size).toBe(1);
      expect(cache.get('key2')).toBe('value2');
    });
  });

  describe('type safety', () => {
    it('should handle different value types', () => {
      const typedCache = new LRUCache<string, number | string | object>();

      typedCache.set('number', 42);
      typedCache.set('string', 'hello');
      typedCache.set('object', { foo: 'bar' });

      expect(typedCache.get('number')).toBe(42);
      expect(typedCache.get('string')).toBe('hello');
      expect(typedCache.get('object')).toEqual({ foo: 'bar' });
    });

    it('should handle numeric keys', () => {
      const numericCache = new LRUCache<number, string>();

      numericCache.set(1, 'one');
      numericCache.set(2, 'two');

      expect(numericCache.get(1)).toBe('one');
      expect(numericCache.get(2)).toBe('two');
    });
  });
});

describe('apiCache (global instance)', () => {
  beforeEach(() => {
    apiCache.clear();
  });

  it('should be a singleton instance', () => {
    apiCache.set('test', 'value');
    expect(apiCache.get('test')).toBe('value');
  });

  it('should have correct default configuration', () => {
    // Default maxSize is 200, defaultTTL is 5 minutes
    // We can test by checking it doesn't evict with fewer items
    for (let i = 0; i < 100; i++) {
      apiCache.set(`key${i}`, `value${i}`);
    }

    expect(apiCache.size).toBe(100);
    expect(apiCache.get('key0')).toBe('value0'); // First item should still exist
  });
});
