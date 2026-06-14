# 个人中心（me）重设计

| 项   | 值                                                         |
| ---- | ---------------------------------------------------------- |
| 版本 | 1.0                                                        |
| 日期 | 2026-05-20                                                 |
| 状态 | 设计定稿，待实施                                           |
| 参考 | Claude.ai 设置形态（整页 + 左导航）；Genspark 设置分类组织 |
| 范围 | 仅用户侧个人中心；admin 后台独立，不在本次范围             |

---

## 1. 背景

个人相关功能散落、重叠、入口混乱：

| 问题               | 现状                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| profile god-page   | `app/profile/page.tsx` 1431 行，5 个 tab（资料 / 外观设置 / 通知 / 统计 / 集成）全塞一页        |
| 拆分做一半         | `me/ai`（API Keys / 模型 / Agent）已从 profile 拆出，其余 4 tab 仍堆在 profile                  |
| me 是 hub 但未整合 | `app/me/page.tsx` 是 4 卡片导航 hub，链向 profile / me-ai / library / notifications，未真正聚合 |
| 通知散落 3 处      | profile 的 notifications tab、`settings/notifications/`、`/notifications` 路由                  |
| 入口双轨           | 头像下拉同时链 `/profile` 与 `/me/ai`，绕过 hub                                                 |
| 语言切换游离       | 左下角独立 EN 切换控件，未归位                                                                  |

---

## 2. 设计原则

1. 两层分工：头像菜单负责高频快捷，`/me` 整页负责详细配置。
2. 整页而非弹窗：用 Claude 式整页路由 `/me/[section]`（有 URL、可深链与书签、嵌主 sidebar、空间充足），不采用 Genspark 的 modal。
3. 保留项目能力：积分、签到、BYOK、集成、通知偏好、用量统计全部保留，仅归位。
4. 语言切换留在头像菜单（高频操作），不进设置分类。
5. 旧链接全部 301 兼容，外部书签与通知 actionUrl 不断。
6. 全程不使用 emoji，图标统一 Lucide React。

---

## 3. 信息架构

### 3.1 头像下拉菜单（左下角）

按从上到下顺序：

| 菜单项           | Lucide 图标 | 类型     | 行为 / 目标          | 说明                                    |
| ---------------- | ----------- | -------- | -------------------- | --------------------------------------- |
| 名字 + Plan 徽章 | User        | 标识     | —                    | 头部                                    |
| email            | —           | 标识     | —                    | 头部副行                                |
| 积分余额 + 充值  | Coins       | 快捷     | 充值跳 `/me/billing` | 项目特有，余额直显                      |
| 每日签到         | Check       | 快捷     | 触发 checkin         | 项目特有，`canCheckin` 时显示           |
| 设置             | Settings    | 入口     | 跳 `/me/account`     | 替代旧「个人资料 + 我的 AI 配置」双入口 |
| 语言             | Languages   | 二级展开 | 切换 中文 / EN       | 独立项，hover 展开，不进设置            |
| 帮助 / 反馈      | HelpCircle  | 入口     | 跳 `/feedback`       |                                         |
| 退出登录         | LogOut      | 操作     | logout               |                                         |

变更点：

- 删除旧的「个人资料」「我的 AI 配置」双入口，合并为单一「设置」。
- 语言切换从左下角游离控件移入此菜单。
- 积分余额卡与签到保留（项目特有，Claude 无对应）。

### 3.2 `/me` 个人中心整页

布局：`主 sidebar | me 二级导航（左） | section 内容（右）`，URL 形如 `/me/account`。

二级导航分三组：

```
个人          API 与模型        资源与计费
├ 账户        ├ API Keys        ├ 集成
├ 通用        ├ 我的模型        ├ 通知
└ 个性化      └ 我的 Agent      └ 账单
```

下面逐 section 展开明细。

#### 账户 `/me/account`

| 字段     | 控件     | 行为                                            | 来源            |
| -------- | -------- | ----------------------------------------------- | --------------- |
| 头像     | 图片展示 | 「由 Google 管理」提示 + 跳 Google 更新（只读） | profile.profile |
| 昵称     | 输入框   | 可编辑保存                                      | profile.profile |
| email    | 只读文本 | —                                               | profile.profile |
| 退出登录 | 按钮     | logout                                          | 同头像菜单      |

