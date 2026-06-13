# GenesisPod 架构重构方案

> 版本: 3.0 | 创建日期: 2025-12-28 | 状态: 待执行

---

## 一、项目现状分析

### 1.1 后端目录现状

```
backend/src/
├── common/                      # ✅ 良好，需增强
│   ├── ai-orchestration/        # ✅ AI 编排服务
│   ├── streaming/               # ✅ 流式响应
│   ├── deduplication/           # ✅ 去重服务
│   ├── capabilities/            # ✅ 能力系统
│   ├── content-processing/      # ✅ 内容处理
│   ├── filters/                 # ✅ 异常过滤器
│   ├── guards/                  # ✅ 认证守卫
│   ├── interceptors/            # ✅ 拦截器
│   ├── prisma/                  # ✅ Prisma 服务
│   ├── mongodb/                 # ✅ MongoDB 服务
│   ├── neo4j/                   # ✅ Neo4j 服务
│   ├── graph/                   # ✅ 图服务
│   ├── rawdata/                 # ✅ 原始数据
│   ├── config/                  # ✅ 配置
│   └── utils/                   # ✅ 工具函数
│   # ❌ 缺少: dtos/, errors/, interfaces/, decorators/, constants/
│
├── modules/
│   ├── ai/                      # ⚠️ 需要统一内部结构
│   │   ├── ai-core/             # ⚠️ 应该是所有 AI 模块的核心，需增强
│   │   ├── ai-agents/           # 有 core, dto, implementations, tools
│   │   ├── ai-ask/              # 有 adapters
│   │   ├── ai-coding/           # 有 constants, dto, prompts, services
│   │   ├── ai-image/            # 结构良好
│   │   ├── ai-office/           # 有 agents, common, core, docs, prompts
│   │   ├── ai-simulation/       # 扁平结构
│   │   ├── ai-studio/           # 有 deep-research, dto, services
│   │   ├── ai-teams/            # 有 agents, dto, services
│   │   └── rag/                 # 有 dto, interfaces, services
│   │
│   ├── content/                 # ✅ 结构良好
│   ├── core/                    # ✅ 结构良好
│   ├── credits/                 # ✅ 结构良好
│   ├── data-services/           # ⚠️ 需要整理
│   ├── export/                  # ✅ 结构良好
│   └── integrations/            # ✅ 结构良好
```

### 1.2 前端目录现状

```
frontend/
├── components/
│   ├── admin/                   # ✅ 管理后台组件
│   ├── ai-ask/                  # ✅ AI 问答组件
│   ├── ai-coding/               # ✅ AI 编程组件
│   ├── ai-office/               # ✅ AI 办公组件
│   ├── ai-simulation/           # ✅ AI 模拟组件
│   ├── ai-studio/               # ✅ AI 工作室组件
│   ├── ai-teams/                # ✅ AI 团队组件
│   ├── common/                  # ⚠️ 与 shared 重复
│   ├── explore/                 # ⚠️ 内含 hooks/，应移出
│   ├── google-drive/            # ⚠️ 应移入 integrations/
│   ├── layout/                  # ✅ 布局组件
│   ├── library/                 # ✅ 资源库组件
│   ├── notion/                  # ⚠️ 应移入 integrations/
│   ├── shared/                  # ⚠️ 与 common 重复
│   └── ui/                      # ✅ UI 基础组件
│
├── hooks/
│   ├── core/                    # ✅ 核心 hooks
│   ├── domain/                  # ✅ 领域 hooks
│   ├── features/                # ✅ 功能 hooks
│   └── utils/                   # ✅ 工具 hooks
```

### 1.3 问题汇总

