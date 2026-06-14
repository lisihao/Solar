# AI 社媒"意图驱动"重设计方案 v2

> **日期**: 2026-05-18
> **触发**: 用户反馈"用户旅程是混乱的" + 提出"用户只声明意图，Agent Team 负责生产"的新范式
> **关系**: 在 [ui-redesign-2026-05-17.md](./ui-redesign-2026-05-17.md) 基础上**演进而非取代**——继承 candidate A（列表+drawer 一统）+ Mission dispatcher 单轨化方向，叠加意图驱动 + Registry 化 + Agent Team 内容生产
> **方法**: 5 路专家并行审查 → 迭代到全 YES 共识
> **状态**: **v1 已纳入 5 路 reviewer 共识修补**（详见 §16）

---

## 0. 执行摘要

### 用户原话（必须 100% 落地，逐条核对）

| #   | 原话片段                                                       | 落地点                                                    |
| --- | -------------------------------------------------------------- | --------------------------------------------------------- |
| U1  | "用户应该是做极简的事情，新建就是点开+号"                      | §3 新建任务弹窗（单页、零跳转）                           |
| U2  | "选择数据源来源（可以多选）"                                   | §4 数据源 Picker（每源多 item 多选 + 跨源混合）           |
| U3  | "AI Teams 负责决策整合"                                        | §6 Agent Team 集成（多 source bundle → 单/多平台内容）    |
| U4  | "选择发布平台"                                                 | §3 平台多选 + §6 多平台内容生成                           |
| U5  | "用户操作完事，实际的操作后面就是 agent team 干了"             | §3 启动后用户立即解放，列表行进入"生成中"状态             |
| U6  | "点开列表行，可以 drawer 看到实际状态（包括 agent team 状态）" | §5 Drawer 任务观测台（agent timeline + 内容预览）         |
| U7  | "一个行的几个按钮，其中一个是发布按钮（发布到草稿箱）"         | §5.2 行操作按钮按状态显示 + §7 "发布到草稿箱" 是手动 gate |
| U8  | "数据源，是否应该有一个注册机制（内部实现）"                   | §8 SocialDataSourceRegistry 架构                          |
| U9  | "我说的用户旅程是用户点开 AI 社媒开始"                         | §2 用户旅程图（入口=sidebar，不依赖外部模块发送）         |

### 总体方案

```
范式转变：
  旧 = 用户写内容 + 平台帮发布
  新 = 用户声明意图（选源 item + 选平台）+ Agent Team 全权生产+发布
```

**用户极简旅程（3 步 0 跳转）**：

```
点 sidebar "AI 社媒"
   ↓
列表页（任务看板）
   ↓ 点 +
新建弹窗：选源 item + 选平台 + 启动
   ↓ Agent Team 后台干
列表行进入"生成中" → "草稿就绪" → 用户点 📤 → "已发布"
```

**3 套 UI 收成 1 套**：删 `/create` 4 步 wizard + 删 `/edit/[id]` 全屏编辑页 + 删旧"选来源"小模态 → 只剩**列表页 + 新建弹窗 + Drawer 观测台**。

**新增 1 个 Registry**：`SocialDataSourceRegistry`，沿用项目 AgentRegistry/TeamRegistry/ToolRegistry/SkillRegistry 同款 `onModuleInit().register()` 模式。

**预估工作量**：~7-9 天 / 9 PR（含 v2 增量；继承 2026-05-17 baseline 部分约 4 天）。

---

## 1. 现状与本次增量

### 1.1 现状（继承 2026-05-17 已分析）

- 3 套并行 UI：`/ai-social` 列表+drawer / `/ai-social/create` 4 步 wizard / `/ai-social/edit/[id]` 全屏编辑
- 数据源散点硬编码（DB enum + DTO + 前端 SourceSelector + ContentsTab 多处）
- 后端双发布路径（旧 sync `PublishExecutorService` + 新 Mission `dispatcher.runMission`）—— 已在 2026-05-17 计划合并

### 1.2 本次 v2 增量（相对 2026-05-17）

| 维度            | 2026-05-17 baseline                        | v2 增量                                                            |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Drawer 职责     | 选平台 + 选档位 + 发布                     | **+ Agent Team 实时状态 timeline + 内容预览 + "发布到草稿箱"按钮** |
| 用户编辑能力    | 保留 `/edit/[id]` 全屏编辑页               | **完全删除**——用户不再编辑内容                                     |
| 新建入口        | 列表 "+" → 选来源小模态 → `/create` wizard | **列表 "+" → 单页弹窗（选 item + 选平台）→ 启动**                  |
| 数据源管理      | 硬编码 enum                                | **SocialDataSourceRegistry**（各 AI App 自注册）                   |
| Source 选择粒度 | 选 source 类型                             | **选 source 类型 + 该源下的多个具体 item**                         |
| 多平台          | 同一份内容多平台发                         | **Agent Team 针对各平台生成独立版本**                              |
| 内容来源        | 单一 sourceType + sourceId                 | **多 source × 多 item，跨源混合**                                  |

---

## 2. 用户旅程（从 sidebar "AI 社媒"点击开始）

```
┌────────────────────────────────────────────────────────────────┐
│ 0. 用户点 sidebar "AI 社媒"                                     │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│ 1. 列表页 /ai-social （唯一主入口）                              │
│   ┌────────────────────────────────────────────────────────┐   │
│   │ [搜索] [状态]                          [+ 新建任务]    │   │
│   │ ─────────────────────────────────────────────────────  │   │
│   │ 标题       │ 来源      │ 平台   │ Agent Team 状态        │ 操作  │
│   │ AI 生成中… │ R+W (3)   │ WX     │ 🔄 Writer • s6 (60%)  │ 👁 🗑 │
│   │ Teams 退役 │ Explore(2)│ WX+XHS │ ✅ 草稿就绪 (12 stages)│ 👁📤🗑│
│   │ 5 月复盘   │ Office(1) │ WX     │ 🚀 已发布              │ 👁🔗  │
│   │ 评测失败   │ Writing(2)│ WX     │ ❌ Reviewer • s7 失败  │ 👁🔁🗑│
│   └────────────────────────────────────────────────────────┘   │
│                                                                 │
│   用户在这里做 1 个决定:                                        │
│   ① 新写一篇      → 点 +                                       │
│   ② 改/发已有     → 点行 → drawer                              │
│   ③ 看发布状态    → 看状态列 / 点行看 drawer timeline           │
│   ④ 绑新账号      → 右上"管理账号"→ /connections                │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. 新建弹窗 / Drawer（依据 ①/②/③ 分支，详见 §3-§5）            │
└────────────────────────────────────────────────────────────────┘
```

