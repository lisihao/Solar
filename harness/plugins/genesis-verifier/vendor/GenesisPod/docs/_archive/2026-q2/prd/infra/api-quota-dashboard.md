# API 配额监控面板 PRD

## 文档信息

- 版本: 1.0
- 作者: PM Agent
- 创建日期: 2026-01-24
- 状态: 草稿

---

## 1. 概述

### 1.1 背景

当前 AI 模型管理页面展示了多个 AI 模型配置（OpenAI、Gemini、Grok、Cohere、Anthropic 等），但缺乏对 API Key 使用情况和剩余配额的可视化监控。管理员需要登录各个提供商的控制台才能查看使用情况，这增加了运维成本和响应延迟。

### 1.2 目标

在模型管理页面下方增加 **API 配额监控面板**，按 Provider 聚合展示：

- API 使用量统计
- 配额限制和剩余量
- 使用率百分比
- 预警状态提示

### 1.3 非目标

- 不实现自动充值/续费功能
- 不实现跨账户的费用汇总
- 不替代各提供商官方控制台的完整功能

---

## 2. 用户故事

### 角色定义

- **系统管理员**: 负责 AI 模型配置和 API Key 管理的技术人员

### 用户故事

| ID     | 角色       | 故事                                                        | 优先级 |
| ------ | ---------- | ----------------------------------------------------------- | ------ |
| US-001 | 系统管理员 | 作为管理员，我想查看各 Provider 的 API 使用量，以便监控消耗 | P0     |
| US-002 | 系统管理员 | 作为管理员，我想看到配额预警，以便及时补充额度              | P0     |
| US-003 | 系统管理员 | 作为管理员，我想手动刷新配额数据，以便获取最新状态          | P1     |
| US-004 | 系统管理员 | 作为管理员，我想查看历史使用趋势，以便进行容量规划          | P2     |

---

## 3. 功能需求

### 3.1 功能列表

| ID    | 功能名称          | 描述                                     | 优先级 |
| ----- | ----------------- | ---------------------------------------- | ------ |
| F-001 | Provider 配额卡片 | 按 Provider 展示配额使用情况             | P0     |
| F-002 | 使用率进度条      | 可视化展示使用率百分比                   | P0     |
| F-003 | 预警状态标识      | 根据使用率显示不同颜色的预警标识         | P0     |
| F-004 | 手动刷新功能      | 支持手动刷新单个 Provider 或全部配额数据 | P1     |
| F-005 | 自动刷新策略      | 定时自动刷新配额数据（可配置间隔）       | P1     |
| F-006 | 配额不可用提示    | 对不支持配额查询的 Provider 显示友好提示 | P1     |
| F-007 | 历史使用趋势图    | 展示过去 7/30 天的使用量趋势             | P2     |

### 3.2 详细说明

#### F-001: Provider 配额卡片

**描述**
每个配置了 API Key 的 Provider 显示一张配额卡片，聚合展示该 Provider 下所有模型的使用情况。

**前置条件**

- Provider 至少有一个启用的模型
- 模型配置了有效的 API Key

**数据展示**

```
+------------------------------------------+
|  [Provider Logo]  Provider Name          |
|  ----------------------------------------|
|  使用量: 1,234,567 tokens                |
|  配额限制: 10,000,000 tokens / 月        |
|  剩余: 8,765,433 tokens                  |
|  使用率: 12.3%                           |
|  [====------------] 12.3%                |
|  ----------------------------------------|
|  上次更新: 2 分钟前    [刷新]            |
+------------------------------------------+
```

**验收标准**

- [ ] 按 Provider 聚合展示（OpenAI、Anthropic、Google、xAI、Cohere 等）
- [ ] 显示使用量、配额限制、剩余量
- [ ] 显示使用率百分比和进度条
- [ ] 显示最后更新时间
- [ ] 支持手动刷新

#### F-002: 使用率进度条

**描述**
根据使用率显示可视化进度条，并根据阈值改变颜色。

