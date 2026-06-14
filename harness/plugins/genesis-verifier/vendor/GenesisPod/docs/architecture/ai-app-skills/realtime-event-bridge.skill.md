---
name: realtime-event-bridge
description: |
  Real-time event bridge pattern for AI App modules. Defines WebSocket gateway setup,
  event emitter architecture, dual emission (WS + DB persistence), and reconnection recovery.
  Use when: websocket-gateway, realtime-progress, event-driven, live-updates, sse-streaming.
version: "2.0.0"
domain: general
layer: content
taskTypes:
  - gateway-implementation
  - event-system-design
  - realtime-progress
priority: 85
author: genesis-ai
source: local
tags:
  - realtime
  - websocket
  - event-bridge
  - progress
  - gateway
  - best-practice
tokenBudget: 3500
executionMode: prompt
taskProfile:
  creativity: low
  outputLength: long
---

# 实时事件桥接 Skill

## 角色定位

你是 GenesisPod 平台的实时通信架构师，负责设计 WebSocket 网关和事件驱动的进度推送系统。你的标准来自 Topic Insights 验证的三层事件架构。

## 核心原则

**事件类型用语义名（`LEADER_THINKING`），不用技术名（`ws:message`）。事件同时推送到 WebSocket 和持久化到数据库。**

## 三层事件架构

```
Service 层                    中间层                      客户端
───────────                   ────────                    ──────
emit(语义事件)  ──→  EventEmitterService  ──→  Gateway  ──→  WebSocket room  ──→  UI
                          │
                          └──→  DB 持久化 (AgentActivity / TeamMessage)
```

### 第 1 层：EventEmitterService（事件源）

```typescript
@Injectable()
export class YourEventEmitterService {
  private emitHandler?: (roomId: string, event: string, data: unknown) => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nestEventEmitter: EventEmitter2,
  ) {}

  // ★ Gateway 在 afterInit() 中注册 handler（避免循环依赖）
  registerEmitHandler(
    handler: (roomId: string, event: string, data: unknown) => void,
  ): void {
    this.emitHandler = handler;
  }

  // 通用事件发射（双管道）
  private async emitEvent(
    roomId: string,
    eventName: string,
    data: unknown,
    persist: boolean = false,
  ): Promise<void> {
    // 管道 1: WebSocket 推送（fire-and-forget）
    if (this.emitHandler) {
      this.emitHandler(roomId, eventName, data);
    }

    // 管道 2: 内部 EventEmitter2（供其他服务监听）
    this.nestEventEmitter.emit(eventName, {
      roomId,
      data,
      timestamp: new Date(),
    });

    // 管道 3: DB 持久化（可选，异步不阻塞）
    if (persist) {
      void this.persistEvent(roomId, eventName, data).catch((err) => {
        this.logger.warn(
          `Failed to persist event ${eventName}: ${err.message}`,
        );
      });
    }
  }

  // ★ 语义化事件方法（每个事件类型一个方法）
  async emitMissionStarted(
    roomId: string,
    data: MissionStartedData,
  ): Promise<void> {
    return this.emitEvent(roomId, YourEvents.MISSION_STARTED, data, true);
  }

  async emitProgress(roomId: string, data: ProgressData): Promise<void> {
    return this.emitEvent(roomId, YourEvents.PROGRESS, data, false); // 进度不持久化
  }

  async emitTaskCompleted(
    roomId: string,
    data: TaskCompletedData,
  ): Promise<void> {
    return this.emitEvent(roomId, YourEvents.TASK_COMPLETED, data, true);
  }

  async emitFailed(roomId: string, data: FailedData): Promise<void> {
    return this.emitEvent(roomId, YourEvents.FAILED, data, true);
  }
}
```

### 第 2 层：WebSocket Gateway

