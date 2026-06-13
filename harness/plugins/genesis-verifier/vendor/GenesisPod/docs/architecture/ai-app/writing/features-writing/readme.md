# AI Writing 模块技术文档

> 基于 AI Teams Engine 架构，实现专业的长篇小说创作系统，从根本上解决 AI 生成内容的一致性问题。

---

## 一、模块概述

### 1.1 核心目标

AI Writing 模块旨在解决 AI 生成长篇小说时常见的一致性问题：

| 问题类型       | 具体表现                       | 解决方案               |
| -------------- | ------------------------------ | ---------------------- |
| 角色描述不一致 | 胎记颜色从"浅褐色"变成"朱砂红" | Story Bible 统一设定源 |
| 事件冲突       | 同一角色的受伤原因前后矛盾     | 一致性引擎自动校验     |
| 身份跳跃       | 秀女→小主的转变无交代          | 时间线追踪机制         |
| 时间线混乱     | 事件发生顺序不明确             | TimelineEvent 记录     |

### 1.2 核心理念

**Story Bible（设定圣经）+ 专职守护者 + 自动化校验**

```
┌─────────────────────────────────────────────────────────────────┐
│                     Story Bible（设定圣经）                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ 角色档案 │ │ 世界观   │ │ 时间线   │ │ 术语表   │           │
│  │ 状态追踪 │ │ 地理/势力│ │ 事件记录 │ │ 专有名词 │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              ↑↓
┌─────────────────────────────────────────────────────────────────┐
│                    Consistency Engine（一致性引擎）              │
│  Pre-Write Injection → Post-Write Validation → Conflict Fix    │
└─────────────────────────────────────────────────────────────────┘
                              ↑↓
┌─────────────────────────────────────────────────────────────────┐
│                    AI Writing Team（写作团队）                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ 故事架构师 │ │ 圣经守护者 │ │ 写作Agent  │ │ 一致性校验 │   │
│  │  (Leader)  │ │ (Keeper)   │ │  (Writer)  │ │  (Checker) │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、数据模型

### 2.1 核心模型

| 模型                    | 说明                     |
| ----------------------- | ------------------------ |
| `WritingProject`        | 写作项目主体             |
| `StoryBible`            | 设定圣经（1:1 关联项目） |
| `WritingCharacter`      | 角色档案（含状态追踪）   |
| `CharacterRelationship` | 角色关系网络             |
| `WorldSetting`          | 世界设定                 |
| `Faction`               | 势力/组织                |
| `Terminology`           | 术语表                   |
| `TimelineEvent`         | 时间线事件               |
| `WritingVolume`         | 卷                       |
| `WritingChapter`        | 章节                     |
| `WritingScene`          | 场景                     |
| `SceneAppearance`       | 角色出场记录             |
| `ConsistencyCheck`      | 一致性检查记录           |
| `WritingMission`        | 写作任务                 |

### 2.2 关键枚举

```typescript
enum WritingProjectStatus {
  PLANNING      // 规划中
  OUTLINING     // 大纲设计
  WRITING       // 写作中
  REVISING      // 修订中
  COMPLETED     // 已完成
}

enum CharacterRole {
  PROTAGONIST   // 主角
  ANTAGONIST    // 反派
  SUPPORTING    // 配角
  MINOR         // 龙套
}

enum ChapterStatus {
  PLANNED       // 已规划
  OUTLINING     // 大纲中
  WRITING       // 写作中
  DRAFT         // 初稿
  CHECKING      // 校验中
  REVISING      // 修订中
  FINAL         // 定稿
}
```

---

## 三、后端服务架构

### 3.1 目录结构

```
backend/src/modules/ai-app/writing/
├── ai-writing.module.ts          # 模块定义
├── ai-writing.controller.ts      # API 控制器
├── ai-writing.service.ts         # 主服务
├── dto/                          # 数据传输对象
│   ├── project.dto.ts
│   ├── character.dto.ts
│   ├── volume.dto.ts
│   └── chapter.dto.ts
└── services/
    ├── bible/                    # Story Bible 服务
    │   ├── story-bible.service.ts
    │   ├── character.service.ts
    │   ├── world-setting.service.ts
    │   ├── timeline.service.ts
    │   └── terminology.service.ts
    ├── writing/                  # 写作服务
    │   ├── project.service.ts
    │   ├── chapter-writing.service.ts
    │   ├── context-builder.service.ts
    │   └── outline.service.ts
    ├── consistency/              # 一致性引擎
    │   ├── consistency-engine.service.ts
    │   ├── pre-write-injection.service.ts
    │   ├── post-write-validation.service.ts
    │   └── conflict-resolution.service.ts
    └── parallel/                 # 并行写作支持
        ├── parallel-orchestrator.service.ts
        ├── chapter-dependency.service.ts
        ├── writer-pool.service.ts
        └── parallel-conflict-detector.service.ts
