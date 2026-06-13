# AI Simulation - 商业博弈模拟器

> 红蓝对抗 + 多方博弈 + 战略推演，模拟真实商业世界的决策过程

**最后更新**: 2026-01-15
**版本**: v1.0
**状态**: 生产环境

---

## 概述

AI Simulation 是 GenesisPod 的商业博弈模拟模块，通过模拟多方 Agent 在竞争环境中的决策和互动，帮助用户推演战略方案、评估风险和预测结果。

### 核心特性

- **场景编排**: 定义行业、市场、公司和 Agent 角色
- **红蓝对抗**: 模拟竞争对手的策略和反应
- **多方博弈**: 支持 3+ 方参与的复杂推演
- **视角切换**: 上帝视角 / 阵营视角切换查看
- **实时干预**: 推演过程中注入事件影响结果
- **外部数据**: 集成真实市场数据增强真实性

---

## 系统架构

### 核心概念

```
Scenario（场景）
    ├── Companies（公司）
    │   ├── Metrics（指标）
    │   ├── Public Data（公开数据）
    │   └── Private Data（私密数据）
    ├── Agents（智能体）
    │   ├── Team（阵营）: RED | BLUE | GREEN | WHITE
    │   ├── Role（角色）: CEO | CMO | CFO | CTO
    │   ├── Persona（人设）
    │   ├── Memory Public（公开记忆）
    │   └── Memory Private（私密记忆）
    └── Runs（推演）
        ├── Rounds（回合）
        ├── Turns（轮次）
        ├── Submissions（提交）
        └── World State（世界状态）
```

### 技术栈

| 层级     | 技术选型                  |
| -------- | ------------------------- |
| 后端     | NestJS + AI Engine        |
| 数据存储 | PostgreSQL                |
| 推演引擎 | AiSimulationEngineService |
| 外部数据 | ExternalDataService       |
| AI 决策  | AIEngineFacade            |

---

## 功能模块

### 1. 场景管理

#### 创建场景

```typescript
POST /api/v1/ai-simulation/scenarios
{
  "name": "电商大战 2026",
  "industry": "E-commerce",
  "region": "China",
  "goals": {
    "rounds": 5,
    "winCondition": "市场份额 > 50%"
  },
  "companies": [
    {
      "name": "A公司",
      "type": "incumbent", // incumbent | challenger | startup
      "market": "consumer",
      "metrics": {
        "revenue": 1000000000,
        "marketShare": 0.35,
        "growth": 0.15
      }
    },
    {
      "name": "B公司",
      "type": "challenger",
      "market": "consumer",
      "metrics": {
        "revenue": 500000000,
        "marketShare": 0.20,
        "growth": 0.30
      }
    }
  ],
  "agents": [
    {
      "companyName": "A公司",
      "team": "RED",
      "role": "CEO",
      "persona": {
        "personality": "aggressive",
        "riskTolerance": "high",
        "expertise": ["marketing", "operations"]
      }
    },
    {
      "companyName": "B公司",
      "team": "BLUE",
      "role": "CEO",
      "persona": {
        "personality": "cautious",
        "riskTolerance": "medium",
        "expertise": ["product", "technology"]
      }
    }
  ]
}

Response:
{
  "id": "scenario-xxx",
  "name": "电商大战 2026",
  "companies": [...],
  "agents": [...]
}
```

#### 更新场景

```typescript
PATCH /api/v1/ai-simulation/scenarios/:id
{
  "name": "电商大战 2026 Q2",
  "companies": [...], // 完全替换
  "agents": [...]     // 完全替换
}
```

#### 删除场景

```typescript
DELETE /api/v1/ai-simulation/scenarios/:id
```

### 2. 推演执行

#### 启动推演

