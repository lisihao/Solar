# Notification System 设计

> 用户站内通知系统的目标态：**事件驱动的持久化 + 实时推送**，覆盖 admin 广播、跨模块业务通知（research/playground/writing/office 任务完成等）、用户偏好设置。
>
> **2026-05-05** 立项 · 替代当前"前端 mock + 后端孤岛 API"的半实现状态。

---

## 1. 问题定义

### 现状（DB 实证 2026-05-05）

```
notifications 表 79 行
├─ "hello" SYSTEM × 48 用户  ← admin 2026-03-10 广播（DB 写入成功）
├─ "V2.2.0 Release" SYSTEM × 27 用户  ← admin 2026-01-29 广播（DB 写入成功）
├─ "新的加入申请" × 1
└─ "平台连接已过期" × 3
```

### 三个断层

| 链路              | 问题                                                                                                                                      | 后果                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **管端→DB**       | ✅ Admin 广播 raw SQL `INSERT...SELECT` 写入正常                                                                                          | DB 有数据                                                       |
| **DB→用户读端**   | ❌ `frontend/app/notifications/page.tsx` 不调任何 API，从 Zustand `useSettingsStore` 读 2 条本地写死 mock（`INITIAL_NOTIFICATIONS`）      | 用户永远看不到 admin 广播                                       |
| **业务任务→通知** | ❌ `NotificationPresetsService.notifyResearchCompleted` 已定义但**生产代码零调用**；research / playground / writing / office 全部不发通知 | 任务跑完无任何 user-facing 信号（除 socket 实时事件，关页就丢） |
| **DB→实时推送**   | ❌ `NotificationService.eventEmitter.emit("notification.created")` 已埋点但**没有任何 listener**，更没有 NotificationGateway              | 即使前端接了 API，也得手动刷新才看到                            |

### Hooks 层已就绪

`frontend/hooks/domain/useNotifications.ts` 已实现完整：

- `useNotifications({ page, limit, type, read })` → list
- `useUnreadNotificationCount()` → unread badge
- `useNotificationActions()` → mark/delete
- `useNotificationPreferences()` → preferences

只是 **页面组件没接进来**。

---

## 2. 目标 & 非目标

### 目标

1. **持久化通知**：所有"用户应当看到"的事件落 DB（与 Socket.IO 实时事件分层）
2. **跨模块零侵入**：业务模块不直接 import notification service，通过 EventBus 解耦
3. **实时刷新**：在线用户立即收到，badge 自动加 1
4. **离线兼容**：用户重连后能看到所有未读
5. **类型安全**：通知类型枚举唯一来源（NotificationType enum）

### 非目标（V1 不做）

- 多端推送（移动端 / Email / Push）→ 已有 `EmailNotificationPresetsService`，本次不动
- 通知模板系统（i18n / 富媒体）→ 用 string 拼接即可，先满足功能
- 通知聚合（"X 人评论了你"合并）→ 数据量起来再说
- 通知 retention/归档策略 → 现有 `expiresAt` 字段够用

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                   业务模块（emit 事件，不直接 import 通知层）       │
│   research / playground / writing / office / teams / topics      │
└──────────────────────────────┬──────────────────────────────────┘
                                │ EventBus.emit
                                v
┌─────────────────────────────────────────────────────────────────┐
│                  Layer 3: NotificationEventListener              │
│   @OnEvent("agent-playground.mission:completed") → notifyMission │
│   @OnEvent("research:completed")                  → notifyResearch│
│   @OnEvent("writing.task:completed")              → notifyWriting│
│   @OnEvent("office.slides:completed")             → notifyOffice │
│   只做 event → notification 映射，不写业务逻辑                     │
└──────────────────────────────┬──────────────────────────────────┘
                                │ uses
                                v
┌─────────────────────────────────────────────────────────────────┐
│                Layer 2: NotificationPresetsService               │
│   notifyResearchCompleted / notifyMissionCompleted / ...         │
│   定义"业务通知"的标准 title/message/actionUrl                     │
└──────────────────────────────┬──────────────────────────────────┘
                                │ uses
                                v