| 问题                                 | 严重程度 | 影响范围            |
| ------------------------------------ | -------- | ------------------- |
| 前端 `common/` 和 `shared/` 重复     | 🔴 高    | 组件复用混乱        |
| 后端 `ai-core/` 未充分利用           | 🔴 高    | AI 模块代码重复     |
| 后端缺少 `common/dtos/`              | 🟠 中    | DTO 分散            |
| 后端缺少 `common/errors/`            | 🟠 中    | 错误处理不统一      |
| 前端 `explore/hooks/` 位置错误       | 🟡 低    | 违反目录约定        |
| 前端 `google-drive/`, `notion/` 位置 | 🟡 低    | 应归入 integrations |
| AI 模块内部结构不统一                | 🟠 中    | 维护困难            |

---

## 二、改进目标

| 目标          | 当前状态          | 目标状态 | 预期收益          |
| ------------- | ----------------- | -------- | ----------------- |
| Dialog 复用率 | 3% (26个独立实现) | 90%+     | 减少 ~2000 行代码 |
| Hooks 复用率  | 60%               | 95%+     | 减少 ~500 行代码  |
| 基础组件覆盖  | 65%               | 95%+     | 开发效率提升 30%  |
| 命名一致性    | 70%               | 100%     | 维护成本降低 40%  |
| 后端服务复用  | 50%               | 90%+     | 减少 ~3000 行代码 |

---

## 三、DFx 设计原则

### 3.1 DFx 目标矩阵

| DFx 维度           | 目标         | 关键指标               | 验收标准                 |
| ------------------ | ------------ | ---------------------- | ------------------------ |
| **可维护性 (DFM)** | 降低变更成本 | 模块耦合度、代码重复率 | 单模块变更不影响其他模块 |
| **可扩展性 (DFE)** | 支持功能扩展 | 新增功能代码行数       | 新增 AI 模块 < 500 行    |
| **可测试性 (DFT)** | 提高测试覆盖 | 测试覆盖率、Mock 难度  | 核心模块覆盖率 > 80%     |
| **可靠性 (DFR)**   | 减少故障影响 | 故障隔离度、恢复时间   | 单服务故障不影响整体     |
| **安全性 (DFS)**   | 保护敏感数据 | 权限边界清晰度         | 无越权访问路径           |
| **性能 (DFP)**     | 优化加载速度 | 首屏时间、包体积       | 首屏 < 2s，包 < 500KB    |
| **可观测性 (DFO)** | 支持问题定位 | 日志完整度、追踪覆盖   | 问题定位 < 5 分钟        |
| **可部署性 (DFD)** | 简化部署流程 | 部署步骤、回滚时间     | 一键部署，回滚 < 5 分钟  |

### 3.2 模块依赖规则

```
┌─────────────────────────────────────────────────────────────────────┐
│                       依赖层次图（由下到上）                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 4: Features (页面/功能)                                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│  │ai-studio│ │ai-teams │ │ai-office│ │ library │ ...               │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘                   │
│       │          │          │          │                           │
│       ▼          ▼          ▼          ▼                           │
│  Layer 3: Domain (业务领域)                                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│  │ai-core  │ │ content │ │  data   │ │  core   │                   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘                   │
│       │          │          │          │                           │
│       ▼          ▼          ▼          ▼                           │
│  Layer 2: Infrastructure (基础设施)                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ common/ (ai-orchestration, streaming, prisma, guards...)    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  Layer 1: External (外部依赖)                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ NestJS, Prisma, OpenAI SDK, Next.js, React...               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

依赖规则：
✅ 上层可依赖下层
✅ 同层可依赖（需通过接口）
❌ 下层不可依赖上层
❌ 跨层依赖（如 Features 直接依赖 External）
```