```typescript
POST /api/v1/ai-simulation/scenarios/:id/runs
{
  "rounds": 5, // 推演回合数
  "params": {
    "startDate": "2026-Q1",
    "marketCondition": "growth" // growth | stable | recession
  }
}

Response:
{
  "id": "run-xxx",
  "status": "RUNNING",
  "currentRound": 0,
  "rounds": 5
}

# 立即返回，后台异步执行
# 通过轮询 GET /runs/:id 获取进度
```

#### 推演流程

```
Round 1:
  Turn 1:
    ├── RED CEO  提交决策（Public Action + Inner Monologue）
    ├── BLUE CEO 提交决策
    └── System   计算结果，更新 World State
  Turn 2:
    ├── RED CMO  提交决策
    ├── BLUE CMO 提交决策
    └── System   计算结果
  Summary: 汇总本回合结果

Round 2:
  ...

Final Summary: 推演结束，生成报告
```

#### 查询推演状态

```typescript
GET /api/v1/ai-simulation/runs/:id?perspective=GOD

Response:
{
  "id": "run-xxx",
  "status": "RUNNING", // RUNNING | PAUSED | COMPLETED | FAILED
  "currentRound": 2,
  "rounds": 5,
  "worldState": {
    "market": {
      "totalSize": 5000000000,
      "growth": 0.10
    },
    "companies": [
      {
        "name": "A公司",
        "revenue": 1050000000,
        "marketShare": 0.33,
        "recentActions": ["降价促销", "推出新品"]
      }
    ],
    "events": [
      "政策变化: 电商税率上调 2%"
    ]
  },
  "turns": [
    {
      "roundNumber": 1,
      "turnNumber": 1,
      "summary": "RED 公司降价 10%，BLUE 公司推出新品",
      "submissions": [
        {
          "team": "RED",
          "role": "CEO",
          "publicAction": "降价 10% 抢占市场",
          "innerMonologue": "必须快速扩大市场份额", // 仅上帝视角可见
          "irrational": false
        }
      ]
    }
  ]
}
```

### 3. 视角切换

#### 视角类型

| 视角    | 说明     | 可见信息                      |
| ------- | -------- | ----------------------------- |
| `GOD`   | 上帝视角 | 所有信息（Public + Private）  |
| `RED`   | 红方视角 | 红方完整信息 + 其他方公开信息 |
| `BLUE`  | 蓝方视角 | 蓝方完整信息 + 其他方公开信息 |
| `GREEN` | 绿方视角 | 绿方完整信息 + 其他方公开信息 |
| `WHITE` | 白方视角 | 白方完整信息 + 其他方公开信息 |

#### 切换视角

```typescript
GET /api/v1/ai-simulation/runs/:id?perspective=RED

# 返回结果中:
# - RED 阵营的 innerMonologue、tools 等私密信息可见
# - BLUE 阵营的私密信息被过滤为 undefined
```

### 4. 实时干预

#### 注入事件

```typescript
POST /api/v1/ai-simulation/runs/:id/intervene
{
  "message": "突发: 监管机构要求所有电商平台降低手续费",
  "injectEvent": {
    "type": "regulation",
    "impact": {
      "commissionRate": -0.02 // 手续费率 -2%
    }
  }
}

# 影响后续回合的推演
# 所有 Agent 会看到这个事件并调整策略
```

#### 暂停/恢复推演

```typescript
POST /api/v1/ai-simulation/runs/:id/pause
POST /api/v1/ai-simulation/runs/:id/resume
```

### 5. 外部数据集成

#### 配置外部数据源

```typescript
// 在 Scenario 中配置
{
  "dataSources": {
    "marketData": {
      "provider": "bloomberg",
      "symbols": ["ECOMM-INDEX"]
    },
    "news": {
      "provider": "newsapi",
      "keywords": ["e-commerce", "online shopping"]
    }
  }
}
```

#### 数据使用

推演过程中，Agent 可以：

- 查询真实市场数据
- 参考最新新闻事件
- 基于真实数据做出决策

---

## API 接口

### 场景管理