#### 通用 `/me/general`

| 字段     | 控件 | 选项                   | 来源                        |
| -------- | ---- | ---------------------- | --------------------------- |
| 外观主题 | 单选 | 浅色 / 深色 / 跟随系统 | profile.settings.appearance |

> 语言不在此处，见头像菜单（3.1）。

#### 个性化 `/me/personalization`

| 字段         | 控件       | 说明                 | 来源                            |
| ------------ | ---------- | -------------------- | ------------------------------- |
| 我的消息样式 | 样式选择器 | 多种气泡样式选其一   | profile.settings.chatAppearance |
| AI 消息样式  | 样式选择器 | 同上                 | profile.settings.chatAppearance |
| 实时预览     | 预览块     | 跟随上面选择实时渲染 | profile.settings.chatAppearance |
| 兴趣标签     | 标签编辑器 | 添加 / 删除兴趣      | profile.profile                 |

#### API Keys `/me/api-keys`（现成 `UserApiKeysTab`）

| 元素                | 说明                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| 顶部统计            | 已配置 N / 已捐赠 N                                                                                      |
| 搜索 + 筛选         | 按 Provider 名 / 分类 / 状态                                                                             |
| Provider 列表       | OpenAI / Anthropic / Google Gemini / xAI Grok / DeepSeek / 通义千问 等                                   |
| 每行字段            | 名称、分类（AI Model）、Value（配置状态）、状态（自用中 / 未配置）、用量计数、操作（配置 / 编辑 / 删除） |
| 添加自定义 Provider | 按钮                                                                                                     |

#### 我的模型 `/me/models`（现成 `UserModelsManagement`）

| 元素     | 说明               |
| -------- | ------------------ |
| 模型列表 | 用户自定义模型     |
| 操作     | 新建 / 编辑 / 删除 |

#### 我的 Agent `/me/agents`（现成 `MyAgentsTab`）

| 元素       | 说明               |
| ---------- | ------------------ |
| Agent 列表 | 用户自定义 Agent   |
| 操作       | 新建 / 编辑 / 删除 |

#### 集成 `/me/integrations`（连接器列表，参考 Claude Connectors / Genspark Tools）

呈现：每个连接器一行卡片，统一结构 `图标 + 名称 + 描述 + 状态 + 状态驱动操作`。

每行字段：

| 字段     | 说明                                                 |
| -------- | ---------------------------------------------------- |
| 图标     | 连接器品牌图标（Notion / Drive / 飞书 logo）         |
| 名称     | 连接器名                                             |
| 描述     | 一句话用途（灰色副文本）                             |
| 状态徽章 | 未连接（灰）/ 已连接（绿）+ 计数（如「2 个工作区」） |
| 操作     | 按状态切换（见下方状态机）                           |

三个连接器 + 状态驱动操作：

| 连接器       | 描述                     | 未连接态操作 | 已连接态操作                         | 现成组件                    |
| ------------ | ------------------------ | ------------ | ------------------------------------ | --------------------------- |
| Notion       | 导入 Notion 页面与数据库 | `[连接]`     | `[添加工作区]` `[查看页面]` `[断开]` | `NotionConnectionCard`      |
| Google Drive | 访问你的 Drive 文件      | `[连接]`     | `[断开]`                             | `GoogleDriveConnectionCard` |
| 飞书         | 绑定飞书账号同步         | `[绑定]`     | `[解绑]`                             | `FeishuBindingCard`         |

状态机（每个连接器一致）：

```
 [未连接] ──点 连接/绑定 ──► OAuth/授权 ──成功──► [已连接]
    ▲                                              │
    └────────────── 点 断开/解绑 ──确认弹窗──────────┘
```

> Notion 特殊：已连接态支持多工作区，「添加工作区」可再次走 OAuth 追加；「查看页面」跳已同步页面列表。

#### 通知 `/me/notifications`（现成 `NotificationPreferencesView`）

| 层级            | 内容                                                    |
| --------------- | ------------------------------------------------------- |
| 渠道总开关      | 邮件接收 / 站内 + 实时推送 / 最高级（Tier 3）信号即时推 |
| 类型 × 渠道矩阵 | 每个通知类型（如 AI 雷达周报）按渠道独立开关            |

#### 账单 `/me/billing`