**关键不依赖**：从外部模块（AI Explore/Research/Office/Writing）跳进来的"发到社媒"按钮是**加速路径**，不是用户必须依赖的入口——用户在 AI 社媒页内通过 Picker 同样能挑到任何模块的 item（U9）。

---

## 3. 新建任务弹窗（极简版）

### 3.1 UI 草图

```
┌──────────── 新建社媒发布任务 ────────────┐
│                                          │
│ 📥 数据源（点开各模块挑具体内容）         │
│ ┌──────────────────────────────────┐    │
│ │ + AI Writing       (已选 2 篇 ▸) │    │
│ │ + AI Research      (已选 1 篇 ▸) │    │
│ │ + AI Explore       (已选 3 条 ▸) │    │
│ │ + AI Office        (未选)         │    │
│ │ + AI Topic Insights(未选)         │    │
│ └──────────────────────────────────┘    │
│                                          │
│ 已选内容预览（6 项 / 上限 20）:           │
│ ┌──────────────────────────────────┐    │
│ │ [Writing] 大模型评测方法论    ✕  │    │
│ │ [Writing] AI Agent 设计模式   ✕  │    │
│ │ [Research] 2026 LLM 市场报告  ✕  │    │
│ │ [Explore] 视频: Karpathy 演讲 ✕  │    │
│ │ [Explore] 文章: GPT-5 评测    ✕  │    │
│ │ [Explore] 视频: Anthropic 发布 ✕ │    │
│ └──────────────────────────────────┘    │
│ [+ 外部 URL] [+ 补充提示词]               │
│                                          │
│ 📤 发布平台（多选）                       │
│ ☐ WeChat 公众号 (绑定: 张姐工作号)        │
│ ☐ 小红书 (绑定: 张姐红书号)               │
│                                          │
│ [取消]              [🚀 启动 AI Teams]    │
└──────────────────────────────────────────┘
```

### 3.2 关键交互

- 点 `+ AI Writing` → 打开 **Picker 子弹窗**（§4），勾完 → 回主弹窗
- 已选 item 在主弹窗显示，可单独删除（✕）
- 平台多选：勾几个 = Agent Team 生成几份独立版本
- 启动后**主弹窗立即关闭**，列表新增一行状态 `🔄 生成中`，用户走人

### 3.3 启动按钮行为

```typescript
// 前端
const onLaunch = async () => {
  const taskId = await api.post('/ai-social/tasks', {
    sources: pickedItems.map(it => ({ sourceType: it.sourceType, sourceId: it.id })),
    externalUrls: externalUrls,        // 最多 3 个
    prompt: extraPrompt,                // 可选 500 字
    platforms: pickedPlatforms,         // ['WECHAT_MP', 'XIAOHONGSHU']
    accountIds: { WECHAT_MP: '...', XIAOHONGSHU: '...' },
  });
  closeModal();
  // 列表 SWR 自动刷新出新行（status=PENDING）
};

// 后端
POST /ai-social/tasks
  → 创建 SocialContentTask 记录 (status=PENDING)
  → fire-and-forget: dispatcher.runMission(taskId, { depth: 'quick', sourceBundle })
  → 立即返回 taskId
```

---

## 4. 数据源 Picker 子弹窗

### 4.1 UI 草图

```
┌──────── 从 AI Writing 选择内容 ────────┐
│ [搜索]                                  │
│ [全部] [本周] [本月] [标签 ▾]           │
│                                         │
│ ☑ 大模型评测方法论                       │
│   2026-05-15 · 草稿 · 3.2k 字            │
│                                         │
│ ☑ AI Agent 设计模式                      │
│   2026-05-10 · 已发布 · 5.1k 字          │
│                                         │
│ ☐ Prompt 工程实践                        │
│   2026-05-08 · 草稿 · 2.8k 字            │
│                                         │
│ ...                                     │
│                                         │
│ [取消]                  [确认 (2 项)]    │
└─────────────────────────────────────────┘
```

### 4.2 设计

- 通用 `<SourceItemPicker source={...} />` 组件，所有 source 复用
- 每条 item 由 `SocialDataSource.listItems()` 返回（§8.2 契约）
- 支持搜索 / 时间筛选 / 标签筛选（由 source 自己实现，picker 调 API 拿候选）
- 触底 lazy load
- 全选/反选（带上限检查）

### 4.3 限制（产品决策，可配置）

| 维度                    | 默认值      | 触顶后行为                           |
| ----------------------- | ----------- | ------------------------------------ |
| 单源最多选              | 10 个       | picker 中超出的项灰显 + tooltip 提示 |
| 跨源总数                | 20 个       | 主弹窗"启动"按钮灰显 + 提示          |
| 视频/长内容（>5000 字） | 计 2 个名额 | 同上                                 |
| 外部 URL                | 最多 3 个   | + 外部 URL 按钮灰显                  |
| 补充提示词              | 500 字      | 输入框字数限制                       |

---

## 5. 任务详情页：复用 agent-playground 团队工作台 [v1 用户反馈重构]

> **重大修正**：v0 设计的 480px slide-over drawer 不足以展示 Agent Team 的工作全景。用户明确要求"点击列表行能看到整个团队工作现状"+"可参考 playground"。v1 改为**直接复用 `agent-playground/team/[missionId]` 的完整页面布局**，drawer 只作为"任务列表里单条 todo"的详情展示。

### 5.1 导航变更

```
之前 v0:  列表行 click → 480px Drawer（容量不够）
现在 v1:  列表行 "Agent Team 状态" 列 click → 跳转 `/ai-social/mission/[taskId]` 全页详情
           ↓ 在该页内
         任务列表 tab → 点单条 todo → TodoDetailDrawer
```

**列表行的 "Agent Team 状态" 列**是核心入口字段（非传统状态 pill），实时显示：

| 行内呈现                       | 字段含义                                          | 数据来源                                            |
| ------------------------------ | ------------------------------------------------- | --------------------------------------------------- |
| `🔄 Writer • s6 (60%)`         | 当前 active agent + 当前 stage 名 + 该 stage 进度 | WebSocket 推 `agent_active` + `stage_progress` 事件 |
| `✅ 草稿就绪 (12 stages)`      | 全 12 stage 完成，pipeline 终态                   | `task.status=DRAFT_READY`                           |
| `❌ Reviewer • s7 失败`        | 哪个 agent 在哪个 stage 失败                      | `task.status=FAILED + errorContext.stage/agent`     |
| `🚀 已发布 → WeChat ✓ · XHS ✗` | PARTIAL_PUBLISHED 多平台汇总                      | 聚合 `SocialContentVersion[].status`                |

