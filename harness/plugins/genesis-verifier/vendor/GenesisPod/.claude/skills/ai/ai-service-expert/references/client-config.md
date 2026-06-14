# Client Configuration

## Grok Client (Primary)

```python
# ai-service/services/grok_client.py
import httpx
from typing import AsyncGenerator

class GrokClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.x.ai/v1"
        self.client = httpx.AsyncClient(timeout=60.0)

    async def chat_completion(
        self,
        messages: list[dict],
        model: str = "grok-beta",
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> dict:
        response = await self.client.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
        )
        return response.json()

    async def stream_completion(
        self,
        messages: list[dict],
        model: str = "grok-beta",
    ) -> AsyncGenerator[str, None]:
        async with self.client.stream(
            "POST",
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"model": model, "messages": messages, "stream": True},
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:]
```

## OpenAI Fallback

```python
from openai import AsyncOpenAI

class OpenAIClient:
    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key)

    async def chat_completion(
        self,
        messages: list[dict],
        model: str = "gpt-4o",
        temperature: float = 0.7,
    ) -> dict:
        response = await self.client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return response.model_dump()
```

## Structured Output

```python
from pydantic import BaseModel

class AnalysisResult(BaseModel):
    summary: str
    key_points: list[str]
    sentiment: str
    confidence: float

async def analyze_with_structure(content: str) -> AnalysisResult:
    response = await client.chat_completion(
        messages=[
            {"role": "system", "content": "Output valid JSON matching the schema."},
            {"role": "user", "content": f"Analyze: {content}"},
        ],
        response_format={"type": "json_object"},
    )
    return AnalysisResult.model_validate_json(
        response["choices"][0]["message"]["content"]
    )
```

## Responsibilities

1. Configure AI provider clients correctly
2. Implement robust fallback logic
3. Handle rate limits and token limits
4. Optimize prompts for accuracy and cost
5. Implement streaming for real-time responses
6. Monitor AI service costs and usage
7. Ensure proper error handling and logging
8. Test AI integrations thoroughly