### 3.3 扩展点架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         扩展点架构                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Plugin Registry                           │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │   │
│  │  │AI Provider│ │  Agent   │ │  Export  │ │ Storage  │       │   │
│  │  │  Plugin   │ │  Plugin  │ │  Plugin  │ │  Plugin  │       │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Extension Points                          │   │
│  │                                                              │   │
│  │  1. AI Provider Extension    - 新增 AI 模型提供商            │   │
│  │  2. Agent Extension          - 新增 Agent 类型               │   │
│  │  3. Export Format Extension  - 新增导出格式                  │   │
│  │  4. Storage Backend Extension- 新增存储后端                  │   │
│  │  5. Auth Strategy Extension  - 新增认证方式                  │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.4 故障隔离架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         故障隔离边界                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                      Bulkhead Pattern                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │  AI Pool    │  │ DB Pool     │  │ External    │           │ │
│  │  │ (隔离 AI)   │  │ (隔离 DB)   │  │ API Pool    │           │ │
│  │  │ timeout:30s │  │ timeout:5s  │  │ timeout:10s │           │ │
│  │  │ retry: 3    │  │ retry: 2    │  │ retry: 3    │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    Circuit Breaker                            │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │ OpenAI CB   │  │ Claude CB   │  │ Grok CB     │           │ │
│  │  │ threshold:5 │  │ threshold:5 │  │ threshold:5 │           │ │
│  │  │ timeout:60s │  │ timeout:60s │  │ timeout:60s │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 四、命名约定

### 4.1 目录命名规则

| 层级       | 命名规则                          | 示例                           |
| ---------- | --------------------------------- | ------------------------------ |
| 项目级公共 | `common/`                         | `backend/src/common/`          |
| 模块级公共 | `{domain}-core/`                  | `ai-core/`, `data-core/`       |
| 子模块公共 | `{module}-common/` 或直接放入核心 | `office-common/`               |
| 功能目录   | `kebab-case`                      | `ai-office/`, `deep-research/` |

**禁止使用**：

- ❌ `shared/` - 统一用 `common/` 或 `*-core/`
- ❌ 组件目录内放 hooks
- ❌ 混合命名风格

### 4.2 文件命名规则

| 类型   | 后端                       | 前端                      |
| ------ | -------------------------- | ------------------------- |
| 模块   | `{name}.module.ts`         | -                         |
| 服务   | `{name}.service.ts`        | -                         |
| 控制器 | `{name}.controller.ts`     | -                         |
| 组件   | -                          | `{Name}.tsx` (PascalCase) |
| Hook   | -                          | `use{Name}.ts`            |
| DTO    | `{action}-{entity}.dto.ts` | -                         |
| 类型   | `{name}.types.ts`          | `{name}.types.ts`         |
| 接口   | `{name}.interface.ts`      | -                         |
| 工具   | `{name}.utils.ts`          | `{name}.utils.ts`         |
| 策略   | `{name}.strategy.ts`       | -                         |
| 工厂   | `{name}.factory.ts`        | -                         |
| 守卫   | `{name}.guard.ts`          | -                         |
| 装饰器 | `{name}.decorator.ts`      | -                         |
| Agent  | `{role}-agent.ts`          | -                         |
| Prompt | `{role}.prompt.ts`         | -                         |

### 4.3 Props 命名规范（前端统一标准）

```typescript
// Dialog/Modal 统一使用
interface DialogProps {
  open: boolean; // ✅ 统一用 open，不用 isOpen
  onClose: () => void; // ✅ 统一用 onClose
  onSuccess?: () => void; // ✅ 成功回调
  title: string;
  loading?: boolean;
}

// 表单组件统一使用
interface FormProps<T> {
  defaultValues?: Partial<T>;
  onSubmit: (data: T) => void | Promise<void>;
  onCancel?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

// 列表组件统一使用
interface ListProps<T> {
  items: T[];
  loading?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
  onItemClick?: (item: T) => void;
  selectedItems?: T[];
  emptyMessage?: string;
}
```

---

## 五、目标架构

### 5.1 后端目标架构

