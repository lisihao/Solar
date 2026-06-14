# AI Teams 产品架构愿景

> 版本: 1.0
> 日期: 2026-01-01
> 状态: Draft

---

## 一、产品愿景

### 1.1 核心理念

**"像真实公司一样运作的 AI 团队"**

将 AI 能力组织成多个专业化团队，用户给团队下发任务，并通过约束条件（成本、质量、效率）控制交付结果。

```
传统模式：用户 → 单个 AI 对话
本产品：  用户 → AI Team（Leader + Members）→ 在约束条件下交付
```

### 1.2 核心价值主张

| 价值     | 说明                                       |
| -------- | ------------------------------------------ |
| **可控** | 通过约束条件，用户可以控制成本、质量、时效 |
| **专业** | 预定义场景 Team 针对特定任务优化           |
| **灵活** | 自定义 Team 满足个性化需求                 |
| **可信** | Leader 审核机制保障交付质量                |

### 1.3 目标用户

- **企业用户**：需要可控、可预算的 AI 服务
- **专业用户**：需要深度、专业的 AI 协作
- **高级用户**：需要自定义 AI 团队能力

---

## 二、产品架构总览

### 2.1 三层架构

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: 业务抽象（预定义场景）                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │AI Studio│ │AI Office│ │AI Sim   │ │AI Coding│  ...  │
│  │深度研究  │ │报告撰写  │ │辩论推演  │ │代码开发  │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
├─────────────────────────────────────────────────────────┤
│  Layer 2: 团队抽象                                       │
│  Team / Leader / Member / Role / Workflow               │
├─────────────────────────────────────────────────────────┤
│  Layer 1: AI Teams Engine（核心引擎）                    │
│  Orchestrator / Skills / Tools / Constraints / Memory   │
└─────────────────────────────────────────────────────────┘
```

### 2.2 构建优先级

**自下而上构建**：

1. **先做扎实 Engine**：核心能力是地基
2. **再抽象团队模型**：通用的团队运作机制
3. **最后业务场景化**：针对具体场景优化

---

## 三、Layer 1: AI Teams Engine（核心引擎）

### 3.1 引擎能力模块

```
┌─────────────────────────────────────────────────────────┐
│                    AI Teams Engine                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Orchestrator│  │   Skill     │  │    Tool     │     │
│  │   任务编排   │  │  Registry   │  │  Registry   │     │
│  │             │  │   技能注册   │  │   工具注册   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Constraint  │  │Collaboration│  │   Memory    │     │
│  │   Engine    │  │    协作通信  │  │   上下文    │     │
│  │   约束引擎   │  │             │  │             │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.2 各模块职责

| 模块                  | 职责                                   | 关键接口                                               |
| --------------------- | -------------------------------------- | ------------------------------------------------------ |
| **Orchestrator**      | 任务解析、执行计划、状态管理、结果整合 | `execute(mission, team, constraints)`                  |
| **Skill Registry**    | 技能注册、能力发现、技能匹配           | `register(skill)` / `discover(requirement)`            |
| **Tool Registry**     | 工具注册、调用封装、结果标准化         | `register(tool)` / `invoke(tool, params)`              |
| **Constraint Engine** | 约束评估、资源调度、动态降级           | `evaluate(constraints)` / `allocate(resources)`        |
| **Collaboration**     | 成员间通信、任务委派、结果汇报         | `delegate(task)` / `report(result)` / `review(output)` |
| **Memory**            | 上下文管理、历史记录、知识沉淀         | `remember(context)` / `recall(query)`                  |

### 3.3 Orchestrator 核心流程

```
Mission Input
     │
     ▼
┌─────────┐
│  Parse  │ ─── 理解任务意图，提取关键信息
└────┬────┘
     │
     ▼
┌─────────┐
│  Plan   │ ─── 分解任务，生成执行计划
└────┬────┘
     │
     ▼
┌─────────┐     ┌──────────────┐
│ Execute │ ←── │ Constraints  │ ─── 在约束条件下执行
└────┬────┘     └──────────────┘
     │
     ▼
┌─────────┐
│ Review  │ ─── Leader 审核，决定通过/返工
└────┬────┘
     │
     ▼
┌─────────┐
│ Deliver │ ─── 整合结果，输出交付物
└─────────┘
```

### 3.4 Constraint Engine 设计

#### 3.4.1 约束维度

