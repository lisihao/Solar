# AI 社媒 UI 重设计 - 完整设计稿

> **日期**: 2026-05-17
> **触发**: 用户反馈"完全看不懂当前 UI 设计"
> **方法**: 3 路专家并行（PM 用户旅程 / UI 设计 / 架构技术评估）
> **状态**: ⚠️ **已被 [intent-driven-redesign-2026-05-18.md](./intent-driven-redesign-2026-05-18.md) v1 演进取代**——本稿的 candidate A（列表+drawer 一统）+ Mission dispatcher 单轨化方向继承，但 480px drawer / 用户编辑能力 / wizard 残留等已重做。新方案叠加"意图驱动 + Registry 化 + Agent Team 内容生产 + 完整 mission 详情页"

---

## 0. 执行摘要

### 问题陈述

W5 frontend UI（PR ec15f7b81）把后端两套实现（旧 sync `publish-executor` + 新 W4 Agent Team Mission）直接暴露成 3 个并列 tab（内容管理 / Missions / 平台连接），让用户做本该产品决定的路由选择。用户在 8 分钟时间线内多次卡点，最终反馈"完全看不懂"。

### 3 路专家结论高度一致

| 路   | 角色          | 核心发现                                                                                                         | 推荐方向                                          |
| ---- | ------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| UX-A | PM / 用户旅程 | 双发布路径零差异化文案是致命错误；7 个痛点全部围绕"信息架构暴露后端实体"                                         | 单一发布入口、tab 改用户语义                      |
| UX-B | UI 设计       | 3 候选 layout：内容为主 1.5d / 任务为主 3d / 对话为主 1w+                                                        | **候选 A（内容为主）**                            |
| UX-C | 架构技术      | pipeline 是 config 驱动，加 SOCIAL_FAST_PIPELINE（4 step）即可让 W4 单轨承接快发场景，省 90% LLM cost / 70% 时延 | **方向 A（合并到 Mission + fast-track profile）** |

### 总体方案

**单轨化 + UI 重构 + 复用 4 件套**：

- 后端单一发布路径 = `dispatcher.runMission()`（按 `depth` 走 13-stage 或 4-stage fast pipeline）
- 前端单一视图 = 内容列表 + row 点开 slide-over（状态 / 发布表单 / 进度时间线）
- 删 MissionsTab 长表单 + 删 3 tab 切换 + ConnectionsTab 拆独立路由
- 复用公共 4 件套（PageHeaderHero / AssetCard / AssetDetailLayout / MissionDialogShell）

**总工作量**: ~4 天 / 6 PR

---

## 1. 用户旅程分析（UX-A 输出）

### 1.1 Persona

#### P1 张姐 - 自媒体团队 owner（**主流量 persona**）

- **角色**: 3-5 人小红书/公众号矩阵号主理人；本人不写稿但拍板发不发
- **频率**: 每天 3-5 次进系统；周一/周五是高峰
- **JTBD**: 「把今天编辑组写的 5 篇稿子，**今晚 8 点前**全部发到对应公众号 + 小红书账号，配图/排版别出错」
- **最大痛**: **不知道点哪个按钮才能让稿子真的发出去**——内容管理里的飞机按钮（ContentsTab.tsx:791）和 Missions tab 里的「启动 Mission」是两条路，文案没告诉她区别

#### P2 老王 - 独立创作者

- **角色**: 技术博主，AI Research 写完报告后想顺手发到公众号
- **频率**: 一周 1-2 次
- **JTBD**: 「我刚在 AI Research 跑完一份调研，**怎么把它变成一篇公众号文章发出去**」
- **最大痛**: 他从 Research 跳过来 `?tab=contents`，看到一张空表 + Missions 这个工程词，**不知道入口在哪**

#### P3 小陈 - 运营实习生

- **角色**: 被 owner 授权管理账号，**只做素材准备和投递操作**
- **频率**: 每天 5-10 次
- **JTBD**: 「老板给我 10 个链接，我要把它们转成稿件并发出去，**进度要让老板能看见**」
- **最大痛**: 发完一条想看「现在到第几篇了/失败了几条」，但只有 Missions 进度面板，**而且只能看到 1 个 mission**（MissionsTab.tsx:15 注释明说 v1 不支持多 mission 历史）

### 1.2 用户旅程地图（P1 张姐）