```
backend/src/
├── common/                          # Layer 2: Infrastructure
│   ├── ai-orchestration/            # ✅ 保持
│   ├── streaming/                   # ✅ 保持
│   ├── deduplication/               # ✅ 保持
│   ├── capabilities/                # ✅ 保持
│   ├── content-processing/          # ✅ 保持
│   │
│   ├── dtos/                        # 🆕 新增：公共 DTO
│   │   ├── base/
│   │   │   ├── pagination.dto.ts
│   │   │   ├── response.dto.ts
│   │   │   └── __tests__/
│   │   └── index.ts
│   │
│   ├── errors/                      # 🆕 新增：统一错误
│   │   ├── error.types.ts
│   │   ├── error.factory.ts
│   │   ├── error.codes.ts
│   │   └── index.ts
│   │
│   ├── interfaces/                  # 🆕 新增：公共接口（依赖倒置）
│   │   ├── ai-service.interface.ts
│   │   ├── storage.interface.ts
│   │   └── index.ts
│   │
│   ├── constants/                   # 🆕 新增：公共常量
│   │   ├── error-messages.ts
│   │   └── index.ts
│   │
│   ├── filters/                     # ✅ 保持
│   ├── guards/                      # ✅ 保持
│   ├── interceptors/                # ✅ 保持
│   ├── prisma/                      # ✅ 保持
│   ├── mongodb/                     # ✅ 保持
│   ├── neo4j/                       # ✅ 保持
│   ├── config/                      # ✅ 保持
│   └── utils/                       # ✅ 保持
│
├── modules/
│   ├── ai/                          # AI 模块群
│   │   ├── ai-core/                 # 🔑 AI 核心（所有 AI 模块的基础）
│   │   │   ├── services/
│   │   │   │   ├── base-ai-chat.service.ts
│   │   │   │   ├── base-ai-stream.service.ts
│   │   │   │   └── index.ts
│   │   │   ├── controllers/
│   │   │   │   └── base-stream.controller.ts
│   │   │   ├── prompts/             # 统一提示词库
│   │   │   │   ├── system/
│   │   │   │   ├── templates/
│   │   │   │   └── index.ts
│   │   │   ├── agents/              # Agent 框架
│   │   │   │   ├── base-agent.ts
│   │   │   │   ├── agent-registry.ts
│   │   │   │   └── index.ts
│   │   │   ├── types/
│   │   │   └── index.ts
│   │   │
│   │   ├── ai-ask/                  # ✅ 保持，继承 ai-core
│   │   ├── ai-coding/               # ✅ 保持，继承 ai-core
│   │   ├── ai-image/                # ✅ 保持
│   │   ├── ai-office/               # ✅ 保持
│   │   ├── ai-simulation/           # ✅ 保持
│   │   ├── ai-studio/               # ✅ 保持
│   │   ├── ai-teams/                # ✅ 保持
│   │   └── rag/                     # ✅ 保持
│   │
│   ├── content/                     # ✅ 保持现有结构
│   ├── core/                        # ✅ 保持现有结构
│   ├── credits/                     # ✅ 保持现有结构
│   ├── data-services/               # ✅ 保持现有结构
│   ├── export/                      # ✅ 保持现有结构
│   └── integrations/                # ✅ 保持现有结构
```

### 5.2 前端目标架构