```yaml
constraints:
  cost:
    budget: number # 预算上限（积分/Token）
    model_preference: enum # cheap | balanced | premium

  quality:
    depth: enum # quick | standard | comprehensive
    accuracy: enum # allow_inference | require_evidence
    review_required: boolean # 是否需要 Leader 审核

  efficiency:
    deadline: duration # 期望完成时间
    priority: enum # urgent | normal | low
```

#### 3.4.2 约束权衡（铁三角）

```
          质量
           /\
          /  \
         /    \
        /      \
       /________\
    成本        效率

三者互相制约，用户拉高一个，其他受影响
```

| 用户选择        | 系统响应                       |
| --------------- | ------------------------------ |
| 要便宜 + 要快   | 质量降级（轻量模型、减少迭代） |
| 要质量 + 要快   | 成本升高（强模型、多并发）     |
| 要质量 + 要便宜 | 效率降低（轻模型、多轮迭代）   |

#### 3.4.3 约束如何影响执行

| 约束     | 影响 Leader            | 影响 Member              |
| -------- | ---------------------- | ------------------------ |
| **成本** | 选择更少成员、减少迭代 | 选择便宜模型、限制 Token |
| **质量** | 增加审核、要求验证     | 使用强模型、多次校验     |
| **效率** | 增加并行、减少等待     | 简化流程、跳过非必要步骤 |

---

## 四、Layer 2: 团队抽象

### 4.1 核心概念模型

```
┌─────────────────────────────────────────────────────────┐
│                        Team                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                   Leader                         │   │
│  │  - 任务理解与分解                                 │   │
│  │  - 成员调度与分配                                 │   │
│  │  - 质量审核与把控                                 │   │
│  │  - 结果整合与交付                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│            ┌─────────────┼─────────────┐               │
│            ▼             ▼             ▼               │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │   Member A   │ │   Member B   │ │   Member C   │   │
│  │   (Role X)   │ │   (Role Y)   │ │   (Role Z)   │   │
│  │              │ │              │ │              │   │
│  │  Skills: []  │ │  Skills: []  │ │  Skills: []  │   │
│  │  Tools:  []  │ │  Tools:  []  │ │  Tools:  []  │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.2 数据模型定义

#### 4.2.1 Team

```typescript
interface Team {
  id: string;
  name: string;
  description: string;
  type: "predefined" | "custom";

  // 团队组成
  leader: TeamMember;
  members: TeamMember[];

  // 工作流定义
  workflow: Workflow;

  // 能力边界
  availableSkills: Skill[];
  availableTools: Tool[];

  // 约束偏好
  constraintProfile: ConstraintProfile;
}
```

#### 4.2.2 TeamMember

```typescript
interface TeamMember {
  id: string;
  role: Role;
  model: string; // 使用的 AI 模型

  // 能力配置
  skills: Skill[];
  tools: Tool[];

  // 行为配置
  persona: string; // 角色人设
  workStyle: WorkStyle; // 工作风格
}
```

#### 4.2.3 Role

```typescript
interface Role {
  id: string;
  name: string;
  description: string;

  // 角色能力
  coreSkills: Skill[]; // 核心技能
  optionalSkills: Skill[]; // 可选技能

  // 角色工具
  coreTools: Tool[]; // 核心工具
  optionalTools: Tool[]; // 可选工具

  // 角色约束
  responsibilities: string[]; // 职责范围
  limitations: string[]; // 能力边界
}
```

#### 4.2.4 Workflow

```typescript
interface Workflow {
  type: "sequential" | "parallel" | "hybrid";
  steps: WorkflowStep[];
}

