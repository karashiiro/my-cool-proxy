import { injectable } from "inversify";
import { $inject } from "../container/decorators.js";
import { TYPES } from "../types/index.js";
import type { ICacheService, ILogger } from "../types/interfaces.js";

/**
 * In-memory cache service that stores values with timestamps.
 *
 * This service provides a reusable caching abstraction that can be used
 * throughout the application. It stores values in memory with optional
 * time-to-live (TTL) support.
 *
 * Features:
 * - Generic type support for any cacheable value
 * - Optional TTL for automatic cache expiration
 * - Timestamp tracking for cache entries
 * - Simple Map-based storage
 *
 * Benefits of this abstraction:
 * - DRY - cache logic defined once
 * - Consistent caching behavior across the application
 * - Easy to swap implementations (e.g., Redis, LRU cache)
 * - Easier to test (can inject mock cache)
 */
@injectable()
export class MemoryCacheService<T> implements ICacheService<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private ttl?: number;

  constructor(@$inject(TYPES.Logger) private logger: ILogger) {
    // TTL can be configured per-instance if needed
    // For now, no TTL by default (cache never expires)
    this.ttl = undefined;
  }

  /**
   * Get a value from the cache.
   *
   * Returns undefined if:
   * - Key doesn't exist
   * - Entry has expired (based on TTL)
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check TTL if configured
    if (this.ttl && Date.now() - entry.timestamp > this.ttl) {
      this.logger.debug(`Cache entry expired for key: ${key}`);
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value in the cache with current timestamp.
   */
  set(key: string, value: T): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Delete a specific cache entry.
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Check if a key exists in the cache (and hasn't expired).
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check TTL
    if (this.ttl && Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Set TTL for this cache instance.
   * This allows configuring TTL after construction.
   */
  setTTL(ttl: number): void {
    this.ttl = ttl;
  }
}

/**
 * Factory function to create cache instances without DI.
 * Useful for creating cache instances within classes that aren't
 * managed by the DI container or need multiple cache instances.
 */
export function createCache<T>(logger: ILogger): ICacheService<T> {
  const cache = new MemoryCacheService<T>(logger);
  return cache;
}