**颜色规则**
| 使用率 | 颜色 | 状态 |
|--------|------|------|
| 0-60% | 绿色 | 正常 |
| 60-80% | 黄色 | 警告 |
| 80-100%| 红色 | 危险 |

**验收标准**

- [ ] 进度条宽度与使用率成比例
- [ ] 颜色根据阈值自动变化
- [ ] 悬停显示详细数值

#### F-003: 预警状态标识

**描述**
在卡片右上角显示状态标识，帮助管理员快速识别需要关注的 Provider。

**状态类型**
| 状态 | 图标 | 条件 |
|------|------|------|
| 正常 | 绿色圆点 | 使用率 < 60% |
| 警告 | 黄色三角 | 60% <= 使用率 < 80% |
| 危险 | 红色感叹号 | 使用率 >= 80% |
| 不可用 | 灰色问号 | 无法获取配额数据 |

**验收标准**

- [ ] 状态标识醒目且位置固定
- [ ] 悬停显示状态说明
- [ ] 危险状态支持闪烁提示（可选）

#### F-004: 手动刷新功能

**描述**
用户可以手动刷新配额数据。

**交互设计**

- 每张卡片有独立的刷新按钮
- 面板顶部有"全部刷新"按钮
- 刷新时显示 loading 状态
- 刷新成功/失败有提示反馈

**验收标准**

- [ ] 单个 Provider 刷新不影响其他卡片
- [ ] 刷新按钮有防抖（5秒内不可重复点击）
- [ ] 显示刷新中的 loading 动画
- [ ] 刷新完成后更新"上次更新"时间

#### F-005: 自动刷新策略

**描述**
后台定时刷新配额数据并缓存。

**策略设计**

- 默认刷新间隔：5 分钟
- 可在系统设置中配置：1/5/15/30 分钟
- 缓存数据存储在数据库或 Redis

**验收标准**

- [ ] 后台定时任务正常运行
- [ ] 刷新间隔可配置
- [ ] 缓存数据有效期与刷新间隔匹配

#### F-006: 配额不可用提示

**描述**
对不支持配额查询的 Provider 显示友好提示，而非报错。

**处理策略**

| Provider      | 配额查询能力       | 处理方式                             |
| ------------- | ------------------ | ------------------------------------ |
| OpenAI        | 有 Usage API       | 正常展示                             |
| Anthropic     | 有 Usage 端点      | 正常展示                             |
| Google/Gemini | 无 API，需 Console | 显示"请在 Google Cloud Console 查看" |
| xAI/Grok      | 无专门 API         | 显示"暂不支持自动查询"               |
| Cohere        | 有 API 额度端点    | 正常展示（需确认）                   |
| DeepSeek      | 无 API             | 显示"暂不支持自动查询"               |

**验收标准**

- [ ] 不支持的 Provider 显示友好提示
- [ ] 提供跳转到官方控制台的链接
- [ ] 不显示错误信息或空数据

---

## 4. 数据结构设计

### 4.1 配额数据模型

