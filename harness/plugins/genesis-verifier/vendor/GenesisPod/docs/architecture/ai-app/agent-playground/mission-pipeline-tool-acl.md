# Tool ACL 子文档（D13）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §9.6 / §10 Q13 / §12 D13
> **优先级**：P1

---

## 1. 问题域

不同用户可能有不同的工具使用权限：

- 付费工具（如高频金融数据 API）只对订阅用户开放
- 实验性工具只对 beta tester 开放
- destructive 工具（image-generation 等）需要 entitlement
- workspace 级共享工具需要 workspace membership

当前 ToolInvoker 不查 user entitlements，需要补 ACL。

---

## 2. ToolRegistry 元数据扩展

```typescript
interface ToolMetadata {
  // ... 已有字段
  requiredEntitlements?: string[]; // 必须含的 entitlement keys
  workspaceScope?: "public" | "workspace"; // workspace 级访问控制
  rateLimit?: {
    // 用户级 rate limit
    perMinute?: number;
    perDay?: number;
  };
}
```

示例：

```typescript
@ToolMeta({
  id: 'finance-api',
  category: 'information',
  requiredEntitlements: ['finance.premium'],
  rateLimit: { perMinute: 10, perDay: 500 },
})
class FinanceApiTool { ... }
```

---

## 3. UserEntitlements 数据来源

```typescript
interface IRuntimeEnvironment {
  // ... 已有方法
  getUserEntitlements(): Promise<{
    keys: string[]; // ['finance.premium', 'beta.tools', ...]
    expiresAt?: Record<string, Date>;
  }>;
}
```

App 层 `BillingRuntimeEnvAdapter` 实现该方法，从 ai-infra/credits 或 user_subscription 表查询。

---

## 4. Tool Recall 时过滤（baseline §3.4 [3.b] Step 4）

```typescript
// Tool Recall 五步流程的 Step 4
const userEntitlements = (await opts.environment?.getUserEntitlements()) ?? {
  keys: [],
};
pool = pool.filter((t) => {
  if (!t.requiredEntitlements?.length) return true;
  return t.requiredEntitlements.every((req) =>
    userEntitlements.keys.includes(req),
  );
});
```

效果：用户没权限的工具**不出现在 catalog**，LLM 看不到也用不了，杜绝侥幸调用。

---

## 5. ToolInvoker 二次校验

即使 catalog 不显示，恶意构造的 action 仍可能尝试调用。ToolInvoker 在执行前再查一次：

```typescript
class ToolInvoker {
  async invoke(
    toolId: string,
    input: unknown,
    ctx: InvokeCtx,
  ): Promise<unknown> {
    const tool = this.registry.tryGet(toolId);
    if (!tool) throw new ToolNotFoundError(toolId);

    // ★ ACL 二次校验
    if (tool.metadata.requiredEntitlements?.length) {
      const ents = await ctx.environment?.getUserEntitlements();
      for (const req of tool.metadata.requiredEntitlements) {
        if (!ents?.keys.includes(req)) {
          throw new ToolAccessDeniedError(toolId, req);
        }
      }
    }

    // ★ Rate limit
    if (tool.metadata.rateLimit) {
      await this.rateLimiter.check(ctx.userId, toolId, tool.metadata.rateLimit);
    }

    return tool.execute(input, ctx);
  }
}
```

---

## 6. emit 事件

```typescript
{
  type: 'tool_access_denied',
  payload: {
    toolId: string;
    requiredEntitlement: string;
    userId: string;
  }
}
```

被 App 层翻译成 `mission:tool-acl-violation` 给前端可视化。

---

## 7. Workspace 级访问

```typescript
@ToolMeta({
  id: 'workspace-rag',
  workspaceScope: 'workspace',  // 仅 workspace 内可用
})
```

ToolInvoker 校验：

```typescript
if (tool.metadata.workspaceScope === "workspace" && !ctx.workspaceId) {
  throw new ToolAccessDeniedError(toolId, "workspace context required");
}
```

---

## 8. 实现要点

- entitlement key 命名约定：`<domain>.<level>` 如 `finance.premium` / `beta.tools`
- userEntitlements 查询 LRU 缓存（per mission 缓存 5 分钟），避免每 tool call 一次 DB
- rateLimiter 用 Redis sliding window
- 测试环境跳过 ACL（fixture mode 不需要真实 user）

---

## 9. 验收标准

- 无 entitlement 用户调 finance-api → ToolAccessDeniedError，mission emit `tool_access_denied`
- 有 entitlement 用户正常调用
- Tool Recall 时未授权工具不出现在 catalog（LLM 看不到）
- Rate limit 触发时返回 429，retry-after header 写明
- Workspace 级工具在无 workspace context 时被拒

---

## 10. 风险 / 边界

- entitlement 查询失败（DB 抖动）→ fail-closed（拒绝访问，安全优先）
- 用户订阅升级后老 mission 已 cache → cache 5 分钟过期后自动刷
- LLM 在 catalog 不见某工具时仍尝试自己写 toolId 调用 → ToolInvoker 二次校验兜底