| 方法   | 路径                                  | 说明         |
| ------ | ------------------------------------- | ------------ |
| POST   | `/api/v1/ai-simulation/scenarios`     | 创建场景     |
| GET    | `/api/v1/ai-simulation/scenarios`     | 获取场景列表 |
| GET    | `/api/v1/ai-simulation/scenarios/:id` | 获取场景详情 |
| PATCH  | `/api/v1/ai-simulation/scenarios/:id` | 更新场景     |
| DELETE | `/api/v1/ai-simulation/scenarios/:id` | 删除场景     |

### 推演管理

| 方法   | 路径                                       | 说明         |
| ------ | ------------------------------------------ | ------------ |
| POST   | `/api/v1/ai-simulation/scenarios/:id/runs` | 启动推演     |
| GET    | `/api/v1/ai-simulation/runs/:id`           | 获取推演状态 |
| POST   | `/api/v1/ai-simulation/runs/:id/pause`     | 暂停推演     |
| POST   | `/api/v1/ai-simulation/runs/:id/resume`    | 恢复推演     |
| POST   | `/api/v1/ai-simulation/runs/:id/intervene` | 注入事件     |
| DELETE | `/api/v1/ai-simulation/runs/:id`           | 删除推演     |

---

## 数据模型

### SimulationScenario

```prisma
model SimulationScenario {
  id          String   @id @default(cuid())
  name        String
  industry    String   // 行业
  region      String?  // 地区
  goals       Json?    // 推演目标
  constraints Json?    // 约束条件
  dataSources Json?    // 外部数据源配置
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  companies   SimulationCompany[]
  agents      SimulationAgent[]
  runs        SimulationRun[]
}
```

### SimulationAgent

```prisma
model SimulationAgent {
  id            String   @id @default(cuid())
  scenarioId    String
  companyId     String?  // 所属公司（可选）
  team          SimulationTeam // RED | BLUE | GREEN | WHITE
  role          String   // CEO | CMO | CFO | CTO | ...
  persona       Json?    // 人设和决策偏好
  memoryPublic  Json?    // 公开记忆
  memoryPrivate Json?    // 私密记忆
  tools         Json?    // 可用工具
  createdAt     DateTime @default(now())

  scenario      SimulationScenario @relation(fields: [scenarioId], references: [id], onDelete: Cascade)
  company       SimulationCompany? @relation(fields: [companyId], references: [id], onDelete: SetNull)
}

enum SimulationTeam {
  RED
  BLUE
  GREEN
  WHITE
}
```

### SimulationRun

```prisma
model SimulationRun {
  id           String   @id @default(cuid())
  scenarioId   String
  status       SimulationRunStatus @default(RUNNING)
  rounds       Int      @default(3)
  currentRound Int      @default(0)
  params       Json?    // 推演参数
  worldState   Json?    // 世界状态
  result       Json?    // 最终结果
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  turns        SimulationTurn[]
}

enum SimulationRunStatus {
  RUNNING
  PAUSED
  COMPLETED
  FAILED
}
```

### SimulationTurn

```prisma
model SimulationTurn {
  id           String   @id @default(cuid())
  runId        String
  roundNumber  Int      // 第几回合
  turnNumber   Int      // 回合内第几轮
  summary      String?  // 本轮总结
  submissions  Json?    // Agent 提交的决策
  worldDelta   Json?    // 世界状态变化
  createdAt    DateTime @default(now())

  run          SimulationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
}
```

---

## 核心服务说明

### AiSimulationEngineService

推演引擎，负责：

- 执行推演流程（回合、轮次）
- 调用 Agent 生成决策
- 计算世界状态变化
- 生成推演报告

### ExternalDataService

外部数据服务，负责：

- 集成真实市场数据
- 提取新闻事件
- 为 Agent 提供数据支持

### AiSimulationService

主服务，负责：

- 场景 CRUD
- 推演生命周期管理
- 视角过滤
- 干预处理

