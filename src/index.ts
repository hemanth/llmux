import 'dotenv/config';
import Fastify from 'fastify';
import { loadConfig } from './utils/config.js';
import { createLogger } from './utils/logger.js';
import { ProviderRegistry } from './providers/index.js';
import { Router } from './router.js';
import { CacheManager } from './cache/index.js';
import { ResponseStore } from './response-store.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { chatRoutes } from './routes/chat.js';
import { responsesRoutes } from './routes/responses.js';
import { healthRoutes } from './routes/health.js';

async function main(): Promise<void> {
  // Load configuration
  const config = loadConfig();

  // Initialize logger
  const logger = createLogger(config.logging);

  logger.info('Starting llmux...');

  // Initialize provider registry
  const registry = new ProviderRegistry(config);

  if (registry.getNames().length === 0) {
    logger.error('No providers configured. Check your config and API keys.');
    process.exit(1);
  }

  // Initialize router
  const router = new Router(registry, config);

  // Initialize cache
  const cache = new CacheManager(config.cache);

  // Initialize response store for OpenResponses
  const responseStore = new ResponseStore(1000, 3600000); // 1000 items, 1 hour TTL

  // Create Fastify server
  const fastify = Fastify({
    logger: false, // We use our own logger
    bodyLimit: 10 * 1024 * 1024, // 10MB for large prompts
  });

  // Register auth middleware
  const authMiddleware = createAuthMiddleware(config);
  fastify.addHook('preHandler', authMiddleware);

  // Register routes
  await fastify.register(healthRoutes, { registry });
  await fastify.register(chatRoutes, { router, cache });
  await fastify.register(responsesRoutes, { router, cache, responseStore });

  // Error handler
  fastify.setErrorHandler((error: Error, _request, reply) => {
    logger.error({ error: error.message, stack: error.stack }, 'Unhandled error');
    reply.status(500).send({
      error: {
        message: 'Internal server error',
        type: 'api_error',
        code: 'internal_error',
      },
    });
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...');
    await fastify.close();
    await cache.clear();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server
  try {
    await fastify.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info(
      {
        port: config.server.port,
        host: config.server.host,
        providers: registry.getNames(),
      },
      `llmux server running at http://${config.server.host}:${config.server.port}`
    );

    // Log available endpoints
    logger.info('Endpoints:');
    logger.info('  POST /v1/chat/completions - Chat completions (OpenAI-compatible)');
    logger.info('  GET  /v1/models           - List available models');
    logger.info('  GET  /health              - Health check');
    logger.info('  GET  /health/providers    - Provider health status');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to start server');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