```
脑子里冒出: "今晚要发 5 篇稿子到公众号+小红书"
            │
            ▼
T+0s   进入 /ai-social
       看到 header: "AI 社媒 · 智能发布内容到社交平台"
       看到 3 个 tab: [内容管理] [Missions] [平台连接]
       ◇ 心理: "Missions 是什么？我要发的'内容'在第一个 tab 应该没错"
       ◇ 系统能力: 默认 activeTab = 'contents' (page.tsx:46)
       ◇ 卡点: 「Missions」这个英文+工程词，老板娘根本不懂

T+5s   进入「内容管理」tab
       看到搜索框 + 状态过滤 + "新建内容"按钮 + 表格
       ◇ 心理: "我的 5 篇稿子在哪？昨天编辑组说已经入库了"
       ◇ 系统能力: SWR 拉 getContents (ContentsTab.tsx:113)
       ◇ 卡点: 表格里能看到草稿，但没有"今天/本周"快速过滤，要靠"高级筛选"展开

T+30s  找到目标稿件，点击行尾飞机按钮 <Send>
       ◇ 系统能力 A: 旧 publish-executor 直发 (handlePublish, ContentsTab.tsx:221)
       ◇ 系统能力 B: 完全不知道还有 W4 Agent (MissionsTab) 这条路
       ◇ 卡点: 同样是"发布"，旧路同步直发，新路异步 + 有进度，**用户看不出区别**

T+1m   等 toast 弹"已发布"
       ◇ 心理: "诶？真的发出去了？我还没看到稿子在公众号上啊"
       ◇ 系统能力: confirmPublish 成功后 toast.success + swrRefresh (ContentsTab.tsx:266)
       ◇ 卡点: 没有「跳到外部 URL 查看」的强提示，状态变 PUBLISHED 就是终点

T+2m   想批量发剩下 4 篇 → 用复选框 + BatchActionBar
       ◇ 系统能力: handleBatchPublish (ContentsTab.tsx:460)，但要求所有都是 DRAFT/FAILED
       ◇ 卡点: 如果 5 篇里有 1 篇是 PENDING（待审核），批量按钮直接报错全停

T+5m   突然好奇 Missions 是什么 → 点过去
       看到一个表单: 内容/平台/quality 档位/budget 档位 + "启动 Mission"
       ◇ 心理: "8/20/50 USD 是什么？我刚不是一篇 0 USD 就发出去了？"
       ◇ 系统能力: runSocialMission (MissionsTab.tsx:124) 走 W4 Agent Team
       ◇ 卡点: 文案完全没告诉她 "这是 AI 替你优化标题/封面/选时段再发"

T+10m  老板问"昨天那篇发出去没"
       ◇ 心理: "我去 Missions 看看历史" → 进度面板空着
       ◇ 系统能力: v1 只支持单 mission 在场 (MissionsTab.tsx:15)
       ◇ 卡点: 历史全靠 Contents 表的 PUBLISHED 状态推断
```

### 1.3 7 个 UI 痛点（带 file:line 证据）

#### 痛点 1：双发布路径，零差异化文案 ★★★（最致命）

- **证据**: `page.tsx:114-130` tab 配置同级排列 `contents/missions/connections`；`ContentsTab.tsx:778-794` 行尾 `<Send>` 按钮 + `MissionsTab.tsx:252-264` "启动 Mission" 按钮，**两个按钮都叫"发布"，但走两条后端**
- **影响**: 用户随机选一条，体验差异巨大（同步 vs 异步 + 有 budget）但毫无预警
- **改进**: 合并为单一 "发布" 入口

#### 痛点 2：「Missions」是工程师词汇

- **证据**: `page.tsx:122` `label: 'Missions'`（**英文硬编码**，没走 t()），zh.json L2833 没补 missions 文案
- **改进**: 改名 "AI 智能投递" 或 "智能发布"，补 `aiSocial.tabs.missions` i18n

#### 痛点 3：进入页面无引导，默认 tab 选错

- **证据**: `page.tsx:41-47` URL 不带 `?tab` 时 fallback 到 'contents'；但 connections=0 的新用户看到 contents 空表
- **改进**: onboarding 三步条：1) 绑账号 → 2) 准备内容 → 3) 发布；首次访问按状态自动跳第 1 步

#### 痛点 4：Mission 进度面板"无 mission 时"的空状态过于抽象

- **证据**: `MissionsTab.tsx:283-286` 空态文案"选择内容 + 平台后点「启动 Mission」"
- **改进**: 保留单 mission 实时进度区，**额外**加历史 mission timeline / 最近 5 条

