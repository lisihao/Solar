# AI Research UI 彻底重构方案

> 从"7 个工具 Tab"到"一条看得见的研究旅程"

**目标**: 用户从一个主题的头脑风暴出发，经过持续迭代研究，最终产出一堆产品原型，全程体验流畅、感知强烈。

**定位**: GenesisPod Research Studio — 从洞察到原型的 AI 协同研究平台

**日期**: 2026-03-12
**状态**: 方案评审 v2

---

## 一、现状问题诊断

### 1.1 当前架构

```
ResearchProjectLayout.tsx (49.4KB)
├── Tab: Discussion    — DiscussionChat.tsx
├── Tab: Insights      — InsightsPanel.tsx
├── Tab: Ideas         — IdeasPanel.tsx
├── Tab: Demos         — DemosPanel.tsx
├── Tab: Iterations    — IterationTimeline.tsx
├── Tab: Report        — ReportPanel.tsx
└── Tab: References    — ReferencesPanel.tsx
```

7 个 Tab 平级并列，用户需要自己在脑中拼接关系。

### 1.2 六大断裂点

| #   | 断裂                   | 原因                                           | 用户感受                           |
| --- | ---------------------- | ---------------------------------------------- | ---------------------------------- |
| 1   | Discussion → Insights  | 观点是研究完成后"事后提取"的批量操作           | 研究过程和观点发现是两个割裂的动作 |
| 2   | Insights → Ideas       | 两个独立 Tab，`sourceInsightId` 关系前端不展示 | 看不到"从哪个观点衍生了哪个创意"   |
| 3   | Ideas → Demos          | 生成在 Ideas Tab，查看在 Demos Tab             | Demo 和源 Idea 视觉脱节            |
| 4   | Iterations 是孤岛      | 本应是旅程骨架，却只是展示分数的 Tab           | 迭代没存在感                       |
| 5   | Report 不引用其他实体  | 合成自原始搜索数据，跳过 Insight/Idea 层       | 报告和研究过程没有关联             |
| 6   | 左侧栏与 TI 风格不一致 | Research 用 session list，TI 用 SVG 团队拓扑   | 两个模块体验割裂                   |

### 1.3 数据模型现状（已有，可复用）

```
ResearchProject
  ├── DeepResearchSession         (1:N)
  │     ├── plan: Json
  │     ├── report: Json
  │     └── ResearchIdea[]        (1:N, sessionId 可选, onDelete: SetNull)
  │           ├── type: INSIGHT | CREATIVE_IDEA
  │           ├── sourceInsightId  (自引用: Insight → Creative Idea)
  │           └── ResearchDemo[]   (1:N, ideaId 必填, onDelete: Cascade)
  ├── ResearchProjectSource[]     (1:N)
  ├── ResearchProjectOutput[]     (1:N)
  └── ResearchProjectNote[]       (1:N)
```

关键：`sourceInsightId`（观点→创意链接）和 `ideaId`（创意→Demo 链接）**数据库已有**，但前端从未展示这层关系。

---

## 二、设计哲学

### 2.1 核心理念

**从"工具仪表盘"到"研究旅程"** — 用户的每一步操作都在推动研究向前流动。观点从研究中涌现，创意从观点中生长，原型从创意中诞生。

### 2.2 五条设计原则

1. **迭代是主线，不是旁支** — 迭代轮次是旅程的骨架，所有产出物（观点/创意/原型）都挂在具体轮次下
2. **实时涌现，不事后提取** — 观点在研究进行中即时浮现，不需要用户手动点"提取"
3. **演化链可见** — 观点 → 创意 → 原型的推导关系，用户可以看到、可以点击、可以追溯
4. **协同驾驶，不是看直播** — 用户在研究进行中可实时干预 Agent 方向、注入信息、调整优先级
5. **知识可复用** — 观点/创意/原型不是孤岛，可跨项目引用和演化

### 2.3 与 Topic Insights 的一致性

左侧栏复用 `TeamTopologyCanvas` 共享组件，保持相同的：

- 面板宽度 (360px / 48px 折叠)
- SVG 星形拓扑图 + Bezier 连线
- Agent 颜色体系 (紫/蓝/绿/橙)
- 状态动画 (脉冲=工作中, 静态绿=完成, 灰虚线=等待)
- 折叠态 (竖排文字 + 脉冲点)

---

## 三、竞品分析与差异化定位

### 3.1 竞品对标

| 产品                     | 核心能力                      | 缺什么                                   |
| ------------------------ | ----------------------------- | ---------------------------------------- |
| **OpenAI Deep Research** | 计划预览→多步搜索→长报告      | 黑盒执行，无中间产物，不可干预，不可迭代 |
| **Perplexity Pro**       | 即时搜索→带引用回答           | 单次问答，无项目/迭代/创意概念           |
| **Google NotebookLM**    | 上传资料→对话→音频摘要        | 无主动研究能力，需用户喂资料，无创意管道 |
| **Elicit**               | 学术论文→提取 claims→证据矩阵 | 只做学术，无创意/原型维度                |
| **Storm (Stanford)**     | 多 Agent 写 Wikipedia 式文章  | 只产报告，过程不可见，不可干预           |
| **Genspark**             | Agent 搜索→Sparkpage          | 单次执行，不可迭代，无知识管理           |
| **Miro AI / FigJam**     | 协作画布 + AI 辅助            | 视觉协作强但无深度研究管道               |

### 3.2 竞争力定位图

```
        研究深度 & 迭代能力
        ▲
        │
  Elicit│              ★ GenesisPod Research Studio
        │              (迭代 + 实时干预 + 原型)
        │
   Deep │
Research│
        │                              NotebookLM
   Storm│
        │
Perplex─┼──────────────────────────────────────────► 产出丰富度
ity     │                                        (报告/观点/创意/原型)
        │  Genspark
        │
```

### 3.3 四大差异化壁垒

**壁垒 1: 研究→创意→原型 完整管道** (业界无人做到)

所有竞品止步于"报告"。我们的链路是：

```
研究搜索 → 观点提炼 → 创意衍生 → 多类型原型生成 → 迭代优化
```

这是从"信息消费"到"知识创造"的跨越。

**壁垒 2: 协同驾驶式研究** (vs 竞品的黑盒执行)

OpenAI Deep Research 和 Storm 都是"提交查询→等结果"。我们让用户在研究进行中：

- 实时看到 Agent 在做什么
- 即时干预研究方向
- 注入自己的信息和判断
- 调整研究计划优先级

**壁垒 3: 可视化知识演化** (vs 竞品的纯文本)

三列演化板 + SVG 连线 + Canvas 画布，让"思维过程"变得可见、可操作、可回溯。没有竞品提供这种级别的知识可视化。

**壁垒 4: 多类型原型生成** (独有)

不只是 HTML Demo，还有架构图、数据仪表盘、对比矩阵、商业画布、用户旅程图等多种原型类型，覆盖从技术方案到商业分析的完整场景。

---

## 四、整体页面架构

### 3.1 布局结构

```
┌──────────────────────────────────────────────────────────────────┐
│  TopBar: ◀返回 │ 项目名称 │ 第N轮·质量XX/100 │ [报告] [设置]   │
├──────────────┬───────────────────────────────────────────────────┤
│              │                                                   │
│  LeftSidebar │           MainCanvas                              │
│  w-[360px]   │           flex-1                                  │
│              │                                                   │
│ ┌──────────┐ │   根据 phase 动态切换:                             │
│ │ RESEARCH │ │   LAUNCH → EXPLORE → DISTILL → DELIVER            │
│ │ TEAM     │ │                                                   │
│ │ (SVG拓扑) │ │                                                   │
│ └──────────┘ │                                                   │
│              │                                                   │
│ ┌──────────┐ │   ┌───────────────────────────────────────────┐   │
│ │ JOURNEY  │ │   │  ArtifactShelf (成果架, 底部固定)          │   │
│ │ R1 ● 52  │ │   │  [观点 12] [创意 5] [原型 3]              │   │
│ │ R2 ● 71  │ │   └───────────────────────────────────────────┘   │
│ │ R3 ◉ ... │ │                                                   │
│ └──────────┘ │                                                   │
│              │                                                   │
│ ┌──────────┐ │                                                   │
│ │ 累计成果  │ │                                                   │
│ └──────────┘ │                                                   │
├──────────────┴───────────────────────────────────────────────────┤
│  InputBar: 💬 追问/反馈输入框                  [发送] [下一轮]    │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 三个始终可见的区域

| 区域              | 位置        | 职责                                 | 可折叠              |
| ----------------- | ----------- | ------------------------------------ | ------------------- |
| **LeftSidebar**   | 左侧 360px  | Agent 团队拓扑 + 迭代历程 + 累计成果 | 是 (→48px)          |
| **MainCanvas**    | 中间 flex-1 | 当前阶段的沉浸式内容                 | 否                  |
| **ArtifactShelf** | 底部固定    | 所有产出物的缩略图入口               | 可展开为半屏 Drawer |

### 3.3 TopBar 设计

```
┌──────────────────────────────────────────────────────────────────┐
│  ◀  │  推理优化与部署技术  │  ⏱ 第3轮 · ████████░░ 78/100     │
│     │                      │                                     │
│     │                      │  [📄 查看报告]  [⚙ 研究设置]       │
└──────────────────────────────────────────────────────────────────┘
```

- 左: 返回按钮 + 项目名称
- 中: 迭代进度条 (轮次 + 质量分 + 视觉进度条)
- 右: 报告入口 + 设置

---

## 四、左侧栏设计（与 TI 一致）

### 4.1 三段式结构

```
┌────────────────────────────────────┐
│ RESEARCH TEAM              [折叠 ◁]│  ← 同 TI: uppercase header
│────────────────────────────────────│
│                                    │
│        TeamTopologyCanvas          │  ← 直接复用共享组件
│        (SVG 星形拓扑)               │
│                                    │
│  ● Working  ● Done  ○ Idle        │  ← 同 TI: legend
│────────────────────────────────────│
│ JOURNEY                            │  ← Research 特有
│                                    │
│  R1 ● ━━━━━━━━ 52                 │
│  R2 ● ━━━━━━━━━━━ 71              │
│  R3 ◉ ━━━━━━━ 进行中              │
│                                    │
│────────────────────────────────────│
│  观点 11 ⭐4 │ 创意 5 │ 原型 2     │  ← 固定底部
└────────────────────────────────────┘
```

### 4.2 Agent 团队拓扑

复用 `frontend/components/common/team-topology/TeamTopologyCanvas`，传入 Research 的 Agent 配置：

```typescript
// 行布局
const rows = [
  ["director"], // Row 1: Leader
  ["researcher-1", "researcher-2", "analyst"], // Row 2: 搜索+分析
  ["writer", "reviewer"], // Row 3: 撰写+审核
];

// 连线: 星形拓扑 (Director → 所有成员)
const connections = [
  { from: "director", to: "researcher-1" },
  { from: "director", to: "researcher-2" },
  { from: "director", to: "analyst" },
  { from: "director", to: "writer" },
  { from: "director", to: "reviewer" },
];

// Agent 配色 (与 TI 完全一致)
const AGENT_COLORS = {
  director: { colorKey: "purple", avatarRole: "leader" },
  researcher: { colorKey: "blue", avatarRole: "researcher" },
  analyst: { colorKey: "blue", avatarRole: "analyst" },
  writer: { colorKey: "amber", avatarRole: "writer" },
  reviewer: { colorKey: "green", avatarRole: "reviewer" },
};
```

**Agent 状态同步**: 通过 SSE 事件 `discussion.typing` 和 `discussion.phase` 实时更新 `node.status`：

- `discussion.typing { agentRole: 'researcher' }` → researcher node 变 `working`
- `discussion.phase { phase: 'synthesis' }` → writer node 变 `working`，researcher 变 `completed`

**交互**: 点击 Agent 节点 → 弹出详情卡 (同 TI 的 `renderDetail` 回调)，显示：

- Agent 名称、角色、负责任务
- 当前状态、搜索进度 (如 3/5)
- 使用的 AI 模型
- 本轮贡献的观点数

### 4.3 研究历程 (JOURNEY)

```
┌────────────────────────────────────┐
│ JOURNEY                            │
│                                    │
│  ┌─ R1 ─────────────────────────┐  │
│  │ ● ━━━━━━━━━━░░░░ 52         │  │  灰色: 已完成
│  │   💡5  💡2                    │  │  小字: 观点/创意计数
│  └──────────────────────────────┘  │
│                                    │
│  ┌─ R2 ─────────────────────────┐  │
│  │ ● ━━━━━━━━━━━━━░░ 71        │  │
│  │   💡4  💡2  🎨1              │  │  带原型图标
│  └──────────────────────────────┘  │
│                                    │
│  ┌─ R3 ─────────────────────────┐  │
│  │ ◉ ━━━━━━━━━░░░░░ 进行中      │  │  蓝色脉冲: 当前轮
│  │   💡2↑                       │  │  ↑ 表示增长中
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

**交互**:

- 点击某轮 → 主画布过滤展示该轮的产出物
- 当前轮有蓝色脉冲动画
- 分数颜色: >=70 绿色, 40-69 橙色, <40 灰色
- 进度条宽度 = score/100

### 4.4 折叠态

```
┌──────┐
│  ◁   │  展开按钮
│      │
│  ●   │  蓝色脉冲 (有 Agent 在工作)
│      │
│  R   │
│  E   │  竖排文字
│  S   │
│  E   │
│  A   │
│  R   │
│  C   │
│  H   │
│      │
│  T   │
│  E   │
│  A   │
│  M   │
│      │
│ ──── │
│  R3  │  当前轮次
│  78  │  当前分数
└──────┘
```

同 TI: `w-12`, `writingMode: 'vertical-rl'`, `animate-pulse` 蓝点, `transition-all duration-300`。

---

## 五、主画布：5 个阶段

不再是 7 个平级 Tab，而是 **5 个阶段自然流转**。主画布根据阶段动态渲染不同内容。

```
LAUNCH → EXPLORE → DISTILL → (迭代循环) → DELIVER
  启动     探索       提炼                    交付
```

### 5.1 阶段 1: LAUNCH（启动）

**触发条件**: 新项目 / 无活跃 session / 用户点"新研究"

**画布内容**:

```
┌───────────────────────────────────────────────────┐
│                                                   │
│     🔬 开始研究                                    │
│                                                   │
│     ┌─────────────────────────────────────┐       │
│     │  输入你想研究的主题...                 │       │
│     └─────────────────────────────────────┘       │
│                                                   │
│     研究模式                                       │
│     ┌───────────────┐  ┌───────────────┐          │
│     │ 🔍 单次研究    │  │ 🔄 迭代研究   │  ← 选中  │
│     │ 快速得到结果   │  │ 多轮深入直到   │          │
│     │               │  │ 质量达标       │          │
│     └───────────────┘  └───────────────┘          │
│                                                   │
│     ── 迭代研究设置 (mode=iterative 时展开) ──     │
│     研究深度:  [==●======] 标准                    │
│     质量目标:  [======●==] 75/100                  │
│     最大轮次:  [===●=====] 4 轮                    │
│     自动生成原型: [✓]                              │
│                                                   │
│     ── 可选: 添加参考资料 ──                       │
│     📎 上传文件  🔗 添加URL  📚 从资源库导入       │
│                                                   │
│                         [ 🚀 开始研究 ]            │
└───────────────────────────────────────────────────┘
```

**整合自**: 当前 `research-creation-dialog.tsx` 的对话框内容，改为内嵌在主画布中而非弹窗。

**点击"开始研究"后**:

1. 如果启用了计划审批: 进入 Plan Preview 子视图
2. 否则: 直接进入 EXPLORE 阶段

#### Plan Preview 子视图

```
┌───────────────────────────────────────────────────┐
│  📋 研究计划                           [修改] [▶] │
│                                                   │
│  目标: 深入分析推理优化与部署技术的现状和趋势       │
│                                                   │
│  研究步骤:                                        │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐         │
│  │ 1  │→│ 2  │→│ 3  │→│ 4  │→│ 5  │         │
│  │初始 │  │深入 │  │学术 │  │对比 │  │验证 │         │
│  │搜索 │  │搜索 │  │论文 │  │分析 │  │检查 │         │
│  └────┘  └────┘  └────┘  └────┘  └────┘         │
│                                                   │
│  预计: 3-5轮迭代 · 约15分钟                       │
│                                                   │
│          [ 调整计划 ]  [ ▶ 批准并开始 ]            │
└───────────────────────────────────────────────────┘
```

**数据来源**: `POST /deep-research/plan` → `PlanApprovalRequest`

