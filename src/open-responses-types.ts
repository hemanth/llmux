// OpenResponses specification types
// https://www.openresponses.org/specification

// ============================================================================
// Item Types
// ============================================================================

export type ItemStatus = 'in_progress' | 'incomplete' | 'completed';
export type ResponseStatus = 'in_progress' | 'incomplete' | 'completed' | 'failed';

// Content Parts (for output)
export interface OutputTextPart {
    type: 'output_text';
    text: string;
    annotations?: Annotation[];
}

export interface RefusalPart {
    type: 'refusal';
    refusal: string;
}

export type OutputContentPart = OutputTextPart | RefusalPart;

// Content Parts (for input)
export interface InputTextPart {
    type: 'input_text';
    text: string;
}

export interface InputImagePart {
    type: 'input_image';
    image_url: string;
    detail?: 'auto' | 'low' | 'high';
}

export type InputContentPart = InputTextPart | InputImagePart;

// Annotation types
export interface Annotation {
    type: string;
    [key: string]: unknown;
}

// Message Item
export interface MessageItem {
    type: 'message';
    id: string;
    role: 'user' | 'assistant' | 'system';
    status: ItemStatus;
    content: OutputContentPart[];
}

// Input Message (user-provided)
export interface InputMessageItem {
    type: 'message';
    role: 'user' | 'system';
    content: InputContentPart[] | string; // string is convenience shorthand
}

// Function Call Item (model output)
export interface FunctionCallItem {
    type: 'function_call';
    id: string;
    name: string;
    call_id: string;
    arguments: string;
    status: ItemStatus;
}

// Function Call Output Item (user-provided)
export interface FunctionCallOutputItem {
    type: 'function_call_output';
    id?: string;
    call_id: string;
    output: string;
}

// Union types
export type OutputItem = MessageItem | FunctionCallItem;
export type InputItem = InputMessageItem | FunctionCallOutputItem;
export type Item = OutputItem | InputItem;

// ============================================================================
// Tools
// ============================================================================

export interface FunctionToolParameter {
    type: string;
    description?: string;
    enum?: string[];
    [key: string]: unknown;
}

export interface FunctionToolParameters {
    type: 'object';
    properties: Record<string, FunctionToolParameter>;
    required?: string[];
    additionalProperties?: boolean;
}

export interface FunctionTool {
    type: 'function';
    name: string;
    description?: string;
    parameters?: FunctionToolParameters;
    strict?: boolean;
}

export type Tool = FunctionTool;

export type ToolChoice =
    | 'auto'
    | 'required'
    | 'none'
    | { type: 'function'; name: string };

// ============================================================================
// Request
// ============================================================================

export interface ResponseRequest {
    model: string;
    input: InputItem[] | string; // string is convenience shorthand for single user message
    tools?: Tool[];
    tool_choice?: ToolChoice;
    previous_response_id?: string;
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    max_output_tokens?: number;
    stop?: string | string[];
    // llmux extensions
    provider?: string;
    cache?: boolean;
}

// ============================================================================
// Response
// ============================================================================

export interface ResponseError {
    type: string;
    code: string;
    message: string;
}

export interface ResponseUsage {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
}

export interface Response {
    id: string;
    object: 'response';
    status: ResponseStatus;
    output: OutputItem[];
    error?: ResponseError;
    usage?: ResponseUsage;
    model: string;
    created_at: number;
    // llmux extensions
    provider?: string;
    cached?: boolean;
}

// ============================================================================
// Streaming Events
// ============================================================================

export interface ResponseCreatedEvent {
    type: 'response.created';
    sequence_number: number;
    response: Response;
}

export interface ResponseInProgressEvent {
    type: 'response.in_progress';
    sequence_number: number;
    response: Response;
}

export interface ResponseCompletedEvent {
    type: 'response.completed';
    sequence_number: number;
    response: Response;
}

export interface ResponseFailedEvent {
    type: 'response.failed';
    sequence_number: number;
    response: Response;
}

export interface OutputItemAddedEvent {
    type: 'response.output_item.added';
    sequence_number: number;
    output_index: number;
    item: OutputItem;
}

export interface OutputItemDoneEvent {
    type: 'response.output_item.done';
    sequence_number: number;
    output_index: number;
    item: OutputItem;
}

export interface ContentPartAddedEvent {
    type: 'response.content_part.added';
    sequence_number: number;
    item_id: string;
    output_index: number;
    content_index: number;
    part: OutputContentPart;
}

export interface ContentPartDoneEvent {
    type: 'response.content_part.done';
    sequence_number: number;
    item_id: string;
    output_index: number;
    content_index: number;
    part: OutputContentPart;
}

export interface OutputTextDeltaEvent {
    type: 'response.output_text.delta';
    sequence_number: number;
    item_id: string;
    output_index: number;
    content_index: number;
    delta: string;
}

export interface OutputTextDoneEvent {
    type: 'response.output_text.done';
    sequence_number: number;
    item_id: string;
    output_index: number;
    content_index: number;
    text: string;
}

export interface FunctionCallArgumentsDeltaEvent {
    type: 'response.function_call_arguments.delta';
    sequence_number: number;
    item_id: string;
    output_index: number;
    call_id: string;
    delta: string;
}

export interface FunctionCallArgumentsDoneEvent {
    type: 'response.function_call_arguments.done';
    sequence_number: number;
    item_id: string;
    output_index: number;
    call_id: string;
    arguments: string;
}

export type StreamEvent =
    | ResponseCreatedEvent
    | ResponseInProgressEvent
    | ResponseCompletedEvent
    | ResponseFailedEvent
    | OutputItemAddedEvent
    | OutputItemDoneEvent
    | ContentPartAddedEvent
    | ContentPartDoneEvent
    | OutputTextDeltaEvent
    | OutputTextDoneEvent
    | FunctionCallArgumentsDeltaEvent
    | FunctionCallArgumentsDoneEvent;

// ============================================================================
// Utility Functions
// ============================================================================

export function generateId(prefix: string = 'resp'): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 32; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${prefix}_${id}`;
}

export function normalizeInput(input: ResponseRequest['input']): InputItem[] {
    // Handle string shorthand
    if (typeof input === 'string') {
        return [{
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: input }]
        }];
    }

    // Normalize content in messages
    return input.map(item => {
        if (item.type === 'message' && typeof item.content === 'string') {
            return {
                ...item,
                content: [{ type: 'input_text', text: item.content }]
            };
        }
        return item;
    }) as InputItem[];
}