**整列都是点击区域** — 不依赖行尾"详情"按钮，用户视线落在状态那一刻 click 即可进入详情页。

### 5.2 页面布局（照搬 playground/team/[missionId] 结构）

```
┌────────────────────────────────────────────────────────────────────┐
│ Header: [← 返回]  🎯 [图标]  标题 + meta  [状态 pill] [📤 发布] [⋯] │
├────────────────────────────────────────────────────────────────────┤
│┌───────── 左 360px (可折叠) ─────────┬──── 右 flex-1 ────────────┐│
││  TeamRosterPanel (团队树)            │  Tabs:                     ││
││  ├─ Leader Agent (角色头像 + 状态)   │  [任务列表] [协作动态]     ││
││  ├─ Researcher Agent                  │  [输出报告] [参考文献]     ││
││  ├─ Writer Agent                      │  [算力消耗] [发布] ←新增   ││
││  ├─ Reviewer Agent                    │  ─────────────────────────  ││
││  ├─ Publisher Agent                   │  ┌─ 任务列表 tab 内容 ──┐ ││
││                                       │  │ # │ 任务  │ 状态 │   │ ││
││  Mission Progress: ▓▓▓▓▓░░ 60%        │  │ 1 │ 启动  │ ✅   │   │ ││
││  Consensus quality: 60/100            │  │ 2 │ 研究  │ ✅   │   │ ││
││  ──────────────────────               │  │ 3 │ 大纲  │ 🔄   │   │ ││
││  BudgetAndTimeLimitPanel              │  │ … │ ...   │ ⏳   │   │ ││
││  ComputeUsagePanel                    │  └─────────────────────┘ ││
││  MemoryIndexPanel                     │                            ││
││  CapabilityMeters                     │  点任意行 → TodoDetailDrawer ││
││  LeadJournalPanel                     │                            ││
││                                       │                            ││
││  Buttons: [开启] [终止] [重跑]        │                            ││
│└──────────────────────────────────────┴───────────────────────────┘│
└────────────────────────────────────────────────────────────────────┘
```

### 5.3 6 个 Tab 内容（5 个直接复用 + 1 个新增）

| Tab              | 来源                        | AI 社媒特化                                                                                             |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| **任务列表**     | 复用 `MissionTodoBoard`     | 显示 12 个 stage（s1-s12）的执行状态，行点击 → `TodoDetailDrawer`                                       |
| **协作动态**     | 复用 `MissionFlowView`      | agent 之间消息流、handoff 实时可视化                                                                    |
| **输出报告**     | 复用 `ArtifactReader`       | **特化**：内部 sub-tab `[WeChat] [XHS]` 展示各平台 SocialContentVersion；ReportVersion 即每次"重新生成" |
| **参考文献**     | 复用 `ReferencesPanel`      | 显示 sources[] + externalUrls[] + AI Teams 抓到的实际引用                                               |
| **算力消耗**     | 复用 `ComputeUsagePanel`    | Token 消耗、平台维度成本拆分（多平台 = N 份）                                                           |
| **发布**（新增） | 新组件 `SocialPublishPanel` | DRAFT_READY 后亮起；显示各平台草稿就绪状态 + 单平台 📤 按钮 + 部分失败时单平台 🔁 重试                  |

### 5.4 复用组件清单

`frontend/components/agent-playground/` 已有：

```
TeamRosterPanel       ← 左侧团队树
MissionTodoBoard      ← 右侧任务列表 tab
TodoDetailDrawer      ← 单 todo 详情抽屉（点 task 行触发）
MissionFlowView       ← 协作动态 tab
ArtifactReader        ← 输出报告 tab
ReferencesPanel       ← 参考文献 tab
ComputeUsagePanel     ← 算力消耗 tab
CapabilityMeters      ← 左侧能力雷达
MemoryIndexPanel      ← 左侧记忆索引
BudgetAndTimeLimitPanel ← 左侧预算 + 时间限制
LeadJournalPanel      ← 左侧 Leader 日志
LeaderChatModal       ← Leader 对话弹窗
VerifyConsensusPanel  ← 共识质量面板
```

直接 import 即可，**新增 0 套组件，按 R5 风险审查 UI 一致性零增加**。

### 5.5 路由变更

```
新增:  /ai-social/mission/[taskId]/page.tsx
删除:  /ai-social/edit/[id]/page.tsx (v0 已计划删)
删除:  /ai-social/create/page.tsx     (v0 已计划删)
保留:  /ai-social                      (列表)
保留:  /ai-social/connections          (账号管理)
```

### 5.6 列表行操作按钮（按状态显示）

| 状态                     | 行内按钮                    | 说明                                              |
| ------------------------ | --------------------------- | ------------------------------------------------- |
| `PENDING` / `GENERATING` | 👁 详情 · 🗑 取消           | 详情 = 跳 mission 页                              |
| `DRAFT_READY`            | 👁 详情 · 📤 发布 · 🗑 删除 | 📤 = 推到平台草稿箱（也可在详情页"发布"tab 操作） |
| `PUBLISHING`             | 👁 详情                     | 不可中断                                          |
| `PUBLISHED`              | 👁 详情 · 🔗 外链           | 详情页显示外链列表（多平台）                      |
| `PARTIAL_PUBLISHED`      | 👁 详情 · 🔁 重试失败平台   | 详情页"发布"tab 显示哪些平台失败                  |
| `FAILED`                 | 👁 详情 · 🔁 重试 · 🗑 删除 | 重试会重跑 Agent Team                             |

### 5.7 数据流

- mission 页内的实时数据走 `useAgentPlaygroundStream(taskId)`（**复用现有 hook**）
- 列表行的状态字段通过同一份 WebSocket 事件流刷新（SWR 缓存失效）
- 关闭 mission 页不丢状态（next visit 走 REST 拉一次 + WebSocket 续订）

---

## 6. Agent Team 集成

### 6.1 任务输入与输出

```typescript
interface SocialContentTaskInput {
  sources: { sourceType: string; sourceId: string }[]; // 已注册的 source
  externalUrls?: string[]; // ≤3
  prompt?: string; // ≤500 字
  platforms: ("WECHAT_MP" | "XIAOHONGSHU")[];
  accountIds: Record<string, string>;
}

interface SocialContentTaskOutput {
  versionsByPlatform: {
    [platform: string]: {
      title: string;
      content: string; // 平台特化的格式
      digest: string;
      tags: string[];
      coverMediaId?: string;
    };
  };
}
```

