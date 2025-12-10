import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ChatCompletionRequest } from './types.js';
import { getEnabledProviders } from './providers.js';
import { getFromCache, setInCache } from './cache.js';
import { routeChatCompletion, routeChatCompletionStream } from './router.js';
import { validateAuth } from './auth.js';

// Extend Hono context to include client label
type Variables = {
  clientLabel: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS
app.use('*', cors());

// Auth middleware
app.use('/v1/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const result = validateAuth(c.env, authHeader);

  if (!result.valid) {
    return c.json({
      error: {
        message: result.error,
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    }, 401);
  }

  // Store client label in context
  c.set('clientLabel', result.label || 'anonymous');

  return next();
});

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime: 'cloudflare-workers',
  });
});

// Provider health
app.get('/health/providers', (c) => {
  const providers = getEnabledProviders(c.env);

  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: providers.map(p => ({
      name: p.name,
      models: p.models,
    })),
  });
});

// List models
app.get('/v1/models', (c) => {
  const providers = getEnabledProviders(c.env);
  const models = providers.flatMap(p =>
    p.models.map(model => ({
      id: model,
      object: 'model' as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: p.name,
    }))
  );

  return c.json({
    object: 'list',
    data: models,
  });
});

// Chat completions
app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json<ChatCompletionRequest>();

  // Validate
  if (!body.model) {
    return c.json({
      error: {
        message: 'model is required',
        type: 'invalid_request_error',
        code: 'missing_model',
      },
    }, 400);
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({
      error: {
        message: 'messages is required and must be a non-empty array',
        type: 'invalid_request_error',
        code: 'missing_messages',
      },
    }, 400);
  }

  const client = c.get('clientLabel');

  try {
    // Handle streaming
    if (body.stream) {
      console.log(`[${client}] Chat completion request: model=${body.model} stream=true`);
      return await routeChatCompletionStream(c.env, body);
    }

    // Check cache
    const cached = await getFromCache(c.env, body);
    if (cached) {
      console.log(`[${client}] Chat completion request: model=${body.model} cached=true`);
      return c.json(cached);
    }

    console.log(`[${client}] Chat completion request: model=${body.model}`);

    // Route to provider
    const response = await routeChatCompletion(c.env, body);

    // Cache response
    await setInCache(c.env, body, response);

    console.log(`[${client}] Chat completion success: model=${body.model} provider=${response.provider}`);

    return c.json(response);
  } catch (error) {
    console.error(`[${client}] Chat completion error:`, error);
    return c.json({
      error: {
        message: (error as Error).message,
        type: 'api_error',
        code: 'provider_error',
      },
    }, 502);
  }
});

export default app;