```
frontend/
├── components/
│   ├── ui/                          # 🔑 基础 UI 组件（Atomic）
│   │   ├── primitives/              # 原语组件 (Button, Input)
│   │   ├── feedback/                # 反馈组件 (Modal, Toast)
│   │   ├── data-display/            # 数据展示 (Card, Badge)
│   │   ├── data-entry/              # 数据录入 (FormField)
│   │   ├── navigation/              # 导航 (Tabs, Pagination)
│   │   ├── states/                  # 状态组件 (Loading, Error, Empty)
│   │   └── index.ts
│   │
│   ├── composed/                    # 🆕 组合组件（Molecules）
│   │   ├── dialogs/                 # 通用对话框
│   │   │   ├── BaseDialog.tsx
│   │   │   ├── FormDialog.tsx
│   │   │   ├── ConfirmDialog.tsx
│   │   │   └── index.ts
│   │   ├── cards/                   # 通用卡片
│   │   ├── forms/                   # 通用表单
│   │   ├── lists/                   # 通用列表
│   │   └── index.ts
│   │
│   ├── business/                    # 🆕 业务组件（Organisms）
│   │   ├── import-export/           # 导入导出
│   │   ├── knowledge-base/          # 知识库
│   │   ├── resource/                # 资源
│   │   ├── ai-organize/             # AI 整理
│   │   ├── sync/                    # 同步
│   │   └── index.ts
│   │
│   ├── features/                    # 功能模块组件（页面级）
│   │   ├── ai-ask/
│   │   ├── ai-coding/
│   │   ├── ai-office/
│   │   ├── ai-studio/
│   │   ├── ai-teams/
│   │   ├── library/
│   │   └── admin/
│   │
│   ├── integrations/                # 🆕 第三方集成
│   │   ├── google-drive/
│   │   ├── notion/
│   │   └── index.ts
│   │
│   ├── layout/                      # ✅ 保持
│   │
│   └── shared/                      # ❌ 废弃，逐步合并到上述目录
│
├── hooks/                           # ✅ 保持现有结构
│   ├── core/
│   ├── domain/
│   ├── features/
│   └── utils/
│
├── types/                           # 🆕 统一类型定义
│   ├── components/
│   ├── domain/
│   └── index.ts
│
└── lib/                             # ✅ 保持
```

---

## 六、核心代码设计

### 6.1 公共 DTO

```typescript
// common/dtos/base/pagination.dto.ts
import { IsOptional, IsInt, Min, Max, IsString, IsEnum } from "class-validator";
import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ["asc", "desc"], default: "desc" })
  @IsOptional()
  @IsEnum(["asc", "desc"])
  sortOrder?: "asc" | "desc" = "desc";
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export class PaginatedResponseDto<T> {
  data: T[];
  meta: PaginationMeta;

  static create<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
  ): PaginatedResponseDto<T> {
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }
}
```

### 6.2 统一错误类型

```typescript
// common/errors/error.types.ts
export enum ErrorCode {
  // 通用错误 (1xxx)
  UNKNOWN = 1000,
  VALIDATION = 1001,
  NOT_FOUND = 1002,
  UNAUTHORIZED = 1003,
  FORBIDDEN = 1004,
  CONFLICT = 1005,
  RATE_LIMITED = 1006,

  // AI 错误 (2xxx)
  AI_SERVICE_UNAVAILABLE = 2000,
  AI_RATE_LIMIT = 2001,
  AI_TIMEOUT = 2002,
  AI_INVALID_RESPONSE = 2003,
  AI_MODEL_NOT_FOUND = 2004,
  AI_INSUFFICIENT_CREDITS = 2005,
  AI_CONTENT_FILTERED = 2006,

  // 数据错误 (3xxx)
  DATA_DUPLICATE = 3000,
  DATA_INTEGRITY = 3001,
  DATA_IMPORT_FAILED = 3002,
  DATA_EXPORT_FAILED = 3003,

  // 外部服务错误 (4xxx)
  EXTERNAL_SERVICE = 4000,
  GOOGLE_DRIVE_ERROR = 4001,
  NOTION_ERROR = 4002,
  DATABASE_ERROR = 4003,
}

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  cause?: Error;
}

export class AppException extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "AppException";
  }

  toJSON(): AppError {
    return { code: this.code, message: this.message, details: this.details };
  }
}
```

### 6.3 提示词模板