```typescript
/**
 * Provider 配额信息
 */
interface ProviderQuota {
  // 基本信息
  provider: string; // Provider 名称（openai, anthropic, google 等）
  providerDisplayName: string; // 显示名称
  providerIcon: string; // 图标 URL

  // 配额数据
  quotaType: QuotaType; // 配额类型
  usage: number; // 已使用量
  limit: number | null; // 配额限制（null 表示无限制或不可查）
  remaining: number | null; // 剩余量
  usagePercentage: number | null; // 使用率百分比

  // 单位和周期
  unit: QuotaUnit; // 单位类型
  period: QuotaPeriod; // 统计周期

  // 状态
  status: QuotaStatus; // 状态
  statusMessage: string; // 状态消息

  // 元数据
  lastUpdated: Date; // 最后更新时间
  dataSource: QuotaDataSource; // 数据来源
  consoleUrl: string; // 官方控制台链接
}

/**
 * 配额类型
 */
enum QuotaType {
  TOKENS = "tokens", // Token 使用量
  REQUESTS = "requests", // 请求次数
  CREDITS = "credits", // 积分/信用
  DOLLARS = "dollars", // 美元金额
}

/**
 * 配额单位
 */
enum QuotaUnit {
  TOKENS = "tokens",
  REQUESTS = "requests",
  CREDITS = "credits",
  USD = "USD",
}

/**
 * 统计周期
 */
enum QuotaPeriod {
  DAILY = "daily",
  MONTHLY = "monthly",
  UNLIMITED = "unlimited",
}

/**
 * 配额状态
 */
enum QuotaStatus {
  NORMAL = "normal", // 正常（< 60%）
  WARNING = "warning", // 警告（60-80%）
  CRITICAL = "critical", // 危险（>= 80%）
  UNAVAILABLE = "unavailable", // 不可用（无法查询）
  ERROR = "error", // 错误
}

/**
 * 数据来源
 */
enum QuotaDataSource {
  API = "api", // 通过 API 获取
  ESTIMATED = "estimated", // 本地估算
  MANUAL = "manual", // 手动配置
  UNAVAILABLE = "unavailable", // 不可获取
}
```

### 4.2 数据库表设计

```prisma
// schema.prisma 扩展

model ProviderQuotaCache {
  id          String   @id @default(uuid())
  provider    String   @unique  // openai, anthropic, google, xai, cohere

  // 配额数据
  quotaType   String   @default("tokens")
  usage       BigInt   @default(0)
  limit       BigInt?
  remaining   BigInt?
  usagePercentage Float?

  // 周期
  unit        String   @default("tokens")
  period      String   @default("monthly")

  // 状态
  status      String   @default("unavailable")
  statusMessage String?

  // 元数据
  dataSource  String   @default("unavailable")
  consoleUrl  String?
  rawData     Json?    // 原始 API 响应

  // 时间戳
  lastUpdated DateTime @updatedAt
  createdAt   DateTime @default(now())

  @@map("provider_quota_cache")
}
```

### 4.3 API 响应结构

```typescript
/**
 * GET /api/v1/admin/provider-quotas
 * 获取所有 Provider 配额信息
 */
interface GetProviderQuotasResponse {
  success: boolean;
  data: {
    quotas: ProviderQuota[];
    lastGlobalUpdate: Date;
  };
}

/**
 * POST /api/v1/admin/provider-quotas/refresh
 * 刷新配额数据
 */
interface RefreshQuotasRequest {
  provider?: string; // 不传则刷新全部
}

interface RefreshQuotasResponse {
  success: boolean;
  message: string;
  data?: ProviderQuota;
}
```

---

## 5. UI 布局和交互设计

### 5.1 整体布局

配额监控面板位于模型管理页面下方，使用卡片网格布局。

```
+------------------------------------------------------------------+
|  AI 模型管理                                                      |
|  [模型卡片列表...]                                                |
+------------------------------------------------------------------+
|                                                                  |
|  API 配额监控                                    [全部刷新]       |
|  ----------------------------------------------------------------|
|                                                                  |
|  +---------------------+  +---------------------+                |
|  | [OpenAI Logo]       |  | [Anthropic Logo]    |                |
|  | OpenAI         [!]  |  | Anthropic      [!]  |                |
|  | -------------       |  | -------------       |                |
|  | 使用: 1.2M tokens   |  | 使用率: 45%         |                |
|  | 限制: 10M / 月      |  | 配额: 充足          |                |
|  | [====------] 12%    |  | [====------] 45%    |                |
|  | 更新: 2分钟前 [刷新] |  | 更新: 3分钟前 [刷新] |                |
|  +---------------------+  +---------------------+                |
|                                                                  |
|  +---------------------+  +---------------------+                |
|  | [Google Logo]       |  | [xAI Logo]          |                |
|  | Google Gemini  [?]  |  | xAI (Grok)     [?]  |                |
|  | -------------       |  | -------------       |                |
|  | 暂不支持自动查询    |  | 暂不支持自动查询    |                |
|  | [查看 Console >]    |  | [查看 Console >]    |                |
|  +---------------------+  +---------------------+                |
|                                                                  |
+------------------------------------------------------------------+
```

