# llmux
> LLM proxy that routes requests across Groq, Together, Cerebras, SambaNova, OpenRouter with automatic fallbacks.

<img width="1024" height="559" alt="image" src="https://github.com/user-attachments/assets/0b6311dc-5979-46a3-8ac1-696caa13476b" />

## Setup

```bash
npm install
cp config/config.example.yaml config/config.yaml
cp .env.example .env
# Add your provider API keys to .env
npm run dev
```

## Usage

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $LLMUX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "llama-70b", "messages": [{"role": "user", "content": "Hi"}]}'
```

Works with any OpenAI SDK:

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3000/v1", api_key="your-key")
client.chat.completions.create(model="llama-70b", messages=[...])
```

## Config highlights

```yaml
routing:
  default_strategy: round-robin
  fallback_chain: [groq, cerebras, together, openrouter]
  model_aliases:
    llama-70b:
      groq: llama-3.1-70b-versatile
      together: meta-llama/Llama-3.1-70B-Instruct-Turbo

cache:
  backend: memory  # or redis
```

## Deploy

```bash
# Docker
docker compose up

# Fly.io
fly launch && fly secrets set GROQ_API_KEY=xxx && fly deploy

# Cloudflare Workers (see workers/)
cd workers && npm run deploy
```

## License

MIT
