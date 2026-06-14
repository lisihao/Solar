# WebSocket Gateway Guide

## Basic Gateway Structure

```typescript
// ai-teams.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Logger } from "@nestjs/common";

@WebSocketGateway({
  namespace: "/ai-teams",
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  },
})
export class AITeamsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AITeamsGateway.name);
  private readonly connectedClients = new Map<string, Socket>();

  afterInit(server: Server) {
    this.logger.log("AI Teams Gateway initialized");
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    this.connectedClients.set(client.id, client);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.connectedClients.delete(client.id);
  }

  @SubscribeMessage("join:mission")
  handleJoinMission(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { missionId: string },
  ) {
    const room = `mission:${data.missionId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return { event: "joined", room };
  }

  @SubscribeMessage("leave:mission")
  handleLeaveMission(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { missionId: string },
  ) {
    const room = `mission:${data.missionId}`;
    client.leave(room);
    return { event: "left", room };
  }

  // Emit to specific mission room
  emitToMission(missionId: string, event: string, data: any) {
    this.server.to(`mission:${missionId}`).emit(event, data);
  }

  // Emit to all connected clients
  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }
}
```

## Gateway with Authentication

```typescript
@WebSocketGateway({
  namespace: "/ai-teams",
  cors: { origin: "*", credentials: true },
})
export class AuthenticatedGateway implements OnGatewayConnection {
  constructor(private readonly authService: AuthService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.split(" ")[1];

      if (!token) {
        throw new UnauthorizedException("No token provided");
      }

      const user = await this.authService.validateToken(token);
      client.data.user = user;

      this.logger.log(`User ${user.id} connected`);
    } catch (error) {
      this.logger.error(`Authentication failed: ${error.message}`);
      client.emit("error", { message: "Authentication failed" });
      client.disconnect();
    }
  }
}
```

## Event Emitter Service

### Base Event Emitter

```typescript
// event-emitter.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

export interface BaseEvent {
  type: string;
  timestamp: Date;
  payload: any;
}

@Injectable()
export class EventEmitterService {
  private readonly logger = new Logger(EventEmitterService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  emit(event: string, payload: any) {
    this.logger.debug(`Emitting event: ${event}`);
    this.eventEmitter.emit(event, {
      type: event,
      timestamp: new Date(),
      payload,
    });
  }

  on(event: string, callback: (data: BaseEvent) => void) {
    this.eventEmitter.on(event, callback);
  }

  once(event: string, callback: (data: BaseEvent) => void) {
    this.eventEmitter.once(event, callback);
  }

  removeListener(event: string, callback: (data: BaseEvent) => void) {
    this.eventEmitter.removeListener(event, callback);
  }
}
```

### Domain-Specific Event Emitter

```typescript
// team-event-emitter.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { AITeamsGateway } from "../ai-teams.gateway";

export enum TeamEventType {
  MISSION_CREATED = "mission:created",
  MISSION_STARTED = "mission:started",
  MISSION_COMPLETED = "mission:completed",
  MISSION_FAILED = "mission:failed",
  TASK_STARTED = "task:started",
  TASK_COMPLETED = "task:completed",
  AGENT_MESSAGE = "agent:message",
  AGENT_THINKING = "agent:thinking",
  PROGRESS_UPDATE = "progress:update",
  STREAM_CHUNK = "stream:chunk",
  STREAM_END = "stream:end",
}

@Injectable()
export class TeamEventEmitterService {
  private readonly logger = new Logger(TeamEventEmitterService.name);

  constructor(private readonly gateway: AITeamsGateway) {}

  emitMissionStarted(missionId: string, data: any) {
    this.gateway.emitToMission(missionId, TeamEventType.MISSION_STARTED, data);
  }

  emitTaskProgress(missionId: string, taskId: string, progress: number) {
    this.gateway.emitToMission(missionId, TeamEventType.PROGRESS_UPDATE, {
      taskId,
      progress,
      timestamp: new Date(),
    });
  }

  emitAgentMessage(missionId: string, message: AgentMessage) {
    this.gateway.emitToMission(missionId, TeamEventType.AGENT_MESSAGE, message);
  }

  emitStreamChunk(missionId: string, chunk: string, metadata?: any) {
    this.gateway.emitToMission(missionId, TeamEventType.STREAM_CHUNK, {
      content: chunk,
      metadata,
      timestamp: new Date(),
    });
  }

  emitStreamEnd(missionId: string, result: any) {
    this.gateway.emitToMission(missionId, TeamEventType.STREAM_END, {
      result,
      timestamp: new Date(),
    });
  }
}
```

## Event Types Reference

```typescript
// event-types.ts
export enum CommonEvents {
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  ERROR = "error",
  PING = "ping",
  PONG = "pong",
}

export enum MissionEvents {
  CREATED = "mission:created",
  STARTED = "mission:started",
  PAUSED = "mission:paused",
  RESUMED = "mission:resumed",
  COMPLETED = "mission:completed",
  FAILED = "mission:failed",
  CANCELLED = "mission:cancelled",
}

export enum TaskEvents {
  STARTED = "task:started",
  PROGRESS = "task:progress",
  COMPLETED = "task:completed",
  FAILED = "task:failed",
}

export enum StreamEvents {
  CHUNK = "stream:chunk",
  ERROR = "stream:error",
  END = "stream:end",
}

export enum AgentEvents {
  THINKING = "agent:thinking",
  MESSAGE = "agent:message",
  ACTION = "agent:action",
}
```