### 5.2 卡片组件设计

```
+------------------------------------------+
|  [Logo]  Provider Name            [状态]  |
|  ----------------------------------------|
|                                          |
|  使用量                                   |
|  1,234,567 / 10,000,000 tokens           |
|  [================--------] 12.3%        |
|                                          |
|  剩余: 8,765,433 tokens                  |
|  周期: 本月（重置于 2月1日）              |
|                                          |
|  ----------------------------------------|
|  上次更新: 2 分钟前           [刷新按钮]  |
+------------------------------------------+
```

### 5.3 不可用状态卡片

```
+------------------------------------------+
|  [Logo]  Provider Name            [?]    |
|  ----------------------------------------|
|                                          |
|  暂不支持自动配额查询                      |
|                                          |
|  此 Provider 未提供配额查询 API，          |
|  请前往官方控制台查看使用情况。            |
|                                          |
|  [前往 Google Cloud Console >]           |
|                                          |
+------------------------------------------+
```

### 5.4 交互细节

**刷新按钮**

- 默认状态：显示刷新图标
- Loading 状态：显示旋转动画
- 成功：短暂显示绿色勾号
- 失败：显示红色叉号，tooltip 显示错误信息
- 防抖：5秒内不可重复点击

**进度条**

- 悬停显示详细数值：`已使用 1,234,567 / 总计 10,000,000 tokens`
- 颜色平滑过渡

**状态标识**

- 悬停显示说明文字
- 危险状态可选：轻微脉冲动画

---

## 6. API 设计

### 6.1 后端 API 端点

```typescript
// backend/src/modules/ai-infra/admin/admin.controller.ts 新增端点

/**
 * 获取所有 Provider 配额信息
 * GET /api/v1/admin/provider-quotas
 */
@Get('provider-quotas')
async getProviderQuotas(): Promise<GetProviderQuotasResponse>

/**
 * 刷新单个或全部 Provider 配额
 * POST /api/v1/admin/provider-quotas/refresh
 */
@Post('provider-quotas/refresh')
async refreshProviderQuotas(
  @Body() body: RefreshQuotasRequest
): Promise<RefreshQuotasResponse>

/**
 * 获取配额刷新配置
 * GET /api/v1/admin/settings/quota-refresh
 */
@Get('settings/quota-refresh')
async getQuotaRefreshSettings(): Promise<QuotaRefreshSettings>

/**
 * 更新配额刷新配置
 * PUT /api/v1/admin/settings/quota-refresh
 */
@Put('settings/quota-refresh')
async updateQuotaRefreshSettings(
  @Body() body: QuotaRefreshSettings
): Promise<QuotaRefreshSettings>
```

### 6.2 各 Provider 配额查询实现

#### OpenAI

```typescript
/**
 * OpenAI Usage API
 * 文档: https://platform.openai.com/docs/api-reference/usage
 */
async function fetchOpenAIQuota(apiKey: string): Promise<ProviderQuota> {
  // GET /v1/organization/usage/completions
  // 返回: tokens 使用量
  // 需要: Organization API Key

  const response = await fetch(
    "https://api.openai.com/v1/organization/usage/completions",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );

  // 解析响应，计算使用率
  // 注意: OpenAI 不直接返回 limit，需要从 billing 信息获取
}
```

#### Anthropic

```typescript
/**
 * Anthropic Usage API
 * 文档: https://docs.anthropic.com/en/docs/usage
 */
async function fetchAnthropicQuota(apiKey: string): Promise<ProviderQuota> {
  // GET /api/oauth/usage
  // 返回: 使用率百分比

  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: { "x-api-key": apiKey },
  });

  // Anthropic 返回使用率百分比，不返回具体数值
}
```

