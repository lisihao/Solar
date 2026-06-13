# 流式响应技术

## 概述

流式响应允许 AI 模型逐步返回生成的内容，而不是等待完整响应。这显著改善了用户体验，尤其是对于长文本生成。

## 流式响应原理

```
┌─────────────────────────────────────────────────────────────┐
│                    流式响应 vs 批量响应                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  批量响应:                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Request ──────────────────────────────────► Response │   │
│  │           [等待完整生成... 5-30秒]                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  流式响应:                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Request ─► Chunk1 ─► Chunk2 ─► Chunk3 ─► ... ─► End │   │
│  │           [首字节 ~200ms] [持续流式输出]              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Server-Sent Events (SSE)

### 1. 协议原理

SSE 是一种服务器向客户端推送事件的标准协议：

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"content": "Hello"}

data: {"content": " World"}

data: {"content": "!"}

data: [DONE]
```

### 2. NestJS SSE 实现

```typescript
// streaming.controller.ts
import { Controller, Post, Body, Sse, MessageEvent } from "@nestjs/common";
import { Observable, from, map, concatMap, of, delay } from "rxjs";

@Controller("ai")
export class StreamingController {
  constructor(private aiService: AIStreamingService) {}

  @Post("stream")
  @Sse()
  streamChat(@Body() request: ChatRequest): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const stream = this.aiService.streamChat(request);

      (async () => {
        try {
          for await (const chunk of stream) {
            subscriber.next({
              data: JSON.stringify({
                type: "content",
                content: chunk.content,
              }),
            });
          }

          subscriber.next({
            data: JSON.stringify({ type: "done" }),
          });

          subscriber.complete();
        } catch (error) {
          subscriber.next({
            data: JSON.stringify({
              type: "error",
              message: error.message,
            }),
          });
          subscriber.complete();
        }
      })();
    });
  }
}
```

### 3. 流式服务实现

```typescript
// ai-streaming.service.ts
@Injectable()
export class AIStreamingService {
  constructor(private openai: OpenAI) {}

  async *streamChat(request: ChatRequest): AsyncIterable<StreamChunk> {
    const stream = await this.openai.chat.completions.create({
      model: request.model,
      messages: request.messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield {
          type: "content",
          content: delta.content,
        };
      }

      if (chunk.choices[0]?.finish_reason) {
        yield {
          type: "finish",
          reason: chunk.choices[0].finish_reason,
        };
      }
    }
  }

  // 带进度追踪的流式处理
  async *streamWithProgress(
    request: ChatRequest,
    onProgress: (progress: number) => void,
  ): AsyncIterable<StreamChunk> {
    let tokenCount = 0;
    const estimatedTokens = request.maxTokens || 1000;

    for await (const chunk of this.streamChat(request)) {
      if (chunk.type === "content") {
        tokenCount += this.estimateTokens(chunk.content);
        onProgress(Math.min(tokenCount / estimatedTokens, 0.99));
      }

      yield chunk;
    }

    onProgress(1);
  }

  private estimateTokens(text: string): number {
    // 简单估算：平均 4 字符 = 1 token
    return Math.ceil(text.length / 4);
  }
}
```

### 4. 前端消费 SSE

```typescript
// useStreamChat.ts
export function useStreamChat() {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamChat = useCallback(async (message: string) => {
    setContent("");
    setIsStreaming(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: message }],
        }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No reader available");

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (data.type === "content") {
              setContent((prev) => prev + data.content);
            } else if (data.type === "error") {
              setError(data.message);
            }
          }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsStreaming(false);
    }
  }, []);

  return { content, isStreaming, error, streamChat };
}

// 使用 EventSource API
export function useEventSourceChat() {
  const streamChat = useCallback((message: string) => {
    const eventSource = new EventSource(
      `/api/ai/stream?message=${encodeURIComponent(message)}`,
    );

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "content") {
        setContent((prev) => prev + data.content);
      } else if (data.type === "done") {
        eventSource.close();
        setIsStreaming(false);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsStreaming(false);
    };
  }, []);

  return { content, isStreaming, streamChat };
}
```

## WebSocket 流式传输

### 1. WebSocket Gateway

```typescript
// ai-stream.gateway.ts
@WebSocketGateway({
  namespace: "/ai-stream",
  cors: { origin: "*" },
})
export class AIStreamGateway {
  @WebSocketServer()
  server: Server;

  constructor(private aiService: AIStreamingService) {}

  @SubscribeMessage("chat")
  async handleChat(
    @MessageBody() data: ChatRequest,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const stream = this.aiService.streamChat(data);

    try {
      for await (const chunk of stream) {
        client.emit("chunk", chunk);
      }

      client.emit("complete");
    } catch (error) {
      client.emit("error", { message: error.message });
    }
  }

  @SubscribeMessage("cancel")
  handleCancel(@ConnectedSocket() client: Socket): void {
    // 取消当前流
    client.data.cancelled = true;
  }
}
```

### 2. 前端 WebSocket 客户端

