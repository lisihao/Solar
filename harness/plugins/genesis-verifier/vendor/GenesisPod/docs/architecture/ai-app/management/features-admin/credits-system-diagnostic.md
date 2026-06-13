# 积分系统诊断报告

> GenesisPod 积分系统全面诊断分析
>
> **诊断日期**: 2026-01-18
> **完成度评估**: 85%
> **状态**: 核心功能完整，AI 模块已集成

---

## 执行摘要

GenesisPod 的积分系统实现度较高，核心功能完整。主要 AI 模块**已正确集成积分消费逻辑**。

### AI 模块积分集成状态

| 模块           | 文件                                                                               | 调用位置   | 状态      |
| -------------- | ---------------------------------------------------------------------------------- | ---------- | --------- |
| AI Ask         | `backend/src/modules/ai-app/ask/ai-ask.service.ts`                                 | 第 467 行  | ✅ 已调用 |
| Topic Research | `backend/src/modules/ai-app/research/topic-research/topic-research.service.ts`     | 第 796 行  | ✅ 已调用 |
| AI Teams       | `backend/src/modules/ai-app/teams/services/ai/ai-response.service.ts`              | 第 1347 行 | ✅ 已调用 |
| Deep Research  | `backend/src/modules/ai-app/research/deep-research/deep-research-agent.service.ts` | 第 354 行  | ✅ 已调用 |

### 改进空间

- P1: 支付/订阅系统未实现
- P1: 定时任务（过期、重置）缺失
- P2: Redis 缓存层缺失
- P2: **易用性和国际化支持不足**

---

## 1. 系统架构分析

### 1.1 后端架构完整性

#### 已实现的核心模块

| 模块                   | 文件路径                                                       | 完整度 | 状态        |
| ---------------------- | -------------------------------------------------------------- | ------ | ----------- |
| **CreditsService**     | `backend/src/modules/credits/credits.service.ts`               | 95%    | ✅ 完整     |
| **CreditsController**  | `backend/src/modules/credits/credits.controller.ts`            | 90%    | ✅ 完整     |
| **CreditRulesService** | `backend/src/modules/credits/services/credit-rules.service.ts` | 70%    | ⚠️ 部分     |
| **CheckinService**     | `backend/src/modules/credits/services/checkin.service.ts`      | 85%    | ✅ 基本完整 |
| **数据库模型**         | `backend/prisma/schema/models.prisma`                          | 100%   | ✅ 完整     |

### 1.2 前端架构完整性

| 组件                | 文件路径                                       | 完整度 | 状态        |
| ------------------- | ---------------------------------------------- | ------ | ----------- |
| **creditsStore**    | `frontend/stores/creditsStore.ts`              | 80%    | ✅ 基本完整 |
| **useCredits Hook** | `frontend/hooks/domain/useCredits.ts`          | 85%    | ✅ 基本完整 |
| **CreditBadge**     | `frontend/components/credits/CreditBadge.tsx`  | -      | 待评估      |
| **CheckinModal**    | `frontend/components/credits/CheckinModal.tsx` | -      | 待评估      |
| **CreditsPage**     | `frontend/app/credits/page.tsx`                | 60%    | ⚠️ 部分     |

---

## 2. 功能完整性分析

### 2.1 积分获取方式

| 获取方式          | 状态      | 实现位置             |
| ----------------- | --------- | -------------------- |
| 初始赠送 (10,000) | ✅ 已实现 | `credits.service.ts` |
| 每日签到          | ✅ 已实现 | `checkin.service.ts` |
| 连续签到奖励      | ✅ 已实现 | `checkin.service.ts` |
| 邀请奖励          | ❌ 未实现 | -                    |
| 充值购买          | ❌ 未实现 | -                    |
| 订阅系统          | ❌ 未实现 | -                    |

### 2.2 积分消费方式

后端积分规则配置完整（DEFAULT_RULES）：

| 模块      | 操作类型          | 基础积分 |
| --------- | ----------------- | -------- |
| AI Ask    | chat              | 10       |
| AI Ask    | rag-chat          | 15       |
| AI Studio | research-quick    | 200      |
| AI Studio | research-standard | 500      |
| AI Studio | research-deep     | 1,000    |
| AI Teams  | ai-reply          | 30       |
| AI Teams  | debate            | 50       |
| AI Office | generate-ppt      | 300      |
| AI Office | generate-doc      | 200      |

### 2.3 API 端点

**用户端点**:

- `GET /api/credits` - 获取账户信息
- `GET /api/credits/balance` - 获取余额
- `GET /api/credits/stats` - 获取统计
- `GET /api/credits/transactions` - 获取交易记录
- `POST /api/credits/checkin` - 执行签到

**管理员端点**:

- `POST /api/admin/credits/grant` - 发放积分
- `POST /api/admin/credits/freeze` - 冻结账户
- `GET /api/admin/credits/account/:userId` - 获取用户账户详情

---

## 3. 易用性问题诊断

### 3.1 用户体验问题

| 问题                   | 影响                         | 建议                     |
| ---------------------- | ---------------------------- | ------------------------ |
| **积分余额展示不直观** | 用户不清楚剩余积分能做什么   | 添加"预计可用次数"展示   |
| **消费前无预估**       | 用户不知道操作会消耗多少积分 | 在 AI 操作前显示预估消费 |
| **签到入口不明显**     | 用户可能错过每日签到         | Header 添加签到提醒      |
| **积分不足提示不友好** | 用户不知道如何获取更多积分   | 弹窗中添加获取积分方式   |
| **交易记录可读性差**   | 用户看不懂技术性的交易描述   | 使用友好的操作描述       |

