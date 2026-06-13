# Admin 系统重构设计文档 v1.0

> ⚠️ **状态更新 (2026-05-11)**：本方案已演进为 **4 实体（用户管理 / 密钥管理 / 数据管理 / 系统管理）+ 各自 Tab** 的合并页结构。系统管理对应的 4 Tab：运行监控 / 消息通知 / 基础设置 / 安全审计。最新设计见 `.claude/standards/20-admin-ui-design.md` v1.1+ 与项目 admin L1 重构作战图。本文档归档保留。
>
> **版本**: 1.0
> **日期**: 2026-01-18
> **状态**: 设计中 → 已演进（11 Tab → 4 实体合并页）
> **作者**: Claude Code

---

## 1. 概述

### 1.1 背景

当前 Admin 模块存在以下问题：

- **导航混乱**：11 个平铺的顶部 Tab，缺乏逻辑分组
- **功能重叠**：Settings 页面与独立页面（Storage、External API）存在重复配置
- **UI 不一致**：不同页面的颜色方案、布局模式、加载状态各异
- **可扩展性差**：新增功能难以归类，导航栏空间有限

### 1.2 目标

1. 建立清晰的信息架构，按功能域分组
2. 统一 UI 规范，提升组件复用率
3. 提供良好的可扩展性
4. 优化用户体验，减少认知负担

---

## 2. 现状分析

### 2.1 现有页面结构

| 路由                  | 组件                   | 功能描述                         |
| --------------------- | ---------------------- | -------------------------------- |
| `/admin/dashboard`    | DashboardPage          | 概览、实时监控、历史记录         |
| `/admin/ai-models`    | AIModelSettings        | LLM 模型管理                     |
| `/admin/ai-teams`     | AITeamsSettings        | AI 团队模板                      |
| `/admin/capabilities` | AICapabilitiesSettings | 工具、技能、MCP                  |
| `/admin/external-api` | ExternalAPISettings    | 搜索、提取、TTS API              |
| `/admin/secrets`      | SecretsManager         | API 密钥管理                     |
| `/admin/collection`   | CollectionManagement   | 数据源管理                       |
| `/admin/whitelists`   | WhitelistManagement    | 白名单管理                       |
| `/admin/users`        | UsersSettings          | 用户管理                         |
| `/admin/storage`      | StorageSettings        | 存储配置                         |
| `/admin/settings`     | SettingsPage           | 系统设置（邮件、站点、AI、安全） |

### 2.2 问题详解

#### A. 导航结构问题

```
当前：11 个平铺 Tab
[Dashboard] [AI Models] [AI Teams] [Capabilities] [External API]
[Secrets] [Collection] [Whitelists] [Users] [Storage] [Settings]

问题：
- 无逻辑分组，用户难以快速定位
- 水平空间有限，移动端体验差
- 新增功能无处可放
```

#### B. 功能重叠

| 重叠区域 | 位置 1                          | 位置 2                       |
| -------- | ------------------------------- | ---------------------------- |
| AI 设置  | `/admin/settings` → AI Tab      | `/admin/ai-models`           |
| 存储设置 | `/admin/settings` → Storage Tab | `/admin/storage`             |
| 外部服务 | `/admin/external-api`           | `/admin/capabilities` (部分) |

#### C. UI 不一致

| 组件                   | 主色调   | 布局       | 加载状态       |
| ---------------------- | -------- | ---------- | -------------- |
| AIModelSettings        | Blue     | 卡片列表   | Loader2        |
| AITeamsSettings        | Blue     | 主-详情    | Loader2        |
| AICapabilitiesSettings | 多色渐变 | Tab + 卡片 | Loader2        |
| StorageSettings        | Violet   | 表单分组   | Loader2        |
| UsersSettings          | Violet   | 数据表格   | LoadingState   |
| WhitelistManagement    | 多色     | 卡片网格   | 自定义 spinner |

---

## 3. 新信息架构

### 3.1 五大功能域