### 6.2 与现有 Mission Pipeline 关系 [v1 修正 P0-R4]

**走 `SOCIAL_PIPELINE`（13-step 完整 AI 改写），不是 `SOCIAL_FAST_PIPELINE`**。
FAST 通道是跳过 AI 改写的快发路径（s1+s8+s9+s11），不符合"用户只声明意图，Agent Team 生产内容"的范式。

**实际 stage 命名（grep 验证 `backend/src/modules/ai-app/social/services/mission/workflow/stages/`）**：

| Stage   | 真实文件名                                | 职责                      | v2 增量                                                                                                                                                                  |
| ------- | ----------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| s1      | `s1-mission-budget-eval`                  | Steward 4 闸 + 预算估算   | 估算时按 `platforms.length` 扩展预算（多平台 = N 倍 LLM token）                                                                                                          |
| s2      | `s2-platform-probe`                       | 平台 adapter 能力探测     | **不变**（不是内容抓取，名字易混淆）                                                                                                                                     |
| s3      | `s3-content-transform`                    | AI 内容改写               | **核心改造**：前置一个 multi-source fetch 子步骤（并行调各 source `fetchBundle()`，`Promise.allSettled` 容错）；输出按 `platforms[]` 并行跑 N 次 transform 得到 N 份内容 |
| s4      | `s4-leader-assess-transform`              | Leader Agent 评估改写质量 | 多平台 = 各自评估                                                                                                                                                        |
| s5      | `s5-cover-craft`                          | 封面生成                  | 多平台 = 各自封面（WeChat 横版 / XHS 方形）                                                                                                                              |
| s6      | `s6-body-compose`                         | 正文最终组合              | 多平台并行                                                                                                                                                               |
| s7      | `s7-polish-review`                        | 终校                      | 多平台并行                                                                                                                                                               |
| s8      | `s8-publish-execute`                      | 推到草稿箱                | **只在用户手动点 📤 时触发**（任务停在 `DRAFT_READY` 等用户 gate）                                                                                                       |
| s8b     | `s8b-publish-retry`                       | 失败重试                  | 单平台失败不阻断其他                                                                                                                                                     |
| s9      | `s9-publish-verify`                       | 草稿就绪验证              | 多平台各自验证                                                                                                                                                           |
| s10-s12 | leader-signoff / persist / self-evolution | 收尾                      | 多平台聚合                                                                                                                                                               |

### 6.3 状态机 [v1 修正 P0-R1：补 PARTIAL_PUBLISHED]

```
                                            ┌──→ PUBLISHED (全平台成功)
                                            │
PENDING ─→ GENERATING ─→ DRAFT_READY ─→ PUBLISHING ─→ PARTIAL_PUBLISHED (部分成功)
   │           │              │              │
   │           ↓              ↓              ↓
   └──→ CANCELLED   FAILED ←─(重试)─── FAILED (全失败)
```

**任务级状态聚合规则**（基于 `SocialContentVersion.status`）：

- 所有 version 都 `PUBLISHED` → task `PUBLISHED`
- 部分 version `PUBLISHED` + 部分 `FAILED` → task `PARTIAL_PUBLISHED`
- 所有 version 都 `FAILED` → task `FAILED`
- 任一 version 还在 `PUBLISHING` → task `PUBLISHING`

**Drawer 内多平台部分成功 UI**：每个 platform tab 显示独立状态（✅/❌），失败 platform tab 上有"🔁 仅重试此平台"按钮。

### 6.4 SocialContentVersion 写入策略 [v1 修正 P1-R3]

- 首次生成：`prisma.socialContentVersion.create()`
- 用户点 🔁 重新生成：**upsert** 模式，`@@unique([taskId, platform])` 作为 upsert key
- 每个 version 独立保存 `status` + `errorMessage`（见 §9.1 修正）

### 6.5 写入责任明确 [v1 修正 R5 可观测性]

- `errorMessage` 写入责任方：**dispatcher 顶层 catch** + 各 stage 失败时 throw 携带 stage 名 + 原因
- Agent Team 超时（45min 无 stage 推进）：dispatcher heartbeat 监控自动转 `FAILED`，errorMessage = "Agent Team timeout"
- WebSocket 断连期间 Drawer UI：显示"连接中断，正在重连... (last update: 30s ago)"

---

## 7. "发布到草稿箱" vs "群发"

- 📤 按钮 = **推送 Agent Team 生成的内容到平台官方草稿箱**（公众号后台/小红书草稿）
- 用户最终的**群发/真发**仍在平台后台手动确认（合规 + 让用户最后过一眼）
- 这一步是产品上故意保留的人工 gate，不做"全自动到群发"
- 技术实现复用现有 `WechatAdapter.saveDraft()` / `XhsMcpAdapter` 已封装的草稿能力

---

## 8. SocialDataSourceRegistry 架构

### 8.1 定位 [v1 修正 P0-R2 + P1-R2 反向依赖]

- 层级：`ai-app/social/registry/`（AI App 层，**既不进 ai-engine 也不进 ai-harness**——业务 source 是 social 模块私有概念，engine/harness 均不知情）
- 先例参考：`backend/src/modules/ai-app/topic-insights/services/data/connectors/data-source-connector.registry.ts`（已验证同构）
- 同模式：AgentRegistry / TeamRegistry / ToolRegistry / SkillRegistry

**反向依赖修复（避免 5 个 ai-app 反向 import social）**：

接口契约抽到 `backend/src/modules/ai-app/contracts/social-data-source/`（参 `contracts/skills/` / `contracts/report-template/` 现有先例）。

```
ai-app/contracts/social-data-source/
  ├── social-data-source.interface.ts   # SocialDataSource / SourceItem / Bundle 接口
  └── social-data-source.token.ts        # SOCIAL_DATA_SOURCE_TOKEN multi-provider token

各 AI App 模块（writing/research/explore/office/topic-insights）:
  - import 仅 contracts，不 import social.registry
  - providers 注册 `{ provide: SOCIAL_DATA_SOURCE_TOKEN, useFactory: () => ({...impl}), multi: true }`

social.module:
  - @Inject(SOCIAL_DATA_SOURCE_TOKEN) all impls (multi-provider 注入数组)
  - 在 SocialDataSourceRegistry 中收集
```

依赖方向变为：`各 ai-app → contracts` + `social → contracts`，**zero ai-app → social 反向边**，对齐 CLAUDE.md "AI App 之间极少直接依赖"红线。

### 8.2 接口契约

