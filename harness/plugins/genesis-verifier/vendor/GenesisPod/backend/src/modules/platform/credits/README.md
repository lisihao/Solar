# credits

> `platform/credits`（L1 平台基础设施层）负责通用额度账户、账本流水和受控计费策略，不承载 `ai-engine` / `ai-harness` 的运行时编排。

## 结构

```text
credits/
├── policy/
│   └── credit-rules.service.ts
├── rewards/
│   └── checkin.service.ts
├── credits.service.ts
├── credits.controller.ts
├── credits.module.ts
└── billing-context.ts
```

## 边界

- `credits.service.ts`
  - 额度账户与流水账本核心
  - 负责扣费、退款、账户状态、交易查询

- `policy/`
  - 计费规则与定价策略
  - 允许包含模块类型、操作类型、模型维度的策略声明
  - 不应演化为任意业务流程编排入口

- `rewards/`
  - 通用奖励策略
  - 当前仅保留签到奖励

## 后续收敛

- 将产品线强耦合规则继续从通用账本语义中隔离到更明确的 policy surface
- 保持 `credits.service.ts` 聚焦 ledger/quota core，不回流 app 级产品逻辑