### 5.2 阶段 2: EXPLORE（探索）

**触发条件**: 研究开始后 (SSE `discussion.phase` = ideation/execution/findings)

**画布内容**: 双栏实时视图

```
┌────────────────────────┬────────────────────────────┐
│   🔍 研究活动流          │   💡 实时发现               │
│   (左 55%)              │   (右 45%)                 │
│                        │                            │
│  ┌────────────────┐    │                            │
│  │ 🟣 Director     │    │                            │
│  │ "我们需要从三个  │    │                            │
│  │  维度分析推理优   │    │                            │
│  │  化技术..."      │    │                            │
│  └────────────────┘    │                            │
│                        │  ┌──────────────────────┐  │
│  ┌────────────────┐    │  │ 💡 新观点           R1│  │  ← 入场动画
│  │ 🔵 Researcher   │    │  │                      │  │    (从右滑入+淡入)
│  │ 正在搜索:        │    │  │ KV-Cache 量化可降   │  │
│  │ "LLM推理优化    │    │  │ 低 40% 显存占用     │  │
│  │  最新论文"       │    │  │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │  │
│  │ 找到 12 条结果   │    │  │ 来源: [1][2][3]    │  │
│  │ ████████░░ 3/5  │    │  │ 置信度: ████░ 高    │  │
│  └────────────────┘    │  │                      │  │
│                        │  │ [📌收藏] [→衍生创意] │  │
│  ┌────────────────┐    │  └──────────────────────┘  │
│  │ 🔵 Analyst      │    │                            │
│  │ "分析发现:       │    │  ┌──────────────────────┐  │
│  │  Speculative    │    │  │ 💡 新观点           R1│  │
│  │  Decoding 在特  │    │  │                      │  │
│  │  定场景下..."    │    │  │ Speculative Decoding │  │
│  └────────────────┘    │  │ 对 code-gen 提速2-3x │  │
│                        │  │ 但对创意写作无效      │  │
│  ┌────────────────┐    │  │ ...                  │  │
│  │ 🟣 Director     │    │  └──────────────────────┘  │
│  │ "第一轮搜索完   │    │                            │
│  │  成，发现以下关  │    │                            │
│  │  键方向..."      │    │   ── 新发现会从这里冒出 ── │
│  └────────────────┘    │                            │
└────────────────────────┴────────────────────────────┘
```

#### 左侧: 研究活动流 (ActivityFeed)

- 替代当前 `DiscussionChat` 的消息流部分
- Agent 消息气泡，按时间顺序从上到下
- 每条消息前有 Agent 头像 + 颜色标识 (与左侧栏拓扑图颜色一致)
- 搜索进度内嵌在 Researcher 消息中 (进度条 + `3/5`)
- 自动滚动到底部 (检测手动滚动时暂停)

#### 右侧: 实时发现 (LiveDiscovery)

**核心改变**: 观点不再是"研究完成后手动提取"，而是**研究进行中实时浮现**。

**实现机制**:

- 后端在 discussion 阶段，当 Agent 产生有价值的发现时，发送 `insight.discovered` SSE 事件
- 前端收到事件后，观点卡片从右侧以动画方式滑入
- 每张卡片自带操作按钮: `[📌 收藏]` `[→ 衍生创意]`

**观点卡片结构**:

```
┌──────────────────────────┐
│ 💡 [标题]           [R1] │  ← 轮次角标
│                          │
│ [描述文本...]             │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│ 来源: [1][2][3]          │  ← 引用来源
│ 置信度: ████░ 高         │  ← AI评估的可信度
│                          │
│ [📌 收藏]  [→ 衍生创意]  │  ← 即时操作
└──────────────────────────┘

左边框颜色 = 置信度:
  红色 #EF4444 = 高置信
  橙色 #F59E0B = 中置信
  灰色 #9CA3AF = 低置信
```

**用户在 EXPLORE 阶段就可以做的事**:

1. 看 Agent 协作过程
2. 看观点实时浮现
3. 收藏重要观点
4. 一键衍生创意 (不用等到提炼阶段)
5. 在输入栏追问/补充指引

#### 协同驾驶：用户实时干预研究方向

EXPLORE 不是"看直播"，而是"协同驾驶"。用户可以在研究进行中主动参与：

**干预点 1: Agent 消息上的操作按钮**

```
┌────────────────────────────────┐
│ 🔵 Researcher                   │
│ 搜索: "LLM推理优化最新论文"      │
│ 找到 12 条结果，其中 3 条高相关  │
│                                │
│ [深入这个方向 ▶] [换个角度 ↻]   │  ← 行内干预按钮
└────────────────────────────────┘
```

- `[深入这个方向]`: 告诉 Agent 沿当前搜索深入，增加搜索轮次
- `[换个角度]`: 让 Agent 换一个维度重新搜索
- 这些操作通过新 SSE 事件 `user.steer` 发送到后端

**干预点 2: 观点卡片上的反馈**

```
┌──────────────────────────┐
│ 💡 KV-Cache 量化降40%    │
│ ...                      │
│                          │
│ [📌收藏] [→衍生] [✗不对] │  ← "不对"触发 Agent 重新分析
└──────────────────────────┘
```

- `[✗ 不对]`: 用户标记某个观点有误，Agent 重新评估并可能修正或移除
- 后端记录用户反馈，作为后续轮次的参考

**干预点 3: 活动流中注入用户信息**

```
┌────────────────────────────────────────────────┐
│ 📎 注入信息到研究:                               │
│ ┌──────────────────────────────────────────────┐│
│ │ 这篇论文很关键: https://arxiv.org/abs/2401.. ││
│ └──────────────────────────────────────────────┘│
│ [🔗 添加URL] [📎 上传文件] [💬 发送观点]        │
└────────────────────────────────────────────────┘
```

- 用户随时可以向研究中注入自己的资料链接、文件、或观点
- Agent 会将用户注入的信息纳入后续分析
- 用户注入的消息在活动流中以不同颜色显示 (区别于 Agent 消息)

**干预点 4: 实时调整研究计划**

在 EXPLORE 阶段，用户可以通过侧边操作修改正在执行的计划：

```
┌────────────────────────────────────┐
│ 📋 当前计划 (可拖拽调整)           │
│                                    │
│  ✅ 1. 初始搜索 (已完成)           │
│  🔄 2. 深入搜索 (进行中)           │
│  ○  3. 学术论文                    │  ← 可拖拽调整顺序
│  ○  4. 对比分析                    │
│  ○  5. 验证检查                    │
│                                    │
│  [+ 添加步骤]                      │
└────────────────────────────────────┘
```

**后端支撑**: 新增 `user.steer` SSE 事件 + `/deep-research/steer` API：

```typescript
// 新增 API
POST /ai-studio/projects/:id/deep-research/steer
{
  type: 'deepen' | 'pivot' | 'inject' | 'reject_insight' | 'reorder_plan',
  payload: {
    // deepen: 深入当前方向
    direction?: string;
    // pivot: 换方向
    newAngle?: string;
    // inject: 注入信息
    content?: string;
    url?: string;
    // reject_insight: 否定观点
    insightId?: string;
    reason?: string;
    // reorder_plan: 调整计划
    stepOrder?: string[];
  }
}
```

### 5.3 阶段 3: DISTILL（提炼）

**触发条件**: 一轮研究完成 (SSE `discussion.phase` = completed) / 用户手动切换

**画布内容**: 三列 Kanban 演化板

```
┌──────────────────┬──────────────────┬──────────────────┐
│  📊 观点 (12)     │  💡 创意 (5)      │  🎨 原型 (3)     │
│  INSIGHTS        │  IDEAS           │  PROTOTYPES      │
│                  │                  │                  │
│ ┌──────────────┐ │ ┌──────────────┐ │ ┌──────────────┐ │
│ │⭐ KV-Cache   │─┤→│ 自适应量化   │─┤→│ [Demo 预览]  │ │
│ │ 量化降40%    │ │ │ 推理引擎     │ │ │  交互原型    │ │
│ │ 显存         │ │ │ ──────────── │ │ │              │ │
│ │ ─────────── │ │ │ 可行性: 高   │ │ │ 状态: ✅     │ │
│ │ R1 · 高置信  │ │ │ 创新点: 3    │ │ │ [全屏查看]   │ │
│ │ [→ 衍生]     │ │ │ [🎨 生成原型]│ │ └──────────────┘ │
│ └──────────────┘ │ └──────────────┘ │                  │
│                  │                  │ ┌──────────────┐ │
│ ┌──────────────┐ │ ┌──────────────┐ │ │ [Demo 预览]  │ │
│ │ Speculative  │─┤→│ 混合推测+    │ │ │  性能对比    │ │
│ │ Decoding     │ │ │ 缓存优化     │ │ │  Dashboard   │ │
│ │ 场景分化     │ │ │ ──────────── │ │ │              │ │
│ │ ─────────── │ │ │ 可行性: 中   │ │ │ 状态: 🔄     │ │
│ │ R1 · 中置信  │ │ │ [🎨 生成原型]│ │ │ 生成中...    │ │
│ └──────────────┘ │ └──────────────┘ │ └──────────────┘ │
│                  │                  │                  │
│ ┌──────────────┐ │ ┌──────────────┐ │                  │
│ │ GGUF格式     │ │ │ 端侧部署     │ │                  │
│ │ 成为边缘部   │ │ │ 一键工具链   │ │                  │
│ │ 署事实标准   │ │ │              │ │                  │
│ │ ─────────── │ │ │ 可行性: 高   │ │                  │
│ │ R2 · 高置信  │ │ │ [🎨 生成原型]│ │                  │
│ └──────────────┘ │ └──────────────┘ │                  │
│       ...        │       ...        │                  │
│                  │                  │                  │
│ 💡收藏的置顶     │  可拖拽创意到右列  │                  │
│ 可按轮次过滤     │  触发原型生成      │                  │
└──────────────────┴──────────────────┴──────────────────┘
```

#### 演化链连线

卡片之间的 `─→` 连线表示推导关系:

```
观点A ──→ 创意X ──→ 原型α
  │         │
  └──→ 创意Y ──→ 原型β

观点B ──→ 创意X  (多观点可汇聚到同一创意)
```

**连线交互**:

- Hover 任意卡片 → 高亮其演化链（其他卡片降低透明度）
- 点击连线箭头 → 弹出血缘关系面板
- 连线用 SVG path 绘制，起点/终点锚定在卡片边缘

**数据来源**: `ResearchIdea.sourceInsightId`（观点→创意）+ `ResearchDemo.ideaId`（创意→Demo）

#### 三列卡片的详细设计

**观点卡片 (InsightCard)**:

```
┌──────────────────────────┐
│ [⭐] KV-Cache量化降40%    │  标题 + 收藏
│      显存               [R1]  轮次角标
│ ─────────────────────── │
│ [描述文本...]             │
│                          │
│ 来源: [1][2][3]          │  引用
│ 置信度: ████░            │
│ Agent: 🔍 Researcher     │  发现者
│                          │
│ [→ 衍生创意]  [展开详情]  │
└──────────────────────────┘

左边框 = 置信度颜色
角标 = 来源轮次
⭐ 状态: 点击切换收藏/取消
```

**创意卡片 (IdeaCard)**:

```
┌──────────────────────────┐
│ [⭐] 自适应量化推理引擎    │  标题 + 收藏
│      ▸ 新方案         [R1]  维度 badge + 轮次
│ ─────────────────────── │
│ 核心概念: ...             │
│                          │
│ 创新点:                   │
│  • 动态量化策略            │
│  • 自适应精度切换          │
│  • 硬件感知优化            │
│                          │
│ 可行性: ████░ 高          │
│ 源观点: ◀ KV-Cache量化    │  ← 回链 (可点击)
│                          │
│ [🎨 生成原型]  [展开详情]  │
└──────────────────────────┘

左边框 = 可行性颜色
  绿 #10B981 = 高
  橙 #F59E0B = 中
  灰 #9CA3AF = 低
维度 badge 颜色:
  紫 = 新理念, 蓝 = 新方案, 青 = 新方法, 橙 = 新实践
```

**原型卡片 (PrototypeCard)**:

```
┌──────────────────────────┐
│ 自适应量化推理引擎     [R2] │  标题 + 轮次
│ ─────────────────────── │
│ ┌──────────────────────┐│
│ │                      ││  缩略图预览
│ │   [iframe snapshot]  ││  (低分辨率截图 or
│ │                      ││   live iframe)
│ └──────────────────────┘│
│                          │
│ 状态: ✅ 完成             │
│ 版本: v2 (共2次生成)      │
│ 源创意: ◀ 自适应量化      │  ← 回链
│                          │
│ [全屏查看] [新窗口] [重做] │
└──────────────────────────┘

状态标识:
  ⏳ PENDING  → 灰色
  🔄 GENERATING → 蓝色脉冲
  ✅ COMPLETED → 绿色
  ❌ FAILED → 红色 + 重试按钮
```

#### 列操作

| 列   | 顶部操作栏               | 排序/过滤                |
| ---- | ------------------------ | ------------------------ |
| 观点 | `[提取更多]` `[按轮次▾]` | 按轮次、置信度、收藏状态 |
| 创意 | `[AI衍生]` `[按可行性▾]` | 按可行性、维度、收藏状态 |
| 原型 | `[批量生成]` `[按状态▾]` | 按状态、生成时间         |

#### Pipeline / Canvas 双视图

DISTILL 提供两种视图模式，顶部切换：

```
┌─ 视图模式 ──────────────────────────────────┐
│  [≡ Pipeline]  [◇ Canvas]                   │
└──────────────────────────────────────────────┘
```

**Pipeline View** (默认): 上述三列 Kanban 演化板

- 适合线性思考：观点 → 创意 → 原型
- 结构化，清晰，演化链连线

**Canvas View**: 无限画布模式

- 适合发散性思考：自由拖放、分组聚类、手动连线
- 所有卡片 (观点/创意/原型) 在同一平面，用户自由排列
- AI 辅助功能：`[🤖 自动聚类]` `[🤖 建议关联]`
- 用户可以创建自定义分组框 (圈选一组卡片)
- 支持标注/便签 (文本 sticky note)

```
Canvas View 示例:

┌──────────────────────────────────────────────┐
│                                              │
│  ┌─────┐         ┌─────┐                    │
│  │观点A │────────→│创意X │                    │
│  └─────┘         └──┬──┘                    │
│                     │                        │
│  ┌─────┐      ┌────▼───┐     ┌──────┐      │
│  │观点B │─────→│ 创意Y  │────→│原型 β │      │
│  └─────┘      └────────┘     └──────┘      │
│                                              │
│      ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                 │
│      │ 📌 用户标注:        │                 │
│      │ "这两个可以合并"    │                 │
│      └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                 │
│                                              │
│  工具栏: [📌便签] [✏️画线] [📦分组]          │
│          [🤖聚类] [🔍搜索] [↩️撤销]          │
└──────────────────────────────────────────────┘
```

**技术选型**: Canvas 基于 `@xyflow/react` (React Flow) 实现，已有成熟的节点拖拽、连线、分组能力。

> Canvas View 作为 Phase 6 独立实施，不阻塞核心功能。Pipeline View 先上线。

#### 多类型原型生成

创意卡片的"生成原型"扩展为多种类型选择：

```
┌──────────────────────────────────┐
│ 💡 自适应量化推理引擎              │
│ ...                              │
│                                  │
│ 选择原型类型:                     │
│ ┌──────┐ ┌──────┐ ┌──────┐      │
│ │ 🖥️   │ │ 📊   │ │ 📐   │      │
│ │ 交互  │ │ 仪表盘│ │ 架构图│      │
│ │ 原型  │ │      │ │      │      │
│ └──────┘ └──────┘ └──────┘      │
│ ┌──────┐ ┌──────┐ ┌──────┐      │
│ │ ⚖️   │ │ 🗺️   │ │ 📋   │      │
│ │ 对比  │ │ 旅程图│ │ 商业  │      │
│ │ 矩阵  │ │      │ │ 画布  │      │
│ └──────┘ └──────┘ └──────┘      │
└──────────────────────────────────┘
```

| 原型类型       | 说明                   | 生成方式             | 渲染                 |
| -------------- | ---------------------- | -------------------- | -------------------- |
| **交互原型**   | HTML/CSS/JS 单页       | AI 生成完整 HTML     | iframe sandbox       |
| **架构图**     | 系统设计/流程图/时序图 | AI 生成 Mermaid 代码 | mermaid.js 渲染 SVG  |
| **数据仪表盘** | 图表/指标可视化        | AI 生成 ECharts 配置 | ECharts 渲染         |
| **对比矩阵**   | 多方案优劣对比         | AI 生成结构化 JSON   | 自定义 Table 组件    |
| **用户旅程图** | Journey Map 时间线     | AI 生成节点 + 阶段   | 自定义 Timeline 组件 |
| **商业画布**   | BMC / Lean Canvas      | AI 填充 9 格模板     | Canvas 模板组件      |