---

## 前端集成

### Hook 使用

```typescript
import { useScenarios, useRun, useRunPolling } from '@/hooks/domain';

function SimulationPage({ scenarioId }) {
  const { scenario } = useScenario(scenarioId);
  const { startRun, loading } = useStartRun(scenarioId);
  const { run, refresh } = useRunPolling(runId, {
    interval: 2000,
    perspective: 'GOD'
  });

  return (
    <div>
      <button onClick={startRun}>启动推演</button>
      <RunProgress run={run} />
    </div>
  );
}
```

### 路由结构

```
/ai-simulation
  ├── /                         # 场景列表
  ├── /new                      # 创建场景
  ├── /[scenarioId]             # 场景详情
  │   ├── /                     # 场景配置
  │   ├── /companies            # 公司管理
  │   ├── /agents               # Agent 管理
  │   └── /runs                 # 推演历史
  └── /runs/[runId]             # 推演详情/实时查看
```

---

## 使用指南

### 1. 创建场景

```bash
# 定义竞争场景
curl -X POST https://api.gens.team/api/v1/ai-simulation/scenarios \
  -d '{
    "name": "外卖大战",
    "industry": "Food Delivery",
    "companies": [
      {"name": "美团", "team": "RED", ...},
      {"name": "饿了么", "team": "BLUE", ...}
    ],
    "agents": [...]
  }'
```

### 2. 配置 Agent

为每个公司配置关键决策者：

- **CEO**: 战略决策
- **CMO**: 市场营销
- **CFO**: 财务控制
- **CTO**: 技术创新

每个 Agent 有独立的人设和记忆。

### 3. 启动推演

```bash
curl -X POST https://api.gens.team/api/v1/ai-simulation/scenarios/SCENARIO_ID/runs \
  -d '{"rounds": 5}'

# 立即返回 runId
# 后台异步执行，通过轮询查看进度
```

### 4. 切换视角查看

```bash
# 上帝视角 - 查看所有信息
GET /api/v1/ai-simulation/runs/RUN_ID?perspective=GOD

# 红方视角 - 只看红方私密信息
GET /api/v1/ai-simulation/runs/RUN_ID?perspective=RED
```

### 5. 实时干预

```bash
# 在推演过程中注入事件
curl -X POST https://api.gens.team/api/v1/ai-simulation/runs/RUN_ID/intervene \
  -d '{
    "message": "政府出台补贴政策",
    "injectEvent": {"type": "policy", "subsidy": 1000000}
  }'
```

---

## 最佳实践

### 1. 场景设计

- **明确目标**: 定义清晰的胜利条件
- **平衡对手**: 初始实力不宜悬殊过大
- **真实数据**: 使用真实市场数据增强可信度

### 2. Agent 配置

- **人设差异**: 不同 Agent 有不同决策风格
- **专业分工**: CEO 战略、CMO 市场、CFO 财务
- **记忆管理**: 公开记忆（竞争对手可见）vs 私密记忆

### 3. 推演参数

- **回合数**: 建议 3-10 回合
- **干预时机**: 关键节点注入事件测试应变能力

---

## 应用场景

### 1. 战略推演

- 评估新产品进入市场的竞争格局
- 模拟价格战、并购等关键决策
- 预测竞争对手反应

### 2. 风险评估

- 模拟极端情况下的企业表现
- 测试应急预案的有效性
- 识别潜在风险点

### 3. 决策训练

- 管理层战略决策演练
- 多方博弈思维训练
- 危机应对能力提升

---

## 相关文档

- [AI Engine 架构](../../../architecture/ai-engine.md)
- [Multi-Agent 协作机制](../ai-teams/readme.md)

---

## 更新日志

### v1.0 (2026-01-15)

- 初始版本发布
- 红蓝对抗模拟
- 多方博弈支持
- 视角切换功能
- 实时干预机制
- 外部数据集成