```
Admin Console
│
├── 📊 概览 (Overview)
│   └── 仪表盘（系统状态、实时任务、历史记录）
│
├── 🤖 AI 配置 (AI Configuration)
│   ├── 模型管理 (Models)
│   ├── 团队模板 (Teams)
│   ├── 能力配置 (Capabilities)
│   └── 外部服务 (External Services)
│
├── 📁 数据管理 (Data Management)
│   ├── 采集源 (Collection Sources)
│   ├── 域名白名单 (Whitelists)
│   └── 质量规则 (Quality Rules)
│
├── 🔐 访问控制 (Access Control)
│   ├── 用户管理 (Users)
│   ├── 密钥管理 (Secrets)
│   └── 安全设置 (Security)
│
└── ⚙️ 系统设置 (System Settings)
    ├── 站点配置 (Site)
    ├── 邮件配置 (Email)
    └── 存储配置 (Storage)
```

### 3.2 分组逻辑

| 分组         | 逻辑依据                     | 包含功能                       |
| ------------ | ---------------------------- | ------------------------------ |
| **概览**     | 管理员首页，快速了解系统状态 | 仪表盘                         |
| **AI 配置**  | 所有 AI 能力相关配置         | 模型、团队、工具、外部 AI 服务 |
| **数据管理** | 内容采集与质量控制           | 采集源、白名单、质量规则       |
| **访问控制** | 安全与权限相关               | 用户、密钥、安全策略           |
| **系统设置** | 基础设施配置                 | 站点、邮件、存储               |

---

## 4. UI 设计规范

### 4.1 导航设计：侧边栏

**设计理由**：

- 垂直空间充足，支持多级导航
- 可折叠，适应不同屏幕
- 便于扩展新功能

```
┌──────────────────────────────────────────────────────────────┐
│  Admin Console                                    [折叠按钮] │
├─────────────────┬────────────────────────────────────────────┤
│                 │                                            │
│  ▼ 概览         │   页面内容区                               │
│    仪表盘       │                                            │
│                 │   ┌──────────────────────────────────────┐ │
│  ▼ AI 配置      │   │  页面标题 + 操作按钮                 │ │
│    模型管理     │   ├──────────────────────────────────────┤ │
│    团队模板     │   │                                      │ │
│    能力配置     │   │  主内容区                            │ │
│    外部服务     │   │                                      │ │
│                 │   │                                      │ │
│  ▼ 数据管理     │   │                                      │ │
│    采集源       │   │                                      │ │
│    白名单       │   │                                      │ │
│    质量规则     │   │                                      │ │
│                 │   └──────────────────────────────────────┘ │
│  ▼ 访问控制     │                                            │
│    用户管理     │                                            │
│    密钥管理     │                                            │
│    安全设置     │                                            │
│                 │                                            │
│  ▼ 系统设置     │                                            │
│    站点配置     │                                            │
│    邮件配置     │                                            │
│    存储配置     │                                            │
│                 │                                            │
└─────────────────┴────────────────────────────────────────────┘
```

### 4.2 色彩系统

```typescript
const ADMIN_COLORS = {
  // 功能域主色
  overview: {
    primary: "blue",
    gradient: "from-blue-500 to-cyan-500",
    bg: "bg-blue-50",
    text: "text-blue-700",
  },
  ai: {
    primary: "violet",
    gradient: "from-violet-500 to-purple-500",
    bg: "bg-violet-50",
    text: "text-violet-700",
  },
  data: {
    primary: "emerald",
    gradient: "from-emerald-500 to-green-500",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
  },
  access: {
    primary: "amber",
    gradient: "from-amber-500 to-orange-500",
    bg: "bg-amber-50",
    text: "text-amber-700",
  },
  system: {
    primary: "slate",
    gradient: "from-slate-500 to-gray-500",
    bg: "bg-slate-50",
    text: "text-slate-700",
  },

  // 状态色
  status: {
    active: "bg-green-100 text-green-700 border-green-200",
    pending: "bg-amber-100 text-amber-700 border-amber-200",
    error: "bg-red-100 text-red-700 border-red-200",
    inactive: "bg-gray-100 text-gray-500 border-gray-200",
  },
};
```

### 4.3 通用组件规范

#### AdminPageLayout - 页面布局

```typescript
interface AdminPageLayoutProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
}
```