**数据模型扩展**:

```prisma
model ResearchDemo {
  // ... 已有字段 ...

  // 新增: 原型类型
  prototypeType     String     @default("interactive") @map("prototype_type")
  // 值: "interactive" | "architecture" | "dashboard" | "comparison" | "journey" | "canvas"

  // 新增: 结构化数据 (非 HTML 类型使用)
  structuredData    Json?      @map("structured_data")
  // 架构图: { mermaidCode: string }
  // 仪表盘: { echartsOptions: object }
  // 对比矩阵: { headers: string[], rows: object[] }
  // 旅程图: { stages: { name, description, touchpoints }[] }
  // 商业画布: { segments: { key: string, items: string[] }[] }
}
```

> 多类型原型作为 Phase 5 实施。Phase 0-4 先支持 interactive 类型 (当前已有能力)。

### 5.4 迭代过渡：EXPLORE ↔ DISTILL 循环

一轮 EXPLORE 完成后，画布自动切到 DISTILL。DISTILL 底部显示迭代控制面板：

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  第 1 轮完成 · 质量 52/100 · 发现 5 个观点 · 衍生 2 个创意     │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 📊 信息缺口:                                         │     │
│  │ • 缺少 TensorRT-LLM vs vLLM 的实测对比数据            │     │
│  │ • 边缘设备部署的功耗分析不充分                          │     │
│  │                                                      │     │
│  │ 💡 创意缺口:                                         │     │
│  │ • 尚未探索 MoE 模型的推理优化方向                      │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌──────────────────────────────────────┐                     │
│  │ 补充指引（可选）: 重点关注边缘部署...   │                     │
│  └──────────────────────────────────────┘                     │
│                                                               │
│           [ 结束研究 ]    [ ▶ 继续第 2 轮 ]                     │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

点击"继续第 2 轮"后:

1. 左侧栏 JOURNEY 新增 `R2 ◉`
2. 主画布回到 EXPLORE
3. 新观点带 `R2` 角标，与 `R1` 视觉区分
4. DISTILL 板中新旧卡片共存 — 用户看到知识在**增长**

**自动迭代** (mode=iterative): 如果启用了自动迭代 (SSE `iteration.eval` + `iteration.awaiting_feedback`)，在 DISTILL 视图底部显示倒计时：

```
┌───────────────────────────────────────────┐
│  ⏱ 30秒后自动开始第2轮                     │
│  [提供反馈] [立即开始] [结束研究]           │
└───────────────────────────────────────────┘
```

### 5.5 阶段 5: DELIVER（交付）

**触发条件**: 用户点击 TopBar `[📄 查看报告]` / 研究最终完成

**画布内容**: 全屏覆盖层 (Overlay)，报告内嵌观点/创意/原型

```
┌───────────────────────────────────────────────────────────────┐
│  ← 返回研究  │  📄 研究报告: 推理优化与部署技术  │  [导出 ▾]  │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ## 执行摘要                                                  │
│  本研究经过 3 轮迭代，分析了 47 个来源，提炼 11 个核心观点，    │
│  衍生 5 个创意方案，生成 3 个交互原型...                       │
│                                                               │
│  ┌─ 📊 研究总览 ──────────────────────────────────────┐      │
│  │ 迭代: 3轮 │ 来源: 47 │ 观点: 11 │ 创意: 5 │ 原型: 3 │      │
│  └────────────────────────────────────────────────────┘      │
│                                                               │
│  ## 1. 推理框架对比分析                                       │
│  ...分析文本...                                               │
│                                                               │
│  ┌─ 💡 相关观点 ─────────────────────────────────────┐       │
│  │ KV-Cache 量化可降低 40% 显存 [⭐R1] [点击展开]     │       │
│  └────────────────────────────────────────────────────┘       │
│                                                               │
│  ...更多分析...                                               │
│                                                               │
│  ┌─ 🎨 创意方案 ─────────────────────────────────────┐       │
│  │ 自适应量化推理引擎                                  │       │
│  │ 可行性: 高 · 创新点: 3                              │       │
│  │ ┌──────────────────────┐                           │       │
│  │ │   [Demo 缩略预览]     │  [全屏查看原型]           │       │
│  │ └──────────────────────┘                           │       │
│  └────────────────────────────────────────────────────┘       │
│                                                               │
│  ## 2. 边缘部署方案评估                                       │
│  ...                                                          │
│                                                               │
│  ## 研究历程                                                  │
│  ┌─ R1(52) ──→ R2(71) ──→ R3(78) ─┐                        │
│  │ 每轮: 新增观点 + 新增创意 + 分数提升                │        │
│  └─────────────────────────────────┘                        │
│                                                               │
│  ## 参考文献                                                  │
│  [1] xxx (引用于: 观点1, 观点3, 创意2)                        │
│  [2] ...                                                      │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**内嵌实体**:

- `EmbeddedInsight`: 报告正文中内嵌的观点卡片 (可展开/收起)
- `EmbeddedPrototype`: 报告正文中内嵌的原型缩略预览 (可全屏)
- 引用链接: 点击 `[1]` → 滚动到参考文献并高亮

**导出选项**: PDF / DOCX / PPTX / HTML (复用现有 `ReportExporter`)

---

## 六、成果架 (Artifact Shelf)

贯穿所有阶段的底部持久化栏。

### 6.1 收起态 (默认)

```
┌──────────────────────────────────────────────────────────────┐
│  成果架  观点(12)  创意(5)  原型(3)            [展开 ▴]      │
│  [⭐KV量化] [Spec Dec] [GGUF] [MoE路由] ... [+8]            │
│  ← 可横向滚动的缩略卡片 →                                    │
└──────────────────────────────────────────────────────────────┘
```

- 固定在主画布底部
- 高度: ~64px
- 缩略卡片: 小型 pill 形状，显示标题
- 收藏的置顶，按类型分组 (观点|创意|原型)
- 实时更新: 新发现的观点自动追加到末尾 (带入场动画)

### 6.2 展开态 (半屏 Drawer)

点击 `[展开]` 后:

- Drawer 从底部向上滑出，占据主画布 60% 高度
- 内容 = DISTILL 阶段的三列 Kanban 板
- 可以在任何阶段 (包括 EXPLORE 进行中) 快速查看/管理成果
- 点击 Drawer 外区域或 `[收起]` 关闭

### 6.3 卡片点击

点击成果架中的缩略卡片 → 弹出 `CardDetailModal`:

- 显示完整卡片内容
- 显示演化链 (源于哪个观点 → 衍生了哪个创意 → 生成了哪个原型)
- 操作: 收藏/取消、衍生创意、生成原型、查看原型全屏

---

## 七、视觉连线系统 (Evolution Chain)

### 7.1 连线渲染

在 DISTILL 三列视图中，用 SVG 绘制卡片间连线:

```typescript
// 连线数据结构
interface EvolutionLink {
  fromId: string; // 源卡片 ID
  toId: string; // 目标卡片 ID
  type: "insight-to-idea" | "idea-to-prototype";
}

// 渲染: SVG overlay 层覆盖在三列之上
// 锚点: 源卡片右边中点 → 目标卡片左边中点
// 样式: 浅灰色路径, hover 时变亮
```

### 7.2 Hover 高亮

```
Hover 观点A:
  → 高亮: 观点A, 由A衍生的创意X, 创意X的原型α
  → 降低: 所有其他卡片透明度降至 0.3
  → 连线: 变为亮色 + 粗线

数据来源:
  1. 从 idea.sourceInsightId 找到 insight → idea 关系
  2. 从 demo.ideaId 找到 idea → demo 关系
  3. 构建 Map<insightId, ideaIds[]> 和 Map<ideaId, demoIds[]>
```

### 7.3 卡片回链

每张创意卡片显示"源观点"回链:

```
源观点: ◀ KV-Cache量化   ← 可点击, 滚动到对应观点卡片并高亮
```

每张原型卡片显示"源创意"回链:

```
源创意: ◀ 自适应量化引擎  ← 可点击
```

---

## 八、后端变更

### 8.1 新增 SSE 事件: `insight.discovered`

**目的**: 支持 EXPLORE 阶段观点实时浮现 (替代当前的事后批量提取)

```typescript
// 新 SSE 事件
interface InsightDiscoveredEvent {
  type: "insight.discovered";
  data: {
    id: string; // ResearchIdea.id (已持久化)
    title: string;
    description: string;
    confidence: number; // 0-100
    agentRole: string;
    agentName: string;
    evidence: string[];
    iterationRound: number;
  };
}
```

**触发时机**: 在 `DiscussionPhaseCoordinatorService` 的 findings 阶段，当 Agent 报告有价值的发现时，同步创建 `ResearchIdea` 记录并发送 SSE 事件。

**对比当前方案**:

- 当前: session 完成 → 前端手动调 `/ideas/sessions/:sessionId/extract` → 批量创建 Idea
- 新方案: Agent 发现时即时创建 Idea + 发 SSE 事件 → 前端实时展示

### 8.2 Prisma Schema 新增字段

```prisma
model ResearchIdea {
  // ... 已有字段 ...

  // 新增: 来源轮次 (用于 Kanban 板的轮次角标)
  iterationRound    Int?       @map("iteration_round")

  // 新增: 置信度 (AI评分, 0-100, 用于排序和视觉)
  confidence        Int?       @default(50)
}

model ResearchDemo {
  // ... 已有字段 ...

  // 新增: 缩略图 (Artifact Shelf 预览)
  thumbnailUrl      String?    @map("thumbnail_url")

  // 新增: 版本号 (同一 idea 多次生成)
  version           Int        @default(1)
}
```

**迁移 SQL**:

```sql
-- 新增字段
ALTER TABLE "research_ideas" ADD COLUMN "iteration_round" INTEGER;
ALTER TABLE "research_ideas" ADD COLUMN "confidence" INTEGER DEFAULT 50;
ALTER TABLE "research_demos" ADD COLUMN "thumbnail_url" TEXT;
ALTER TABLE "research_demos" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
```

### 8.3 观点实时发现的后端改造

**改造文件**: `backend/src/modules/ai-app/research/discussion/discussion-phase-coordinator.service.ts`

**关键变更**:

1. 在 findings 阶段，解析 Agent 输出中的关键发现
2. 对每个发现，调用 `ResearchIdeaService.create()` 持久化
3. 通过 SSE subject 发送 `insight.discovered` 事件
4. 保留原有的 `extractIdeas` API 作为兜底 (批量补充提取)

```typescript
// 伪代码
async handleFindingsPhase(subject: Subject, session: DeepResearchSession) {
  const findings = await this.extractFindings(agentOutput);

  for (const finding of findings) {
    // 持久化
    const idea = await this.ideaService.create({
      projectId: session.projectId,
      sessionId: session.id,
      title: finding.title,
      description: finding.description,
      type: 'INSIGHT',
      confidence: finding.confidence,
      iterationRound: currentRound,
      agentRole: finding.agentRole,
      evidence: finding.evidence,
    });

    // 实时推送
    subject.next({
      type: 'insight.discovered',
      data: { id: idea.id, ...finding },
    });
  }
}
```

---

## 九、前端组件架构

### 9.1 新组件树

```
components/ai-research/
├── ResearchStudio.tsx                   # 新主布局 (替代 ResearchProjectLayout)
│
├── sidebar/
│   ├── ResearchSidebar.tsx              # 左侧栏容器 (三段式)
│   ├── ResearchTeamTopology.tsx         # 团队拓扑 (包装 TeamTopologyCanvas)
│   ├── JourneyTimeline.tsx              # 研究历程
│   ├── ArtifactSummaryBar.tsx           # 累计成果底栏
│   └── CollapsedSidebar.tsx             # 折叠态
│
├── stages/
│   ├── LaunchStage.tsx                  # 阶段1: 主题输入 + 计划预览
│   ├── PlanPreview.tsx                  # 计划审批子视图
│   ├── ExploreStage.tsx                 # 阶段2: 双栏实时探索
│   ├── DistillStage.tsx                 # 阶段3: 三列演化板
│   ├── IterationControl.tsx             # 迭代控制面板
│   └── DeliverStage.tsx                 # 阶段5: 报告覆盖层
│
├── explore/
│   ├── ActivityFeed.tsx                 # 研究活动流 (左栏)
│   ├── LiveDiscovery.tsx                # 实时发现 (右栏)
│   ├── AgentMessage.tsx                 # Agent 消息气泡
│   └── SearchProgressBar.tsx            # 搜索进度条
│
├── cards/
│   ├── InsightCard.tsx                  # 观点卡片
│   ├── IdeaCard.tsx                     # 创意卡片
│   ├── PrototypeCard.tsx                # 原型卡片
│   ├── CardDetailModal.tsx              # 卡片详情弹窗
│   └── EvolutionChain.tsx              # 演化链 SVG 连线
│
├── shelf/
│   ├── ArtifactShelf.tsx                # 底部成果架
│   ├── ShelfDrawer.tsx                  # 展开的半屏 Drawer
│   └── ShelfThumbnail.tsx              # 缩略图 pill
│
├── report/
│   ├── ReportOverlay.tsx                # 全屏报告覆盖层
│   ├── EmbeddedInsight.tsx              # 报告内嵌观点
│   ├── EmbeddedPrototype.tsx            # 报告内嵌原型预览
│   └── ReportExporter.tsx              # 导出 (复用现有)
│
├── topbar/
│   └── ResearchTopBar.tsx               # 顶栏 (项目名+进度+操作)
│
└── shared/
    ├── RoundBadge.tsx                   # 轮次角标 R1/R2/R3
    ├── ConfidenceBar.tsx                # 置信度条
    └── FeasibilityBadge.tsx             # 可行性标签
```

### 9.2 状态管理

```typescript
// ResearchStudio 核心状态
interface ResearchStudioState {
  // 阶段控制
  phase: "launch" | "explore" | "distill" | "deliver";

  // 研究状态 (来自 hooks)
  discussion: DiscussionResearchState; // 复用现有 hook
  iteration: IterativeResearchState; // 复用现有 hook

  // 实时发现 (新增)
  liveInsights: ResearchIdea[]; // EXPLORE 阶段实时浮现的观点

  // 所有产出物
  insights: ResearchIdea[]; // type=INSIGHT
  ideas: ResearchIdea[]; // type=CREATIVE_IDEA
  demos: ResearchDemo[];

  // 演化链
  evolutionLinks: EvolutionLink[]; // 从 sourceInsightId + ideaId 计算

