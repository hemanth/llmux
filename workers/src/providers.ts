import type { Env, ProviderConfig, ChatCompletionRequest, ChatCompletionResponse } from './types.js';

// Provider definitions
const PROVIDER_CONFIGS: Record<string, Omit<ProviderConfig, 'apiKey'>> = {
  groq: {
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    timeout: 30000,
  },
  together: {
    name: 'together',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.1-70B-Instruct-Turbo', 'meta-llama/Llama-3.1-8B-Instruct-Turbo'],
    timeout: 60000,
  },
  cerebras: {
    name: 'cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['llama3.1-70b', 'llama3.1-8b'],
    timeout: 30000,
  },
  sambanova: {
    name: 'sambanova',
    baseUrl: 'https://api.sambanova.ai/v1',
    models: ['Meta-Llama-3.1-70B-Instruct', 'Meta-Llama-3.1-8B-Instruct'],
    timeout: 30000,
  },
  openrouter: {
    name: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['meta-llama/llama-3.1-70b-instruct', 'anthropic/claude-3.5-sonnet'],
    timeout: 60000,
  },
};

// Model aliases - map friendly names to provider-specific models
const MODEL_ALIASES: Record<string, Record<string, string>> = {
  'llama-70b': {
    groq: 'llama-3.1-70b-versatile',
    together: 'meta-llama/Llama-3.1-70B-Instruct-Turbo',
    cerebras: 'llama3.1-70b',
    sambanova: 'Meta-Llama-3.1-70B-Instruct',
    openrouter: 'meta-llama/llama-3.1-70b-instruct',
  },
  'llama-8b': {
    groq: 'llama-3.1-8b-instant',
    together: 'meta-llama/Llama-3.1-8B-Instruct-Turbo',
    cerebras: 'llama3.1-8b',
    sambanova: 'Meta-Llama-3.1-8B-Instruct',
    openrouter: 'meta-llama/llama-3.1-8b-instruct',
  },
};

export function getEnabledProviders(env: Env): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  if (env.GROQ_API_KEY) {
    providers.push({ ...PROVIDER_CONFIGS.groq, apiKey: env.GROQ_API_KEY });
  }
  if (env.TOGETHER_API_KEY) {
    providers.push({ ...PROVIDER_CONFIGS.together, apiKey: env.TOGETHER_API_KEY });
  }
  if (env.CEREBRAS_API_KEY) {
    providers.push({ ...PROVIDER_CONFIGS.cerebras, apiKey: env.CEREBRAS_API_KEY });
  }
  if (env.SAMBANOVA_API_KEY) {
    providers.push({ ...PROVIDER_CONFIGS.sambanova, apiKey: env.SAMBANOVA_API_KEY });
  }
  if (env.OPENROUTER_API_KEY) {
    providers.push({ ...PROVIDER_CONFIGS.openrouter, apiKey: env.OPENROUTER_API_KEY });
  }

  return providers;
}

export function resolveModelAlias(model: string, providerName: string): string {
  if (MODEL_ALIASES[model]?.[providerName]) {
    return MODEL_ALIASES[model][providerName];
  }
  return model;
}

export function providerSupportsModel(provider: ProviderConfig, model: string): boolean {
  return provider.models.includes(model);
}

export async function callProvider(
  provider: ProviderConfig,
  request: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  const { provider: _, cache: __, ...body } = request;

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: false }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Provider ${provider.name} error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as ChatCompletionResponse;
  return { ...data, provider: provider.name };
}

export async function streamProvider(
  provider: ProviderConfig,
  request: ChatCompletionRequest
): Promise<Response> {
  const { provider: _, cache: __, ...body } = request;

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Provider ${provider.name} stream error: ${response.status} - ${errorText}`);
  }

  // Return the streaming response directly
  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