interface WorkflowStep {
  name: string;
  executor: Role | Role[]; // 执行者
  parallel: boolean; // 是否并行
  dependsOn?: string[]; // 依赖的步骤
  timeout?: number; // 超时时间
}
```

### 4.3 Leader 职责详解

| 职责         | 说明                             | 触发时机       |
| ------------ | -------------------------------- | -------------- |
| **任务分解** | 将 Mission 拆解为可执行的子任务  | Mission 输入时 |
| **成员分配** | 根据子任务匹配合适的 Member      | 计划阶段       |
| **进度协调** | 处理依赖关系、调度执行顺序       | 执行阶段       |
| **质量审核** | 检查 Member 输出、决定通过/返工  | 步骤完成时     |
| **约束管控** | 监控资源消耗、必要时降级         | 全程           |
| **结果整合** | 汇总各 Member 输出、生成最终交付 | 完成阶段       |

### 4.4 预定义角色

| 角色           | 核心技能                       | 核心工具                       | 适用场景   |
| -------------- | ------------------------------ | ------------------------------ | ---------- |
| **Researcher** | 信息检索、资料整理、可信度判断 | 搜索引擎、网页抓取、文档解析   | 研究、调研 |
| **Analyst**    | 数据分析、趋势洞察、逻辑推理   | 数据可视化、图表生成、统计分析 | 分析、决策 |
| **Writer**     | 内容创作、结构组织、语言润色   | 文档生成、排版工具、导出       | 写作、报告 |
| **Developer**  | 代码生成、架构设计、问题调试   | IDE 工具、代码执行、版本控制   | 开发、技术 |
| **Designer**   | 视觉设计、创意构思、用户体验   | 图像生成、设计工具、原型       | 设计、创意 |
| **Reviewer**   | 质量检查、风险识别、合规审核   | 检查清单、对比工具、规则引擎   | 审核、合规 |
| **Moderator**  | 协调沟通、冲突解决、共识达成   | 会议工具、投票、总结           | 协作、讨论 |

---

## 五、Layer 3: 业务抽象（预定义场景）

### 5.1 预定义场景 Team 清单

| 场景         | 菜单入口      | 目标用户       | 核心价值                     |
| ------------ | ------------- | -------------- | ---------------------------- |
| **深度研究** | AI Studio     | 战略/研发/投资 | 行业研究、技术调研、深度分析 |
| **报告撰写** | AI Office     | 市场/运营/管理 | 报告生成、文档编辑、内容创作 |
| **辩论推演** | AI Simulation | 战略/决策层    | 方案论证、红蓝对抗、决策支持 |
| **代码开发** | AI Coding     | 研发/技术      | 代码生成、技术方案、代码审查 |
| **智能问答** | AI Ask        | 全员           | 快速问答、知识查询、即时帮助 |
| **自定义**   | AI Teams      | 高级用户       | 自定义团队、个性化配置       |

### 5.2 场景 Team 定义示例

#### 5.2.1 AI Studio（深度研究 Team）

```yaml
ResearchTeam:
  name: "深度研究"
  description: "专业级深度研究，输出高质量调研报告"
  type: predefined

  leader:
    role: ResearchLead
    responsibilities:
      - 制定研究框架
      - 分配研究任务
      - 审核研究质量
      - 整合最终报告

  members:
    - role: Researcher
      count: 1-3
      skills: [信息检索, 资料整理, 可信度判断]
      tools: [web_search, url_scraper, document_parser]

    - role: Analyst
      count: 1
      skills: [数据分析, 趋势洞察, 逻辑推理]
      tools: [data_visualization, chart_generator]

    - role: Writer
      count: 1
      skills: [内容创作, 结构组织, 语言润色]
      tools: [document_generator, export_pdf]

  workflow:
    type: sequential
    steps:
      - name: 研究框架
        executor: ResearchLead

      - name: 信息收集
        executor: Researcher
        parallel: true

      - name: 分析整合
        executor: Analyst
        dependsOn: [信息收集]

      - name: 报告撰写
        executor: Writer
        dependsOn: [分析整合]

      - name: 质量审核
        executor: ResearchLead
        dependsOn: [报告撰写]

  constraintProfile:
    cost_sensitivity: medium
    quality_priority: depth
    typical_duration: "1-4h"

  deliverables:
    - 研究报告（Word/PDF）
    - 数据附件
    - 关键洞察摘要
```

#### 5.2.2 AI Office（报告撰写 Team）

```yaml
ReportTeam:
  name: "报告撰写"
  description: "高效生成各类商业报告和文档"
  type: predefined

  leader:
    role: ContentLead
    responsibilities:
      - 理解写作需求
      - 规划内容结构
      - 审核内容质量
      - 把控整体风格

  members:
    - role: Writer
      count: 1-2
      skills: [内容创作, 结构组织, 多风格写作]
      tools: [document_editor, template_engine]

    - role: Designer
      count: 1
      skills: [排版美化, 图表设计, 视觉呈现]
      tools: [chart_generator, image_generator]

    - role: Reviewer
      count: 1
      skills: [语法检查, 逻辑校验, 风格统一]
      tools: [grammar_checker, consistency_checker]

  workflow:
    type: sequential
    steps:
      - name: 需求理解
        executor: ContentLead

      - name: 内容创作
        executor: Writer

      - name: 视觉美化
        executor: Designer
        parallel: true

      - name: 质量审核
        executor: Reviewer

      - name: 最终确认
        executor: ContentLead

  constraintProfile:
    cost_sensitivity: low
    quality_priority: balance
    typical_duration: "30min-2h"

  deliverables:
    - 报告文档（Word/PDF/PPT）
    - 配套图表
