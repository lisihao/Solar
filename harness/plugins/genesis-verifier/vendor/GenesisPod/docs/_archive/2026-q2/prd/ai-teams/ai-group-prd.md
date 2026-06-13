# AI Group - 多人多AI协作社区

## 产品需求文档 (PRD)

**版本**: v1.0
**创建日期**: 2025-01-24
**产品负责人**: Genesis Team

---

## 一、产品概述

### 1.1 产品定位

AI Group 是一个基于 Topic 的多人多AI协作讨论社区，允许用户创建讨论组（Topic），邀请团队成员和多个AI模型参与讨论，通过 @mention 机制实现人与人、人与AI、AI与AI之间的互动，最终形成会议纪要或共识结论。

### 1.2 核心价值

| 价值维度       | 描述                                       |
| -------------- | ------------------------------------------ |
| **协作效率**   | 打破传统单人单AI对话模式，实现多方协同讨论 |
| **知识沉淀**   | 讨论过程完整留存，形成结构化的知识资产     |
| **AI能力融合** | 多AI模型参与，发挥不同模型的专长优势       |
| **决策支持**   | AI汇总多方观点，辅助形成共识和决策         |

### 1.3 目标用户

- 研发团队：技术方案讨论、Code Review、架构设计
- 研究团队：文献讨论、研究方向探索、学术协作
- 产品团队：需求评审、方案讨论、用户研究分析
- 跨职能团队：项目复盘、Brainstorming、问题定位

---

## 二、功能架构

### 2.1 功能层级图

```
AI Group
├── 群组管理层
│   ├── Topic 创建/删除/归档
│   ├── 成员管理（邀请/移除/权限）
│   ├── AI模型配置
│   └── 群组设置
│
├── 讨论交互层
│   ├── 消息发送（文本/富文本）
│   ├── @mention 机制（人/AI）
│   ├── 消息线程（Thread）
│   ├── 表情反应（Reactions）
│   └── 消息引用/回复
│
├── 资源共享层
│   ├── 文件上传/预览
│   ├── 链接解析/预览
│   ├── 从 Library 导入资源
│   ├── 资源关联到消息
│   └── 资源权限管理
│
├── AI 能力层
│   ├── AI 对话生成
│   ├── Prompt 透明展示
│   ├── 上下文管理
│   ├── 多模型切换
│   └── AI 汇总纪要
│
└── 输出沉淀层
    ├── 讨论纪要生成
    ├── 共识观点提取
    ├── 导出（Markdown/PDF）
    └── 归档到 Library
```

### 2.2 核心模块说明

#### 模块1：Topic 群组

Topic 是讨论的基本单位，类似 Slack Channel 或 Discord Server。

**属性设计**：
| 属性 | 类型 | 说明 |
|-----|------|------|
| id | UUID | 唯一标识 |
| name | string | 群组名称 |
| description | string | 群组描述/目标 |
| type | enum | PUBLIC（公开）/ PRIVATE（私有）/ ARCHIVED（归档）|
| createdBy | userId | 创建者 |
| createdAt | datetime | 创建时间 |
| settings | json | 群组配置（通知、权限等）|

#### 模块2：成员管理

**角色体系**：
| 角色 | 权限 |
|-----|------|
| **Owner** | 全部权限，可转让所有权，可删除群组 |
| **Admin** | 管理成员、管理AI、管理资源、编辑设置 |
| **Member** | 发消息、@人/AI、上传文件、查看资源 |
| **Guest** | 仅查看（只读模式）|

#### 模块3：AI 成员

AI模型作为特殊成员参与讨论。

**AI配置项**：
| 配置 | 说明 |
|-----|------|
| 模型选择 | Grok、GPT-4、Claude、Gemini 等 |
| 系统提示词 | 定义AI在群组中的角色和行为 |
| 上下文窗口 | 包含多少历史消息 |
| 响应风格 | 简洁/详细/学术/口语化 |
| 自动响应 | 是否自动参与（或仅被@时响应）|

---

## 三、核心交互流程

### 3.1 创建 Topic 流程

```
┌─────────────────────────────────────────────────────────────────┐
│  用户点击 "New Topic"                                            │
│       ↓                                                         │
│  填写基本信息（名称、描述、类型）                                  │
│       ↓                                                         │
│  邀请成员（搜索用户、批量导入）                                    │
│       ↓                                                         │
│  配置AI成员（选择模型、设置角色提示词）                            │
│       ↓                                                         │
│  完成创建，进入讨论页面                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 讨论交互流程

```
┌─────────────────────────────────────────────────────────────────┐
│  成员A: "我们讨论下这个技术方案，@AI-Grok 你怎么看？"              │
│       ↓                                                         │
│  [系统展示] Prompt: "请分析以下技术方案的优缺点..."               │
│       ↓                                                         │
│  AI-Grok: "从技术角度分析，这个方案有以下优势..."                  │
│       ↓                                                         │
│  成员B: "@AI-GPT4 能从性能角度补充一下吗？"                       │
│       ↓                                                         │
│  [系统展示] Prompt: "基于上文讨论，请从性能角度..."                │
│       ↓                                                         │
│  AI-GPT4: "从性能角度来看，需要注意..."                           │
│       ↓                                                         │
│  成员A: "@AI-Grok 能否汇总一下大家的观点？"                       │
│       ↓                                                         │
│  AI-Grok: "## 讨论纪要\n\n### 主要观点\n1. ..."                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 @Mention 机制

