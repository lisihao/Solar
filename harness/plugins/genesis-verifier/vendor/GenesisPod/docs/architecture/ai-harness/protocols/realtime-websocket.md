# WebSocket 实时通讯

## 概述

GenesisPod 使用 Socket.io 实现 WebSocket 实时通讯，支持 AI 团队协作、实时通知和流式响应。

## Socket.io 核心原理

### 1. 协议层次

```
┌─────────────────────────────────────────────────────────────┐
│                    Socket.io 协议栈                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Socket.io Protocol                       │   │
│  │  • 事件驱动                                           │   │
│  │  • 命名空间                                           │   │
│  │  • 房间                                               │   │
│  │  • 确认机制                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Engine.io Protocol                       │   │
│  │  • 连接管理                                           │   │
│  │  • 心跳检测                                           │   │
│  │  • 传输升级                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │  WebSocket   │  │ HTTP Polling │   传输层               │
│  │  (主要)       │  │  (降级)       │                        │
│  └──────────────┘  └──────────────┘                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. 连接生命周期

```
客户端                                    服务器
   │                                        │
   │──── HTTP 升级请求 ────────────────────►│
   │                                        │
   │◄─── 101 Switching Protocols ──────────│
   │                                        │
   │◄═══════ WebSocket 连接建立 ═══════════│
   │                                        │
   │──── ping ─────────────────────────────►│
   │◄─── pong ─────────────────────────────│
   │                                        │
   │──── 事件: 'message' ──────────────────►│
   │◄─── 事件: 'response' ─────────────────│
   │                                        │
   │──── 断开连接 ─────────────────────────►│
   │                                        │
```

## NestJS WebSocket 网关

### 1. 基础网关配置

```typescript
// ai-teams.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

@WebSocketGateway({
  namespace: "/ai-teams",
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
  },
  transports: ["websocket", "polling"],
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB
  pingTimeout: 60000,
  pingInterval: 25000,
})
export class AITeamsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly connectedUsers = new Map<string, UserConnection>();

  handleConnection(client: Socket) {
    const userId = this.extractUserId(client);
    console.log(`Client connected: ${client.id}, User: ${userId}`);

    this.connectedUsers.set(client.id, {
      socketId: client.id,
      userId,
      connectedAt: new Date(),
    });

    // 通知其他用户
    client.broadcast.emit("user:online", { userId });
  }

  handleDisconnect(client: Socket) {
    const connection = this.connectedUsers.get(client.id);
    console.log(`Client disconnected: ${client.id}`);

    if (connection) {
      this.connectedUsers.delete(client.id);
      client.broadcast.emit("user:offline", { userId: connection.userId });
    }
  }

  private extractUserId(client: Socket): string {
    // 从 handshake 中提取用户信息
    return client.handshake.auth?.userId || client.handshake.query?.userId;
  }
}
```

### 2. 房间管理

```typescript
// 房间 (Rooms) - 用于分组广播
@SubscribeMessage('join:topic')
async handleJoinTopic(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { topicId: string },
) {
  const roomName = `topic:${data.topicId}`;

  // 加入房间
  await client.join(roomName);

  // 通知房间内其他用户
  client.to(roomName).emit('user:joined', {
    userId: client.data.userId,
    topicId: data.topicId,
  });

  // 返回房间当前成员
  const members = await this.getRoomMembers(roomName);
  return { success: true, members };
}

@SubscribeMessage('leave:topic')
async handleLeaveTopic(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { topicId: string },
) {
  const roomName = `topic:${data.topicId}`;

  // 离开房间
  await client.leave(roomName);

  // 通知房间内其他用户
  client.to(roomName).emit('user:left', {
    userId: client.data.userId,
    topicId: data.topicId,
  });

  return { success: true };
}

private async getRoomMembers(roomName: string): Promise<string[]> {
  const sockets = await this.server.in(roomName).fetchSockets();
  return sockets.map(s => s.data.userId);
}
```

### 3. 消息处理

```typescript
// 发送消息到话题
@SubscribeMessage('message:send')
async handleSendMessage(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: SendMessageDto,
) {
  const { topicId, content, type } = data;
  const userId = client.data.userId;

  // 保存消息到数据库
  const message = await this.messageService.create({
    topicId,
    userId,
    content,
    type,
  });

  // 广播到房间
  const roomName = `topic:${topicId}`;
  this.server.to(roomName).emit('message:new', {
    id: message.id,
    topicId,
    userId,
    content,
    type,
    createdAt: message.createdAt,
  });

  return { success: true, messageId: message.id };
}

// 消息确认 (ACK)
@SubscribeMessage('message:ack')
async handleMessageAck(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { messageId: string },
) {
  await this.messageService.markAsRead(data.messageId, client.data.userId);
  return { success: true };
}
```

### 4. AI 团队实时协作

```typescript
// AI 团队成员发言
@SubscribeMessage('ai:speak')
async handleAISpeak(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: {
    topicId: string;
    agentId: string;
    prompt: string;
  },
) {
  const roomName = `topic:${data.topicId}`;

  // 通知开始生成
  this.server.to(roomName).emit('ai:speaking', {
    agentId: data.agentId,
    topicId: data.topicId,
  });

  try {
    // 流式生成 AI 响应
    const stream = this.aiService.streamChat({
      agentId: data.agentId,
      prompt: data.prompt,
    });

    for await (const chunk of stream) {
      this.server.to(roomName).emit('ai:chunk', {
        agentId: data.agentId,
        topicId: data.topicId,
        content: chunk.content,
      });
    }

    // 完成
    this.server.to(roomName).emit('ai:complete', {
      agentId: data.agentId,
      topicId: data.topicId,
    });

  } catch (error) {
    this.server.to(roomName).emit('ai:error', {
      agentId: data.agentId,
      topicId: data.topicId,
      error: error.message,
    });
  }
}
```

## 前端 Socket.io 客户端

### 1. 连接管理

```typescript
// hooks/useSocket.ts
import { io, Socket } from "socket.io-client";
import { useEffect, useRef, useState, useCallback } from "react";

