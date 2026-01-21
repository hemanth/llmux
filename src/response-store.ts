// Response Store for previous_response_id support
// Uses in-memory LRU cache for simplicity

import { LRUCache } from 'lru-cache';
import type { Response, InputItem } from './open-responses-types.js';

export interface StoredResponse {
    response: Response;
    input: InputItem[];
}

export class ResponseStore {
    private cache: LRUCache<string, StoredResponse>;

    constructor(maxSize: number = 1000, ttlMs: number = 3600000) {
        this.cache = new LRUCache({
            max: maxSize,
            ttl: ttlMs, // Default 1 hour
        });
    }

    async get(id: string): Promise<StoredResponse | null> {
        return this.cache.get(id) || null;
    }

    async set(id: string, response: Response, input: InputItem[]): Promise<void> {
        this.cache.set(id, { response, input });
    }

    async delete(id: string): Promise<void> {
        this.cache.delete(id);
    }

    async clear(): Promise<void> {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}
