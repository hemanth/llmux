import Redis from 'ioredis';
import type { Cache, ChatCompletionResponse } from '../types.js';
import { getLogger } from '../utils/logger.js';

export class RedisCache implements Cache {
  private client: Redis.default;
  private ttl: number;
  private keyPrefix: string;

  constructor(url: string, ttlSeconds: number = 3600, keyPrefix: string = 'llmux:') {
    this.client = new Redis.default(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
    this.ttl = ttlSeconds;
    this.keyPrefix = keyPrefix;

    this.client.on('error', (err: Error) => {
      getLogger().error({ error: err.message }, 'Redis connection error');
    });

    this.client.on('connect', () => {
      getLogger().info('Redis cache connected');
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  private prefixedKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<ChatCompletionResponse | null> {
    try {
      const value = await this.client.get(this.prefixedKey(key));
      if (value) {
        getLogger().debug({ key: key.slice(0, 32) + '...' }, 'Redis cache hit');
        const parsed = JSON.parse(value) as ChatCompletionResponse;
        return { ...parsed, cached: true };
      }
      getLogger().debug({ key: key.slice(0, 32) + '...' }, 'Redis cache miss');
      return null;
    } catch (error) {
      getLogger().warn({ error: (error as Error).message }, 'Redis get error');
      return null;
    }
  }

  async set(key: string, value: ChatCompletionResponse): Promise<void> {
    try {
      await this.client.setex(
        this.prefixedKey(key),
        this.ttl,
        JSON.stringify(value)
      );
      getLogger().debug({ key: key.slice(0, 32) + '...' }, 'Redis cache set');
    } catch (error) {
      getLogger().warn({ error: (error as Error).message }, 'Redis set error');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(this.prefixedKey(key));
    } catch (error) {
      getLogger().warn({ error: (error as Error).message }, 'Redis delete error');
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await this.client.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
      getLogger().info('Redis cache cleared');
    } catch (error) {
      getLogger().warn({ error: (error as Error).message }, 'Redis clear error');
    }
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}
