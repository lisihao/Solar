# Admin 架构图 L1 基础设施层 - 分组扩展方案 v1.0

> ⚠️ **状态更新 (2026-05-11)**：本方案的 "4 group × 12 卡" 设计已落地（见 `frontend/lib/admin/architecture.ts:429-562`），但正在演进为 **4 实体大卡 + 各自 Tab** 结构（用户管理 / 密钥管理 / 数据管理 / 系统管理）。最新设计见 `.claude/standards/20-admin-ui-design.md` v1.1+。本文档归档保留作历史参考。
>
> **版本**: 1.0
> **日期**: 2026-01-28
> **状态**: 已执行 → 演进中（4 group × 12 卡 → 4 实体大卡 + Tab）
> **作者**: Claude Code

---

## 1. 概述

### 1.1 背景

当前 Admin 架构图的 L1（基础设施层）包含 7 个模块，以扁平 `cards` 数组排列，缺乏逻辑分组。随着平台功能扩展，需要增加权限管理、计费管理、通知管理、日志管理、监控管理等基础设施模块，并将所有模块按功能域分组展示。

### 1.2 目标

1. 新增 5 个基础设施模块（权限、计费、通知、日志、监控）
2. 将 L1 从扁平 `cards` 改为 `groups` 分组结构
3. 分组使用与 L3（AI Apps 层）相同的标题 + 横线视觉分隔
4. L1 组内保持 `grid grid-cols-4` 大卡片布局（区别于 L3 的 `flex` 小卡片）

### 1.3 范围

- 前端架构配置（`architecture.ts`）
- 前端 i18n 翻译（中文/英文）
- 前端渲染组件（`ArchitectureLayer.tsx`）

---

## 2. 现状分析

### 2.1 当前 L1 结构

```typescript
// architecture.ts - 当前实现
const infrastructureLayer: ArchitectureLayer = {
  id: "infrastructure",
  level: 1,
  cards: [
    { id: "storage", icon: HardDrive, clickable: true },
    { id: "dataManagement", icon: Layers, clickable: true },
    { id: "users", icon: Users, clickable: true },
    { id: "credits", icon: Coins, clickable: true },
    { id: "secrets", icon: Key, clickable: true },
    { id: "feedback", icon: MessageSquare, clickable: true },
    { id: "system", icon: Settings, clickable: true },
  ],
};
```

**问题**:

- 7 个模块平铺，无逻辑分组
- 缺少权限、计费、通知、日志、监控等基础模块
- 与 L3 的分组展示不一致

### 2.2 当前渲染逻辑

`ArchitectureLayer.tsx` 中 groups 渲染统一使用 `flex flex-wrap gap-2`，适合 L3 的小卡片但不适合 L1 的大卡片布局。

---

## 3. 方案设计

### 3.1 分组方案

将 12 个模块分为 4 组：

| 分组       | ID                 | 模块                                             | 说明               |
| ---------- | ------------------ | ------------------------------------------------ | ------------------ |
| 用户与访问 | `userAccess`       | 用户管理、权限管理(new)、密钥管理                | 用户身份和访问控制 |
| 运营与计费 | `operationBilling` | 积分管理、计费管理(new)、通知管理(new)           | 运营支撑服务       |
| 数据与存储 | `dataStorage`      | 数据管理、存储管理                               | 数据基础设施       |
| 系统运维   | `systemOps`        | 系统管理、日志管理(new)、监控管理(new)、反馈管理 | 系统运维支撑       |

### 3.2 新增模块

| 模块     | id              | icon         | i18nKey                   | clickable | 说明           |
| -------- | --------------- | ------------ | ------------------------- | --------- | -------------- |
| 权限管理 | `permissions`   | `Shield`     | `admin.nav.permissions`   | `false`   | 暂无页面，预留 |
| 计费管理 | `billing`       | `CreditCard` | `admin.nav.billing`       | `false`   | 暂无页面，预留 |
| 通知管理 | `notifications` | `Bell`       | `admin.nav.notifications` | `false`   | 暂无页面，预留 |
| 日志管理 | `logs`          | `ScrollText` | `admin.nav.logs`          | `false`   | 暂无页面，预留 |
| 监控管理 | `monitoring`    | `Activity`   | `admin.nav.monitoring`    | `false`   | 暂无页面，预留 |

### 3.3 UI 布局规则

- **分组标题**: 与 L3 一致，使用 `text-xs font-semibold uppercase` 标签 + 横线分隔
- **组内卡片**: L1 使用 `grid grid-cols-4 gap-3`（大卡片），L3 使用 `flex flex-wrap gap-2`（小卡片）
- **判断逻辑**: `ArchitectureLayer.tsx` 中根据 `layer.level === 1` 切换组内布局

---

## 4. 详细实现

### 4.1 文件变更清单

| 文件                                                       | 变更类型 | 说明                                  |
| ---------------------------------------------------------- | -------- | ------------------------------------- |
| `frontend/lib/admin/architecture.ts`                       | 修改     | 新增 imports，L1 从 cards 改为 groups |
| `frontend/lib/i18n/locales/zh.json`                        | 修改     | 新增模块名称和分组标题翻译            |
| `frontend/lib/i18n/locales/en.json`                        | 修改     | 同上英文版                            |
| `frontend/components/admin/overview/ArchitectureLayer.tsx` | 修改     | groups 渲染支持 L1 grid 布局          |

### 4.2 architecture.ts 变更

#### 新增 imports

```typescript
import {
  // ...existing imports...
  CreditCard,
  Bell,
  ScrollText,
  Activity,
  // Shield 已存在
} from "lucide-react";
```