| 区块     | 字段                                    | 来源               |
| -------- | --------------------------------------- | ------------------ |
| 当前订阅 | Plan 名称 / 状态 / 续费日期             | credits / 订阅 API |
| 积分     | 余额 + 充值入口                         | credits store      |
| 积分明细 | 流水列表                                | credits API        |
| 用量统计 | 收藏数 / 浏览资源数 / 评论数 / 注册时间 | profile.stats      |

---

## 3.3 界面线框图（文字版）

符号约定：`( )` = Lucide 图标；`[ ]` = 按钮；`[___]` = 输入框；`( )/(o)` = 单选未选/选中；`[ ]/[x]` = 开关关/开；`▸ ◄` = 当前选中项；`›` = 可展开。

### 3.3.1 头像菜单（左下角点头像，向上弹出）

```
 主 sidebar
 ┌────────────────┐
 │ ...            │
 │ (Bell) 通知     │
 │ (头像) JUNJIE ◄─┼── 点击触发
 └────────────────┘
       ▲ 向上弹出
 ┌──────────────────────────────────────┐
 │ (头像) JUNJIE DUAN          [Plus]    │  ← 标识区
 │        hello@gens.team    │
 ├──────────────────────────────────────┤
 │ (Coins)  积分           3877  [充值]  │  ← 积分/签到区
 │ (Check)  每日签到                     │
 ├──────────────────────────────────────┤
 │ (Settings)   设置                     │  ← 功能区
 │ (Languages)  语言         中文  ›     │
 │ (HelpCircle) 帮助与反馈               │
 ├──────────────────────────────────────┤
 │ (LogOut)     退出登录                 │  ← 登出区
 └──────────────────────────────────────┘
```

语言 hover 向右展开：

```
 │ (Languages) 语言  中文 › │   ┌──────────────┐
                              │ (Check) 中文  │  ← 当前项打勾
                              │         English│
                              └──────────────┘
```

交互逐条（无歧义）：

| 元素         | 触发  | 行为                                                          |
| ------------ | ----- | ------------------------------------------------------------- |
| 头像按钮     | 点击  | 切换菜单显隐；再次点击或点菜单外关闭                          |
| 名字 / email | —     | 纯展示，不可点                                                |
| 积分余额     | —     | 纯展示数字                                                    |
| `[充值]`     | 点击  | 跳 `/me/billing`，关闭菜单                                    |
| 每日签到     | 点击  | 调 checkin；仅 `checkinStatus.canCheckin === true` 时渲染该行 |
| 设置         | 点击  | 跳 `/me/account`，关闭菜单                                    |
| 语言         | hover | 右侧展开子菜单；点子项调用 i18n 切语言并持久化，不跳页        |
| 帮助与反馈   | 点击  | 跳 `/feedback`，关闭菜单                                      |
| 退出登录     | 点击  | 调 logout，跳 `/login`                                        |

未登录态：菜单不渲染，头像位置显示 `(LogIn) 登录` 按钮，点击跳 `/login`。

### 3.3.2 me 整页骨架

```
 ┌──────┬──────────────────┬──────────────────────────────────┐
 │ 主   │ 个人中心          │  [当前 section 标题]              │
 │ side │                  │                                  │
 │ bar  │ 个人             │                                  │
 │      │  ▸ 账户  ◄───────┤  [当前 section 内容]             │
 │      │    通用          │                                  │
 │      │    个性化        │                                  │
 │      │ ─────           │                                  │
 │      │ API 与模型       │                                  │
 │      │    API Keys      │                                  │
 │      │    我的模型       │                                  │
 │      │    我的 Agent     │                                  │
 │      │ ─────           │                                  │
 │      │ 资源与计费        │                                  │
 │      │    集成          │                                  │
 │      │    通知          │                                  │
 │      │    账单          │                                  │
 └──────┴──────────────────┴──────────────────────────────────┘
   主导航    me 二级导航(分3组+组标题)      右侧 section 内容
```

二级导航交互：点任一项切 URL `/me/[section]`，当前项高亮（`bg-gray-100`）；组标题（个人 / API 与模型 / 资源与计费）为不可点的分组标签。

### 3.3.3 各 section 线框

#### 账户 `/me/account`