#### 痛点 5：质量档位/预算档位文案过于技术化

- **证据**: `MissionsTab.tsx:229-248` 选项是 `quick · 15 min / standard · 30 min / deep · 60 min` 和 `lean · 8 USD / standard · 20 USD / rich · 50 USD`
- **改进**: 改业务语言「快速发（不优化）/ 标准发（优化标题封面）/ 深度发（重写正文+多平台适配）」，预算放二级 advanced

#### 痛点 6：内容列表"操作列"图标过载，无主次

- **证据**: `ContentsTab.tsx:771-841` 一行 4 个图标按钮（发布/外链/预览/删除），全是 16x16 + Tooltip 才能看到含义
- **改进**: 主操作（发布）用 filled button 文字；外链/预览/删除收进 `<MoreActions>` 下拉

#### 痛点 7：tab 顺序违反任务依赖

- **证据**: `page.tsx:114-130` 顺序是 contents → missions → connections，但**任务依赖是 connections → contents → missions/publish**
- **改进**: 调整为 connections → contents → missions（按工作流顺序），或保留默认 contents 但在 header 横幅显示"已连接 N 个平台 · 去管理"

---

## 2. UI 重构方案（UX-B 输出）

### 2.1 候选 A：内容为主（asset-centric）⭐ 推荐

**核心理念**：消除 Mission tab；进度状态内嵌在内容 row；任何动作从 row 触发 slide-over。

#### Desktop 1280px ASCII Mockup

```
+------------------------------------------------------------------------------+
| AppShell sidebar 240   |  Content area 1040                                  |
+------------------------+---------------------------------------------------- +
|                        | [PageHeaderHero 1040x96]                            |
|                        | +-----------------------------------------------+   |
|                        | | [icon] AI Social                              |   |
|                        | | 把内容发到公众号/小红书 · AI 帮你做完最后一步 |   |
|                        | |                              [+ 新建发布 880] |   |
|                        | +-----------------------------------------------+   |
|                        |                                                     |
|                        | [Toolbar 1040x48]                                   |
|                        | [搜索 320] [状态▼120] [平台▼120] [来源▼120] ... 刷新|
|                        |                                                     |
|                        | [Content table 1040 · light-only]                   |
|                        | +-------------------------------------------------+ |
|                        | | 标题                类型  平台  状态     时间   | |
|                        | +-------------------------------------------------+ |
|                        | | 2026 AI 趋势报告    长文  WX    [已发]  3h ago | |
|                        | | 5 月增长复盘        长文  WX    [发布中●●●]    | |
|                        | | 周末玩什么          笔记  XHS   [草稿]         | |
|                        | | 工具评测            长文  WX    [失败 重试]    | |
|                        | +-------------------------------------------------+ |
|                        | < 1 2 3 ... >        50/页                          |
+------------------------+-----------------------------------------------------+

点击 row → 右侧 slide-in 480 抽屉
+------+------------------------------------------+
| list |  [< 返回] 2026 AI 趋势报告               |
| 720  |  ─────────────────────────────────────── |
|      |  状态 [已发布 WX · 草稿 XHS]              |
|      |  来源 AI Research mission #abc           |
|      |  ─────────────────────────────────────── |
|      |  [发布到 ▾  WX  XHS  +]                  |
|      |  [深度 ○快速 ●标准 ○深度]                |
|      |  [预算 ○省 ●标 ○丰] (advanced 折叠)      |
|      |  [发起发布 →]                            |
|      |  ─────────────────────────────────────── |
|      |  进度时间线                              |
|      |  ● 19:02 plan 完成                       |
|      |  ● 19:03 rewrite WX 完成                 |
|      |  ◐ 19:04 publish WX (进行中)             |
|      |  ─────────────────────────────────────── |
|      |  [编辑] [删除] [复制链接]                |
+------+------------------------------------------+
```

#### Mobile 360px ASCII Mockup

```
+----------------------------------+
| [≡] AI Social         [+]        |
+----------------------------------+
| [搜索框 全宽]                    |
| [状态▼] [平台▼] [更多▼]          |
+----------------------------------+
| ┌──────────────────────────────┐ |
| │ 2026 AI 趋势报告              │ |
| │ 长文 · WX                     │ |
| │ [已发]  3h ago     [···]     │ |
| └──────────────────────────────┘ |
| ┌──────────────────────────────┐ |
| │ 5 月增长复盘                  │ |
| │ 长文 · WX [发布中●●●]         │ |
| └──────────────────────────────┘ |
| ┌──────────────────────────────┐ |
| │ 周末玩什么 [草稿]             │ |
| └──────────────────────────────┘ |
+----------------------------------+
| 点 card → 全屏 slide-up 抽屉     |
+----------------------------------+
详情页：单列堆叠（status / 发布表单 / 时间线 / 元数据），不分两栏
```