#### Cohere

```typescript
/**
 * Cohere API 配额
 * 需要确认具体 API 端点
 */
async function fetchCohereQuota(apiKey: string): Promise<ProviderQuota> {
  // 需要确认 Cohere 是否提供配额查询 API
  // 暂时返回不可用状态
}
```

#### 不支持查询的 Provider

```typescript
/**
 * Google/Gemini, xAI/Grok, DeepSeek
 * 这些 Provider 不提供配额查询 API
 */
function getUnavailableQuota(provider: string): ProviderQuota {
  return {
    provider,
    status: QuotaStatus.UNAVAILABLE,
    dataSource: QuotaDataSource.UNAVAILABLE,
    statusMessage: "暂不支持自动配额查询",
    consoleUrl: getConsoleUrl(provider),
    // ... 其他字段设为 null
  };
}

function getConsoleUrl(provider: string): string {
  const urls: Record<string, string> = {
    google: "https://console.cloud.google.com/apis/dashboard",
    gemini: "https://console.cloud.google.com/apis/dashboard",
    xai: "https://console.x.ai/",
    grok: "https://console.x.ai/",
    deepseek: "https://platform.deepseek.com/",
  };
  return urls[provider.toLowerCase()] || "";
}
```

### 6.3 前端 Hook

```typescript
// frontend/hooks/domain/useProviderQuotas.ts

export function useProviderQuotas() {
  const { data, isLoading, error, refetch } =
    useApiGet<GetProviderQuotasResponse>(
      "/admin/provider-quotas",
      { refetchInterval: 5 * 60 * 1000 }, // 5分钟自动刷新
    );

  const refreshMutation = useApiPost<
    RefreshQuotasRequest,
    RefreshQuotasResponse
  >("/admin/provider-quotas/refresh");

  const refreshProvider = async (provider?: string) => {
    await refreshMutation.mutateAsync({ provider });
    refetch();
  };

  return {
    quotas: data?.data.quotas || [],
    lastGlobalUpdate: data?.data.lastGlobalUpdate,
    isLoading,
    error,
    refreshProvider,
    refreshAll: () => refreshProvider(),
    isRefreshing: refreshMutation.isLoading,
  };
}
```

---

## 7. 任务拆分

| ID    | 任务                        | 类型 | 预估 | 依赖              | 负责人 |
| ----- | --------------------------- | ---- | ---- | ----------------- | ------ |
| T-001 | 设计数据模型和数据库表      | 后端 | 0.5d | -                 | -      |
| T-002 | 实现 OpenAI 配额查询        | 后端 | 1d   | T-001             | -      |
| T-003 | 实现 Anthropic 配额查询     | 后端 | 0.5d | T-001             | -      |
| T-004 | 实现不可用 Provider 处理    | 后端 | 0.5d | T-001             | -      |
| T-005 | 实现配额聚合服务            | 后端 | 1d   | T-002,T-003,T-004 | -      |
| T-006 | 实现 Admin API 端点         | 后端 | 0.5d | T-005             | -      |
| T-007 | 实现后台定时刷新任务        | 后端 | 0.5d | T-005             | -      |
| T-008 | 设计配额卡片 UI 组件        | 前端 | 1d   | -                 | -      |
| T-009 | 实现进度条和状态标识组件    | 前端 | 0.5d | T-008             | -      |
| T-010 | 实现 useProviderQuotas Hook | 前端 | 0.5d | T-006             | -      |
| T-011 | 集成到模型管理页面          | 前端 | 0.5d | T-008,T-010       | -      |
| T-012 | 编写单元测试                | 测试 | 1d   | T-006,T-011       | -      |
| T-013 | 端到端测试和调试            | 全栈 | 1d   | T-012             | -      |

**总预估工时**: 9 天

---

## 8. 排期计划

### 里程碑

