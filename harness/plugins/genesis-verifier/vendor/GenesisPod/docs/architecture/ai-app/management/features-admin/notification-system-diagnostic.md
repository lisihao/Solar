# 通知系统诊断报告

> GenesisPod 通知系统全面诊断分析
>
> **诊断日期**: 2026-01-18
> **完成度评估**: 20-30%
> **状态**: 严重缺失，需要重新设计

---

## 执行摘要

项目中存在**两个独立的通知系统**，但都存在重大缺陷：

1. **前端本地通知系统** - 仅基于 localStorage，无持久化
2. **实时事件推送系统** - 仅用于 AI 任务进度，不是通用通知

**关键缺失**:

- ❌ 无 Notification 数据库模型
- ❌ 无后端通知 API
- ❌ **无站内消息功能**（申请加入、邀请、审批等）
- ❌ 事件未转换为通知
- ❌ 无用户通知偏好设置

---

## 1. 现有通知系统分析

### 1.1 前端本地通知系统 (settingsStore)

**文件位置**:

- `frontend/stores/settingsStore.ts`
- `frontend/app/notifications/page.tsx`

**当前实现**:

```typescript
interface Notification {
  id: string;
  type: "system" | "feature" | "update" | "tip";
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
}
```

**问题**:

- 仅有 2 条硬编码通知
- 无服务端持久化
- 无实时推送
- 无用户隔离

### 1.2 WebSocket 事件系统

用于 AI 任务进度推送，不是通用通知系统：

- `topic-research.gateway.ts`
- `ai-teams.gateway.ts`
- `ai-writing.gateway.ts`

---

## 2. 站内消息功能缺失分析

### 2.1 当前成员管理模式

**文件**: `backend/src/modules/ai-app/teams/services/topic/topic-membership.service.ts`

当前是"直接添加"模式，缺少申请/审批流程：

```typescript
// 当前：管理员直接添加
async addMember(topicId: string, userId: string, dto: AddMemberDto)
async addMemberByEmail(topicId: string, userId: string, email: string)
```

### 2.2 缺失的功能

| 功能             | 状态    | 用户场景                       |
| ---------------- | ------- | ------------------------------ |
| 申请加入团队     | ❌ 缺失 | 用户发现感兴趣的团队，申请加入 |
| 邀请加入团队     | ❌ 缺失 | 管理员邀请用户，生成邀请链接   |
| 申请审批         | ❌ 缺失 | 管理员审批申请，批准/拒绝      |
| 申请查看私有内容 | ❌ 缺失 | 用户请求访问私有研究报告       |
| @提及通知        | ❌ 缺失 | 在讨论中 @某人                 |
| 任务完成通知     | ❌ 缺失 | 研究任务完成后通知相关人员     |

---

## 3. 易用性问题诊断

### 3.1 用户体验问题

| 问题               | 影响                     | 建议                   |
| ------------------ | ------------------------ | ---------------------- |
| **无通知入口徽章** | 用户不知道有新消息       | Sidebar 添加未读计数   |
| **无实时通知**     | 用户需要刷新页面         | WebSocket 推送 + Toast |
| **无通知分类**     | 用户无法快速找到重要通知 | 按类型/来源分组        |
| **无通知偏好**     | 用户无法关闭不想要的通知 | 添加偏好设置页面       |
| **无通知声音**     | 重要通知容易被忽略       | 可选的声音提示         |

### 3.2 建议的 UX 设计

**1. 通知中心入口**

```tsx
// Sidebar 中的通知按钮
<NotificationBell>
  {unreadCount > 0 && <Badge variant="destructive">{unreadCount}</Badge>}
</NotificationBell>
```

**2. 通知下拉预览**

```tsx
<NotificationDropdown>
  <NotificationList>
    {notifications.slice(0, 5).map((notification) => (
      <NotificationItem
        key={notification.id}
        icon={getNotificationIcon(notification.type)}
        title={notification.title}
        time={formatRelativeTime(notification.createdAt)}
        read={notification.read}
        onClick={() => handleNotificationClick(notification)}
      />
    ))}
  </NotificationList>
  <ViewAllButton href="/notifications">
    {t("notifications.viewAll")}
  </ViewAllButton>
</NotificationDropdown>
```

**3. 申请加入流程**

