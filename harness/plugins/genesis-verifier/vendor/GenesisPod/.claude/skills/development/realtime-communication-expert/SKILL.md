---
name: Realtime Communication Expert
description: |
  Design and implement WebSocket/Socket.io Gateway, event-driven architecture, and real-time features.
  Trigger keywords: websocket, socket.io, gateway, realtime, streaming, events, sse
  Not for: REST API (-> api-developer), frontend state (-> state-management-expert)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [websocket, socket.io, gateway, realtime, events, streaming]
boundaries:
  includes:
    - WebSocket Gateway development
    - Socket.io integration
    - Event-driven architecture
    - Real-time data streaming
    - Connection management
  excludes:
    - REST API development
    - Frontend state management
  handoff:
    - skill: api-developer
      when: REST endpoints alongside WebSocket
    - skill: state-management-expert
      when: Frontend real-time state updates
---

# Realtime Communication Expert

> Detailed docs: `references/`

## Architecture Overview

```
Frontend Clients (React + Socket.io Client)
            ↕ WebSocket Connection
Backend Gateways (/ai-teams, /ai-writing, /ai-studio)
            ↕
Event Emitter Service → Redis Pub/Sub / Bull Queue
```

## Key Files

```
backend/src/modules/
├── ai-app/{module}/
│   ├── {module}.gateway.ts           # WebSocket Gateway
│   └── services/events/
│       └── {module}-event-emitter.service.ts
└── common/events/
    ├── event-emitter.service.ts      # Base event service
    └── event-types.ts                # Event type definitions
```

## Quick Reference

### NestJS Gateway (Backend)

```typescript
@WebSocketGateway({ namespace: "/ai-teams", cors: { origin: "*" } })
export class AITeamsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;

  @SubscribeMessage("join:mission")
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { missionId: string },
  ) {
    client.join(`mission:${data.missionId}`);
  }

  emitToMission(missionId: string, event: string, data: any) {
    this.server.to(`mission:${missionId}`).emit(event, data);
  }
}
```

### Socket.io Client (Frontend)

```typescript
const { isConnected, emit, on, off } = useSocket({
  namespace: "/ai-teams",
  auth: { token: getAccessToken() },
});

useEffect(() => {
  emit("join:mission", { missionId });
  on("stream:chunk", (data) => setContent((prev) => prev + data.content));
  return () => emit("leave:mission", { missionId });
}, [missionId]);
```

### SSE Streaming (Backend)

```typescript
@Get('stream/:id')
async stream(@Param('id') id: string, @Res() res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  for await (const chunk of this.service.streamGeneration(id)) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}
```

## Event Types

| Category | Events                                                                      |
| -------- | --------------------------------------------------------------------------- |
| Mission  | `mission:created`, `mission:started`, `mission:completed`, `mission:failed` |
| Task     | `task:started`, `task:progress`, `task:completed`                           |
| Stream   | `stream:chunk`, `stream:error`, `stream:end`                                |
| Agent    | `agent:thinking`, `agent:message`, `agent:action`                           |

## Best Practices

1. **Use rooms** for targeted broadcasts (`client.join/leave`)
2. **Authenticate** via handshake (`client.handshake.auth.token`)
3. **Heartbeat** every 30s for connection health
4. **Reconnect** with exponential backoff (1s -> 5s max)
5. **Namespace** per feature domain (`/ai-teams`, `/ai-writing`)

## Related Docs

- [WebSocket Gateway Guide](references/websocket-gateway.md)
- [Socket.io Client Hook](references/socket-io-client.md)
- [SSE Streaming](references/sse-streaming.md)
- [Connection Management](references/connection-management.md)
