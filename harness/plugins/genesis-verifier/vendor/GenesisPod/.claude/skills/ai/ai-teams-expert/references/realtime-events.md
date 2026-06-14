# Real-time Events

## Team Event Types

```typescript
interface TeamEvent {
  type: TeamEventType;
  missionId: string;
  payload: any;
  timestamp: Date;
}

enum TeamEventType {
  MISSION_STARTED = "mission_started",
  TASK_ASSIGNED = "task_assigned",
  TASK_STARTED = "task_started",
  TASK_COMPLETED = "task_completed",
  TASK_REVISION = "task_revision",
  AGENT_TYPING = "agent_typing",
  MISSION_COMPLETED = "mission_completed",
}
```

## Frontend Subscription

```typescript
useEffect(() => {
  const socket = io("/ai-teams");

  socket.on("team_event", (event: TeamEvent) => {
    switch (event.type) {
      case TeamEventType.AGENT_TYPING:
        setTypingAIs((prev) => new Set([...prev, event.payload.agentId]));
        break;
      case TeamEventType.TASK_COMPLETED:
        updateTask(event.payload.taskId, { status: "COMPLETED" });
        break;
      case TeamEventType.TASK_STARTED:
        updateTask(event.payload.taskId, { status: "IN_PROGRESS" });
        break;
      case TeamEventType.MISSION_COMPLETED:
        setMissionStatus("COMPLETED");
        break;
    }
  });

  return () => socket.disconnect();
}, [missionId]);
```

## Backend Event Emitter

```typescript
@Injectable()
export class TeamEventService {
  constructor(@Inject("SOCKET_SERVER") private readonly server: Server) {}

  emitTaskStarted(missionId: string, taskId: string, agentId: string) {
    this.server.to(`mission:${missionId}`).emit("team_event", {
      type: TeamEventType.TASK_STARTED,
      missionId,
      payload: { taskId, agentId },
      timestamp: new Date(),
    });
  }

  emitAgentTyping(missionId: string, agentId: string) {
    this.server.to(`mission:${missionId}`).emit("team_event", {
      type: TeamEventType.AGENT_TYPING,
      missionId,
      payload: { agentId },
      timestamp: new Date(),
    });
  }

  emitTaskCompleted(missionId: string, taskId: string, result: string) {
    this.server.to(`mission:${missionId}`).emit("team_event", {
      type: TeamEventType.TASK_COMPLETED,
      missionId,
      payload: { taskId, result },
      timestamp: new Date(),
    });
  }

  emitMissionCompleted(missionId: string, finalResult: string) {
    this.server.to(`mission:${missionId}`).emit("team_event", {
      type: TeamEventType.MISSION_COMPLETED,
      missionId,
      payload: { finalResult },
      timestamp: new Date(),
    });
  }
}
```

## Typing Indicator Debouncing

```typescript
// Debounce typing events to avoid flooding
const debouncedTyping = useMemo(
  () =>
    debounce((agentId: string) => {
      setTypingAIs((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }, 2000),
  [],
);

// Clear typing indicator after timeout
useEffect(() => {
  typingAIs.forEach((agentId) => {
    debouncedTyping(agentId);
  });
}, [typingAIs, debouncedTyping]);
```

## Room Management

```typescript
@WebSocketGateway({ namespace: "/ai-teams" })
export class TeamGateway {
  @SubscribeMessage("join_mission")
  handleJoinMission(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { missionId: string },
  ) {
    client.join(`mission:${data.missionId}`);
    return { event: "joined", data: { missionId: data.missionId } };
  }

  @SubscribeMessage("leave_mission")
  handleLeaveMission(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { missionId: string },
  ) {
    client.leave(`mission:${data.missionId}`);
  }
}
```
