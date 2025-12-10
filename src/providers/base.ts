import { request } from 'undici';
import { getLogger } from '../utils/logger.js';
import type {
  Provider,
  ProviderConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../types.js';

export class BaseProvider implements Provider {
  name: string;
  config: ProviderConfig;

  constructor(name: string, config: ProviderConfig) {
    this.name = name;
    this.config = config;
  }

  supportsModel(model: string): boolean {
    return this.config.models.includes(model);
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Simple health check - try to hit the models endpoint
      const response = await request(`${this.config.base_url}/models`, {
        method: 'GET',
        headers: this.getHeaders(),
        headersTimeout: 5000,
        bodyTimeout: 5000,
      });
      return response.statusCode === 200;
    } catch {
      return false;
    }
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.api_key}`,
    };

    // Add any extra headers from config
    if (this.config.extra_headers) {
      Object.assign(headers, this.config.extra_headers);
    }

    return headers;
  }

  async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const logger = getLogger();
    const url = `${this.config.base_url}/chat/completions`;

    // Remove llmux-specific fields before sending to provider
    const { provider: _, cache: __, ...providerRequest } = req;

    logger.debug({ provider: this.name, model: req.model }, 'Sending chat completion request');

    const response = await request(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...providerRequest, stream: false }),
      headersTimeout: this.config.timeout,
      bodyTimeout: this.config.timeout,
    });

    if (response.statusCode !== 200) {
      const errorBody = await response.body.text();
      logger.error({ provider: this.name, status: response.statusCode, error: errorBody }, 'Provider error');
      throw new Error(`Provider ${this.name} returned ${response.statusCode}: ${errorBody}`);
    }

    const data = await response.body.json() as ChatCompletionResponse;

    // Add provider info to response
    return {
      ...data,
      provider: this.name,
    };
  }

  async *chatCompletionStream(req: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    const logger = getLogger();
    const url = `${this.config.base_url}/chat/completions`;

    // Remove llmux-specific fields before sending to provider
    const { provider: _, cache: __, ...providerRequest } = req;

    logger.debug({ provider: this.name, model: req.model }, 'Sending streaming chat completion request');

    const response = await request(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...providerRequest, stream: true }),
      headersTimeout: this.config.timeout,
      bodyTimeout: this.config.timeout,
    });

    if (response.statusCode !== 200) {
      const errorBody = await response.body.text();
      logger.error({ provider: this.name, status: response.statusCode, error: errorBody }, 'Provider stream error');
      throw new Error(`Provider ${this.name} returned ${response.statusCode}: ${errorBody}`);
    }

    // Parse SSE stream
    let buffer = '';

    for await (const chunk of response.body) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith(':')) {
          continue;
        }

        if (trimmed === 'data: [DONE]') {
          return;
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr) as ChatCompletionChunk;
            yield parsed;
          } catch (e) {
            logger.warn({ line: trimmed }, 'Failed to parse SSE chunk');
          }
        }
      }
    }
  }
}