```
 账户
 ┌──────────────────────────────────────────┐
 │ 头像     (img)   由 Google 管理 [前往更新] │
 │ 昵称     [JUNJIE DUAN                   ] │
 │ 邮箱     hello@gens.team (只读)│
 │                                          │
 │ [退出登录]                               │
 └──────────────────────────────────────────┘
```

昵称失焦或点保存提交；email 只读；头像跳 Google 不在站内改。

#### 通用 `/me/general`

```
 通用
 ┌──────────────────────────────────────────┐
 │ 外观主题  (o) 浅色  ( ) 深色  ( ) 跟随系统 │
 └──────────────────────────────────────────┘
```

单选立即生效并持久化。语言不在此处（见头像菜单）。

#### 个性化 `/me/personalization`

```
 个性化
 ┌──────────────────────────────────────────┐
 │ 我的消息样式  [样式A][样式B][样式C] ◄选中  │
 │ AI 消息样式   [样式A][样式B][样式C]        │
 │ 预览         ┌──────────────────────┐     │
 │              │ (实时渲染当前选择)    │     │
 │              └──────────────────────┘     │
 │ 兴趣标签      [AI] [设计] [+ 添加]         │
 └──────────────────────────────────────────┘
```

样式选择即时反映预览；兴趣标签可加可删。

#### API Keys `/me/api-keys`

```
 API Keys                          已配置 5 · 已捐赠 0
 ┌──────────────────────────────────────────────────┐
 │ [搜索 Provider...] [所有分类▾][所有状态▾] [+ 自定义]│
 │ ┌──────────────────────────────────────────────┐ │
 │ │ 名称       分类      Value   状态   用量  操作  │ │
 │ │ OpenAI    AI Model   —      未配置   0   [配置] │ │
 │ │ Anthropic AI Model   —      未配置   0   [配置] │ │
 │ │ xAI Grok  AI Model  xai-... 自用中 13k [编辑][删]│
 │ └──────────────────────────────────────────────┘ │
 └──────────────────────────────────────────────────┘
```

#### 我的模型 `/me/models` / 我的 Agent `/me/agents`

```
 我的模型 / 我的 Agent
 ┌──────────────────────────────────────────┐
 │ [+ 新建]                                  │
 │ ┌──────────────────────────────────────┐ │
 │ │ 名称        ...        [编辑] [删除]   │ │
 │ └──────────────────────────────────────┘ │
 └──────────────────────────────────────────┘
```

#### 集成 `/me/integrations`

```
 集成
 ┌──────────────────────────────────────────┐
 │ (Notion) Notion        已连接 2 工作区     │
 │          [添加工作区] [查看页面] [断开]     │
 │ (Drive)  Google Drive  未连接   [连接]     │
 │ (Feishu) 飞书          未绑定   [绑定]     │
 └──────────────────────────────────────────┘
```

#### 通知 `/me/notifications`

```
 通知
 ┌──────────────────────────────────────────┐
 │ 渠道  邮件接收 [x]                         │
 │       站内 + 实时推送 [x]                  │
 │       最高级(Tier 3)信号即时推 [ ]         │
 │ ─────────────────────────────────────    │
 │ 类型 × 渠道矩阵         邮件   站内   即时  │
 │ AI 雷达周报            [x]    [x]    [ ]   │
 │ ...                                       │
 └──────────────────────────────────────────┘
```

#### 账单 `/me/billing`

```
 账单
 ┌──────────────────────────────────────────┐
 │ 当前订阅  Plus · 自用中 · 续费 2026-06-11  │
 │          [管理订阅]                        │
 │ ─────────────────────────────────────    │
 │ 积分      余额 3877        [充值]          │
 │ 积分明细  ┌──────────────────────────┐    │
 │          │ 日期   类型   变动   余额  │    │
 │          └──────────────────────────┘    │
 │ ─────────────────────────────────────    │
 │ 用量统计  收藏 12 · 浏览 340 · 评论 8      │
 │          注册于 2026-01-15                │
 └──────────────────────────────────────────┘
```

### 3.3.4 边界状态（每个 section 通用）

| 状态                      | 呈现                                         |
| ------------------------- | -------------------------------------------- |
| 加载中                    | 右侧内容区 `LoadingState` 骨架               |
| 加载失败                  | `ErrorState` + 重试按钮                      |
| 空数据                    | `EmptyState`（如「暂无自定义模型」+ [新建]） |
| 未登录访问 `/me/*`        | 重定向 `/login?redirect=/me/[section]`       |
| 非法 section（`/me/xxx`） | `notFound()`（404）                          |