#### AdminConfigCard - 配置卡片

```typescript
interface AdminConfigCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  status?: "configured" | "pending" | "error";
  collapsible?: boolean;
  defaultExpanded?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}
```

#### AdminToggleCard - 开关卡片

```typescript
interface AdminToggleCardProps {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  icon?: LucideIcon;
  status?: "active" | "inactive" | "error";
  children?: React.ReactNode;
}
```

#### ConnectionTestButton - 连接测试按钮

```typescript
interface ConnectionTestButtonProps {
  testFn: () => Promise<{
    success: boolean;
    message?: string;
    latency?: number;
  }>;
  label?: string;
  onResult?: (result: TestResult) => void;
}
```

#### AdminDataTable - 数据表格

```typescript
interface AdminDataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  pagination?: {
    pageSize: number;
    pageSizeOptions?: number[];
  };
  emptyState?: {
    icon?: LucideIcon;
    title: string;
    description?: string;
    action?: React.ReactNode;
  };
}
```

---

## 5. 文件结构

### 5.1 新目录结构

```
frontend/
├── app/admin/
│   ├── layout.tsx                    # 侧边栏布局
│   ├── page.tsx                      # 重定向到 /admin/overview
│   │
│   ├── overview/
│   │   └── page.tsx                  # 仪表盘
│   │
│   ├── ai/
│   │   ├── models/page.tsx           # 模型管理
│   │   ├── teams/page.tsx            # 团队模板
│   │   ├── capabilities/page.tsx     # 能力配置
│   │   └── external-services/page.tsx # 外部服务
│   │
│   ├── data/
│   │   ├── collection/page.tsx       # 采集源
│   │   ├── whitelists/page.tsx       # 白名单
│   │   └── quality/page.tsx          # 质量规则
│   │
│   ├── access/
│   │   ├── users/page.tsx            # 用户管理
│   │   ├── secrets/page.tsx          # 密钥管理
│   │   └── security/page.tsx         # 安全设置
│   │
│   └── system/
│       ├── site/page.tsx             # 站点配置
│       ├── email/page.tsx            # 邮件配置
│       └── storage/page.tsx          # 存储配置
│
├── components/admin/
│   ├── layout/
│   │   ├── AdminSidebar.tsx          # 侧边栏导航
│   │   ├── AdminPageLayout.tsx       # 页面布局
│   │   ├── AdminBreadcrumb.tsx       # 面包屑
│   │   └── index.ts
│   │
│   ├── shared/
│   │   ├── AdminConfigCard.tsx       # 配置卡片
│   │   ├── AdminToggleCard.tsx       # 开关卡片
│   │   ├── AdminDataTable.tsx        # 数据表格
│   │   ├── AdminFormSection.tsx      # 表单分组
│   │   ├── AdminStatsCard.tsx        # 统计卡片
│   │   ├── ConnectionTestButton.tsx  # 连接测试
│   │   └── index.ts
│   │
│   └── [现有组件文件...]
│
└── lib/admin/
    ├── styles.ts                     # 颜色、样式 token
    ├── navigation.ts                 # 导航配置
    └── types.ts                      # 共享类型
```

### 5.2 路由映射（新旧对照）

| 旧路由                  | 新路由                        | 重定向              |
| ----------------------- | ----------------------------- | ------------------- |
| `/admin`                | `/admin`                      | → `/admin/overview` |
| `/admin/dashboard`      | `/admin/overview`             | 301                 |
| `/admin/ai-models`      | `/admin/ai/models`            | 301                 |
| `/admin/ai-teams`       | `/admin/ai/teams`             | 301                 |
| `/admin/capabilities`   | `/admin/ai/capabilities`      | 301                 |
| `/admin/external-api`   | `/admin/ai/external-services` | 301                 |
| `/admin/collection`     | `/admin/data/collection`      | 301                 |
| `/admin/whitelists`     | `/admin/data/whitelists`      | 301                 |
| `/admin/users`          | `/admin/access/users`         | 301                 |
| `/admin/secrets`        | `/admin/access/secrets`       | 301                 |
| `/admin/system/storage` | `/admin/storage`              | 301                 |
| `/admin/settings`       | 拆分                          | 按功能重定向        |

