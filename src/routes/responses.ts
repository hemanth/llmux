// OpenResponses /v1/responses endpoint
// Implements the OpenResponses specification

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ResponseRequest, Response, InputItem, StreamEvent } from '../open-responses-types.js';
import { generateId, normalizeInput } from '../open-responses-types.js';
import { toOpenAIChatRequest, fromOpenAIChatResponse, streamToEvents } from '../adapters/openai-adapter.js';
import { Router } from '../router.js';
import { CacheManager } from '../cache/index.js';
import { ResponseStore } from '../response-store.js';
import { getLogger } from '../utils/logger.js';

interface ResponsesRouteOptions {
    router: Router;
    cache: CacheManager;
    responseStore: ResponseStore;
}

export async function responsesRoutes(
    fastify: FastifyInstance,
    options: ResponsesRouteOptions
): Promise<void> {
    const { router, responseStore } = options;
    const logger = getLogger();

    // POST /v1/responses - OpenResponses endpoint
    fastify.post<{ Body: ResponseRequest }>(
        '/v1/responses',
        async (request: FastifyRequest<{ Body: ResponseRequest }>, reply: FastifyReply) => {
            const body = request.body;

            // Validate required fields
            if (!body.model) {
                return reply.status(400).send({
                    error: {
                        type: 'invalid_request_error',
                        code: 'missing_model',
                        message: 'model is required',
                    },
                });
            }

            if (!body.input) {
                return reply.status(400).send({
                    error: {
                        type: 'invalid_request_error',
                        code: 'missing_input',
                        message: 'input is required',
                    },
                });
            }

            const client = (request as any).clientLabel || 'anonymous';

            try {
                // Normalize and expand input
                let normalizedInput = normalizeInput(body.input);

                // Handle previous_response_id
                if (body.previous_response_id) {
                    const previousData = await responseStore.get(body.previous_response_id);
                    if (!previousData) {
                        return reply.status(404).send({
                            error: {
                                type: 'invalid_request_error',
                                code: 'response_not_found',
                                message: `Response with id '${body.previous_response_id}' not found`,
                            },
                        });
                    }

                    // Prepend previous input and output as new input
                    const previousOutput = previousData.response.output.map(outputItemToInputItem);
                    normalizedInput = [...previousData.input, ...previousOutput, ...normalizedInput];
                }

                // Handle streaming requests
                if (body.stream) {
                    logger.info({ client, model: body.model, stream: true }, 'OpenResponses request');
                    return handleStreamingRequest(body, normalizedInput, router, responseStore, reply);
                }

                // Convert to OpenAI format
                const chatRequest = toOpenAIChatRequest({ ...body, input: normalizedInput });

                logger.info({ client, model: body.model }, 'OpenResponses request');

                // Route to provider
                const chatResponse = await router.routeChatCompletion(chatRequest);

                // Convert back to OpenResponses format
                const response = fromOpenAIChatResponse(chatResponse, body.model);

                // Store for future previous_response_id references
                await responseStore.set(response.id, response, normalizedInput);

                logger.info(
                    { client, model: body.model, provider: response.provider, responseId: response.id },
                    'OpenResponses success'
                );

                return reply.send(response);
            } catch (error) {
                logger.error({ client, error: (error as Error).message }, 'OpenResponses error');

                const errorResponse: Response = {
                    id: generateId('resp'),
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
                };

                return reply.status(502).send(errorResponse);
            }
        }
    );
}

// Convert output item to input item for conversation continuation
function outputItemToInputItem(item: any): InputItem {
    if (item.type === 'message') {
        return {
            type: 'message',
            role: item.role,
            content: item.content.map((part: any) => {
                if (part.type === 'output_text') {
                    return { type: 'input_text', text: part.text };
                }
                return part;
            }),
        };
    }
    if (item.type === 'function_call') {
        // Function calls become function_call_output placeholders
        // The actual output should be provided by the user
        return {
            type: 'function_call_output',
            call_id: item.call_id,
            output: '', // Placeholder - user should provide actual output
        };
    }
    return item;
}

async function handleStreamingRequest(
    body: ResponseRequest,
    normalizedInput: InputItem[],
    router: Router,
    responseStore: ResponseStore,
    reply: FastifyReply
): Promise<void> {
    const logger = getLogger();

    // Set up SSE headers
    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    try {
        // Convert to OpenAI format
        const chatRequest = toOpenAIChatRequest({ ...body, input: normalizedInput, stream: true });

        // Get stream from router
        const chunks = router.routeChatCompletionStream(chatRequest);

        // Transform to OpenResponses events
        let finalResponse: Response | null = null;

        for await (const event of streamToEvents(chunks, body.model)) {
            // Track final response for storage
            if (event.type === 'response.completed') {
                finalResponse = event.response;
            }

            // Send event in SSE format
            const data = JSON.stringify(event);
            reply.raw.write(`event: ${event.type}\ndata: ${data}\n\n`);
        }

        // Store final response
        if (finalResponse) {
            await responseStore.set(finalResponse.id, finalResponse, normalizedInput);
        }

        // Send done marker
        reply.raw.write('data: [DONE]\n\n');
    } catch (error) {
        logger.error({ error: (error as Error).message }, 'OpenResponses streaming error');

        const errorEvent: StreamEvent = {
            type: 'response.failed',
            sequence_number: 0,
            response: {
                id: generateId('resp'),
                object: 'response',
                status: 'failed',
                output: [],
                error: {
                    type: 'api_error',
                    code: 'stream_error',
                    message: (error as Error).message,
                },
                model: body.model,
                created_at: Math.floor(Date.now() / 1000),
            },
        };

        reply.raw.write(`event: response.failed\ndata: ${JSON.stringify(errorEvent)}\n\n`);
    } finally {
        reply.raw.end();
    }
}
