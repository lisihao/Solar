---
title: AI Strategic Simulation (AI 战略推演)
owner: product
status: active
last_updated: 2025-12-06
version: 2.0
---

## Executive Summary

AI Strategic Simulation (AI 战略推演) 是一个基于多智能体对抗的战略决策模拟平台，借鉴业界最佳实践（如 MIT 的 Wargaming Lab、RAND Corporation 的决策模拟、商业战略沙盘推演），实现：

- **多方对抗**：支持蓝军/多红军/绿军/Chaos 的非对称竞争
- **真实数据驱动**：杜绝 Mock 数据，所有决策基于实时外部数据源
- **裁判系统**：AI 裁判基于 RAG 检索真实证据，判定行动可行性
- **人类干预**：支持暂停、修改约束、注入事件等干预机制
- **复盘分析**：生成公开/内部双版本报告，揭示偏见、盲点与反事实

## Purpose

设计企业级 AI 战略推演能力，支持多智能体对抗与裁判判定，融合人类干预、外部真实数据、报告复盘。基于业界领先的 Wargaming 和决策模拟方法论，为企业战略决策提供可靠的模拟验证工具。

## Scope (MVP)

### Industry Templates（行业模板）

- 首发模板：**AI 算力基础设施**（GPU/芯片/IDC/云算力服务/供应链）
- 参与方：支持 3–5 家公司，蓝/红/绿队角色各 2–3 个，Chaos 可选
- 扩展性：模板系统支持快速添加新行业（金融、零售、制造等）

### Data Requirements（数据要求）

- **零 Mock 原则**：杜绝任何模拟或假数据
- **统一配置**：所有外部 API 在 **Settings -> External API -> Data APIs** 配置
- **数据分类**：市场/价格、财经/公告、新闻/舆情、监管/政策
- **可追溯性**：每条数据标注来源、时间戳、置信度

### Core Capabilities（核心能力）

1. **场景管理**：Scenario/Company/Agent/Run CRUD，支持模板导入与 AI 辅助创建
2. **对抗机制**：盲注提交 + CoT 强制 + 非理性因子 + 黑天鹅事件
3. **裁判系统**：RAG 检索真实数据，验证可行性，生成证据链
4. **可视化**：Timeline + 状态面板 + 市场格局 + 风险雷达
5. **报告系统**：公开/内部双版本，因果分析 + 盲点识别 + 反事实推理
6. **人类干预**：暂停/继续、注入事件、修改约束、重置状态

## Architecture (3-Layer)

1. 环境/裁判（Arbiter）：维护世界状态，引用真实数据（RAG）判定可行性，可驳回动作；黑天鹅/随机因子；写状态差分与证据链。
2. Agent 群：蓝/红/绿 + Chaos；Persona 含偏见/压力源/时间偏好/风险&合规度；公共/公开/私有记忆；工具与配额/冷却/成本。
3. Human-in-loop：节奏建议 2 回合 AI → 人类干预 → 2 回合 AI；显式干预入口（暂停、插话、改约束、重置）。

## Data & External APIs (真实数据约束)

### Configuration Management（配置管理）

- **配置入口**：Settings -> External API -> **Data APIs** (新增 TAB)
- **卡片式管理**：每个数据源类型为独立卡片，支持多个同类型 Provider
- **默认值机制**：每个类型可设置默认 Provider，默认不可用时自动切换备用
- **统一管理**：Key/Endpoint/配额/开关/Headers 集中管理，服务端读取

### Data Categories（数据分类）

#### 1. Market & Pricing（市场与定价）

- **用途**：GPU/芯片/云算力价格、供需关系、交付周期
- **示例 Provider**：Bloomberg API、自建市场数据库、第三方价格监控
- **关键字段**：产品型号、价格区间、库存状态、交付时间、供应商

#### 2. Finance & Filings（财经与公告）

- **用途**：财报、投融资、公告、专利/备案等公司公开信息
- **示例 Provider**：SEC EDGAR、CNINFO、企业公示系统
- **关键字段**：营收、利润、现金流、债务、专利数量、融资轮次

#### 3. News & Sentiment（新闻与舆情）

- **用途**：行业新闻、媒体报道、社交媒体情绪
- **示例 Provider**：News API、Twitter/X API、自建舆情监控
- **关键字段**：标题、摘要、情感倾向、影响力评分、传播范围