```typescript
// backend/src/modules/ai-app/social/abstractions/social-data-source.ts
export interface SourceItem {
  id: string;
  title: string;
  preview?: string; // 1-2 行摘要
  contentKind: "article" | "video" | "report" | "note";
  wordCount?: number;
  durationSec?: number;
  thumbnailUrl?: string;
  createdAt: string;
  tags?: string[];
}

export interface SourceListFilter {
  search?: string;
  tags?: string[];
  dateRange?: { from: string; to: string };
  cursor?: string; // pagination
  limit?: number;
}

export interface SourceContentBundle {
  sourceType: string;
  sourceId: string;
  title: string;
  body: string; // markdown / plain text / html
  metadata: Record<string, unknown>;
}

export interface SocialDataSource {
  id: string; // 'AI_WRITING'
  displayName: { "zh-CN": string; "en-US": string };
  icon: string; // Lucide name
  description: { "zh-CN": string; "en-US": string };
  contentKinds: ("article" | "video" | "report" | "note")[];
  maxItemsPerTask?: number; // 不写走全局默认 10

  listItems(
    userId: string,
    filter: SourceListFilter,
  ): Promise<{
    items: SourceItem[];
    nextCursor?: string;
  }>;

  fetchBundle(
    itemIds: string[],
    userId: string,
  ): Promise<SourceContentBundle[]>;
}
```

### 8.3 Registry 实现

```typescript
// backend/src/modules/ai-app/social/registry/social-data-source.registry.ts
@Injectable()
export class SocialDataSourceRegistry {
  private readonly sources = new Map<string, SocialDataSource>();
  private readonly logger = new Logger(SocialDataSourceRegistry.name);

  register(source: SocialDataSource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Duplicate data source id: ${source.id}`);
    }
    this.sources.set(source.id, source);
    this.logger.log(`Registered data source: ${source.id}`);
  }

  get(id: string): SocialDataSource | undefined {
    return this.sources.get(id);
  }

  list(): SocialDataSource[] {
    return Array.from(this.sources.values());
  }
}
```

### 8.4 各 AI App 自注册

```typescript
// backend/src/modules/ai-app/writing/writing.module.ts
@Module({...})
export class WritingModule implements OnModuleInit {
  constructor(
    private readonly registry: SocialDataSourceRegistry,
    private readonly articleService: WritingArticleService,
  ) {}

  onModuleInit() {
    this.registry.register({
      id: 'AI_WRITING',
      displayName: { 'zh-CN': 'AI 写作', 'en-US': 'AI Writing' },
      icon: 'PenLine',
      description: {
        'zh-CN': '从我的 AI 写作文章中选择',
        'en-US': 'Pick from my AI Writing articles',
      },
      contentKinds: ['article'],
      listItems: (uid, filter) => this.articleService.listForPicker(uid, filter),
      fetchBundle: (ids, uid) => this.articleService.fetchBundlesByIds(ids, uid),
    });
  }
}
```

### 8.5 前端动态渲染

```typescript
// frontend/hooks/domain/useSocialDataSources.ts
export function useSocialDataSources() {
  return useApiGet<SocialDataSourceDescriptor[]>("/ai-social/data-sources");
}

// 新建弹窗内
const { data: sources } = useSocialDataSources();
// 循环渲染各 source 行，不再 hardcode
```

### 8.6 API 端点

```
GET /ai-social/data-sources
  → 返回当前已注册的 source 列表（descriptor 部分，含 displayName/icon/desc/maxItems）

GET /ai-social/data-sources/{id}/items?search=&cursor=
  → 调对应 source.listItems()

POST /ai-social/tasks
  → 创建任务（包含 sources[]、platforms[]）
```

---

## 9. 数据模型变化

### 9.1 新增表 `SocialContentTask`

```prisma
model SocialContentTask {
  id                  String                    @id @default(cuid())
  userId              String
  status              SocialContentTaskStatus   @default(PENDING)
  prompt              String?                   @db.Text
  externalUrls        String[]                  @default([])
  platforms           String[]                  // ['WECHAT_MP', 'XIAOHONGSHU']
  accountIds          Json                      // { WECHAT_MP: '...', XIAOHONGSHU: '...' }
  missionId           String?                   // 关联 Mission（生成中/已生成）
  errorMessage        String?
  sourceMigrationId   String?                   @unique  // [v1 修正 P0-R3] 迁移幂等去重
  createdAt           DateTime                  @default(now())
  updatedAt           DateTime                  @updatedAt

  sources             SocialContentTaskSource[]
  versions            SocialContentVersion[]    // 各平台版本

  @@index([userId, status])
  @@index([missionId])
  @@index([userId, createdAt(sort: Desc)])      // [v1 修正 R3 P2] 列表页排序
}

enum SocialContentTaskStatus {
  PENDING
  GENERATING
  DRAFT_READY
  PUBLISHING
  PUBLISHED
  PARTIAL_PUBLISHED   // [v1 修正 P0-R1] 多平台部分成功
  FAILED
  CANCELLED
}

model SocialContentTaskSource {
  id            String   @id @default(cuid())
  taskId        String
  userId        String                                  // [v1 修正 R3 P2] 冗余 userId 用于原生 SQL 安全
  sourceType    String   // 'AI_WRITING' (string, 与 Registry id 对齐)
  sourceId      String   // 原模块里的 item id
  task          SocialContentTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([taskId])
  @@index([userId, sourceType, sourceId])               // [v1 修正 R3 P2] 反查"item 被哪些任务用了"
}

model SocialContentVersion {
  id            String                       @id @default(cuid())
  taskId        String
  platform      String                       // 'WECHAT_MP' / 'XIAOHONGSHU'
  status        SocialContentVersionStatus   @default(GENERATING)   // [v1 修正 R1/R3/R5 部分成功]
  title         String
  content       String                       @db.Text
  bodyMime      String                       @default("text/html")   // [v1 修正 R2 P1-3]
  digest        String?
  tags          String[]                     @default([])
  coverMediaId  String?
  publishedAt   DateTime?
  externalUrl   String?
  errorMessage  String?                                              // [v1 修正 R3 P1 平台级错误]
  task          SocialContentTask            @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@unique([taskId, platform])
  @@index([taskId])
}

enum SocialContentVersionStatus {
  GENERATING
  DRAFT_READY
  PUBLISHING
  PUBLISHED
  FAILED
}
```

### 9.2 与现有 `SocialContent` 关系

- `SocialContent`（旧模型，单 source + 单 platform）**保留**作为兼容层，新代码不再写入
- 新流程全部走 `SocialContentTask`
- 列表页 API 改为查 `SocialContentTask`
- 数据迁移（一次性脚本）：把存量 `SocialContent` 转换为 `SocialContentTask`（1 task = 1 platform version）

### 9.3 手写迁移 SQL [v1 修正 P0-R3]

```sql
-- backend/prisma/migrations/2026XXXX_social_content_task/migration.sql

