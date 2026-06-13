# Server-Sent Events (SSE)

## 概述

SSE 是一种服务器向客户端推送事件的单向通讯协议，特别适合 AI 流式响应场景。

## SSE vs WebSocket

| 特性       | SSE                  | WebSocket  |
| ---------- | -------------------- | ---------- |
| 通讯方向   | 单向 (服务器→客户端) | 双向       |
| 协议       | HTTP                 | WebSocket  |
| 自动重连   | 内置支持             | 需手动实现 |
| 浏览器支持 | 广泛                 | 广泛       |
| 代理兼容性 | 好                   | 可能有问题 |
| 适用场景   | 流式输出、通知       | 实时交互   |

## NestJS SSE 实现

### 1. 基础 SSE 端点

```typescript
// sse.controller.ts
import { Controller, Get, Sse, Param, Query } from "@nestjs/common";
import { Observable, interval, map, takeUntil, Subject } from "rxjs";

@Controller("sse")
export class SseController {
  @Get("events")
  @Sse()
  events(): Observable<MessageEvent> {
    // 每秒发送一个事件
    return interval(1000).pipe(
      map((count) => ({
        data: JSON.stringify({
          type: "heartbeat",
          count,
          timestamp: new Date().toISOString(),
        }),
      })),
    );
  }
}
```

### 2. AI 流式响应

```typescript
// ai-sse.controller.ts
@Controller("ai")
export class AISseController {
  constructor(private aiService: AIService) {}

  @Post("chat/stream")
  @Sse()
  streamChat(@Body() request: ChatRequest): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const stream = this.aiService.streamChat(request);

      (async () => {
        try {
          // 发送开始事件
          subscriber.next({
            data: JSON.stringify({ type: "start" }),
          });

          for await (const chunk of stream) {
            subscriber.next({
              data: JSON.stringify({
                type: "content",
                content: chunk.content,
              }),
            });
          }

          // 发送结束事件
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

      // 清理逻辑
      return () => {
        // 可以在这里取消流
      };
    });
  }
}
```

### 3. 带用户认证的 SSE

```typescript
// authenticated-sse.controller.ts
@Controller("sse")
@UseGuards(JwtAuthGuard)
export class AuthenticatedSseController {
  @Get("notifications")
  @Sse()
  notifications(@Request() req): Observable<MessageEvent> {
    const userId = req.user.id;

    return new Observable((subscriber) => {
      // 订阅用户通知
      const subscription = this.notificationService
        .getUserNotifications(userId)
        .subscribe({
          next: (notification) => {
            subscriber.next({
              data: JSON.stringify(notification),
              id: notification.id,
              type: "notification",
            });
          },
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });

      return () => subscription.unsubscribe();
    });
  }
}
```

### 4. 进度追踪

```typescript
// progress-sse.controller.ts
@Controller("tasks")
export class ProgressSseController {
  @Get(":taskId/progress")
  @Sse()
  trackProgress(@Param("taskId") taskId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const checkProgress = async () => {
        while (true) {
          const task = await this.taskService.getTask(taskId);

          subscriber.next({
            data: JSON.stringify({
              taskId,
              status: task.status,
              progress: task.progress,
              message: task.message,
            }),
            type: "progress",
          });

          if (task.status === "completed" || task.status === "failed") {
            subscriber.complete();
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      };

      checkProgress();
    });
  }
}
```

## 前端 SSE 消费

### 1. 原生 EventSource

```typescript
// 基础用法
const eventSource = new EventSource("/api/sse/events");

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Received:", data);
};

eventSource.onerror = (error) => {
  console.error("SSE error:", error);
  eventSource.close();
};

// 监听特定事件类型
eventSource.addEventListener("notification", (event) => {
  const notification = JSON.parse(event.data);
  showNotification(notification);
});

// 关闭连接
eventSource.close();
```

### 2. 带认证的 SSE (fetch)

```typescript
// EventSource 不支持自定义 headers，使用 fetch 替代
async function* streamSSE(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${getToken()}`,
      Accept: "text/event-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) throw new Error("No reader available");

  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 解析 SSE 消息
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;

        try {
          yield JSON.parse(data);
        } catch {
          yield data;
        }
      }
    }
  }
}

// 使用
async function handleStream() {
  for await (const chunk of streamSSE("/api/ai/chat/stream", {
    method: "POST",
    body: JSON.stringify({ message: "Hello" }),
  })) {
    if (chunk.type === "content") {
      appendContent(chunk.content);
    }
  }
}
```

### 3. React Hook 封装

```typescript
// hooks/useSSE.ts
export function useSSE<T>(url: string, options?: {
  onMessage?: (data: T) => void;
  onError?: (error: Event) => void;
  enabled?: boolean;
}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (options?.enabled === false) return;

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        setData(parsed);
        options?.onMessage?.(parsed);
      } catch (e) {
        setData(event.data as T);
        options?.onMessage?.(event.data as T);
      }
    };

    eventSource.onerror = (err) => {
      setIsConnected(false);
      setError(new Error('SSE connection error'));
      options?.onError?.(err);
    };

    return () => {
      eventSource.close();
    };
  }, [url, options?.enabled]);

  const close = useCallback(() => {
    eventSourceRef.current?.close();
    setIsConnected(false);
  }, []);

  return { data, error, isConnected, close };
}

// 使用示例
function NotificationBanner() {
  const { data: notification } = useSSE<Notification>('/api/sse/notifications', {
    onMessage: (n) => {
      toast.show(n.message);
    },
  });

  return notification ? (
    <div className="notification">{notification.message}</div>
  ) : null;
}
```

### 4. AI 流式响应 Hook

```typescript
// hooks/useAIStream.ts
export function useAIStream() {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async (message: string) => {
    setContent("");
    setIsStreaming(true);
    setError(null);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ message }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No reader");

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
      if (err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setIsStreaming(false);
    }
  }, []);

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { content, isStreaming, error, startStream, stopStream };
}
```

## SSE 最佳实践

### 1. 心跳保持连接

```typescript
// 服务端
@Get('events')
@Sse()
eventsWithHeartbeat(): Observable<MessageEvent> {
  const heartbeat$ = interval(30000).pipe(
    map(() => ({ data: JSON.stringify({ type: 'heartbeat' }) }))
  );

  const events$ = this.eventService.getEvents().pipe(
    map(event => ({ data: JSON.stringify(event) }))
  );

  return merge(heartbeat$, events$);
}
```

### 2. 事件 ID 和重连

```typescript
// 服务端发送事件 ID
subscriber.next({
  data: JSON.stringify(event),
  id: event.id,  // 客户端重连时会发送 Last-Event-ID
  retry: 3000,   // 建议重连间隔
});

// 服务端处理 Last-Event-ID
@Get('events')
@Sse()
events(@Headers('last-event-id') lastEventId?: string) {
  // 从 lastEventId 之后开始发送事件
  return this.eventService.getEventsSince(lastEventId);
}
```

### 3. 连接管理

```typescript
// 客户端超时重连
class ManagedEventSource {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(url: string) {
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.eventSource.onerror = () => {
      this.eventSource?.close();

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(
          1000 * Math.pow(2, this.reconnectAttempts),
          30000,
        );
        setTimeout(() => {
          this.reconnectAttempts++;
          this.connect(url);
        }, delay);
      }
    };
  }

  close() {
    this.eventSource?.close();
    this.eventSource = null;
  }
}
```

## 参考资源

- [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [HTML Living Standard - SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [NestJS Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events)