#### 4. Regulation & Policy（监管与政策）

- **用途**：政策法规、出口管制、能耗标准、合规要求
- **示例 Provider**：政府开放数据、法规数据库、行业协会
- **关键字段**：政策名称、生效日期、适用范围、处罚条款

### Data Usage Strategy（数据使用策略）

- **请求管理**：日志记录 + 限流控制 + 自动重试 + 智能缓存
- **证据链**：每次裁判判定记录数据来源、时间戳、置信度
- **降级处理**：数据不可用时标注"依据不足"，而非生成假数据
- **成本优化**：优先使用缓存，合理分配 API 配额
- **多源验证**：关键决策使用多个数据源交叉验证

## Process (5-Step Loop)

1. Persona Engineering：强制 persona（角色、性格/偏见、压力源、时间偏好、风险&合规度）；“非合作”提示防 Echo。
2. State Initialization：量化（现金/份额/价格带/产能/库存/负债/KPI/约束），来源标记：手工 / 外部真实 API（RAG）/ 内部知识库。
3. Asynchronous Action Turn：CoT 强制（内心独白→公开行动），盲注同时提交；参数：回合数、随机温度/非理性、黑天鹅概率。
4. Adjudication：裁判检索真实数据，验证可行性（资金/时间/约束/合规），可驳回；写状态差分（资源/KPI/风险/舆情/监管态度/时间线）、证据链；黑天鹅/干扰事件可触发。
5. Debriefing：抽取内心独白日志，生成因果链/偏见/盲点/反事实；报告公开/内部双版。

## Industry Deep-Dive (AI 算力基础设施)

- Company 要素：类型（标杆/初创/区域）、市场/地区、现金/产能/库存/交付、价格带、合同/订单、供应链风险、能耗/合规阈值、护城河（专利/渠道/品牌）、舆情。
- 角色：CEO/COO/销售/采购/法务/公关；绿军（监管/媒体/客户），Chaos（市场恐慌/供应突发）。
- 事件库：供应链中断、关税/出口管制、客户大单/解约、竞品降价、媒体曝光、能耗/合规检查。

## UI/UX (与现有风格匹配 - 对标 AI Teams)

### Design Principles（设计原则）

- **一致性**：与 AI Teams 页面保持视觉和交互一致性
- **卡片优先**：所有列表视图采用卡片布局，而非表格
- **渐进式展示**：从概览到详情的层级导航
- **实时反馈**：所有操作提供即时视觉反馈

### Visual Style（视觉风格）

- **背景**：浅色背景 `bg-gray-50`
- **卡片**：`rounded-xl border border-gray-200 bg-white p-5 shadow-sm`
- **悬停效果**：`hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5`
- **渐变图标**：`bg-gradient-to-br from-indigo-500 to-purple-600`
- **徽章**：`rounded-full px-2 py-0.5 text-xs font-medium`
- **间距**：统一使用 `gap-4` 和 `mt-3`/`mt-4`

### Layout Patterns（布局模式）

#### Landing Page（着陆页）

- **响应式网格**：`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
- **卡片内容**：
  - 12x12 渐变图标 + 场景名称
  - 行业标签 + 区域标签
  - 状态徽章（运行中/已完成/未运行）
  - 统计信息（公司数/角色数/回合数）
  - 更新时间
- **操作按钮**：悬停显示 Edit/Delete 按钮 (`opacity-0 group-hover:opacity-100`)

#### Scenario Detail（场景详情）

- **顶部控制**：场景信息 + 操作按钮（编辑/运行/导出）
- **标签页**：概览/公司/角色/运行历史/报告
- **公司棋盘**：卡片网格显示各公司状态（份额/现金/库存/价格/护城河）
- **角色卡片**：展示 team 颜色、角色信息、persona 预览

#### Run Console（运行控制台）

- **三栏布局**：
  - 左侧：Timeline（带颜色标签的事件流）
  - 中间：状态面板（市场格局/风险雷达/舆情曲线）
  - 右侧：控制面板（暂停/继续/注入事件）
- **底部**：人类干预输入区域

### Component Reuse（组件复用）

- **现有组件**：Button、Input、Tag、Badge、Card、Drawer、Modal
- **图表库**：Recharts（与 AI Office 一致）
- **图标系统**：Lucide React（与整站一致）

### Data APIs Settings UI（数据 API 设置界面）

#### New Tab: "Data APIs"（数据 API）

位于 Settings -> External API，新增第 4 个 TAB

#### Card-Based Layout（卡片式布局）

```
每个类别为一个卡片，支持多个 Provider：

