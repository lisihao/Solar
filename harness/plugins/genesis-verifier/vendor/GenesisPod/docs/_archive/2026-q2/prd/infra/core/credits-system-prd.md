# GenesisPod 积分系统 PRD

**文档版本**: 1.0
**创建日期**: 2025-12-27
**产品负责人**: PM Agent
**目标发布**: Q1 2026
**状态**: 草稿

---

## 目录

1. [产品概述](#1-产品概述)
2. [产品定位与价值主张](#2-产品定位与价值主张)
3. [核心功能规格](#3-核心功能规格)
4. [积分消耗规则](#4-积分消耗规则)
5. [数据库设计](#5-数据库设计)
6. [API 设计](#6-api-设计)
7. [前端页面设计](#7-前端页面设计)
8. [实施路线图](#8-实施路线图)
9. [风险与依赖](#9-风险与依赖)
10. [监控与运营](#10-监控与运营)
11. [模块集成详情](#11-模块集成详情)
12. [测试策略](#12-测试策略)
13. [附录](#13-附录)

---

## 1. 产品概述

### 1.1 产品定义

**积分系统（Credits System）** 是 GenesisPod 的核心计费和资源管控机制，通过虚拟积分实现对 AI 功能使用的量化管理，确保平台资源的合理分配和可持续运营。

### 1.2 核心问题

GenesisPod 提供多种 AI 功能模块，每个模块的 AI 调用成本差异显著：

| 模块          | 主要操作      | 成本特征              |
| ------------- | ------------- | --------------------- |
| AI Ask        | 智能问答      | 单次对话，成本适中    |
| AI Studio     | 深度研究      | 多轮迭代，高成本      |
| AI Teams      | 团队辩论      | 多 Agent 并发，高成本 |
| AI Office     | 文档/PPT 生成 | 长内容生成，高成本    |
| AI Coding     | 代码生成分析  | 代码上下文长，高成本  |
| AI Simulation | 推演模拟      | 多轮模拟，最高成本    |

**当前痛点：**

1. **无资源管控**：用户可无限调用 AI，导致成本失控
2. **无使用可见性**：用户不了解自己的使用情况
3. **无公平机制**：无法区分轻度和重度用户
4. **无商业模式**：缺乏付费转化入口

### 1.3 解决方案

通过积分系统实现：

```
用户注册 → 获得初始积分 (10,000)
    ↓
使用 AI 功能 → 消耗积分（按操作类型计费）
    ↓
积分不足 → 提示充值 / 等待每日恢复
    ↓
充值/订阅 → 获得更多积分
```

---

## 2. 产品定位与价值主张

### 2.1 目标用户

| 用户类型 | 特征               | 积分需求             |
| -------- | ------------------ | -------------------- |
| 免费用户 | 轻度使用，尝鲜体验 | 初始积分足够基础使用 |
| 活跃用户 | 中度使用，日常研究 | 需要订阅或充值       |
| 专业用户 | 重度使用，商业场景 | 高额积分包或企业订阅 |

### 2.2 核心价值

1. **用户视角**：清晰了解使用情况，合理规划 AI 使用
2. **平台视角**：成本可控，收入可预期
3. **公平性**：按需付费，资源合理分配

### 2.3 设计原则

- **透明度**：用户清楚知道每个操作的积分消耗
- **灵活性**：多种获取积分的方式
- **激励性**：鼓励用户活跃和付费转化
- **容错性**：积分不足时优雅降级，不阻断核心体验

---

## 3. 核心功能规格

### 3.1 功能模块概览

```
积分系统
├── 积分账户模块
│   ├── 积分余额管理
│   ├── 初始积分分配
│   ├── 积分有效期管理
│   └── 积分冻结/解冻
│
├── 积分消费模块
│   ├── AI 操作计费
│   ├── 消费记录
│   ├── 实时余额扣减
│   └── 积分不足预警
│
├── 积分获取模块
│   ├── 注册赠送
│   ├── 每日签到
│   ├── 任务奖励
│   └── 充值购买（Phase 2）
│
└── 积分展示模块
    ├── 余额展示（Header）
    ├── 消费明细页
    ├── 使用统计图表
    └── 低积分提醒
```

### 3.2 功能详细规格

#### 3.2.1 积分账户系统

**初始积分分配：**

| 用户类型     | 初始积分 | 说明                         |
| ------------ | -------- | ---------------------------- |
| 免费注册用户 | 10,000   | 足够体验所有功能约 50-100 次 |
| 邀请注册用户 | 12,000   | 额外 20% 奖励                |
| 付费订阅用户 | 按套餐   | 订阅期间按月/年充值          |

**积分有效期：**

| 积分类型 | 有效期 | 说明                 |
| -------- | ------ | -------------------- |
| 初始积分 | 永久   | 不过期               |
| 赠送积分 | 30 天  | 签到、任务奖励       |
| 充值积分 | 365 天 | 购买获得             |
| 订阅积分 | 当期   | 订阅期内有效，不滚存 |

**积分消费优先级：**

1. 赠送积分（即将过期优先）
2. 初始积分
3. 充值积分

#### 3.2.2 积分消费系统

**消费触发点：**

| 触发事件            | 扣费时机     | 说明                |
| ------------------- | ------------ | ------------------- |
| AI Ask 发送消息     | 响应完成后   | 根据实际 token 消耗 |
| AI Studio 启动研究  | 研究完成后   | 按研究深度分级      |
| AI Teams 发起辩论   | 每轮结束后   | 按参与 Agent 数量   |
| AI Office 生成文档  | 生成完成后   | 按文档长度和类型    |
| AI Coding 分析/生成 | 响应完成后   | 按代码复杂度        |
| AI Simulation 推演  | 每回合结束后 | 按模拟复杂度        |

**积分不足处理：**

1. **预检查**：操作前检查积分是否足够（预估消耗）
2. **软拦截**：积分不足时弹窗提示，而非阻断
3. **优雅降级**：允许完成当前操作，后续操作需充值

#### 3.2.3 异常场景处理

**积分退还机制：**

| 场景             | 处理方式        | 说明                       |
| ---------------- | --------------- | -------------------------- |
| AI 调用超时/失败 | 全额退还        | 自动发起，记录 REFUND 类型 |
| 部分响应中断     | 按比例退还      | 已产生 token 的部分不退    |
| 用户主动取消     | 不退还已消耗    | 流式响应已开始不可逆       |
| 系统错误（5xx）  | 全额退还 + 补偿 | 额外补偿 10%               |
| 重复扣费         | 全额退还        | 保留第一笔，其余退还       |

**重复扣费防护：**

```typescript
// 幂等性保障
interface ConsumeRequest {
  idempotencyKey: string;  // 格式: ${userId}-${moduleType}-${timestamp}-${randomId}
  // ...
}

// 防护机制
1. 前端: 按钮点击后 loading 状态，禁用重复点击
2. 后端: 5 秒内相同 idempotencyKey 请求直接返回缓存结果
3. 数据库: idempotencyKey 唯一索引约束
```

**错误码定义：**

| 错误码                   | 说明         | 前端处理     |
| ------------------------ | ------------ | ------------ |
| INSUFFICIENT_CREDITS     | 积分不足     | 显示充值弹窗 |
| ACCOUNT_FROZEN           | 账户已冻结   | 提示联系客服 |
| DAILY_LIMIT_EXCEEDED     | 超出每日限额 | 提示明日再试 |
| OPERATION_LIMIT_EXCEEDED | 单次操作超限 | 简化操作重试 |
| DUPLICATE_REQUEST        | 重复请求     | 静默忽略     |

#### 3.2.4 积分获取系统

**Phase 1 - 免费获取渠道：**

| 方式          | 积分数量 | 频率   | 说明           |
| ------------- | -------- | ------ | -------------- |
| 注册赠送      | 10,000   | 一次性 | 新用户注册     |
| 每日签到      | 100      | 每日   | 连续签到有加成 |
| 连续签到 7 天 | +200     | 每周   | 额外奖励       |
| 邀请好友注册  | 1,000    | 每人   | 好友激活后发放 |
| 完善个人资料  | 500      | 一次性 | 填写完整资料   |

**签到防刷机制：**

| 限制规则     | 阈值                    | 处理方式           |
| ------------ | ----------------------- | ------------------ |
| 同一设备指纹 | 只能绑定 1 个账户       | 第二个账户签到失败 |
| 同一 IP 地址 | 每日最多 3 个账户签到   | 超出后提示异常     |
| 新注册账户   | 注册 24 小时后才能签到  | 防止批量注册刷积分 |
| 异常行为检测 | 连续 7 天从不同 IP 签到 | 标记为可疑账户     |
| 黑名单 IP    | 自动拉黑已知代理/VPN    | 签到请求拒绝       |

**邀请奖励防刷机制：**

| 限制规则       | 说明                                 |
| -------------- | ------------------------------------ |
| 邀请人限制     | 每人每日最多邀请 10 人获得奖励       |
| 被邀请人活跃度 | 需完成首次 AI 操作后才发放奖励       |
| 设备关联检测   | 邀请人与被邀请人设备指纹相同则不发放 |
| IP 关联检测    | 同一 IP 注册的账户互相邀请不发放     |

**Phase 2 - 付费渠道（规划）：**

| 套餐     | 价格（元） | 积分      | 有效期 | 额外权益      |
| -------- | ---------- | --------- | ------ | ------------- |
| 入门包   | 19.9       | 20,000    | 365 天 | -             |
| 标准包   | 49.9       | 60,000    | 365 天 | 5% 额外积分   |
| 专业包   | 99.9       | 150,000   | 365 天 | 10% 额外积分  |
| 月度订阅 | 29.9/月    | 50,000/月 | 订阅期 | 专属模型      |
| 年度订阅 | 299/年     | 80,000/月 | 订阅期 | 专属模型+优先 |

---

## 4. 积分消耗规则

### 4.1 计费模型设计

积分消耗基于以下因素：

1. **Token 消耗**：AI 模型的实际 token 使用量
2. **模型成本**：不同模型的成本差异（GPT-4 > GPT-3.5）
3. **操作复杂度**：简单问答 vs 深度研究
4. **功能模块**：不同模块的基础成本

**基础换算公式：**

```
积分消耗 = 基础积分 + (token 数 / 1000) * 模型系数
```

### 4.2 各模块积分消耗表

#### 4.2.1 AI Ask（智能问答）

| 操作         | 基础积分 | 模型系数 | 预估范围 | 说明       |
| ------------ | -------- | -------- | -------- | ---------- |
| 普通对话     | 10       | 1x       | 10-50    | 简单问答   |
| 联网搜索对话 | 20       | 1.2x     | 30-80    | 需要搜索   |
| 知识库问答   | 15       | 1.1x     | 20-60    | RAG 检索   |
| 长文档对话   | 25       | 1.3x     | 40-100   | 大量上下文 |

**模型系数：**

| 模型类型      | 系数 | 代表模型                  |
| ------------- | ---- | ------------------------- |
| CHAT_FAST     | 0.5x | GPT-4o-mini, Claude Haiku |
| CHAT          | 1.0x | GPT-4o, Claude Sonnet     |
| CHAT_ADVANCED | 2.0x | GPT-4, Claude Opus        |

#### 4.2.2 AI Studio（深度研究）

| 操作                 | 积分消耗 | 说明       |
| -------------------- | -------- | ---------- |
| 创建研究项目         | 50       | 初始化     |
| 快速研究（5 分钟）   | 200      | 基础深度   |
| 标准研究（15 分钟）  | 500      | 中等深度   |
| 深度研究（30 分钟+） | 1,000    | 全面研究   |
| 研究对话（每轮）     | 30       | 研究中问答 |
| 生成研究报告         | 300      | 最终报告   |
| 生成播客音频         | 500      | TTS 生成   |

#### 4.2.3 AI Teams（团队辩论）

| 操作            | 积分消耗       | 说明            |
| --------------- | -------------- | --------------- |
| 创建 Topic      | 20             | 初始化          |
| AI 回复（单条） | 30             | 每个 AI 回复    |
| 发起辩论        | 100            | 多 Agent 辩论   |
| 辩论每轮        | 50 \* Agent 数 | 每个 Agent 消耗 |
| 生成总结        | 80             | 辩论总结        |
| 团队任务        | 200            | Mission 模式    |

#### 4.2.4 AI Office（文档生成）

| 操作                  | 积分消耗 | 说明       |
| --------------------- | -------- | ---------- |
| 创建文档              | 30       | 初始化     |
| 生成 PPT（5 页以下）  | 200      | 短 PPT     |
| 生成 PPT（10 页以下） | 400      | 标准 PPT   |
| 生成 PPT（20 页以下） | 800      | 长 PPT     |
| 生成 Word 文档        | 300      | 标准文档   |
| 文档修改（局部）      | 50       | 选中编辑   |
| 文档重写（全局）      | 150      | 整体重写   |
| 导出 PDF/PPTX         | 免费     | 不消耗积分 |

#### 4.2.5 AI Coding（代码助手）

| 操作          | 积分消耗 | 说明       |
| ------------- | -------- | ---------- |
| 代码问答      | 20       | 简单问题   |
| 代码生成      | 50       | 功能代码   |
| 代码审查      | 80       | Review     |
| 项目分析      | 200      | 全项目分析 |
| 规范检查      | 100      | Compliance |
| 多 Agent 协作 | 300      | Team 模式  |

#### 4.2.6 AI Simulation（推演模拟）

| 操作               | 积分消耗        | 说明     |
| ------------------ | --------------- | -------- |
| 创建模拟场景       | 100             | 初始化   |
| 模拟每回合         | 150 \* Agent 数 | 多 Agent |
| AI 辅助分析        | 50              | 局势分析 |
| 生成推演报告       | 200             | 最终报告 |
| 完整推演（5 回合） | 1,500+          | 典型场景 |

### 4.3 流式响应积分处理

AI 模块大多采用流式返回（SSE），需要特殊的积分处理策略：

**推荐方案：预扣 + 结算**

```
请求开始 → 预估积分 → 预扣积分 → 流式响应 → 实际结算 → 多退少补
```

**详细流程：**

| 阶段      | 操作              | 说明                        |
| --------- | ----------------- | --------------------------- |
| 1. 请求前 | 预估积分消耗      | 基于操作类型 + 输入长度估算 |
| 2. 验证   | 检查余额 ≥ 预估值 | 不足则阻止请求              |
| 3. 预扣   | 冻结预估积分      | 创建 PENDING 状态交易       |
| 4. 执行   | 流式返回          | 累计实际 token 消耗         |
| 5. 结算   | 计算实际消耗      | 基于 response.usage         |
| 6. 调整   | 更新交易记录      | 预扣 > 实际则退还差额       |

**预估算法：**

```typescript
function estimateCredits(params: {
  moduleType: string;
  operationType: string;
  inputTokens: number; // 使用 tiktoken 估算
  modelType: string;
}): { estimated: number; range: { min: number; max: number } } {
  const rule = getCreditRule(moduleType, operationType);
  const modelMultiplier = rule.modelMultipliers[modelType] || 1.0;

  // 假设输出 token 约为输入的 2-4 倍
  const estimatedOutputTokens = inputTokens * 3;
  const totalTokens = inputTokens + estimatedOutputTokens;

  const estimated =
    rule.baseCredits +
    Math.ceil((totalTokens / 1000) * rule.tokenMultiplier * modelMultiplier);

  return {
    estimated,
    range: {
      min: Math.ceil(estimated * 0.5),
      max: Math.ceil(estimated * 1.5),
    },
  };
}
```

**预扣不足的兜底策略：**

- 实际消耗 > 预扣：允许超额，但余额可为负（最多 -500）
- 账户负积分：下次充值/签到时自动抵扣
- 连续负积分：限制新操作直到余额恢复

### 4.4 Token 计数方案

不同 AI 服务的 token 获取方式：

| 来源          | 方法                                          | 准确度 | 说明             |
| ------------- | --------------------------------------------- | ------ | ---------------- |
| OpenAI API    | `response.usage.total_tokens`                 | 精确   | 完成后从响应获取 |
| Anthropic API | `response.usage.input_tokens + output_tokens` | 精确   | 完成后从响应获取 |
| 流式响应      | 累加每个 chunk 的 token                       | 较准确 | 部分 API 不支持  |
| 本地预估      | tiktoken / anthropic-tokenizer                | 近似   | 用于预扣阶段     |

**Token 计数服务：**

```typescript
@Injectable()
export class TokenCounterService {
  // 预估 token（请求前）
  async estimateTokens(text: string, model: string): Promise<number>;

  // 从 API 响应提取实际 token（请求后）
  extractTokensFromResponse(response: AIResponse): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}
```

### 4.5 积分消耗限制

| 限制类型                 | 数值  | 说明         |
| ------------------------ | ----- | ------------ |
| 单次操作上限             | 2,000 | 防止异常消耗 |
| 每日消耗上限（免费用户） | 5,000 | 防止滥用     |
| 每日消耗上限（付费用户） | 无限  | 按余额消耗   |
| 最低余额预警             | 500   | 低于此值提醒 |
| 允许负积分上限           | -500  | 流式超额兜底 |

---

## 5. 数据库设计

### 5.1 Prisma Schema

```prisma
// ============ 积分系统 ============

// 积分账户
model CreditAccount {
  id     String @id @default(uuid())
  userId String @unique @map("user_id")

  // 积分余额
  balance       Int @default(10000) // 当前可用积分
  totalEarned   Int @default(10000) @map("total_earned")   // 历史总获得
  totalSpent    Int @default(0)     @map("total_spent")    // 历史总消耗

  // 赠送积分（有过期时间）
  giftBalance   Int @default(0) @map("gift_balance")
  giftExpiresAt DateTime? @map("gift_expires_at")

  // 订阅积分（按订阅周期）
  subscriptionBalance   Int @default(0) @map("subscription_balance")
  subscriptionExpiresAt DateTime? @map("subscription_expires_at")

  // 账户状态
  isActive  Boolean @default(true) @map("is_active")
  isFrozen  Boolean @default(false) @map("is_frozen")
  frozenAt  DateTime? @map("frozen_at")
  frozenReason String? @map("frozen_reason")

  // 消费统计（今日）
  todaySpent    Int @default(0) @map("today_spent")
  todayDate     DateTime? @map("today_date")

  // 时间戳
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // 关系
  user         User @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions CreditTransaction[]

  @@index([userId])
  @@index([balance])
  @@map("credit_accounts")
}

// 积分交易类型
enum CreditTransactionType {
  // 获取类
  INITIAL          // 初始赠送
  DAILY_CHECKIN    // 每日签到
  TASK_REWARD      // 任务奖励
  REFERRAL_BONUS   // 邀请奖励
  PURCHASE         // 充值购买
  SUBSCRIPTION     // 订阅充值
  ADMIN_GRANT      // 管理员发放
  COMPENSATION     // 补偿发放

  // 消耗类
  AI_ASK           // AI Ask 消耗
  AI_STUDIO        // AI Studio 消耗
  AI_TEAMS         // AI Teams 消耗
  AI_OFFICE        // AI Office 消耗
  AI_CODING        // AI Coding 消耗
  AI_SIMULATION    // AI Simulation 消耗

  // 系统类
  EXPIRATION       // 过期扣除
  REFUND           // 退款
  ADJUSTMENT       // 手动调整
}

// 积分交易记录
model CreditTransaction {
  id        String @id @default(uuid())
  accountId String @map("account_id")

  // 交易信息
  type        CreditTransactionType
  amount      Int // 正数=获得，负数=消耗
  balanceAfter Int @map("balance_after") // 交易后余额

  // 交易描述
  description String @db.VarChar(500)

  // 关联信息（可选）
  moduleType     String? @map("module_type") // ai-ask, ai-studio 等
  operationType  String? @map("operation_type") // chat, research, generate 等
  referenceId    String? @map("reference_id") // 关联的会话/项目/文档 ID

  // AI 消耗详情（仅消耗类）
  tokenCount    Int?    @map("token_count") // token 使用量
  modelName     String? @map("model_name")  // 使用的模型
  modelType     String? @map("model_type")  // CHAT, CHAT_FAST 等

  // 订单信息（仅充值类）
  orderId      String? @map("order_id")
  paymentAmount Decimal? @map("payment_amount") @db.Decimal(10, 2)

  // 元数据
  metadata Json? @default("{}")

  // 时间戳
  createdAt DateTime @default(now()) @map("created_at")

  // 关系
  account CreditAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, createdAt(sort: Desc)])
  @@index([type])
  @@index([moduleType, createdAt(sort: Desc)])
  @@index([createdAt(sort: Desc)])
  @@map("credit_transactions")
}

// 积分规则配置
model CreditRule {
  id String @id @default(uuid())

  // 规则标识
  moduleType    String @map("module_type")    // ai-ask, ai-studio 等
  operationType String @map("operation_type") // chat, research, generate 等

  // 计费配置
  baseCredits     Int   @map("base_credits")      // 基础积分
  tokenMultiplier Float @default(1.0) @map("token_multiplier") // token 系数

  // 模型系数映射
  modelMultipliers Json @default("{}") @map("model_multipliers") // {"CHAT": 1.0, "CHAT_FAST": 0.5}

  // 限制
  maxCreditsPerOperation Int? @map("max_credits_per_operation") // 单次上限

  // 描述
  name        String @db.VarChar(100)
  description String? @db.Text

  // 状态
  isActive Boolean @default(true) @map("is_active")

  // 时间戳
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([moduleType, operationType])
  @@index([moduleType])
  @@index([isActive])
  @@map("credit_rules")
}

// 签到记录
model DailyCheckin {
  id     String @id @default(uuid())
  userId String @map("user_id")

  // 签到信息
  checkinDate   DateTime @map("checkin_date") @db.Date
  creditsEarned Int      @map("credits_earned")

  // 连续签到
  streakDays Int @default(1) @map("streak_days")

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([userId, checkinDate])
  @@index([userId, checkinDate(sort: Desc)])
  @@map("daily_checkins")
}

// 积分礼包（充值套餐定义）
model CreditPackage {
  id String @id @default(uuid())

  // 套餐信息
  name        String @db.VarChar(100)
  displayName String @map("display_name") @db.VarChar(200)
  description String? @db.Text

  // 价格与积分
  price       Decimal @db.Decimal(10, 2) // 人民币价格
  credits     Int // 获得积分
  bonusRate   Float @default(0) @map("bonus_rate") // 额外赠送比例

  // 有效期
  validDays Int @default(365) @map("valid_days") // 积分有效天数

  // 显示
  icon       String? @db.VarChar(10) // Emoji
  color      String? @db.VarChar(50) // 颜色
  isPopular  Boolean @default(false) @map("is_popular") // 热门标记
  sortOrder  Int @default(0) @map("sort_order")

  // 状态
  isActive Boolean @default(true) @map("is_active")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([isActive, sortOrder])
  @@map("credit_packages")
}
```

### 5.2 User 模型扩展

在现有 `User` 模型中添加关联：

```prisma
model User {
  // ... 现有字段 ...

  // 积分系统
  creditAccount CreditAccount?

  // ... 其他关系 ...
}
```

### 5.3 数据库迁移策略

**Migration 1: 创建积分表结构**

```sql
-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM (
  'INITIAL', 'DAILY_CHECKIN', 'TASK_REWARD', 'REFERRAL_BONUS',
  'PURCHASE', 'SUBSCRIPTION', 'ADMIN_GRANT', 'COMPENSATION',
  'AI_ASK', 'AI_STUDIO', 'AI_TEAMS', 'AI_OFFICE', 'AI_CODING', 'AI_SIMULATION',
  'EXPIRATION', 'REFUND', 'ADJUSTMENT'
);

-- CreateTable credit_accounts
-- CreateTable credit_transactions
-- CreateTable credit_rules
-- CreateTable daily_checkins
-- CreateTable credit_packages
```

**Migration 2: 为现有用户创建积分账户**

```sql
-- 为所有现有用户创建积分账户
INSERT INTO credit_accounts (id, user_id, balance, total_earned, created_at, updated_at)
SELECT
  gen_random_uuid(),
  id,
  10000,
  10000,
  NOW(),
  NOW()
FROM users
WHERE NOT EXISTS (
  SELECT 1 FROM credit_accounts WHERE user_id = users.id
);
```

### 5.4 并发安全策略

积分扣减是高并发场景，必须保证数据一致性：

**方案：SELECT FOR UPDATE + 事务**

```typescript
// backend/src/modules/credits/credits.service.ts

async consumeCredits(params: ConsumeParams): Promise<ConsumeResult> {
  return this.prisma.$transaction(async (tx) => {
    // 1. 加锁查询账户
    const account = await tx.$queryRaw<CreditAccount[]>`
      SELECT * FROM credit_accounts
      WHERE user_id = ${params.userId}
      FOR UPDATE
    `;

    if (!account[0]) throw new NotFoundException('账户不存在');

    // 2. 计算消耗积分
    const credits = await this.calculateCredits(params);

    // 3. 检查余额
    if (account[0].balance < credits && account[0].balance > -500) {
      throw new InsufficientCreditsException(credits, account[0].balance);
    }

    // 4. 扣减余额
    const updated = await tx.creditAccount.update({
      where: { id: account[0].id },
      data: {
        balance: { decrement: credits },
        totalSpent: { increment: credits },
        todaySpent: { increment: credits },
      },
    });

    // 5. 创建交易记录
    const transaction = await tx.creditTransaction.create({
      data: {
        accountId: account[0].id,
        type: this.getTransactionType(params.moduleType),
        amount: -credits,
        balanceAfter: updated.balance,
        description: params.description,
        moduleType: params.moduleType,
        operationType: params.operationType,
        referenceId: params.referenceId,
        tokenCount: params.tokenCount,
        modelName: params.modelName,
      },
    });

    return {
      consumed: credits,
      balanceAfter: updated.balance,
      transactionId: transaction.id,
    };
  }, {
    isolationLevel: 'Serializable', // 最高隔离级别
    timeout: 5000, // 5秒超时
  });
}
```

**乐观锁备选方案：**

```prisma
model CreditAccount {
  // ... 其他字段
  version Int @default(0) // 乐观锁版本号
}
```

```typescript
// 使用 version 字段实现乐观锁
const result = await tx.creditAccount.updateMany({
  where: {
    id: accountId,
    version: currentVersion,
  },
  data: {
    balance: { decrement: credits },
    version: { increment: 1 },
  },
});

if (result.count === 0) {
  throw new ConcurrentModificationException();
}
```

### 5.5 缓存策略

**Redis 缓存层设计：**

| 缓存键                            | 数据         | TTL      | 更新策略       |
| --------------------------------- | ------------ | -------- | -------------- |
| `credits:balance:{userId}`        | 积分余额     | 60s      | 写操作后失效   |
| `credits:account:{userId}`        | 完整账户信息 | 300s     | 写操作后失效   |
| `credits:rules:{moduleType}`      | 积分规则     | 3600s    | 规则更新后失效 |
| `credits:checkin:{userId}:{date}` | 今日签到状态 | 当日有效 | 签到后设置     |

**缓存服务实现：**

```typescript
@Injectable()
export class CreditsCacheService {
  constructor(private redis: RedisService) {}

  // 获取余额（优先缓存）
  async getBalance(userId: string): Promise<number> {
    const cached = await this.redis.get(`credits:balance:${userId}`);
    if (cached !== null) return parseInt(cached);

    const balance = await this.fetchBalanceFromDB(userId);
    await this.redis.setex(`credits:balance:${userId}`, 60, balance.toString());
    return balance;
  }

  // 失效缓存（写操作后调用）
  async invalidateBalance(userId: string): Promise<void> {
    await this.redis.del(`credits:balance:${userId}`);
    await this.redis.del(`credits:account:${userId}`);
  }

  // 分布式锁（防止并发签到）
  async acquireCheckinLock(userId: string): Promise<boolean> {
    const key = `lock:checkin:${userId}`;
    const result = await this.redis.set(key, "1", "EX", 10, "NX");
    return result === "OK";
  }
}
```

**缓存一致性保障：**

1. **写后失效**：任何写操作后立即删除相关缓存
2. **异步刷新**：对于高频读取，使用后台任务预热缓存
3. **版本号校验**：缓存数据携带版本号，读取时校验
4. **最终一致性**：允许短暂不一致（60s TTL），保证最终一致

---

## 6. API 设计

### 6.1 API 端点列表

| 方法 | 端点                           | 说明                 | 权限   |
| ---- | ------------------------------ | -------------------- | ------ |
| GET  | `/api/credits`                 | 获取积分账户信息     | User   |
| GET  | `/api/credits/balance`         | 获取积分余额（轻量） | User   |
| GET  | `/api/credits/transactions`    | 获取交易记录         | User   |
| GET  | `/api/credits/statistics`      | 获取使用统计         | User   |
| POST | `/api/credits/checkin`         | 每日签到             | User   |
| GET  | `/api/credits/packages`        | 获取充值套餐列表     | Public |
| POST | `/api/credits/consume`         | 消耗积分（内部）     | System |
| POST | `/api/credits/grant`           | 发放积分             | Admin  |
| GET  | `/api/admin/credits/rules`     | 获取积分规则         | Admin  |
| PUT  | `/api/admin/credits/rules/:id` | 更新积分规则         | Admin  |

### 6.2 API 详细设计

#### 6.2.1 获取积分账户信息

```typescript
// GET /api/credits
// Response
interface CreditAccountResponse {
  success: true;
  data: {
    balance: number; // 总可用积分
    giftBalance: number; // 赠送积分
    giftExpiresAt: string | null;
    subscriptionBalance: number;
    subscriptionExpiresAt: string | null;
    totalEarned: number; // 历史获得
    totalSpent: number; // 历史消耗
    todaySpent: number; // 今日消耗
    todayLimit: number; // 今日限额
    isFrozen: boolean;
    createdAt: string;
  };
}
```

#### 6.2.2 获取积分余额（轻量级）

```typescript
// GET /api/credits/balance
// Response（用于 Header 展示，高频调用）
interface BalanceResponse {
  success: true;
  data: {
    balance: number;
    isLow: boolean; // 是否低余额（< 500）
    todaySpent: number;
  };
}
```

#### 6.2.3 获取交易记录

```typescript
// GET /api/credits/transactions?page=1&limit=20&type=AI_ASK
// Response
interface TransactionListResponse {
  success: true;
  data: {
    items: Array<{
      id: string;
      type: CreditTransactionType;
      amount: number;
      balanceAfter: number;
      description: string;
      moduleType: string | null;
      operationType: string | null;
      referenceId: string | null;
      tokenCount: number | null;
      modelName: string | null;
      createdAt: string;
    }>;
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  };
}
```

#### 6.2.4 获取使用统计

```typescript
// GET /api/credits/statistics?period=7d
// Response
interface StatisticsResponse {
  success: true;
  data: {
    period: "7d" | "30d" | "90d";
    summary: {
      totalSpent: number;
      totalEarned: number;
      averageDaily: number;
    };
    byModule: Array<{
      module: string;
      spent: number;
      percentage: number;
      operationCount: number;
    }>;
    byDay: Array<{
      date: string;
      spent: number;
      earned: number;
    }>;
    topOperations: Array<{
      operation: string;
      count: number;
      totalCredits: number;
    }>;
  };
}
```

#### 6.2.5 每日签到

```typescript
// POST /api/credits/checkin
// Response
interface CheckinResponse {
  success: true;
  data: {
    credits: number; // 获得积分
    streakDays: number; // 连续签到天数
    bonus: number; // 额外奖励
    newBalance: number; // 新余额
    nextBonus: {
      days: number; // 距离下次奖励天数
      credits: number; // 下次奖励积分
    };
  };
}
```

#### 6.2.6 消耗积分（内部 API）

```typescript
// POST /api/credits/consume (Internal)
interface ConsumeRequest {
  userId: string;
  moduleType: string; // 'ai-ask' | 'ai-studio' | ...
  operationType: string; // 'chat' | 'research' | ...
  tokenCount?: number;
  modelName?: string;
  modelType?: string;
  referenceId?: string;
  description?: string;
  metadata?: Record<string, any>;
}

interface ConsumeResponse {
  success: true;
  data: {
    consumed: number; // 实际消耗积分
    balanceAfter: number; // 消耗后余额
    transactionId: string;
  };
}

// 错误响应
interface InsufficientCreditsError {
  success: false;
  error: {
    code: "INSUFFICIENT_CREDITS";
    message: string;
    required: number;
    available: number;
  };
}
```

### 6.3 积分服务接口

```typescript
// backend/src/modules/credits/credits.service.ts

@Injectable()
export class CreditsService {
  /**
   * 消耗积分（核心方法，供其他服务调用）
   */
  async consumeCredits(params: {
    userId: string;
    moduleType: string;
    operationType: string;
    tokenCount?: number;
    modelName?: string;
    modelType?: string;
    referenceId?: string;
    description?: string;
  }): Promise<{
    consumed: number;
    balanceAfter: number;
    transactionId: string;
  }>;

  /**
   * 预估积分消耗（用于前端展示）
   */
  async estimateCredits(params: {
    moduleType: string;
    operationType: string;
    estimatedTokens?: number;
    modelType?: string;
  }): Promise<{
    estimated: number;
    range: { min: number; max: number };
  }>;

  /**
   * 检查余额是否足够
   */
  async checkBalance(
    userId: string,
    requiredCredits: number,
  ): Promise<{
    sufficient: boolean;
    balance: number;
    required: number;
  }>;

  /**
   * 获取积分账户
   */
  async getAccount(userId: string): Promise<CreditAccount>;

  /**
   * 发放积分
   */
  async grantCredits(params: {
    userId: string;
    amount: number;
    type: CreditTransactionType;
    description: string;
    expiresAt?: Date;
  }): Promise<CreditTransaction>;
}
```

---

## 7. 前端页面设计

### 7.1 页面结构

```
积分系统前端
├── Header 积分展示组件
│   └── CreditBadge（余额 + 低积分警告）
│
├── 积分中心页面 (/credits)
│   ├── 积分概览卡片
│   ├── 使用统计图表
│   ├── 交易记录列表
│   └── 充值入口（Phase 2）
│
├── 签到弹窗
│   └── CheckinModal
│
├── 积分不足弹窗
│   └── InsufficientCreditsModal
│
└── 管理后台页面 (/admin/credits)
    ├── 积分规则管理
    ├── 用户积分查询
    └── 积分发放工具
```

### 7.2 组件设计

#### 7.2.1 CreditBadge（Header 积分徽章）

```tsx
// frontend/components/shared/CreditBadge.tsx

interface CreditBadgeProps {
  balance: number;
  isLow: boolean;
}

// 功能：
// - 显示当前积分余额
// - 低积分时显示警告图标和红色样式
// - 点击跳转到积分中心
// - 支持骨架屏加载状态
```

**UI 规格：**

```
正常状态：[金币图标] 8,520
低积分：  [警告图标] 320  (红色文字)
```

#### 7.2.2 积分概览卡片

```tsx
// frontend/components/credits/CreditOverviewCard.tsx

// 功能：
// - 显示总余额、赠送积分、订阅积分
// - 显示今日消耗/限额
// - 显示历史统计
// - 签到按钮

// UI 布局：
// +----------------------------------+
// |  可用积分                         |
// |  ████ 8,520 ████                 |
// |                                   |
// |  赠送积分: 520 (5天后过期)         |
// |  订阅积分: 8,000                  |
// |                                   |
// |  今日已用: 1,200 / 5,000          |
// |  [████████░░░░░░░] 24%           |
// |                                   |
// |  [签到领积分]  [充值]             |
// +----------------------------------+
```

#### 7.2.3 使用统计图表

```tsx
// frontend/components/credits/CreditStatisticsChart.tsx

// 功能：
// - 按模块分布饼图
// - 每日消耗趋势折线图
// - 时间范围选择器（7天/30天/90天）

// 技术方案：
// - 使用 Recharts 或 Chart.js
// - 响应式设计
```

#### 7.2.4 交易记录列表

```tsx
// frontend/components/credits/TransactionList.tsx

// 功能：
// - 分页加载交易记录
// - 按类型筛选
// - 按时间筛选
// - 收入/支出分色显示

// 列表项 UI：
// +------------------------------------------+
// | [AI图标] AI Ask 对话           -35       |
// | GPT-4o | 1,245 tokens | 2分钟前          |
// +------------------------------------------+
// | [签到图标] 每日签到            +100      |
// | 连续签到第5天 | 今天 09:00               |
// +------------------------------------------+
```

#### 7.2.5 签到弹窗

```tsx
// frontend/components/credits/CheckinModal.tsx

// 功能：
// - 显示签到结果
// - 连续签到进度
// - 下次奖励预告
// - 动画效果

// UI：
// +----------------------------------+
// |          签到成功!               |
// |                                   |
// |      +100 积分                    |
// |                                   |
// |   连续签到 5 天                   |
// |   [●●●●●○○]                       |
// |   再签 2 天可获得额外 200 积分    |
// |                                   |
// |   当前余额: 8,620                 |
// |                                   |
// |         [确定]                    |
// +----------------------------------+
```

#### 7.2.6 积分不足弹窗

```tsx
// frontend/components/credits/InsufficientCreditsModal.tsx

interface InsufficientCreditsModalProps {
  required: number;
  available: number;
  operation: string;
  onClose: () => void;
  onRecharge?: () => void;
}

// UI：
// +----------------------------------+
// |     积分不足                      |
// |                                   |
// |  本次操作需要: 500 积分           |
// |  当前余额: 320 积分               |
// |  还需: 180 积分                   |
// |                                   |
// |  [签到领积分] [充值] [取消]       |
// +----------------------------------+
```

### 7.3 积分中心页面

```tsx
// frontend/app/credits/page.tsx

// 页面结构：
// +--------------------------------------------------+
// | Credits Center                                    |
// +--------------------------------------------------+
// |                                                   |
// | +------------------+  +------------------------+  |
// | | 积分概览卡片      |  | 模块消耗分布饼图       |  |
// | +------------------+  +------------------------+  |
// |                                                   |
// | +-----------------------------------------------+ |
// | | 每日消耗趋势图                                 | |
// | +-----------------------------------------------+ |
// |                                                   |
// | +-----------------------------------------------+ |
// | | 交易记录                    [筛选] [导出]     | |
// | |-----------------------------------------------| |
// | | 类型    描述              积分       时间     | |
// | |-----------------------------------------------| |
// | | ...                                           | |
// | +-----------------------------------------------+ |
// +--------------------------------------------------+
```

### 7.4 与 AI 模块集成

每个 AI 模块需要在调用前后集成积分系统：

```typescript
// frontend/hooks/credits/useCreditsGuard.ts

function useCreditsGuard() {
  const { balance, isLow, checkBalance, refreshBalance } = useCredits();

  // 操作前检查
  const canPerform = async (moduleType: string, operationType: string) => {
    const estimate = await estimateCredits(moduleType, operationType);
    if (balance < estimate.estimated) {
      showInsufficientCreditsModal({
        required: estimate.estimated,
        available: balance,
      });
      return false;
    }
    return true;
  };

  // 操作后刷新
  const afterConsume = () => {
    refreshBalance();
  };

  return { canPerform, afterConsume, isLow };
}
```

---

## 8. 实施路线图

### 8.1 Phase 1：核心积分系统（2 周）

**Week 1：后端基础**

| 任务                       | 类型 | 预估 | 优先级 |
| -------------------------- | ---- | ---- | ------ |
| 数据库 Schema 设计和迁移   | 后端 | 0.5d | P0     |
| CreditAccount 服务实现     | 后端 | 1d   | P0     |
| CreditTransaction 服务实现 | 后端 | 1d   | P0     |
| 积分消耗核心逻辑           | 后端 | 1d   | P0     |
| 签到功能实现               | 后端 | 0.5d | P1     |
| API 端点实现               | 后端 | 1d   | P0     |

**Week 2：前端展示 + 集成**

| 任务             | 类型      | 预估 | 优先级 |
| ---------------- | --------- | ---- | ------ |
| CreditBadge 组件 | 前端      | 0.5d | P0     |
| 积分中心页面     | 前端      | 1.5d | P0     |
| 签到弹窗         | 前端      | 0.5d | P1     |
| 积分不足弹窗     | 前端      | 0.5d | P0     |
| AI Ask 集成      | 前端+后端 | 0.5d | P0     |
| AI Studio 集成   | 前端+后端 | 0.5d | P0     |
| 测试和修复       | 测试      | 1d   | P0     |

### 8.2 Phase 2：完整模块集成（1 周）

| 任务               | 类型      | 预估 | 优先级 |
| ------------------ | --------- | ---- | ------ |
| AI Teams 集成      | 前端+后端 | 0.5d | P1     |
| AI Office 集成     | 前端+后端 | 0.5d | P1     |
| AI Coding 集成     | 前端+后端 | 0.5d | P1     |
| AI Simulation 集成 | 前端+后端 | 0.5d | P1     |
| 使用统计图表       | 前端      | 1d   | P1     |
| 管理后台页面       | 前端+后端 | 1d   | P2     |

### 8.3 Phase 3：付费系统（2 周，可延后）

| 任务         | 类型      | 预估 | 优先级 |
| ------------ | --------- | ---- | ------ |
| 支付系统集成 | 后端      | 2d   | P2     |
| 积分套餐管理 | 前端+后端 | 1d   | P2     |
| 充值页面     | 前端      | 1d   | P2     |
| 订阅系统     | 全栈      | 3d   | P2     |
| 财务报表     | 后端      | 1d   | P2     |

### 8.4 里程碑

| 里程碑 | 日期   | 内容                             |
| ------ | ------ | -------------------------------- |
| M1     | Week 1 | 后端核心完成，API 可用           |
| M2     | Week 2 | 前端展示完成，AI Ask/Studio 集成 |
| M3     | Week 3 | 所有 AI 模块集成完成             |
| M4     | Week 5 | 付费系统上线（可选）             |

---

## 9. 风险与依赖

### 9.1 技术风险

| 风险             | 影响 | 概率 | 缓解措施               |
| ---------------- | ---- | ---- | ---------------------- |
| 积分扣减并发问题 | 高   | 中   | 使用数据库事务和乐观锁 |
| Token 计数不准确 | 中   | 中   | 使用 tiktoken 精确计算 |
| 历史用户迁移失败 | 高   | 低   | 提前测试迁移脚本       |
| 性能影响         | 中   | 中   | 积分查询接口缓存       |

### 9.2 产品风险

| 风险             | 影响 | 概率 | 缓解措施               |
| ---------------- | ---- | ---- | ---------------------- |
| 用户反感积分限制 | 高   | 中   | 初始积分充足，签到补充 |
| 定价不合理       | 中   | 中   | A/B 测试，动态调整     |
| 滥用刷积分       | 中   | 中   | 限制签到设备/IP        |

### 9.3 依赖项

| 依赖         | 状态   | 说明                   |
| ------------ | ------ | ---------------------- |
| 用户认证系统 | 已完成 | 基于现有 Auth 模块     |
| AI 服务调用  | 已完成 | 需要在调用后记录 token |
| 前端状态管理 | 已完成 | 使用 Zustand           |
| 支付系统     | 待定   | Phase 3 需要           |

---

## 10. 监控与运营

### 10.1 监控告警机制

**积分异常监控指标：**

| 告警场景         | 阈值                | 级别     | 响应措施            |
| ---------------- | ------------------- | -------- | ------------------- |
| 单用户日消耗异常 | >10x 该用户平均值   | Warning  | 通知运营审核        |
| 单次操作消耗异常 | >单次上限 2000      | Critical | 阻止操作 + 告警     |
| 批量账户余额为负 | >10 账户/小时       | Critical | 紧急告警 + 自动冻结 |
| 退款率异常       | >5% 日退款率        | Warning  | 检查 AI 服务稳定性  |
| 签到异常         | 同 IP 签到 >10 账户 | Warning  | 自动加入黑名单      |
| 积分发放异常     | 单次发放 >100,000   | Critical | 需要二次审批        |

**监控服务实现：**

```typescript
// backend/src/modules/credits/credits-monitor.service.ts

@Injectable()
export class CreditsMonitorService {
  private readonly logger = new Logger(CreditsMonitorService.name);

  // 检查单用户异常消耗
  @Cron("*/10 * * * *") // 每 10 分钟
  async checkAbnormalConsumption(): Promise<void> {
    const abnormalUsers = await this.prisma.$queryRaw`
      SELECT user_id, SUM(ABS(amount)) as today_spent
      FROM credit_transactions
      WHERE created_at > NOW() - INTERVAL '1 day'
        AND amount < 0
      GROUP BY user_id
      HAVING SUM(ABS(amount)) > (
        SELECT AVG(daily_avg) * 10
        FROM (
          SELECT user_id, AVG(daily_spent) as daily_avg
          FROM daily_consumption_stats
          GROUP BY user_id
        ) t
        WHERE t.user_id = credit_transactions.user_id
      )
    `;

    if (abnormalUsers.length > 0) {
      await this.alertService.send({
        level: "warning",
        type: "ABNORMAL_CONSUMPTION",
        data: abnormalUsers,
      });
    }
  }

  // 检查批量负余额
  @Cron("*/5 * * * *") // 每 5 分钟
  async checkNegativeBalances(): Promise<void> {
    const negativeCount = await this.prisma.creditAccount.count({
      where: {
        balance: { lt: 0 },
        updatedAt: { gte: new Date(Date.now() - 3600000) }, // 1小时内
      },
    });

    if (negativeCount > 10) {
      await this.alertService.send({
        level: "critical",
        type: "BATCH_NEGATIVE_BALANCE",
        data: { count: negativeCount },
      });
    }
  }
}
```

**运营数据大盘指标：**

| 指标           | 计算方式                | 刷新频率 |
| -------------- | ----------------------- | -------- |
| 日活跃积分用户 | 今日有消费的用户数      | 实时     |
| 日积分消耗总量 | SUM(今日消费积分)       | 实时     |
| 日积分发放总量 | SUM(今日发放积分)       | 实时     |
| 平均用户余额   | AVG(所有用户余额)       | 每小时   |
| 低余额用户占比 | 余额<500 用户占比       | 每小时   |
| 各模块消耗占比 | 按 moduleType 分组统计  | 每小时   |
| 签到率         | 今日签到数/DAU          | 每日     |
| 充值转化率     | 充值用户/低余额提示用户 | 每日     |

### 10.2 定时任务

| 任务         | 执行时间   | 说明                 |
| ------------ | ---------- | -------------------- |
| 积分过期处理 | 每日 01:00 | 扫描并扣除过期积分   |
| 每日消耗重置 | 每日 00:00 | 重置 todaySpent 字段 |
| 连续签到重置 | 每日 00:05 | 检查并重置断签用户   |
| 异常消费检测 | 每 10 分钟 | 检测并告警异常消费   |
| 缓存预热     | 每 5 分钟  | 预热高频用户积分缓存 |
| 统计报表生成 | 每日 02:00 | 生成前日统计数据     |

**积分过期处理流程：**

```typescript
// backend/src/modules/credits/tasks/expiration.task.ts

@Injectable()
export class ExpirationTask {
  @Cron("0 1 * * *") // 每日凌晨 1 点
  async processExpirations(): Promise<void> {
    const now = new Date();

    // 1. 发送即将过期通知（提前 3 天）
    const expiringAccounts = await this.prisma.creditAccount.findMany({
      where: {
        giftBalance: { gt: 0 },
        giftExpiresAt: {
          gte: now,
          lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        },
      },
      include: { user: true },
    });

    for (const account of expiringAccounts) {
      await this.notificationService.send({
        userId: account.userId,
        type: "CREDITS_EXPIRING",
        data: {
          amount: account.giftBalance,
          expiresAt: account.giftExpiresAt,
        },
      });
    }

    // 2. 扣除已过期积分
    const expiredAccounts = await this.prisma.creditAccount.findMany({
      where: {
        giftBalance: { gt: 0 },
        giftExpiresAt: { lt: now },
      },
    });

    for (const account of expiredAccounts) {
      await this.prisma.$transaction([
        // 创建过期交易记录
        this.prisma.creditTransaction.create({
          data: {
            accountId: account.id,
            type: "EXPIRATION",
            amount: -account.giftBalance,
            balanceAfter: account.balance - account.giftBalance,
            description: `赠送积分过期 (${account.giftBalance})`,
          },
        }),
        // 扣除过期积分
        this.prisma.creditAccount.update({
          where: { id: account.id },
          data: {
            balance: { decrement: account.giftBalance },
            giftBalance: 0,
            giftExpiresAt: null,
          },
        }),
      ]);

      // 发送过期通知
      await this.notificationService.send({
        userId: account.userId,
        type: "CREDITS_EXPIRED",
        data: { amount: account.giftBalance },
      });
    }
  }
}
```

### 10.3 管理员积分管理

**管理员发放积分 API：**

```typescript
// POST /api/admin/credits/grant
interface AdminGrantRequest {
  userId: string; // 目标用户 ID
  amount: number; // 发放积分数量
  type: "ADMIN_GRANT" | "COMPENSATION"; // 发放类型
  reason: string; // 发放原因（必填）
  expiresAt?: string; // 过期时间（可选）
  notifyUser?: boolean; // 是否通知用户（默认 true）
}

interface AdminGrantResponse {
  success: true;
  data: {
    transactionId: string;
    newBalance: number;
    grantedAt: string;
  };
}
```

**发放权限控制：**

| 角色       | 单次上限 | 日上限 | 审批要求         |
| ---------- | -------- | ------ | ---------------- |
| 客服       | 1,000    | 5,000  | 无               |
| 运营       | 10,000   | 50,000 | 无               |
| 管理员     | 100,000  | 无限   | 超过 10 万需审批 |
| 超级管理员 | 无限     | 无限   | 无               |

**发放审计日志：**

所有管理员操作记录到审计表：

```prisma
model AdminAuditLog {
  id        String   @id @default(uuid())
  adminId   String   @map("admin_id")
  action    String   // GRANT_CREDITS, FREEZE_ACCOUNT, etc.
  targetId  String   @map("target_id")
  details   Json
  ipAddress String   @map("ip_address")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([adminId, createdAt(sort: Desc)])
  @@index([action, createdAt(sort: Desc)])
  @@map("admin_audit_logs")
}
```

---

## 11. 模块集成详情

### 11.1 各 AI 模块集成点

| 模块          | 文件路径                                                     | 需改造方法                | 集成方式                        |
| ------------- | ------------------------------------------------------------ | ------------------------- | ------------------------------- |
| AI Ask        | `backend/src/modules/ai/ai-ask/ai-ask.service.ts`            | `chat()`                  | 流式完成后调用 `consumeCredits` |
| AI Studio     | `backend/src/modules/ai/ai-studio/deep-research.service.ts`  | `runResearch()`           | 每阶段完成后分段扣费            |
| AI Teams      | `backend/src/modules/ai/ai-teams/ai-teams.service.ts`        | `processMessage()`        | 每个 AI 回复后扣费              |
| AI Office     | `backend/src/modules/ai/ai-office/office.service.ts`         | `generate()`              | 生成完成后扣费                  |
| AI Coding     | `backend/src/modules/ai/ai-coding/coding.service.ts`         | `analyze()`, `generate()` | 响应完成后扣费                  |
| AI Simulation | `backend/src/modules/ai/ai-simulation/simulation.service.ts` | `runRound()`              | 每回合结束后扣费                |

### 11.2 后端集成模式

```typescript
// backend/src/modules/ai/ai-ask/ai-ask.service.ts

@Injectable()
export class AIAskService {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly aiService: AIOrchestrationService,
  ) {}

  async chat(userId: string, message: string, options: ChatOptions) {
    // 1. 预估积分
    const estimate = await this.creditsService.estimateCredits({
      moduleType: "ai-ask",
      operationType: "chat",
      estimatedTokens: this.tokenCounter.estimate(message),
      modelType: options.modelType,
    });

    // 2. 检查余额
    const balanceCheck = await this.creditsService.checkBalance(
      userId,
      estimate.estimated,
    );

    if (!balanceCheck.sufficient) {
      throw new InsufficientCreditsException(
        estimate.estimated,
        balanceCheck.balance,
      );
    }

    // 3. 执行 AI 调用（流式）
    const response = await this.aiService.chat({
      messages: [{ role: "user", content: message }],
      ...options,
    });

    // 4. 扣减积分（流式完成后）
    const usage = response.usage;
    await this.creditsService.consumeCredits({
      userId,
      moduleType: "ai-ask",
      operationType: "chat",
      tokenCount: usage.totalTokens,
      modelName: options.model,
      modelType: options.modelType,
      referenceId: response.sessionId,
      description: `AI 问答 (${usage.totalTokens} tokens)`,
    });

    return response;
  }
}
```

### 11.3 前端集成模式

```typescript
// frontend/hooks/domain/useAIAsk.ts

export function useAIAsk() {
  const { canPerform, afterConsume } = useCreditsGuard();
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async (message: string, options?: ChatOptions) => {
    // 1. 检查积分
    const canProceed = await canPerform("ai-ask", "chat");
    if (!canProceed) return null;

    setIsLoading(true);
    try {
      // 2. 发送请求
      const response = await api.post("/ai-ask/chat", {
        message,
        ...options,
      });

      // 3. 刷新余额
      afterConsume();

      return response.data;
    } catch (error) {
      if (error.code === "INSUFFICIENT_CREDITS") {
        showInsufficientCreditsModal({
          required: error.required,
          available: error.available,
        });
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return { sendMessage, isLoading };
}
```

---

## 12. 测试策略

### 12.1 单元测试用例

| 测试场景            | 预期结果                          | 优先级 |
| ------------------- | --------------------------------- | ------ |
| 正常扣费            | 余额减少，交易记录创建            | P0     |
| 余额不足            | 抛出 InsufficientCreditsException | P0     |
| 并发扣费（10 并发） | 余额正确，无超扣                  | P0     |
| 余额刚好等于消费    | 扣费成功，余额为 0                | P0     |
| 积分退还            | 余额恢复，REFUND 记录创建         | P0     |
| 赠送积分优先消费    | 先消费赠送积分                    | P1     |
| 过期积分扣除        | 过期积分清零，EXPIRATION 记录     | P1     |
| 每日签到            | 积分增加，连续天数更新            | P1     |
| 重复签到            | 返回已签到状态，不重复发放        | P1     |
| 连续签到 7 天奖励   | 额外奖励发放                      | P2     |

### 12.2 并发测试

```typescript
// backend/src/modules/credits/__tests__/credits.concurrent.spec.ts

describe("Credits Concurrent Test", () => {
  it("should handle 10 concurrent consume requests correctly", async () => {
    // 准备：创建账户，余额 1000
    const userId = await createTestUser({ balance: 1000 });

    // 执行：10 个并发请求，每个消耗 100
    const promises = Array(10)
      .fill(null)
      .map(() =>
        creditsService.consumeCredits({
          userId,
          moduleType: "ai-ask",
          operationType: "chat",
          // 固定消耗 100
        }),
      );

    const results = await Promise.allSettled(promises);

    // 验证：恰好 10 个成功，余额为 0
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded.length).toBe(10);
    expect(failed.length).toBe(0);

    const finalBalance = await getBalance(userId);
    expect(finalBalance).toBe(0);
  });

  it("should reject when balance insufficient during concurrent requests", async () => {
    // 准备：余额 500
    const userId = await createTestUser({ balance: 500 });

    // 执行：10 个并发请求，每个消耗 100
    const promises = Array(10)
      .fill(null)
      .map(() => creditsService.consumeCredits({ userId /* 消耗 100 */ }));

    const results = await Promise.allSettled(promises);

    // 验证：5 个成功，5 个失败
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded.length).toBe(5);
    expect(failed.length).toBe(5);
    failed.forEach((r) => {
      expect(r.reason.code).toBe("INSUFFICIENT_CREDITS");
    });
  });
});
```

### 12.3 集成测试

| 测试场景        | 测试内容                           | 优先级 |
| --------------- | ---------------------------------- | ------ |
| AI Ask 完整流程 | 发送消息 → 积分扣减 → 余额更新     | P0     |
| 积分不足阻断    | 余额不足 → 弹窗提示 → 请求阻断     | P0     |
| 签到流程        | 点击签到 → 积分增加 → 连续天数更新 | P1     |
| 积分中心页面    | 余额显示、交易列表、统计图表       | P1     |
| 管理员发放      | 管理后台发放 → 用户余额增加        | P2     |

### 12.4 性能测试

| 测试场景       | 目标指标    |
| -------------- | ----------- |
| 余额查询 QPS   | ≥1000 QPS   |
| 积分扣减 QPS   | ≥200 QPS    |
| 交易记录查询   | P99 <100ms  |
| 并发扣减准确性 | 100% 无超扣 |

---

## 13. 附录

### 13.1 术语表

| 术语            | 说明                           |
| --------------- | ------------------------------ |
| 积分（Credits） | 平台虚拟货币，用于 AI 功能消费 |
| Token           | AI 模型处理的文本单位          |
| 基础积分        | 每次操作的固定消耗             |
| 模型系数        | 不同模型的成本倍率             |

### 13.2 参考资料

- OpenAI Pricing: https://openai.com/pricing
- Anthropic Pricing: https://www.anthropic.com/pricing
- 竞品分析：ChatGPT Plus、Claude Pro、Perplexity Pro

### 13.3 变更记录

| 版本 | 日期       | 变更内容                                                                                                                    | 作者     |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1.0  | 2025-12-27 | 初始版本                                                                                                                    | PM Agent |
| 1.1  | 2025-12-27 | 补充：异常场景处理、流式响应策略、并发安全、缓存策略、Token计数、监控告警、模块集成详情、签到防刷、管理员积分管理、测试策略 | Claude   |

---

**文档状态**: 草稿

**下一步**:

1. 技术评审，确认数据库设计
2. 确定各模块具体积分消耗数值
3. 开始 Phase 1 开发
