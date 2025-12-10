import { BaseProvider } from './base.js';
import type { Config, Provider } from '../types.js';
import { getLogger } from '../utils/logger.js';

// Provider-specific implementations can extend BaseProvider
// For now, all providers use the standard OpenAI-compatible API

class GroqProvider extends BaseProvider {
  constructor(config: Config['providers']['groq']) {
    super('groq', config);
  }
}

class TogetherProvider extends BaseProvider {
  constructor(config: Config['providers']['together']) {
    super('together', config);
  }
}

class CerebrasProvider extends BaseProvider {
  constructor(config: Config['providers']['cerebras']) {
    super('cerebras', config);
  }
}

class SambanovaProvider extends BaseProvider {
  constructor(config: Config['providers']['sambanova']) {
    super('sambanova', config);
  }
}

class OpenRouterProvider extends BaseProvider {
  constructor(config: Config['providers']['openrouter']) {
    super('openrouter', config);
  }
}

// Generic provider for any OpenAI-compatible API
class GenericProvider extends BaseProvider {
  constructor(name: string, config: Config['providers'][string]) {
    super(name, config);
  }
}

const PROVIDER_CLASSES: Record<string, new (config: Config['providers'][string]) => Provider> = {
  groq: GroqProvider,
  together: TogetherProvider,
  cerebras: CerebrasProvider,
  sambanova: SambanovaProvider,
  openrouter: OpenRouterProvider,
};

export class ProviderRegistry {
  private providers: Map<string, Provider> = new Map();

  constructor(config: Config) {
    const logger = getLogger();

    for (const [name, providerConfig] of Object.entries(config.providers)) {
      if (!providerConfig.enabled) {
        logger.debug({ provider: name }, 'Provider disabled, skipping');
        continue;
      }

      if (!providerConfig.api_key) {
        logger.warn({ provider: name }, 'Provider enabled but no API key configured, skipping');
        continue;
      }

      const ProviderClass = PROVIDER_CLASSES[name] || GenericProvider;
      const provider = name in PROVIDER_CLASSES
        ? new ProviderClass(providerConfig)
        : new GenericProvider(name, providerConfig);

      this.providers.set(name, provider);
      logger.info({ provider: name, models: providerConfig.models.length }, 'Provider registered');
    }
  }

  get(name: string): Provider | undefined {
    return this.providers.get(name);
  }

  getAll(): Provider[] {
    return Array.from(this.providers.values());
  }

  getNames(): string[] {
    return Array.from(this.providers.keys());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Find providers that support a given model
   */
  findByModel(model: string): Provider[] {
    return this.getAll().filter(p => p.supportsModel(model));
  }
}