---

## 4. 关键决策

| 议题             | 决策                                                                        | 理由                                                         |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 积分位置         | 头像菜单显余额；`/me/billing` 放充值与明细；`/credits` 301 到 `/me/billing` | 余额高频（菜单直显），充值/明细低频（进 billing）；统一进 me |
| 用量统计         | 并入 `/me/billing`                                                          | 积分、订阅、用量同属消费视角，一处看全                       |
| profile god-page | 5 tab 内容拆迁到 me 各 section 后删除；`/profile` 301 到 `/me/account`      | 1431 行 god-page 是债务核心，彻底清理                        |
| 语言切换         | 头像菜单独立项，不进设置分类                                                | 高频操作，与 Claude 一致                                     |
| 弹窗 vs 整页     | 整页路由 `/me/[section]`                                                    | 有 URL，可深链与书签；嵌主 sidebar；空间充足                 |
| me hub（4 卡片） | 废弃，`/me` 301 到 `/me/account`                                            | hub 为过渡形态，由整页左导航取代                             |

---

## 5. 旧路由迁移映射

> 重定向类型：统一用 `permanent: false`（302），与 next.config 现有重定向一致（评审 R4
> 共识：项目惯例 302，过渡期保留改回灵活性，不影响外链兼容）。原文档"301"措辞作废。

next.config 302 重定向（外链兼容）：

| 旧路由                       | 新路由              |
| ---------------------------- | ------------------- |
| `/profile`                   | `/me/account`       |
| `/profile?tab=notifications` | `/me/notifications` |
| `/profile?tab=settings`      | `/me/general`       |
| `/profile?tab=stats`         | `/me/billing`       |
| `/profile?tab=integrations`  | `/me/integrations`  |
| `/me`（hub）                 | `/me/account`       |
| `/me/ai?tab=keys`            | `/me/api-keys`      |
| `/me/ai?tab=models`          | `/me/models`        |
| `/me/ai?tab=agents`          | `/me/agents`        |
| `/settings/notifications`    | `/me/notifications` |
| `/credits`                   | `/me/billing`       |

内部引用同步改源（非重定向，直接改源；R4 列出 + 实施期 grep 复核补 4 处，共 11 文件）：

| 文件                                                          | 行                      | 改动                                                                                                              |
| ------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `components/layout/Sidebar.tsx`                               | 797/808                 | `/me/ai?tab=agents` 改 `/me/agents`                                                                               |
| `components/layout/UserProfileButton.tsx`                     | 165/173/181             | 双入口（/profile + /me/ai）改单一 `/me/account`                                                                   |
| `app/custom-agents/new/page.tsx`                              | 11                      | redirect `/me/ai?tab=agents` 改 `/me/agents`                                                                      |
| `app/custom-agents/[id]/page.tsx`                             | 155                     | push `/me/ai?tab=agents` 改 `/me/agents`                                                                          |
| `app/custom-agents/[id]/run/page.tsx`                         | 93/120                  | href `/me/ai?tab=agents` 改 `/me/agents`                                                                          |
| `components/custom-agents/CustomAgentWizard.tsx`              | 380                     | push `/me/ai?tab=agents` 改 `/me/agents`（R4 漏，grep 补）                                                        |
| `app/unsubscribed/page.tsx`                                   | 114/138/158             | `window.location.href = '/settings/notifications'` 改 `router.push('/me/notifications')`                          |
| `app/settings/notifications/page.tsx`                         | 21                      | href `/profile?tab=notifications` 改 `/me/notifications`（R4 漏，grep 补；此页本身随 /settings 收敛，删除前先改） |
| `components/library/data-sources/DataSourcesTab.tsx`          | 501/504/534/537/567/570 | 6 处 `window.location.href = '/profile?tab=integrations'` 改 `router.push('/me/integrations')`                    |
| `components/library/import-panels/NotionImportPanel.tsx`      | 179                     | href `/profile?tab=integrations` 改 `/me/integrations`（R4 漏，grep 补）                                          |
| `components/library/import-panels/GoogleDriveImportPanel.tsx` | 200                     | href `/profile?tab=integrations` 改 `/me/integrations`（R4 漏，grep 补）                                          |
| `components/ai-radar/RadarTopicConfigDrawer.tsx`              | 399                     | href `/profile?tab=notifications` 改 `/me/notifications`                                                          |