**触发方式**：

1. 输入 `@` 弹出成员/AI选择面板
2. 支持模糊搜索
3. 支持 `@all` 通知所有人（不含AI）
4. 支持 `@ai` 通知所有AI成员

**AI被@时的处理**：

1. 收集上下文（最近N条消息 + 被引用的消息）
2. 构建Prompt（系统提示词 + 上下文 + 用户消息）
3. 展示Prompt给所有成员（透明化）
4. 调用AI服务生成回复
5. 展示AI回复

---

## 四、页面设计

### 4.1 设计原则

- **扁平化**：Topic 列表直接在主内容区展示，不在 Sidebar 中嵌套
- **专注性**：进入 Topic 后全屏讨论，最大化对话空间
- **一致性**：与现有 Explore、Library 页面风格统一

### 4.2 侧边栏集成

在现有 Sidebar 中新增 AI Group 入口（仅作为入口，不展开子菜单）：

```tsx
// 菜单位置：在 AI Studio 之后，Notifications 之前
├── Explore (/)
├── My Library (/library)
├── AI Office (/ai-office)
├── AI Studio (/studio)
├── AI Group (/ai-group)      // 【新增】点击进入 Topic 列表页
└── Notifications (/notifications)
```

### 4.3 Topic 列表页（主页面）

**路由**：`/ai-group`

```
┌────────────────────────────────────────────────────────────────────────────┐
│  [现有 Sidebar]          │  [Main Content Area]                            │
│  ┌──────────────────┐    │                                                 │
│  │ Explore          │    │  ┌─────────────────────────────────────────────┐│
│  │ My Library       │    │  │  AI Group                    [+ New Topic]  ││
│  │ AI Office        │    │  │  多人多AI协作讨论社区                        ││
│  │ AI Studio        │    │  └─────────────────────────────────────────────┘│
│  │ AI Group (●)     │    │                                                 │
│  │ ─────────────    │    │  ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ Notifications    │    │  │ 📋      │ │ 📋      │ │ 📋      │           │
│  └──────────────────┘    │  │ 技术方案 │ │ 产品讨论 │ │ 周会    │           │
│                          │  │ 讨论    │ │         │ │         │           │
│                          │  │ ─────── │ │ ─────── │ │ ─────── │           │
│                          │  │ 👥5 🤖2  │ │ 👥3 🤖1  │ │ 👥8 🤖3  │           │
│                          │  │ 🔴 3未读 │ │         │ │ 🔴 12未读│           │
│                          │  │ 5分钟前  │ │ 2小时前 │ │ 昨天    │           │
│                          │  └─────────┘ └─────────┘ └─────────┘           │
│                          │                                                 │
│                          │  ┌─────────┐ ┌ ─ ─ ─ ─ ┐                       │
│                          │  │ 📋      │ │         │                       │
│                          │  │ 研究讨论 │ │ + 创建  │                       │
│                          │  │         │ │  新群组 │                       │
│                          │  └─────────┘ └ ─ ─ ─ ─ ┘                       │
└────────────────────────────────────────────────────────────────────────────┘
```

**页面元素**：

- **顶部 Header**：页面标题 + 副标题 + "New Topic" 按钮
- **卡片网格**：响应式布局，自动适配屏幕宽度
- **Topic 卡片信息**：
  - 群组图标/封面
  - 名称
  - 简短描述（单行截断）
  - 成员数 + AI数
  - 未读消息数（红点徽章）
  - 最近活跃时间

**卡片交互**：

- 点击卡片 → 进入 Topic 讨论页
- 右键/长按 → 快捷菜单（设置、归档、退出）

### 4.4 Topic 讨论页（双栏 Sidebar 设计）

**路由**：`/ai-group/[topicId]`

**核心设计**：进入 Topic 后，左侧采用**双栏结构**：

- **第一栏（窄）**：全局导航菜单**自动折叠**为图标模式，保持全局导航能力
- **第二栏（宽）**：Topic 成员列表（人员 + AI），方便 @mention

这样设计的优势：