```typescript
// ai-core/prompts/templates/prompt.template.ts
export interface PromptTemplateConfig {
  id: string;
  version: string;
  name: string;
  description?: string;
  template: string;
  variables: string[];
  modelAdaptations?: Record<string, ModelAdaptation>;
}

export interface ModelAdaptation {
  systemSuffix?: string;
  temperature?: number;
  maxTokens?: number;
}

export class PromptTemplate {
  constructor(private readonly config: PromptTemplateConfig) {}

  get id(): string {
    return this.config.id;
  }
  get version(): string {
    return this.config.version;
  }
  get name(): string {
    return this.config.name;
  }

  render(variables: Record<string, unknown>): string {
    let result = this.config.template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replaceAll(`{{${key}}}`, String(value ?? ""));
    }
    // 检查未替换的变量
    const unreplaced = result.match(/\{\{(\w+)\}\}/g);
    if (unreplaced) {
      console.warn(
        `[PromptTemplate] Missing variables: ${unreplaced.join(", ")}`,
      );
    }
    return result;
  }

  validate(variables: Record<string, unknown>): {
    valid: boolean;
    missing: string[];
  } {
    const missing = this.config.variables.filter((v) => !(v in variables));
    return { valid: missing.length === 0, missing };
  }

  getAdaptation(model: string): ModelAdaptation | undefined {
    return this.config.modelAdaptations?.[model];
  }
}
```

### 6.4 Agent 基类

```typescript
// ai-core/agents/base-agent.ts
import { Logger } from "@nestjs/common";
import { AIOrchestrationService } from "@/common/ai-orchestration";
import { PromptTemplate } from "../prompts";

export interface AgentInput {
  task: string;
  context?: Record<string, unknown>;
  history?: AgentMessage[];
}

export interface AgentOutput {
  result: string;
  reasoning?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  temperature?: number;
  maxIterations?: number;
}

export abstract class BaseAgent {
  protected readonly logger: Logger;
  protected readonly config: AgentConfig;

  constructor(
    protected readonly aiOrchestration: AIOrchestrationService,
    config: Partial<AgentConfig>,
  ) {
    this.config = {
      name: this.constructor.name,
      description: "",
      model: "gpt-4o",
      temperature: 0.7,
      maxIterations: 10,
      ...config,
    };
    this.logger = new Logger(this.config.name);
  }

  protected abstract getSystemPrompt(): string | PromptTemplate;

  async execute(input: AgentInput): Promise<AgentOutput> {
    this.logger.log(`Executing: ${input.task.substring(0, 100)}...`);

    const systemPrompt = this.resolvePrompt(
      this.getSystemPrompt(),
      input.context,
    );

    const response = await this.aiOrchestration.chat({
      model: this.config.model!,
      messages: [
        { role: "system", content: systemPrompt },
        ...(input.history || []),
        { role: "user", content: input.task },
      ],
      temperature: this.config.temperature,
    });

    return {
      result: response.content,
      metadata: {
        model: response.model,
        tokensUsed: response.usage?.totalTokens,
      },
    };
  }

  private resolvePrompt(
    prompt: string | PromptTemplate,
    context?: Record<string, unknown>,
  ): string {
    if (typeof prompt === "string") return prompt;
    return prompt.render(context || {});
  }
}
```

### 6.5 前端 BaseDialog

```typescript
// components/composed/dialogs/BaseDialog.tsx
import { Modal } from '@/components/ui/feedback';
import { Button } from '@/components/ui/primitives';
import { LoadingState, ErrorState } from '@/components/ui/states';

export interface BaseDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  loading?: boolean;
  error?: string | null;
  footer?: React.ReactNode;
  showFooter?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void | Promise<void>;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  className?: string;
}

export function BaseDialog({
  open, onClose, title, description, children, size = 'md',
  loading = false, error = null, footer, showFooter = true,
  confirmText = '确认', cancelText = '取消', onConfirm,
  confirmDisabled = false, confirmLoading = false, className,
}: BaseDialogProps) {
  const handleConfirm = async () => {
    if (onConfirm) await onConfirm();
  };

  const defaultFooter = onConfirm ? (
    <div className="flex justify-end gap-3">
      <Button variant="outline" onClick={onClose} disabled={confirmLoading}>
        {cancelText}
      </Button>
      <Button onClick={handleConfirm} disabled={confirmDisabled} loading={confirmLoading}>
        {confirmText}
      </Button>
    </div>
  ) : null;

  return (
    <Modal open={open} onClose={onClose} size={size} className={className}>
      <Modal.Header>
        <Modal.Title>{title}</Modal.Title>
        {description && <Modal.Description>{description}</Modal.Description>}
      </Modal.Header>
      <Modal.Content>
        {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : children}
      </Modal.Content>
      {showFooter && <Modal.Footer>{footer ?? defaultFooter}</Modal.Footer>}
    </Modal>
  );
}
```

