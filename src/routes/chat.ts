import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ChatCompletionRequest } from '../types.js';
import { Router } from '../router.js';
import { CacheManager } from '../cache/index.js';
import { getLogger } from '../utils/logger.js';

interface ChatRouteOptions {
  router: Router;
  cache: CacheManager;
}

export async function chatRoutes(
  fastify: FastifyInstance,
  options: ChatRouteOptions
): Promise<void> {
  const { router, cache } = options;
  const logger = getLogger();

  // POST /v1/chat/completions - OpenAI-compatible chat completions
  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/chat/completions',
    async (request: FastifyRequest<{ Body: ChatCompletionRequest }>, reply: FastifyReply) => {
      const body = request.body;

      // Validate required fields
      if (!body.model) {
        return reply.status(400).send({
          error: {
            message: 'model is required',
            type: 'invalid_request_error',
            code: 'missing_model',
          },
        });
      }

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return reply.status(400).send({
          error: {
            message: 'messages is required and must be a non-empty array',
            type: 'invalid_request_error',
            code: 'missing_messages',
          },
        });
      }

      const client = request.clientLabel || 'anonymous';

      try {
        // Handle streaming requests
        if (body.stream) {
          logger.info({ client, model: body.model, stream: true }, 'Chat completion request');
          return handleStreamingRequest(body, router, reply);
        }

        // Check cache for non-streaming requests
        const cached = await cache.get(body);
        if (cached) {
          logger.info({ client, model: body.model, cached: true }, 'Returning cached response');
          return reply.send(cached);
        }

        logger.info({ client, model: body.model }, 'Chat completion request');

        // Route to provider
        const response = await router.routeChatCompletion(body);

        // Cache the response
        await cache.set(body, response);

        logger.info({ client, model: body.model, provider: response.provider }, 'Chat completion success');

        return reply.send(response);
      } catch (error) {
        logger.error({ client, error: (error as Error).message }, 'Chat completion error');
        return reply.status(502).send({
          error: {
            message: (error as Error).message,
            type: 'api_error',
            code: 'provider_error',
          },
        });
      }
    }
  );
}

async function handleStreamingRequest(
  body: ChatCompletionRequest,
  router: Router,
  reply: FastifyReply
): Promise<void> {
  const logger = getLogger();

  // Set up SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  try {
    for await (const chunk of router.routeChatCompletionStream(body)) {
      const data = JSON.stringify(chunk);
      reply.raw.write(`data: ${data}\n\n`);
    }

    reply.raw.write('data: [DONE]\n\n');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Streaming error');

    // Try to send error in SSE format if stream already started
    const errorData = JSON.stringify({
      error: {
        message: (error as Error).message,
        type: 'api_error',
        code: 'stream_error',
      },
    });
    reply.raw.write(`data: ${errorData}\n\n`);
  } finally {
    reply.raw.end();
  }
}