- 保持全局导航能力，用户可随时切换到其他模块
- 成员列表常驻，方便快速 @mention
- 点击成员可直接插入 @ 到输入框
- 空间利用最大化

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [折叠导航] [成员面板]        │  [Topic 讨论页]                                    │
│ ┌────┐ ┌────────────────┐   │  ┌───────────────────────────────────────────────┐ │
│ │ 🏠 │ │ ← 返回列表     │   │  │ 技术方案讨论                 [📎] [📄] [⚙️]  │ │
│ │ 📚 │ │ ────────────── │   │  │ 5人参与 · 2个AI                              │ │
│ │ 📝 │ │                │   │  └───────────────────────────────────────────────┘ │
│ │ 🎨 │ │ 成员 (5)       │   │                                                    │
│ │────│ │ ┌────────────┐ │   │  ┌───────────────────────────────────────────────┐ │
│ │ 👥 │ │ │ 👤 张三    │ │   │  │                                               │ │
│ │ ◀──│─│ │   Owner 🟢 │ │   │  │  [消息流区域 - 可滚动]                         │ │
│ │────│ │ └────────────┘ │   │  │                                               │ │
│ │ 🔔 │ │ │ 👤 李四  🟢│ │   │  │  ┌───────────────────────────────────────┐    │ │
│ │ 👤 │ │ │ 👤 王五  ⚪│ │   │  │  │ 👤 张三                        10:30  │    │ │
│ └────┘ │ │ 👤 赵六  ⚪│ │   │  │  │ 我们讨论下这个技术方案，                │    │ │
│        │ │ 👤 钱七  🟢│ │   │  │  │ @AI-Grok 你怎么看？                    │    │ │
│        │ └────────────┘ │   │  │  │                           👍2 💬      │    │ │
│        │                │   │  │  └───────────────────────────────────────┘    │ │
│        │ AI (2)         │   │  │                                               │ │
│        │ ┌────────────┐ │   │  │  ┌───────────────────────────────────────┐    │ │
│        │ │ 🤖 AI-Grok │ │   │  │  │ 🤖 AI-Grok                     10:31  │    │ │
│        │ │   技术专家 │ │   │  │  │ ┌─ Prompt ────────────────────────┐   │    │ │
│        │ │   [配置]   │ │   │  │  │ │ 请分析以下技术方案的优缺点...   │   │    │ │
│        │ └────────────┘ │   │  │  │ └────────────────────────────────┘   │    │ │
│        │ ┌────────────┐ │   │  │  │ 从技术角度来看，这个方案有以下       │    │ │
│        │ │ 🤖 AI-GPT4 │ │   │  │  │ 优势：1. ... 2. ...                  │    │ │
│        │ │   产品顾问 │ │   │  │  │                           👍5 💬      │    │ │
│        │ │   [配置]   │ │   │  │  └───────────────────────────────────────┘    │ │
│        │ └────────────┘ │   │  │                                               │ │
│        │ ────────────── │   │  └───────────────────────────────────────────────┘ │
│        │ [+ 邀请成员]   │   │                                                    │
│        │ [+ 添加AI]     │   │  ┌───────────────────────────────────────────────┐ │
│        │ ────────────── │   │  │ [输入消息...]                                  │ │
│        │ 📁 资源 (8)    │   │  │                                               │ │
│        └────────────────┘   │  │ [📎 附件] [🔗 链接] [📄 Library]  │ [发送 ➤]  │ │
│                             │  └───────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**左侧双栏结构详解**：

| 栏位           | 宽度   | 内容                                                                                           |
| -------------- | ------ | ---------------------------------------------------------------------------------------------- |
| **折叠导航栏** | ~48px  | 全局导航图标：🏠 Explore、📚 Library、📝 Office、🎨 Studio、👥 Group（高亮）、🔔 通知、👤 个人 |
| **成员面板**   | ~200px | 返回按钮 + 成员列表 + AI列表 + 操作按钮 + 资源入口                                             |

**折叠导航栏**：
| 图标 | 对应页面 | 悬停提示 |
|-----|---------|---------|
| 🏠 | / | Explore |
| 📚 | /library | My Library |
| 📝 | /ai-office | AI Office |
| 🎨 | /studio | AI Studio |
| 👥 | /ai-group | AI Group（当前高亮）|
| 🔔 | /notifications | Notifications |
| 👤 | - | 个人资料 |

**成员面板结构**：

| 区域       | 内容                                                      |
| ---------- | --------------------------------------------------------- |
| **顶部**   | ← 返回按钮（返回 Topic 列表）                             |
| **成员区** | 人员列表，显示头像、昵称、角色、在线状态（🟢在线/⚪离线） |
| **AI区**   | AI成员列表，显示图标、名称、角色描述、[配置]按钮          |
| **操作区** | [+ 邀请成员]、[+ 添加AI] 按钮                             |
| **底部**   | 📁 共享资源入口（点击展开资源面板，显示资源数量）         |

**成员面板交互**：
| 操作 | 效果 |
|-----|------|
| 点击人员 | 在输入框自动插入 @用户名 |
| 点击AI | 在输入框自动插入 @AI名称 |
| 点击 [配置] | 弹出AI配置弹窗（修改提示词、响应风格等）|
| 悬停成员 | 显示详细信息卡片（头像、简介、最近发言）|
| 右键成员 | 上下文菜单（查看资料、修改角色、移除等）|
| 点击资源入口 | 展开共享资源抽屉面板 |

**顶部 Header**：
| 元素 | 功能 |
|-----|------|
| Topic 名称 | 显示当前群组名称 |
| 副标题 | 成员数 + AI数 |
| 📎 附件 | 快速上传文件 |
| 📄 资源 | 展开共享资源面板 |
| ⚙️ 设置 | 进入 Topic 设置页 |

**消息流区域**：

- 自动滚动到最新消息
- 支持向上滚动加载历史消息
- 消息按日期分组显示
- AI消息特殊样式 + Prompt 可折叠展示
- 点击消息中的 @用户名 高亮左侧对应成员

**输入区域**：