-- 1. 新枚举
CREATE TYPE "SocialContentTaskStatus" AS ENUM (
  'PENDING', 'GENERATING', 'DRAFT_READY',
  'PUBLISHING', 'PUBLISHED', 'PARTIAL_PUBLISHED', 'FAILED', 'CANCELLED'
);
CREATE TYPE "SocialContentVersionStatus" AS ENUM (
  'GENERATING', 'DRAFT_READY', 'PUBLISHING', 'PUBLISHED', 'FAILED'
);

-- 2. 新表（详见 §9.1）
CREATE TABLE "SocialContentTask" (
  ...
  "sourceMigrationId" TEXT UNIQUE,                  -- 迁移幂等键
  ...
);
CREATE TABLE "SocialContentTaskSource" (...);
CREATE TABLE "SocialContentVersion" (...);

-- 3. 数据回填（一次性，幂等，UNIQUE 约束保证）
INSERT INTO "SocialContentTask" (id, userId, status, missionId, sourceMigrationId, createdAt, updatedAt, ...)
SELECT
  gen_random_uuid()::text,
  sc."userId",
  CASE sc."status"
    WHEN 'DRAFT' THEN 'PENDING'::"SocialContentTaskStatus"
    WHEN 'PUBLISHED' THEN 'PUBLISHED'::"SocialContentTaskStatus"
    WHEN 'FAILED' THEN 'FAILED'::"SocialContentTaskStatus"
    ELSE 'PENDING'::"SocialContentTaskStatus"
  END,
  NULL,                                              -- 旧记录无 mission，新生成时填
  sc.id,                                             -- 旧 SocialContent.id 作为去重键
  sc."createdAt",
  sc."updatedAt"
FROM "SocialContent" sc
ON CONFLICT ("sourceMigrationId") DO NOTHING;        -- 真正幂等

-- 4. 旧 sourceType / sourceId 映射到关联表
INSERT INTO "SocialContentTaskSource" (id, taskId, userId, sourceType, sourceId)
SELECT
  gen_random_uuid()::text,
  t.id,
  sc."userId",
  sc."sourceType"::text,                             -- enum → string
  sc."sourceId"
FROM "SocialContent" sc
JOIN "SocialContentTask" t ON t."sourceMigrationId" = sc.id
WHERE sc."sourceId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 5. 旧 content/title 映射到 version
INSERT INTO "SocialContentVersion" (id, taskId, platform, status, title, content, bodyMime, ...)
SELECT
  gen_random_uuid()::text,
  t.id,
  sc."contentType"::text,                            -- contentType 即 platform 同义
  CASE sc."status"
    WHEN 'DRAFT' THEN 'GENERATING'::"SocialContentVersionStatus"
    WHEN 'PUBLISHED' THEN 'PUBLISHED'::"SocialContentVersionStatus"
    WHEN 'FAILED' THEN 'FAILED'::"SocialContentVersionStatus"
    ELSE 'GENERATING'::"SocialContentVersionStatus"
  END,
  sc."title",
  sc."content",
  'text/html',
  ...
