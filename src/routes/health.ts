import type { FastifyInstance } from 'fastify';
import { ProviderRegistry } from '../providers/index.js';

interface HealthRouteOptions {
  registry: ProviderRegistry;
}

export async function healthRoutes(
  fastify: FastifyInstance,
  options: HealthRouteOptions
): Promise<void> {
  const { registry } = options;

  // GET /health - Basic health check
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  // GET /health/providers - Provider health status
  fastify.get('/health/providers', async () => {
    const providers = registry.getAll();
    const status: Record<string, { healthy: boolean; models: string[] }> = {};

    await Promise.all(
      providers.map(async (provider) => {
        const healthy = await provider.isHealthy();
        status[provider.name] = {
          healthy,
          models: provider.config.models,
        };
      })
    );

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      providers: status,
    };
  });

  // GET /v1/models - OpenAI-compatible models endpoint
  fastify.get('/v1/models', async () => {
    const providers = registry.getAll();
    const models: Array<{
      id: string;
      object: 'model';
      created: number;
      owned_by: string;
    }> = [];

    for (const provider of providers) {
      for (const model of provider.config.models) {
        models.push({
          id: model,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: provider.name,
        });
      }
    }

    return {
      object: 'list',
      data: models,
    };
  });
}