- 支持 @mention（输入 @ 弹出选择器，或直接点击左侧成员）
- 附件上传按钮
- 链接粘贴按钮
- Library 资源导入按钮
- 发送按钮（Enter 发送，Shift+Enter 换行）

### 4.5 Sidebar 模式切换逻辑

```typescript
// 伪代码：根据路由决定 Sidebar 布局模式
function getSidebarMode(pathname: string) {
  if (pathname.match(/^\/ai-group\/[^/]+$/)) {
    // Topic 详情页：双栏模式（折叠导航 + 成员面板）
    return 'topic-detail'
  } else {
    // 其他页面：标准模式（可展开/折叠的导航菜单）
    return 'standard'
  }
}

// Sidebar 组件
function Sidebar({ mode, topicId }) {
  if (mode === 'topic-detail') {
    return (
      <div className="flex">
        <CollapsedNavigation />           {/* 48px 图标导航 */}
        <TopicMemberPanel topicId={topicId} />  {/* 200px 成员面板 */}
      </div>
    )
  }
  return <StandardNavigation />  {/* 标准导航菜单 */}
}
```

**切换动画**：

- 从 Topic 列表进入详情页：导航栏平滑折叠，成员面板滑入
- 返回列表页时：成员面板滑出，导航栏展开恢复

### 4.6 资源存储与展示设计

用户在讨论中分享的附件、链接等资源，需要合理组织和展示。

#### 资源分类

| 类型             | 来源              | 存储位置            | 说明                               |
| ---------------- | ----------------- | ------------------- | ---------------------------------- |
| **消息附件**     | 发消息时上传/粘贴 | 关联到 TopicMessage | 跟随消息展示，删除消息时一并删除   |
| **共享资源**     | 主动添加到群组    | TopicResource 表    | 独立于消息，长期保存，所有成员可见 |
| **Library 引用** | 从 Library 导入   | 引用 Resource ID    | 不复制，只建立关联                 |

#### 资源上传入口

```
┌─────────────────────────────────────────────────────────────────────────┐
│  输入区域                                                               │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ [输入消息... 支持拖拽文件到此处]                                    │ │
│  │                                                                   │ │
│  │ ┌─────────────────────────────────────────────────────────────┐   │ │
│  │ │ 📄 技术方案v2.pdf                              [×]          │   │ │  ← 待发送附件预览
│  │ └─────────────────────────────────────────────────────────────┘   │ │
│  │                                                                   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  [📎 上传文件] [🔗 粘贴链接] [📚 从Library导入] [☁️ 添加到共享]  [发送 ➤]│
│       ↓              ↓              ↓                ↓                  │
│    本地文件      URL链接       选择已有资源      保存到群组资源库        │
└─────────────────────────────────────────────────────────────────────────┘
```

**上传方式**：
| 入口 | 操作 | 结果 |
|-----|------|------|
| 📎 上传文件 | 选择本地文件 | 附件随消息发送，自动添加到共享资源 |
| 🔗 粘贴链接 | 输入URL | 解析链接预览，随消息发送 |
| 📚 从Library | 弹窗选择资源 | 引用Library资源，显示在消息中 |
| ☁️ 添加到共享 | 直接添加资源 | 不发消息，仅添加到共享资源库 |
| 拖拽 | 拖文件到输入框 | 等同于📎上传 |
| Ctrl+V | 粘贴图片/文件 | 自动识别并上传 |

#### 消息中的资源展示

```
┌─────────────────────────────────────────────────────────────────┐
│ 👤 张三                                              10:30     │
│                                                                 │
│ 大家看下这个方案文档，@AI-Grok 帮忙分析一下可行性               │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 📄 技术方案v2.pdf                                           │ │
│ │ 2.3 MB · PDF · [预览] [下载] [添加到共享资源]               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🔗 https://github.com/example/repo                          │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ 🐙 example/repo                                         │ │ │
│ │ │ A sample repository for demonstration                   │ │ │
│ │ │ ⭐ 1.2k  🍴 234  Updated 2 days ago                      │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│                                              👍2  💬3  📌      │
└─────────────────────────────────────────────────────────────────┘
```

**消息附件操作**：
| 操作 | 说明 |
|-----|------|
| 预览 | 图片直接展示，PDF/文档弹窗预览 |
| 下载 | 下载原始文件 |
| 添加到共享资源 | 将此附件添加到群组共享资源库 |
| 📌 收藏 | 将此消息标记为重要（方便后续查找）|

#### 共享资源面板

点击成员面板底部的「📁 资源」或顶部 Header 的资源图标，展开共享资源面板：

```
┌──────────────────────────────────────────┐
│ 共享资源                            [×]  │
│ ────────────────────────────────────────│
│ 🔍 [搜索资源...]                        │
│ ────────────────────────────────────────│
│                                          │
│ 📁 文档 (3)                         [▼] │
│ ├── 📄 技术方案v2.pdf          张三     │
│ ├── 📄 需求文档.docx           李四     │
│ └── 📄 API设计.md              王五     │
│                                          │
│ 🔗 链接 (4)                         [▼] │
│ ├── 🐙 github.com/example/repo          │
│ ├── 📝 notion.so/meeting-notes          │
│ ├── 📊 figma.com/design-v2              │
│ └── 🌐 docs.example.com                 │
│                                          │
│ 📚 Library资源 (2)                  [▼] │
│ ├── 📑 [Paper] Attention Is All...      │
│ └── 📑 [Paper] BERT: Pre-training...    │
│                                          │
│ 🖼️ 图片 (5)                         [▼] │
│ ├── 🖼️ 架构图.png                       │
│ └── 🖼️ 流程图.png                       │
│     ... 还有3张                          │
│                                          │
│ ────────────────────────────────────────│
│ [+ 上传文件] [+ 添加链接] [+ 从Library] │
└──────────────────────────────────────────┘
```

