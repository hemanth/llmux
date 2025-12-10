# llmux - Cloudflare Workers Edition

Edge-deployed LLM proxy using Cloudflare Workers and Hono.

## Quick Start

### 1. Install dependencies

```bash
cd workers
npm install
```

### 2. Create KV namespace for caching

```bash
# Create production namespace
wrangler kv:namespace create CACHE

# Create preview namespace for dev
wrangler kv:namespace create CACHE --preview
```

Copy the IDs from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_PRODUCTION_ID"

[[env.dev.kv_namespaces]]
binding = "CACHE"
id = "YOUR_PREVIEW_ID"
```

### 3. Set secrets

```bash
wrangler secret put LLMUX_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put TOGETHER_API_KEY
# ... add other provider keys as needed
```

### 4. Deploy

```bash
# Development
npm run dev

# Production
npm run deploy
```

## Usage

Same as the Node.js version:

```bash
curl https://llmux.<your-subdomain>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer your-llmux-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-70b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Configuration

Configuration is done via `wrangler.toml` and secrets:

| Variable | Type | Description |
|----------|------|-------------|
| `CACHE_TTL` | var | Cache TTL in seconds (default: 3600) |
| `DEFAULT_STRATEGY` | var | Routing strategy: round-robin, random, first-available |
| `FALLBACK_CHAIN` | var | Comma-separated provider order |
| `LLMUX_API_KEY` | secret | Proxy authentication key |
| `GROQ_API_KEY` | secret | Groq API key |
| `TOGETHER_API_KEY` | secret | Together API key |
| `CEREBRAS_API_KEY` | secret | Cerebras API key |
| `SAMBANOVA_API_KEY` | secret | SambaNova API key |
| `OPENROUTER_API_KEY` | secret | OpenRouter API key |

## Differences from Node.js Version

| Feature | Node.js | Workers |
|---------|---------|---------|
| Config format | YAML file | wrangler.toml + secrets |
| Caching | LRU memory / Redis | Cloudflare KV |
| Runtime | Node.js 20+ | V8 isolates |
| Cold start | ~200ms | ~0ms |
| Region | Single | Global edge |