┌─────────────────────────────────────────────────────────────────┐
│                  Layer 1: NotificationService                    │
│   createNotification / batchCreateNotifications                  │
│   ├─ 写 DB                                                       │
│   └─ emit("notification.created", {userId, ...}) → Layer 0       │
└──────────────────────────────┬──────────────────────────────────┘
                                │ EventEmitter2
                                v
┌─────────────────────────────────────────────────────────────────┐
│                   Layer 0: NotificationGateway                   │
│   @OnEvent("notification.created")                               │
│   io.to(`user:${userId}`).emit("notification:new", payload)      │
│   namespace=/notifications，handshake JWT，房间=user:${userId}    │
└──────────────────────────────┬──────────────────────────────────┘
                                │ Socket.IO push
                                v
┌─────────────────────────────────────────────────────────────────┐
│             Frontend: useNotifications (SWR-like)                │
│   ├─ Bell badge: useUnreadNotificationCount + socket auto-incr   │
│   ├─ /notifications 页: useNotifications list + actions          │
│   └─ socket.on("notification:new") → invalidate cache + toast    │
└─────────────────────────────────────────────────────────────────┘
```

### 三个独立子题（Phase 拆分）

| Phase        | 内容                                                            | 独立可发布？                            |
| ------------ | --------------------------------------------------------------- | --------------------------------------- |
| **W1（A）**  | 前端 `/notifications` 页接 API + sidebar bell badge + 移除 mock | ✅ 落地后 admin 广播立即可见（拉模式）  |
| **W2（B2）** | 后端 `NotificationEventListener` + 各业务事件桥接               | ✅ 落地后任务完成有持久化通知（拉模式） |
| **W3（C）**  | `NotificationGateway` + 前端 socket 订阅                        | ✅ 落地后实时弹 toast / badge 自增      |

每个 Phase 独立可上线，下游兼容上游缺失。

---

## 4. Layer 详细设计

### Layer 0：NotificationGateway（W3）

**新文件** `backend/src/modules/platform/notifications/notification.gateway.ts`

```typescript
@WebSocketGateway({
  namespace: "notifications",
  cors: { origin: "*", credentials: true },
})
export class NotificationGateway implements OnGatewayConnection {
  @WebSocketServer() io!: Server;
  constructor(private readonly jwt: JwtService) {}

  // 客户端连接时 join 自己的 user 房间
  async handleConnection(client: Socket) {
    const userId = this.extractUserId(client); // JWT verify
    if (!userId) {
      client.disconnect();
      return;
    }
    void client.join(`user:${userId}`);
  }

  @OnEvent("notification.created")
  pushToUser(payload: {
    userId: string;
    notificationId: string;
    type: string;
    title: string;
    message: string;
  }) {
    this.io.to(`user:${payload.userId}`).emit("notification:new", payload);
  }
}
```

**关键决策**：

- 用独立 namespace `/notifications`，不和 `/agent-playground`、`/topic-insights`、`/writing` 混
- 只用 `user:${userId}` 房间，不需 ownership registry（用户只看自己的）
- handler 只做"DB 持久化 → socket 推送"的薄桥接，不写业务

### Layer 1：NotificationService（已存在，不改）

`createNotification` / `batchCreateNotifications` 已 emit `notification.created`，Layer 0 直接接。

⚠️ **唯一需要改的旁路**：`NotificationsAdminService.broadcastNotification` 用 raw SQL `INSERT...SELECT` **绕过了** EventEmitter，所以 admin 广播不会触发实时推送。

**修复**：广播后 emit 单个聚合事件 `notification.broadcast`，gateway 用 `io.emit` 全频道发 OR 一次性查询 active user list 后 fan-out emit `notification.created`。

V1 选择**后者保持事件统一**：

```typescript
async broadcastNotification(title, message, type) {
  const sent = await this.prisma.$executeRaw`...`;  // 已有 INSERT
  // 新增：广播事件，gateway 触发推送
  this.eventEmitter.emit("notification.broadcast", { title, message, type, sentCount: sent });
  return { sent };
}
```

Gateway 接 `notification.broadcast`：直接 `this.io.emit("notification:new", { ... })` 全频道广播（namespace 内所有连接收到）。这避免了 N+1 fan-out 推送。

### Layer 2：NotificationPresetsService（已存在，扩展）

新增方法（保持与 `notifyResearchCompleted` 同风格）：

```typescript
async notifyMissionCompleted(params: {
  userId: string;
  missionId: string;
  missionTitle: string;
  reviewScore?: number;
}) {
  return this.notificationService.createNotification({
    userId: params.userId,
    type: NotificationTypeDto.RESEARCH_COMPLETED,  // 复用枚举（语义=任务完成）
    title: "Mission 完成",
    message: `「${params.missionTitle}」已完成${params.reviewScore ? `（评分 ${params.reviewScore}）` : ""}`,
    actionUrl: `/playground/missions/${params.missionId}`,
    actionLabel: "查看报告",
    relatedType: "mission",
    relatedId: params.missionId,
  });
}

