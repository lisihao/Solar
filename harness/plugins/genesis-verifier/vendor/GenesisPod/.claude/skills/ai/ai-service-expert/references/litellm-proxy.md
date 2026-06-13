# LiteLLM Proxy Configuration

## Config File

```yaml
# litellm-proxy/config.yaml
model_list:
  - model_name: grok-beta
    litellm_params:
      model: xai/grok-beta
      api_key: ${GROK_API_KEY}

  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: ${OPENAI_API_KEY}

  - model_name: claude-3-opus
    litellm_params:
      model: anthropic/claude-3-opus
      api_key: ${ANTHROPIC_API_KEY}

  - model_name: gemini-pro
    litellm_params:
      model: google/gemini-pro
      api_key: ${GOOGLE_API_KEY}

router_settings:
  routing_strategy: latency-based-routing
  num_retries: 3
  timeout: 60
```

## Prompt Engineering Patterns

### System Prompt Template

```python
SYSTEM_PROMPT = """You are an AI assistant for GenesisPod, a knowledge management platform.

Your capabilities:
- Analyze documents and extract key insights
- Generate summaries and reports
- Answer questions based on provided context
- Help organize and structure information

Guidelines:
- Be concise and accurate
- Cite sources when available
- Acknowledge uncertainty when appropriate
- Follow the user's preferred language
"""
```

## Error Handling

```python
class AIServiceError(Exception):
    """Base AI service error"""

class RateLimitError(AIServiceError):
    """Rate limit exceeded"""

class TokenLimitError(AIServiceError):
    """Token limit exceeded"""

async def safe_completion(messages: list[dict]) -> dict:
    try:
        return await client.chat_completion(messages)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            raise RateLimitError("Rate limit exceeded, retry later")
        if e.response.status_code == 400:
            raise TokenLimitError("Token limit exceeded")
        raise AIServiceError(f"API error: {e.response.status_code}")
```

## Routing Strategies

| Strategy       | Use Case                    |
| -------------- | --------------------------- |
| latency-based  | Real-time responses         |
| cost-optimized | Batch processing            |
| fallback       | High availability           |
| load-balanced  | Distribute across providers |
