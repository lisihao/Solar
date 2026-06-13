# GenesisPod 系统优化与整改专项方案

> **版本**: 1.0
> **日期**: 2025-12-25
> **状态**: 待实施

---

## 目录

1. [方案概述](#1-方案概述)
2. [专项一：前端 Hook 统一化改造](#2-专项一前端-hook-统一化改造)
3. [专项二：通用组件库标准化](#3-专项二通用组件库标准化)
4. [专项三：能力注册中心建设](#4-专项三能力注册中心建设)
5. [专项四：导出服务统一化](#5-专项四导出服务统一化)
6. [专项五：内容处理服务合并](#6-专项五内容处理服务合并)
7. [专项六：API 规范统一](#7-专项六api-规范统一)
8. [实施计划与里程碑](#8-实施计划与里程碑)

---

## 1. 方案概述

### 1.1 背景与目标

**当前问题**:

- 49 个前端组件手动管理 loading/error 状态
- 模块间硬性 import 依赖，无法独立部署
- 能力重复建设（URL解析、导出、内容提取）
- API 响应格式不统一

**优化目标**:

- 前端代码复用率提升 60%
- 模块间耦合度降低 50%
- 消除重复建设，统一能力入口
- 建立可扩展的能力平台架构

### 1.2 优先级矩阵

| 专项             | 优先级 | 预估工期 | ROI  | 风险 |
| ---------------- | ------ | -------- | ---- | ---- |
| 前端 Hook 统一化 | P0     | 5 天     | 极高 | 低   |
| 通用组件库标准化 | P0     | 3 天     | 高   | 低   |
| 能力注册中心建设 | P1     | 10 天    | 极高 | 中   |
| 导出服务统一化   | P0     | 3 天     | 高   | 低   |
| 内容处理服务合并 | P1     | 5 天     | 高   | 中   |
| API 规范统一     | P2     | 5 天     | 中   | 低   |

---

## 2. 专项一：前端 Hook 统一化改造

### 2.1 现状分析

**问题组件清单** (49 个需改造):

```
frontend/components/
├── admin/
│   ├── AIModelSettings.tsx          # useState loading/error
│   ├── CollectionManagement.tsx     # useState loading/error
│   ├── ExternalAPIManagement.tsx    # useState loading/error
│   ├── StorageManagement.tsx        # useState loading/error
│   └── UserManagement.tsx           # useState loading/error
├── ai-image/
│   ├── ImageGenerator.tsx           # useState loading/error
│   └── InfographicGenerator.tsx     # useState loading/error
├── ai-office/
│   ├── tabs/DocsTab.tsx             # useState loading/error
│   ├── tabs/SlidesTab.tsx           # useState loading/error
│   └── tabs/DesignerTab.tsx         # useState loading/error
├── ai-coding/
│   ├── TeamChatPanel.tsx            # useState loading/error
│   └── ProjectList.tsx              # useState loading/error
├── explore/
│   ├── ExploreContent.tsx           # useState loading/error
│   ├── ResourceThumbnail.tsx        # useState loading/error
│   └── ResourceDetail.tsx           # useState loading/error
└── ... (34 more files)
```

### 2.2 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    组件层 (Components)                       │
│   只负责 UI 渲染，不直接处理 loading/error                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   领域 Hooks 层                              │
│   useAIModels, useCollections, useResources, ...            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   通用 Hooks 层                              │
│   useApiGet, useApiPost, useApiMutation                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   基础 Hooks 层                              │
│   useAsyncOperation, useAsyncOperationWithRetry             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 改造方案

#### 2.3.1 创建领域 Hooks

**文件**: `frontend/hooks/domain/useAdminModels.ts`

```typescript
import { useApiGet, useApiPost, useApiPut, useApiDelete } from "../useApi";
import type { AIModel, AIModelConfig } from "@/types/ai-models";

export function useAdminModels() {
  // 列表查询
  const {
    data: models,
    loading: listLoading,
    error: listError,
    execute: refreshModels,
  } = useApiGet<AIModel[]>("/api/admin/ai-models", {
    immediate: true,
  });

  // 创建模型
  const {
    loading: createLoading,
    error: createError,
    execute: createModel,
  } = useApiPost<AIModel, Partial<AIModel>>("/api/admin/ai-models");

  // 更新模型
  const {
    loading: updateLoading,
    error: updateError,
    execute: updateModel,
  } = useApiPut<AIModel, { id: string; data: Partial<AIModel> }>(
    "/api/admin/ai-models",
  );

  // 删除模型
  const {
    loading: deleteLoading,
    error: deleteError,
    execute: deleteModel,
  } = useApiDelete<void>("/api/admin/ai-models");

  // 测试连接
  const {
    loading: testLoading,
    error: testError,
    execute: testConnection,
  } = useApiPost<{ success: boolean; message: string }, { modelId: string }>(
    "/api/admin/ai-models/test",
  );

  return {
    // 数据
    models: models ?? [],

    // 加载状态
    loading: listLoading || createLoading || updateLoading || deleteLoading,
    isRefreshing: listLoading,

    // 错误状态
    error: listError || createError || updateError || deleteError || testError,

    // 操作方法
    refreshModels,
    createModel,
    updateModel: (id: string, data: Partial<AIModel>) =>
      updateModel({ id, data }),
    deleteModel: (id: string) => deleteModel({ id }),
    testConnection: (modelId: string) => testConnection({ modelId }),

    // 操作状态
    isCreating: createLoading,
    isUpdating: updateLoading,
    isDeleting: deleteLoading,
    isTesting: testLoading,
  };
}
```

**文件**: `frontend/hooks/domain/useResources.ts`

```typescript
import { useApiGet, useApiPost, useApiDelete } from "../useApi";
import { useCallback, useMemo } from "react";
import type { Resource, ResourceFilter, PaginatedResponse } from "@/types";

interface UseResourcesOptions {
  filter?: ResourceFilter;
  pageSize?: number;
  immediate?: boolean;
}

export function useResources(options: UseResourcesOptions = {}) {
  const { filter, pageSize = 20, immediate = true } = options;

  // 构建查询参数
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filter?.type) params.set("type", filter.type);
    if (filter?.status) params.set("status", filter.status);
    if (filter?.search) params.set("search", filter.search);
    params.set("limit", String(pageSize));
    return params.toString();
  }, [filter, pageSize]);

  // 资源列表
  const {
    data,
    loading,
    error,
    execute: fetch,
  } = useApiGet<PaginatedResponse<Resource>>(`/api/resources?${queryParams}`, {
    immediate,
  });

  // 删除资源
  const { execute: deleteResource, loading: deleting } =
    useApiDelete<void>("/api/resources");

  // 批量操作
  const { execute: batchDelete, loading: batchDeleting } = useApiPost<
    void,
    { ids: string[] }
  >("/api/resources/batch-delete");

  // 刷新（重新获取）
  const refresh = useCallback(() => fetch(), [fetch]);

  return {
    resources: data?.items ?? [],
    total: data?.total ?? 0,
    hasMore: data?.hasMore ?? false,

    loading,
    error,

    refresh,
    deleteResource: (id: string) => deleteResource({ id }),
    batchDelete: (ids: string[]) => batchDelete({ ids }),

    isDeleting: deleting || batchDeleting,
  };
}
```

#### 2.3.2 组件改造示例

**改造前** (`frontend/components/admin/AIModelSettings.tsx`):

```typescript
// ❌ 问题代码：手动管理状态
export function AIModelSettings() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/ai-models');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setModels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (model: AIModel) => {
    setSaving(true);
    try {
      await fetch(`/api/admin/ai-models/${model.id}`, {
        method: 'PUT',
        body: JSON.stringify(model),
      });
      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      {models.map(model => (
        <ModelCard
          key={model.id}
          model={model}
          onSave={handleSave}
          saving={saving}
        />
      ))}
    </div>
  );
}
```

**改造后**:

```typescript
// ✅ 改造后：使用领域 Hook
import { useAdminModels } from '@/hooks/domain/useAdminModels';
import { LoadingState, ErrorState } from '@/components/ui';

export function AIModelSettings() {
  const {
    models,
    loading,
    error,
    updateModel,
    isUpdating,
    refreshModels,
  } = useAdminModels();

  if (loading) return <LoadingState text="加载模型配置..." />;
  if (error) return <ErrorState error={error} onRetry={refreshModels} />;

  return (
    <div>
      {models.map(model => (
        <ModelCard
          key={model.id}
          model={model}
          onSave={(data) => updateModel(model.id, data)}
          saving={isUpdating}
        />
      ))}
    </div>
  );
}
```

### 2.4 领域 Hooks 完整清单

| Hook 名称             | 文件路径                              | 覆盖组件                             |
| --------------------- | ------------------------------------- | ------------------------------------ |
| `useAdminModels`      | `hooks/domain/useAdminModels.ts`      | AIModelSettings, ModelCard           |
| `useAdminUsers`       | `hooks/domain/useAdminUsers.ts`       | UserManagement                       |
| `useAdminStorage`     | `hooks/domain/useAdminStorage.ts`     | StorageManagement                    |
| `useAdminCollections` | `hooks/domain/useAdminCollections.ts` | CollectionManagement                 |
| `useResources`        | `hooks/domain/useResources.ts`        | ExploreContent, ResourceList         |
| `useResourceDetail`   | `hooks/domain/useResourceDetail.ts`   | ResourceDetail, ResourceThumbnail    |
| `useAIOffice`         | `hooks/domain/useAIOffice.ts`         | DocsTab, SlidesTab, DesignerTab      |
| `useAIImage`          | `hooks/domain/useAIImage.ts`          | ImageGenerator, InfographicGenerator |
| `useAICoding`         | `hooks/domain/useAICoding.ts`         | TeamChatPanel, ProjectList           |
| `useAITeams`          | `hooks/domain/useAITeams.ts`          | (已存在，扩展)                       |

### 2.5 验收标准

- [ ] 手动管理 loading 的组件从 49 个降至 0 个
- [ ] 所有领域 Hooks 有单元测试
- [ ] 代码行数减少 30%+

---

## 3. 专项二：通用组件库标准化

### 3.1 新增通用组件

#### 3.1.1 LoadingState 组件

**文件**: `frontend/components/ui/LoadingState.tsx`

```typescript
'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface LoadingStateProps {
  /** 加载提示文本 */
  text?: string;
  /** 尺寸: sm | md | lg */
  size?: 'sm' | 'md' | 'lg';
  /** 是否全屏居中 */
  fullScreen?: boolean;
  /** 是否显示背景遮罩 */
  overlay?: boolean;
  /** 自定义类名 */
  className?: string;
}

const sizeConfig = {
  sm: { icon: 'h-4 w-4', text: 'text-sm' },
  md: { icon: 'h-6 w-6', text: 'text-base' },
  lg: { icon: 'h-8 w-8', text: 'text-lg' },
};

export function LoadingState({
  text = '加载中...',
  size = 'md',
  fullScreen = false,
  overlay = false,
  className,
}: LoadingStateProps) {
  const config = sizeConfig[size];

  const content = (
    <div className={cn('flex flex-col items-center justify-center gap-3', className)}>
      <Loader2 className={cn('animate-spin text-violet-600', config.icon)} />
      {text && (
        <p className={cn('text-gray-500', config.text)}>{text}</p>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        overlay && 'bg-white/80 backdrop-blur-sm'
      )}>
        {content}
      </div>
    );
  }

  return (
    <div className="flex min-h-[200px] items-center justify-center">
      {content}
    </div>
  );
}

// 骨架屏变体
export function LoadingSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('animate-pulse space-y-3', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded bg-gray-200"
          style={{ width: `${100 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

// 内联加载变体
export function LoadingInline({
  text = '加载中',
  className,
}: {
  text?: string;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-gray-500', className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </span>
  );
}
```

#### 3.1.2 ErrorState 组件

**文件**: `frontend/components/ui/ErrorState.tsx`

```typescript
'use client';

import { AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils/common';
import { Button } from './button';

interface ErrorStateProps {
  /** 错误对象或消息 */
  error: Error | string | null;
  /** 重试回调 */
  onRetry?: () => void;
  /** 标题 */
  title?: string;
  /** 是否显示详情 */
  showDetails?: boolean;
  /** 是否全屏居中 */
  fullScreen?: boolean;
  /** 自定义类名 */
  className?: string;
}

export function ErrorState({
  error,
  onRetry,
  title = '加载失败',
  showDetails = true,
  fullScreen = false,
  className,
}: ErrorStateProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;

  const content = (
    <div className={cn(
      'flex flex-col items-center justify-center gap-4 p-6 text-center',
      className
    )}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <AlertCircle className="h-6 w-6 text-red-600" />
      </div>

      <div className="space-y-1">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {errorMessage && (
          <p className="text-sm text-gray-500">{errorMessage}</p>
        )}
      </div>

      <div className="flex gap-3">
        {onRetry && (
          <Button onClick={onRetry} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            重试
          </Button>
        )}
      </div>

      {showDetails && errorStack && process.env.NODE_ENV === 'development' && (
        <div className="w-full max-w-md">
          <button
            onClick={() => setDetailsOpen(!detailsOpen)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            <ChevronDown className={cn(
              'h-3 w-3 transition-transform',
              detailsOpen && 'rotate-180'
            )} />
            错误详情
          </button>
          {detailsOpen && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-100 p-2 text-left text-xs text-gray-600">
              {errorStack}
            </pre>
          )}
        </div>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        {content}
      </div>
    );
  }

  return content;
}

// 内联错误变体
export function ErrorInline({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700',
      className
    )}>
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex-shrink-0 text-red-600 hover:text-red-800"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
```

#### 3.1.3 EmptyState 组件

**文件**: `frontend/components/ui/EmptyState.tsx`

```typescript
'use client';

import { Inbox, Search, FileX, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { Button } from './button';

type EmptyType = 'default' | 'search' | 'noData' | 'error';

interface EmptyStateProps {
  type?: EmptyType;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const defaultConfig: Record<EmptyType, { icon: React.ReactNode; title: string; description: string }> = {
  default: {
    icon: <Inbox className="h-12 w-12" />,
    title: '暂无内容',
    description: '这里还没有任何内容',
  },
  search: {
    icon: <Search className="h-12 w-12" />,
    title: '未找到结果',
    description: '尝试调整搜索条件或筛选器',
  },
  noData: {
    icon: <FileX className="h-12 w-12" />,
    title: '暂无数据',
    description: '开始创建你的第一个项目',
  },
  error: {
    icon: <FileX className="h-12 w-12" />,
    title: '加载失败',
    description: '请稍后重试',
  },
};

export function EmptyState({
  type = 'default',
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  const config = defaultConfig[type];

  return (
    <div className={cn(
      'flex min-h-[300px] flex-col items-center justify-center gap-4 p-8 text-center',
      className
    )}>
      <div className="text-gray-300">
        {icon || config.icon}
      </div>
      <div className="space-y-1">
        <h3 className="font-medium text-gray-900">
          {title || config.title}
        </h3>
        <p className="text-sm text-gray-500">
          {description || config.description}
        </p>
      </div>
      {action && (
        <Button onClick={action.onClick}>
          <Plus className="mr-2 h-4 w-4" />
          {action.label}
        </Button>
      )}
    </div>
  );
}
```

#### 3.1.4 ConfirmDialog 组件

**文件**: `frontend/components/ui/ConfirmDialog.tsx`

```typescript
'use client';

import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './button';
import { cn } from '@/lib/utils/common';

type ConfirmType = 'danger' | 'warning' | 'info' | 'success';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  type?: ConfirmType;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
}

const typeConfig: Record<ConfirmType, {
  icon: React.ReactNode;
  iconBg: string;
  confirmVariant: 'default' | 'destructive' | 'outline';
}> = {
  danger: {
    icon: <XCircle className="h-6 w-6 text-red-600" />,
    iconBg: 'bg-red-100',
    confirmVariant: 'destructive',
  },
  warning: {
    icon: <AlertTriangle className="h-6 w-6 text-amber-600" />,
    iconBg: 'bg-amber-100',
    confirmVariant: 'default',
  },
  info: {
    icon: <Info className="h-6 w-6 text-blue-600" />,
    iconBg: 'bg-blue-100',
    confirmVariant: 'default',
  },
  success: {
    icon: <CheckCircle className="h-6 w-6 text-green-600" />,
    iconBg: 'bg-green-100',
    confirmVariant: 'default',
  },
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  type = 'warning',
  confirmText = '确认',
  cancelText = '取消',
  loading = false,
}: ConfirmDialogProps) {
  const config = typeConfig[type];

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <div className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full',
          config.iconBg
        )}>
          {config.icon}
        </div>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          {description && (
            <p className="text-sm text-gray-500">{description}</p>
          )}
        </div>

        <div className="flex w-full gap-3 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            variant={config.confirmVariant}
            className="flex-1"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? '处理中...' : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Hook 简化使用
import { useState, useCallback } from 'react';

interface UseConfirmOptions {
  title: string;
  description?: string;
  type?: ConfirmType;
  confirmText?: string;
}

export function useConfirm(options: UseConfirmOptions) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  const confirm = useCallback((action: () => Promise<void>) => {
    setPendingAction(() => action);
    setOpen(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    setLoading(true);
    try {
      await pendingAction();
    } finally {
      setLoading(false);
      setOpen(false);
      setPendingAction(null);
    }
  }, [pendingAction]);

  const dialog = (
    <ConfirmDialog
      open={open}
      onClose={() => setOpen(false)}
      onConfirm={handleConfirm}
      loading={loading}
      {...options}
    />
  );

  return { confirm, dialog };
}
```

### 3.2 组件导出统一

**文件**: `frontend/components/ui/index.ts`

```typescript
// 基础组件
export { Button, buttonVariants } from "./button";
export { Modal } from "./Modal";
export { Toast, useToast } from "./Toast";

// 状态组件
export { LoadingState, LoadingSkeleton, LoadingInline } from "./LoadingState";
export { ErrorState, ErrorInline } from "./ErrorState";
export { EmptyState } from "./EmptyState";

// 交互组件
export { ConfirmDialog, useConfirm } from "./ConfirmDialog";
export { DropdownMenu } from "./dropdown-menu";
export { Switch } from "./switch";

// 布局组件
export {
  ResponsiveCard,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  CardActions,
} from "./ResponsiveCard";
export { CollapsibleMessage } from "./CollapsibleMessage";
export { CollapsibleBlockquote } from "./CollapsibleBlockquote";
```

### 3.3 验收标准

- [ ] 所有新增组件有 TypeScript 类型定义
- [ ] 组件支持自定义样式 (className prop)
- [ ] 组件有默认配置，减少使用时参数传递

---

## 4. 专项三：能力注册中心建设

### 4.1 架构设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CapabilityOrchestrator (能力编排器)                   │
│   • 能力发现      • 调用路由      • 管道组合      • 并行执行                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CapabilityRegistry (能力注册中心)                     │
│   • 能力注册      • 元数据管理      • 依赖图      • 索引查询                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────────────┐
│   Studio    │   Office    │   Teams     │   Image     │    Agents           │
│  Provider   │  Provider   │  Provider   │  Provider   │   Provider          │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────────────┤
│deep-research│ppt-generate │mission-exec │image-gen    │agent-execute        │
│source-parse │doc-generate │task-delegate│infographic  │tool-call            │
│report-synth │doc-export   │url-parse    │             │                     │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────────────┘
                                      │
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CapabilityEventBus (事件总线)                         │
│   • 进度通知      • 完成回调      • 跨模块协调      • 状态同步               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 核心接口定义

**文件**: `backend/src/common/capabilities/interfaces/capability.interface.ts`

```typescript
import { JSONSchema7 } from "json-schema";

/**
 * 能力执行模式
 */
export enum CapabilityMode {
  SYNC = "sync", // 同步执行
  ASYNC = "async", // 异步任务
  STREAMING = "streaming", // 流式输出
}

/**
 * 能力分类
 */
export enum CapabilityCategory {
  RESEARCH = "research", // 研究类
  GENERATION = "generation", // 生成类
  COLLABORATION = "collaboration", // 协作类
  VISUAL = "visual", // 视觉类
  ORCHESTRATION = "orchestration", // 编排类
}

/**
 * 能力元数据
 */
export interface CapabilityMetadata {
  /** 唯一标识，格式: provider:capability */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 分类 */
  category: CapabilityCategory;
  /** 提供方模块 */
  provider: string;
  /** 执行模式 */
  mode: CapabilityMode;
  /** 输入 Schema */
  inputSchema: JSONSchema7;
  /** 输出 Schema */
  outputSchema: JSONSchema7;
  /** 标签 */
  tags: string[];
  /** 版本 */
  version: string;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 执行上下文
 */
export interface CapabilityContext {
  /** 用户 ID */
  userId: string;
  /** 请求 ID */
  requestId: string;
  /** 追踪 ID */
  traceId?: string;
  /** 超时时间 (ms) */
  timeout?: number;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 执行结果
 */
export interface CapabilityResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: {
    duration: number;
    tokensUsed?: number;
  };
}

/**
 * 流式事件
 */
export interface CapabilityEvent<T = unknown> {
  type: "progress" | "data" | "complete" | "error";
  progress?: number;
  message?: string;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 能力接口
 */
export interface ICapability<TInput = unknown, TOutput = unknown> {
  /** 获取元数据 */
  getMetadata(): CapabilityMetadata;

  /** 同步执行 */
  execute(
    input: TInput,
    context: CapabilityContext,
  ): Promise<CapabilityResult<TOutput>>;

  /** 流式执行 (可选) */
  executeStream?(
    input: TInput,
    context: CapabilityContext,
  ): AsyncGenerator<CapabilityEvent<TOutput>>;

  /** 验证输入 */
  validateInput?(input: TInput): { valid: boolean; errors?: string[] };
}
```

### 4.3 能力注册服务

**文件**: `backend/src/common/capabilities/capability-registry.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import {
  ICapability,
  CapabilityMetadata,
  CapabilityCategory,
} from "./interfaces/capability.interface";

@Injectable()
export class CapabilityRegistryService implements OnModuleInit {
  private readonly logger = new Logger(CapabilityRegistryService.name);
  private readonly capabilities = new Map<string, ICapability>();
  private readonly metadataIndex = new Map<string, CapabilityMetadata>();

  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleInit() {
    this.logger.log("CapabilityRegistry initialized");
  }

  /**
   * 注册能力
   */
  register(capability: ICapability): void {
    const metadata = capability.getMetadata();

    if (this.capabilities.has(metadata.id)) {
      this.logger.warn(
        `Capability ${metadata.id} already registered, replacing...`,
      );
    }

    this.capabilities.set(metadata.id, capability);
    this.metadataIndex.set(metadata.id, metadata);

    this.logger.log(`Registered capability: ${metadata.id} (${metadata.name})`);
  }

  /**
   * 批量注册
   */
  registerAll(capabilities: ICapability[]): void {
    capabilities.forEach((cap) => this.register(cap));
  }

  /**
   * 获取能力
   */
  get<TInput, TOutput>(id: string): ICapability<TInput, TOutput> | undefined {
    return this.capabilities.get(id) as
      | ICapability<TInput, TOutput>
      | undefined;
  }

  /**
   * 获取元数据
   */
  getMetadata(id: string): CapabilityMetadata | undefined {
    return this.metadataIndex.get(id);
  }

  /**
   * 列出所有能力
   */
  list(filter?: {
    category?: CapabilityCategory;
    provider?: string;
    tags?: string[];
    enabled?: boolean;
  }): CapabilityMetadata[] {
    let result = Array.from(this.metadataIndex.values());

    if (filter?.category) {
      result = result.filter((m) => m.category === filter.category);
    }
    if (filter?.provider) {
      result = result.filter((m) => m.provider === filter.provider);
    }
    if (filter?.tags?.length) {
      result = result.filter((m) =>
        filter.tags!.some((tag) => m.tags.includes(tag)),
      );
    }
    if (filter?.enabled !== undefined) {
      result = result.filter((m) => m.enabled === filter.enabled);
    }

    return result;
  }

  /**
   * 按分类分组
   */
  groupByCategory(): Record<CapabilityCategory, CapabilityMetadata[]> {
    const grouped: Record<CapabilityCategory, CapabilityMetadata[]> = {
      [CapabilityCategory.RESEARCH]: [],
      [CapabilityCategory.GENERATION]: [],
      [CapabilityCategory.COLLABORATION]: [],
      [CapabilityCategory.VISUAL]: [],
      [CapabilityCategory.ORCHESTRATION]: [],
    };

    for (const metadata of this.metadataIndex.values()) {
      grouped[metadata.category].push(metadata);
    }

    return grouped;
  }

  /**
   * 检查能力是否存在
   */
  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    byCategory: Record<CapabilityCategory, number>;
    byProvider: Record<string, number>;
  } {
    const byCategory: Record<CapabilityCategory, number> = {
      [CapabilityCategory.RESEARCH]: 0,
      [CapabilityCategory.GENERATION]: 0,
      [CapabilityCategory.COLLABORATION]: 0,
      [CapabilityCategory.VISUAL]: 0,
      [CapabilityCategory.ORCHESTRATION]: 0,
    };
    const byProvider: Record<string, number> = {};

    for (const metadata of this.metadataIndex.values()) {
      byCategory[metadata.category]++;
      byProvider[metadata.provider] = (byProvider[metadata.provider] || 0) + 1;
    }

    return {
      total: this.capabilities.size,
      byCategory,
      byProvider,
    };
  }
}
```

### 4.4 能力编排服务

**文件**: `backend/src/common/capabilities/capability-orchestrator.service.ts`

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { CapabilityRegistryService } from "./capability-registry.service";
import { StreamingService } from "../streaming/streaming.service";
import {
  ICapability,
  CapabilityContext,
  CapabilityResult,
  CapabilityEvent,
  CapabilityMode,
} from "./interfaces/capability.interface";

interface CallOptions {
  capabilityId: string;
  input: unknown;
  context?: Partial<CapabilityContext>;
}

interface PipelineStep {
  capabilityId: string;
  inputTransform?: (prevOutput: unknown) => unknown;
}

interface PipelineOptions {
  name: string;
  steps: PipelineStep[];
  initialInput: unknown;
  context?: Partial<CapabilityContext>;
}

@Injectable()
export class CapabilityOrchestratorService {
  private readonly logger = new Logger(CapabilityOrchestratorService.name);

  constructor(
    private readonly registry: CapabilityRegistryService,
    private readonly streaming: StreamingService,
  ) {}

  /**
   * 调用单个能力
   */
  async call<TOutput = unknown>(
    options: CallOptions,
  ): Promise<CapabilityResult<TOutput>> {
    const { capabilityId, input, context } = options;
    const startTime = Date.now();

    const capability = this.registry.get(capabilityId);
    if (!capability) {
      return {
        success: false,
        error: {
          code: "CAPABILITY_NOT_FOUND",
          message: `Capability ${capabilityId} not found`,
        },
      };
    }

    const fullContext = this.buildContext(context);

    try {
      // 验证输入
      if (capability.validateInput) {
        const validation = capability.validateInput(input);
        if (!validation.valid) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Input validation failed",
              details: validation.errors,
            },
          };
        }
      }

      // 执行能力
      const result = await capability.execute(input, fullContext);

      this.logger.log(
        `Capability ${capabilityId} executed in ${Date.now() - startTime}ms`,
      );

      return result as CapabilityResult<TOutput>;
    } catch (error) {
      this.logger.error(`Capability ${capabilityId} failed:`, error);
      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * 流式调用
   */
  async *callStream<TOutput = unknown>(
    options: CallOptions,
  ): AsyncGenerator<CapabilityEvent<TOutput>> {
    const { capabilityId, input, context } = options;

    const capability = this.registry.get(capabilityId);
    if (!capability) {
      yield {
        type: "error",
        error: {
          code: "CAPABILITY_NOT_FOUND",
          message: `Capability ${capabilityId} not found`,
        },
      };
      return;
    }

    const metadata = capability.getMetadata();
    if (
      metadata.mode !== CapabilityMode.STREAMING ||
      !capability.executeStream
    ) {
      yield {
        type: "error",
        error: {
          code: "STREAMING_NOT_SUPPORTED",
          message: `Capability ${capabilityId} does not support streaming`,
        },
      };
      return;
    }

    const fullContext = this.buildContext(context);

    try {
      for await (const event of capability.executeStream(input, fullContext)) {
        yield event as CapabilityEvent<TOutput>;
      }
    } catch (error) {
      yield {
        type: "error",
        error: {
          code: "STREAM_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * 并行调用多个能力
   */
  async callParallel<T extends Record<string, CallOptions>>(
    calls: T,
  ): Promise<{ [K in keyof T]: CapabilityResult }> {
    const entries = Object.entries(calls);
    const results = await Promise.all(
      entries.map(([key, options]) =>
        this.call(options).then((result) => [key, result] as const),
      ),
    );

    return Object.fromEntries(results) as { [K in keyof T]: CapabilityResult };
  }

  /**
   * 执行能力管道
   */
  async executePipeline<TOutput = unknown>(
    options: PipelineOptions,
  ): Promise<CapabilityResult<TOutput>> {
    const { name, steps, initialInput, context } = options;
    const startTime = Date.now();

    this.logger.log(`Starting pipeline: ${name} with ${steps.length} steps`);

    let currentInput = initialInput;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // 应用输入转换
      const stepInput = step.inputTransform
        ? step.inputTransform(currentInput)
        : currentInput;

      // 执行当前步骤
      const result = await this.call({
        capabilityId: step.capabilityId,
        input: stepInput,
        context: {
          ...context,
          metadata: {
            ...context?.metadata,
            pipelineName: name,
            pipelineStep: i + 1,
            pipelineTotalSteps: steps.length,
          },
        },
      });

      if (!result.success) {
        this.logger.error(`Pipeline ${name} failed at step ${i + 1}`);
        return result as CapabilityResult<TOutput>;
      }

      currentInput = result.data;
    }

    this.logger.log(
      `Pipeline ${name} completed in ${Date.now() - startTime}ms`,
    );

    return {
      success: true,
      data: currentInput as TOutput,
      metadata: {
        duration: Date.now() - startTime,
      },
    };
  }

  private buildContext(
    partial?: Partial<CapabilityContext>,
  ): CapabilityContext {
    return {
      userId: partial?.userId || "system",
      requestId: partial?.requestId || `req_${Date.now()}`,
      traceId: partial?.traceId,
      timeout: partial?.timeout || 60000,
      metadata: partial?.metadata,
    };
  }
}
```

### 4.5 能力实现示例

**文件**: `backend/src/modules/ai/ai-studio/capabilities/deep-research.capability.ts`

```typescript
import { Injectable } from "@nestjs/common";
import {
  ICapability,
  CapabilityMetadata,
  CapabilityContext,
  CapabilityResult,
  CapabilityEvent,
  CapabilityMode,
  CapabilityCategory,
} from "@/common/capabilities/interfaces/capability.interface";
import { DeepResearchAgentService } from "../deep-research/deep-research-agent.service";

interface DeepResearchInput {
  topic: string;
  depth: "quick" | "standard" | "deep";
  language?: "zh" | "en";
  maxSources?: number;
}

interface DeepResearchOutput {
  report: string;
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  outline: string[];
  tokensUsed: number;
}

@Injectable()
export class DeepResearchCapability implements ICapability<
  DeepResearchInput,
  DeepResearchOutput
> {
  constructor(private readonly deepResearchService: DeepResearchAgentService) {}

  getMetadata(): CapabilityMetadata {
    return {
      id: "ai-studio:deep-research",
      name: "深度研究",
      description: "对指定主题进行深入研究，生成结构化研究报告",
      category: CapabilityCategory.RESEARCH,
      provider: "ai-studio",
      mode: CapabilityMode.STREAMING,
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", minLength: 1, maxLength: 500 },
          depth: { type: "string", enum: ["quick", "standard", "deep"] },
          language: { type: "string", enum: ["zh", "en"], default: "zh" },
          maxSources: { type: "number", minimum: 5, maximum: 50, default: 20 },
        },
        required: ["topic", "depth"],
      },
      outputSchema: {
        type: "object",
        properties: {
          report: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                url: { type: "string" },
                snippet: { type: "string" },
              },
            },
          },
          outline: { type: "array", items: { type: "string" } },
          tokensUsed: { type: "number" },
        },
      },
      tags: ["research", "report", "ai"],
      version: "1.0.0",
      enabled: true,
    };
  }

  validateInput(input: DeepResearchInput): {
    valid: boolean;
    errors?: string[];
  } {
    const errors: string[] = [];

    if (!input.topic || input.topic.trim().length === 0) {
      errors.push("Topic is required");
    }
    if (input.topic && input.topic.length > 500) {
      errors.push("Topic must be less than 500 characters");
    }
    if (!["quick", "standard", "deep"].includes(input.depth)) {
      errors.push("Depth must be one of: quick, standard, deep");
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(
    input: DeepResearchInput,
    context: CapabilityContext,
  ): Promise<CapabilityResult<DeepResearchOutput>> {
    const startTime = Date.now();

    try {
      const result = await this.deepResearchService.executeResearch({
        topic: input.topic,
        depth: input.depth,
        language: input.language || "zh",
        maxSources: input.maxSources || 20,
        userId: context.userId,
      });

      return {
        success: true,
        data: {
          report: result.report,
          sources: result.sources,
          outline: result.outline,
          tokensUsed: result.tokensUsed,
        },
        metadata: {
          duration: Date.now() - startTime,
          tokensUsed: result.tokensUsed,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: "RESEARCH_FAILED",
          message: error instanceof Error ? error.message : "Research failed",
        },
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }

  async *executeStream(
    input: DeepResearchInput,
    context: CapabilityContext,
  ): AsyncGenerator<CapabilityEvent<DeepResearchOutput>> {
    yield { type: "progress", progress: 0, message: "开始研究..." };

    try {
      // 规划阶段
      yield { type: "progress", progress: 10, message: "制定研究计划..." };

      // 搜索阶段
      yield { type: "progress", progress: 30, message: "搜索相关资料..." };

      // 分析阶段
      yield { type: "progress", progress: 60, message: "分析整理内容..." };

      // 生成阶段
      yield { type: "progress", progress: 80, message: "生成研究报告..." };

      const result = await this.execute(input, context);

      if (result.success) {
        yield { type: "progress", progress: 100, message: "研究完成" };
        yield { type: "complete", data: result.data };
      } else {
        yield { type: "error", error: result.error };
      }
    } catch (error) {
      yield {
        type: "error",
        error: {
          code: "STREAM_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }
}
```

### 4.6 能力模块配置

**文件**: `backend/src/common/capabilities/capabilities.module.ts`

```typescript
import { Global, Module } from "@nestjs/common";
import { CapabilityRegistryService } from "./capability-registry.service";
import { CapabilityOrchestratorService } from "./capability-orchestrator.service";
import { StreamingModule } from "../streaming/streaming.module";

@Global()
@Module({
  imports: [StreamingModule],
  providers: [CapabilityRegistryService, CapabilityOrchestratorService],
  exports: [CapabilityRegistryService, CapabilityOrchestratorService],
})
export class CapabilitiesModule {}
```

### 4.7 验收标准

- [ ] CapabilityRegistry 支持注册、查询、分组
- [ ] CapabilityOrchestrator 支持单调用、并行、管道
- [ ] 至少 6 个高优先级能力完成迁移
- [ ] ai-agents 模块 import 依赖减少 50%

---

## 5. 专项四：导出服务统一化

### 5.1 现状分析

**当前分散的导出实现**:

| 位置                             | 服务                  | 功能            |
| -------------------------------- | --------------------- | --------------- |
| `modules/export/`                | ExportService         | 统一导出 (新建) |
| `modules/ai/ai-office/services/` | DocumentExportService | 文档导出        |
| `modules/ai/ai-image/services/`  | ExportService         | 图片导出        |

### 5.2 统一方案

所有导出功能迁移到 `modules/export/` 模块，其他模块通过依赖注入使用。

**文件结构**:

```
backend/src/modules/export/
├── export.module.ts
├── export.controller.ts
├── services/
│   ├── export.service.ts           # 主服务
│   ├── document-export.service.ts  # 文档导出
│   ├── image-export.service.ts     # 图片导出
│   ├── slide-export.service.ts     # PPT导出
│   └── data-export.service.ts      # 数据导出
├── templates/
│   ├── document-templates.ts
│   └── slide-templates.ts
├── processors/
│   ├── pdf.processor.ts
│   ├── docx.processor.ts
│   ├── pptx.processor.ts
│   └── xlsx.processor.ts
└── dto/
    └── export.dto.ts
```

### 5.3 迁移步骤

1. **扩展 ExportModule** - 整合所有导出处理器
2. **创建适配层** - 保持现有 API 兼容
3. **逐步迁移调用方** - ai-office, ai-image 等
4. **删除旧代码** - 移除重复实现

### 5.4 验收标准

- [ ] 所有导出功能通过 ExportModule 提供
- [ ] ai-office/ai-image 中的 ExportService 已删除
- [ ] 导出 API 统一为 `/api/export/*`

---

## 6. 专项五：内容处理服务合并

### 6.1 现状分析

**当前分散的实现**:

| 位置                         | 服务                     | 功能               |
| ---------------------------- | ------------------------ | ------------------ |
| `ai-teams/services/`         | UrlParserService         | URL 解析、内容提取 |
| `ai-teams/services/`         | ContentExtractionService | 内容提取           |
| `ai-studio/services/`        | AiStudioSourceService    | 资源解析           |
| `common/content-processing/` | ContentExtractorService  | 内容提取           |
| `common/content-processing/` | DataFetchingService      | 数据获取           |

### 6.2 统一方案

**目标结构**:

```
backend/src/common/content-processing/
├── content-processing.module.ts
├── services/
│   ├── url-parser.service.ts        # URL 解析 (统一)
│   ├── content-extractor.service.ts # 内容提取 (统一)
│   ├── data-fetching.service.ts     # 数据获取
│   └── mineru.service.ts            # PDF/文档解析
├── extractors/
│   ├── web-extractor.ts             # 网页提取
│   ├── pdf-extractor.ts             # PDF 提取
│   ├── youtube-extractor.ts         # YouTube 提取
│   └── social-extractor.ts          # 社交媒体提取
└── interfaces/
    └── extractor.interface.ts
```

### 6.3 统一接口

```typescript
// content-processing/interfaces/extractor.interface.ts
export interface ExtractedContent {
  title: string;
  content: string;
  summary?: string;
  author?: string;
  publishedAt?: Date;
  images?: string[];
  metadata?: Record<string, unknown>;
}

export interface IContentExtractor {
  canHandle(url: string): boolean;
  extract(url: string, options?: ExtractOptions): Promise<ExtractedContent>;
}
```

### 6.4 验收标准

- [ ] 所有内容提取通过 ContentProcessingModule
- [ ] ai-teams/ai-studio 中的重复服务已删除
- [ ] 提取器支持扩展 (实现 IContentExtractor 接口)

---

## 7. 专项六：API 规范统一

### 7.1 响应格式规范

**统一响应结构**:

```typescript
// 成功响应
interface SuccessResponse<T> {
  success: true;
  data: T;
  metadata?: {
    requestId: string;
    timestamp: string;
    duration?: number;
  };
}

// 错误响应
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  metadata?: {
    requestId: string;
    timestamp: string;
  };
}

// 分页响应
interface PaginatedResponse<T> {
  success: true;
  data: {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
  metadata?: {
    requestId: string;
    timestamp: string;
  };
}
```

### 7.2 API 命名规范

| 操作 | 方法   | 路径格式                                 | 示例                                  |
| ---- | ------ | ---------------------------------------- | ------------------------------------- |
| 列表 | GET    | `/api/{module}/{resource}`               | `/api/ai-studio/projects`             |
| 详情 | GET    | `/api/{module}/{resource}/{id}`          | `/api/ai-studio/projects/123`         |
| 创建 | POST   | `/api/{module}/{resource}`               | `/api/ai-studio/projects`             |
| 更新 | PUT    | `/api/{module}/{resource}/{id}`          | `/api/ai-studio/projects/123`         |
| 删除 | DELETE | `/api/{module}/{resource}/{id}`          | `/api/ai-studio/projects/123`         |
| 操作 | POST   | `/api/{module}/{resource}/{id}/{action}` | `/api/ai-studio/projects/123/execute` |

### 7.3 响应拦截器

**文件**: `backend/src/common/interceptors/response-transform.interceptor.ts`

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const requestId = request.headers["x-request-id"] || uuidv4();
    const startTime = Date.now();

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
        },
      })),
    );
  }
}
```

### 7.4 验收标准

- [ ] 所有 API 返回统一格式
- [ ] 所有 API 路径符合命名规范
- [ ] 响应包含 requestId 和 timestamp

---

## 8. 实施计划与里程碑

### 8.1 时间线

```
Week 1-2: P0 专项
├── Day 1-3: 前端 Hook 统一化 (20 个高频组件)
├── Day 4-5: 通用组件库创建 (LoadingState, ErrorState, EmptyState)
├── Day 6-7: 导出服务统一化
└── Day 8-10: 剩余组件迁移

Week 3-4: P1 专项
├── Day 1-5: 能力注册中心基础设施
├── Day 6-8: 高优先级能力迁移 (6 个)
└── Day 9-10: 内容处理服务合并

Week 5: P2 专项
├── Day 1-3: API 规范统一
├── Day 4-5: 测试与验收
```

### 8.2 里程碑验收

| 里程碑           | 时间   | 验收标准                  |
| ---------------- | ------ | ------------------------- |
| M1: 前端质量提升 | Week 2 | 手动 loading 组件 < 10 个 |
| M2: 能力共享机制 | Week 4 | 6 个能力完成注册中心迁移  |
| M3: 架构规范化   | Week 5 | API 格式统一，测试通过    |

### 8.3 风险与缓解

| 风险              | 影响 | 概率 | 缓解措施               |
| ----------------- | ---- | ---- | ---------------------- |
| 能力迁移导致回归  | 高   | 中   | 增加集成测试、灰度发布 |
| Hook 迁移影响性能 | 中   | 低   | 性能基准测试           |
| 工作量超预期      | 中   | 中   | 优先迁移高价值能力     |

---

## 附录

### A. 文件清单

| 新增文件   | 路径                                                                |
| ---------- | ------------------------------------------------------------------- |
| 领域 Hooks | `frontend/hooks/domain/*.ts`                                        |
| 通用组件   | `frontend/components/ui/LoadingState.tsx` 等                        |
| 能力接口   | `backend/src/common/capabilities/interfaces/*.ts`                   |
| 能力注册   | `backend/src/common/capabilities/*.service.ts`                      |
| 响应拦截器 | `backend/src/common/interceptors/response-transform.interceptor.ts` |

### B. 删除清单

| 删除文件                  | 路径                                      | 原因                           |
| ------------------------- | ----------------------------------------- | ------------------------------ |
| ai-office ExportService   | `ai-office/services/export.service.ts`    | 迁移到 ExportModule            |
| ai-teams UrlParserService | `ai-teams/services/url-parser.service.ts` | 迁移到 ContentProcessingModule |

### C. 参考资源

- [Dify 架构设计](https://docs.dify.ai/development/architecture)
- [LangChain LCEL](https://python.langchain.com/docs/expression_language/)
- [NestJS 最佳实践](https://docs.nestjs.com/techniques/performance)

---

**文档结束**