async notifyWritingTaskCompleted(params: {
  userId: string;
  taskId: string;
  taskTitle: string;
}) { /* ... */ }

async notifyOfficeSlidesCompleted(params: {
  userId: string;
  slidesId: string;
  topic: string;
}) { /* ... */ }
```

⚠️ 类型枚举：复用现有 `RESEARCH_COMPLETED`（语义已是"长任务完成"）。如要更细粒度，未来 schema 加 `MISSION_COMPLETED` / `WRITING_COMPLETED` / `OFFICE_COMPLETED`，但 V1 不动 enum 避免迁移。

### Layer 3：NotificationEventListener（W2，新文件）

**新文件** `backend/src/modules/platform/notifications/notification-event-listener.service.ts`

```typescript
@Injectable()
export class NotificationEventListener {
  constructor(private readonly presets: NotificationPresetsService) {}

  // Playground mission 完成（已 emit 事件 agent-playground.mission:completed）
  @OnEvent("agent-playground.mission:completed")
  async onMissionCompleted(payload: {
    missionId: string;
    userId: string;
    payload?: { reviewScore?: number };
  }) {
    if (!payload.userId) return;
    await this.presets.notifyMissionCompleted({
      userId: payload.userId,
      missionId: payload.missionId,
      missionTitle: payload.missionId, // S11 没传 title，Listener 自己 fetch 或留 missionId
      reviewScore: payload.payload?.reviewScore,
    }).catch(err => /* log only, don't throw */);
  }

  @OnEvent("research:completed")
  async onResearchCompleted(payload: { researchId: string; userId: string; title: string }) {
    /* ... */
  }

  // ... writing / office 类似
}
```

**关键决策**：

1. Listener 内 `try/catch` 只记日志不抛——通知失败不能影响业务流
2. 一个 listener 类聚合所有事件桥接，避免散落多文件
3. Listener 只读 EventBus payload，不查 DB（业务模块负责把必要字段塞 payload）
4. payload 字段缺失时优雅降级（如 `missionTitle` 缺失就用 `missionId` 兜底）

#### 前置条件：业务模块需要 emit 事件 + 包含 userId

| 模块               | 当前 emit                                         | 需要补    |
| ------------------ | ------------------------------------------------- | --------- |
| `agent-playground` | `agent-playground.mission:completed`（含 userId） | ✅ 已就绪 |
| `insight/research` | `research:completed`（含 userId）                 | 需检查    |
| `writing`          | `writing.task:completed`（含 userId）             | 需检查    |
| `office/slides`    | 用 `slides:completed`（含 userId）                | 需检查    |

W2 会补齐缺失的 emit 字段。

### Frontend Layer：W1（必修）

#### `app/notifications/page.tsx` 重写

```typescript
"use client";
export default function Notifications() {
  const { notifications, total, loading, refresh } = useNotifications({
    page,
    limit: 50,
  });
  const { markAsRead, markAllAsRead, deleteNotification } =
    useNotificationActions();
  const unreadCount = notifications.filter((n) => !n.read).length;

  // Realtime: 收到新通知 → invalidate
  useNotificationSocket({ onNewNotification: refresh });

  // ... 渲染（保持现有 UI 风格，换数据源）
}
```

#### `components/layout/Sidebar.tsx` 添加 badge

```typescript
import { useUnreadNotificationCount } from '@/hooks/domain/useNotifications';