> 评审共识：以上 `window.location.href` 硬跳一律改 `router.push`（避免整页刷新 + 配合客户端路由）。302 兜底仍保留以防遗漏。
> next.config.js:204 的 `/custom-agents → /me/ai?tab=agents` 重定向 destination 也需同步改为 `/me/agents`。

---

## 6. 保留能力清单

| 能力                       | 归位后位置                            |
| -------------------------- | ------------------------------------- |
| 积分余额                   | 头像菜单 + `/me/billing`              |
| 每日签到                   | 头像菜单                              |
| BYOK API Keys              | `/me/api-keys`                        |
| 自定义模型                 | `/me/models`                          |
| 自定义 Agent               | `/me/agents`                          |
| 集成 Notion/Drive/飞书     | `/me/integrations`                    |
| 通知偏好                   | `/me/notifications`                   |
| 个人资料（头像/昵称/兴趣） | `/me/account` + `/me/personalization` |
| 用量统计                   | `/me/billing`                         |
| 语言切换                   | 头像菜单                              |

---

## 7. 组件复用映射（实施后最终落点）

> 实施期目录归位：原 `components/profile/`、`components/settings/` 已 100% 收敛进
> `components/me/`（单一消费方即个人中心）；跨 feature 的 `components/byok/` 移到
> `components/common/byok/`。注册表也归位到 `components/me/`。详见 §10。

| section                                       | 复用组件                                                                  | 最终位置                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| api-keys                                      | `UserApiKeysTab` (+ `UserApiKeyDrawer`)                                   | components/me/api-keys/                                    |
| models                                        | `UserModelsManagement` (+ ConfigModal / IdSelector / AutoConfigureButton) | components/me/models/                                      |
| agents                                        | `MyAgentsTab`                                                             | components/custom-agents/（agents feature，me 嵌入复用）   |
| notifications                                 | `NotificationPreferencesView`                                             | components/me/notifications/                               |
| integrations                                  | Notion 内联 + `GoogleDriveConnectionCard` + `FeishuBindingCard`           | components/me/sections/ + components/library/integrations/ |
| account / general / personalization / billing | 从 profile god-page 抽取重组                                              | components/me/sections/                                    |

新建容器：

| 文件                                  | 职责                                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| `app/me/layout.tsx`                   | 左二级导航（分组）+ 主 sidebar 外壳 + 未登录守卫 + 移动端横向导航 |
| `app/me/[section]/page.tsx`           | 按 section 渲染内容，非法 section → notFound                      |
| `components/me/settings-sections.tsx` | 分类注册表 + 内容路由（9 section / 3 分组）                       |

暗色模式基建（用户选「真实接入」）：

| 文件                                 | 职责                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `stores/core/themeStore.ts`          | 新增 `appearance: 'light'\|'dark'\|'system'` + setter（持久化）                   |
| `components/common/ThemeApplier.tsx` | 写 `<html class="dark">` + color-scheme + 监听系统偏好                            |
| `app/globals.css`                    | `html.dark` 全站中性色重映射层（保留品牌/渐变/彩色），/me 用原生 `dark:` 精细适配 |

---

## 10. 实施期目录归位（2026-05-20）

| 原目录                                             | 去向                                                | 理由                                                                             |
| -------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `components/profile/` (6 文件)                     | `components/me/api-keys/` + `components/me/models/` | 重构后单一消费方即 /me，"profile" 为 god-page 遗留名                             |
| `components/settings/` (1 文件)                    | `components/me/notifications/`                      | 同上，仅喂 /me/notifications                                                     |
| `components/byok/` (4 文件)                        | `components/common/byok/`                           | 跨 feature 基建（Providers 引导拦截 + 全局错误弹窗 + AppShell 横幅），非 me 专属 |
| `components/common/settings/settings-sections.tsx` | `components/me/settings-sections.tsx`               | 单一消费方即 /me，归 feature 目录（标准线 178）                                  |

保留不动：`components/layout/`（结构 chrome 桶）、`components/agent-playground/`、`components/custom-agents/`
（目录名镜像各自路由段，符合约定；违和感属产品命名，重命名高风险低收益，不夹带本次）。

---

## 8. 实施计划