**共享资源操作**：
| 操作 | 说明 |
|-----|------|
| 点击资源 | 预览/打开 |
| 右键资源 | 下载、复制链接、删除、查看来源消息 |
| 搜索 | 按名称搜索资源 |
| 分类折叠 | 按类型分组，可折叠/展开 |
| 添加资源 | 三种方式：上传、链接、Library导入 |

#### 资源与消息的关联

每个共享资源可以关联到来源消息，方便追溯上下文：

```
资源详情弹窗：
┌──────────────────────────────────────────┐
│ 📄 技术方案v2.pdf                        │
│ ────────────────────────────────────────│
│ 大小: 2.3 MB                             │
│ 类型: PDF                                │
│ 上传者: 张三                             │
│ 上传时间: 2025-01-24 10:30               │
│ ────────────────────────────────────────│
│ 📍 来源消息:                             │
│ ┌──────────────────────────────────────┐ │
│ │ 张三: 大家看下这个方案文档...        │ │
│ │                        [跳转到消息]  │ │
│ └──────────────────────────────────────┘ │
│ ────────────────────────────────────────│
│ [预览] [下载] [复制链接] [删除]          │
└──────────────────────────────────────────┘
```

#### AI 访问资源

当 @AI 时，AI 可以访问群组的共享资源：

```
用户: @AI-Grok 帮我总结一下共享资源里的技术方案文档

系统构建Prompt时：
1. 检测到用户引用了共享资源
2. 获取资源内容（PDF解析/链接抓取）
3. 将内容注入到AI上下文中

Prompt 示例：
┌─ Prompt ───────────────────────────────────────────┐
│ 用户请求你总结群组共享资源中的文档。                │
│                                                    │
│ 附件内容（技术方案v2.pdf）：                        │
│ """                                                │
│ 1. 项目背景...                                     │
│ 2. 技术选型...                                     │
│ """                                                │
│                                                    │
│ 请根据以上内容进行总结。                           │
└────────────────────────────────────────────────────┘
```

### 4.7 Topic 设置页

**路由**：`/ai-group/[topicId]/settings`（或使用弹窗/抽屉）

**Tab 结构**：

1. **基本信息**：名称、描述、封面图、类型（公开/私有）
2. **成员管理**：邀请、移除、角色调整
3. **AI 配置**：添加/移除AI、调整系统提示词、响应风格
4. **资源管理**：查看/删除共享资源、存储用量统计
5. **纪要管理**：历史纪要列表、导出
6. **高级设置**：通知偏好、归档、删除群组

---

## 五、数据模型设计

### 5.1 核心数据表

