import { getLogger } from './utils/logger.js';
import { ProviderRegistry } from './providers/index.js';
import type {
  Config,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from './types.js';

export type RoutingStrategy = 'round-robin' | 'random' | 'first-available' | 'latency';

export class Router {
  private registry: ProviderRegistry;
  private config: Config;
  private roundRobinIndex: Map<string, number> = new Map();

  constructor(registry: ProviderRegistry, config: Config) {
    this.registry = registry;
    this.config = config;
  }

  /**
   * Resolve model alias to provider-specific model name
   */
  resolveModelAlias(model: string, providerName: string): string {
    const aliases = this.config.routing.model_aliases;
    if (aliases && aliases[model] && aliases[model][providerName]) {
      return aliases[model][providerName];
    }
    return model;
  }

  /**
   * Get ordered list of providers to try for a request
   */
  getProviderOrder(request: ChatCompletionRequest): string[] {
    // If specific provider requested, use only that
    if (request.provider) {
      return this.registry.has(request.provider) ? [request.provider] : [];
    }

    const strategy = this.config.routing.default_strategy;
    const fallbackChain = this.config.routing.fallback_chain;

    // Filter to enabled providers in fallback chain
    const availableProviders = fallbackChain.filter(name => this.registry.has(name));

    switch (strategy) {
      case 'round-robin':
        return this.roundRobinOrder(availableProviders, request.model);

      case 'random':
        return this.shuffleArray([...availableProviders]);

      case 'first-available':
      default:
        return availableProviders;
    }
  }

  private roundRobinOrder(providers: string[], model: string): string[] {
    const key = model;
    const currentIndex = this.roundRobinIndex.get(key) || 0;

    // Rotate array starting from current index
    const rotated = [
      ...providers.slice(currentIndex),
      ...providers.slice(0, currentIndex),
    ];

    // Update index for next request
    this.roundRobinIndex.set(key, (currentIndex + 1) % providers.length);

    return rotated;
  }

  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Route a chat completion request with fallback
   */
  async routeChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const logger = getLogger();
    const providerOrder = this.getProviderOrder(request);

    if (providerOrder.length === 0) {
      throw new Error('No providers available for this request');
    }

    let lastError: Error | null = null;

    for (const providerName of providerOrder) {
      const provider = this.registry.get(providerName);
      if (!provider) continue;

      // Resolve model alias for this provider
      const resolvedModel = this.resolveModelAlias(request.model, providerName);

      // Check if provider supports this model
      if (!provider.supportsModel(resolvedModel)) {
        logger.debug(
          { provider: providerName, model: resolvedModel },
          'Provider does not support model, trying next'
        );
        continue;
      }

      try {
        logger.info({ provider: providerName, model: resolvedModel }, 'Routing request to provider');

        const response = await provider.chatCompletion({
          ...request,
          model: resolvedModel,
        });

        return response;
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          { provider: providerName, error: lastError.message },
          'Provider failed, trying fallback'
        );
      }
    }

    throw new Error(
      `All providers failed. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Route a streaming chat completion request
   * Note: Fallback is attempted only before streaming starts
   */
  async *routeChatCompletionStream(
    request: ChatCompletionRequest
  ): AsyncIterable<ChatCompletionChunk> {
    const logger = getLogger();
    const providerOrder = this.getProviderOrder(request);

    if (providerOrder.length === 0) {
      throw new Error('No providers available for this request');
    }

    let lastError: Error | null = null;

    for (const providerName of providerOrder) {
      const provider = this.registry.get(providerName);
      if (!provider) continue;

      const resolvedModel = this.resolveModelAlias(request.model, providerName);

      if (!provider.supportsModel(resolvedModel)) {
        logger.debug(
          { provider: providerName, model: resolvedModel },
          'Provider does not support model, trying next'
        );
        continue;
      }

      try {
        logger.info({ provider: providerName, model: resolvedModel }, 'Routing stream request to provider');

        // Once streaming starts, we commit to this provider
        for await (const chunk of provider.chatCompletionStream({
          ...request,
          model: resolvedModel,
        })) {
          yield chunk;
        }

        // Successfully streamed, exit
        return;
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          { provider: providerName, error: lastError.message },
          'Provider stream failed, trying fallback'
        );
      }
    }

    throw new Error(
      `All providers failed for streaming. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }
}