### 6.6 前端 useModal Hook

```typescript
// hooks/utils/useModal.ts
import { useState, useCallback } from "react";

export interface UseModalOptions {
  defaultOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface UseModalReturn {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
  modalProps: { open: boolean; onClose: () => void };
}

export function useModal(options: UseModalOptions = {}): UseModalReturn {
  const { defaultOpen = false, onOpen, onClose } = options;
  const [open, setOpen] = useState(defaultOpen);

  const handleOpen = useCallback(() => {
    setOpen(true);
    onOpen?.();
  }, [onOpen]);

  const handleClose = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  const handleToggle = useCallback(() => {
    open ? handleClose() : handleOpen();
  }, [open, handleOpen, handleClose]);

  return {
    open,
    onOpen: handleOpen,
    onClose: handleClose,
    onToggle: handleToggle,
    modalProps: { open, onClose: handleClose },
  };
}
```

---

## 七、测试策略

### 7.1 测试目录规范

```
backend/src/
├── common/
│   └── dtos/
│       └── __tests__/               # 单元测试（就近放置）
│           ├── pagination.dto.spec.ts
│           └── fixtures/            # 测试数据
│
├── modules/
│   └── ai/
│       └── ai-core/
│           └── __tests__/
│               ├── unit/            # 单元测试
│               ├── integration/     # 集成测试
│               └── e2e/             # 端到端测试
│
└── test/                            # 全局测试配置
    ├── setup.ts
    ├── utils/
    └── mocks/

frontend/
├── components/
│   └── ui/
│       └── __tests__/
│           ├── Button.test.tsx
│           └── snapshots/
│
└── __tests__/                       # 前端全局测试
    ├── setup.ts
    └── mocks/
```

### 7.2 测试覆盖率目标

| 模块     | 单元测试 | 集成测试 | E2E 测试 |
| -------- | -------- | -------- | -------- |
| common/  | 90%      | 70%      | -        |
| ai-core/ | 85%      | 80%      | 60%      |
| ai-\*/   | 70%      | 60%      | 50%      |
| content/ | 80%      | 70%      | 50%      |
| core/    | 90%      | 80%      | 70%      |

---

## 八、执行计划

### 8.1 阶段划分

```
┌────────────────────────────────────────────────────────────────┐
│                     重构执行路线图                              │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Phase 1: 后端基础增强 (3天)                                    │
│  • 创建 common/dtos/                                           │
│  • 创建 common/errors/                                         │
│  • 创建 common/interfaces/                                     │
│  • 创建 common/constants/                                      │
│                                                                │
│  Phase 2: AI Core 增强 (4天)                                    │
│  • 创建 ai-core/services/ 基类                                 │
│  • 创建 ai-core/prompts/ 提示词库                              │
│  • 创建 ai-core/agents/ Agent 框架                             │
│                                                                │
│  Phase 3: 前端组件重组 (4天)                                    │
│  • 创建 ui/ 子目录结构                                         │
│  • 创建 composed/ 组合组件                                     │
│  • 合并 shared/ 到新结构                                       │
│                                                                │
│  Phase 4: 可观测性增强 (2天)                                    │
│  • 结构化日志                                                  │
│  • 追踪埋点                                                    │
│  • 监控指标                                                    │
│                                                                │
│  Phase 5: 安全性增强 (2天)                                      │
│  • 安全边界划分                                                │
│  • 输入验证增强                                                │
│                                                                │
│  Phase 6: 清理与验证 (2天)                                      │
│  • 删除废弃目录                                                │
│  • 更新导入路径                                                │
│  • 全面验证                                                    │
│  • 更新文档                                                    │
│                                                                │
│  总计: 17天                                                     │
└────────────────────────────────────────────────────────────────┘
```