```prisma
// Topic 群组
model Topic {
  id          String   @id @default(uuid())
  name        String
  description String?
  type        TopicType @default(PRIVATE)
  avatar      String?

  createdById String
  createdBy   User     @relation("TopicCreator", fields: [createdById], references: [id])

  settings    Json?    // 群组设置
  metadata    Json?    // 扩展元数据

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  archivedAt  DateTime?

  members     TopicMember[]
  aiMembers   TopicAIMember[]
  messages    TopicMessage[]
  resources   TopicResource[]
  summaries   TopicSummary[]
}

enum TopicType {
  PUBLIC
  PRIVATE
  ARCHIVED
}

// Topic 成员
model TopicMember {
  id        String   @id @default(uuid())

  topicId   String
  topic     Topic    @relation(fields: [topicId], references: [id], onDelete: Cascade)

  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  role      TopicRole @default(MEMBER)
  nickname  String?   // 群昵称

  joinedAt  DateTime @default(now())
  lastReadAt DateTime?

  @@unique([topicId, userId])
}

enum TopicRole {
  OWNER
  ADMIN
  MEMBER
  GUEST
}

// Topic AI成员
model TopicAIMember {
  id             String   @id @default(uuid())

  topicId        String
  topic          Topic    @relation(fields: [topicId], references: [id], onDelete: Cascade)

  aiModel        String   // grok, gpt-4, claude, gemini
  displayName    String   // 显示名称，如 "AI-Grok"
  avatar         String?

  systemPrompt   String?  // 系统提示词
  contextWindow  Int      @default(20)  // 上下文消息数
  responseStyle  String?  // concise, detailed, academic
  autoRespond    Boolean  @default(false) // 是否自动参与

  addedById      String
  addedBy        User     @relation(fields: [addedById], references: [id])

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([topicId, aiModel, displayName])
}

// Topic 消息
model TopicMessage {
  id          String   @id @default(uuid())

  topicId     String
  topic       Topic    @relation(fields: [topicId], references: [id], onDelete: Cascade)

  // 发送者（人或AI）
  senderId    String?  // 如果是人
  sender      User?    @relation(fields: [senderId], references: [id])
  aiMemberId  String?  // 如果是AI
  aiMember    TopicAIMember? @relation(fields: [aiMemberId], references: [id])

  content     String   @db.Text
  contentType MessageContentType @default(TEXT)

  // AI消息特有
  prompt      String?  @db.Text  // AI收到的Prompt（透明化）
  modelUsed   String?  // 实际使用的模型
  tokensUsed  Int?     // Token消耗

  // 回复/引用
  replyToId   String?
  replyTo     TopicMessage? @relation("MessageReplies", fields: [replyToId], references: [id])
  replies     TopicMessage[] @relation("MessageReplies")

  // @mentions
  mentions    TopicMessageMention[]

  // 附件
  attachments TopicMessageAttachment[]

  // 反应
  reactions   TopicMessageReaction[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?
}

enum MessageContentType {
  TEXT
  RICH_TEXT
  CODE
  IMAGE
  FILE
  SYSTEM  // 系统消息：成员加入、AI添加等
}

// 消息@提及
model TopicMessageMention {
  id          String   @id @default(uuid())

  messageId   String
  message     TopicMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)

  // 被@的对象
  userId      String?
  user        User?    @relation(fields: [userId], references: [id])
  aiMemberId  String?
  aiMember    TopicAIMember? @relation(fields: [aiMemberId], references: [id])
  mentionType MentionType // USER, AI, ALL, ALL_AI

  @@index([messageId])
}

enum MentionType {
  USER
  AI
  ALL      // @all - 所有人
  ALL_AI   // @ai - 所有AI
}

// 消息附件
model TopicMessageAttachment {
  id          String   @id @default(uuid())

  messageId   String
  message     TopicMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)

  type        AttachmentType
  name        String
  url         String
  size        Int?
  mimeType    String?

  // 如果是从Library导入的资源
  resourceId  String?
  resource    Resource? @relation(fields: [resourceId], references: [id])

  createdAt   DateTime @default(now())
}

enum AttachmentType {
  FILE
  IMAGE
  LINK
  RESOURCE  // Library资源
}

// 消息反应
model TopicMessageReaction {
  id          String   @id @default(uuid())

  messageId   String
  message     TopicMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)

  userId      String
  user        User     @relation(fields: [userId], references: [id])

  emoji       String   // 表情符号

  createdAt   DateTime @default(now())

  @@unique([messageId, userId, emoji])
}

// Topic 共享资源
model TopicResource {
  id          String   @id @default(uuid())

  topicId     String
  topic       Topic    @relation(fields: [topicId], references: [id], onDelete: Cascade)

  type        TopicResourceType
  name        String
  url         String?

  // 如果是从Library导入
  resourceId  String?
  resource    Resource? @relation(fields: [resourceId], references: [id])

  // 如果是上传的文件
  fileUrl     String?
  fileSize    Int?
  mimeType    String?

  addedById   String
  addedBy     User     @relation(fields: [addedById], references: [id])

  createdAt   DateTime @default(now())
}

enum TopicResourceType {
  LINK
  FILE
  LIBRARY_RESOURCE
}

// Topic 讨论纪要
model TopicSummary {
  id          String   @id @default(uuid())

  topicId     String
  topic       Topic    @relation(fields: [topicId], references: [id], onDelete: Cascade)

  title       String
  content     String   @db.Text

  // 纪要范围
  fromMessageId String?
  toMessageId   String?

  // 生成信息
  generatedBy   String   // AI模型
  prompt        String?  @db.Text

  createdById   String
  createdBy     User     @relation(fields: [createdById], references: [id])

  createdAt     DateTime @default(now())
}
```

### 5.2 User 模型扩展

```prisma
model User {
  // ... 现有字段 ...

  // 新增 AI Group 相关
  createdTopics    Topic[]         @relation("TopicCreator")
  topicMemberships TopicMember[]
  topicMessages    TopicMessage[]
  topicReactions   TopicMessageReaction[]
  addedAIMembers   TopicAIMember[]
  topicResources   TopicResource[]
  topicSummaries   TopicSummary[]
  messageMentions  TopicMessageMention[]
}
```

---

## 六、API 设计

### 6.1 RESTful API