| 里程碑 | 日期    | 内容                    |
| ------ | ------- | ----------------------- |
| M1     | 第1周末 | 完成后端 API 和数据模型 |
| M2     | 第2周中 | 完成前端组件开发        |
| M3     | 第2周末 | 完成测试和上线          |

### 迭代计划

**Sprint 1 (第1周)**

- T-001: 数据模型设计
- T-002: OpenAI 配额查询
- T-003: Anthropic 配额查询
- T-004: 不可用 Provider 处理
- T-005: 配额聚合服务

**Sprint 2 (第2周)**

- T-006: Admin API 端点
- T-007: 定时刷新任务
- T-008: 配额卡片 UI
- T-009: 进度条组件
- T-010: useProviderQuotas Hook
- T-011: 页面集成
- T-012: 单元测试
- T-013: 端到端测试

---

## 9. 风险和依赖

### 风险

| 风险                         | 影响 | 概率 | 缓解措施                        |
| ---------------------------- | ---- | ---- | ------------------------------- |
| Provider API 变更            | 高   | 低   | 定期检查 API 文档，设计容错机制 |
| API 限流导致查询失败         | 中   | 中   | 实现重试机制，增加缓存时间      |
| 部分 Provider 不提供配额 API | 中   | 确定 | 已设计"不可用"状态处理方案      |
| 多 API Key 情况处理复杂      | 中   | 中   | 优先支持单 Key，多 Key 后续迭代 |

### 依赖

| 依赖项              | 状态   | 说明                      |
| ------------------- | ------ | ------------------------- |
| OpenAI Usage API    | 可用   | 需要 Organization API Key |
| Anthropic Usage API | 可用   | 需要确认 API 端点权限     |
| Cohere API          | 待确认 | 需要确认是否提供配额查询  |
| 现有模型管理页面    | 已完成 | 配额面板将在其下方展示    |

---

## 10. 技术方案建议

### 10.1 后端架构

```
backend/src/modules/ai-infra/admin/
  quota/
    quota.service.ts           // 配额聚合服务
    quota.controller.ts        // API 端点（或集成到 admin.controller.ts）
    providers/
      openai-quota.provider.ts
      anthropic-quota.provider.ts
      base-quota.provider.ts   // 抽象基类
    dto/
      provider-quota.dto.ts
```

### 10.2 前端架构

```
frontend/components/admin/models/
  QuotaDashboard/
    QuotaDashboard.tsx         // 面板容器
    QuotaCard.tsx              // 配额卡片
    QuotaProgressBar.tsx       // 进度条
    QuotaStatusBadge.tsx       // 状态标识
    UnavailableQuotaCard.tsx   // 不可用状态卡片
```

### 10.3 缓存策略

- 缓存存储：PostgreSQL（ProviderQuotaCache 表）
- 缓存时间：5 分钟（可配置）
- 刷新策略：
  - 后台定时任务（cron）
  - 用户手动刷新
  - 页面加载时检查缓存是否过期

### 10.4 错误处理

```typescript
// 统一的配额查询错误处理
try {
  const quota = await fetchProviderQuota(provider, apiKey);
  return quota;
} catch (error) {
  // 记录错误日志
  logger.warn(`Failed to fetch quota for ${provider}: ${error.message}`);

  // 返回错误状态而非抛出异常
  return {
    provider,
    status: QuotaStatus.ERROR,
    statusMessage: `查询失败: ${error.message}`,
    dataSource: QuotaDataSource.UNAVAILABLE,
  };
}
```

---

## 11. 附录

### 参考资料

- [OpenAI Usage API 文档](https://platform.openai.com/docs/api-reference/usage)
- [Anthropic API 文档](https://docs.anthropic.com/)
- [Cohere API 文档](https://docs.cohere.com/)
- [Google Cloud Console](https://console.cloud.google.com/)
- [xAI Console](https://console.x.ai/)

### 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2026-01-24 | 初始版本 | PM Agent |

---

**审核人**: 待定
**批准人**: 待定
