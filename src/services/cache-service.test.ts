import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TestBed } from "@suites/unit";
import { MemoryCacheService, createCache } from "./cache-service.js";
import { TYPES } from "../types/index.js";

describe("MemoryCacheService", () => {
  let cache: MemoryCacheService<string>;
  let logger: ReturnType<typeof unitRef.get>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let unitRef: any;

  beforeEach(async () => {
    const { unit, unitRef: ref } = await TestBed.solitary(
      MemoryCacheService<string>,
    ).compile();
    cache = unit;
    unitRef = ref;
    logger = unitRef.get(TYPES.Logger);
  });

  describe("basic operations", () => {
    it("should store and retrieve values", () => {
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    it("should return undefined for non-existent keys", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("should overwrite existing values", () => {
      cache.set("key1", "value1");
      cache.set("key1", "value2");
      expect(cache.get("key1")).toBe("value2");
    });

    it("should store multiple values", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      expect(cache.get("key1")).toBe("value1");
      expect(cache.get("key2")).toBe("value2");
      expect(cache.get("key3")).toBe("value3");
    });

    it("should store complex objects", () => {
      const complexObject = {
        name: "test",
        value: 123,
        nested: { foo: "bar" },
      };

      const objectCache = new MemoryCacheService<typeof complexObject>(logger);
      objectCache.set("complex", complexObject);

      expect(objectCache.get("complex")).toEqual(complexObject);
    });

    it("should store arrays", () => {
      const array = [1, 2, 3, 4, 5];
      const arrayCache = new MemoryCacheService<number[]>(logger);

      arrayCache.set("numbers", array);
      expect(arrayCache.get("numbers")).toEqual(array);
    });

    it("should store null values", () => {
      cache.set("null-key", null as unknown as string);
      expect(cache.get("null-key")).toBeNull();
    });

    it("should store undefined as a value", () => {
      cache.set("undefined-key", undefined as unknown as string);
      // Storing undefined should work, but get returns undefined for missing keys too
      expect(cache.get("undefined-key")).toBeUndefined();
    });
  });

  describe("delete operation", () => {
    it("should delete existing keys", () => {
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");

      cache.delete("key1");
      expect(cache.get("key1")).toBeUndefined();
    });

    it("should not throw when deleting non-existent keys", () => {
      expect(() => cache.delete("nonexistent")).not.toThrow();
    });

    it("should delete only the specified key", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.delete("key2");

      expect(cache.get("key1")).toBe("value1");
      expect(cache.get("key2")).toBeUndefined();
      expect(cache.get("key3")).toBe("value3");
    });

    it("should handle deleting the same key twice", () => {
      cache.set("key1", "value1");
      cache.delete("key1");
      cache.delete("key1"); // Should not throw

      expect(cache.get("key1")).toBeUndefined();
    });
  });

  describe("clear operation", () => {
    it("should clear all entries", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      cache.clear();

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
      expect(cache.get("key3")).toBeUndefined();
    });

    it("should not throw when clearing empty cache", () => {
      expect(() => cache.clear()).not.toThrow();
    });

    it("should allow adding entries after clear", () => {
      cache.set("key1", "value1");
      cache.clear();

      cache.set("key2", "value2");
      expect(cache.get("key2")).toBe("value2");
    });
  });

  describe("has operation", () => {
    it("should return true for existing keys", () => {
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);
    });

    it("should return false for non-existent keys", () => {
      expect(cache.has("nonexistent")).toBe(false);
    });

    it("should return false after deleting a key", () => {
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);

      cache.delete("key1");
      expect(cache.has("key1")).toBe(false);
    });

    it("should return false after clearing", () => {
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key2")).toBe(true);

      cache.clear();

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(false);
    });

    it("should handle multiple has calls", () => {
      cache.set("key1", "value1");

      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key1")).toBe(true);
    });
  });

  describe("TTL functionality", () => {
    beforeEach(() => {
      // Use vi.useFakeTimers() for time control
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should set TTL via constructor", () => {
      const ttlCache = new MemoryCacheService<string>(logger);
      ttlCache.setTTL(1000); // 1 second TTL

      ttlCache.set("key1", "value1");

      // Should exist immediately
      expect(ttlCache.get("key1")).toBe("value1");
      expect(ttlCache.has("key1")).toBe(true);

      // Fast forward 500ms - should still exist
      vi.advanceTimersByTime(500);
      expect(ttlCache.get("key1")).toBe("value1");
      expect(ttlCache.has("key1")).toBe(true);

      // Fast forward another 600ms (total 1100ms) - should be expired
      vi.advanceTimersByTime(600);
      expect(ttlCache.get("key1")).toBeUndefined();
      expect(ttlCache.has("key1")).toBe(false);
    });

    it("should expire entries after TTL in get()", () => {
      cache.setTTL(1000);
      cache.set("key1", "value1");

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      // get() should return undefined and delete the expired entry
      const result = cache.get("key1");
      expect(result).toBeUndefined();

      // Should log the expiration
      expect(logger.debug).toHaveBeenCalledWith(
        "Cache entry expired for key: key1",
      );
    });

    it("should expire entries after TTL in has()", () => {
      cache.setTTL(1000);
      cache.set("key1", "value1");

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      // has() should return false and delete the expired entry
      const result = cache.has("key1");
      expect(result).toBe(false);

      // get() should also return undefined (entry was deleted by has())
      expect(cache.get("key1")).toBeUndefined();
    });

    it("should not expire entries before TTL", () => {
      cache.setTTL(2000);
      cache.set("key1", "value1");

      // Advance time but not past TTL
      vi.advanceTimersByTime(1000);

      expect(cache.get("key1")).toBe("value1");
      expect(cache.has("key1")).toBe(true);
    });

    it("should handle multiple entries with different ages", () => {
      cache.setTTL(1000);

      cache.set("key1", "value1");
      vi.advanceTimersByTime(500);

      cache.set("key2", "value2");
      vi.advanceTimersByTime(300); // key1 is at 800ms, key2 is at 300ms

      // Both should still exist
      expect(cache.get("key1")).toBe("value1");
      expect(cache.get("key2")).toBe("value2");

      // Advance another 300ms (key1 at 1100ms - expired, key2 at 600ms - valid)
      vi.advanceTimersByTime(300);

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBe("value2");
    });

    it("should update timestamp when overwriting existing entry", () => {
      cache.setTTL(1000);

      cache.set("key1", "value1");
      vi.advanceTimersByTime(800);

      // Overwrite the entry - should reset the TTL
      cache.set("key1", "value2");
      vi.advanceTimersByTime(500); // Total time for original: 1300ms, for new: 500ms

      // Should still exist because the timestamp was updated
      expect(cache.get("key1")).toBe("value2");

      // Now advance past the new TTL
      vi.advanceTimersByTime(600);
      expect(cache.get("key1")).toBeUndefined();
    });

    it("should allow changing TTL dynamically", () => {
      cache.setTTL(1000);
      cache.set("key1", "value1");

      vi.advanceTimersByTime(500);

      // Change TTL to 200ms (from now, not from original time)
      cache.setTTL(200);
      vi.advanceTimersByTime(300);

      // Should be expired based on new TTL
      expect(cache.get("key1")).toBeUndefined();
    });

    it("should treat zero TTL as no expiration (0 is falsy)", () => {
      cache.setTTL(0);
      cache.set("key1", "value1");

      // With TTL = 0, the TTL check is skipped because 0 is falsy
      // So entries don't expire
      vi.advanceTimersByTime(1000);

      expect(cache.get("key1")).toBe("value1");
      expect(cache.has("key1")).toBe(true);
    });

    it("should handle very short TTLs", () => {
      cache.setTTL(10); // 10ms
      cache.set("key1", "value1");

      vi.advanceTimersByTime(15);

      expect(cache.get("key1")).toBeUndefined();
    });
  });

  describe("TTL edge cases", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should not expire entries when TTL is undefined", () => {
      // Default cache has no TTL
      cache.set("key1", "value1");

      // Advance time significantly
      vi.advanceTimersByTime(999999);

      // Should still exist because no TTL is set
      expect(cache.get("key1")).toBe("value1");
      expect(cache.has("key1")).toBe(true);
    });

    it("should handle calling setTTL multiple times", () => {
      cache.setTTL(1000);
      cache.set("key1", "value1");

      vi.advanceTimersByTime(500);

      // Update TTL
      cache.setTTL(2000);
      vi.advanceTimersByTime(600);

      // Should still exist (600ms < 2000ms new TTL)
      expect(cache.get("key1")).toBe("value1");
    });

    it("should log expiration for each expired key", () => {
      cache.setTTL(1000);

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      cache.set("key3", "value3");

      vi.advanceTimersByTime(1500);

      // Trigger expiration for all keys
      cache.get("key1");
      cache.get("key2");
      cache.get("key3");

      expect(logger.debug).toHaveBeenCalledTimes(3);
      expect(logger.debug).toHaveBeenNthCalledWith(
        1,
        "Cache entry expired for key: key1",
      );
      expect(logger.debug).toHaveBeenNthCalledWith(
        2,
        "Cache entry expired for key: key2",
      );
      expect(logger.debug).toHaveBeenNthCalledWith(
        3,
        "Cache entry expired for key: key3",
      );
    });

    it("should delete expired entry when TTL is checked in has()", () => {
      cache.setTTL(1000);
      cache.set("key1", "value1");

      vi.advanceTimersByTime(1500);

      // has() should delete the expired entry
      cache.has("key1");

      // Subsequent get() should not log expiration (already deleted)
      const callCountBefore = (logger.debug as ReturnType<typeof vi.fn>).mock
        .calls.length;
      const result = cache.get("key1");

      expect(result).toBeUndefined();
      expect((logger.debug as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        callCountBefore,
      );
    });
  });

  describe("createCache factory function", () => {
    it("should create a cache instance", () => {
      const cache = createCache<string>(logger);

      expect(cache).toBeDefined();
      expect(cache.set).toBeDefined();
      expect(cache.get).toBeDefined();
      expect(cache.delete).toBeDefined();
      expect(cache.has).toBeDefined();
      expect(cache.clear).toBeDefined();
    });

    it("should create a functional cache instance", () => {
      const cache = createCache<number>(logger);

      cache.set("test", 42);
      expect(cache.get("test")).toBe(42);
      expect(cache.has("test")).toBe(true);

      cache.delete("test");
      expect(cache.has("test")).toBe(false);
    });
  });

  describe("type safety", () => {
    it("should maintain type safety for string values", () => {
      const stringCache = new MemoryCacheService<string>(logger);

      stringCache.set("key", "string value");
      const value = stringCache.get("key");

      // TypeScript should know this is string | undefined
      expect(value).toBeTypeOf("string");
    });

    it("should maintain type safety for number values", () => {
      const numberCache = new MemoryCacheService<number>(logger);

      numberCache.set("key", 42);
      const value = numberCache.get("key");

      expect(value).toBeTypeOf("number");
    });

    it("should maintain type safety for custom objects", () => {
      interface CustomObject {
        id: number;
        name: string;
      }

      const objectCache = new MemoryCacheService<CustomObject>(logger);

      objectCache.set("key", { id: 1, name: "test" });
      const value = objectCache.get("key");

      expect(value?.id).toBe(1);
      expect(value?.name).toBe("test");
    });
  });

  describe("integration scenarios", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should handle typical cache usage pattern", () => {
      // Store a value
      cache.set("user:123", "user data");

      // Check if exists
      expect(cache.has("user:123")).toBe(true);

      // Retrieve value
      expect(cache.get("user:123")).toBe("user data");

      // Delete when done
      cache.delete("user:123");

      // Should be gone
      expect(cache.has("user:123")).toBe(false);
    });

    it("should handle cache-aside pattern with TTL", () => {
      cache.setTTL(5000);

      // Simulate cache miss
      let value = cache.get("expensive-data");
      expect(value).toBeUndefined();

      // Load data (simulated)
      const expensiveData = "computed value";
      cache.set("expensive-data", expensiveData);

      // Next call should hit cache
      value = cache.get("expensive-data");
      expect(value).toBe("computed value");

      // After TTL, should miss again
      vi.advanceTimersByTime(6000);
      value = cache.get("expensive-data");
      expect(value).toBeUndefined();
    });

    it("should handle multiple independent cache instances", () => {
      const cache1 = new MemoryCacheService<string>(logger);
      const cache2 = new MemoryCacheService<number>(logger);

      cache1.set("key", "string");
      cache2.set("key", 42);

      expect(cache1.get("key")).toBe("string");
      expect(cache2.get("key")).toBe(42);

      // Caches should be independent
      cache1.clear();
      expect(cache1.get("key")).toBeUndefined();
      expect(cache2.get("key")).toBe(42);
    });
  });
});