  // UI 状态
  sidebarCollapsed: boolean;
  shelfExpanded: boolean;
  selectedRoundFilter: number | "all";
  highlightedChainId: string | null; // hover 高亮的演化链
}
```

### 9.3 阶段自动流转逻辑

```typescript
// ResearchStudio.tsx
function ResearchStudio({ projectId }) {
  const [phase, setPhase] = useState<Phase>('launch');

  // 自动阶段流转
  useEffect(() => {
    const dp = discussion.phase;

    if (dp === 'ideation' || dp === 'execution' || dp === 'findings') {
      setPhase('explore');
    }
    if (dp === 'synthesis') {
      // 合成阶段仍在 EXPLORE (用户看到报告在生成)
      setPhase('explore');
    }
    if (dp === 'completed') {
      setPhase('distill');  // 一轮完成 → 自动进入提炼
    }
  }, [discussion.phase]);

  // 用户手动切换 (不受自动流转限制)
  // - 成果架 [展开] → 任何时候进入 distill
  // - TopBar [报告] → 进入 deliver
  // - 左侧栏 Journey 点击轮次 → 按轮次过滤 distill

  return (
    <div className="flex h-screen bg-gray-50">
      <ResearchSidebar ... />

      <div className="flex flex-1 flex-col overflow-hidden">
        <ResearchTopBar ... />

        <main className="relative flex-1 overflow-hidden">
          {phase === 'launch'  && <LaunchStage ... />}
          {phase === 'explore' && <ExploreStage ... />}
          {phase === 'distill' && <DistillStage ... />}
          {phase === 'deliver' && <DeliverStage ... />}
        </main>

        {phase !== 'launch' && phase !== 'deliver' && (
          <ArtifactShelf ... />
        )}

        {phase !== 'deliver' && (
          <InputBar ... />
        )}
      </div>
    </div>
  );
}
```

### 9.4 Hook 变更

| Hook                         | 变更                               | 说明                           |
| ---------------------------- | ---------------------------------- | ------------------------------ |
| `useDiscussionResearch`      | 新增监听 `insight.discovered` 事件 | 观点实时浮现                   |
| `useIterativeResearch`       | 无变更                             | 继续包装 useDiscussionResearch |
| `useResearchIdeas`           | 新增 `byRound` 过滤参数            | 支持按轮次查看                 |
| `useResearchDemos`           | 无变更                             | 继续轮询 PENDING/GENERATING    |
| **新增** `useEvolutionChain` | 从 ideas + demos 计算演化链        | 连线渲染                       |
| **新增** `useArtifactShelf`  | 汇总 insights + ideas + demos      | 成果架数据                     |

---

## 十、旧 → 新 组件映射

| 旧组件                               | 处理方式 | 新组件                                                       |
| ------------------------------------ | -------- | ------------------------------------------------------------ |
| `ResearchProjectLayout.tsx` (49.4KB) | **替代** | `ResearchStudio.tsx`                                         |
| `DiscussionChat.tsx`                 | **拆分** | `ActivityFeed.tsx` + `LiveDiscovery.tsx`                     |
| `InsightsPanel.tsx`                  | **合并** | `DistillStage.tsx` 观点列 + `InsightCard.tsx`                |
| `IdeasPanel.tsx`                     | **合并** | `DistillStage.tsx` 创意列 + `IdeaCard.tsx`                   |
| `DemosPanel.tsx`                     | **合并** | `DistillStage.tsx` 原型列 + `PrototypeCard.tsx`              |
| `IterationTimeline.tsx`              | **拆分** | `JourneyTimeline.tsx` (侧栏) + `IterationControl.tsx` (画布) |
| `ReportPanel.tsx`                    | **升级** | `ReportOverlay.tsx` + `EmbeddedInsight/Prototype`            |
| `AgentPanel.tsx`                     | **替代** | `ResearchTeamTopology.tsx` (复用 TeamTopologyCanvas)         |
| `research-creation-dialog.tsx`       | **内嵌** | `LaunchStage.tsx` (不再是弹窗)                               |

---

## 十一、分阶段实施计划

### Phase 0: 基础框架 (约 2 天)

**目标**: 搭建 `ResearchStudio` 骨架，可以展示旧内容

- [ ] 创建 `ResearchStudio.tsx` + 阶段路由框架
- [ ] 创建 `ResearchTopBar.tsx`
- [ ] 创建 `ResearchSidebar.tsx` (三段式容器)
- [ ] 创建 `ResearchTeamTopology.tsx` (包装 `TeamTopologyCanvas`)
- [ ] 页面路由切换: `/ai-research/[projectId]` → `ResearchStudio`
- [ ] 验证: 左侧栏 Agent 拓扑可正常显示，与 TI 视觉一致

**风险**: 低。旧组件暂时以 fallback 方式嵌入新框架。

### Phase 1: EXPLORE 阶段 (约 3 天)

**目标**: 双栏实时探索体验

- [ ] 创建 `ExploreStage.tsx` (双栏布局)
- [ ] 创建 `ActivityFeed.tsx` (从 DiscussionChat 提取消息流)
- [ ] 创建 `LiveDiscovery.tsx` (右侧实时发现面板)
- [ ] 创建 `InsightCard.tsx` (带收藏/衍生按钮)
- [ ] **后端**: 新增 `insight.discovered` SSE 事件
- [ ] **后端**: `ResearchIdea` 新增 `iterationRound`, `confidence` 字段
- [ ] `useDiscussionResearch` 监听新事件
- [ ] 观点卡片入场动画 (从右滑入 + 淡入)
- [ ] 验证: 研究中观点实时浮现，可收藏，可衍生

### Phase 2: DISTILL 阶段 (约 3 天)

**目标**: 三列演化板 + 卡片连线

- [ ] 创建 `DistillStage.tsx` (三列 Kanban 布局)
- [ ] 创建 `IdeaCard.tsx` (含回链)
- [ ] 创建 `PrototypeCard.tsx` (含缩略预览)
- [ ] 创建 `EvolutionChain.tsx` (SVG 连线 + hover 高亮)
- [ ] 卡片间连线: 基于 `sourceInsightId` 和 `ideaId` 计算
- [ ] Hover 高亮整条演化链
- [ ] 轮次过滤: 点击左侧栏 Journey 某轮 → 只显示该轮产出
- [ ] 验证: 观点→创意→原型的推导关系清晰可见

### Phase 3: 成果架 + 迭代控制 (约 2 天)

**目标**: 底部成果架 + 迭代循环体验

- [ ] 创建 `ArtifactShelf.tsx` (底部固定栏)
- [ ] 创建 `ShelfDrawer.tsx` (半屏展开)
- [ ] 创建 `JourneyTimeline.tsx` (左侧栏迭代历程)
- [ ] 创建 `IterationControl.tsx` (迭代过渡面板)
- [ ] 成果实时更新: 新观点追加到 Shelf
- [ ] EXPLORE ↔ DISTILL 循环流转
- [ ] 验证: 多轮迭代体验流畅，成果累积感强

### Phase 4: DELIVER + LAUNCH (约 2 天)

**目标**: 报告内嵌实体 + 启动体验优化

- [ ] 创建 `ReportOverlay.tsx` (全屏报告)
- [ ] 创建 `EmbeddedInsight.tsx` + `EmbeddedPrototype.tsx`
- [ ] 报告中引用观点/创意/原型 (可展开/点击)
- [ ] 创建 `LaunchStage.tsx` (内嵌式启动，替代弹窗)
- [ ] 创建 `PlanPreview.tsx` (计划审批)
- [ ] 验证: 报告是所有研究成果的终极聚合视图

### Phase 5: 清理 + 优化 (约 1-2 天)

**目标**: 删除旧组件，性能优化

- [ ] 删除旧 Tab 组件 (InsightsPanel, IdeasPanel, DemosPanel, IterationTimeline)
- [ ] 删除旧 `ResearchProjectLayout.tsx`
- [ ] 性能: Demo iframe lazy loading (Intersection Observer)
- [ ] 性能: 虚拟列表 (观点/创意列表超过 50 条时)
- [ ] 错误边界: 每个 Stage 包裹 ErrorBoundary
- [ ] 后端: `ResearchDemo.thumbnailUrl` 生成逻辑 (Puppeteer 截图)
- [ ] 迁移 SQL 脚本
- [ ] 全量测试

---

## 十二、风险评估

| 风险                               | 影响                       | 缓解措施                                          |
| ---------------------------------- | -------------------------- | ------------------------------------------------- |
| EXPLORE 阶段观点实时浮现需后端改造 | 后端 SSE 事件新增          | P1 优先做，如受阻可用 `extractIdeas` 自动调用降级 |
| 三列 Kanban + SVG 连线性能         | 卡片多时渲染卡顿           | 虚拟列表 + 连线只渲染可视区域                     |
| Demo 缩略图生成                    | 需要 Puppeteer 截图        | P5 做，初期用 placeholder 图                      |
| 旧组件删除导致回归                 | 功能遗漏                   | Phase 0 用 fallback 保底，逐步替代                |
| 移动端适配                         | 三列 Kanban 在手机上不可用 | 移动端降级为单列+Tab 切换                         |

---

## 十三、对比总结

| 维度       | 旧设计                 | 新设计                                |
| ---------- | ---------------------- | ------------------------------------- |
| 结构       | 7 个平级 Tab           | 5 个阶段自然流转                      |
| 心智模型   | "切 Tab 找信息"        | "跟着河流走"                          |
| 观点发现   | 事后批量提取           | 研究中实时浮现                        |
| 实体关系   | 隐藏在数据库           | 三列 Kanban + 可见连线                |
| 迭代感知   | 分数表格 Tab           | 左侧栏始终可见的历程                  |
| Agent 团队 | 独立侧边栏/弹出        | 复用 TI 拓扑图，风格一致              |
| 成果累积   | Tab 名上的数字         | 底部成果架实时增长                    |
| 报告       | 孤立 Markdown          | 内嵌观点/创意/原型                    |
| 原型管理   | 独立 Demos Tab         | 创意卡片直连原型预览                  |
| 用户角色   | 旁观者 (看 Agent 工作) | 协同驾驶者 (实时干预)                 |
| 原型类型   | 仅 HTML Demo           | 6种 (交互/架构/仪表盘/对比/旅程/画布) |
| 知识复用   | 项目孤岛               | 跨项目引用 + Library 联动             |

---

## 十四、跨项目知识复用

### 14.1 问题

当前每个 ResearchProject 是孤岛。但真实研究场景中：

- 上周研究"推理优化"的观点，这周研究"模型部署"时应该能引用
- 多个项目的收藏观点应该汇聚成可检索的知识库
- 原型应该能跨项目复用和迭代

### 14.2 知识流动模型

```
┌─────────────────────────────────────────────────────────┐
│                    Knowledge Hub                         │
│                    (Library 模块)                         │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                │
│  │ 观点池   │  │ 创意池   │  │ 原型池   │                │
│  │ (所有⭐) │  │ (所有⭐) │  │ (所有✅) │                │
│  └────┬────┘  └────┬────┘  └────┬────┘                │
│       │            │            │                       │
└───────┼────────────┼────────────┼───────────────────────┘
        │            │            │
   ┌────▼────┐  ┌────▼────┐  ┌───▼─────┐
   │Research │  │Research │  │Research │
   │Project A│  │Project B│  │Project C│
   │推理优化  │  │模型部署  │  │边缘AI   │
   └─────────┘  └─────────┘  └─────────┘
```

### 14.3 具体机制

**机制 1: 收藏自动同步到 Library**

```
用户在 Project A 中收藏观点 ⭐
  → 自动同步到 Library 的"研究观点"集合
  → 保留来源信息: "来自项目: 推理优化 · R2"
```

**机制 2: 新研究启动时自动关联**

```
用户在 Project B 中启动研究 "模型部署"
  → AI 自动检索 Library 中相关观点
  → 在 LAUNCH 阶段提示: "发现 3 个相关已有观点"
  → 用户选择是否引入
```

**机制 3: 跨项目引用**

```
Project B 引用 Project A 的观点:
  → 创意卡片上显示: "源观点: ◀ KV-Cache量化 (推理优化项目)"
  → 点击可跳转到原项目查看上下文
```

**机制 4: 原型迭代**

```
Project A 生成了 Demo v1
  → Project B 引用并生成 Demo v2 (基于 v1 + 新信息)
  → 版本链: v1 (项目A) → v2 (项目B) → v3 (项目C)
```

### 14.4 数据模型扩展

```prisma
model ResearchIdea {
  // ... 已有字段 ...

  // 新增: 是否已同步到 Library
  syncedToLibrary   Boolean    @default(false) @map("synced_to_library")

  // 新增: 跨项目引用源
  sourceProjectId   String?    @map("source_project_id")
  sourceIdeaId      String?    @map("source_idea_id")
}
```

> 跨项目知识复用作为 Phase 7 独立实施，需要与 Library 模块协调。

---

## 十五、后端新增 API 汇总

### 15.1 研究干预 API (协同驾驶)

```
POST /ai-studio/projects/:id/deep-research/steer
{
  type: 'deepen' | 'pivot' | 'inject' | 'reject_insight' | 'reorder_plan',
  payload: { ... }
}
```

### 15.2 新增 SSE 事件

| 事件                 | 说明         | 触发时机                         |
| -------------------- | ------------ | -------------------------------- |
| `insight.discovered` | 观点实时浮现 | findings 阶段发现有价值的观点    |
| `idea.derived`       | 创意衍生通知 | 用户触发或 AI 自动从观点衍生创意 |
| `user.steer.ack`     | 干预确认     | 后端收到用户干预指令后确认       |

### 15.3 Schema 变更汇总

```sql
-- ResearchIdea 新增字段
ALTER TABLE "research_ideas" ADD COLUMN "iteration_round" INTEGER;
ALTER TABLE "research_ideas" ADD COLUMN "confidence" INTEGER DEFAULT 50;
ALTER TABLE "research_ideas" ADD COLUMN "synced_to_library" BOOLEAN DEFAULT false;
ALTER TABLE "research_ideas" ADD COLUMN "source_project_id" TEXT;
ALTER TABLE "research_ideas" ADD COLUMN "source_idea_id" TEXT;

-- ResearchDemo 新增字段
ALTER TABLE "research_demos" ADD COLUMN "thumbnail_url" TEXT;
ALTER TABLE "research_demos" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "research_demos" ADD COLUMN "prototype_type" TEXT NOT NULL DEFAULT 'interactive';
ALTER TABLE "research_demos" ADD COLUMN "structured_data" JSONB;
```

---

## 十六、更新后的分阶段实施计划

### Phase 0: 基础框架 (约 2 天)

**目标**: 搭建 ResearchStudio 骨架

- [ ] `ResearchStudio.tsx` + 阶段路由框架
- [ ] `ResearchTopBar.tsx` (项目名 + 进度条 + 报告入口)
- [ ] `ResearchSidebar.tsx` (三段式容器)
- [ ] `ResearchTeamTopology.tsx` (复用 TeamTopologyCanvas)
- [ ] 页面路由: `/ai-research/[projectId]` → ResearchStudio
- [ ] 旧组件 fallback 嵌入新框架
- [ ] **验收**: 左侧栏 Agent 拓扑与 TI 视觉一致

### Phase 1: EXPLORE + 协同驾驶 (约 4 天)

**目标**: 双栏实时探索 + 用户实时干预

- [ ] `ExploreStage.tsx` (双栏布局)
- [ ] `ActivityFeed.tsx` (消息流 + 行内干预按钮)
- [ ] `LiveDiscovery.tsx` (观点实时浮现面板)
- [ ] `InsightCard.tsx` (收藏/衍生/否定 三个操作)
- [ ] 用户注入信息 UI (URL/文件/观点)
- [ ] **后端**: `insight.discovered` SSE 事件
- [ ] **后端**: `POST /steer` API (deepen/pivot/inject/reject)
- [ ] **后端**: ResearchIdea 新增 `iterationRound`, `confidence`
- [ ] useDiscussionResearch 监听新事件
- [ ] 入场动画 (从右滑入 + 淡入)
- [ ] **验收**: 研究中观点实时浮现，用户可干预方向

### Phase 2: DISTILL Pipeline View (约 3 天)

**目标**: 三列演化板 + 卡片连线

- [ ] `DistillStage.tsx` (三列 Kanban + 视图切换 placeholder)
- [ ] `IdeaCard.tsx` (含源观点回链)
- [ ] `PrototypeCard.tsx` (含缩略预览 + 源创意回链)
- [ ] `EvolutionChain.tsx` (SVG 连线 + hover 高亮)
- [ ] 演化链计算: `useEvolutionChain` hook
- [ ] 轮次过滤: 侧栏 Journey 点击 → 过滤该轮产出
- [ ] **验收**: 观点→创意→原型 推导关系清晰可见

### Phase 3: 成果架 + 迭代循环 (约 2 天)

**目标**: 底部成果架 + EXPLORE↔DISTILL 循环

- [ ] `ArtifactShelf.tsx` (底部固定栏 + pill 缩略图)
- [ ] `ShelfDrawer.tsx` (半屏展开 = DistillStage)
- [ ] `JourneyTimeline.tsx` (侧栏迭代历程)
- [ ] `IterationControl.tsx` (缺口展示 + 反馈 + 继续/结束)
- [ ] 成果实时更新动画
- [ ] EXPLORE ↔ DISTILL 阶段循环流转
- [ ] **验收**: 多轮迭代体验流畅，成果累积感强

### Phase 4: DELIVER + LAUNCH (约 2 天)

**目标**: 报告内嵌实体 + 启动体验

- [ ] `ReportOverlay.tsx` (全屏报告)
- [ ] `EmbeddedInsight.tsx` + `EmbeddedPrototype.tsx`
- [ ] 报告中引用观点/创意/原型 (可展开/点击)
- [ ] 研究历程可视化 (Report 中的迭代进度图)
- [ ] `LaunchStage.tsx` (内嵌式启动)
- [ ] `PlanPreview.tsx` (计划审批 + 可编辑步骤)
- [ ] **验收**: 报告是研究成果的终极聚合视图

### Phase 5: 多类型原型 (约 3 天)

**目标**: 6 种原型类型

- [ ] 原型类型选择 UI (创意卡片内)
- [ ] 架构图: Mermaid 代码生成 + mermaid.js 渲染
- [ ] 数据仪表盘: ECharts 配置生成 + 渲染
- [ ] 对比矩阵: JSON 生成 + Table 组件
- [ ] 用户旅程图: 节点生成 + Timeline 组件
- [ ] 商业画布: 模板填充 + Canvas 组件
- [ ] **后端**: ResearchDemo 新增 `prototypeType`, `structuredData`
- [ ] **验收**: 每个创意可生成多种类型的原型

### Phase 6: Canvas 画布模式 (约 4 天)

**目标**: DISTILL 的无限画布替代视图

- [ ] 集成 `@xyflow/react`
- [ ] 卡片节点 (InsightNode, IdeaNode, PrototypeNode)
- [ ] 自由拖拽 + 自动布局
- [ ] 手动连线 + 删除连线
- [ ] 分组框 (圈选一组卡片)
- [ ] 便签 (文本 sticky note)
- [ ] AI 辅助: 自动聚类、建议关联
- [ ] Pipeline ↔ Canvas 视图无损切换
- [ ] **验收**: 用户可在画布上自由组织思维

### Phase 7: 跨项目知识复用 (约 3 天)

**目标**: 知识不再是项目孤岛

- [ ] 收藏自动同步到 Library
- [ ] 新研究启动时自动检索相关已有观点
- [ ] 跨项目引用 UI (源项目标注 + 点击跳转)
- [ ] 原型版本链 (v1→v2→v3 跨项目演化)
- [ ] **后端**: ResearchIdea 新增 `syncedToLibrary`, `sourceProjectId`, `sourceIdeaId`
- [ ] Library 模块集成
- [ ] **验收**: 多个项目的知识自由流动

### Phase 8: 清理 + 优化 (约 2 天)

- [ ] 删除旧 Tab 组件 + ResearchProjectLayout
- [ ] 性能: Demo iframe lazy loading
- [ ] 性能: 虚拟列表 (50+ 卡片)
- [ ] 错误边界: 每个 Stage 包裹 ErrorBoundary
- [ ] 移动端: 降级为单列 + Tab 切换
- [ ] Demo 缩略图: Puppeteer 截图生成
- [ ] 全量测试
- [ ] 迁移 SQL 脚本执行

---

## 十七、实施里程碑与竞争力

```
Phase 0-2 (约 9 天):
  ★ 超越 Deep Research & Perplexity
  实时浮现 + 协同驾驶 + 演化板