```

#### 5.2.3 AI Simulation（辩论推演 Team）

```yaml
DebateTeam:
  name: "辩论推演"
  description: "多视角论证，支持决策分析"
  type: predefined

  leader:
    role: Moderator
    responsibilities:
      - 设定辩论主题
      - 控制辩论节奏
      - 总结各方观点
      - 输出决策建议

  members:
    - role: Advocate
      count: 2-4
      skills: [观点构建, 论证推理, 反驳应对]
      tools: [evidence_search, argument_builder]
      config:
        stance: dynamic # 根据任务动态分配立场

    - role: Analyst
      count: 1
      skills: [观点分析, 逻辑评估, 综合判断]
      tools: [comparison_matrix, risk_analyzer]

  workflow:
    type: hybrid
    steps:
      - name: 议题设定
        executor: Moderator

      - name: 立场陈述
        executor: Advocate
        parallel: true

      - name: 交叉辩论
        executor: Advocate
        rounds: 2-3

      - name: 综合分析
        executor: Analyst

      - name: 结论总结
        executor: Moderator

  constraintProfile:
    cost_sensitivity: medium
    quality_priority: depth
    typical_duration: "1-2h"

  deliverables:
    - 辩论记录
    - 观点对比矩阵
    - 决策建议报告
```

---

## 六、用户交互设计

### 6.1 任务下发流程

```
┌─────────────────────────────────────────────────────────┐
│  Step 1: 选择 Team                                      │
│                                                         │
│  [AI Studio]  [AI Office]  [AI Sim]  [AI Teams]        │
│   深度研究      报告撰写     辩论推演    自定义          │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: 描述任务                                       │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  帮我调研新能源汽车行业的发展趋势和主要玩家       │   │
│  │  _____________________________________________   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [上传参考资料]  [添加更多要求]                          │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: 设定约束（可选，有默认值）                      │
│                                                         │
│  模式选择：[ 快速 ] [ 均衡 ✓] [ 深度 ]                  │
│                                                         │
│  ─ 高级设置 ──────────────────────────────────────     │
│                                                         │
│  💰 成本  ────○──────────  50积分                      │
│  ✨ 质量  ──────────○────  深度研究                    │
│  ⚡ 效率  ────○──────────  2小时内                     │
│                                                         │
│  预估：消耗 38积分 | 时间 1.5h                          │
│                                                         │
│                              [开始任务]                 │
└─────────────────────────────────────────────────────────┘
```

### 6.2 执行过程展示

```
┌─────────────────────────────────────────────────────────┐
│  任务：新能源汽车行业调研                     进行中 ⏳   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [✓] 研究框架 ─────────────────────── Leader 已完成    │
│      └─ 确定了 5 个研究维度                             │
│                                                         │
│  [⏳] 信息收集 ─────────────────────── 进行中 (3/5)    │
│      ├─ Researcher-1: 行业规模数据 ✓                   │
│      ├─ Researcher-2: 主要玩家分析 ✓                   │
│      ├─ Researcher-3: 政策环境研究 ✓                   │
│      ├─ Researcher-1: 技术趋势调研 ⏳                  │
│      └─ Researcher-2: 投资动态整理 ○                   │
│                                                         │
│  [○] 分析整合 ─────────────────────── 等待中           │
│  [○] 报告撰写 ─────────────────────── 等待中           │
│  [○] 质量审核 ─────────────────────── 等待中           │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  已消耗：23/50 积分  |  已用时：45min  |  预计剩余：40min │
└─────────────────────────────────────────────────────────┘
```

---

## 七、技术实现路径

### 7.1 当前状态评估

| 能力              | 现状                 | 完成度 |
| ----------------- | -------------------- | ------ |
| Orchestrator      | TeamMission 已有雏形 | 60%    |
| Role System       | 7 种角色已定义       | 70%    |
| Skill Registry    | 分散在各 Agent       | 40%    |
| Tool Registry     | 工具映射已有         | 60%    |
| Constraint Engine | 缺失                 | 0%     |
| Collaboration     | Leader-Member 已有   | 50%    |
| Memory            | 基础上下文           | 40%    |

### 7.2 演进路线

```
Phase 1: Engine 核心强化（4-6周）
├── 统一 Skill/Tool Registry
├── 实现 Constraint Engine
├── 强化 Orchestrator 调度能力
└── 完善 Leader 审核机制

