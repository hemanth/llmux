import { createHash } from 'node:crypto';
import { MemoryCache } from './memory.js';
import { RedisCache } from './redis.js';
import type { Cache, CacheConfig, ChatCompletionRequest, ChatCompletionResponse } from '../types.js';
import { getLogger } from '../utils/logger.js';

export { MemoryCache } from './memory.js';
export { RedisCache } from './redis.js';

/**
 * Create a cache instance based on configuration
 */
export function createCache(config: CacheConfig): Cache | null {
  if (!config.enabled) {
    getLogger().info('Caching disabled');
    return null;
  }

  switch (config.backend) {
    case 'redis':
      return new RedisCache(
        config.redis.url,
        config.redis.ttl,
        config.redis.key_prefix
      );

    case 'memory':
    default:
      return new MemoryCache(
        config.memory.max_items,
        config.memory.ttl
      );
  }
}

/**
 * Generate a cache key from a chat completion request
 * Uses deterministic hashing of relevant request parameters
 */
export function generateCacheKey(request: ChatCompletionRequest): string {
  // Include fields that affect the response
  const keyData = {
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    top_p: request.top_p,
    max_tokens: request.max_tokens,
    stop: request.stop,
    presence_penalty: request.presence_penalty,
    frequency_penalty: request.frequency_penalty,
  };

  const json = JSON.stringify(keyData);
  const hash = createHash('sha256').update(json).digest('hex');

  return hash;
}

/**
 * Cache manager that handles caching logic for chat completions
 */
export class CacheManager {
  private cache: Cache | null;
  private enabled: boolean;

  constructor(config: CacheConfig) {
    this.enabled = config.enabled;
    this.cache = createCache(config);
  }

  isEnabled(): boolean {
    return this.enabled && this.cache !== null;
  }

  /**
   * Try to get a cached response
   */
  async get(request: ChatCompletionRequest): Promise<ChatCompletionResponse | null> {
    if (!this.isEnabled()) return null;

    // Respect per-request cache override
    if (request.cache === false) return null;

    const key = generateCacheKey(request);
    return this.cache!.get(key);
  }

  /**
   * Cache a response
   */
  async set(request: ChatCompletionRequest, response: ChatCompletionResponse): Promise<void> {
    if (!this.isEnabled()) return;

    // Don't cache if request explicitly disabled caching
    if (request.cache === false) return;

    // Don't cache streaming responses (they come through differently)
    if (request.stream) return;

    const key = generateCacheKey(request);
    await this.cache!.set(key, response);
  }

  /**
   * Clear the cache
   */
  async clear(): Promise<void> {
    if (this.cache) {
      await this.cache.clear();
    }
  }
}