---

## 6. 实现计划

### Phase 1: 基础组件（第 1-2 周）

| 任务                 | 文件                                          | 优先级 |
| -------------------- | --------------------------------------------- | ------ |
| 创建 AdminSidebar    | `components/admin/layout/AdminSidebar.tsx`    | P0     |
| 创建 AdminPageLayout | `components/admin/layout/AdminPageLayout.tsx` | P0     |
| 创建 AdminConfigCard | `components/admin/shared/AdminConfigCard.tsx` | P0     |
| 创建 AdminToggleCard | `components/admin/shared/AdminToggleCard.tsx` | P0     |
| 创建样式 token       | `lib/admin/styles.ts`                         | P0     |
| 创建导航配置         | `lib/admin/navigation.ts`                     | P0     |
| 更新主布局           | `app/admin/layout.tsx`                        | P0     |

### Phase 2: 路由重构（第 3-4 周）

| 任务                          | 优先级 |
| ----------------------------- | ------ |
| 创建 `/admin/overview` 路由   | P0     |
| 创建 `/admin/ai/*` 路由组     | P0     |
| 创建 `/admin/data/*` 路由组   | P1     |
| 创建 `/admin/access/*` 路由组 | P1     |
| 创建 `/admin/system/*` 路由组 | P1     |
| 添加旧路由重定向              | P0     |
| 拆分 Settings 页面            | P1     |

### Phase 3: 组件迁移（第 5-6 周）

| 页面                | 使用新组件                        | 优先级 |
| ------------------- | --------------------------------- | ------ |
| AIModelSettings     | AdminConfigCard, AdminToggleCard  | P0     |
| AITeamsSettings     | AdminPageLayout, AdminDataTable   | P0     |
| UsersSettings       | AdminDataTable                    | P1     |
| StorageSettings     | AdminConfigCard, AdminFormSection | P1     |
| WhitelistManagement | AdminToggleCard                   | P1     |

### Phase 4: 打磨优化（第 7-8 周）

| 任务                           | 优先级 |
| ------------------------------ | ------ |
| 响应式设计（移动端侧边栏折叠） | P1     |
| 键盘导航支持                   | P2     |
| 统一加载状态（Skeleton UI）    | P1     |
| 错误边界处理                   | P1     |
| 无障碍优化（ARIA）             | P2     |
| E2E 测试                       | P2     |

---

## 7. 风险评估

| 风险                | 影响 | 缓解措施                           |
| ------------------- | ---- | ---------------------------------- |
| 旧 URL 失效         | 高   | 添加 301 重定向，保持 3 个版本兼容 |
| 组件迁移引入 bug    | 中   | 增量迁移，使用 feature flag        |
| 用户不适应新导航    | 中   | 首次访问显示引导提示               |
| 后端 API 需同步修改 | 低   | 前端优先，API 保持不变             |

---

## 8. 成功指标

| 指标                         | 当前 | 目标 |
| ---------------------------- | ---- | ---- |
| 顶级导航项数量               | 11   | 5    |
| 功能重复区域                 | 3    | 0    |
| 共享 Admin 组件              | 0    | 7+   |
| UI 一致性（人工评估）        | 低   | 高   |
| 找到设置的点击数（用户测试） | 待测 | ≤3   |

---

## 9. 附录

### 9.1 关键文件清单

- `frontend/app/admin/layout.tsx` - 当前布局，需重构为侧边栏
- `frontend/app/admin/settings/page.tsx` - 需拆分到 system/\* 路由
- `frontend/components/ui/index.ts` - 现有 UI 组件，可参考
- `frontend/components/admin/AICapabilitiesSettings.tsx` - 复杂页面示例
- `frontend/components/admin/UsersSettings.tsx` - 表格页面示例

### 9.2 参考资源

- [Shadcn UI Admin 模板](https://ui.shadcn.com/)
- [Next.js App Router 文档](https://nextjs.org/docs/app)
- [Tailwind CSS 设计系统](https://tailwindcss.com/docs)

---

**最后更新**: 2026-01-18
**下一步**: 评审通过后开始 Phase 1 实现