```typescript
@WebSocketGateway({
  namespace: "/your-app",
  cors: {
    origin: (origin, callback) => {
      // ★ 使用环境变量，不硬编码域名
      const corsOrigins = process.env.CORS_ORIGINS?.split(",") || [];
      const allowed =
        !origin ||
        origin.match(/^http:\/\/localhost:\d+/) ||
        corsOrigins.some((o) => origin.endsWith(o));
      callback(null, !!allowed);
    },
    credentials: true,
  },
})
export class YourAppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(YourAppGateway.name);
  private userConnections = new Map<string, Set<string>>();
  private readonly MAX_CONNECTIONS_PER_USER = 5;

  constructor(
    private readonly eventEmitter: YourEventEmitterService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // ★ 初始化：注册认证中间件 + 事件 handler
  afterInit(): void {
    // 1. JWT 认证中间件
    this.server.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers.authorization?.replace("Bearer ", "");
        if (!token) return next(new Error("Authentication required"));

        const payload = await this.jwtService.verifyAsync(token);
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, email: true, username: true },
        });
        if (!user) return next(new Error("User not found"));

        socket.data.user = user;
        next();
      } catch {
        next(new Error("Authentication failed"));
      }
    });

    // 2. 注册事件 handler（解耦 Gateway ↔ EventEmitter 循环依赖）
    this.eventEmitter.registerEmitHandler((roomId, event, data) =>
      this.server.to(roomId).emit(event, data),
    );
  }

  // ★ 连接管理：限制每用户最大连接数
  async handleConnection(client: Socket): Promise<void> {
    const user = client.data?.user;
    if (!user) {
      client.disconnect(true);
      return;
    }

    if (!this.userConnections.has(user.id)) {
      this.userConnections.set(user.id, new Set());
    }
    const sockets = this.userConnections.get(user.id)!;

    // 超出限制：踢掉最老的连接
    if (sockets.size >= this.MAX_CONNECTIONS_PER_USER) {
      const oldest = Array.from(sockets)[0];
      const oldSocket = this.server.sockets.sockets.get(oldest);
      if (oldSocket) {
        oldSocket.emit("connection:replaced", {
          message: "New connection opened",
        });
        oldSocket.disconnect(true);
      }
      sockets.delete(oldest);
    }

    sockets.add(client.id);
  }

  handleDisconnect(client: Socket): void {
    const user = client.data?.user;
    if (user) {
      this.userConnections.get(user.id)?.delete(client.id);
    }
  }

  // ★ 加入房间（含权限检查）
  @SubscribeMessage("join:room")
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { resourceId: string },
  ): Promise<{ success: boolean; error?: string }> {
    const user = client.data?.user;
    if (!user) return { success: false, error: "Not authenticated" };

    // 检查用户是否有权访问该资源
    const resource = await this.prisma.yourResource.findUnique({
      where: { id: data.resourceId },
      select: { userId: true },
    });

    if (!resource || resource.userId !== user.id) {
      return { success: false, error: "Access denied" };
    }

    const roomName = `your-app:${data.resourceId}`;
    await client.join(roomName);
    return { success: true };
  }

  // ★ 状态同步（断线重连恢复）
  @SubscribeMessage("sync:state")
  async handleSyncState(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      resourceId: string;
      lastKnownPhase?: string;
      lastKnownProgress?: number;
    },
  ): Promise<SyncResponse> {
    // 从 DB 加载当前状态
    const currentMission = await this.prisma.mission.findFirst({
      where: { resourceId: data.resourceId },
      orderBy: { createdAt: "desc" },
    });

    if (!currentMission) {
      return { needsRecovery: false, state: { phase: "idle", progress: 0 } };
    }

    // 检测客户端状态是否过期
    const needsRecovery =
      data.lastKnownPhase !== currentMission.phase ||
      Math.abs((currentMission.progress ?? 0) - (data.lastKnownProgress ?? 0)) >
        10;

    return {
      needsRecovery,
      state: {
        phase: currentMission.phase,
        progress: currentMission.progress ?? 0,
        missionId: currentMission.id,
      },
    };
  }
}
```

### 第 3 层：前端订阅

```typescript
// 前端 WebSocket hook 示例
function useRealtimeProgress(resourceId: string) {
  const [progress, setProgress] = useState({ phase: "idle", progress: 0 });

  useEffect(() => {
    const socket = io("/your-app", { auth: { token } });

    socket.emit("join:room", { resourceId });

    socket.on("progress", (data) => setProgress(data));
    socket.on("task:completed", (data) => {
      /* 更新 UI */
    });
    socket.on("failed", (data) => {
      /* 显示错误 */
    });
    socket.on("connection:replaced", () => {
      /* 提示用户 */
    });

    // 断线重连后同步状态
    socket.on("connect", () => {
      socket.emit("sync:state", {
        resourceId,
        lastKnownPhase: progress.phase,
        lastKnownProgress: progress.progress,
      });
    });

    return () => socket.disconnect();
  }, [resourceId]);

  return progress;
}
```

## 事件类型定义规范

```typescript
// ★ 用 const object 定义事件名（不用 enum，方便字符串匹配）
export const YOUR_APP_EVENTS = {
  // Mission 生命周期
  MISSION_STARTED: "mission:started",
  MISSION_PROGRESS: "mission:progress",
  MISSION_COMPLETED: "mission:completed",
  MISSION_FAILED: "mission:failed",

  // Leader 事件
  LEADER_THINKING: "leader:thinking",
  LEADER_PLAN_READY: "leader:plan-ready",

  // Agent 事件
  AGENT_WORKING: "agent:working",
  AGENT_COMPLETED: "agent:completed",

  // Task 事件
  TASK_STARTED: "task:started",
  TASK_PROGRESS: "task:progress",
  TASK_COMPLETED: "task:completed",
} as const;
```

## 进度阶段权重

```typescript
// Topic Insights 验证的阶段权重分配
const PHASE_WEIGHTS = {
  planning: 0.1, // 10% — Leader 规划
  executing: 0.6, // 60% — 主体任务执行
  reviewing: 0.15, // 15% — 质量审核
  synthesizing: 0.15, // 15% — 综合/报告生成
};

// 计算总进度
function calculateOverallProgress(
  phase: string,
  phaseProgress: number,
): number {
  const weights = Object.entries(PHASE_WEIGHTS);
  let cumulative = 0;
  for (const [p, weight] of weights) {
    if (p === phase) {
      return Math.round((cumulative + phaseProgress * weight) * 100);
    }
    cumulative += weight;
  }
  return Math.round(cumulative * 100);
}
```

## 持久化策略

| 事件类型               | 持久化 | 原因                   |
| ---------------------- | ------ | ---------------------- |
| Mission 开始/完成/失败 | 是     | 审计追踪               |
| Leader 思考/规划       | 是     | 用户可以回看           |
| Agent 工作中           | 是     | Agent 活动日志         |
| 进度更新               | 否     | 频繁更新，只需实时推送 |
| Task 完成              | 是     | 结果记录               |
| 连接替换               | 否     | 临时状态               |

## 禁忌

1. **禁止在构造函数中注册 handler** -- 用 afterInit() 避免循环依赖
2. **禁止硬编码 CORS 域名** -- 用 `CORS_ORIGINS` 环境变量
3. **禁止无限制连接** -- 每用户最多 5 个，超了踢最老的
4. **禁止 emit 后 await** -- WebSocket emit 是同步的，不需要 await
5. **禁止持久化进度事件** -- 高频进度更新只推送不存储
6. **禁止在事件 handler 里抛异常** -- 用 try-catch 包裹，失败只记日志

{{#if gatewayContext}}

## 网关上下文

{{{gatewayContext}}}
{{/if}}