Phase 2: 团队抽象完善（3-4周）
├── 定义标准 Team/Role 数据模型
├── 实现 Workflow 引擎
├── 支持团队模板配置化
└── 开发团队管理界面

Phase 3: 预定义场景优化（4-6周）
├── 重构 AI Studio 基于 Team 模型
├── 重构 AI Office 基于 Team 模型
├── 重构 AI Simulation 基于 Team 模型
└── 统一用户交互体验

Phase 4: 自定义能力开放（3-4周）
├── 实现 AI Teams 自定义界面
├── 支持 Role 自定义配置
├── 支持 Workflow 可视化编辑
└── 团队模板保存与分享
```

### 7.3 关键技术决策

| 决策点          | 选项                     | 建议                              |
| --------------- | ------------------------ | --------------------------------- |
| 约束计算位置    | 前端预估 vs 后端实时     | 后端实时，前端只做展示            |
| 工作流引擎      | 自研 vs 开源（Temporal） | 先自研简化版，验证后考虑 Temporal |
| 团队配置存储    | 数据库 vs 配置文件       | 数据库，支持动态修改              |
| Leader 模型选择 | 固定强模型 vs 可配置     | 默认强模型，高级设置可调          |

---

## 八、商业模式思考

### 8.1 定价策略

```
免费版：
├── 2-3 个基础预定义 Team
├── 每月 N 次任务限额
└── 基础约束选项

专业版：
├── 全部预定义 Team
├── 更高任务配额
├── 完整约束控制
└── 优先执行队列

企业版：
├── 自定义 Team 能力
├── 私有部署选项
├── 专属模型接入
├── SLA 保障
└── 团队模板市场发布权
```

### 8.2 AI Store 生态

```
Team 市场：
├── 官方预定义 Team
├── 社区贡献 Team（审核后上架）
├── 企业私有 Team（仅内部可见）
└── 付费高级 Team

能力市场：
├── Skills 扩展
├── Tools 插件
└── 模型接入
```

---

## 九、风险与挑战

| 风险               | 影响       | 缓解措施                               |
| ------------------ | ---------- | -------------------------------------- |
| **质量约束难量化** | 用户信任度 | 建立质量评估体系，提供可解释的质量指标 |
| **成本预估不准**   | 用户体验   | 先小规模验证，逐步优化预估算法         |
| **复杂任务失控**   | 交付质量   | 设置任务复杂度上限，复杂任务拆分处理   |
| **用户学习成本**   | 使用门槛   | 预定义场景降低门槛，高级功能渐进暴露   |

---

## 十、成功指标

| 指标         | 目标      | 衡量方式                   |
| ------------ | --------- | -------------------------- |
| 任务完成率   | > 90%     | 成功交付 / 总任务数        |
| 约束达成率   | > 85%     | 在约束内完成 / 总任务数    |
| 用户满意度   | > 4.0/5.0 | 任务完成后评分             |
| 复用率       | > 60%     | 7日内再次使用的用户比例    |
| 自定义使用率 | > 20%     | 使用自定义 Team 的任务占比 |

---

## 附录

### A. 术语表

| 术语           | 定义                               |
| -------------- | ---------------------------------- |
| **Team**       | AI 团队，由 Leader 和 Members 组成 |
| **Leader**     | 团队领导，负责任务分解、调度、审核 |
| **Member**     | 团队成员，具备特定角色和能力       |
| **Role**       | 角色定义，包含技能和工具配置       |
| **Skill**      | 技能，AI 的能力抽象                |
| **Tool**       | 工具，可调用的外部能力             |
| **Mission**    | 任务，用户下发给 Team 的工作       |
| **Constraint** | 约束，对任务执行的限制条件         |
| **Workflow**   | 工作流，任务执行的流程定义         |

### B. 相关文档

- [AI Teams 技术架构](./ai-teams-architecture-improvement-plan.md)
- [AI Teams 核心集成计划](./ai-teams-core-integration-plan.md)
- [系统优化计划](./system-optimization-plan.md)

---

**文档历史**

| 版本 | 日期       | 作者        | 变更说明 |
| ---- | ---------- | ----------- | -------- |
| 1.0  | 2026-01-01 | Claude Code | 初始版本 |