Phase 3-4 (约 4 天):
  ★ 完整旅程体验
  成果架 + 迭代循环 + 报告内嵌

Phase 5 (约 3 天):
  ★ 独有的多类型原型
  6 种原型覆盖技术→商业全场景

Phase 6-7 (约 7 天):
  ★ 长期壁垒
  Canvas 画布 + 跨项目知识网络
```

**P0-P4 完成** (约 13 天): 核心体验重塑完毕，用户感受到完整的"主题→观点→创意→原型"旅程。
**P5-P7 完成** (约 10 天): 构建差异化壁垒，进入竞品无法快速复制的领域。

---

## 十八、后端架构重构：学习 TI 模式，充分利用 AI Engine + AI Kernel

> **核心思路**: 当前 Research 后端是"自建 FSM + 直接 ChatFacade"的扁平结构，没有充分利用 AI Engine 的 Registry/Orchestrator 和 AI Kernel 的 Process/Mission 能力。TI 是标杆实现——我们要从 TI 学习"正确的 6 层接入方式"，同时保留 Research 独有的多 Agent 讨论和迭代循环能力。

### 18.1 当前 Research vs TI 架构对比

```
当前 Research (扁平结构):                        TI (正确 6 层接入):
─────────────────────────                      ─────────────────────

Controller (SSE)                               Controller + Gateway (HTTP + WebSocket)
    ↓                                              ↓
DiscussionOrchestratorService (薄门面)           MissionLifecycleService (状态机)
    ↓                                              ↓
DiscussionPhaseCoordinatorService               MissionExecutionService (动态调度)
(1500行, 自建FSM, 4阶段全在一个文件)                ↓
    ↓                                          TaskExecutor (策略模式)
ChatFacade.chat() (直接调)                      ├── DimensionResearchExecutor
    ↓                                          ├── ReviewDimensionExecutor
报告合成 (内嵌)                                 ├── SynthesisReportExecutor
                                               └── GenericTaskExecutor
                                                   ↓
                                               3 阶段维度研究 (search → write → integrate)
                                                   ↓
                                               ChatFacade.chat() (通过 Executor 调)

差距:
  ✗ 不用 StateTransitionValidator (手动 status 赋值)
  ✗ 不用 MissionExecutor (kernel process 不创建)
  ✗ 不用 CircuitBreaker (搜索失败无保护)
  ✗ 不用 WebSocket (纯 SSE, 无法双向)
  ✗ 不用 EventBus (无法跨服务广播)
  ✗ 没有 TaskExecutor 策略模式
  ✗ 没有 TODO 系统
  ✗ 没有 Leader 子服务分解
  ✗ DiscussionPhaseCoordinator 是 1500 行的上帝服务
```

### 18.2 重构后的目标架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  L4: AI App - Research (重构后)                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Controllers                    Gateway                              │
│  ├── ResearchController         ResearchGateway (WebSocket)          │
│  ├── IdeaController             ├── join:project / leave:project     │
│  └── DemoController             ├── mission:*, agent:*, todo:*       │
│                                 └── sync:request (断线重连)          │
│                                                                      │
│  Core Services (仿 TI 分层)                                          │
│  ├── mission/                                                        │
│  │   ├── ResearchMissionLifecycleService  ← StateTransitionValidator │
│  │   ├── ResearchMissionExecutionService  ← 动态任务调度              │
│  │   └── ResearchTodoService              ← TODO 管理 (新增)         │
│  │                                                                   │
│  ├── leader/                                                         │
│  │   ├── ResearchLeaderPlanningService    ← 研究规划 (reasoning)     │
│  │   ├── ResearchLeaderIntentService      ← @Leader 对话              │
│  │   ├── ResearchLeaderSteeringService    ← 协同驾驶干预 (新增)       │
│  │   └── ResearchLeaderReviewService      ← 质量审核                  │
│  │                                                                   │
│  ├── task-executors/                                                 │
│  │   ├── IResearchTaskExecutor            ← 策略接口                  │
│  │   ├── DiscussionExecutor               ← 多 Agent 讨论 (保留!)     │
│  │   ├── SearchExecutor                   ← 多工具搜索                │
│  │   ├── InsightExtractionExecutor        ← 实时观点提取 (新增)       │
│  │   ├── IdeaDerivationExecutor           ← 创意衍生 (新增)           │
│  │   ├── PrototypeGenerationExecutor      ← 多类型原型生成 (新增)     │
│  │   ├── ReportSynthesisExecutor          ← 报告合成                  │
│  │   └── QualityReviewExecutor            ← 质量审核                  │
│  │                                                                   │
│  └── discussion/                                                     │
│      ├── DiscussionAgentService           ← 7 Agent 讨论 (保留!)      │
│      ├── DiscussionPhaseService           ← 瘦身版, 只管讨论逻辑      │
│      └── prompt-locale.ts                ← 多语言 (保留)              │
│                                                                      │
│  Skills (Skill 化, 注册到 SkillRegistry)                              │
│  ├── research-planning.skill.md          ← 已有                      │
│  ├── insight-extraction.skill.md         ← 新增: 实时观点提取         │
│  ├── idea-derivation.skill.md            ← 新增: 从观点衍生创意       │
│  ├── steer-deepen.skill.md               ← 新增: 深入当前方向         │
│  ├── steer-pivot.skill.md                ← 新增: 转换研究角度         │
│  ├── steer-inject.skill.md               ← 新增: 注入外部信息         │
│  ├── prototype-interactive.skill.md      ← 新增: 交互原型生成         │
│  ├── prototype-architecture.skill.md     ← 新增: 架构图(Mermaid)      │
│  ├── prototype-dashboard.skill.md        ← 新增: 仪表盘(ECharts)      │
│  ├── prototype-comparison.skill.md       ← 新增: 对比矩阵             │
│  ├── prototype-journey.skill.md          ← 新增: 用户旅程图           │
│  ├── prototype-canvas.skill.md           ← 新增: 商业画布             │
│  └── cross-project-retrieval.skill.md    ← 新增: 跨项目知识检索       │
│                                                                      │
│  Config                                                              │
│  ├── research-team.config.ts             ← 更新: workflow 改为 DAG    │
│  ├── valid-skills.config.ts              ← 更新: 加入新 skills        │
│  ├── agent-roles.config.ts               ← 新增: 专业角色注册表       │
│  └── research-mission-transitions.ts     ← 新增: 状态转换规则         │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  L3: AI Kernel (接入)                                                │
│  ├── StateTransitionValidator  → 任务状态机验证                       │
│  ├── MissionExecutorService    → 创建 kernel process, 追踪生命周期    │
│  ├── CircuitBreakerService     → 保护搜索 API 调用                    │
│  ├── EventBusService           → WebSocket 事件广播                   │
│  ├── ProgressTrackerService    → 实时进度追踪                         │
│  └── ProcessMemoryManager      → 跨轮次研究记忆持久化                 │
├─────────────────────────────────────────────────────────────────────┤
│  L2: AI Engine (接入)                                                │
│  ├── ChatFacade                → LLM 调用 (通过 TaskProfile)          │
│  ├── ToolRegistry/ToolFacade   → 工具注册和执行                       │
│  ├── SkillRegistry             → Skill 注册和 trigger matching        │
│  ├── AgentRegistry             → Agent 注册                           │
│  ├── TeamRegistry              → Team 配置注册                        │
│  ├── PromptSkillBridge         → .skill.md 域注册                     │
│  ├── ContextCompressionService → 长上下文压缩                         │
│  ├── TokenBudgetService        → Token 预算分配                       │
│  ├── OutputReviewerService     → 内容质量审核                         │
│  └── TraceCollectorService     → 可观测性                             │
└─────────────────────────────────────────────────────────────────────┘
```

### 18.3 关键重构点详解

#### 18.3.1 引入 Mission 生命周期（学 TI）

**现状**: Research 直接操作 `DeepResearchSession.status`，无状态机校验。

**重构**: 引入 `ResearchMissionLifecycleService`，使用 Kernel 的 `StateTransitionValidator`：

```typescript
// 新增: config/research-mission-transitions.ts
export const RESEARCH_MISSION_TRANSITIONS: Record<string, string[]> = {
  CREATED: ["PLANNING"],
  PLANNING: ["PLAN_READY", "FAILED"],
  PLAN_READY: ["EXPLORING", "CANCELLED"], // 用户审批
  EXPLORING: ["DISTILLING", "PAUSED", "FAILED"], // EXPLORE 阶段
  DISTILLING: ["EXPLORING", "DELIVERING", "PAUSED"], // 可回到 EXPLORE (新轮次)
  PAUSED: ["EXPLORING", "CANCELLED"],
  DELIVERING: ["COMPLETED", "FAILED"],
  COMPLETED: [], // 终态
  FAILED: ["EXPLORING"], // 可重试
  CANCELLED: [], // 终态
};

// 新增: services/core/mission/research-mission-lifecycle.service.ts
@Injectable()
export class ResearchMissionLifecycleService {
  private readonly validator = new StateTransitionValidator(
    RESEARCH_MISSION_TRANSITIONS,
    ["COMPLETED", "FAILED", "CANCELLED"],
  );

  async transition(sessionId: string, newStatus: string): Promise<void> {
    const session = await this.prisma.deepResearchSession.findUnique({
      where: { id: sessionId },
    });
    this.validator.validate(session.status, newStatus); // ← Kernel 能力
    await this.prisma.deepResearchSession.update({
      where: { id: sessionId },
      data: { status: newStatus },
    });
  }
}
```

**状态流转图 (对应 5 阶段)**:

```
CREATED → PLANNING → PLAN_READY → EXPLORING → DISTILLING ─┐
  (启动)    (Leader规划)  (用户审批)  (EXPLORE阶段)  (DISTILL阶段)  │
                                        ▲              │        │
                                        │              │        │
                                        └──────────────┘        │
                                        (新一轮迭代)             │
                                                                ▼
                                                           DELIVERING → COMPLETED
                                                           (DELIVER阶段)   (终态)
```

#### 18.3.2 Task Executor 策略模式（学 TI）

**现状**: `DiscussionPhaseCoordinatorService` 1500 行，所有逻辑内嵌。

**重构**: 拆分为 7 个 Executor，每个实现 `IResearchTaskExecutor` 接口：

```typescript
// 新增: services/core/task-executors/research-task-executor.interface.ts
export interface IResearchTaskExecutor {
  execute(context: ResearchTaskContext): Promise<ResearchTaskResult>;
}

export interface ResearchTaskContext {
  task: ResearchTask; // 任务定义
  session: DeepResearchSession; // 研究会话
  project: ResearchProject; // 研究项目
  round: number; // 当前迭代轮次
  modelId?: string; // Leader 分配的模型
  assignedSkills: string[]; // Leader 分配的技能
  assignedTools: string[]; // Leader 分配的工具
  previousRoundContext?: string; // 上一轮的压缩上下文
}

// Task 类型 → Executor 映射
export const EXECUTOR_MAP: Record<string, Type<IResearchTaskExecutor>> = {
  discussion: DiscussionExecutor, // 多 Agent 讨论
  search: SearchExecutor, // 多工具并行搜索
  insight_extraction: InsightExtractionExecutor, // 实时观点提取
  idea_derivation: IdeaDerivationExecutor, // 创意衍生
  prototype_generation: PrototypeGenerationExecutor, // 多类型原型
  report_synthesis: ReportSynthesisExecutor, // 报告合成
  quality_review: QualityReviewExecutor, // 质量审核
};
```

**核心 Executor 实现举例:**

```typescript
// DiscussionExecutor: 保留 Research 独有的多 Agent 讨论能力
@Injectable()
export class DiscussionExecutor implements IResearchTaskExecutor {
  constructor(
    private readonly agentService: DiscussionAgentService,
    private readonly chatFacade: ChatFacade,
    private readonly eventBus: EventBusService,        // ← Kernel
    private readonly circuitBreaker: CircuitBreakerService, // ← Kernel
  ) {}

  async execute(ctx: ResearchTaskContext): Promise<ResearchTaskResult> {
    // 1. 初始化 7 Agent 团队
    const team = await this.agentService.initializeTeam(ctx.session.query, ctx.round);

    // 2. 讨论循环 (ideation → execution → findings)
    for (const phase of ['ideation', 'execution', 'findings']) {
      // 广播阶段事件 (通过 Kernel EventBus → WebSocket)
      this.eventBus.emitToRoom(
        { roomType: 'project', entityId: ctx.project.id },
        { type: `discussion.phase`, data: { phase, round: ctx.round } },
      );

      // 每个 Agent 发言 (带 CircuitBreaker 保护)
      for (const agent of team) {
        const response = await this.circuitBreaker.execute(
          `research-agent-${agent.role}`,
          () => this.agentService.speak(agent, phase, ctx),
        );
        // 实时广播 Agent 消息
        this.eventBus.emitToRoom(..., {
          type: 'discussion.message',
          data: { agentRole: agent.role, content: response, phase },
        });
      }
    }

    return { type: 'discussion', findings: extractedFindings };
  }
}

// InsightExtractionExecutor: 新增, 实时观点提取
@Injectable()
export class InsightExtractionExecutor implements IResearchTaskExecutor {
  async execute(ctx: ResearchTaskContext): Promise<ResearchTaskResult> {
    const discussionContent = ctx.task.input.discussionContent;

    // 使用 insight-extraction skill
    const insights = await this.chatFacade.chatWithSkills({
      messages: [{ role: 'user', content: discussionContent }],
      skills: ['insight-extraction'],
      taskProfile: { creativity: 'low', outputLength: 'medium' },
    });

    // 逐条持久化 + 实时推送
    for (const insight of insights) {
      const idea = await this.ideaService.create({
        projectId: ctx.project.id,
        sessionId: ctx.session.id,
        type: 'INSIGHT',
        title: insight.title,
        description: insight.description,
        confidence: insight.confidence,
        iterationRound: ctx.round,
        agentRole: insight.agentRole,
      });

      // 通过 Kernel EventBus → WebSocket 实时推送
      this.eventBus.emitToRoom(
        { roomType: 'project', entityId: ctx.project.id },
        { type: 'insight.discovered', data: { id: idea.id, ...insight } },
      );
    }

    return { type: 'insight_extraction', count: insights.length };
  }
}
```

#### 18.3.3 Leader 服务分解（学 TI）

**现状**: 研究规划逻辑散落在 `ResearchPlannerService` 和 `DiscussionOrchestratorService` 中。