每阶段独立 commit，先 type-check 再提交。

| 阶段 | 内容                                                                                                                                                       | 验证                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A    | `me/[section]` 路由骨架 + layout 左导航 + settings-sections 挂现成 5 分类（api-keys / models / agents / notifications / integrations）；me hub 改 redirect | tsc 0 error；`/me/api-keys` 等可访问                   |
| B    | account / general / personalization 从 profile god-page 抽内容到 section                                                                                   | 3 个 section 内容完整渲染                              |
| C    | billing 整合（积分 / 订阅 / 充值 / 用量统计）                                                                                                              | billing 页内容完整                                     |
| D    | 头像菜单重构（单一设置入口 + 语言独立 + 保留积分/签到）                                                                                                    | 菜单交互正常                                           |
| E    | 旧路由 302（profile / me-ai / settings / credits）+ 内部引用改源（6 文件）+ 删 profile god-page                                                            | 旧链接 302 正常；god-page 删除；全局 grep 0 残留旧路由 |

> 阶段依赖：A 必须先行（路由骨架）。B 与 D 可并行（B 改 profile 内容、D 改头像菜单，互不冲突）。
> C 依赖 B（billing 复用 account 的 useAuth/积分数据）。E 必须最后（删源前确保所有 section 已落地）。

---

## 9. 评审共识修订（R1–R4）

> 4 路评审（R1 架构 / R2 前端实现 / R3 迁移风险 / R4 引用完整性）形成的共识，已回灌前文。
> 此节记录关键决策依据与实现约束，避免实施期重新争论。

### 9.1 信息架构（R1）

- **个性化（personalization）单 section 内分两块**：上半「聊天外观」（主题/字号/密度，复用 `useThemeStore`），
  下半「内容偏好」（默认创作语气/长度等）。不拆成两个独立菜单——避免菜单过碎。
- **用量统计并入 billing**，billing 页内分区：积分余额 → 订阅 → 充值 → 用量统计。不单列 section。
- **语言切换独立于 settings**：保留在头像菜单（即时切换无需进设置页），同时 general section 内也放一份
  （两处共用同一 `setLocale`）。这是用户明确要求（"语言是独立的啊"）。

### 9.2 实现约束（R2）

- **`settings-sections.tsx` 注册表结构**（分类驱动 + 内容路由）：

  ```typescript
  interface SettingsSection {
    id: string; // 'account' | 'general' | ... 对应 /me/[section]
    labelKey: string; // i18n key，禁硬编码中文
    icon: LucideIcon; // 禁 emoji
    group: "profile" | "ai" | "billing" | "system";
    component: React.ComponentType;
  }
  ```

- **i18n 语言切换机制**：`setLocale(locale)` 写 `localStorage['deepdive-locale']` + 触发 `useTranslation`
  重渲染。SSR/hydration 安全（沿用 Providers 层 isMounted 模式，不在 server 读 localStorage）。
- **集成卡 connect/disconnect 回调**：连接器状态机走现成 `DataSourcesTab` 的 callback，
  迁移时整块搬入 integrations section，不重写状态逻辑。
- **profile 数据来源澄清**：account/general 的数据来自 `useAuth`（资料）+ `useThemeStore`（外观）+
  `localStorage`（语言），**非独立 API**。仅 handleSaveProfile 的 `PATCH /auth/profile` 是网络调用。

### 9.3 迁移风险（R3）

- **profile god-page 65% 内联**：拆 section 时按数据归属分（资料→account、外观/语言→general、
  偏好→personalization），不要一次性平移再切——先按 section 重组内容再删源。
- **`MyAgentsTab` 的 `notifyCustomAgentChanged` 隐患**：agents section 复用此组件时，确认其
  跨组件事件（通知 Sidebar 刷新）在新路由下仍触发，否则 Sidebar 自定义 Agent 列表不更新。
- **验证手段**：A 阶段 tsc + 路由可达；B/C/D 各 section 内容渲染对照旧页逐项核对；
  E 阶段全局 grep `'/profile'` `'/me/ai'` `'/settings/notifications'` `'/credits'` 确认 0 残留。

---

| 项       | 值                                                            |
| -------- | ------------------------------------------------------------- |
| 维护者   | Claude Code                                                   |
| 关联规范 | `.claude/standards/02-directory-structure.md`（前端目录规范） |
