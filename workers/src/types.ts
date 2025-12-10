// Environment bindings for Cloudflare Workers
export interface Env {
  // API Keys - single key (legacy)
  LLMUX_API_KEY?: string;
  // Multiple keys as JSON: {"alice":"sk-xxx","bob":"sk-yyy"}
  LLMUX_API_KEYS?: string;

  // Provider API keys
  GROQ_API_KEY?: string;
  TOGETHER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  SAMBANOVA_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  // KV namespace for caching
  CACHE: KVNamespace;

  // Configuration
  CACHE_TTL?: string;
  DEFAULT_STRATEGY?: string;
  FALLBACK_CHAIN?: string;
}

// Provider configuration
export interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  timeout: number;
}

// OpenAI-compatible types
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
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
  // llmux extensions
  provider?: string;
  cache?: boolean;
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