**重构**: 对标 TI 的 4 个 Leader 子服务：

```
ResearchLeaderService (薄门面)
├── ResearchLeaderPlanningService
│   ├── planResearch(topic, userPrompt) → LeaderPlan
│   │   • 使用 reasoning model (与 TI 一致)
│   │   • 输出: 研究维度、任务 DAG、模型分配、skill 分配
│   │   • 新增: 检索 Library 已有相关观点 (跨项目复用)
│   └── adjustPlan(sessionId, modifications) → LeaderPlan
│
├── ResearchLeaderIntentService (新增)
│   ├── handleUserMessage(projectId, message) → LeaderResponse
│   │   • 解码用户意图: DIRECT_ANSWER / CREATE_TODO / STEER / CLARIFY
│   └── decodeSteeringIntent(steerRequest) → SteeringAction
│       • deepen → 加深当前搜索方向
│       • pivot → 切换研究角度
│       • inject → 注入用户信息
│       • reject_insight → 否定某观点
│       • reorder_plan → 调整任务优先级
│
├── ResearchLeaderSteeringService (新增, 协同驾驶核心)
│   ├── deepen(sessionId, direction) → void
│   │   • 追加搜索 task 到当前 DAG
│   ├── pivot(sessionId, newAngle) → void
│   │   • 调整未执行 task 的搜索方向
│   ├── inject(sessionId, content) → void
│   │   • 将用户资料加入研究上下文
│   ├── rejectInsight(insightId, reason) → void
│   │   • 标记观点为 rejected, 后续轮次参考
│   └── reorderPlan(sessionId, newOrder) → void
│       • 重排未执行 task 的顺序
│
└── ResearchLeaderReviewService
    ├── reviewTaskOutput(taskId, output) → ReviewResult
    │   • 审核 Executor 产出质量
    │   • 通过: 标记完成
    │   • 不通过: 标记需返工, 给出改进建议
    └── reviewOverallQuality(sessionId) → QualityReport
        • 评估整轮研究质量, 决定是否需要新一轮
```

#### 18.3.4 Skill 化：将硬编码逻辑转为可注册 Skill

**核心理念**: TI 的 Leader 在规划时动态分配 skills 给 agent，agent 通过 `ChatFacade.chatWithSkills()` 执行。Research 应该做到同样的动态性。

**新增 Skills 列表 (`.skill.md` 文件)**:

| Skill ID                  | 类别       | 用途                             | 输入                  | 输出                                                    |
| ------------------------- | ---------- | -------------------------------- | --------------------- | ------------------------------------------------------- |
| `insight-extraction`      | Analysis   | 从讨论内容中实时提取有价值的观点 | Agent 讨论记录        | `{insights: [{title, desc, confidence, evidence}]}`     |
| `idea-derivation`         | Creative   | 从一个观点衍生创意方案           | 观点 + 研究上下文     | `{ideas: [{title, concept, feasibility, innovations}]}` |
| `steer-deepen`            | Steering   | 分析当前方向的深入路径           | 当前搜索结果 + 方向   | `{queries: string[], focus: string}`                    |
| `steer-pivot`             | Steering   | 分析转向角度和新搜索策略         | 当前方向 + 新角度     | `{newDirections: [], pivotReason: string}`              |
| `steer-inject`            | Steering   | 将用户注入的信息整合到研究上下文 | 用户资料 + 当前上下文 | `{updatedContext: string, newInsights: []}`             |
| `prototype-interactive`   | Generation | 生成 HTML/CSS/JS 交互原型        | 创意描述 + 研究数据   | `{htmlContent: string}`                                 |
| `prototype-architecture`  | Generation | 生成 Mermaid 架构图/流程图       | 创意描述              | `{mermaidCode: string}`                                 |
| `prototype-dashboard`     | Generation | 生成 ECharts 数据仪表盘          | 创意描述 + 数据       | `{echartsOptions: object}`                              |
| `prototype-comparison`    | Generation | 生成多方案对比矩阵               | 创意描述 + 对比维度   | `{headers: [], rows: []}`                               |
| `prototype-journey`       | Generation | 生成用户旅程图                   | 创意描述              | `{stages: [{name, touchpoints}]}`                       |
| `prototype-canvas`        | Generation | 生成商业画布                     | 创意描述              | `{segments: [{key, items}]}`                            |
| `cross-project-retrieval` | Knowledge  | 从 Library 检索已有相关观点      | 研究主题              | `{relatedInsights: [], relevanceScores: []}`            |
| `exit-decision`           | Evaluation | 评估是否应该退出迭代             | 质量分/收敛度/饱和度  | `{shouldExit: bool, reason, recommendation}`            |

**Skill 注册方式 (与 TI 一致)**:

```typescript
// research.module.ts onModuleInit()
async onModuleInit() {
  // 1. 注册 prompt skill 域 (扫描 skills/*.skill.md)
  await this.promptSkillBridge.registerDomain('research');

  // 2. 注册 Agent
  this.agentRegistry.register(this.researcherAgent);

  // 3. 注册 Team 配置
  this.teamRegistry.registerConfig(RESEARCH_TEAM_CONFIG);

  // 4. 注册 Workflow Handlers (新增, 学 TI)
  this.handlerRegistry.register(new DiscussionPhaseHandler(this.discussionExecutor));
  this.handlerRegistry.register(new InsightExtractionHandler(this.insightExecutor));
  this.handlerRegistry.register(new PrototypeGenerationHandler(this.prototypeExecutor));
}
```

**更新 valid-skills.config.ts**:

```typescript
export const RESEARCH_VALID_SKILLS = new Set([
  // 保留: 已有 31 个 skills
  ...EXISTING_RESEARCH_SKILLS,

  // 新增: Steering (协同驾驶)
  "steer-deepen",
  "steer-pivot",
  "steer-inject",

  // 新增: Real-time Analysis
  "insight-extraction",
  "idea-derivation",

  // 新增: Prototype Generation (6 种)
  "prototype-interactive",
  "prototype-architecture",
  "prototype-dashboard",
  "prototype-comparison",
  "prototype-journey",
  "prototype-canvas",

  // 新增: Knowledge
  "cross-project-retrieval",
  "exit-decision",
]);
```

#### 18.3.5 研究任务 DAG（学 TI 的动态调度）

**现状**: 4 阶段顺序执行，无法并行。

**重构**: Leader 生成任务 DAG，MissionExecutionService 动态调度：

```typescript
// Leader 生成的研究计划 (DAG)
interface ResearchPlan {
  tasks: ResearchTask[];
  // 任务间依赖关系
}

// 示例 DAG (一轮迭代):
//
//   ┌──────────────┐
//   │ discussion   │  (多 Agent 讨论, 产出 directions)
//   └──────┬───────┘
//          │
//    ┌─────┼──────┐
//    ▼     ▼      ▼
//  search search search    (3 方向并行搜索)
//    │     │      │
//    └─────┼──────┘
//          ▼
//   ┌──────────────┐
//   │ insight_ext  │  (从讨论+搜索结果提取观点)
//   └──────┬───────┘
//          │
//    ┌─────┼──────┐
//    ▼     ▼      ▼
//  idea   idea   idea      (从观点衍生创意, 并行)
//    │     │      │
//    └─────┼──────┘
//          ▼
//   ┌──────────────┐
//   │ proto_gen    │  (为 top 创意生成原型, 可并行)
//   └──────┬───────┘
//          ▼
//   ┌──────────────┐
//   │quality_review│  (Leader 审核, 决定是否再迭代)
//   └──────────────┘

// ResearchMissionExecutionService: 动态任务调度 (学 TI)
async executeTaskDAG(sessionId: string, tasks: ResearchTask[]): Promise<void> {
  const maxConcurrency = this.calculateDynamicConcurrency();

  while (hasExecutableTasks(tasks)) {
    // 找到所有依赖已满足的 task
    const ready = tasks.filter(t =>
      t.status === 'PENDING' &&
      t.dependsOn.every(depId => getTask(depId).status === 'COMPLETED')
    );

    // 并发执行 (受限于 maxConcurrency)
    const batch = ready.slice(0, maxConcurrency);
    await Promise.allSettled(
      batch.map(task => this.executeTask(task, sessionId))
    );
  }
}

async executeTask(task: ResearchTask, sessionId: string): Promise<void> {
  // 1. 状态转换 (通过 Kernel 验证)
  await this.lifecycle.transition(task.id, 'IN_PROGRESS');

  // 2. 广播 TODO 进度
  this.eventBus.emitToRoom(..., { type: 'todo:started', data: { taskId: task.id } });

  // 3. 路由到对应 Executor
  const executor = this.executorMap.get(task.type);
  const result = await executor.execute(taskContext);

  // 4. Leader 审核产出
  const review = await this.leaderReview.reviewTaskOutput(task.id, result);
  if (!review.approved && task.revisionCount < MAX_REVISIONS) {
    // 返工
    await this.lifecycle.transition(task.id, 'PENDING');
    task.revisionCount++;
    return;
  }

  // 5. 完成
  await this.lifecycle.transition(task.id, 'COMPLETED');
  this.eventBus.emitToRoom(..., { type: 'todo:completed', data: { taskId: task.id } });
}
```

#### 18.3.6 WebSocket Gateway（学 TI，替代纯 SSE）

**现状**: Research 通过 SSE (Server-Sent Events) 单向推送，不支持双向通信。

**重构**: 新增 `ResearchGateway`（与 TI 的 `TopicInsightsGateway` 模式一致）：

```typescript
// 新增: research.gateway.ts
@WebSocketGateway({ namespace: "/research" })
export class ResearchGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  // JWT 认证 (与 TI 完全一致)
  afterInit() {
    this.server.use(async (socket, next) => {
      const token = socket.handshake.auth?.token;
      const payload = await this.verifyToken(token);
      socket.data.user = payload;
      next();
    });
  }

  // 加入项目房间
  @SubscribeMessage("join:project")
  handleJoin(client: AuthenticatedSocket, data: { projectId: string }) {
    client.join(`project:${data.projectId}`);
  }

  // 断线重连同步 (Phase 5, 学 TI)
  @SubscribeMessage("sync:request")
  handleSync(
    client: AuthenticatedSocket,
    data: { projectId: string },
    callback: Function,
  ) {
    const state = await this.getMissionState(data.projectId);
    callback({ success: true, state });
  }

  // 由 Kernel EventBus 驱动的事件广播
  constructor(private readonly eventBus: EventBusService) {
    // 订阅研究事件并广播到 WebSocket
    this.eventBus.subscribe("research.*", (event) => {
      const projectId = event.data.projectId;
      this.server.to(`project:${projectId}`).emit(event.type, event.data);
    });
  }
}
```

**SSE 保留**: 现有 SSE 端点保持向后兼容（渐进迁移），但新功能（TODO 更新、steering 反馈）通过 WebSocket 双向通信。

#### 18.3.7 TODO 系统（学 TI）

**现状**: Research 没有任务追踪，用户只能看到研究阶段名称。

**重构**: 新增 `ResearchTodoService`，复用 TI 的 TODO 模式：

```typescript
// 新增 Prisma model (或复用 ResearchTask 表扩展)
// ResearchTodo 类型直接映射到 task executor:
export enum ResearchTodoType {
  DISCUSSION = "DISCUSSION", // 多 Agent 讨论
  SEARCH = "SEARCH", // 搜索
  INSIGHT_EXTRACTION = "INSIGHT_EXTRACTION", // 观点提取
  IDEA_DERIVATION = "IDEA_DERIVATION", // 创意衍生
  PROTOTYPE_GENERATION = "PROTOTYPE_GENERATION", // 原型生成
  REPORT_SYNTHESIS = "REPORT_SYNTHESIS", // 报告合成
  QUALITY_REVIEW = "QUALITY_REVIEW", // 质量审核
  USER_REQUEST = "USER_REQUEST", // 用户通过 @Leader 创建
}

// 状态 (与 TI 一致)
export enum ResearchTodoStatus {
  PENDING = "PENDING",
  QUEUED = "QUEUED",
  IN_PROGRESS = "IN_PROGRESS",
  REVIEWING = "REVIEWING",
  PAUSED = "PAUSED",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}
```

**前端展示**: 在 EXPLORE 阶段的 ActivityFeed 下方，或 LeftSidebar 中，嵌入简化版 TODO 列表（参考 TI 的 `ResearchTodoList`），让用户看到每个任务的执行状态。

### 18.4 Agent 角色注册表（学 TI）

**现状**: Research 的 7 个 Agent 角色硬编码在 `DiscussionAgentService` 中。

**重构**: 新增 `agent-roles.config.ts`，支持 Leader 动态分配：

```typescript
// 新增: config/agent-roles.config.ts
export const RESEARCH_AGENT_ROLES: Record<string, AgentRoleDefinition> = {
  // 核心角色 (始终存在)
  DIRECTOR: {
    displayName: "研究主管",
    color: "#8B5CF6", // purple
    recommendedSkills: ["research-planning", "gap-analysis"],
    recommendedTools: [],
  },
  RESEARCHER: {
    displayName: "研究员",
    color: "#3B82F6", // blue
    recommendedSkills: ["deep-dive", "synthesis", "trend-analysis"],
    recommendedTools: ["web-search", "arxiv-search"],
  },
  ANALYST: {
    displayName: "分析师",
    color: "#3B82F6", // blue
    recommendedSkills: [
      "data-interpretation",
      "critical-thinking",
      "cause-effect",
    ],
    recommendedTools: ["data-analysis"],
  },
  WRITER: {
    displayName: "报告撰写",
    color: "#F59E0B", // amber
    recommendedSkills: ["report-synthesis", "executive-summary-writing"],
    recommendedTools: ["text-generation"],
  },
  REVIEWER: {
    displayName: "质量审核",
    color: "#10B981", // green
    recommendedSkills: [
      "fact-check",
      "consistency-check",
      "source-credibility",
    ],
    recommendedTools: [],
  },

  // 专业角色 (Leader 按主题类型分配)
  DEVIL_ADVOCATE: {
    displayName: "批判性思考者",
    recommendedSkills: ["critical-thinking"],
  },
  TREND_ANALYST: {
    displayName: "趋势分析师",
    recommendedSkills: ["trend-analysis", "data-interpretation"],
  },
  DOMAIN_EXPERT: {
    displayName: "领域专家",
    recommendedSkills: ["deep-dive", "cross-reference-validation"],
  },
};

// Leader 按主题类型推荐角色组合
export const ROLE_RECOMMENDATIONS = {
  technology: [
    "DIRECTOR",
    "RESEARCHER",
    "RESEARCHER",
    "ANALYST",
    "DOMAIN_EXPERT",
    "WRITER",
    "REVIEWER",
  ],
  market: [
    "DIRECTOR",
    "RESEARCHER",
    "TREND_ANALYST",
    "ANALYST",
    "WRITER",
    "REVIEWER",
  ],
  academic: [
    "DIRECTOR",
    "RESEARCHER",
    "RESEARCHER",
    "DEVIL_ADVOCATE",
    "ANALYST",
    "WRITER",
    "REVIEWER",
  ],
  strategy: [
    "DIRECTOR",
    "RESEARCHER",
    "TREND_ANALYST",
    "ANALYST",
    "WRITER",
    "REVIEWER",
  ],
};
```

### 18.5 AI Kernel 完整接入方案

| Kernel 能力                  | 当前 Research 使用         | 重构后使用                          | 对应 TI 用法               |
| ---------------------------- | -------------------------- | ----------------------------------- | -------------------------- |
| **StateTransitionValidator** | ✗ 不用                     | ✓ 每次状态转换验证                  | ✓ MissionLifecycleService  |
| **MissionExecutorService**   | `@Optional` 导入但从未调用 | ✓ 创建 kernel process，追踪生命周期 | ✓ MissionExecutionService  |
| **CircuitBreakerService**    | ✗ 不用                     | ✓ 保护所有搜索 API 和 LLM 调用      | ✓ 9 个搜索 adapter         |
| **EventBusService**          | ✗ 不用                     | ✓ WebSocket 事件广播                | ✓ Gateway 事件分发         |
| **ProgressTrackerService**   | ✗ 不用                     | ✓ 实时任务进度追踪                  | ✓ TODO 进度更新            |
| **ProcessMemoryManager**     | ✗ 不用                     | ✓ 跨轮次研究记忆 (PERSISTENT 层)    | ✗ TI 也没用 (我们做更好)   |
| **ConstraintEngine**         | ✗ 不用                     | ✓ Token 预算和成本控制              | ✓ MissionOrchestrator      |
| **EventJournalService**      | ✗ 不用                     | ✓ 研究事件审计日志                  | ✓ 隐式通过 MissionExecutor |
| **CheckpointManager**        | ✗ 不用                     | ✓ 迭代轮次间断点恢复                | ✓ 隐式通过 MissionExecutor |