#### 信息架构

- **一级**: 单页 = 内容列表
- **二级**: row 点开 slide-over（详情 + 发布表单 + 进度）
- **三级（独立路由）**: `/ai-social/connections` 平台连接管理（账户绑定，低频）
- **数据流**: 列表来自 `useSocialContentsSWR`；详情发布走唯一新路径 `runSocialMission()`，旧 `useSocialPublish` 删掉

#### 关键改动文件

- **改**: `frontend/app/ai-social/page.tsx` — 删 tab 切换，单视图渲染 ContentsTab，header 用 `PageHeaderHero`
- **改**: `frontend/components/ai-social/ContentsTab.tsx` — 列表保留；row 点开改为唤起新 `ContentDetailDrawer`
- **删**: `frontend/components/ai-social/MissionsTab.tsx`（功能并入 drawer）
- **新建**: `frontend/components/ai-social/ContentDetailDrawer.tsx`（用 `AssetDetailLayout` 公共组件，三段：状态/发布表单/时间线）
- **移动**: `ConnectionsTab.tsx` → 独立 `frontend/app/ai-social/connections/page.tsx`
- **复用**: `PageHeaderHero` / `AssetCard`(mobile) / `MissionDialogShell`(发布确认弹窗)

#### 工作量：**1.5 天**

- 0.5d 删 Mission tab + 合并发布路径单源化
- 0.5d 新建 ContentDetailDrawer 套用 AssetDetailLayout
- 0.5d connections 拆独立页 + i18n + 回归测试

#### 优缺点

- **优 1**: 心智单线 — "我的内容"是首页，所有动作从内容出发
- **优 2**: 消灭 "mission not found 空状态炸眼"
- **优 3**: 复用 AssetDetailLayout/AssetCard，与 Library/Research 视觉一致
- **缺 1**: 内容多（>200 条）时定位困难，依赖搜索/过滤
- **缺 2**: 无法横向比较多个 mission 进度（同时跑 3 个发布看不全）
- **缺 3**: 历史 mission 回溯路径长（要点开 row 才看进度）

### 2.2 候选 B：任务为主（mission-centric）

**核心理念**：用户首页看「今天发了啥/数据回来没」，新建发布是显眼 CTA，内容管理降为次要 tab。

```
[PageHeaderHero] 发布中心 · 4 进行 · 12 已完成 · 2 失败  [+ 新建发布]
[Tab] 进行中(4) | 今日(8) | 历史 | 内容库 | 平台

=== 进行中 4 ===
┌────────────────────────────────────────────────┐
│ 2026 AI 趋势报告 · WX+XHS · ●●○○ rewrite 中   │
│ 启动 3 分钟前 · 已花 ¥0.12 / 预算 ¥0.5         │
│                                  [查看时间线 →]│
└────────────────────────────────────────────────┘

=== 今日完成 8 ===
• 工具评测 · WX 12:30 [失败 重试]
• 周末玩什么 · XHS 11:02 [已发 链接↗]
```

- **工作量**: 3 天
- **风险**: 中（多订阅 hook 复杂）
- **优**: 多 mission 横向比对 / 与"刚发的怎么样了"心智完全对齐 / mission 独立路由可分享链接
- **缺**: 5 tab + 2 新路由工作量大 / 偶发用户首屏全是历史空显凋零 / 内容管理降级后双步流程曲折

### 2.3 候选 C：对话为主（agent-centric）

**核心理念**：聊天框是主视图。用户说"帮我把昨天写的文章发到公众号 + 小红书"，AI 解析任务后弹卡片确认 → 跑 Mission。

```
Chat 700                 |  Context drawer 340
─────────────────────────|──────────────────────
AI: 你好，我可以帮你...   |  [Tab: 内容 | 平台 | 历史]
                         |  最近内容
用户: 把"AI 趋势报告"     |  - 2026 AI 趋势 [已发]
       发到公众号         |  - 周末玩什么 [草稿]
                         |
AI: 已为你准备好：        |  已连账户
┌──────────────┐         |  ● WX MP · 6h ago
│ 内容: AI 趋势 │         |  ● 小红书 · 6h ago
│ 平台: WX     │         |
│ [改] [启动→] │         |  最近 mission
└──────────────┘         |  ✓ 5 月复盘 · WX 12:30
                         |  ⟳ 工具评测 失败 重试
```

