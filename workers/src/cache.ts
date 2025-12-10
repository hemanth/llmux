import type { Env, ChatCompletionRequest, ChatCompletionResponse } from './types.js';

/**
 * Generate a cache key from request
 */
export function generateCacheKey(request: ChatCompletionRequest): string {
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

  // Use Web Crypto API for Workers
  const json = JSON.stringify(keyData);
  // Simple hash for Workers (crypto.subtle is async, so we use a simpler approach)
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `llmux:${Math.abs(hash).toString(16)}:${json.length}`;
}

/**
 * Get cached response from KV
 */
export async function getFromCache(
  env: Env,
  request: ChatCompletionRequest
): Promise<ChatCompletionResponse | null> {
  if (!env.CACHE) return null;
  if (request.cache === false) return null;

  const key = generateCacheKey(request);

  try {
    const cached = await env.CACHE.get(key, 'json');
    if (cached) {
      return { ...(cached as ChatCompletionResponse), cached: true };
    }
  } catch {
    // Ignore cache errors
  }

  return null;
}

/**
 * Store response in KV cache
 */
export async function setInCache(
  env: Env,
  request: ChatCompletionRequest,
  response: ChatCompletionResponse
): Promise<void> {
  if (!env.CACHE) return;
  if (request.cache === false) return;
  if (request.stream) return;

  const key = generateCacheKey(request);
  const ttl = parseInt(env.CACHE_TTL || '3600', 10);

  try {
    await env.CACHE.put(key, JSON.stringify(response), { expirationTtl: ttl });
  } catch {
    // Ignore cache errors
  }
}
