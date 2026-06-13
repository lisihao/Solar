# AI Simulation 架构文档

> AI 商业战争模拟平台 - 多阵营对抗推演引擎

**版本**: 1.0
**最后更新**: 2026-02-01
**维护者**: GenesisPod Team

---

## 概述

AI Simulation 是企业级商业战争推演平台，通过 AI Agent 模拟多方利益相关者的战略决策博弈。核心特性包括：

- **多阵营对抗**: Blue/Red/Green/White/Chaos 五方博弈
- **AI 智能决策**: LLM 驱动的 Agent 决策，支持多模型 fallback
- **外部数据融合**: 集成市场、财经、新闻、监管等真实数据源
- **黑天鹅注入**: 随机注入供应链中断、监管突变、技术突破等不可预测事件
- **人机协同**: 支持人类干预和暂停机制（human-in-the-loop）
- **视角控制**: GOD/Team 视角的信息不对称设计
- **AI 辅助**: LLM 驱动的场景生成、角色推荐、指标生成

---

## 核心组件

### 1. AiSimulationService

**职责**: 模拟推演的 Facade 层，提供场景管理和运行控制接口

**核心方法**:

- `createScenario()` - 创建推演场景（行业、公司、Agent 配置）
- `updateScenario()` - 更新场景配置（支持公司和 Agent 的全量替换）
- `startRun()` - 启动推演（异步执行，立即返回 Run ID）
- `resumeRun()` / `pauseRun()` - 人机协同控制
- `interveneRun()` - 人类干预注入事件
- `getRunById(id, perspective)` - 获取推演状态（支持视角过滤）
- `deleteScenario()` / `deleteRun()` - 清理资源

**关键设计**:

- **异步执行**: `startRun()` 使用 `BillingContext.run()` 包装后台任务，不阻塞前端
- **视角过滤**: `filterSubmissionByPerspective()` 实现信息不对称
  - GOD 视角：查看所有内心独白（`innerMonologue`）和公开行动（`publicAction`）
  - 阵营视角：本方全信息，他方仅公开行动

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.service.ts`

---

### 2. AiSimulationEngineService

**职责**: 推演执行引擎，负责回合推进、Agent 决策生成、裁决和状态更新

**核心流程**:

#### 2.1 推演执行 (`executeRun`)

```
1. 初始化世界状态（从 ExternalDataService 获取快照）
2. 循环推演回合（rounds）
   ├─ 生成各 Agent 决策（并行调用 LLM）
   ├─ 裁决评估（simpleAdjudication）
   ├─ 黑天鹅事件注入（10% 概率）
   ├─ 更新世界状态（累积 worldDelta）
   └─ 检查人工介入点（humanBreakEvery）