- **工作量**: 1 周+
- **风险**: 高（需要后端 intent 解析 + NLU 准确度）
- **优**: 心智零门槛 / 自然支持复合指令 / 与 GenesisPod 北极星对齐
- **缺**: 工作量最大且需要新后端 NLU / 重度操作不如表格批量 / NLU 误解需 confirm card 兜底

### 2.4 三候选对比

| 维度                   | A 内容为主          | B 任务为主              | C 对话为主             |
| ---------------------- | ------------------- | ----------------------- | ---------------------- |
| 主视图                 | 内容列表            | mission dashboard 5 tab | chat + context drawer  |
| 默认路径（3 秒能干嘛） | 看到所有内容+状态   | 看到进行中/今日聚合     | 说一句话发起任务       |
| 适合场景               | ≤50 内容 / 偶发用户 | 内容多 / 重视进度       | 探索性 / AI 重度依赖   |
| 改动文件数             | 3 改 1 删 2 新      | 4 改 0 删 4 新          | 1 改 0 删 5 新 + 后端  |
| 工作量                 | **1.5 天**          | 3 天                    | 1 周 +                 |
| 风险                   | 低                  | 中                      | 高                     |
| 双源消除               | 是                  | 是                      | 是                     |
| 复用 4 件套            | 充分                | 部分                    | 复用 leader-chat shell |

### 2.5 推荐：候选 A

**理由**:

1. 直接命中用户痛点（双发布路径 + tab 后端实体名 + mission not found 炸眼）
2. 工作量最小（1.5d vs 3d vs 1w+）、风险最低
3. 天然单源（slide-over 里只有一个"发起发布"按钮走 `runSocialMission`）
4. 复用公共 4 件套最充分，与 Library/Research 视觉一致
5. B 的进度聚合可作为 follow-up（YAGNI），不要现在过度设计
6. C 时机未到（GenesisPod leader-chat / agent-playground 还在演进）

---

## 3. 后端单轨化（UX-C 输出）

### 3.1 关键事实

#### 旧路径调用面

**`PublishExecutorService.execute(contentId)` 仅 3 处真实调用点**：

- `ai-social.service.ts:1125` — `publishContent()` 单条发布
- `ai-social.service.ts:1513` — `batchPublishContents()` 事务结束后 fire-and-forget 批量
- `publish-scheduler.service.ts:138` — 每分钟扫 `status=SCHEDULED && scheduledAt <= now` 后调

**`useSocialPublish` hook 前端仅 2 处真实使用**：

- `ContentsTab.tsx:125` — 列表行 Send 按钮 + 批量发布
- `create/edit page` — 创建/编辑后立即发的入口

#### Mission 路径架构（W4 Agent Team）

- `ai-social.controller.ts:66-114` — `POST /ai-social/mission/run` fire-and-forget，5s server-side dedup
- `social.config.ts:23-96` — 13 步流水线（s1-s11 + s8b + s12 postlude），全 `primitive: persist`
- `s1-mission-budget-eval.stage.ts:46-69` — Steward 4 闸（remainingCredits / estimatedCost / sessionExpiresAt / inProgressMissionCount / keyCooldownCount1h）
- `s8-publish-execute.stage.ts:55-93` — 真发动作（`ConcurrencyLimiter(2)` 并发每平台）

#### 双重 publish-executor 类型

- `services/publish-executor.service.ts` — 旧路径 sync executor
- `services/roles/publish-executor.service.ts` — 新 Agent 包装（`PublishExecutorAgentService`）
- 两者底层都调同一个 `WechatAdapter` / `XhsMcpAdapter`，**不存在适配器层重复**

#### DB 模型

- `SocialContent.missions SocialMission[]`（models.prisma:8649）—— **一份 content 已支持多次 mission 引用**，迁移零成本
- `SocialPublishLog` 仅由旧 `publish-executor.service.ts:188` 写，Mission 路径**不写**这表

### 3.2 性能对比（单平台快发）