export function useSocket(namespace: string = "/ai-teams") {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(`${process.env.NEXT_PUBLIC_API_URL}${namespace}`, {
      auth: {
        userId: getCurrentUserId(),
        token: getAuthToken(),
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socket.on("connect", () => {
      setIsConnected(true);
      setConnectionError(null);
      console.log("Socket connected:", socket.id);
    });

    socket.on("disconnect", (reason) => {
      setIsConnected(false);
      console.log("Socket disconnected:", reason);
    });

    socket.on("connect_error", (error) => {
      setConnectionError(error.message);
      console.error("Socket connection error:", error);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [namespace]);

  const emit = useCallback(<T>(event: string, data?: any): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current?.connected) {
        reject(new Error("Socket not connected"));
        return;
      }

      socketRef.current.emit(event, data, (response: T) => {
        resolve(response);
      });
    });
  }, []);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    connectionError,
    emit,
    on,
  };
}
```

### 2. 话题订阅 Hook

```typescript
// hooks/useTopic.ts
export function useTopic(topicId: string) {
  const { socket, emit, on, isConnected } = useSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [aiSpeaking, setAISpeaking] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !topicId) return;

    // 加入话题
    emit("join:topic", { topicId }).then((response: any) => {
      setMembers(response.members);
    });

    // 监听新消息
    const unsubMessage = on("message:new", (message: Message) => {
      setMessages((prev) => [...prev, message]);
    });

    // 监听用户加入/离开
    const unsubJoin = on("user:joined", (data) => {
      setMembers((prev) => [...prev, data.userId]);
    });

    const unsubLeave = on("user:left", (data) => {
      setMembers((prev) => prev.filter((id) => id !== data.userId));
    });

    // 监听 AI 状态
    const unsubAISpeaking = on("ai:speaking", (data) => {
      setAISpeaking(data.agentId);
    });

    const unsubAIComplete = on("ai:complete", () => {
      setAISpeaking(null);
    });

    return () => {
      emit("leave:topic", { topicId });
      unsubMessage();
      unsubJoin();
      unsubLeave();
      unsubAISpeaking();
      unsubAIComplete();
    };
  }, [isConnected, topicId, emit, on]);

  const sendMessage = useCallback(
    async (content: string, type: string = "text") => {
      return emit("message:send", { topicId, content, type });
    },
    [topicId, emit],
  );

  const requestAISpeak = useCallback(
    async (agentId: string, prompt: string) => {
      return emit("ai:speak", { topicId, agentId, prompt });
    },
    [topicId, emit],
  );

  return {
    messages,
    members,
    aiSpeaking,
    sendMessage,
    requestAISpeak,
  };
}
```

### 3. AI 流式响应 Hook

```typescript
// hooks/useAIStream.ts
export function useAIStream(topicId: string) {
  const { on } = useSocket();
  const [streamingContent, setStreamingContent] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const unsubChunk = on("ai:chunk", (data) => {
      setStreamingContent((prev) => ({
        ...prev,
        [data.agentId]: (prev[data.agentId] || "") + data.content,
      }));
    });

    const unsubComplete = on("ai:complete", (data) => {
      // 清空流式内容，消息已保存
      setStreamingContent((prev) => {
        const { [data.agentId]: _, ...rest } = prev;
        return rest;
      });
    });

    return () => {
      unsubChunk();
      unsubComplete();
    };
  }, [on]);

  return { streamingContent };
}
```

## 连接优化

### 1. 重连策略

```typescript
// 指数退避重连
const socket = io(url, {
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  randomizationFactor: 0.5,
});

// 自定义重连逻辑
socket.io.on("reconnect_attempt", (attempt) => {
  console.log(`Reconnection attempt ${attempt}`);

  // 动态调整传输方式
  if (attempt > 3) {
    socket.io.opts.transports = ["polling", "websocket"];
  }
});

socket.io.on("reconnect_failed", () => {
  // 显示重连失败提示
  showNotification("连接失败，请检查网络");
});
```

### 2. 心跳检测

```typescript
// 服务端配置
@WebSocketGateway({
  pingTimeout: 60000,    // 60秒无响应断开
  pingInterval: 25000,   // 每25秒发送心跳
})

// 客户端监控
socket.io.on('ping', () => {
  console.log('Ping sent');
});

socket.io.on('pong', (latency) => {
  console.log(`Pong received, latency: ${latency}ms`);
});
```

### 3. 消息压缩

```typescript
// 服务端启用压缩
@WebSocketGateway({
  perMessageDeflate: {
    threshold: 1024, // 超过1KB启用压缩
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3,
    },
  },
})
```

## 错误处理

```typescript
// 全局错误处理
@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToWs();
    const client = ctx.getClient<Socket>();

    const error =
      exception instanceof WsException
        ? exception.getError()
        : { message: "Internal server error" };

    client.emit("error", error);
  }
}

// 在 Gateway 中使用
@UseFilters(new WsExceptionFilter())
@WebSocketGateway()
export class AITeamsGateway {
  // ...
}
```

## 参考资源

- [Socket.io 官方文档](https://socket.io/docs/v4/)
- [NestJS WebSocket 文档](https://docs.nestjs.com/websockets/gateways)
- [Engine.io 协议](https://socket.io/docs/v4/engine-io-protocol/)
