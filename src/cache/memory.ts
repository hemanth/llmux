import { LRUCache } from 'lru-cache';
import type { Cache, ChatCompletionResponse } from '../types.js';
import { getLogger } from '../utils/logger.js';

export class MemoryCache implements Cache {
  private cache: LRUCache<string, ChatCompletionResponse>;

  constructor(maxItems: number = 1000, ttlSeconds: number = 3600) {
    this.cache = new LRUCache<string, ChatCompletionResponse>({
      max: maxItems,
      ttl: ttlSeconds * 1000,
    });

    getLogger().info({ maxItems, ttlSeconds }, 'Memory cache initialized');
  }

  async get(key: string): Promise<ChatCompletionResponse | null> {
    const value = this.cache.get(key);
    if (value) {
      getLogger().debug({ key: key.slice(0, 32) + '...' }, 'Cache hit');
      return { ...value, cached: true };
    }
    getLogger().debug({ key: key.slice(0, 32) + '...' }, 'Cache miss');
    return null;
  }

  async set(key: string, value: ChatCompletionResponse): Promise<void> {
    this.cache.set(key, value);
    getLogger().debug({ key: key.slice(0, 32) + '...' }, 'Cache set');
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
    getLogger().info('Memory cache cleared');
  }

  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.cache.max,
    };
  }
}