| 项目         | 旧 sync executor | 新 13-stage | **新 4-stage fast-track**   |
| ------------ | ---------------- | ----------- | --------------------------- |
| LLM tokens   | 0                | ~30K-50K    | **~3K-5K（仅 s1 Steward）** |
| Cost         | $0               | ~$0.05-0.10 | **~$0.005-0.01**            |
| Wall time    | 30s-2min         | 5-15min     | **1-3min**                  |
| LLM 调用次数 | 0                | 8-12 次     | **1 次**                    |

**fast-track 省 90% LLM 成本与 70% 时延**，仍保留 Steward 4 闸 + publish-verify 增值。

### 3.3 三方向对比

| 方向                                | 工作量   | 技术风险 | 用户体验          | 维护负担         |
| ----------------------------------- | -------- | -------- | ----------------- | ---------------- |
| **A 合并到 Mission + fast profile** | 2-3 天   | 2/5      | 5/5（统一）       | 5/5（单轨）      |
| B 合并到旧 publish                  | 0.5-1 天 | 4/5      | 3/5 失去验证/重试 | 2/5 浪费 W4 投入 |
| C 保留双轨 + UI 明讲                | 0.1 天   | 1/5      | 4/5 用户可选      | 1/5 持续技术债   |

### 3.4 推荐：方向 A

**理由**:

1. W4 已经接通 13 stage 全链路（dispatcher + s8 真发 + s9 verify），停用旧 sync executor 没有功能损失
2. fast-track 完全 config 驱动：`SOCIAL_FAST_PIPELINE`（s1+s8+s9+s11）在 `social.config.ts` 加几十行，不动业务代码
3. scheduler 复用最简：`publish-scheduler.service.ts:138` 直接换成 `dispatcher.runMission(missionId, { depth: "quick", ... })`
4. 彻底消灭双重 publish-executor 类型概念
5. 合规符合 `feedback_no_dual_sources`：双源即时抽 single source，不留 follow-up

---

## 4. 实施路径（6 PR · ~4 天）

| PR       | 内容                                                                                                                   | 工作量 | 风险 | 依赖   |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ------ | ---- | ------ |
| **PR-1** | 后端：加 `SOCIAL_FAST_PIPELINE` 4-step config + dispatcher 按 `depth=quick` 选 pipeline                                | 0.5d   | 低   | —      |
| **PR-2** | 后端：`publish-scheduler.service.ts:138` 切到 `dispatcher.runMission(depth=quick)`                                     | 0.5d   | 中   | PR-1   |
| **PR-3** | 后端：`ai-social.service.ts:publishContent/batchPublish` 委托 dispatcher；旧 `PublishExecutorService` 标 `@deprecated` | 0.5d   | 中   | PR-1   |
| **PR-4** | 前端：UI 重构候选 A（删 MissionsTab + 3 tab 切换 + 新建 ContentDetailDrawer + ConnectionsTab 拆独立路由）              | 1.5d   | 中   | —      |
| **PR-5** | 前端：补 i18n（aiSocial.tabs.missions 等）+ 业务化档位文案（快速发/标准发/深度发）                                     | 0.5d   | 低   | PR-4   |
| **PR-6** | s8 stage 补写 `SocialPublishLog` 兼容 admin 历史日志 + 1 周观察后删旧 `PublishExecutorService`                         | 0.5d   | 低   | PR-1~3 |

**并行性**：PR-1/2/3（后端串行）和 PR-4（前端）可并行；PR-5 跟 PR-4，PR-6 跟 PR-1~3。

**最早收尾时间**: 4 天

---

## 5. 沉淀经验（待补 memory）

### 5.1 feedback_tabs_must_be_user_mental_model

> UI 一级 tab 必须是用户语义（"我要发/看进度/回看"）而非后端实体名（content/mission/connection）；3 选 1 时优先内容/任务为主而非 tab 平铺；空状态炸眼必须删而非"等用户首次启动后才显示"

### 5.2 feedback_must_user_journey_before_ui

> 新 ai-app 加 UI 入口前必须先做 user journey + persona 分析，不能直接根据 backend tab/endpoint 翻译成前端 tab。W5 frontend 直接按 backend controller 路由翻译成 3 个 tab 是反例

### 5.3 feedback_dual_path_zero_diff_copy_fatal

> 用户视角两个按钮做同件事但走不同后端、零差异化文案 = 致命 UX 错误。即使工程师知道区别，用户不应该被迫做路由选择

---

## 6. 待用户决策

详见我消息里的 4 选 1 question。