```
用户浏览公开团队
    ↓
点击"申请加入"按钮
    ↓
填写申请理由（可选）
    ↓
提交申请
    ↓
团队管理员收到通知 ← 站内消息
    ↓
管理员审批（批准/拒绝）
    ↓
申请者收到结果通知 ← 站内消息
```

---

## 4. 国际化问题诊断

### 4.1 当前国际化状态

| 组件     | i18n 状态 | 问题             |
| -------- | --------- | ---------------- |
| 通知页面 | ❌ 缺失   | 硬编码英文       |
| 通知类型 | ❌ 缺失   | 类型名称硬编码   |
| 时间显示 | ⚠️ 部分   | 相对时间未本地化 |

### 4.2 需要国际化的内容

```json
{
  "notifications": {
    "title": "通知中心",
    "empty": "暂无通知",
    "markAllRead": "全部标为已读",
    "viewAll": "查看全部",
    "types": {
      "system": "系统通知",
      "update": "版本更新",
      "tip": "使用提示",
      "join_request": "加入申请",
      "join_approved": "申请通过",
      "join_rejected": "申请被拒",
      "invitation": "邀请加入",
      "mention": "有人@你",
      "task_completed": "任务完成"
    },
    "actions": {
      "approve": "批准",
      "reject": "拒绝",
      "view": "查看",
      "accept": "接受邀请",
      "decline": "拒绝邀请"
    },
    "messages": {
      "joinRequest": "{user} 申请加入 {team}",
      "joinApproved": "你的加入申请已被 {team} 批准",
      "joinRejected": "你的加入申请已被 {team} 拒绝",
      "invitation": "{user} 邀请你加入 {team}",
      "mention": "{user} 在 {topic} 中提到了你",
      "taskCompleted": "研究任务「{task}」已完成"
    },
    "preferences": {
      "title": "通知设置",
      "email": "邮件通知",
      "push": "浏览器推送",
      "sound": "通知声音",
      "categories": "通知类别",
      "enableAll": "全部开启",
      "disableAll": "全部关闭"
    }
  }
}
```

### 4.3 时间本地化

```typescript
// 使用 date-fns 或 dayjs 的本地化
import { formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";

const formatRelativeTime = (date: Date, locale: string) => {
  const localeMap = { zh: zhCN, en: enUS };
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: localeMap[locale] || enUS,
  });
};

// 中文: 5 分钟前
// 英文: 5 minutes ago
```

---

## 5. 建议的数据模型

### 5.1 Notification 模型

```prisma
model Notification {
  id            String   @id @default(uuid())
  userId        String   @map("user_id")

  // 通知内容
  type          NotificationType
  title         String
  message       String   @db.Text
  actionUrl     String?  @map("action_url")
  actionLabel   String?  @map("action_label")

  // 相关实体
  relatedType   String?  @map("related_type")  // topic, research, user
  relatedId     String?  @map("related_id")

  // 状态
  read          Boolean  @default(false)
  readAt        DateTime? @map("read_at")

  // 元数据（用于模板变量）
  metadata      Json?

  createdAt     DateTime @default(now())
  expiresAt     DateTime? @map("expires_at")

  user          User     @relation(fields: [userId], references: [id])

  @@index([userId, read, createdAt(sort: Desc)])
  @@map("notifications")
}

enum NotificationType {
  SYSTEM
  UPDATE
  TIP
  JOIN_REQUEST
  JOIN_APPROVED
  JOIN_REJECTED
  INVITATION
  MENTION
  TASK_COMPLETED
  CREDITS_LOW
}
```

### 5.2 JoinRequest 模型

```prisma
model JoinRequest {
  id           String        @id @default(uuid())
  topicId      String        @map("topic_id")
  userId       String        @map("user_id")
  status       RequestStatus @default(PENDING)
  message      String?       @db.Text
  reviewedBy   String?       @map("reviewed_by")
  reviewedAt   DateTime?     @map("reviewed_at")
  rejectReason String?       @map("reject_reason")
  createdAt    DateTime      @default(now())

  topic        Topic         @relation(fields: [topicId], references: [id])
  user         User          @relation(fields: [userId], references: [id])
  reviewer     User?         @relation("JoinRequestReviewer", fields: [reviewedBy], references: [id])

  @@unique([topicId, userId])
  @@map("join_requests")
}

enum RequestStatus {
  PENDING
  APPROVED
  REJECTED
}
```

