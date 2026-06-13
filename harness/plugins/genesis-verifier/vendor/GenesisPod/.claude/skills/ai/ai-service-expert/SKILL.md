---
name: AI Service Expert
description: |
  Integrate and manage AI services (Grok, OpenAI, Claude, Gemini).
  Trigger keywords: ai service, grok, openai, claude, llm, fallback, streaming
  Not for: AI architecture decisions (-> ai-architecture-layering), AI Teams (-> ai-teams-expert)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [ai, grok, openai, llm, claude, gemini]
boundaries:
  includes:
    - AI provider client configuration
    - Fallback and retry logic
    - Streaming implementation
    - Error handling patterns
  excludes:
    - Architecture layer decisions
    - Multi-agent collaboration
  handoff:
    - skill: ai-architecture-layering
      when: Deciding capability placement
    - skill: ai-teams-expert
      when: Multi-agent implementation
---

# AI Service Expert

> Integrate and manage AI services for GenesisPod.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   AI Orchestrator                        │
│                   (NestJS Backend)                       │
├─────────────────────────────────────────────────────────┤
│  Primary: Grok API (x.AI) - Speed optimized             │
│  Fallback: OpenAI → Claude → Gemini → DeepSeek          │
└─────────────────────────────────────────────────────────┘
         │                     │                     │
     ┌───▼───┐           ┌─────▼─────┐         ┌─────▼─────┐
     │ Grok  │           │  OpenAI   │         │  Claude   │
     │ (x.AI)│           │  GPT-4o   │         │  Sonnet   │
     └───────┘           └───────────┘         └───────────┘
```

## Orchestration Pattern

```typescript
@Injectable()
export class AIOrchestrator {
  private providers = ["grok", "openai", "claude", "gemini"];

  async complete(request: AIRequest): Promise<AIResponse> {
    for (const provider of this.providers) {
      try {
        const result = await this.callProvider(provider, request);
        return { ...result, provider };
      } catch (error) {
        this.logger.warn(`Provider ${provider} failed, trying next...`);
        continue;
      }
    }
    throw new ServiceUnavailableException("All AI providers failed");
  }
}
```

## Error Handling

```typescript
class RateLimitError extends AIServiceError {}
class TokenLimitError extends AIServiceError {}

async function safeCompletion(messages: Message[]): Promise<Response> {
  try {
    return await client.chat(messages);
  } catch (e) {
    if (e.status === 429) throw new RateLimitError();
    if (e.status === 400) throw new TokenLimitError();
    throw new AIServiceError(e.message);
  }
}
```

## Related Docs

- [Client Configuration](references/client-config.md)
- [LiteLLM Proxy](references/litellm-proxy.md)