### 3.2 建议的 UX 改进

**1. 积分余额卡片增强**

```tsx
// 当前：仅显示数字
<div>余额: 5,000</div>

// 建议：显示可用次数
<div>
  <span>余额: 5,000 积分</span>
  <span>约可进行 50 次 AI 对话 或 5 次深度研究</span>
</div>
```

**2. 操作前积分预估**

```tsx
// 在 AI 操作按钮旁显示
<Button onClick={startResearch}>
  开始研究
  <Badge>预计消费 500 积分</Badge>
</Button>
```

**3. 签到提醒**

```tsx
// Header 中添加签到状态
{
  !hasCheckedIn && (
    <Tooltip content="今日尚未签到，点击签到领取积分">
      <Button variant="ghost" onClick={showCheckinModal}>
        <Gift className="animate-bounce" />
      </Button>
    </Tooltip>
  );
}
```

---

## 4. 国际化问题诊断

### 4.1 当前国际化状态

| 组件     | i18n 状态 | 问题                 |
| -------- | --------- | -------------------- |
| 积分页面 | ⚠️ 部分   | 部分文本硬编码       |
| 签到弹窗 | ⚠️ 部分   | 奖励描述未国际化     |
| 交易记录 | ❌ 缺失   | 操作类型硬编码英文   |
| 错误提示 | ❌ 缺失   | 后端错误消息未国际化 |
| 管理后台 | ❌ 缺失   | 大量硬编码文本       |

### 4.2 需要国际化的内容

**前端文本**（添加到 `locales/zh.json` 和 `locales/en.json`）:

```json
{
  "credits": {
    "balance": "积分余额",
    "totalEarned": "累计获得",
    "totalSpent": "累计消费",
    "todaySpent": "今日消费",
    "checkin": {
      "title": "每日签到",
      "reward": "签到奖励",
      "streak": "连续签到 {days} 天",
      "bonus": "额外奖励 +{amount}",
      "success": "签到成功，获得 {amount} 积分"
    },
    "transaction": {
      "types": {
        "consume": "消费",
        "grant": "发放",
        "checkin": "签到",
        "refund": "退款"
      },
      "modules": {
        "ai-ask": "AI 对话",
        "ai-studio": "深度研究",
        "ai-teams": "AI 团队",
        "ai-office": "AI 办公"
      }
    },
    "insufficient": {
      "title": "积分不足",
      "message": "当前操作需要 {required} 积分，您的余额为 {balance} 积分",
      "howToGet": "如何获取积分？",
      "checkinTip": "每日签到可获得 50-300 积分"
    }
  }
}
```

**后端错误消息国际化**:

```typescript
// 当前
throw new BadRequestException("Insufficient credits");

// 建议：返回错误码，前端根据错误码显示国际化文本
throw new InsufficientCreditsException({
  code: "CREDITS_INSUFFICIENT",
  required: 500,
  balance: 100,
});
```

### 4.3 数字和日期格式化

```typescript
// 使用 Intl API 进行本地化格式
const formatCredits = (amount: number, locale: string) => {
  return new Intl.NumberFormat(locale).format(amount);
};

// 中文: 5,000
// 英文: 5,000

const formatDate = (date: Date, locale: string) => {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
};

// 中文: 2026年1月18日
// 英文: January 18, 2026
```

---

## 5. 改进建议

### 5.1 优先级 1（易用性）

1. **积分预估展示** - 在 AI 操作前显示预估消费
2. **友好的交易记录** - 使用可读的操作描述
3. **签到提醒** - Header 添加签到入口和提醒
4. **积分不足引导** - 弹窗中显示获取积分方式

### 5.2 优先级 2（国际化）

5. **前端文本国际化** - 所有积分相关文本使用 i18n
6. **后端错误码** - 返回错误码而非文本
7. **数字/日期格式化** - 使用 Intl API
8. **管理后台国际化** - 积分管理页面多语言

### 5.3 优先级 3（功能完善）

9. 支付/充值系统
10. 定时任务（过期、重置）
11. Redis 缓存层

---

## 6. 关键文件清单

### 后端

| 文件                                                                               | 状态          |
| ---------------------------------------------------------------------------------- | ------------- |
| `backend/src/modules/credits/credits.service.ts`                                   | ✅ 核心完整   |
| `backend/src/modules/credits/credits.controller.ts`                                | ✅ 完整       |
| `backend/src/modules/ai-app/ask/ai-ask.service.ts:467`                             | ✅ 已集成积分 |
| `backend/src/modules/ai-app/research/topic-research/topic-research.service.ts:796` | ✅ 已集成积分 |
| `backend/src/modules/ai-app/teams/services/ai/ai-response.service.ts:1347`         | ✅ 已集成积分 |

### 前端

| 文件                                | 状态                |
| ----------------------------------- | ------------------- |
| `frontend/stores/creditsStore.ts`   | ⚠️ 需优化：缓存同步 |
| `frontend/app/credits/page.tsx`     | ⚠️ 需国际化         |
| `frontend/lib/i18n/locales/zh.json` | ⚠️ 需补充积分文本   |
| `frontend/lib/i18n/locales/en.json` | ⚠️ 需补充积分文本   |

---

## 总结

积分系统核心功能已完整实现（85%），AI 模块已正确集成消费逻辑。主要改进方向：

1. **易用性提升** - 积分预估、签到提醒、友好的交易记录
2. **国际化支持** - 文本、数字、日期的本地化
3. **功能扩展** - 支付系统、定时任务

---

**最后更新**: 2026-01-18
**诊断人**: Claude Code
