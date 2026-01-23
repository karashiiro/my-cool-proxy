import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryCacheService, createCache } from "./cache-service.js";
import type { ILogger } from "./types.js";

// Mock logger factory
const createMockLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe("MemoryCacheService", () => {
  let cache: MemoryCacheService<string>;
  let logger: ILogger;

  beforeEach(() => {
    logger = createMockLogger();
    cache = new MemoryCacheService<string>(logger);
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
  });

  describe("TTL functionality", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should set TTL via setTTL", () => {
      cache.setTTL(1000); // 1 second TTL

      cache.set("key1", "value1");

      // Should exist immediately
      expect(cache.get("key1")).toBe("value1");
      expect(cache.has("key1")).toBe(true);

      // Fast forward 500ms - should still exist
      vi.advanceTimersByTime(500);
      expect(cache.get("key1")).toBe("value1");

      // Fast forward another 600ms (total 1100ms) - should be expired
      vi.advanceTimersByTime(600);
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.has("key1")).toBe(false);
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

    it("should not expire entries before TTL", () => {
      cache.setTTL(2000);
      cache.set("key1", "value1");

      // Advance time but not past TTL
      vi.advanceTimersByTime(1000);

      expect(cache.get("key1")).toBe("value1");
      expect(cache.has("key1")).toBe(true);
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
  });

  describe("createCache factory function", () => {
    it("should create a cache instance", () => {
      const factoryCache = createCache<string>(logger);

      expect(factoryCache).toBeDefined();
      expect(factoryCache.set).toBeDefined();
      expect(factoryCache.get).toBeDefined();
      expect(factoryCache.delete).toBeDefined();
      expect(factoryCache.has).toBeDefined();
      expect(factoryCache.clear).toBeDefined();
    });

    it("should create a functional cache instance", () => {
      const factoryCache = createCache<number>(logger);

      factoryCache.set("test", 42);
      expect(factoryCache.get("test")).toBe(42);
      expect(factoryCache.has("test")).toBe(true);

      factoryCache.delete("test");
      expect(factoryCache.has("test")).toBe(false);
    });
  });
});