```
# Topic 管理
POST   /api/topics                    # 创建 Topic
GET    /api/topics                    # 获取我的 Topic 列表
GET    /api/topics/:id                # 获取 Topic 详情
PATCH  /api/topics/:id                # 更新 Topic
DELETE /api/topics/:id                # 删除 Topic
POST   /api/topics/:id/archive        # 归档 Topic

# 成员管理
GET    /api/topics/:id/members        # 获取成员列表
POST   /api/topics/:id/members        # 邀请成员
PATCH  /api/topics/:id/members/:uid   # 更新成员角色
DELETE /api/topics/:id/members/:uid   # 移除成员
POST   /api/topics/:id/leave          # 退出群组

# AI成员管理
GET    /api/topics/:id/ai-members     # 获取AI成员列表
POST   /api/topics/:id/ai-members     # 添加AI成员
PATCH  /api/topics/:id/ai-members/:aid # 更新AI配置
DELETE /api/topics/:id/ai-members/:aid # 移除AI成员

# 消息
GET    /api/topics/:id/messages       # 获取消息列表（分页）
POST   /api/topics/:id/messages       # 发送消息
PATCH  /api/topics/:id/messages/:mid  # 编辑消息
DELETE /api/topics/:id/messages/:mid  # 删除消息

# 消息交互
POST   /api/topics/:id/messages/:mid/reactions  # 添加反应
DELETE /api/topics/:id/messages/:mid/reactions/:emoji # 移除反应

# 资源管理
GET    /api/topics/:id/resources      # 获取共享资源
POST   /api/topics/:id/resources      # 添加资源
DELETE /api/topics/:id/resources/:rid # 移除资源

# AI 能力
POST   /api/topics/:id/ai/generate    # AI生成回复
POST   /api/topics/:id/ai/summarize   # AI生成纪要

# 纪要管理
GET    /api/topics/:id/summaries      # 获取纪要列表
POST   /api/topics/:id/summaries      # 创建纪要
DELETE /api/topics/:id/summaries/:sid # 删除纪要
POST   /api/topics/:id/summaries/:sid/export # 导出纪要
```

### 6.2 WebSocket 事件

```typescript
// 客户端 -> 服务端
interface ClientEvents {
  "topic:join": { topicId: string };
  "topic:leave": { topicId: string };
  "message:send": { topicId: string; content: string; mentions: Mention[] };
  "message:typing": { topicId: string };
  "message:read": { topicId: string; messageId: string };
}

// 服务端 -> 客户端
interface ServerEvents {
  "message:new": TopicMessage;
  "message:update": TopicMessage;
  "message:delete": { messageId: string };
  "member:join": TopicMember;
  "member:leave": { userId: string };
  "ai:typing": { topicId: string; aiMemberId: string };
  "ai:response": TopicMessage;
  "reaction:add": { messageId: string; userId: string; emoji: string };
  "reaction:remove": { messageId: string; userId: string; emoji: string };
}
```

---

## 七、AI 能力设计

### 7.1 AI 上下文构建

```typescript
interface AIContext {
  // 系统层
  systemPrompt: string; // AI角色定义
  topicInfo: {
    // Topic信息
    name: string;
    description: string;
    memberCount: number;
  };

  // 历史消息
  recentMessages: Message[]; // 最近N条消息
  referencedMessage?: Message; // 被回复的消息

  // 共享资源摘要
  sharedResources?: ResourceSummary[];

  // 当前请求
  userMessage: string; // 用户发送的消息
  mentionContext: string; // @的具体指令
}
```

### 7.2 Prompt 模板

```markdown
# AI Group 标准 Prompt 模板

## System Prompt

你是 {displayName}，一个参与群组讨论的AI助手。
群组名称：{topicName}
群组目标：{topicDescription}
你的角色：{customSystemPrompt}

## 讨论上下文

以下是最近的讨论内容：
{recentMessages}

## 共享资源

群组中共享了以下资源供参考：
{sharedResources}

## 当前请求

{userMessage}

## 回复要求

- 保持{responseStyle}的风格
- 直接回应被@的问题
- 如果涉及其他成员的观点，可以引用
- 回复使用中文
```

### 7.3 纪要生成 Prompt

```markdown
# 讨论纪要生成 Prompt

## 讨论内容

{allMessages}

## 任务

请根据以上讨论内容，生成一份结构化的讨论纪要，包含：

1. **讨论主题**：一句话总结讨论的核心议题

2. **参与者**：列出参与讨论的成员和AI

3. **主要观点**：
   - 按发言人整理各自的核心观点
   - 标注观点的支持者

4. **分歧与争议**：
   - 如有不同意见，列出各方立场
   - 标注争议点

5. **共识结论**：
   - 总结达成共识的内容
   - 如无共识，说明待定事项

6. **行动项**（如有）：
   - 列出讨论中提到的待办事项
   - 标注责任人

7. **遗留问题**：
   - 未解决的问题
   - 需要进一步讨论的内容

## 格式要求

- 使用 Markdown 格式
- 观点需要引用原话佐证
- 保持客观中立
```

---

## 八、技术实现方案

### 8.1 前端技术选型

| 功能       | 技术方案                     |
| ---------- | ---------------------------- |
| 消息列表   | React Virtualized + 无限滚动 |
| 实时通信   | Socket.io-client             |
| 富文本编辑 | TipTap（复用现有）           |
| @mention   | TipTap Mention Extension     |
| 状态管理   | Zustand（aiGroupStore）      |
| 消息缓存   | React Query + IndexedDB      |

### 8.2 后端技术选型

| 功能      | 技术方案                       |
| --------- | ------------------------------ |
| API       | NestJS Controller + Service    |
| WebSocket | @nestjs/websockets + Socket.io |
| 消息队列  | Redis Pub/Sub（多实例同步）    |
| AI调用    | 现有 ai-service（FastAPI）     |
| 文件存储  | 现有方案（S3/本地）            |

### 8.3 目录结构