┌─────────────────────────────────────┐
│ 📊 Market & Pricing (市场与定价)      │
│ ─────────────────────────────────── │
│ Provider 1: Bloomberg  [默认] [已配置]│
│ Provider 2: 自建数据库  [ ] [未配置]   │
│ [+ 添加 Provider]                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 💰 Finance & Filings (财经与公告)     │
│ ─────────────────────────────────── │
│ Provider 1: SEC EDGAR  [默认] [已配置]│
│ [+ 添加 Provider]                    │
└─────────────────────────────────────┘
```

#### Provider Configuration（Provider 配置）

- Provider 名称
- Base URL
- API Key（masked 显示）
- Additional Headers (JSON)
- 启用/禁用开关
- 设为默认按钮
- 测试连接按钮
- 配额显示

## Wireframe Outline

- Dashboard：标题、副文案、主 CTA“新建推演”；场景/运行卡片；行业模板入口。
- 场景配置：基础信息；量化表格（支持“从外部数据填充”按钮）；Agent 选配（蓝/红/绿/裁判/Chaos，AI 生成+手工+模板）；规则卡（禁做/冷却/成本、黑天鹅、合规、随机/非理性滑杆）。
- Run 控制台：顶部控制（开始/暂停/盲注/快进+参数）；左 Timeline（内心独白、公开行动、裁判判定、状态差分、证据、可见性）；右状态与指标（市场格局、份额/价格/库存曲线、风险雷达、舆情/监管态度、工具日志）；底部干预输入+事件提示。
- Insights & Report：公开/内部版切换；关键节点列表；团队/公司对比；盲点/反事实卡片；导出 PDF/Markdown/JSON。
- External API 设置：Settings -> External API 页面配置各数据源（名称、描述、endpoint、headers、auth、配额、启用开关），服务端读取使用。

## API/Model Draft (方向性)

- Scenario：industry, region, horizon, goals/KPI, constraints, data_sources_config_ids[]
- Company：type, market, metrics{cash, share, price_band, capacity, inventory, arpu, margin, debt}, moat, risk_thresholds, sentiment_refs
- Agent：company_id, team, persona{role, traits, biases, pressure, time_pref, risk, compliance}, memory{public_refs, company_public, private}, tools{allowed, quotas, cooldowns, cost_model}, behavior_style, visibility_rules
- Run：params{rounds, blind, cot, random_temp, chaos, black_swan_prob, compliance_thresholds}, company_ids[], status
- Turn：submissions[{agent_id, inner_monologue, public_action, tools_used, evidence_refs, visibility, private_memory_refs}], adjudication{ruling, state_delta, scores, black_swan_events}, world_state_snapshot
- Report：version(public/internal), key_nodes, blindspots, counterfactuals, evidence_refs, exports
- ExternalAPIConfig：id, name, provider, base_url, auth{key,id,secret}, headers, rate_limit, enabled

## Milestones

1. 线框+数据契约：低保真线框、接口/模型草案、行业模板与真实数据源清单；External API 配置界面。
2. CRUD 基座：Scenario/Company/Agent/Run/Report CRUD，AI 生成/模板导入，记忆可见性；External API 配置生效（后端读取）。
3. 执行 Beta：盲注+CoT 流程，裁判判定（真实数据检索+证据链，占位规则），Timeline+状态面板实时更新（SSE）。
4. Insights/Report：关键节点、因果/偏见/盲点/反事实，公开/内部版导出。
5. 行业增强（AI 算力）：公司棋盘、市场格局图、情报泄露提示、事件库扩充。
6. 性能与安全：日志/审计、内容审查、外部 API 限流与缓存、秘钥安全存储。

## Non-Mock Assurance

- 不允许使用伪数据/假接口；无数据时返回“依据不足”提示。
- 所有外部数据调用必须通过 Settings -> External API 配置，读取真实 Key/Endpoint；请求需记录来源和时间戳。
- 任何缓存均为真实数据缓存，禁止生成或注入虚假内容。
