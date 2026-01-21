import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ChatCompletionRequest } from './types.js';
import { getEnabledProviders } from './providers.js';
import { getFromCache, setInCache } from './cache.js';
import { routeChatCompletion, routeChatCompletionStream } from './router.js';
import { validateAuth } from './auth.js';
import dashboardHtml from './dashboard.html';

// Extend Hono context to include client label
type Variables = {
  clientLabel: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS
app.use('*', cors());

// Dashboard (public, no auth)
app.get('/', (c) => {
  return c.html(dashboardHtml);
});

app.get('/dashboard', (c) => {
  return c.html(dashboardHtml);
});

// Auth middleware (only for API routes)
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

// Health check (public)
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime: 'cloudflare-workers',
  });
});

// Provider health (public)
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

// OpenResponses endpoint (simplified - reuses chat completions)
app.post('/v1/responses', async (c) => {
  const body = await c.req.json<any>();

  // Validate
  if (!body.model) {
    return c.json({
      error: {
        type: 'invalid_request_error',
        code: 'missing_model',
        message: 'model is required',
      },
    }, 400);
  }

  if (!body.input) {
    return c.json({
      error: {
        type: 'invalid_request_error',
        code: 'missing_input',
        message: 'input is required',
      },
    }, 400);
  }

  const client = c.get('clientLabel');

  // Normalize input to messages
  let messages: any[];
  if (typeof body.input === 'string') {
    messages = [{ role: 'user', content: body.input }];
  } else if (Array.isArray(body.input)) {
    messages = body.input.map((item: any) => {
      if (item.type === 'message') {
        const text = Array.isArray(item.content)
          ? item.content.map((p: any) => p.text || '').join('')
          : item.content;
        return { role: item.role, content: text };
      }
      return item;
    });
  } else {
    messages = [{ role: 'user', content: String(body.input) }];
  }

  const chatRequest = {
    model: body.model,
    messages,
    stream: body.stream,
    temperature: body.temperature,
    max_tokens: body.max_output_tokens,
  };

  try {
    if (body.stream) {
      console.log(`[${client}] OpenResponses request: model=${body.model} stream=true`);

      // For streaming, transform chat stream to OpenResponses events
      const chatResponse = await routeChatCompletionStream(c.env, chatRequest as ChatCompletionRequest);

      // Return the stream with transformed headers
      return new Response(chatResponse.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    console.log(`[${client}] OpenResponses request: model=${body.model}`);

    // Non-streaming: transform chat response to OpenResponses format
    const chatResponse = await routeChatCompletion(c.env, chatRequest as ChatCompletionRequest);

    // Transform to OpenResponses format
    const responseId = `resp_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const output: any[] = [];

    for (const choice of chatResponse.choices) {
      if (choice.message.content) {
        output.push({
          type: 'message',
          id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
          role: 'assistant',
          status: 'completed',
          content: [{
            type: 'output_text',
            text: choice.message.content,
            annotations: [],
          }],
        });
      }
    }

    const response = {
      id: responseId,
      object: 'response',
      status: 'completed',
      output,
      usage: chatResponse.usage ? {
        input_tokens: chatResponse.usage.prompt_tokens,
        output_tokens: chatResponse.usage.completion_tokens,
        total_tokens: chatResponse.usage.total_tokens,
      } : undefined,
      model: chatResponse.model,
      created_at: chatResponse.created,
      provider: chatResponse.provider,
    };

    console.log(`[${client}] OpenResponses success: model=${body.model} provider=${chatResponse.provider}`);

    return c.json(response);
  } catch (error) {
    console.error(`[${client}] OpenResponses error:`, error);

    return c.json({
      id: `resp_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      object: 'response',
      status: 'failed',
      output: [],
      error: {
        type: 'api_error',
        code: 'provider_error',
        message: (error as Error).message,
      },
      model: body.model,
      created_at: Math.floor(Date.now() / 1000),
    }, 502);
  }
});

export default app;