### 5.3 Invitation 模型

```prisma
model Invitation {
  id          String       @id @default(uuid())
  topicId     String       @map("topic_id")
  inviterId   String       @map("inviter_id")
  inviteeId   String?      @map("invitee_id")
  inviteCode  String?      @unique @map("invite_code")
  email       String?
  role        TopicRole    @default(MEMBER)
  status      InviteStatus @default(PENDING)
  expiresAt   DateTime?    @map("expires_at")
  acceptedAt  DateTime?    @map("accepted_at")
  createdAt   DateTime     @default(now())

  topic       Topic        @relation(fields: [topicId], references: [id])
  inviter     User         @relation("Inviter", fields: [inviterId], references: [id])
  invitee     User?        @relation("Invitee", fields: [inviteeId], references: [id])

  @@map("invitations")
}

enum InviteStatus {
  PENDING
  ACCEPTED
  EXPIRED
  CANCELLED
}
```

---

## 6. 建议的 API 设计

### 6.1 通知 API

```typescript
// 获取通知列表
GET /api/notifications
Query: { page, limit, type?, read? }

// 获取未读数量
GET /api/notifications/unread-count

// 标记已读
POST /api/notifications/:id/read

// 标记全部已读
POST /api/notifications/read-all

// 删除通知
DELETE /api/notifications/:id

// 通知偏好
GET /api/notifications/preferences
PUT /api/notifications/preferences
```

### 6.2 申请/邀请 API

```typescript
// 申请加入
POST /api/topics/:id/join-requests
Body: { message?: string }

// 查看申请列表（管理员）
GET /api/topics/:id/join-requests

// 审批申请
POST /api/topics/:id/join-requests/:requestId/approve
POST /api/topics/:id/join-requests/:requestId/reject
Body: { reason?: string }

// 创建邀请
POST /api/topics/:id/invitations
Body: { userId?: string, email?: string, role?: TopicRole }

// 查看邀请详情
GET /api/invitations/:code

// 接受/拒绝邀请
POST /api/invitations/:code/accept
POST /api/invitations/:code/decline
```

---

## 7. 改进建议

### 7.1 优先级 1（核心功能）

1. **创建 Notification 模型** - 数据库支持
2. **创建 NotificationService** - CRUD + 发送逻辑
3. **创建申请/邀请系统** - JoinRequest + Invitation
4. **WebSocket 实时推送** - 新通知实时送达

### 7.2 优先级 2（易用性）

5. **通知中心 UI** - 列表 + 下拉预览
6. **未读徽章** - Sidebar 显示未读数
7. **通知偏好设置** - 用户可配置
8. **申请审批 UI** - 管理员审批界面

### 7.3 优先级 3（国际化）

9. **通知文本国际化** - 所有类型和消息
10. **时间本地化** - 相对时间显示
11. **邮件通知国际化** - 多语言邮件模板

---

## 8. 关键文件清单

### 需要创建的文件

```
backend/src/modules/platform/notifications/
├── notification.module.ts
├── notification.service.ts
├── notification.controller.ts
├── notification-preference.service.ts
└── dto/
    ├── create-notification.dto.ts
    └── notification-preference.dto.ts

backend/src/modules/ai-app/teams/services/topic/
├── join-request.service.ts
└── invitation.service.ts
```

### 需要修改的文件

| 文件                                     | 修改内容                                        |
| ---------------------------------------- | ----------------------------------------------- |
| `backend/prisma/schema/models.prisma`    | 添加 Notification, JoinRequest, Invitation 模型 |
| `frontend/stores/settingsStore.ts`       | 改为从 API 获取通知                             |
| `frontend/app/notifications/page.tsx`    | 对接后端 API                                    |
| `frontend/components/layout/Sidebar.tsx` | 添加通知徽章                                    |
| `frontend/lib/i18n/locales/*.json`       | 添加通知相关文本                                |

---

## 总结

通知系统是当前最需要完善的模块（20-30%），缺少：

1. **数据持久化** - 无数据库支持
2. **站内消息** - 无申请/邀请/审批流程
3. **实时推送** - 仅有 AI 任务进度
4. **国际化** - 完全缺失

建议优先实现通知基础设施和站内消息功能，这对用户协作至关重要。

---

**最后更新**: 2026-01-18
**诊断人**: Claude Code
