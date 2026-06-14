# Streaming Implementation

## Backend Streaming

```typescript
// Streaming AI response
async *streamGeneration(input: GenerationInput): AsyncGenerator<StreamChunk> {
  const response = await this.aiService.stream({
    model: 'claude-3-5-sonnet',
    messages: input.messages,
    stream: true,
  });

  let buffer = '';

  for await (const chunk of response) {
    buffer += chunk.content;

    yield {
      type: 'content',
      content: chunk.content,
      timestamp: new Date(),
    };

    // Emit via WebSocket for real-time updates
    this.eventEmitter.emitStreamChunk(input.sessionId, chunk.content);
  }

  yield {
    type: 'complete',
    fullContent: buffer,
    timestamp: new Date(),
  };

  this.eventEmitter.emitStreamEnd(input.sessionId, { content: buffer });
}
```

## Controller with SSE

```typescript
@Controller("ai-writing")
export class AIWritingController {
  @Get("stream/chapter/:id")
  async streamChapter(@Param("id") chapterId: string, @Res() res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = this.writingService.streamChapterGeneration(chapterId);

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  }
}
```

## Frontend Streaming Hook

```typescript
// hooks/useAIStream.ts
export function useAIStream() {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const stream = useCallback(async (url: string, body: any) => {
    setIsStreaming(true);
    setContent("");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            setContent((prev) => prev + parsed.content);
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    setIsStreaming(false);
  }, []);

  return { content, isStreaming, stream };
}
```

## LiteLLM Integration

```typescript
@Injectable()
export class AIOrchestrationService {
  private readonly litellm: LiteLLMClient;

  constructor(private configService: ConfigService) {
    this.litellm = new LiteLLMClient({
      baseUrl: this.configService.get("LITELLM_PROXY_URL"),
    });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    return this.litellm.chat.completions.create({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      stream: false,
    });
  }

  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk> {
    const response = await this.litellm.chat.completions.create({
      ...options,
      stream: true,
    });

    for await (const chunk of response) {
      yield {
        content: chunk.choices[0]?.delta?.content || "",
        finishReason: chunk.choices[0]?.finish_reason,
      };
    }
  }
}
```