### 8.2 Phase 1 详细步骤

```bash
# Step 1: 创建目录
mkdir -p backend/src/common/dtos/{base,ai}
mkdir -p backend/src/common/errors
mkdir -p backend/src/common/interfaces
mkdir -p backend/src/common/constants

# Step 2: 创建文件
# pagination.dto.ts, response.dto.ts
# error.types.ts, error.factory.ts
# ai-service.interface.ts, etc.

# Step 3: 验证
cd backend && npm run type-check && npm run test:quick

# Step 4: 提交
git add backend/src/common/{dtos,errors,interfaces,constants}
git commit -m "feat(common): add unified DTOs, errors, interfaces, constants"
```

### 8.3 迁移原则

1. **渐进式迁移** - 不一次性重构，逐步推进
2. **新旧共存** - 通过 barrel exports 保持兼容
3. **测试先行** - 每次迁移后立即验证
4. **可回滚** - 每个阶段独立提交，可回滚

---

## 九、验收标准

### 9.1 代码质量

- [ ] 所有目录遵循命名约定
- [ ] 无 `shared/` 目录（已合并）
- [ ] 无组件内 hooks 目录
- [ ] TypeScript 严格模式通过
- [ ] ESLint 零错误
- [ ] 组件复用率 > 90%
- [ ] 无重复代码块 > 10 行

### 9.2 功能验证

- [ ] 后端 API 正常工作
- [ ] 前端页面正常渲染
- [ ] 所有测试通过
- [ ] 构建成功

### 9.3 DFx 验收

| DFx 维度 | 验收标准                | 验证方法      |
| -------- | ----------------------- | ------------- |
| DFM      | 模块耦合度 < 3          | 依赖分析工具  |
| DFE      | 新增 AI 模块 < 500 行   | 代码统计      |
| DFT      | 核心覆盖率 > 80%        | Jest coverage |
| DFR      | 单服务故障不影响整体    | 混沌测试      |
| DFS      | 无越权访问路径          | 安全扫描      |
| DFP      | 首屏 < 2s，包 < 500KB   | Lighthouse    |
| DFO      | 问题定位 < 5 分钟       | 故障演练      |
| DFD      | 一键部署，回滚 < 5 分钟 | 部署演练      |

---

## 十、回滚计划

```bash
# 创建重构分支
git checkout -b refactor/architecture-restructure

# 每阶段完成后打标签
git tag phase-1-complete
git tag phase-2-complete
# ...

# 如需回滚到某阶段
git reset --hard phase-X-complete

# 完全回滚
git checkout main
git branch -D refactor/architecture-restructure
```

---

## 十一、风险与缓解

| 风险             | 概率 | 影响 | 缓解措施                |
| ---------------- | ---- | ---- | ----------------------- |
| 导入路径大量报错 | 中   | 高   | 使用 re-export 保持兼容 |
| 构建失败         | 低   | 高   | 每步验证，独立提交      |
| 功能回归         | 低   | 高   | 运行完整测试套件        |
| 团队冲突         | 中   | 中   | 在独立分支进行          |

---

**文档版本**: 3.0
**创建日期**: 2025-12-28
**状态**: 待执行
**预计工期**: 17 天
**执行负责人**: Claude Code
