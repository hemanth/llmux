// OpenAI Chat Completions <-> OpenResponses adapter
// Transforms between OpenAI format and OpenResponses format

import type {
    ResponseRequest,
    Response,
    InputItem,
    OutputItem,
    MessageItem,
    FunctionCallItem,
    StreamEvent,
    ToolChoice,
    OutputTextPart,
} from '../open-responses-types.js';
import { generateId, normalizeInput } from '../open-responses-types.js';
import type {
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChunk,
    ChatMessage,
} from '../types.js';

// ============================================================================
// Request Transformation: OpenResponses -> OpenAI
// ============================================================================

export function toOpenAIChatRequest(request: ResponseRequest): ChatCompletionRequest {
    const normalizedInput = normalizeInput(request.input);

    // Convert items to messages
    const messages: ChatMessage[] = normalizedInput.map(itemToMessage);

    // Build request
    const chatRequest: ChatCompletionRequest = {
        model: request.model,
        messages,
        stream: request.stream,
        temperature: request.temperature,
        top_p: request.top_p,
        max_tokens: request.max_output_tokens,
        stop: request.stop,
        provider: request.provider,
        cache: request.cache,
    };

    // Add tools if present
    if (request.tools && request.tools.length > 0) {
        (chatRequest as any).tools = request.tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));
    }

    // Add tool_choice if present
    if (request.tool_choice) {
        (chatRequest as any).tool_choice = convertToolChoice(request.tool_choice);
    }

    return chatRequest;
}

function itemToMessage(item: InputItem): ChatMessage {
    if (item.type === 'message') {
        // Extract text from content parts
        let textContent = '';
        const content = Array.isArray(item.content) ? item.content : [{ type: 'input_text', text: item.content as string }];

        for (const part of content) {
            if (part.type === 'input_text') {
                textContent += part.text;
            }
        }

        return {
            role: item.role as 'system' | 'user' | 'assistant',
            content: textContent,
        };
    }

    if (item.type === 'function_call_output') {
        return {
            role: 'tool',
            content: item.output,
            tool_call_id: item.call_id,
        };
    }

    throw new Error(`Unknown item type: ${(item as any).type}`);
}

function convertToolChoice(choice: ToolChoice): any {
    if (choice === 'auto' || choice === 'none') {
        return choice;
    }
    if (choice === 'required') {
        return 'required';
    }
    if (typeof choice === 'object' && choice.type === 'function') {
        return {
            type: 'function',
            function: { name: choice.name },
        };
    }
    return 'auto';
}

// ============================================================================
// Response Transformation: OpenAI -> OpenResponses
// ============================================================================

export function fromOpenAIChatResponse(
    response: ChatCompletionResponse,
    requestModel: string
): Response {
    const output: OutputItem[] = [];

    for (const choice of response.choices) {
        const message = choice.message;

        // Handle tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
            for (const toolCall of message.tool_calls) {
                const functionCallItem: FunctionCallItem = {
                    type: 'function_call',
                    id: generateId('fc'),
                    name: toolCall.function.name,
                    call_id: toolCall.id,
                    arguments: toolCall.function.arguments,
                    status: 'completed',
                };
                output.push(functionCallItem);
            }
        }

        // Handle text content
        if (message.content) {
            const messageItem: MessageItem = {
                type: 'message',
                id: generateId('msg'),
                role: 'assistant',
                status: 'completed',
                content: [{
                    type: 'output_text',
                    text: message.content,
                    annotations: [],
                }],
            };
            output.push(messageItem);
        }
    }

    return {
        id: generateId('resp'),
        object: 'response',
        status: 'completed',
        output,
        usage: response.usage ? {
            input_tokens: response.usage.prompt_tokens,
            output_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
        } : undefined,
        model: response.model || requestModel,
        created_at: response.created,
        provider: response.provider,
        cached: response.cached,
    };
}

// ============================================================================
// Streaming Transformation: OpenAI Chunks -> OpenResponses Events
// ============================================================================