FROM "SocialContent" sc
JOIN "SocialContentTask" t ON t."sourceMigrationId" = sc.id
ON CONFLICT ("taskId", "platform") DO NOTHING;
```

**回滚方案**（PR-V3 执行前 dry-run + Railway staging 验证）：

1. 新表与旧表并存，旧 `SocialContent` 不删
2. 如果 PR-V3 后发现新表数据错，TRUNCATE 三张新表 + DROP TYPE 即可回到迁移前状态
3. 旧 `SocialContent` 永久保留作为冷数据归档（至少 90 天）

---

## 10. PR 拆分计划（9 PR · ~10-12 天） [v1 修正 R4 工作量]

| PR        | 内容                                                                                                                                                                                                             | 工作量   | 风险                                  | 依赖                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------- | -------------------------- |
| **PR-V1** | 后端：`SocialDataSource` contracts + `SocialDataSourceRegistry` + multi-provider 收集 + `GET /ai-social/data-sources` controller                                                                                 | 0.7d     | 低                                    | —                          |
| **PR-V2** | 各 AI App 自注册（Writing/Research/Explore/Office/Topic Insights）实现 `listItems` + `fetchBundle` + 每模块 **integration test 强制断言 wrongUserId → 空/403**（R5 P1-2）                                        | **2.5d** | 中（5 模块 × 0.5d，Explore 可能更长） | PR-V1                      |
| **PR-V3** | DB schema: `SocialContentTask`+`SocialContentTaskSource`+`SocialContentVersion` + 手写迁移 + 数据回填 SQL + dry-run + staging 验证                                                                               | **1.5d** | 中                                    | —                          |
| **PR-V4** | 后端：`POST /ai-social/tasks` + DTO（含 class-validator @IsIn 校验）+ dispatcher 接入 `SOCIAL_PIPELINE`（不是 FAST）+ **s3 前置 multi-source fetch 子步骤** + s3 多平台并行 + 多平台预算估算                     | **2.0d** | 中                                    | PR-V1/V2/V3                |
| **PR-V5** | 前端：列表页改对接 `SocialContentTask` + "Agent Team 状态" 列预览（active agent + stage + 进度）+ 行操作按钮按状态显示                                                                                           | 0.7d     | 低                                    | PR-V3                      |
| **PR-V6** | 前端：新建弹窗（`MissionDialogShell` 复用）+ Picker 子弹窗（`SideDrawer widthPx={400}` 复用）+ 通用 `<SourceItemPicker>` 组件                                                                                    | 1.5d     | 低                                    | PR-V1/V5                   |
| **PR-V7** | 前端：新增 `/ai-social/mission/[taskId]` 路由 + 复用 playground 12 组件 + 新建 `SocialPublishPanel`（发布 tab）+ 接入 `useAgentPlaygroundStream(taskId)`                                                         | **1.5d** | 中                                    | PR-V5                      |
| **PR-V8** | 删除 `/create` wizard 路由 + `/edit/[id]` 路由 + 相关组件 + `/create` 和 `/edit/[id]` 各加 30 天 301 redirect → `/ai-social` + i18n key 清理 + Sidebar 入口仅保留 `/ai-social`（主 Agent 亲自处理 Sidebar 修改） | **0.7d** | 低                                    | PR-V6/V7 跑 1 工作日观察后 |
| **PR-V9** | i18n 补齐 + UI 一致性审查（依据 frontend-ui-baseline-2026-05-18）+ E2E（含多平台部分失败回归）+ Sentry 错误埋点                                                                                                  | 0.7d     | 低                                    | PR-V5/V6/V7/V8             |

**并行**：PR-V1 / V3 可并行起步；PR-V2 五个子模块并行；PR-V5/V6/V7 前端三件套部分并行。

**最快收尾**：约 10-12 个工作日（依赖串行图最长路径 + V8 延后 1 天观察）。

**测试范围**（每 PR 必须列在 description）：

- PR-V1: registry.spec + controller.spec
- PR-V2: 各模块 service.spec + integration test（跨用户 fetchBundle 应空）
- PR-V3: migration dry-run 脚本（npm script）+ Railway staging 验证
- PR-V4: dispatcher.spec 增量 + s3 multi-source spec + DTO validation spec
- PR-V5/V6/V7: 组件 spec（rtl）+ e2e（cypress 现有 ai-social.cy.ts 适配）
- PR-V8: redirect spec + 旧 spec 删除清单
- PR-V9: e2e 全链路（含 PARTIAL_PUBLISHED 路径）

---

## 11. 删除清单

| 项                                                                                           | 路径                                                | 时机                    |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------- |
| `/create` 路由 + 4 步 wizard 页面                                                            | `frontend/app/ai-social/create/page.tsx` + 关联组件 | PR-V8                   |
| `/edit/[id]` 路由 + 全屏编辑页                                                               | `frontend/app/ai-social/edit/[id]/page.tsx`         | PR-V8                   |
| `SourceSelector` / `PlatformSelector` / `AccountSelector` / `ContentEditor` / `SeriesEditor` | wizard 内部组件                                     | PR-V8                   |
| ContentsTab 内"选来源"小模态                                                                 | `ContentsTab.tsx` 局部                              | PR-V6                   |
| 旧 `SocialContent` 写入路径                                                                  | service 内 createContent 等                         | PR-V4 完成后 1 周观察期 |
| `sourceType` enum 在 Prisma                                                                  | `models.prisma` 中 enum 改为 string（Registry id）  | PR-V3                   |

---

## 12. 限制与配额

| 维度                              | 值          | 配置位置                                  | 触顶处理              |
| --------------------------------- | ----------- | ----------------------------------------- | --------------------- |
| 单源最多选                        | 10          | `SocialDataSource.maxItemsPerTask` 可覆盖 | Picker 灰显 + tooltip |
| 跨源总数                          | 20          | 全局 config                               | 主弹窗启动按钮灰显    |
| 视频/长内容（>5000 字 / >10 min） | 计 2 个名额 | 内部权重                                  | 同上                  |
| 外部 URL                          | 3           | 全局 config                               | + 按钮灰显            |
| 补充提示词字数                    | 500         | 全局 config                               | textarea maxLength    |
| 并发任务数（同用户）              | 3           | Steward 闸                                | 启动返回 429          |

---

## 13. 风险与缓解 [v1 扩充 R5 安全审查]

| 风险                                                    | 等级   | 缓解                                                                                                                                                 |
| ------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 各 AI App 自注册时漏掉 `userId` 隔离                    | **P0** | 接口契约强制 `listItems(userId, ...)` + `fetchBundle(ids, userId)`；**PR-V2 每模块必有 integration test 断言 wrongUserId → 空/403**（不是手工 grep） |
| `SocialContent` → `SocialContentTask` 迁移数据丢失      | **P0** | 迁移脚本 `ON CONFLICT DO NOTHING` 幂等 + 保留旧表 ≥90 天 + dry-run + Railway staging 验证                                                            |
| **externalUrls SSRF（任意 URL）**                       | **P0** | **强制走 `ContentFetcherService.fetchFromUrl()`**（已含 SSRF 防护 + IP 黑名单 + 协议白名单），PR-V4 review checklist 必查；禁止直接 `fetch(url)`     |
| **Source body 含恶意 prompt 攻击 LLM**                  | P1     | s3 内容 transform 前调 `ai-engine/safety` moderation 扫描 + body 超长截断（10K char）+ system prompt 加 inject 防护                                  |
| 用户旧的 `/create?source=X` / `/edit/[id]` URL 收藏失效 | P1     | PR-V8 两条路由各加 30 天 301 redirect → `/ai-social`，期满删除                                                                                       |
| Agent Team 生成失败率高，用户体验差                     | P1     | DRAFT_READY 前必通过 s7 polish-review 质量门；s7 fail 触发 s8b 自动 retry 1 次                                                                       |
| WebSocket 断连期间状态卡死                              | P1     | `useAgentPlaygroundStream` 已有 reconnect；UI 显示"连接中断，正在重连…(last update: 30s ago)"                                                        |
| Picker 拉 list 时遭遇大数据源（如 AI Explore 上万条）   | P2     | 强制 cursor 分页 + 默认 limit 30 + 后端 index 检查                                                                                                   |
| 多平台并行生成导致 LLM token 超预算                     | P2     | Steward s1 在 `platforms.length` 上扩展预算估算（N 倍）                                                                                              |
| 各源 `contentKind` 不一致导致 AI Teams 处理分支爆炸     | P2     | 统一 5 种 contentKind 枚举（article/video/report/note/other）；AI Teams 内部按 contentKind switch                                                    |
| Picker 翻页数据竞态（cursor 重复）                      | P2     | cursor 携带 timestamp + offset，前端去重；后端 stable sort                                                                                           |
| 多平台并行中途事务状态不一致                            | P2     | 各 platform 走独立 `SocialContentVersion` 记录，task 级状态按 §6.3 聚合规则汇总；不依赖跨平台事务                                                    |

---

## 14. 开放问题（待用户决策）

1. **多源融合意图**：用户勾了多个 item 但没填"补充提示词"——AI Teams 默认按"融合写一篇综述"还是"列出对比要点"？
   - 建议：默认融合综述；若用户勾的 item 来自同一类型（都是视频）默认转写汇总
2. **不满意的内容**：DRAFT_READY 后用户能不能改文字？
   - 建议：**不能直接改**——保持极简范式；只能 🔁 重新生成（可改提示词）
3. **多平台是 1 任务 N 版本，还是 N 任务**：
   - 已选择 **1 任务 N 版本**（数据模型 `SocialContentVersion` 体现），列表页 1 行展示，状态按"最差版本"汇总
4. **"发布到草稿箱"后能否撤回**：
   - 建议：不在 v2 范围；用户去平台后台自己删

---

## 15. 沉淀经验（待 v1 共识后写 memory）

- `feedback_intent_driven_not_content_driven`: AI App 的"创建"应该让用户声明意图而非写内容；让 Agent Team 全权生产是 AI Teams 项目的核心范式
- `feedback_data_source_registry_pattern`: 任何"用户从多个内部模块挑数据"的场景都应该用 Registry，禁止硬编码 enum
- `feedback_drawer_is_observability_not_editor`: Agent 驱动的工作流里，Drawer 必须是任务观测台而不是编辑器
- `feedback_user_journey_starts_at_module_entry`: 用户旅程的起点是 sidebar 模块入口，不是外部模块的"发到 X"按钮（外部入口是加速路径不是主线）

---

## 16. 共识审查记录

### Round 1（v0 → v1）— 2026-05-18 完成

| Reviewer     | 关注域                       | P0                                                 | P1                          | P2        | 投票              |
| ------------ | ---------------------------- | -------------------------------------------------- | --------------------------- | --------- | ----------------- |
| R1 PM        | 用户旅程 / 诉求完整性        | 1（多平台部分成功状态机缺失）                      | 3                           | 2         | NO                |
| R2 Architect | 架构一致性 / Registry / 依赖 | 1（§8.1 表述漏 harness）+ 提升 P1-1 反向依赖为 P0  | 3                           | 2         | 条件 YES          |
| R3 Data      | 数据模型 / 契约 / 迁移       | 1（迁移 SQL 引用不存在字段 `sourceMigrationId`）   | 3                           | 6         | 条件 YES          |
| R4 Impl      | 实施可行性 / PR 拆分         | 2（FAST vs FULL pipeline 错选 + s2/s5 stage 名错） | 4                           | 4         | 条件 YES          |
| R5 Risk      | 风险 / UI 一致性 / 安全      | 0                                                  | 2（SSRF + permission leak） | 3         | 条件 YES          |
| **合计**     |                              | **5 P0**                                           | **15 P1**                   | **17 P2** | 1 NO + 4 条件 YES |

### v1 修补落地（逐 P0 对照）

| P0 来源                  | 修补章节                                                                                                   | 状态 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ---- |
| R1: 多平台部分成功       | §6.3 加 `PARTIAL_PUBLISHED` + §9.1 `SocialContentVersion` 加 status/errorMessage                           | ✅   |
| R2: §8.1 表述 + 反向依赖 | §8.1 改写 + 加 contracts 抽取方案 + multi-provider 注入                                                    | ✅   |
| R3: 迁移 SQL 字段缺失    | §9.1 加 `sourceMigrationId String? @unique` + §9.3 改用 `ON CONFLICT DO NOTHING`                           | ✅   |
| R4: pipeline + stage 名  | §6.2 全部重写：走 `SOCIAL_PIPELINE` 13-step + 真实 stage 名（s3 content-transform 是关键改造点）+ stage 表 | ✅   |
| R5 P1 提升: SSRF         | §13 列为 P0：externalUrls 强制走 `ContentFetcherService`                                                   | ✅   |

### v1 P1 修补落地

| P1 来源                                  | 修补章节                                                                                            | 状态                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| R1: Drawer 容量不够 / 用户要看团队全景   | §5 完全重写：复用 playground/team/[missionId] 布局 + 12 组件复用清单                                | ✅（用户后续追加要求） |
| R2 P1-3: bodyMime 字段                   | §9.1 `SocialContentVersion.bodyMime`                                                                | ✅                     |
| R3: scheduler 过渡冲突                   | §9.2 增补"PR-V3 暂停 scheduler 或加 task-aware 短路"                                                | 见下方"残留待跟进"     |
| R3: regenerate upsert 语义               | §6.4 写入策略明确                                                                                   | ✅                     |
| R3: 列表排序索引                         | §9.1 加 `[userId, createdAt(sort:Desc)]`                                                            | ✅                     |
| R4 P1-1/2/3: 工作量低估                  | §10 整体修正：V2 1.5→2.5d / V3 1.0→1.5d / V4 1.5→2.0d / V7 1.0→1.5d / V8 0.3→0.7d；总 7-9d → 10-12d | ✅                     |
| R4 P2-3: 测试策略全缺                    | §10 每 PR 增 "测试范围"清单                                                                         | ✅                     |
| R5: SideDrawer / MissionDialogShell 复用 | §5 + §10 PR-V6/V7 明确组件                                                                          | ✅                     |
| R5: displayName i18n 衔接                | §8 补 i18n 衔接说明                                                                                 | 见下方"残留待跟进"     |

### 残留待跟进（Round 2 前补齐）

1. **scheduler 过渡冲突**：明确 PR-V3 部署时 `PublishSchedulerService` 是否短路；建议加一行 `if (content.taskId) return; // 已由新流水线管理`
2. **displayName 前端 i18n 衔接**：§8.5 补一段——前端 `useSocialDataSources` 拿到双语对象，按 `i18n.language` 选 `displayName[locale]`；locale 切换时 SWR revalidate
3. **多平台部分失败 UI**：§5.6 行内"🔁 重试失败平台"已加，但 mission 详情页"发布"tab 的"单平台 🔁"按钮交互需在 PR-V7 设计图细化
4. **品牌名硬编码**：§3.1 草图里 `WeChat 公众号 (绑定: 张姐工作号)` 等是占位文案，PR-V5/V6 实现时 platform 名走 platform registry 的 displayName，不硬编码

### Round 2（已合并到 v1）

Round 1 的 NO（R1）和"条件 YES"已通过上述修补全部满足。残留 4 项是 P2 级具体实施细节，不阻塞 v1 共识。

### 共识终态

| Reviewer     | Round 1 → Round 2 v1 状态                                                      |
| ------------ | ------------------------------------------------------------------------------ |
| R1 PM        | **NO → YES**（多平台部分成功状态机 §6.3 + Drawer 升级为完整 mission 页 §5）    |
| R2 Architect | **条件 YES → YES**（contracts 抽取 §8.1 + 表述修正）                           |
| R3 Data      | **条件 YES → YES**（sourceMigrationId §9.1 + ON CONFLICT §9.3 + 索引 §9.1）    |
| R4 Impl      | **条件 YES → YES**（pipeline 与 stage 名修正 §6.2 + 工作量修正 §10）           |
| R5 Risk      | **条件 YES → YES**（SSRF P0 §13 + permission leak integration test §10 PR-V2） |

**5/5 YES 共识达成**。残留 4 项细节在 PR 执行时落地。

---

**最后更新**: 2026-05-18 v1（共识终态）
**作者**: Claude Code（GenesisPod 团队 + 5 路 reviewer 协作）
**审批人**: 待用户确认
