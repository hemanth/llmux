import type { Env, ProviderConfig, ChatCompletionRequest, ChatCompletionResponse } from './types.js';
import { getEnabledProviders, resolveModelAlias, providerSupportsModel, callProvider, streamProvider } from './providers.js';

type Strategy = 'round-robin' | 'random' | 'first-available';

// Simple in-memory round-robin state (resets per worker instance)
const roundRobinIndex = new Map<string, number>();

function getProviderOrder(
  providers: ProviderConfig[],
  request: ChatCompletionRequest,
  env: Env
): ProviderConfig[] {
  // If specific provider requested
  if (request.provider) {
    const provider = providers.find(p => p.name === request.provider);
    return provider ? [provider] : [];
  }

  // Get fallback chain from env or use all providers
  const fallbackChain = env.FALLBACK_CHAIN?.split(',').map(s => s.trim()) || providers.map(p => p.name);

  // Filter to providers in fallback chain order
  const ordered = fallbackChain
    .map(name => providers.find(p => p.name === name))
    .filter((p): p is ProviderConfig => p !== undefined);

  const strategy = (env.DEFAULT_STRATEGY || 'round-robin') as Strategy;

  switch (strategy) {
    case 'random':
      return shuffleArray([...ordered]);

    case 'round-robin': {
      const key = request.model;
      const idx = roundRobinIndex.get(key) || 0;
      roundRobinIndex.set(key, (idx + 1) % ordered.length);
      return [...ordered.slice(idx), ...ordered.slice(0, idx)];
    }

    case 'first-available':
    default:
      return ordered;
  }
}

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export async function routeChatCompletion(
  env: Env,
  request: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  const providers = getEnabledProviders(env);

  if (providers.length === 0) {
    throw new Error('No providers configured');
  }

  const orderedProviders = getProviderOrder(providers, request, env);

  if (orderedProviders.length === 0) {
    throw new Error('No providers available for this request');
  }

  let lastError: Error | null = null;

  for (const provider of orderedProviders) {
    const resolvedModel = resolveModelAlias(request.model, provider.name);

    if (!providerSupportsModel(provider, resolvedModel)) {
      continue;
    }

    try {
      const response = await callProvider(provider, {
        ...request,
        model: resolvedModel,
      });
      return response;
    } catch (error) {
      lastError = error as Error;
      console.error(`Provider ${provider.name} failed:`, lastError.message);
    }
  }

  throw new Error(`All providers failed. Last error: ${lastError?.message || 'Unknown'}`);
}

export async function routeChatCompletionStream(
  env: Env,
  request: ChatCompletionRequest
): Promise<Response> {
  const providers = getEnabledProviders(env);

  if (providers.length === 0) {
    throw new Error('No providers configured');
  }

  const orderedProviders = getProviderOrder(providers, request, env);

  if (orderedProviders.length === 0) {
    throw new Error('No providers available for this request');
  }

  let lastError: Error | null = null;

  for (const provider of orderedProviders) {
    const resolvedModel = resolveModelAlias(request.model, provider.name);

    if (!providerSupportsModel(provider, resolvedModel)) {
      continue;
    }

    try {
      return await streamProvider(provider, {
        ...request,
        model: resolvedModel,
      });
    } catch (error) {
      lastError = error as Error;
      console.error(`Provider ${provider.name} stream failed:`, lastError.message);
    }
  }

  throw new Error(`All providers failed for streaming. Last error: ${lastError?.message || 'Unknown'}`);
}