```

### 3.2 核心服务说明

#### ConsistencyEngineService

一致性引擎主服务，负责：

- 构建写作上下文（Pre-Write Injection）
- 校验章节一致性（Post-Write Validation）
- 协调冲突解决（Conflict Resolution）

#### ParallelOrchestratorService

并行写作编排器，负责：

- 分析章节依赖关系
- 生成执行计划
- 协调多 Writer 并行执行
- 检测跨章节冲突

---

## 四、并行写作机制

### 4.1 并行架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Parallel Writing Architecture                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [Story Architect]                                                   │
│        │                                                             │
│        ├── 分析章节依赖关系                                          │
│        │   ├── 独立章节 → 可并行                                     │
│        │   └── 依赖章节 → 顺序执行                                   │
│        │                                                             │
│        └── 创建并行写作任务组                                        │
│                    │                                                 │
│     ┌──────────────┼──────────────┐                                 │
│     ↓              ↓              ↓                                 │
│ [Writer-1]    [Writer-2]    [Writer-3]                              │
│  Chapter 5     Chapter 6     Chapter 7                              │
│     │              │              │                                 │
│     └──────────────┼──────────────┘                                 │
│                    ↓                                                 │
│            [Bible Keeper]                                            │
│         (并发读取设定，串行更新)                                      │
│                    ↓                                                 │
│     ┌──────────────┼──────────────┐                                 │
│     ↓              ↓              ↓                                 │
│ [Checker-1]   [Checker-2]   [Checker-3]                             │
│     │              │              │                                 │
│     └──────────────┼──────────────┘                                 │
│                    ↓                                                 │
│          [Story Architect]                                           │
│         汇总结果，协调冲突                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 并行规则

| 规则         | 说明                                                   |
| ------------ | ------------------------------------------------------ |
| 章节依赖分析 | 如果章节 B 依赖章节 A 的结果，则 B 必须在 A 完成后执行 |
| 角色状态隔离 | 并行章节中若涉及相同角色状态变化，需要合并策略         |
| 最大并行数   | 默认最多 3 个 Writer 并行（可配置 1-5）                |
| 冲突检测     | 并行写作完成后，由 Story Architect 检测跨章节冲突      |
| 设定锁机制   | Bible Keeper 对设定更新使用乐观锁，防止并发写入冲突    |

### 4.3 冲突类型及处理

| 冲突类型     | 示例                                     | 处理策略                       |
| ------------ | ---------------------------------------- | ------------------------------ |
| 角色状态冲突 | A 章说角色受伤，B 章说角色健康           | 按时间线顺序取后者，或提示用户 |
| 新设定重复   | A、B 章都引入同名新角色                  | 合并或重命名，提示用户确认     |
| 时间线矛盾   | A 章事件发生在 B 章事件之后，但 B 依赖 A | 标记为 CRITICAL，必须人工解决  |
| 术语不一致   | 同一事物不同命名                         | 统一为先出现的命名             |

---

## 五、API 端点

### 5.1 项目管理

| 方法   | 路径                       | 说明         |
| ------ | -------------------------- | ------------ |
| GET    | `/ai-writing/projects`     | 获取项目列表 |
| POST   | `/ai-writing/projects`     | 创建项目     |
| GET    | `/ai-writing/projects/:id` | 获取项目详情 |
| PATCH  | `/ai-writing/projects/:id` | 更新项目     |
| DELETE | `/ai-writing/projects/:id` | 删除项目     |

### 5.2 Story Bible

| 方法  | 路径                             | 说明         |
| ----- | -------------------------------- | ------------ |
| GET   | `/ai-writing/projects/:id/bible` | 获取设定圣经 |
| PATCH | `/ai-writing/projects/:id/bible` | 更新设定圣经 |

### 5.3 角色管理

| 方法   | 路径                                  | 说明         |
| ------ | ------------------------------------- | ------------ |
| GET    | `/ai-writing/projects/:id/characters` | 获取角色列表 |
| POST   | `/ai-writing/projects/:id/characters` | 创建角色     |
| GET    | `/ai-writing/characters/:id`          | 获取角色详情 |
| PATCH  | `/ai-writing/characters/:id`          | 更新角色     |
| DELETE | `/ai-writing/characters/:id`          | 删除角色     |

### 5.4 章节写作

| 方法 | 路径                                     | 说明           |
| ---- | ---------------------------------------- | -------------- |
| POST | `/ai-writing/chapters/:id/write`         | 触发章节写作   |
| POST | `/ai-writing/chapters/:id/check`         | 触发一致性检查 |
| POST | `/ai-writing/volumes/:id/write-parallel` | 触发卷并行写作 |

---

## 六、前端路由

```
/ai-writing
  ├── /                         # 项目列表
  ├── /new                      # 创建新项目
  ├── /[projectId]              # 项目详情
  │   ├── /                     # 项目概览
  │   ├── /bible                # Story Bible 管理
  │   │   ├── /characters       # 角色档案
  │   │   ├── /world            # 世界设定
  │   │   ├── /timeline         # 时间线
  │   │   └── /terminology      # 术语表
  │   ├── /outline              # 大纲编辑器
  │   ├── /chapters             # 章节管理
  │   │   └── /[chapterId]      # 章节详情/编辑
  │   ├── /consistency          # 一致性检查报告
  │   └── /settings             # 项目设置