### 18.6 研究记忆升级（超越 TI）

**TI 现状**: 只有 Phase 1 日志记录（`strategy-loader.service.ts` 读取静态 `.md` 规则）。

**Research 目标**: 利用 Kernel 的 `ProcessMemoryManager` 实现真正的跨轮次/跨会话学习：

```typescript
// 使用 Kernel 多层记忆
// WORKING 层: 当前轮次的临时状态
await this.memoryManager.write({
  processId: sessionProcessId,
  layer: 'WORKING',
  key: `round-${round}-findings`,
  value: { findings, gaps, quality },
});

// SESSION 层: 本次研究会话的累积上下文
await this.memoryManager.write({
  processId: sessionProcessId,
  layer: 'SESSION',
  key: 'accumulated-insights',
  value: { insights: allInsightsFromAllRounds },
});

// PERSISTENT 层: 跨会话的研究策略学习
await this.memoryManager.write({
  processId: sessionProcessId,
  layer: 'PERSISTENT',
  key: `strategy-${topicType}`,
  value: {
    effectiveQueries: [...],     // 哪些搜索词效果好
    usefulTools: [...],          // 哪些工具最有价值
    commonGaps: [...],           // 常见信息缺口
    lastUsed: new Date(),
  },
  expiresAt: addDays(new Date(), 90), // 90 天有效
});
```

### 18.7 Team Workflow 更新

**现状**: `RESEARCH_TEAM_CONFIG` 的 workflow 是 7 步线性+并行搜索。

**重构**: 更新为适配新 Task Executor 的 DAG workflow：

```typescript
export const RESEARCH_TEAM_CONFIG: TeamConfig = {
  id: BUILTIN_TEAMS.RESEARCH,
  name: "深度研究",
  // ...

  workflow: {
    id: "research-workflow-v2",
    steps: [
      {
        id: "planning",
        name: "研究规划",
        type: "task",
        executorRoles: [BUILTIN_ROLES.RESEARCH_LEAD],
        taskType: "planning", // ← 映射到 Leader planning
      },
      {
        id: "discussion",
        name: "多Agent讨论",
        type: "task",
        executorRoles: [BUILTIN_ROLES.RESEARCHER, BUILTIN_ROLES.ANALYST],
        taskType: "discussion", // ← 映射到 DiscussionExecutor
        dependsOn: ["planning"],
      },
      {
        id: "parallel-search",
        name: "并行搜索",
        type: "task",
        executorRoles: [BUILTIN_ROLES.RESEARCHER],
        taskType: "search", // ← 映射到 SearchExecutor
        parallel: true,
        dependsOn: ["discussion"],
      },
      {
        id: "insight-extraction",
        name: "观点提取",
        type: "task",
        executorRoles: [BUILTIN_ROLES.ANALYST],
        taskType: "insight_extraction", // ← 映射到 InsightExtractionExecutor
        dependsOn: ["parallel-search"],
      },
      {
        id: "idea-derivation",
        name: "创意衍生",
        type: "task",
        executorRoles: [BUILTIN_ROLES.ANALYST, BUILTIN_ROLES.RESEARCHER],
        taskType: "idea_derivation",
        parallel: true,
        dependsOn: ["insight-extraction"],
      },
      {
        id: "prototype-generation",
        name: "原型生成",
        type: "task",
        executorRoles: [BUILTIN_ROLES.WRITER],
        taskType: "prototype_generation",
        dependsOn: ["idea-derivation"],
      },
      {
        id: "quality-review",
        name: "质量审核",
        type: "review",
        executorRoles: [BUILTIN_ROLES.RESEARCH_LEAD],
        taskType: "quality_review",
        dependsOn: ["prototype-generation"],
        reviewConfig: {
          criteria: [
            { name: "准确性", weight: 0.3 },
            { name: "完整性", weight: 0.25 },
            { name: "深度", weight: 0.25 },
            { name: "可读性", weight: 0.2 },
          ],
          passThreshold: 0.7,
          maxReworks: 2,
        },
      },
    ],
    timeout: 4 * 60 * 60 * 1000, // 4 hours
  },

  // 更新: 加入新 skills
  availableSkills: [
    // 已有
    ...EXISTING_SKILLS,
    // 新增
    "insight-extraction",
    "idea-derivation",
    "steer-deepen",
    "steer-pivot",
    "steer-inject",
    "prototype-interactive",
    "prototype-architecture",
    "prototype-dashboard",
    "prototype-comparison",
    "prototype-journey",
    "prototype-canvas",
    "cross-project-retrieval",
    "exit-decision",
  ],
};
```

### 18.8 完整数据流：一轮研究的生命周期

```
用户点击"开始研究"
    │
    ▼
[ResearchController.startResearch()]
    │
    ▼
[ResearchMissionLifecycleService]
├── 创建 session: status = CREATED
├── 创建 kernel process: MissionExecutorService.execute()
├── 转换: CREATED → PLANNING
│
├── [ResearchLeaderPlanningService.planResearch()]
│   ├── 使用 reasoning model 生成研究计划
│   ├── 检索 Library 已有相关观点 (cross-project-retrieval skill)
│   ├── 输出: 任务 DAG + 模型分配 + skill 分配
│   └── 转换: PLANNING → PLAN_READY
│
├── 用户审批计划 (WebSocket: plan_ready → approve)
│   └── 转换: PLAN_READY → EXPLORING
│
├── [ResearchMissionExecutionService.executeTaskDAG()]
│   │
│   ├── Task 1: discussion (DiscussionExecutor)
│   │   ├── 7 Agent 多视角讨论
│   │   ├── EventBus → WebSocket: discussion.message, discussion.typing
│   │   └── 输出: ResearchDirection[]
│   │
│   ├── Task 2-4: search × 3 (SearchExecutor, 并行)
│   │   ├── ToolRegistry 路由: academic→arxiv, tech→github
│   │   ├── CircuitBreaker 保护每个搜索 API
│   │   ├── EventBus → WebSocket: search_progress
│   │   └── 输出: SearchResult[]
│   │
│   ├── Task 5: insight_extraction (InsightExtractionExecutor)
│   │   ├── 使用 insight-extraction skill
│   │   ├── 逐条持久化 ResearchIdea
│   │   ├── EventBus → WebSocket: insight.discovered (实时!)
│   │   └── 输出: InsightResult[]
│   │
│   ├── Task 6-8: idea_derivation × 3 (IdeaDerivationExecutor, 并行)
│   │   ├── 使用 idea-derivation skill
│   │   ├── EventBus → WebSocket: idea.derived
│   │   └── 输出: IdeaResult[]
│   │
│   ├── Task 9: prototype_generation (PrototypeGenerationExecutor)
│   │   ├── 使用 prototype-* skills (按用户选择的类型)
│   │   ├── EventBus → WebSocket: prototype.generated
│   │   └── 输出: PrototypeResult[]
│   │
│   └── Task 10: quality_review (QualityReviewExecutor)
│       ├── Leader 审核所有产出
│       ├── 计算质量分
│       ├── 识别信息缺口
│       └── 输出: QualityReport
│
├── 转换: EXPLORING → DISTILLING
│   ├── 前端自动切到 DISTILL 视图
│   ├── 显示三列演化板 + 迭代控制面板
│   └── 等待用户决策: "结束研究" or "继续下一轮"
│
├── 用户选择"继续第2轮" (或自动迭代)
│   ├── 转换: DISTILLING → EXPLORING
│   ├── 写入 Kernel 记忆: WORKING 层 round-1 findings
│   ├── Leader 生成新一轮任务 DAG (基于 gaps + feedback)
│   └── 重复上述 executeTaskDAG 流程 (round=2)
│
├── 达到退出条件 (质量达标 / 饱和 / 用户结束)
│   ├── 转换: DISTILLING → DELIVERING
│   ├── 生成最终报告 (ReportSynthesisExecutor)
│   │   ├── 报告内嵌 insights + ideas + prototypes
│   │   └── 写入 Kernel 记忆: PERSISTENT 层研究策略
│   └── 转换: DELIVERING → COMPLETED
│
└── Kernel process 完成
    ├── MissionExecutorService.complete()
    ├── 记录最终 cost 和 tokens
    └── EventBus → WebSocket: mission:completed
```

### 18.9 重构后的目录结构

> **设计原则**: 严格对齐 TI 的目录分层模式，确保两个模块的架构一致性。
> TI 目录树参考: `backend/src/modules/ai-app/insight/`

```
backend/src/modules/ai-app/research/
│
│  ─── 模块入口 (与 TI 一致: 3 个根文件) ───
├── research.module.ts                    # 更新: 注册 workflow handlers + gateway
├── research.service.ts                   # 保留: 薄门面 (对标 TI topic-insights.service.ts)
├── research.gateway.ts                   # 新增: WebSocket gateway (对标 TI topic-insights.gateway.ts)
│
│  ─── 注册层 (与 TI 一致) ───
├── agents/
│   └── researcher.agent.ts              # 保留 (对标 TI agents/topic-insights.agent.ts)
│
├── teams/
│   └── research-team.config.ts          # 更新: DAG workflow v2
│
│  ─── HTTP 层 (与 TI 一致: 按领域拆分 Controller) ───
├── controllers/
│   ├── research.controller.ts           # 更新: 启动研究/SSE (对标 TI mission.controller.ts)
│   ├── idea.controller.ts               # 保留 (Research 独有)
│   ├── demo.controller.ts               # 保留 (Research 独有)
│   ├── steering.controller.ts           # 新增: /steer 协同驾驶 (Research 独有)
│   └── leader-chat.controller.ts        # 新增: @Leader 对话 (对标 TI 的 leader chat 端点)
│
│  ─── DTO 层 (与 TI 一致: 14+ 文件, 按领域拆分) ───
├── dto/
│   ├── plan-approval.dto.ts             # 保留
│   ├── steer.dto.ts                     # 新增: 协同驾驶请求
│   ├── leader-chat.dto.ts               # 新增 (对标 TI dto/leader-chat.dto.ts)
│   ├── create-research.dto.ts           # 保留
│   ├── idea.dto.ts                      # 保留
│   ├── demo.dto.ts                      # 保留
│   └── iteration.dto.ts                 # 保留
│
│  ─── 守卫层 (与 TI 一致) ───
├── guards/
│   ├── billing-context.interceptor.ts   # 保留 (对标 TI guards/billing-context.interceptor.ts)
│   └── project-access.guard.ts          # 新增 (对标 TI guards/topic-access.guard.ts)
│
│  ─── Workflow 处理器 (与 TI 一致: handlers/) ───
├── handlers/
│   ├── discussion-phase.handler.ts      # 新增 (对标 TI handlers/search-phase.handler.ts)
│   ├── insight-extraction.handler.ts    # 新增 (对标 TI handlers/global-outline.handler.ts)
│   ├── prototype-generation.handler.ts  # 新增
│   ├── quality-review.handler.ts        # 新增 (对标 TI handlers/quality-review.handler.ts)
│   └── revision.handler.ts             # 新增 (对标 TI handlers/revision.handler.ts)
│
│  ─── Prompt 模板 (与 TI 一致: prompts/ 独立目录) ───
├── prompts/
│   ├── research-leader.prompt.ts        # 从 discussion/ 迁出 (对标 TI prompts/research-leader.prompt.ts)
│   ├── discussion-agent.prompt.ts       # 从 discussion/prompt-locale.ts 迁出
│   ├── insight-extraction.prompt.ts     # 新增
│   ├── report-synthesis.prompt.ts       # 从 report-synthesizer 迁出 (对标 TI prompts/report-synthesis.prompt.ts)
│   └── steering.prompt.ts              # 新增: 协同驾驶指令模板
│
│  ─── 服务层 (与 TI 完全对齐的分层结构) ───
├── services/
│   │
│   │  ─── core/ (核心编排, 对标 TI services/core/) ───
│   ├── core/
│   │   │
│   │   ├── leader/                                      # 对标 TI services/core/leader/ (4 个子服务)
│   │   │   ├── research-leader-planning.service.ts      # 新增 (对标 TI leader-planning.service.ts)
│   │   │   ├── research-leader-intent.service.ts        # 新增 (对标 TI leader-intent.service.ts)
│   │   │   ├── research-leader-steering.service.ts      # 新增 (Research 独有: 协同驾驶)
│   │   │   └── research-leader-review.service.ts        # 新增 (对标 TI leader-review.service.ts)
│   │   │
│   │   ├── mission/                                     # 对标 TI services/core/mission/ (5 个服务)
│   │   │   ├── research-mission-lifecycle.service.ts     # 新增 (对标 TI mission-lifecycle.service.ts)
│   │   │   ├── research-mission-execution.service.ts     # 新增 (对标 TI mission-execution.service.ts)
│   │   │   ├── research-mission-query.service.ts         # 新增 (对标 TI mission-query.service.ts)
│   │   │   ├── research-mission-notification.service.ts  # 新增 (对标 TI mission-notification.service.ts)
│   │   │   └── research-mission-observability.service.ts # 新增 (对标 TI mission-observability.service.ts)
│   │   │
│   │   ├── research/                                    # 对标 TI services/core/research/ (6 个服务)
│   │   │   ├── research-leader.service.ts               # 薄门面 (对标 TI research-leader.service.ts)
│   │   │   ├── research-event-emitter.service.ts        # 新增 (对标 TI research-event-emitter.service.ts)
│   │   │   ├── research-realtime.adapter.ts             # 新增 (对标 TI research-realtime.adapter.ts)
│   │   │   ├── research-memory.service.ts               # 迁入 (从 memory/ 迁入, 升级用 Kernel ProcessMemory)
│   │   │   ├── research-strategy.service.ts             # 迁入 (从 memory/strategy-loader 迁入)
│   │   │   └── research-template.service.ts             # 新增 (对标 TI research-template.service.ts)
│   │   │
│   │   ├── task-executors/                              # 对标 TI services/core/task-executors/ (4+接口)
│   │   │   ├── task-executor.interface.ts               # 新增 (对标 TI task-executor.interface.ts)
│   │   │   ├── discussion.executor.ts                   # 新增 (从 PhaseCoordinator 拆出, Research 独有)
│   │   │   ├── search.executor.ts                       # 新增 (从 IterativeSearch 拆出)
│   │   │   ├── insight-extraction.executor.ts           # 新增 (Research 独有)
│   │   │   ├── idea-derivation.executor.ts              # 新增 (Research 独有)
│   │   │   ├── prototype-generation.executor.ts         # 新增 (Research 独有)
│   │   │   ├── report-synthesis.executor.ts             # 新增 (对标 TI synthesis-report.executor.ts)
│   │   │   ├── quality-review.executor.ts               # 新增 (对标 TI review-dimension.executor.ts)
│   │   │   └── generic-task.executor.ts                 # 新增 (对标 TI generic-task.executor.ts)
│   │   │
│   │   └── project/                                     # 对标 TI services/core/topic/ (5 个服务)
│   │       ├── project-crud.service.ts                  # 保留 (对标 TI topic-crud.service.ts)
│   │       ├── project-session.service.ts               # 从 discussion/ 迁入
│   │       └── project-export.service.ts                # 保留 (对标 TI topic-export.service.ts)
│   │
│   │  ─── discussion/ (Research 独有: 多 Agent 讨论, TI 无此层) ───
│   ├── discussion/
│   │   ├── discussion-agent.service.ts                  # 保留 (7 Agent 团队编排)
│   │   └── discussion-phase.service.ts                  # 瘦身: 只管讨论轮次逻辑
│   │
│   │  ─── collaboration/ (对标 TI services/collaboration/) ───
│   ├── collaboration/
│   │   ├── research-todo.service.ts                     # 新增 (对标 TI research-todo.service.ts)
│   │   ├── research-reflection.service.ts               # 新增 (对标 TI research-reflection.service.ts)
│   │   └── research-reviewer.service.ts                 # 新增 (对标 TI research-reviewer.service.ts)
│   │
│   │  ─── data/ (对标 TI services/data/) ───
│   ├── data/
│   │   ├── data-enrichment.service.ts                   # 新增 (对标 TI data-enrichment.service.ts)
│   │   ├── evidence-management.service.ts               # 新增 (对标 TI evidence-management.service.ts)
│   │   ├── leader-tool.service.ts                       # 新增 (对标 TI leader-tool.service.ts: Leader 主动搜索)
│   │   └── rag-fusion.service.ts                        # 新增 (对标 TI rag-fusion.service.ts)
│   │
│   │  ─── search/ (对标 TI services/search/ 三层子结构) ───
│   ├── search/
│   │   ├── search-orchestrator.service.ts               # 保留 (对标 TI search-orchestrator.service.ts)
│   │   ├── search-executor.service.ts                   # 保留 (对标 TI search-executor.service.ts)
│   │   ├── research-tool-router.service.ts              # 保留
│   │   ├── adapters/                                    # 新增子目录 (对标 TI search/adapters/)
│   │   │   └── search-adapter.base.ts                   # 复用 ToolRegistry, 不需要 TI 的 10 个独立 adapter
│   │   ├── fusion/                                      # 新增子目录 (对标 TI search/fusion/)
│   │   │   ├── result-fusion.service.ts                 # 新增: 多源结果融合
│   │   │   └── quality-gate.service.ts                  # 新增: 搜索质量门
│   │   └── query/                                       # 新增子目录 (对标 TI search/query/)
│   │       └── query-strategy.service.ts                # 新增: 查询策略
│   │
│   │  ─── iteration/ (Research 独有: 迭代循环, TI 无此层) ───
│   ├── iteration/
│   │   ├── iterative-research.service.ts                # 更新: 使用 DAG + ExitDecision
│   │   ├── iteration-coordinator.service.ts             # 更新: 使用 MissionExecution
│   │   └── iteration-feedback.service.ts                # 保留
│   │
│   │  ─── evaluation/ (Research 独有: 迭代评估) ───
│   ├── evaluation/
│   │   ├── exit-decision.service.ts                     # 保留
│   │   ├── demo-evaluator.service.ts                    # 保留
│   │   └── topic-classifier.service.ts                  # 保留
│   │
│   │  ─── quality/ (对标 TI services/quality/) ───
│   ├── quality/
│   │   ├── research-quality-gate.service.ts             # 保留 (对标 TI report-quality-gate.service.ts)
│   │   ├── research-fact-checker.service.ts             # 保留
│   │   ├── research-content-scorer.service.ts           # 保留
│   │   ├── research-critique.service.ts                 # 保留 (对标 TI critique-refine.service.ts)
│   │   └── defect-scanner.ts                            # 新增 (对标 TI defect-scanner.ts)
│   │
│   │  ─── report/ (对标 TI services/report/) ───
│   ├── report/
│   │   ├── report-synthesizer.service.ts                # 保留 (对标 TI report-synthesis.service.ts)
│   │   ├── report-assembler.service.ts                  # 新增 (对标 TI report-assembler.service.ts)
│   │   ├── citation-formatting.utils.service.ts                # 新增 (对标 TI citation-formatting.utils.service.ts)
│   │   └── research-export.service.ts                   # 保留 (对标 TI research-export.service.ts)
│   │
│   │  ─── monitoring/ (对标 TI services/monitoring/) ───
│   └── monitoring/
│       ├── agent-activity.service.ts                    # 新增 (对标 TI agent-activity.service.ts)
│       ├── research-checkpoint.service.ts               # 新增 (对标 TI research-checkpoint.service.ts)
│       └── research-mission-health.service.ts           # 新增 (对标 TI research-mission-health.service.ts)
│
│  ─── Skills (对标 TI 的 skill 文件放在模块根) ───
├── skills/
│   ├── (已有 22 个 .skill.md)
│   ├── insight-extraction.skill.md                      # 新增
│   ├── idea-derivation.skill.md                         # 新增
│   ├── steer-deepen.skill.md                            # 新增
│   ├── steer-pivot.skill.md                             # 新增
│   ├── steer-inject.skill.md                            # 新增
│   ├── prototype-interactive.skill.md                   # 新增
│   ├── prototype-architecture.skill.md                  # 新增
│   ├── prototype-dashboard.skill.md                     # 新增
│   ├── prototype-comparison.skill.md                    # 新增
│   ├── prototype-journey.skill.md                       # 新增
│   ├── prototype-canvas.skill.md                        # 新增
│   ├── cross-project-retrieval.skill.md                 # 新增
│   └── exit-decision.skill.md                           # 新增
│
│  ─── 配置 (对标 TI config/) ───
├── config/
│   ├── research.config.ts                               # 保留
│   ├── valid-skills.config.ts                           # 更新: 新增 13 个 skills
│   ├── tool-strategy.config.ts                          # 保留
│   ├── agent-roles.config.ts                            # 新增 (对标 TI config/agent-roles.config.ts)
│   ├── research-mission-transitions.ts                  # 新增 (状态机, TI 用 inline 常量)
│   ├── data-source-mapping.config.ts                    # 新增 (对标 TI config/data-source-mapping.config.ts)
│   └── health-monitoring.config.ts                      # 新增 (对标 TI config/health-monitoring.config.ts)
│
│  ─── 类型定义 (与 TI 一致: types/ 独立目录, 18+ 文件) ───
├── types/
│   ├── research.types.ts                                # 从各 service 迁出聚合
│   ├── mission.types.ts                                 # 新增 (对标 TI types/mission.types.ts)
│   ├── leader.types.ts                                  # 新增 (对标 TI types/leader.types.ts)
│   ├── discussion.types.ts                              # 从 discussion/ 迁出
│   ├── iteration.types.ts                               # 从 iteration/ 迁出
│   ├── steering.types.ts                                # 新增 (协同驾驶类型)
│   ├── report.types.ts                                  # 新增 (对标 TI types/report.types.ts)
│   ├── quality.types.ts                                 # 新增 (对标 TI types/quality.types.ts)
│   ├── collaboration.types.ts                           # 新增 (对标 TI types/collaboration.types.ts)
│   ├── monitoring.types.ts                              # 新增 (对标 TI types/monitoring.types.ts)
│   └── research.exceptions.ts                           # 新增 (对标 TI types/research.exceptions.ts)
│
│  ─── 工具函数 (与 TI 一致: utils/ 独立目录) ───
├── utils/
│   ├── extract-json.utils.ts                            # 保留 (对标 TI utils/extract-json.utils.ts)
│   ├── prompt-sanitizer.ts                              # 新增 (对标 TI utils/prompt-sanitizer.ts)
│   └── model-display-name.ts                            # 新增 (对标 TI utils/model-display-name.ts)
│
│  ─── Workflow (与 TI 一致: workflows/ 独立目录) ───
├── workflows/
│   └── iterative-research-pipeline.workflow.ts          # 新增 (对标 TI workflows/refresh-pipeline.workflow.ts)
│
│  ─── 策略 (保留) ───
└── strategies/
    └── research-strategies.md                           # 保留
```