3. 生成推演总结（computeDebrief）
```

#### 2.2 Agent 决策生成 (`generateAgentDecision`)

**策略**: 多模型 fallback（CHAT_FAST → CHAT → 模板）

**输入**:

- Agent 信息（team, role, persona, memoryPublic）
- worldState（市场、财务、新闻、监管数据 + 黑天鹅事件）
- roundNumber（当前回合）
- irrationalBias（非理性偏见注入）

**输出**:

```json
{
  "innerMonologue": "内心思考过程（私密）",
  "publicAction": "公开行动声明（所有人可见）"
}
```

**模型选择逻辑**:

1. 获取所有可用模型（CHAT_FAST 优先，CHAT 回退）
2. 遍历模型，跳过 `isAvailable=false` 的模型
3. 检测错误类型：
   - Quota/Rate Limit: `quota`, `rate_limit`, `429`
   - Token Limit: `max_tokens`, `truncated`, `finish_reason=length`
   - Empty Response: `No response content`
4. 失败时尝试下一个模型，全部失败则使用模板

**Prompt 构建**:

- **System Prompt**: 定义角色、阵营、场景背景
  - BLUE: "蓝军（我方/主角），保持市场份额、抵御竞争"
  - RED: "红军（对手/挑战者），抢占市场、颠覆格局"
  - GREEN: "绿军（市场/客户/供应商），追求自身利益最大化"
  - WHITE: "白方（裁判/监管机构），关注合规、公平竞争"
  - CHAOS: "混沌军（黑天鹅制造者），引入不可预测的冲击"
  - ARBITER: "裁判，评估各方行动可行性"

- **User Prompt**: 提供当前态势（外部数据、黑天鹅、非理性因素）

**响应解析**:

1. 清理 Markdown 代码块标记（`\`\`\`json`）
2. 提取 JSON 对象（正则匹配）
3. 回退策略：纯文本 → 默认值（避免暴露原始 JSON）

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:112-368`

---

#### 2.3 裁决机制 (`simpleAdjudication`)

**输入**: Run 信息 + 各 Agent 提交的决策（submissions）

**判定逻辑**:

1. **资金可行性检查**: 如果 `intent.cost > 公司现金`，返回 `rejected_insufficient_funds`
2. **数据完整性检查**: 检查 market/finance/news/regulation 是否缺失
3. **黑天鹅触发**: 以 `chaosProb`（默认 10%）概率触发
4. **非理性因素注入**: 30% 概率注入 `irrational_spike`

**输出**:

```typescript
{
  ruling: "proceed" | "rejected_insufficient_funds" | "insufficient_evidence" | "black_swan",
  notes: "裁判判定说明",
  evidenceRefs: [
    { provider: "market", status: "ok" },
    { provider: "chaos", status: "triggered", event: {...} }
  ],
  worldDelta: {
    last_submissions: 5,
    blackSwan: { name: "供应链中断", ... },
    irrationalBias: "irrational_spike"
  },
  blackSwanEvent?: { type, name, description, impact, affectedTeams }
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:579-735`

---

#### 2.4 总结生成 (`computeDebrief`)

生成公开版和内部版报告：

**公开版**（`publicReport`）:

- keyFindings（关键发现）
- causalChain（因果链，前 5 条）
- blackSwanEvents（黑天鹅事件历史）

**内部版**（`internalReport`）:

- 完整因果链
- biasesDetected（偏见识别）
  - `overconfidence`: 资金不足仍大额投入
  - `irrational_spike`: 非理性决策
- blindspots（盲点）
  - `data_gap`: 外部数据源未配置
  - `team_behavior`: 阵营非理性决策频率过高
- counterfactuals（反事实推理）
  - "如果黑天鹅未发生，市场格局可能不同"
- monologueLog（所有内心独白日志）

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:737-963`

---

### 3. ExternalDataService

**职责**: 外部数据源集成（市场、财经、新闻、监管 API）

**核心方法**:

- `getSnapshot(categories)` - 批量获取外部数据快照
- `fetchFromProvider(category)` - 从配置的 Provider 获取数据
- `testProvider(config)` - 测试 Provider 配置可用性

**Provider 配置**:

从 `SystemSetting` 表读取 `external.providers`，格式：

```json
[
  {
    "id": "alphavantage_market",
    "name": "Alpha Vantage Market Data",
    "category": "market",
    "baseUrl": "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=",
    "apiKey": "YOUR_API_KEY",
    "enabled": true,
    "isDefault": true
  }
]
```

**认证策略**:

- **URL 参数认证**: 如果 `baseUrl` 以 `apiKey=` 等结尾，直接拼接 API Key
- **Bearer Token 认证**: 否则使用 `Authorization: Bearer {apiKey}` Header

**选择逻辑**:

1. 按 category 查找所有 Provider
2. 优先级：`isDefault && enabled` > `enabled` > 第一个
3. 如果 `enabled=false` 或 `baseUrl` 缺失，返回错误

**代码位置**: `backend/src/modules/ai-app/simulation/external-data.service.ts`

---

### 4. AIAssistService

**职责**: AI 辅助场景生成，使用 LLM 推荐公司、角色、指标和参数

**核心方法**:

#### 4.1 行业分析 (`analyzeIndustry`)

**输入**: `{ industry, region, existingCompanies }`

**输出**:

```json
{
  "companies": [
    {
      "name": "公司名",
      "type": "competitor/customer/supplier",
      "market": "Global",
      "reason": "推荐理由"
    }
  ],
  "agents": [{ "role": "监管官员", "team": "WHITE", "reason": "政策合规审查" }],
  "goals": {
    "targetShare": "提升市场份额",
    "risk": "控制经营风险",
    "growth": "实现可持续增长"
  },
  "insights": ["行业洞察1", "行业洞察2"]
}
```

**策略**: 遍历所有可用模型（从数据库读取），过滤错误响应（`**API Key 未配置**`）

**代码位置**: `backend/src/modules/ai-app/simulation/ai-assist.service.ts:142-210`

---

#### 4.2 角色推荐 (`suggestAgents`)

**核心逻辑**:

1. **蓝军**: 绑定用户选择的公司
2. **红军**: 为每个竞争对手公司生成角色
   - 每个 `competitor` 至少 1 个 CEO
   - 最强 2 家（`benchmark/challenger`）增加销售 VP
3. **绿军**: 为客户/供应商公司生成代表
   - `customer` → 客户代表
   - `supplier` → 供应商代表
4. **白军/CHAOS**: 从模板取，不绑定公司

**公司类型识别**:

- `competitor`, `challenger`, `startup`, `benchmark` → RED
- `customer`, `supplier`, `regional` → GREEN

**代码位置**: `backend/src/modules/ai-app/simulation/ai-assist.service.ts:390-521`

---

#### 4.3 指标生成 (`generateCompanyMetrics`)

**三层策略**:

1. **外部 API**: 调用 `ExternalDataService.fetchFromProvider("finance")` 获取真实数据
2. **LLM 生成**: 结合外部数据用 LLM 生成（数据来源标记为 `"LLM + External API"`）
3. **本地模板**: 回退到硬编码模板 + 行业调整系数（数据来源 `"Local Template (Fallback)"`）

**指标字段**:

```json
{
  "cash": 50000, // 现金储备（万美元）
  "share": 35, // 市场份额（%）
  "margin": 45, // 毛利率（%）
  "debt": 20000, // 负债（万美元）
  "capacity": 8000, // 产能（单位数）
  "inventory": 1000, // 库存（单位数）
  "priceBand": "高端",
  "delivery": "2-4周",
  "patents": 1500, // 专利数
  "channels": "直销+代理",
  "brand": "global_leader"
}
```

**行业调整系数** (`INDUSTRY_MODIFIERS`):

- `AI Compute Infrastructure`: cashMultiplier=2, marginBonus=10, patentMultiplier=3
- `Semiconductor`: cashMultiplier=3, marginBonus=15, patentMultiplier=5
- `Healthcare`: cashMultiplier=2.5, patentMultiplier=4

**代码位置**: `backend/src/modules/ai-app/simulation/ai-assist.service.ts:562-926`

---

#### 4.4 参数推荐 (`suggestParams`)

根据行业特征推荐推演参数：

**行业分类**:

- `isHighVolatility`: AI Compute, Semiconductor, EVs → `chaosProb=0.35`, `rounds=6`
- `isHighRegulation`: Fintech, Healthcare → `humanBreakEvery=1`, `irrationalProb=0.1`
- `isFastPaced`: E-commerce, SaaS → `blindMove=true`, `chaosProb=0.25`
- `isGeopolitical`: AI Compute, Semiconductor → `chaosProb += 0.15`

**输出示例**:

```json
{
  "blindMove": true,
  "cot": true,
  "chaosProb": 0.35,
  "irrationalProb": 0.25,
  "humanBreakEvery": 2,
  "rounds": 6,
  "enabledEvents": ["supply_chain", "regulation", "tech", "finance"],
  "reasoning": "基于AI Compute Infrastructure行业特征：高波动性行业，建议较高的黑天鹅概率和更多轮次"
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-assist.service.ts:931-1093`

---

## 关键流程

### 场景创建流程

```
1. 用户选择行业（如 "AI Compute Infrastructure"）
2. AI Assist 推荐公司列表（analyzeIndustry）
3. 用户选择公司 → AI 推荐角色（suggestAgents）
4. 为每个公司生成量化指标（generateCompanyMetrics）
   ├─ 外部 API 获取真实数据
   ├─ LLM 结合数据生成
   └─ 回退到本地模板
5. AI 推荐推演参数（suggestParams）
6. 创建 Scenario（createScenario）
```

**数据流**:

```
Frontend → AiSimulationController.createScenario()
         → AiSimulationService.createScenario()
         → Prisma.simulationScenario.create()
         → Prisma.simulationCompany.createMany()
         → Prisma.simulationAgent.createMany()
```

---

### 模拟运行流程

```
1. 启动推演（startRun）
   └─ 异步执行 BillingContext.run(() => engine.executeRun())

2. 初始化世界状态
   └─ ExternalDataService.getSnapshot() → 获取市场/财务/新闻/监管数据

3. 每回合循环（for round = 1 to rounds）:
   ├─ 并行生成所有 Agent 决策（Promise.all）
   │  ├─ 构建 Prompt（角色 + 态势）
   │  ├─ 调用 LLM（多模型 fallback）
   │  └─ 解析 JSON（innerMonologue + publicAction）
   │
   ├─ 裁决评估（simpleAdjudication）
   │  ├─ 资金可行性检查
   │  ├─ 黑天鹅触发（10% 概率）
   │  └─ 非理性因素注入（30% 概率）
   │
   ├─ 更新世界状态（累积 worldDelta）
   │  ├─ blackSwan 事件
   │  ├─ irrationalBias
   │  └─ last_submissions 数量
   │
   ├─ 存储 Turn 记录（submissions + adjudication + worldState）
   │
   └─ 检查人工介入点（humanBreakEvery）
      └─ 如果 currentRound % humanBreakEvery == 0 → PAUSED

4. 生成总结（computeDebrief）
   ├─ 公开版报告（keyFindings, causalChain, blackSwanEvents）
   └─ 内部版报告（+ biasesDetected, blindspots, counterfactuals, monologueLog）

5. 标记完成（COMPLETED）
```

**状态转换**:

```
PENDING → RUNNING → [PAUSED] → RUNNING → COMPLETED/FAILED
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:392-467`

---

### Agent 决策流程

**输入**: Agent + worldState + roundNumber + irrationalBias

**流程**:

```
1. 获取可用模型列表（CHAT_FAST → CHAT）
   └─ 过滤 isAvailable=false 的模型

2. 构建 Prompt
   ├─ System: 角色定义 + 阵营目标 + 回复格式要求
   └─ User: 当前态势（外部数据 + 黑天鹅 + 公共记忆）

3. 遍历模型尝试生成
   ├─ AIEngineFacade.chat()
   ├─ 检测错误类型（quota/token limit/empty response）
   └─ 成功 → 解析 JSON → 返回

4. 全部失败 → 使用模板
   └─ "角色: CEO (BLUE) | 外部态势: market=true, finance=true"
```

**输出格式**:

```json
{
  "innerMonologue": "我分析市场数据发现竞争对手正在降价，我们需要稳住高端市场定位...",
  "publicAction": "维持价格策略，加大品牌宣传投入"
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:112-230`

---

### 黑天鹅事件

**触发概率**: `chaosProb`（默认 10%，高波动行业 35%）

**事件库** (`BLACK_SWAN_EVENTS`):

| type              | name          | description            | impact | affectedTeams    |
| ----------------- | ------------- | ---------------------- | ------ | ---------------- |
| supply_chain      | 供应链中断    | 关键供应商遭遇不可抗力 | high   | BLUE, RED        |
| regulation        | 监管政策突变  | 新出口管制/反垄断政策  | high   | BLUE, RED, GREEN |
| competitor_move   | 竞争对手突击  | 重大价格下调或技术突破 | medium | BLUE             |
| customer_change   | 大客户变动    | 关键客户大单签约或解约 | medium | BLUE, RED        |
| media_exposure    | 媒体曝光事件  | 负面新闻曝光，舆情危机 | medium | BLUE, RED        |
| tech_breakthrough | 技术突破/失败 | 关键技术研发突破或挫折 | high   | BLUE, RED        |
| financial_shock   | 金融市场冲击  | 融资环境恶化、汇率波动 | high   | BLUE, RED        |
| talent_crisis     | 人才危机      | 核心团队离职或招聘困难 | medium | BLUE, RED        |
| natural_disaster  | 自然灾害/疫情 | 不可抗力导致运营中断   | high   | BLUE, RED, GREEN |

**注入机制**:

```typescript
if (Math.random() < chaosProb) {
  const event = BLACK_SWAN_EVENTS[randomIndex];
  worldDelta["blackSwan"] = event;
  worldDelta["blackSwanHistory"].push(event);
  evidenceRefs.push({ provider: "chaos", status: "triggered", event });
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:32-96, 646-682`

---

### 裁决流程

**步骤**:

```
1. 资金可行性检查
   └─ 如果 plannedCost > 公司现金 → rejected_insufficient_funds

2. 外部数据完整性检查
   ├─ 检查 market, finance, news, regulation
   └─ 缺失 → 标记 "insufficient_evidence" (Warning)

3. 黑天鹅触发判定
   └─ random() < chaosProb → 从事件库随机选择

4. 非理性因素注入
   └─ random() < 0.3 → irrational_bias

5. 生成裁判结论
   ├─ ruling: "proceed" | "black_swan" | "rejected_insufficient_funds"
   └─ notes: 裁判判定说明 + 黑天鹅事件描述
```

**输出示例**:

```json
{
  "ruling": "black_swan",
  "notes": "黑天鹅事件触发: 【供应链中断】关键供应商遭遇不可抗力，交付周期延长50%+。影响级别: high，受影响阵营: BLUE/RED。建议人类介入评估影响范围。",
  "evidenceRefs": [
    { "provider": "market", "status": "ok" },
    { "provider": "chaos", "status": "triggered", "event": {...} }
  ],
  "worldDelta": {
    "last_submissions": 5,
    "blackSwan": { "type": "supply_chain", "name": "供应链中断", ... }
  },
  "blackSwanEvent": { ... }
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:579-735`

---

## 数据模型

### SimulationScenario

**字段**:

```prisma
id          String   @id @default(uuid())
name        String   @db.VarChar(200)
industry    String   @db.VarChar(100)
region      String?  @db.VarChar(100)
goals       Json?    // 推演目标
constraints Json?    // 约束条件
dataSources Json?    // 外部数据源配置
createdById String?  @db.VarChar(36)
createdAt   DateTime @default(now())
updatedAt   DateTime @updatedAt

// Relations
companies   SimulationCompany[]
agents      SimulationAgent[]
runs        SimulationRun[]
```

**代码位置**: `backend/prisma/schema/models.prisma:2970-2989`

---

### SimulationCompany

**字段**:

```prisma
id          String  @id @default(uuid())
scenarioId  String  @db.VarChar(36)
name        String  @db.VarChar(200)
type        String? @db.VarChar(50)  // benchmark/competitor/customer/supplier
market      String? @db.VarChar(100)

metrics     Json?  // { cash, share, margin, debt, capacity, inventory, priceBand, delivery, patents, channels, brand }
publicData  Json?  // 公开财务数据
privateData Json?  // 私密数据

createdAt   DateTime @default(now())
updatedAt   DateTime @updatedAt

// Relations
scenario    SimulationScenario @relation(...)
agents      SimulationAgent[]
```

**代码位置**: `backend/prisma/schema/models.prisma:2991-3010`

---

### SimulationAgent

**字段**:

```prisma
id            String         @id @default(uuid())
scenarioId    String         @db.VarChar(36)
companyId     String?        @db.VarChar(36)  // 可选，WHITE/CHAOS 不绑定公司
team          SimulationTeam @default(BLUE)   // BLUE | RED | GREEN | WHITE | CHAOS | ARBITER
role          String         @db.VarChar(100) // CEO | CMO | CFO | 监管官员 | 黑天鹅事件
persona       Json?          // 人设和决策偏好
memoryPublic  Json?          // 公开记忆（所有人可见）
memoryPrivate Json?          // 私密记忆（仅本方可见）
tools         Json?          // 可用工具

createdAt     DateTime @default(now())
updatedAt     DateTime @updatedAt

// Relations
scenario      SimulationScenario @relation(...)
company       SimulationCompany? @relation(...)
```

**代码位置**: `backend/prisma/schema/models.prisma:3012-3034`

---

### SimulationRun

**字段**:

```prisma
id            String              @id @default(uuid())
scenarioId    String              @db.VarChar(36)
status        SimulationRunStatus @default(PENDING)  // PENDING | RUNNING | PAUSED | COMPLETED | FAILED
params        Json?   // { chaosProb, irrationalProb, humanBreakEvery, blindMove, cot }
rounds        Int     @default(2)
currentRound  Int     @default(0)
worldState    Json?   // { market, finance, news, regulation, blackSwan, irrationalBias }
evidenceTrail Json?   // { round_1: [...], round_2: [...] }
summary       Json?   // { publicReport, internalReport, worldState, teamActions }
startedById   String? @db.VarChar(36)
completedAt   DateTime?
createdAt     DateTime @default(now())
updatedAt     DateTime @updatedAt

// Relations
scenario      SimulationScenario @relation(...)
turns         SimulationTurn[]
```

**代码位置**: `backend/prisma/schema/models.prisma:3036-3058`

---

### SimulationTurn

**字段**:

```prisma
id           String @id @default(uuid())
runId        String @db.VarChar(36)
roundNumber  Int

submissions  Json?  // [{ agentId, team, role, innerMonologue, publicAction, irrational, chaosInjected }]
adjudication Json?  // { ruling, notes, evidenceRefs, worldDelta, blackSwanEvent }
evidence     Json?  // [{ category, provider, ok, error, timestamp }]
worldState   Json?  // 本回合结束后的世界状态（累积 worldDelta）

createdAt    DateTime @default(now())
updatedAt    DateTime @updatedAt

// Relations
run          SimulationRun @relation(...)
```

**代码位置**: `backend/prisma/schema/models.prisma:3060-3078`

---

## 关键设计

### 多队对抗

**阵营定义** (`SimulationTeam`):

| 阵营    | 角色                   | 典型角色             | 绑定公司 |
| ------- | ---------------------- | -------------------- | -------- |
| BLUE    | 防守方（市场主导者）   | CEO, CMO, CFO        | 是       |
| RED     | 进攻方（竞争对手）     | CEO, 销售VP          | 是       |
| GREEN   | 市场方（客户/供应商）  | 客户代表, 供应商代表 | 是       |
| WHITE   | 裁判方（监管/分析师）  | 监管官员, 行业分析师 | 否       |
| CHAOS   | 混沌军（黑天鹅制造者） | 黑天鹅事件           | 否       |
| ARBITER | 裁判（评估行动可行性） | 裁判系统             | 否       |

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:232-243`

---

### 视角控制

**视角类型** (`ViewPerspective`):

- `GOD`: 上帝视角，查看所有信息（innerMonologue + publicAction）
- `BLUE` / `RED` / `GREEN` / `WHITE`: 阵营视角
  - 本方阵营：完整信息（innerMonologue + publicAction）
  - 他方阵营：仅公开信息（publicAction）

**实现**:

```typescript
function filterSubmissionByPerspective(submission, perspective) {
  if (perspective === "GOD" || submission.team === perspective) {
    return submission; // 完整信息
  }
  // 非本方：隐藏 innerMonologue, tools, irrational, chaosInjected
  return { ...submission, innerMonologue: undefined, ... };
}
```

**应用场景**:

- `GET /runs/:id?perspective=BLUE` - 蓝军视角查看推演
- `SSE /runs/:id/events?perspective=RED` - 红军实时订阅

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.service.ts:42-90, 455-489`

---

### 人机协同（Human-in-the-Loop）

**机制**:

1. **人工介入点**: 每 `humanBreakEvery` 回合暂停（默认 2 回合）
2. **状态转换**: `RUNNING → PAUSED`
3. **人类干预**: `POST /runs/:id/intervene` 注入事件或消息
4. **恢复推演**: `PATCH /runs/:id/resume` 继续执行

**干预记录**:

```json
{
  "timestamp": "2026-02-01T10:30:00Z",
  "message": "人类决策：暂停价格战，转向技术研发",
  "injectEvent": { "type": "human_override", "action": "..." },
  "round": 2
}
```

**存储位置**:

- `run.params.interventions[]` - 历史记录
- `run.worldState.lastIntervention` - 最新干预（供前端显示）

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.service.ts:408-453`

---

### AI 模型 Fallback

**策略**: 多模型容错，保证推演不中断

**选择顺序**:

1. `AIModelType.CHAT_FAST` - 快速响应模型（如 GPT-4o-mini）
2. `AIModelType.CHAT` - 标准模型（如 GPT-4o）
3. 模板生成 - 最终回退（无需 LLM）

**失败检测**:

```typescript
if (
  result.isError ||
  errorMsg.includes("quota") ||
  errorMsg.includes("max_tokens") ||
  errorMsg.includes("No response content")
) {
  continue; // 尝试下一个模型
}
```

**模板回退**:

```json
{
  "innerMonologue": "角色: CEO (BLUE) | 外部态势: market=true, finance=true, news=true, regulation=true",
  "publicAction": "盲注：行动已提交，等待裁判判定"
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:112-230, 370-386`

---

### SSE 实时推送

**端点**: `GET /runs/:id/events?perspective=BLUE`

**推送策略**: 每 2 秒轮询 Run 状态，直到 `COMPLETED` 或 `FAILED`

**事件类型**:

| type                        | 触发条件   | 数据                          |
| --------------------------- | ---------- | ----------------------------- |
| status_update               | 状态更新   | status, currentRound, rounds  |
| turn_complete               | 新回合完成 | + latestTurn.adjudication     |
| human_intervention_required | 推演暂停   | + message                     |
| run_completed               | 推演完成   | + summary (公开版/内部版报告) |

**客户端连接**:

```typescript
const eventSource = new EventSource(
  "/api/simulation/runs/:id/events?perspective=BLUE",
);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "turn_complete") {
    updateUI(data.latestTurn);
  }
};
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.controller.ts:282-362`

---

## 文件结构

```
backend/src/modules/ai-app/simulation/
├── ai-simulation.module.ts           # NestJS 模块定义
├── ai-simulation.service.ts          # 场景管理 + Run 控制（Facade）
├── ai-simulation.controller.ts       # REST API + SSE 端点
├── ai-simulation.engine.ts           # 推演执行引擎（核心逻辑）
├── external-data.service.ts          # 外部数据源集成
└── ai-assist.service.ts              # AI 辅助生成（场景/角色/指标）
```

**依赖关系**:

```
AiSimulationController
  ├─ AiSimulationService (场景 CRUD + Run 控制)
  │   └─ AiSimulationEngineService (推演执行)
  │       ├─ ExternalDataService (外部数据)
  │       └─ AIEngineFacade (AI 模型调用)
  ├─ ExternalDataService (数据源测试)
  └─ AIAssistService (AI 辅助)
      ├─ ExternalDataService (获取真实数据)
      └─ AIEngineFacade (LLM 生成)