// 在 Bell 图标位置：
const { count } = useUnreadNotificationCount();
{count > 0 && (
  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] ...">
    {count > 99 ? '99+' : count}
  </span>
)}
```

#### `hooks/domain/useNotificationSocket.ts`（W3 新增）

```typescript
export function useNotificationSocket(opts: {
  onNewNotification?: () => void;
}) {
  const { accessToken } = useAuth();
  useEffect(() => {
    if (!accessToken) return;
    const socket = io(`${apiBaseUrl}/notifications`, {
      auth: { token: accessToken },
      transports: ["websocket"],
    });
    socket.on("notification:new", () => {
      opts.onNewNotification?.();
      // 可在此 toast.info(payload.title) 弹提示
    });
    return () => {
      socket.disconnect();
    };
  }, [accessToken, opts.onNewNotification]);
}
```

#### 删除 `useSettingsStore.notifications` 字段

`stores/core/settingsStore.ts` 删除：

- `INITIAL_NOTIFICATIONS` 数组
- `notifications` / `addNotification` / `markAsRead` / `markAllAsRead` / `deleteNotification` / `clearAllNotifications` / `unreadCount` 字段
- `Notification` 接口（迁到 `hooks/domain/useNotifications.ts` 已定义）
- `partialize` 里的 `notifications` 持久化项

⚠️ 全项目 grep `useSettingsStore.*notifications`，找出所有读这个字段的地方，迁到新 hook。

---

## 5. 实现 Checklist

### W1（前端 / 立刻让 admin 广播可见，约 1.5h）

- [ ] `frontend/app/notifications/page.tsx` 重写：用 `useNotifications` + `useNotificationActions`
- [ ] `frontend/components/layout/Sidebar.tsx` 加 unread badge：用 `useUnreadNotificationCount`
- [ ] `frontend/stores/core/settingsStore.ts` 删除 notifications 相关字段（保留 AI features / lastSeenVersion）
- [ ] 全项目 grep 替换其他读 `useSettingsStore.notifications` 的地方
- [ ] 删除 `frontend/stores/core/__tests__/settingsStore.test.ts` 中 notifications 测试段
- [ ] 验证：admin 后台广播一条 → 用户刷新 `/notifications` 看到

### W2（后端 / 任务完成自动通知，约 1.5h）

- [ ] `backend/src/modules/platform/notifications/notification-event-listener.service.ts` 新建
- [ ] 注册到 `notification.module.ts` providers
- [ ] `notification-presets.service.ts` 加 `notifyMissionCompleted` / `notifyWritingTaskCompleted` / `notifyOfficeSlidesCompleted`
- [ ] 验证 4 个业务模块的完成事件 payload 含 `userId`，缺失则补
- [ ] 单元测试：Listener spec 覆盖 4 个事件 → 调对应 preset
- [ ] 验证：触发 playground mission 完成 → DB 出现 RESEARCH_COMPLETED 行

### W3（实时推送 / 锦上添花，约 1.5h）

- [ ] `backend/src/modules/platform/notifications/notification.gateway.ts` 新建（namespace=/notifications）
- [ ] `notification.gateway.ts` 注册到 `notification.module.ts` providers
- [ ] `NotificationsAdminService.broadcastNotification` 加 emit `notification.broadcast`
- [ ] `frontend/hooks/domain/useNotificationSocket.ts` 新建
- [ ] `frontend/app/notifications/page.tsx` 接 socket（`onNewNotification: refresh`）
- [ ] `frontend/components/layout/Sidebar.tsx` 接 socket badge 自增
- [ ] 单元测试：Gateway 收 event → emit 到正确 room
- [ ] 验证：A 浏览器登 admin 广播；B 浏览器（不刷新）看到 badge +1 + toast

---

## 6. 验证矩阵

| 场景                                                      | W1 后   | W2 后 | W3 后 |
| --------------------------------------------------------- | ------- | ----- | ----- |
| Admin 后台发广播 → user A 刷新 `/notifications`           | ✅ 看到 | ✅    | ✅    |
| Admin 后台发广播 → user A 在 sidebar 看到 badge（不刷新） | ❌      | ❌    | ✅    |
| Playground mission 完成 → user 刷新 `/notifications`      | ❌      | ✅    | ✅    |
| Playground mission 完成 → user 不刷新看到 toast           | ❌      | ❌    | ✅    |
| 离线 user 重新登录 → 收齐所有未读                         | ✅      | ✅    | ✅    |

---

## 7. 风险 & 缓解

| 风险                                                    | 缓解                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| EventListener 监听失败导致业务报错                      | Listener 内 try/catch + Logger.warn 不抛；Service 层 emit 用 `eventBus.emit().catch(...)` 已有 fire-and-forget 范式 |
| Admin broadcast 千用户级 fan-out emit 拖垮 EventEmitter | 用聚合事件 `notification.broadcast`（gateway 直接 `io.emit` 全频道），不做单用户 fan-out                            |
| Socket 连接数线性涨                                     | namespace 隔离 + 心跳清理；前端组件卸载主动 `socket.disconnect`                                                     |
| `useSettingsStore.notifications` 删除后还有别的地方依赖 | 第一步 grep 全项目找所有读取处再删                                                                                  |
| Listener 收到事件但 payload 缺 userId                   | Listener 自己 `if (!payload.userId) return;` 守护；W2 同步补齐 emitter 字段                                         |

---

## 8. 后续可能扩展点

### W4 — 已落地（2026-05-05）

- ✅ **类型枚举细分**：`MISSION_COMPLETED` / `WRITING_COMPLETED` / `OFFICE_COMPLETED` 加进 `NotificationType` enum，迁移文件 `prisma/migrations/20260505e_notification_type_split/`
- ✅ **research / writing / office 完成事件接入**：业务模块在 mission COMPLETED 后 fire-and-forget emit `notification.task-completed` (NestJS EventEmitter2)，`NotificationEventListener` 接事件后调对应 preset
  - research: `insight/.../mission-execution.service.ts` 完成路径
  - writing: `writing/services/mission/writing-mission-execution.service.ts:emitMissionCompleted` 后
  - office: `office/slides/orchestrator/slides-repository.ts:completeMission` 写库后
- ✅ **Quiet Hours 实战**：`NotificationService.createNotification` 查 `NotificationPreference.quietHoursStart/End`，命中窗口时在 emit `notification.created` 时打 `silent: true`；Gateway 透传该字段；前端 hook payload 类型同步。当前对比按 UTC（无时区列），跨午夜窗口已正确处理。

### W5+ — 仍 TBD

- **Quiet Hours 时区**：`NotificationPreference` 加 `timezone` 列（IANA TZ），按用户本地时间判定
- **Email 双通道**：Listener 接事件后同时调 `EmailNotificationPresetsService`（已存在）
- **桌面 push**：Service Worker + Web Push API（独立 Phase）
- **Toast 抑制**：前端按 `silent` 跳过弹窗（toast 层目前未建）
- **聚合通知**："5 人 mention 了你"折叠展示

---

## 9. 与现有架构的关系

| 现有能力                                                 | 复用方式                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `NotificationService` (platform/notifications)           | Layer 1 主体不动                                                                    |
| `NotificationPresetsService`                             | Layer 2，扩展 `notifyXxx` 方法                                                      |
| `EmailNotificationPresetsService`                        | 互不影响，未来 Listener 可双发                                                      |
| `EventEmitter2` (NestJS)                                 | Layer 1→0 已有 emit；Listener 也用 `@OnEvent`                                       |
| `DomainEventBus` + `SocketBroadcastAdapter` (ai-harness) | NotificationGateway 不复用——它走 `user:${userId}` 用户房间，不走 mission/topic 房间 |
| `JwtService`                                             | Gateway handshake auth 直接用                                                       |

---

**所有者**：Claude Code · **状态**：W1+W2+W3 落地于 commit `a36bd3051`；W4（research/writing/office 桥接 + 类型枚举 + Quiet Hours）落地于本次提交 · **里程碑**：W5 (timezone / email / toast / 聚合) TBD
