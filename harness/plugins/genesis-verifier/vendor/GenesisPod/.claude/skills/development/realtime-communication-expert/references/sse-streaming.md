# SSE (Server-Sent Events) Streaming

## Backend SSE Controller

```typescript
// streaming.controller.ts
import { Controller, Get, Param, Res, Req } from "@nestjs/common";
import { Response, Request } from "express";

@Controller("stream")
export class StreamingController {
  constructor(private readonly aiService: AIService) {}

  @Get("research/:id")
  async streamResearch(
    @Param("id") researchId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = await this.aiService.streamResearch(researchId);

    for await (const chunk of stream) {
      if (req.socket.destroyed) break;

      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  }
}
```

## Frontend SSE Hook

```typescript
// hooks/useSSE.ts
import { useEffect, useState, useCallback, useRef } from "react";

interface UseSSEOptions {
  url: string;
  onMessage?: (data: any) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

export function useSSE({ url, onMessage, onError, onComplete }: UseSSEOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const start = useCallback(() => {
    if (eventSourceRef.current) return;

    setIsStreaming(true);
    setError(null);

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      if (event.data === "[DONE]") {
        eventSource.close();
        eventSourceRef.current = null;
        setIsStreaming(false);
        onComplete?.();
        return;
      }

      try {
        const data = JSON.parse(event.data);
        onMessage?.(data);
      } catch (e) {
        console.error("Failed to parse SSE data", e);
      }
    };

    eventSource.onerror = (e) => {
      const err = new Error("SSE connection failed");
      setError(err);
      onError?.(err);
      eventSource.close();
      eventSourceRef.current = null;
      setIsStreaming(false);
    };
  }, [url, onMessage, onError, onComplete]);

  const stop = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsStreaming(false);
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  return { isStreaming, error, start, stop };
}
```

## When to Use SSE vs WebSocket

| Feature   | SSE                    | WebSocket               |
| --------- | ---------------------- | ----------------------- |
| Direction | Server → Client only   | Bidirectional           |
| Protocol  | HTTP                   | WebSocket               |
| Reconnect | Automatic              | Manual                  |
| Use case  | Streaming AI responses | Real-time collaboration |
