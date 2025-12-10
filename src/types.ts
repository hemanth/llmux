// Core types for llmux

export interface ProviderConfig {
  enabled: boolean;
  api_key: string;
  base_url: string;
  models: string[];
  timeout: number;
  max_retries: number;
  extra_headers?: Record<string, string>;
}

export interface ModelAlias {
  [provider: string]: string;
}

export interface RoutingConfig {
  default_strategy: 'round-robin' | 'random' | 'first-available' | 'latency';
  fallback_chain: string[];
  model_aliases: Record<string, ModelAlias>;
}

export interface MemoryCacheConfig {
  max_items: number;
  ttl: number;
}

export interface RedisCacheConfig {
  url: string;
  ttl: number;
  key_prefix: string;
}

export interface CacheConfig {
  enabled: boolean;
  backend: 'memory' | 'redis';
  memory: MemoryCacheConfig;
  redis: RedisCacheConfig;
}

export interface ServerConfig {
  port: number;
  host: string;
}

export interface AuthConfig {
  // Single key (legacy/simple mode)
  api_key?: string;
  // Multiple keys with labels: { label: key }
  api_keys?: Record<string, string>;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  pretty: boolean;
}

export interface Config {
  server: ServerConfig;
  auth: AuthConfig;
  providers: Record<string, ProviderConfig>;
  routing: RoutingConfig;
  cache: CacheConfig;
  logging: LoggingConfig;
}

// OpenAI-compatible request/response types

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  // llmux-specific options
  provider?: string;  // Force specific provider
  cache?: boolean;    // Override cache setting for this request
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | null;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: Usage;
  // llmux additions
  provider?: string;
  cached?: boolean;
}

export interface StreamChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason: 'stop' | 'length' | 'tool_calls' | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: StreamChoice[];
}

// Provider interface
export interface Provider {
  name: string;
  config: ProviderConfig;
  isHealthy(): Promise<boolean>;
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  chatCompletionStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;
  supportsModel(model: string): boolean;
}

// Cache interface
export interface Cache {
  get(key: string): Promise<ChatCompletionResponse | null>;
  set(key: string, value: ChatCompletionResponse): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