export async function* streamToEvents(
    chunks: AsyncIterable<ChatCompletionChunk>,
    requestModel: string
): AsyncIterable<StreamEvent> {
    let sequenceNumber = 0;
    const responseId = generateId('resp');
    const messageId = generateId('msg');
    let currentFunctionCallId: string | null = null;
    let currentCallId: string | null = null;
    let currentFunctionName: string | null = null;
    let accumulatedText = '';
    let accumulatedArguments = '';
    let outputIndex = 0;
    let messageEmitted = false;
    let functionCallEmitted = false;

    // Emit response.created
    const initialResponse: Response = {
        id: responseId,
        object: 'response',
        status: 'in_progress',
        output: [],
        model: requestModel,
        created_at: Math.floor(Date.now() / 1000),
    };

    yield {
        type: 'response.created',
        sequence_number: sequenceNumber++,
        response: initialResponse,
    };

    yield {
        type: 'response.in_progress',
        sequence_number: sequenceNumber++,
        response: initialResponse,
    };

    for await (const chunk of chunks) {
        for (const choice of chunk.choices) {
            const delta = choice.delta;

            // Handle tool calls
            if ((delta as any).tool_calls) {
                for (const toolCallDelta of (delta as any).tool_calls) {
                    // New function call
                    if (toolCallDelta.function?.name && !functionCallEmitted) {
                        currentFunctionCallId = generateId('fc');
                        currentCallId = toolCallDelta.id || generateId('call');
                        currentFunctionName = toolCallDelta.function.name;
                        accumulatedArguments = '';

                        const functionCallItem: FunctionCallItem = {
                            type: 'function_call',
                            id: currentFunctionCallId!,
                            name: currentFunctionName!,
                            call_id: currentCallId!,
                            arguments: '',
                            status: 'in_progress',
                        };

                        yield {
                            type: 'response.output_item.added',
                            sequence_number: sequenceNumber++,
                            output_index: outputIndex,
                            item: functionCallItem,
                        };

                        functionCallEmitted = true;
                    }

                    // Arguments delta
                    if (toolCallDelta.function?.arguments && currentFunctionCallId && currentCallId) {
                        accumulatedArguments += toolCallDelta.function.arguments;

                        yield {
                            type: 'response.function_call_arguments.delta',
                            sequence_number: sequenceNumber++,
                            item_id: currentFunctionCallId,
                            output_index: outputIndex,
                            call_id: currentCallId,
                            delta: toolCallDelta.function.arguments,
                        };
                    }
                }
            }

            // Handle text content
            if (delta.content) {
                // Emit message item if not yet emitted
                if (!messageEmitted) {
                    const messageItem: MessageItem = {
                        type: 'message',
                        id: messageId,
                        role: 'assistant',
                        status: 'in_progress',
                        content: [],
                    };

                    yield {
                        type: 'response.output_item.added',
                        sequence_number: sequenceNumber++,
                        output_index: outputIndex,
                        item: messageItem,
                    };

                    // Content part added
                    yield {
                        type: 'response.content_part.added',
                        sequence_number: sequenceNumber++,
                        item_id: messageId,
                        output_index: outputIndex,
                        content_index: 0,
                        part: { type: 'output_text', text: '', annotations: [] },
                    };

                    messageEmitted = true;
                }

                accumulatedText += delta.content;

                yield {
                    type: 'response.output_text.delta',
                    sequence_number: sequenceNumber++,
                    item_id: messageId,
                    output_index: outputIndex,
                    content_index: 0,
                    delta: delta.content,
                };
            }

            // Handle finish
            if (choice.finish_reason) {
                // Close function call if active
                if (currentFunctionCallId && currentCallId && currentFunctionName) {
                    yield {
                        type: 'response.function_call_arguments.done',
                        sequence_number: sequenceNumber++,
                        item_id: currentFunctionCallId,
                        output_index: outputIndex,
                        call_id: currentCallId,
                        arguments: accumulatedArguments,
                    };

                    const completedFunctionCall: FunctionCallItem = {
                        type: 'function_call',
                        id: currentFunctionCallId,
                        name: currentFunctionName,
                        call_id: currentCallId,
                        arguments: accumulatedArguments,
                        status: 'completed',
                    };

                    yield {
                        type: 'response.output_item.done',
                        sequence_number: sequenceNumber++,
                        output_index: outputIndex,
                        item: completedFunctionCall,
                    };

                    outputIndex++;
                }

                // Close message if active
                if (messageEmitted) {
                    yield {
                        type: 'response.output_text.done',
                        sequence_number: sequenceNumber++,
                        item_id: messageId,
                        output_index: outputIndex,
                        content_index: 0,
                        text: accumulatedText,
                    };

                    const textPart: OutputTextPart = {
                        type: 'output_text',
                        text: accumulatedText,
                        annotations: [],
                    };

                    yield {
                        type: 'response.content_part.done',
                        sequence_number: sequenceNumber++,
                        item_id: messageId,
                        output_index: outputIndex,
                        content_index: 0,
                        part: textPart,
                    };

                    const completedMessage: MessageItem = {
                        type: 'message',
                        id: messageId,
                        role: 'assistant',
                        status: 'completed',
                        content: [textPart],
                    };

                    yield {
                        type: 'response.output_item.done',
                        sequence_number: sequenceNumber++,
                        output_index: outputIndex,
                        item: completedMessage,
                    };
                }
            }
        }
    }

    // Build final output
    const finalOutput: OutputItem[] = [];

    if (currentFunctionCallId && currentCallId && currentFunctionName) {
        finalOutput.push({
            type: 'function_call',
            id: currentFunctionCallId,
            name: currentFunctionName,
            call_id: currentCallId,
            arguments: accumulatedArguments,
            status: 'completed',
        });
    }

    if (messageEmitted) {
        finalOutput.push({
            type: 'message',
            id: messageId,
            role: 'assistant',
            status: 'completed',
            content: [{
                type: 'output_text',
                text: accumulatedText,
                annotations: [],
            }],
        });
    }

    // Emit response.completed
    const finalResponse: Response = {
        id: responseId,
        object: 'response',
        status: 'completed',
        output: finalOutput,
        model: requestModel,
        created_at: Math.floor(Date.now() / 1000),
    };

    yield {
        type: 'response.completed',
        sequence_number: sequenceNumber++,
        response: finalResponse,
    };
}