```

---

## 七、开发计划

### Phase 1: 基础框架 ✅

- [x] Prisma 数据模型
- [x] 后端模块结构
- [x] 前端路由和页面框架
- [x] 菜单入口

### Phase 2: Story Bible

- [ ] Story Bible 管理服务
- [ ] 角色档案管理（含状态追踪）
- [ ] 世界设定、时间线、术语管理
- [ ] Story Bible 前端页面

### Phase 3: 一致性引擎

- [ ] Pre-Write Injection 服务
- [ ] Post-Write Validation 服务
- [ ] Conflict Resolution 服务
- [ ] 集成测试

### Phase 4: Agent 集成

- [ ] 5 个 Agent 类实现
- [ ] AI Teams Mission 机制集成
- [ ] 写作流程编排
- [ ] Agent 协作测试

### Phase 5: 前端完善

- [ ] 章节写作页面
- [ ] 一致性检查页面
- [ ] 用户体验优化
- [ ] 端到端测试

### Phase 6: 优化迭代

- [ ] 性能优化
- [ ] 用户反馈收集
- [ ] 功能迭代

---

## 八、关键文件索引

| 文件                                     | 作用         |
| ---------------------------------------- | ------------ |
| `backend/prisma/schema.prisma`           | 数据模型定义 |
| `backend/src/modules/ai-app/writing/`    | 后端模块目录 |
| `frontend/app/ai-writing/`               | 前端页面目录 |
| `frontend/components/layout/Sidebar.tsx` | 菜单入口     |
| `frontend/lib/i18n/locales/`             | 国际化翻译   |

---

## 九、配置项

### 9.1 项目级配置

在 `WritingProject` 模型中：

| 字段                 | 说明           | 默认值 |
| -------------------- | -------------- | ------ |
| `maxParallelWriters` | 最大并行写手数 | 3      |

### 9.2 一致性检查配置

| 配置                 | 说明                                           | 建议 |
| -------------------- | ---------------------------------------------- | ---- |
| 检查时机             | 仅在章节提交时检查 + 手动触发                  | 推荐 |
| 冲突解决策略         | CRITICAL 必须用户确认，其他可自动解决          | 推荐 |
| 并行冲突自动解决级别 | 自动解决 INFO 和 WARNING，仅 CRITICAL 提示用户 | 推荐 |

---

**文档版本**: 1.0
**创建日期**: 2025-01-06
**作者**: AI Teams Engine