#### infrastructureLayer 改为 groups 结构

```typescript
const infrastructureLayer: ArchitectureLayer = {
  id: "infrastructure",
  titleKey: "admin.architecture.layers.infrastructure",
  subtitleKey: "admin.architecture.layers.infrastructureDesc",
  level: 1,
  groups: [
    {
      id: "userAccess",
      titleKey: "admin.architecture.groups.userAccess",
      cards: [
        {
          id: "users",
          i18nKey: "admin.nav.users",
          href: "/admin/access/users",
          icon: Users,
          clickable: true,
        },
        {
          id: "permissions",
          i18nKey: "admin.nav.permissions",
          icon: Shield,
          clickable: false,
        },
        {
          id: "secrets",
          i18nKey: "admin.nav.secrets",
          href: "/admin/access/secrets",
          icon: Key,
          clickable: true,
        },
      ],
    },
    {
      id: "operationBilling",
      titleKey: "admin.architecture.groups.operationBilling",
      cards: [
        {
          id: "credits",
          i18nKey: "admin.nav.credits",
          href: "/admin/access/credits",
          icon: Coins,
          clickable: true,
        },
        {
          id: "billing",
          i18nKey: "admin.nav.billing",
          icon: CreditCard,
          clickable: false,
        },
        {
          id: "notifications",
          i18nKey: "admin.nav.notifications",
          icon: Bell,
          clickable: false,
        },
      ],
    },
    {
      id: "dataStorage",
      titleKey: "admin.architecture.groups.dataStorage",
      cards: [
        {
          id: "dataManagement",
          i18nKey: "admin.nav.dataManagement",
          href: "/admin/data-management",
          icon: Layers,
          clickable: true,
        },
        {
          id: "storage",
          i18nKey: "admin.nav.storage",
          href: "/admin/storage",
          icon: HardDrive,
          clickable: true,
        },
      ],
    },
    {
      id: "systemOps",
      titleKey: "admin.architecture.groups.systemOps",
      cards: [
        {
          id: "system",
          i18nKey: "admin.nav.systemManagement",
          href: "/admin/system",
          icon: Settings,
          clickable: true,
        },
        {
          id: "logs",
          i18nKey: "admin.nav.logs",
          icon: ScrollText,
          clickable: false,
        },
        {
          id: "monitoring",
          i18nKey: "admin.nav.monitoring",
          icon: Activity,
          clickable: false,
        },
        {
          id: "feedback",
          i18nKey: "admin.nav.feedback",
          href: "/admin/feedback",
          icon: MessageSquare,
          clickable: true,
        },
      ],
    },
  ],
};
```

### 4.3 i18n 变更

#### zh.json

在 `admin.nav` 下新增：

```json
"permissions": "权限管理",
"billing": "计费管理",
"notifications": "通知管理",
"logs": "日志管理",
"monitoring": "监控管理"
```

在 `admin.architecture` 下新增 `groups` 对象：

```json
"groups": {
  "userAccess": "用户与访问",
  "operationBilling": "运营与计费",
  "dataStorage": "数据与存储",
  "systemOps": "系统运维"
}
```

#### en.json

在 `admin.nav` 下新增：

```json
"permissions": "Permissions",
"billing": "Billing",
"notifications": "Notifications",
"logs": "Logs",
"monitoring": "Monitoring"
```

在 `admin.architecture` 下新增 `groups` 对象：

```json
"groups": {
  "userAccess": "Users & Access",
  "operationBilling": "Operations & Billing",
  "dataStorage": "Data & Storage",
  "systemOps": "System Ops"
}
```

### 4.4 ArchitectureLayer.tsx 变更

修改 groups 渲染部分，当 `layer.level === 1` 时组内使用 grid 布局：

```tsx
{
  /* Group cards - L1 uses grid for bigger cards, L3 uses flex */
}
<div
  className={cn(
    layer.level === 1 ? "grid grid-cols-4 gap-3" : "flex flex-wrap gap-2",
  )}
>
  {group.cards.map((card) => (
    <ArchitectureCard
      key={card.id}
      card={card}
      layerLevel={layer.level}
      fixedWidth={layer.level === 1}
    />
  ))}
</div>;
```

---

## 5. 验证标准

| 验证项                 | 预期结果                                                     |
| ---------------------- | ------------------------------------------------------------ |
| 访问 `/admin/overview` | L1 显示 4 个分组，每组有标题标签和横线分隔                   |
| 模块总数               | Header 显示 `12 modules`                                     |
| 可配置数               | Header 显示 `7 configurable`（原有 7 个 clickable 模块不变） |
| 卡片宽度               | L1 组内卡片为 4 列 grid，与之前大卡片宽度一致                |
| 新增卡片               | 5 个新增卡片显示为不可点击（灰色/只读）状态                  |
| L3 不受影响            | AI Apps 层分组渲染不变（flex 小卡片）                        |
| i18n                   | 中英文切换正确显示所有新增翻译                               |

---

## 6. 影响分析

### 6.1 无破坏性变更

- 现有 7 个模块的 id、href、clickable 属性不变
- L3（AI Engine）和 L4（AI Apps）层不受影响
- `ArchitectureCard` 组件无需修改

### 6.2 后续扩展

新增模块目前 `clickable: false`，后续实现对应管理页面时：

1. 设置 `clickable: true`
2. 添加 `href` 路由
3. 创建对应的页面组件

---

**最后更新**: 2026-01-28
**维护者**: Claude Code
