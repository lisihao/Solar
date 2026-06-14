/**
 * LruMap Unit Tests
 *
 * Tests for the LRU (Least Recently Used) Map implementation that
 * automatically evicts the oldest entry when the size limit is reached.
 */

import { LruMap } from "../lru-map";

describe("LruMap", () => {
  // ========== Constructor ==========

  describe("constructor", () => {
    it("should create an empty map", () => {
      // Act
      const map = new LruMap<string, number>(5);

      // Assert
      expect(map.size).toBe(0);
    });

    it("should throw when maxSize is 0", () => {
      expect(() => new LruMap(0)).toThrow("maxSize must be positive");
    });

    it("should throw when maxSize is negative", () => {
      expect(() => new LruMap(-1)).toThrow("maxSize must be positive");
    });

    it("should throw when maxSize is -100", () => {
      expect(() => new LruMap(-100)).toThrow("maxSize must be positive");
    });

    it("should accept maxSize of 1", () => {
      expect(() => new LruMap(1)).not.toThrow();
    });

    it("should accept large maxSize", () => {
      const map = new LruMap<string, string>(10000);
      expect(map.size).toBe(0);
    });
  });

  // ========== set ==========

  describe("set", () => {
    it("should store a key-value pair", () => {
      // Arrange
      const map = new LruMap<string, number>(5);

      // Act
      map.set("key", 42);

      // Assert
      expect(map.get("key")).toBe(42);
      expect(map.size).toBe(1);
    });

    it("should store multiple key-value pairs", () => {
      const map = new LruMap<string, number>(5);
      map.set("a", 1);
      map.set("b", 2);
      map.set("c", 3);

      expect(map.get("a")).toBe(1);
      expect(map.get("b")).toBe(2);
      expect(map.get("c")).toBe(3);
      expect(map.size).toBe(3);
    });

    it("should evict the oldest entry when max size is exceeded", () => {
      // Arrange
      const map = new LruMap<string, number>(3);
      map.set("a", 1);
      map.set("b", 2);
      map.set("c", 3);

      // Act - adding a 4th entry should evict "a" (oldest)
      map.set("d", 4);

      // Assert
      expect(map.size).toBe(3);
      expect(map.has("a")).toBe(false);
      expect(map.has("b")).toBe(true);
      expect(map.has("c")).toBe(true);
      expect(map.has("d")).toBe(true);
    });

    it("should evict in insertion order when no access occurs", () => {
      // Arrange
      const map = new LruMap<string, number>(2);
      map.set("first", 1);
      map.set("second", 2);

      // Act - third entry evicts "first"
      map.set("third", 3);

      // Assert
      expect(map.has("first")).toBe(false);
      expect(map.has("second")).toBe(true);
      expect(map.has("third")).toBe(true);
    });

    it("should update existing key value without changing size", () => {
      // Arrange
      const map = new LruMap<string, number>(3);
      map.set("a", 1);
      map.set("b", 2);

      // Act - update existing key
      map.set("a", 100);

      // Assert
      expect(map.get("a")).toBe(100);
      expect(map.size).toBe(2);
    });

    it("should re-insert updated key to keep it from being evicted", () => {
      // Arrange - capacity 2
      const map = new LruMap<string, number>(2);
      map.set("a", 1);
      map.set("b", 2);

      // Act - update "a" so it moves to the end (most recently used)
      map.set("a", 100);

      // Now add "c" — should evict "b" (oldest after "a" was re-inserted)
      map.set("c", 3);

      // Assert
      expect(map.has("a")).toBe(true); // "a" was re-inserted, protected
      expect(map.get("a")).toBe(100);
      expect(map.has("b")).toBe(false); // "b" is now oldest, evicted
      expect(map.has("c")).toBe(true);
    });

    it("should work correctly with maxSize of 1", () => {
      // Arrange
      const map = new LruMap<string, number>(1);
      map.set("a", 1);
      expect(map.has("a")).toBe(true);

      // Act
      map.set("b", 2);

      // Assert
      expect(map.has("a")).toBe(false);
      expect(map.has("b")).toBe(true);
      expect(map.size).toBe(1);
    });

    it("should handle sequential evictions correctly", () => {
      // Arrange
      const map = new LruMap<string, number>(3);

      // Fill the map
      map.set("a", 1);
      map.set("b", 2);
      map.set("c", 3);

      // Add more entries, each evicting the oldest
      map.set("d", 4); // evicts "a"
      map.set("e", 5); // evicts "b"
      map.set("f", 6); // evicts "c"

      // Assert
      expect(map.has("a")).toBe(false);
      expect(map.has("b")).toBe(false);
      expect(map.has("c")).toBe(false);
      expect(map.has("d")).toBe(true);
      expect(map.has("e")).toBe(true);
      expect(map.has("f")).toBe(true);
      expect(map.size).toBe(3);
    });

    it("should return the map instance (chainable)", () => {
      const map = new LruMap<string, number>(5);
      const result = map.set("a", 1);
      expect(result).toBe(map);
    });
  });

  // ========== Inherited Map behavior ==========

  describe("inherited Map methods", () => {
    it("should support get()", () => {
      const map = new LruMap<string, string>(5);
      map.set("hello", "world");
      expect(map.get("hello")).toBe("world");
    });

    it("should return undefined for missing keys", () => {
      const map = new LruMap<string, string>(5);
      expect(map.get("nonexistent")).toBeUndefined();
    });

    it("should support has()", () => {
      const map = new LruMap<string, number>(5);
      map.set("key", 1);
      expect(map.has("key")).toBe(true);
      expect(map.has("missing")).toBe(false);
    });

    it("should support delete()", () => {
      const map = new LruMap<string, number>(5);
      map.set("key", 1);
      map.delete("key");
      expect(map.has("key")).toBe(false);
      expect(map.size).toBe(0);
    });

    it("should support clear()", () => {
      const map = new LruMap<string, number>(5);
      map.set("a", 1);
      map.set("b", 2);
      map.clear();
      expect(map.size).toBe(0);
    });

    it("should support forEach()", () => {
      const map = new LruMap<string, number>(5);
      map.set("a", 1);
      map.set("b", 2);

      const entries: Array<[string, number]> = [];
      map.forEach((value, key) => entries.push([key, value]));

      expect(entries).toEqual([
        ["a", 1],
        ["b", 2],
      ]);
    });

    it("should support iteration with for...of", () => {
      const map = new LruMap<string, number>(5);
      map.set("x", 10);
      map.set("y", 20);

      const entries: Array<[string, number]> = [];
      for (const [k, v] of map) {
        entries.push([k, v]);
      }

      expect(entries).toEqual([
        ["x", 10],
        ["y", 20],
      ]);
    });

    it("should support keys()", () => {
      const map = new LruMap<string, number>(5);
      map.set("a", 1);
      map.set("b", 2);
      expect([...map.keys()]).toEqual(["a", "b"]);
    });

    it("should support values()", () => {
      const map = new LruMap<string, number>(5);
      map.set("a", 1);
      map.set("b", 2);
      expect([...map.values()]).toEqual([1, 2]);
    });

    it("should support entries()", () => {
      const map = new LruMap<string, number>(5);
      map.set("a", 1);
      expect([...map.entries()]).toEqual([["a", 1]]);
    });

    it("should be instanceof Map", () => {
      const map = new LruMap<string, number>(5);
      expect(map instanceof Map).toBe(true);
    });
  });

  // ========== Generic types ==========

  describe("generic type support", () => {
    it("should work with number keys", () => {
      const map = new LruMap<number, string>(3);
      map.set(1, "one");
      map.set(2, "two");
      expect(map.get(1)).toBe("one");
    });

    it("should work with object values", () => {
      const map = new LruMap<string, { id: number; name: string }>(3);
      map.set("user1", { id: 1, name: "Alice" });
      expect(map.get("user1")).toEqual({ id: 1, name: "Alice" });
    });

    it("should work with symbol keys", () => {
      const key = Symbol("test");
      const map = new LruMap<symbol, number>(3);
      map.set(key, 42);
      expect(map.get(key)).toBe(42);
    });
  });

  // ========== Edge cases ==========

  describe("edge cases", () => {
    it("should handle adding the same key repeatedly without growing", () => {
      const map = new LruMap<string, number>(3);
      map.set("a", 1);
      map.set("a", 2);
      map.set("a", 3);
      map.set("a", 4);

      expect(map.size).toBe(1);
      expect(map.get("a")).toBe(4);
    });

    it("should not evict when size stays within limit", () => {
      const map = new LruMap<string, number>(10);
      for (let i = 0; i < 10; i++) {
        map.set(`key${i}`, i);
      }

      expect(map.size).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(map.has(`key${i}`)).toBe(true);
      }
    });
  });
});