```
frontend/
├── app/
│   └── ai-group/
│       ├── page.tsx              # Topic 列表页
│       ├── [topicId]/
│       │   ├── page.tsx          # 讨论详情页
│       │   └── settings/
│       │       └── page.tsx      # 设置页
│       └── new/
│           └── page.tsx          # 创建 Topic 页
│
├── components/
│   └── ai-group/
│       ├── TopicCard.tsx         # Topic 卡片
│       ├── TopicList.tsx         # Topic 列表
│       ├── MessageStream.tsx     # 消息流
│       ├── MessageItem.tsx       # 单条消息
│       ├── MessageInput.tsx      # 消息输入框
│       ├── MentionSelector.tsx   # @选择器
│       ├── MemberList.tsx        # 成员列表
│       ├── AIConfigPanel.tsx     # AI配置面板
│       ├── ResourcePanel.tsx     # 资源面板
│       ├── SummaryDialog.tsx     # 纪要生成弹窗
│       └── PromptDisplay.tsx     # Prompt展示组件
│
├── stores/
│   └── aiGroupStore.ts           # AI Group 状态管理
│
└── lib/
    └── api/
        └── ai-group.ts           # API 调用封装

backend/
└── src/
    └── modules/
        └── ai-group/
            ├── ai-group.module.ts
            ├── ai-group.controller.ts
            ├── ai-group.service.ts
            ├── ai-group.gateway.ts      # WebSocket
            ├── dto/
            │   ├── create-topic.dto.ts
            │   ├── send-message.dto.ts
            │   └── ...
            └── entities/
```

---

## 九、开发计划

### Phase 1: 基础框架（MVP）

**目标**：实现最小可用版本

- [ ] 数据模型设计和迁移
- [ ] Topic CRUD API
- [ ] 成员管理 API
- [ ] 基础消息发送和展示
- [ ] 前端页面框架
- [ ] Sidebar 菜单集成

### Phase 2: AI 集成

**目标**：实现 AI 参与讨论

- [ ] AI 成员管理
- [ ] @mention 机制
- [ ] AI 上下文构建
- [ ] Prompt 透明展示
- [ ] AI 回复生成

### Phase 3: 实时通信

**目标**：实现实时讨论体验

- [ ] WebSocket 集成
- [ ] 实时消息推送
- [ ] 在线状态显示
- [ ] 输入中提示
- [ ] 消息已读状态

### Phase 4: 资源共享

**目标**：实现资源协作

- [ ] 文件上传
- [ ] 链接解析和预览
- [ ] Library 资源导入
- [ ] 资源面板展示

### Phase 5: 纪要与导出

**目标**：实现讨论沉淀

- [ ] AI 纪要生成
- [ ] 纪要编辑和管理
- [ ] Markdown/PDF 导出
- [ ] 归档到 Library

### Phase 6: 优化与扩展

**目标**：提升体验和性能

- [ ] 消息搜索
- [ ] 通知系统集成
- [ ] 性能优化（虚拟列表、消息缓存）
- [ ] 移动端适配

---

## 十、风险与对策

| 风险         | 影响         | 对策                          |
| ------------ | ------------ | ----------------------------- |
| AI 响应延迟  | 用户体验差   | 流式输出、加载状态、超时处理  |
| 消息量大     | 性能问题     | 虚拟列表、分页加载、消息归档  |
| 多AI同时响应 | 混乱、成本高 | 默认关闭自动响应，仅@时触发   |
| 上下文过长   | Token消耗大  | 智能截断、摘要压缩            |
| 实时同步     | 复杂度高     | 渐进式实现，先轮询后WebSocket |

---

## 十一、成功指标

| 指标             | 目标   | 说明        |
| ---------------- | ------ | ----------- |
| Topic 创建数     | -      | 用户参与度  |
| 日活跃 Topic 数  | -      | 功能活跃度  |
| 平均消息数/Topic | >20    | 讨论深度    |
| AI 参与率        | >50%   | AI 价值验证 |
| 纪要生成数       | -      | 输出价值    |
| 用户满意度       | >4.0/5 | NPS 调研    |

---

## 十二、附录

### A. 竞品参考

| 产品            | 特点                  | 可借鉴       |
| --------------- | --------------------- | ------------ |
| Slack           | Channel 模式、Thread  | 消息组织方式 |
| Discord         | 服务器/频道、角色权限 | 权限体系     |
| Notion AI       | AI 内嵌文档           | AI 集成方式  |
| Claude Projects | 项目上下文            | 资源共享机制 |
| ChatGPT Team    | 团队协作              | 多人AI协作   |

### B. 术语表

| 术语      | 定义                                    |
| --------- | --------------------------------------- |
| Topic     | 讨论群组，AI Group 的基本组织单位       |
| AI Member | 作为群组成员参与讨论的 AI 模型          |
| @mention  | 通过 @ 符号触发特定成员或 AI 的提及机制 |
| Prompt    | 发送给 AI 的完整指令，包含上下文和请求  |
| Summary   | AI 生成的讨论纪要                       |
| Thread    | 消息的回复链，用于组织相关讨论          |

---

_文档版本历史_

| 版本 | 日期       | 作者   | 变更说明 |
| ---- | ---------- | ------ | -------- |
| v1.0 | 2025-01-24 | Claude | 初版创建 |
