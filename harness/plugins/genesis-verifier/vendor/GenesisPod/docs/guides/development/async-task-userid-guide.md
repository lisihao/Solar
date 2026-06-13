# 异步任务与 BYOK Key 解析：userId 上下文指南

> **对象**: 后端开发者 / Coder Agent
> **背景**: BYOK v2 上线后，所有 LLM 调用必须带 userId 才能正确解析 Key（普通用户 → Personal/Assigned，管理员 → System）。
> **核心规则**: 每一次 LLM 调用链路上 `RequestContext.getUserId()` 必须为非 undefined；否则会退化到"系统 Secret 过渡路径"，可能导致普通用户误用系统 Key。

---

## 一、背景：为什么会丢 userId

`RequestContext` 基于 Node.js `AsyncLocalStorage`。它**自动**跨 `await`、`Promise`、`setTimeout`、`setImmediate` 传播，但在以下边界会丢失：

| 边界                                   | 会丢吗    | 说明                                |
| -------------------------------------- | --------- | ----------------------------------- |
| HTTP handler 内部的 await 链           | ❌ 不丢   | 中间件已设好，正常                  |
| Fire-and-forget：`void this.run()`     | ❌ 不丢   | 属于当前 ALS，不需要包              |
| `EventEmitter` 监听器                  | ⚠️ 视情况 | 同步 emit 不丢；异步 emit 可能丢    |
| `@Cron` 定时任务                       | ✅ 丢     | 无 HTTP 请求，ALS 为空              |
| 队列 Worker（BullMQ 等）               | ✅ 丢     | 独立进程/独立作业，ALS 需要手动恢复 |
| 新起的 `child_process` / Worker Thread | ✅ 丢     | 完全脱离主线程 ALS                  |

---

## 二、统一方案：`withUserContext`

`backend/src/common/context/with-user-context.ts` 提供了一个最小包装：

```ts
import { withUserContext } from "@/common/context/with-user-context";

await withUserContext(userId, async () => {
  // 这里调用的 AiChatService.chat 会自动拿到 userId
  await this.aiChatService.chat({ messages, modelType: "CHAT", taskProfile: { ... } });
});
```

### 规则

1. **Job payload 必须带 userId**：任何进队列、进 Cron 数据载体、进事件总线的任务，都必须包含 `userId`（即使看起来不需要——万一内部调 LLM 呢）。
2. **Worker 入口必须用 `withUserContext` 包裹**。不允许在 Worker 内部写 `RequestContext.run(...)` 手动拼 context。
3. **Cron 定时任务若代表某个用户执行**，必须传 `userId`。如果确实是「全系统」任务（例如配额重置），可以不传 — 但不允许 Cron 里直接调 LLM（必须按用户维度拆分）。

---

## 三、Checklist（Reviewer Agent 审查要点）

新增 / 修改异步代码时，对照检查：

- [ ] 长时间运行的业务流（比如 Research、Topic Insights 迭代）确认没有把 LLM 调用放在失去 ALS 的边界之后
- [ ] 新增 `@Cron` 时，是否需要调用 LLM？如需要，有没有显式 `withUserContext(userId, ...)`？
- [ ] 新增队列 / Worker 时，`job.data.userId` 是否必填？入口是否包了 `withUserContext`？
- [ ] 新增 `EventEmitter` 监听器，若异步处理并调用 LLM，有没有在入队时保存 userId？
- [ ] 单元测试中给 `AiChatService.chat` 传的 `userId` 是否覆盖了 ADMIN / USER / 无 Key 三种路径？

---

## 四、错误处理：KeyResolver 抛出的 BYOK 错误

调用 LLM 时可能抛：

| 错误类                | 场景                                | 前端应呈现                              |
| --------------------- | ----------------------------------- | --------------------------------------- |
| `NoAvailableKeyError` | 用户没有 Personal 也没有 Assignment | 引导到 `/settings/api-keys` 配置 / 申请 |
| `QuotaExceededError`  | Assignment 配额耗尽                 | 提示申请扩额 / 使用自己的 Key           |
| `InvalidApiKeyError`  | Provider 返回 401                   | 提示更新 Key                            |
| `NoSystemKeyError`    | 管理员调用但 Secret 未配置          | 提示管理员去 Secret Manager 补全        |

Worker 代码应将这些错误**如实传到上层**（不要用 `catch () {}` 吞掉）。对于长流程任务，捕获后更新任务状态字段（如 `status = 'failed'`，`error_code = 'NO_AVAILABLE_KEY'`），方便前端呈现。

---

## 五、示例

### 示例 1：BullMQ（未来如需引入）

```ts
// 入队
await this.queue.add("run-research", { userId, researchId }, { attempts: 3 });

// Worker
@Processor("research")
export class ResearchProcessor {
  constructor(private readonly service: ResearchService) {}

  @Process("run-research")
  async handle(job: Job<{ userId: string; researchId: string }>) {
    return withUserContext(job.data.userId, () =>
      this.service.run(job.data.researchId),
    );
  }
}
```

### 示例 2：@Cron 按用户维度迭代

```ts
@Cron("0 9 * * *")
async sendDailyDigests() {
  const subs = await this.prisma.digestSubscription.findMany({ where: { active: true } });
  for (const sub of subs) {
    // 每个用户独立 ALS，LLM 调用各自拿到正确的 userId
    await withUserContext(sub.userId, async () => {
      await this.digestService.compose(sub);
    });
  }
}
```

### 示例 3：EventEmitter

```ts
// 发布事件时携带 userId
this.events.emit("note.created", { userId, noteId });

// 监听处
@OnEvent("note.created")
async onNoteCreated(payload: { userId: string; noteId: string }) {
  await withUserContext(payload.userId, () =>
    this.aiIndexer.index(payload.noteId),
  );
}
```

---

## 六、相关设计

- 加密：`platform/credentials/encryption/EncryptionService`（L1，旧称 ai-infra/encryption）
- Key 解析：`platform/credentials/key-resolver/KeyResolverService`（L1，旧称 ai-infra/key-resolver）
- 错误类：`platform/credentials/key-resolver/key-resolver.errors.ts`
- 设计文档：[docs/design/byok-system-design.md](../design/byok-system-design.md)