#### TI vs Research 目录对齐表

| TI 目录                               | Research 对应                           | 说明                                      |
| ------------------------------------- | --------------------------------------- | ----------------------------------------- |
| `topic-insights.module.ts`            | `research.module.ts`                    | 1:1                                       |
| `topic-insights.service.ts`           | `research.service.ts`                   | 1:1 薄门面                                |
| `topic-insights.gateway.ts`           | `research.gateway.ts`                   | 1:1 WebSocket                             |
| `agents/`                             | `agents/`                               | 1:1                                       |
| `teams/`                              | `teams/`                                | 1:1                                       |
| `controllers/` (6个)                  | `controllers/` (5个)                    | TI 有 todo + collab, Research 有 steering |
| `dto/` (14个)                         | `dto/` (7个)                            | Research 更精简                           |
| `guards/`                             | `guards/`                               | 1:1                                       |
| `handlers/` (5个)                     | `handlers/` (5个)                       | 1:1                                       |
| `prompts/` (6个)                      | `prompts/` (5个)                        | 1:1                                       |
| `services/core/leader/` (4个)         | `services/core/leader/` (4个)           | 1:1                                       |
| `services/core/mission/` (5个)        | `services/core/mission/` (5个)          | 1:1                                       |
| `services/core/research/` (6个)       | `services/core/research/` (6个)         | 1:1                                       |
| `services/core/task-executors/` (4+1) | `services/core/task-executors/` (7+1+1) | Research 更多 executor                    |
| `services/core/topic/` (5个)          | `services/core/project/` (3个)          | 语义重命名                                |
| `services/collaboration/` (5个)       | `services/collaboration/` (3个)         | Research 更精简                           |
| `services/data/` (11个+connectors)    | `services/data/` (4个)                  | Research 用 ToolRegistry 替代 connectors  |
| `services/dimension/` (7个)           | `services/discussion/` (2个)            | Research 独有: 多 Agent 讨论              |
| —                                     | `services/iteration/` (3个)             | Research 独有: 迭代循环                   |
| —                                     | `services/evaluation/` (3个)            | Research 独有: 迭代评估                   |
| `services/monitoring/` (4个)          | `services/monitoring/` (3个)            | 1:1                                       |
| `services/quality/` (4个)             | `services/quality/` (5个)               | 1:1                                       |
| `services/report/` (13个)             | `services/report/` (4个)                | Research 更精简                           |
| `services/search/` (3子目录)          | `services/search/` (3子目录)            | 1:1 结构                                  |
| `types/` (18个)                       | `types/` (11个)                         | Research 少一些                           |
| `utils/` (6个)                        | `utils/` (3个)                          | Research 更精简                           |
| `workflows/` (2个)                    | `workflows/` (1个)                      | 1:1                                       |
| `config/` (5个)                       | `config/` (7个)                         | Research 多 transitions 和 tool-strategy  |

### 18.10 前后端对接变更汇总

| 领域            | 当前                          | 重构后                            | 前端影响                         |
| --------------- | ----------------------------- | --------------------------------- | -------------------------------- |
| **实时通信**    | SSE only                      | SSE + WebSocket                   | 新增 `useResearchWebSocket` hook |
| **任务追踪**    | 无                            | ResearchTodo + TODO 事件          | 新增 TODO 列表组件               |
| **研究干预**    | 无                            | `POST /steer` + WebSocket ack     | 新增干预按钮 + SteeringPanel     |
| **Leader 对话** | 无                            | `POST /leader-chat` + WebSocket   | 新增 QuickCommandBar             |
| **观点发现**    | 事后批量 extract              | 实时 `insight.discovered` WS 事件 | LiveDiscovery 实时渲染           |
| **进度追踪**    | SSE phase 事件                | WS mission/task/todo 事件         | ResearchProgressBar 升级         |
| **状态管理**    | useDiscussionResearch (local) | Zustand store (全局)              | 新建 researchStudioStore         |

### 18.11 前端状态管理重构

参考 TI 的 `topicInsightsStore.ts` (1361 行) 模式，新建 `researchStudioStore.ts`：

```typescript
// 新增: frontend/stores/researchStudioStore.ts
interface ResearchStudioState {
  // === 研究阶段 ===
  phase: "launch" | "explore" | "distill" | "deliver";

  // === Mission (学 TI) ===
  currentMission: ResearchMission | null;
  missionStatus: MissionStatus | null;
  teamInfo: TeamInfo | null;

  // === TODO (学 TI) ===
  todos: ResearchTodo[];
  todosSummary: TodoSummary | null;

  // === 讨论 (保留 Research 独有) ===
  discussionMessages: DiscussionMessage[];
  typingAgent: string | null;

  // === 产出物 ===
  insights: ResearchIdea[]; // type=INSIGHT
  ideas: ResearchIdea[]; // type=CREATIVE_IDEA
  demos: ResearchDemo[];
  evolutionLinks: EvolutionLink[];

  // === 迭代 ===
  currentRound: number;
  rounds: RoundSummary[];

  // === UI ===
  sidebarCollapsed: boolean;
  shelfExpanded: boolean;
  selectedRoundFilter: number | "all";

  // === Actions (学 TI polling 模式) ===
  startLeaderPlan: (
    projectId: string,
    query: string,
    mode: string,
  ) => Promise<void>;
  approveMissionPlan: (sessionId: string) => Promise<void>;
  sendLeaderInstruction: (projectId: string, message: string) => Promise<void>;
  steerResearch: (
    projectId: string,
    steerRequest: SteerRequest,
  ) => Promise<void>;
  startMissionPolling: (projectId: string) => void;
  stopMissionPolling: () => void;
  fetchTodos: (sessionId: string) => Promise<void>;
}
```

### 18.12 实施优先级（与前端 Phase 对齐）

| Phase  | 后端重构内容                                                         | 前端需求对应                   |
| ------ | -------------------------------------------------------------------- | ------------------------------ |
| **P0** | WebSocket Gateway + 基础 Mission Lifecycle                           | 左侧栏 Agent 拓扑 + TODO 列表  |
| **P1** | InsightExtractionExecutor + `insight.discovered` 事件 + Steering API | EXPLORE 双栏 + 实时发现 + 干预 |
| **P2** | IdeaDerivationExecutor + `idea.derived` 事件                         | DISTILL 三列演化板             |
| **P3** | TODO 系统 + Mission DAG 调度                                         | 成果架 + 迭代循环              |
| **P4** | ReportSynthesisExecutor (内嵌 entities)                              | DELIVER 报告 + LAUNCH          |
| **P5** | PrototypeGenerationExecutor (6 种类型) + skills                      | 多类型原型                     |
| **P6** | (纯前端 Canvas View)                                                 | Canvas 画布                    |
| **P7** | cross-project-retrieval skill + Library 集成                         | 跨项目知识复用                 |

---

## 十九、Skill 化架构总览

### 19.1 现有 Skills 盘点

```
已有 (31 个, 含 TI 共享):
├── Planning: research-planning, research-direction-planning
├── Analysis: critical-thinking, data-interpretation, synthesis,
│             comparison, cause-effect, trend-analysis, deep-dive
├── Validation: fact-check, consistency-check, claim-extraction,
│               fact-verification, cross-reference-validation,
│               source-credibility
├── Writing: report-synthesis, evidence-summarization,
│            executive-summary-writing, content-critique,
│            section-depth-evaluation
└── Research: gap-analysis, research-conclusion

新增 (13 个):
├── Steering: steer-deepen, steer-pivot, steer-inject
├── Real-time: insight-extraction, idea-derivation
├── Prototype: prototype-interactive, prototype-architecture,
│              prototype-dashboard, prototype-comparison,
│              prototype-journey, prototype-canvas
└── Knowledge: cross-project-retrieval, exit-decision
```

### 19.2 Skill 调用链路

```
用户操作                    → Controller    → Leader         → Executor          → Skill
────────────                  ──────────      ──────           ────────            ─────
"开始研究"                 → startResearch → planResearch   → —                 → research-planning
研究进行中                  → —             → —             → DiscussionExec    → deep-dive, synthesis
Agent 发言后                → —             → —             → InsightExtExec    → insight-extraction
用户点"深入"               → POST /steer   → deepen()      → SearchExecutor    → steer-deepen
用户点"衍生创意"           → POST /derive  → —             → IdeaDerivExec     → idea-derivation
用户选"生成架构图"         → POST /demo    → —             → PrototypeExec     → prototype-architecture
轮次结束评估               → —             → reviewQuality → QualityReviewExec → exit-decision
新研究启动                  → startResearch → planResearch  → —                 → cross-project-retrieval
```

### 19.3 Skill vs 硬编码逻辑迁移

| 当前硬编码位置                                         | 迁移到 Skill                                 | 好处                                 |
| ------------------------------------------------------ | -------------------------------------------- | ------------------------------------ |
| `DiscussionAgentService` 中的 Agent prompt             | 保留 (讨论是 Research 核心, 不适合 skill 化) | —                                    |
| `ResearchIdeaService.extract()` 中的提取 prompt        | `insight-extraction.skill.md`                | 可版本管理, 可跨模块复用             |
| `ResearchDemoService.generate()` 中的 HTML 生成 prompt | `prototype-interactive.skill.md`             | 可扩展为 6 种类型                    |
| `ExitDecisionService.decide()` 中的启发式规则          | `exit-decision.skill.md`                     | 可被 LLM 增强, 更智能的退出判断      |
| `IterationCoordinatorService` 中的 followup query 构建 | `steer-deepen.skill.md`                      | 统一干预逻辑, 用户干预和自动深入共用 |

### 19.4 不应 Skill 化的部分

| 保持硬编码        | 原因                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| 多 Agent 讨论逻辑 | Research 核心差异化，讨论的轮次控制、Agent 选择、对话历史管理是编排逻辑不是知识 |
| 状态机转换规则    | 业务流程，不是 AI 能力                                                          |
| 任务 DAG 调度     | 基础设施逻辑，不适合 LLM                                                        |
| 质量门阈值        | 配置值，放 `research.config.ts`                                                 |
| 工具路由策略      | 规则引擎 (`tool-strategy.config.ts`)，不需要 LLM                                |