```typescript
// useWebSocketChat.ts
import { io, Socket } from "socket.io-client";

export function useWebSocketChat() {
  const socketRef = useRef<Socket | null>(null);
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    const socket = io("/ai-stream");

    socket.on("chunk", (data: StreamChunk) => {
      if (data.type === "content") {
        setContent((prev) => prev + data.content);
      }
    });

    socket.on("complete", () => {
      setIsStreaming(false);
    });

    socket.on("error", (error) => {
      console.error("Stream error:", error);
      setIsStreaming(false);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  const streamChat = useCallback((message: string) => {
    setContent("");
    setIsStreaming(true);

    socketRef.current?.emit("chat", {
      messages: [{ role: "user", content: message }],
    });
  }, []);

  const cancelStream = useCallback(() => {
    socketRef.current?.emit("cancel");
    setIsStreaming(false);
  }, []);

  return { content, isStreaming, streamChat, cancelStream };
}
```

## 流式响应处理

### 1. Token 缓冲

```typescript
// token-buffer.service.ts
@Injectable()
export class TokenBufferService {
  // 缓冲小块 token，批量发送以减少网络开销
  async *bufferStream(
    stream: AsyncIterable<StreamChunk>,
    bufferSize: number = 5,
    flushIntervalMs: number = 100,
  ): AsyncIterable<StreamChunk> {
    let buffer = "";
    let lastFlush = Date.now();

    for await (const chunk of stream) {
      if (chunk.type === "content") {
        buffer += chunk.content;

        // 缓冲区满或超时，则刷新
        const shouldFlush =
          buffer.length >= bufferSize ||
          Date.now() - lastFlush >= flushIntervalMs;

        if (shouldFlush && buffer) {
          yield { type: "content", content: buffer };
          buffer = "";
          lastFlush = Date.now();
        }
      } else {
        // 非内容块直接传递
        if (buffer) {
          yield { type: "content", content: buffer };
          buffer = "";
        }
        yield chunk;
      }
    }

    // 刷新剩余缓冲
    if (buffer) {
      yield { type: "content", content: buffer };
    }
  }
}
```

### 2. Markdown 流式渲染

````typescript
// StreamingMarkdown.tsx
import ReactMarkdown from 'react-markdown';

export function StreamingMarkdown({ content }: { content: string }) {
  // 处理不完整的 Markdown
  const safeContent = useMemo(() => {
    // 确保代码块闭合
    const codeBlockCount = (content.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      return content + '\n```';
    }

    // 确保粗体/斜体闭合
    let result = content;
    const boldCount = (result.match(/\*\*/g) || []).length;
    if (boldCount % 2 !== 0) {
      result += '**';
    }

    return result;
  }, [content]);

  return (
    <div className="streaming-markdown">
      <ReactMarkdown>{safeContent}</ReactMarkdown>
      <span className="cursor animate-blink">|</span>
    </div>
  );
}
````

### 3. 打字机效果

```typescript
// TypewriterEffect.tsx
export function TypewriterEffect({
  content,
  speed = 20,
}: {
  content: string;
  speed?: number;
}) {
  const [displayContent, setDisplayContent] = useState('');
  const contentRef = useRef(content);

  useEffect(() => {
    // 内容更新时，增量显示新内容
    const newContent = content.slice(contentRef.current.length);
    contentRef.current = content;

    if (newContent) {
      let index = 0;
      const timer = setInterval(() => {
        if (index < newContent.length) {
          setDisplayContent(prev => prev + newContent[index]);
          index++;
        } else {
          clearInterval(timer);
        }
      }, speed);

      return () => clearInterval(timer);
    }
  }, [content, speed]);

  return <span>{displayContent}</span>;
}
```

## 错误处理与重试

```typescript
// resilient-stream.service.ts
@Injectable()
export class ResilientStreamService {
  async *streamWithRetry(
    request: ChatRequest,
    maxRetries: number = 3,
  ): AsyncIterable<StreamChunk> {
    let retries = 0;
    let collectedContent = "";

    while (retries < maxRetries) {
      try {
        const stream = this.aiService.streamChat({
          ...request,
          // 从上次断点继续
          messages: collectedContent
            ? [
                ...request.messages,
                { role: "assistant", content: collectedContent },
                { role: "user", content: "请继续" },
              ]
            : request.messages,
        });

        for await (const chunk of stream) {
          if (chunk.type === "content") {
            collectedContent += chunk.content;
          }
          yield chunk;
        }

        return; // 成功完成
      } catch (error) {
        retries++;

        if (retries >= maxRetries) {
          yield {
            type: "error",
            message: `Stream failed after ${maxRetries} retries: ${error.message}`,
          };
          return;
        }

        yield {
          type: "retry",
          attempt: retries,
          message: `Retrying... (${retries}/${maxRetries})`,
        };

        await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
      }
    }
  }
}
```

## 性能优化

### 1. 连接复用

```typescript
// 使用 HTTP/2 或 WebSocket 连接复用
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
});

const openai = new OpenAI({
  httpAgent: agent,
});
```

### 2. 背压处理

```typescript
// backpressure-stream.ts
async function* backpressureStream(
  source: AsyncIterable<StreamChunk>,
  highWaterMark: number = 100,
): AsyncIterable<StreamChunk> {
  const buffer: StreamChunk[] = [];
  let paused = false;

  for await (const chunk of source) {
    buffer.push(chunk);

    // 缓冲区满时暂停
    if (buffer.length >= highWaterMark) {
      paused = true;
    }

    // 消费缓冲区
    while (buffer.length > 0) {
      yield buffer.shift()!;
    }

    paused = false;
  }
}
```

## 参考资源

- [Server-Sent Events 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [OpenAI Streaming API](https://platform.openai.com/docs/api-reference/chat/create#chat-create-stream)
- [Socket.io 文档](https://socket.io/docs/)