```

---

## 扩展点

### 1. 自定义黑天鹅事件

修改 `BLACK_SWAN_EVENTS` 数组添加新事件：

```typescript
{
  type: "cyber_attack",
  name: "网络安全攻击",
  description: "关键系统遭遇DDoS攻击，业务中断48小时",
  impact: "high",
  affectedTeams: ["BLUE", "RED", "GREEN"]
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:32-96`

---

### 2. 新增外部数据源

在 `SystemSetting` 表添加 Provider 配置：

```json
{
  "id": "news_api_tech",
  "name": "NewsAPI Tech News",
  "category": "news",
  "baseUrl": "https://newsapi.org/v2/everything?q=technology&apiKey=",
  "apiKey": "YOUR_API_KEY",
  "enabled": true,
  "isDefault": true
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/external-data.service.ts:23-59`

---

### 3. 自定义裁决逻辑

在 `simpleAdjudication()` 中添加新的判定规则：

```typescript
// 检测价格战（所有公司同时降价）
if (submissions.every((s) => s.publicAction.includes("降价"))) {
  return {
    ruling: "price_war_detected",
    notes: "裁判警告：检测到价格战倾向，建议人类介入评估市场健康度",
    evidenceRefs: [{ provider: "arbiter", status: "warning" }],
    worldDelta: { priceWar: true },
  };
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:579-735`

---

## 性能优化

### 1. 并行决策生成

使用 `Promise.all()` 并行调用所有 Agent 的 LLM 生成：

```typescript
const agentDecisions = await Promise.all(
  agents.map(agent => generateAgentDecision(agent, worldState, ...))
);
```

**效果**: 10 个 Agent × 3 秒 = 30 秒 → 3 秒（并行）

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.engine.ts:493-505`

---

### 2. 模型缓存

`AIEngineFacade` 缓存可用模型列表，避免重复查询数据库：

```typescript
const models = await this.aiFacade.getAvailableModelsExtended(
  AIModelType.CHAT_FAST,
);
```

---

### 3. SSE 连接优化

使用 `takeWhile` 自动断开已完成的 Run：

```typescript
takeWhile(
  (run) =>
    run.status !== SimulationRunStatus.COMPLETED &&
    run.status !== SimulationRunStatus.FAILED,
  true, // inclusive: 包含最后一个状态
);
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.controller.ts:304-311`

---

## 安全考虑

### 1. 视角权限控制

前端必须传递 `perspective` 参数，防止越权查看他方内心独白：

```typescript
@Get("runs/:id")
async getRun(@Param("id") id: string, @Query("perspective") perspective?: ViewPerspective) {
  const validPerspectives = ["GOD", "BLUE", "RED", "GREEN", "WHITE"];
  const validated = validPerspectives.includes(perspective) ? perspective : undefined;
  return this.simulationService.getRunById(id, validated);
}
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.controller.ts:126-144`

---

### 2. 外部 API 密钥保护

API Key 在日志和响应中自动脱敏：

```typescript
endpoint: endpoint.replace(apiKey || "", "***");
```

**代码位置**: `backend/src/modules/ai-app/simulation/external-data.service.ts:291, 303`

---

### 3. 计费追踪

所有推演执行使用 `BillingContext` 包装，自动记录 Token 消耗：

```typescript
BillingContext.run(
  {
    userId: input.startedById,
    moduleType: "ai-simulation",
    operationType: "run",
    referenceId: scenario.id,
    description: `AI 模拟推演 - ${scenario.name} (${rounds}轮)`,
  },
  () => this.engine.executeRun(run.id),
);
```

**代码位置**: `backend/src/modules/ai-app/simulation/ai-simulation.service.ts:337-355`

---

## 测试建议

### 1. 单元测试

- `generateAgentDecision()` - 模拟不同错误类型（quota/token limit）
- `simpleAdjudication()` - 验证资金检查逻辑
- `filterSubmissionByPerspective()` - 测试视角过滤

---

### 2. 集成测试

- 创建完整场景 → 启动推演 → 验证 Turn 生成
- 测试外部 API 集成（mock HTTP 响应）
- 测试人工干预和暂停/恢复流程

---

### 3. 性能测试

- 10 个 Agent × 6 回合的并行生成性能
- SSE 连接数上限测试（100+ 并发连接）

---

## 相关文档

- [AI Simulation 用户指南](../../features/ai-apps/ai-simulation/readme.md)
- [AI Engine Facade 文档](../ai-engine/ai-engine-facade.md)
- [External Data Provider 配置](../../guides/external-data-providers.md)
- [BillingContext 使用指南](../../guides/billing-context.md)

---

**最后更新**: 2026-02-01
**维护者**: GenesisPod Team
