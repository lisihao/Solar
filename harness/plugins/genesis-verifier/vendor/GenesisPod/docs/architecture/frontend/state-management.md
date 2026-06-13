# 状态管理架构

## 概述

GenesisPod 采用双轨状态管理策略：

- **TanStack Query (React Query)**: 管理服务端状态
- **Zustand**: 管理客户端状态

## TanStack Query 核心原理

### 1. 服务端状态 vs 客户端状态

```
┌─────────────────────────────────────────────────────────┐
│                      应用状态                           │
├─────────────────────────┬───────────────────────────────┤
│     服务端状态           │        客户端状态             │
│  (TanStack Query)       │        (Zustand)             │
├─────────────────────────┼───────────────────────────────┤
│ • API 响应数据           │ • UI 状态 (模态框、侧边栏)    │
│ • 用户信息              │ • 表单临时数据                │
│ • 资源列表              │ • 本地偏好设置                │
│ • 缓存数据              │ • Toast 通知                  │
└─────────────────────────┴───────────────────────────────┘
```

### 2. 查询 (Queries)

基础查询模式：

```tsx
import { useQuery } from "@tanstack/react-query";

function ResourceList() {
  const {
    data, // 查询数据
    isLoading, // 首次加载
    isFetching, // 任何获取中
    isError, // 错误状态
    error, // 错误对象
    refetch, // 手动重新获取
  } = useQuery({
    queryKey: ["resources"], // 缓存键
    queryFn: () => api.getResources(), // 获取函数
    staleTime: 5 * 60 * 1000, // 5分钟内数据新鲜
    gcTime: 30 * 60 * 1000, // 30分钟后垃圾回收
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <Error message={error.message} />;

  return <List items={data} />;
}
```

### 3. 查询键 (Query Keys)

查询键是缓存的唯一标识：

```tsx
// 简单键
queryKey: ["resources"];

// 带参数的键
queryKey: ["resources", { type: "article" }];

// 层级键
queryKey: ["resources", resourceId, "comments"];

// 查询键自动失效
queryClient.invalidateQueries({ queryKey: ["resources"] });
// 这会使所有以 ['resources'] 开头的查询失效
```

### 4. 缓存策略

```tsx
// 永不过期 (静态数据)
useQuery({
  queryKey: ["categories"],
  queryFn: fetchCategories,
  staleTime: Infinity,
});

// 实时数据 (总是刷新)
useQuery({
  queryKey: ["notifications"],
  queryFn: fetchNotifications,
  staleTime: 0,
  refetchInterval: 30000, // 每30秒刷新
});

// 智能缓存
useQuery({
  queryKey: ["resource", id],
  queryFn: () => fetchResource(id),
  staleTime: 5 * 60 * 1000,
  // 窗口聚焦时刷新
  refetchOnWindowFocus: true,
  // 网络恢复时刷新
  refetchOnReconnect: true,
});
```

### 5. 变更 (Mutations)

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";

function CreateResource() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (newResource) => api.createResource(newResource),

    // 乐观更新
    onMutate: async (newResource) => {
      // 取消正在进行的查询
      await queryClient.cancelQueries({ queryKey: ["resources"] });

      // 保存之前的值
      const previousResources = queryClient.getQueryData(["resources"]);

      // 乐观更新
      queryClient.setQueryData(["resources"], (old) => [...old, newResource]);

      return { previousResources };
    },

    // 错误回滚
    onError: (err, newResource, context) => {
      queryClient.setQueryData(["resources"], context.previousResources);
    },

    // 成功后刷新
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
  });

  return (
    <button
      onClick={() => mutation.mutate({ title: "New Resource" })}
      disabled={mutation.isPending}
    >
      {mutation.isPending ? "Creating..." : "Create"}
    </button>
  );
}
```

### 6. 无限查询 (Infinite Queries)

```tsx
import { useInfiniteQuery } from "@tanstack/react-query";

function InfiniteList() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["resources", "infinite"],
      queryFn: ({ pageParam }) => api.getResources({ page: pageParam }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    });

  return (
    <>
      {data?.pages.map((page) =>
        page.items.map((item) => <Item key={item.id} data={item} />),
      )}

      {hasNextPage && (
        <button onClick={() => fetchNextPage()}>
          {isFetchingNextPage ? "Loading..." : "Load More"}
        </button>
      )}
    </>
  );
}
```

## Zustand 核心原理

### 1. 基础 Store

```tsx
import { create } from "zustand";

interface UIStore {
  // 状态
  sidebarOpen: boolean;
  theme: "light" | "dark";

  // 操作
  toggleSidebar: () => void;
  setTheme: (theme: "light" | "dark") => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  theme: "light",

  toggleSidebar: () =>
    set((state) => ({
      sidebarOpen: !state.sidebarOpen,
    })),

  setTheme: (theme) => set({ theme }),
}));

// 使用
function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore();

  return (
    <aside className={sidebarOpen ? "w-64" : "w-0"}>
      <button onClick={toggleSidebar}>Toggle</button>
    </aside>
  );
}
```

### 2. 选择器 (Selectors)

避免不必要的重渲染：

```tsx
// ❌ 不好：组件会在任何状态变化时重渲染
const { sidebarOpen, theme } = useUIStore();

// ✅ 好：只在 sidebarOpen 变化时重渲染
const sidebarOpen = useUIStore((state) => state.sidebarOpen);

// ✅ 浅比较多个值
import { shallow } from "zustand/shallow";

const { sidebarOpen, theme } = useUIStore(
  (state) => ({ sidebarOpen: state.sidebarOpen, theme: state.theme }),
  shallow,
);
```

### 3. 持久化中间件

```tsx
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      language: "zh-CN",
      notifications: true,

      setLanguage: (language) => set({ language }),
      toggleNotifications: () =>
        set((state) => ({
          notifications: !state.notifications,
        })),
    }),
    {
      name: "settings-storage", // localStorage key
      partialize: (state) => ({
        language: state.language,
        // notifications 不持久化
      }),
    },
  ),
);
```

### 4. DevTools 中间件

```tsx
import { devtools } from "zustand/middleware";

export const useStore = create<Store>()(
  devtools(
    (set) => ({
      // ...
    }),
    { name: "MyStore" },
  ),
);
```

### 5. Toast 通知 Store (实际实现)

位置：`frontend/stores/toastStore.ts`

```tsx
import { create } from "zustand";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
  // 便捷方法
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = crypto.randomUUID();
    const newToast = { ...toast, id };

    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));

    // 自动移除
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  success: (title, message) => {
    useToastStore.getState().addToast({ type: "success", title, message });
  },

  error: (title, message) => {
    useToastStore.getState().addToast({ type: "error", title, message });
  },

  info: (title, message) => {
    useToastStore.getState().addToast({ type: "info", title, message });
  },

  warning: (title, message) => {
    useToastStore.getState().addToast({ type: "warning", title, message });
  },
}));

// 导出便捷方法
export const toast = {
  success: useToastStore.getState().success,
  error: useToastStore.getState().error,
  info: useToastStore.getState().info,
  warning: useToastStore.getState().warning,
};

// 使用示例
import { toast } from "@/stores/toastStore";

toast.success("操作成功", "您的更改已保存");
toast.error("操作失败", error.message);
```

### 6. 实际项目中的 Store 示例

**AI Teams Store**: `frontend/stores/aiTeamsStore.ts`

```tsx
interface AITeamsStore {
  // 状态
  currentTopic: Topic | null;
  missions: Mission[];
  selectedMissionId: string | null;

  // 操作
  setCurrentTopic: (topic: Topic | null) => void;
  addMission: (mission: Mission) => void;
  updateMission: (id: string, updates: Partial<Mission>) => void;
  selectMission: (id: string | null) => void;

  // WebSocket 连接状态
  isConnected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useAITeamsStore = create<AITeamsStore>((set) => ({
  currentTopic: null,
  missions: [],
  selectedMissionId: null,
  isConnected: false,

  setCurrentTopic: (topic) => set({ currentTopic: topic }),

  addMission: (mission) =>
    set((state) => ({
      missions: [...state.missions, mission],
    })),

  updateMission: (id, updates) =>
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    })),

  selectMission: (id) => set({ selectedMissionId: id }),

  setConnected: (connected) => set({ isConnected: connected }),
}));
```

**Settings Store**: `frontend/stores/settingsStore.ts`

```tsx
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsStore {
  // 偏好设置
  defaultModel: string;
  temperature: number;
  maxTokens: number;

  // 操作
  setDefaultModel: (model: string) => void;
  setTemperature: (temp: number) => void;
  setMaxTokens: (tokens: number) => void;
  resetToDefaults: () => void;
}

const defaultSettings = {
  defaultModel: "gpt-4o",
  temperature: 0.7,
  maxTokens: 4000,
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setDefaultModel: (model) => set({ defaultModel: model }),
      setTemperature: (temp) => set({ temperature: temp }),
      setMaxTokens: (tokens) => set({ maxTokens: tokens }),
      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: "genesis-settings", // localStorage key
    },
  ),
);
```

## Provider 配置

位置：`frontend/app/providers.tsx`

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { I18nProvider } from "@/lib/i18n";
import { ChunkErrorHandler } from "@/components/shared/ChunkErrorHandler";
import { ToastContainer } from "@/components/ui/Toast";
import { toast } from "@/stores/toastStore";
import { CheckinModal, InsufficientCreditsModal } from "@/components/credits";

/**
 * Create QueryClient with global error handling
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30 * 1000, // 30 seconds
        refetchOnWindowFocus: false,
      },
      mutations: {
        onError: (error: Error) => {
          // Show error toast for mutations
          const message = error.message || "An error occurred";
          toast.error("Operation Failed", message);
        },
      },
    },
  });
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ChunkErrorHandler />
        <AuthProvider>{children}</AuthProvider>
        <ToastContainer />
        <CheckinModal />
        <InsufficientCreditsModal />
      </I18nProvider>
    </QueryClientProvider>
  );
}
```

**关键特性：**

- **统一错误处理**: Mutation 失败自动显示 Toast
- **国际化支持**: I18nProvider 包裹应用
- **认证上下文**: AuthProvider 管理用户登录状态
- **全局组件**: Toast 通知、签到弹窗、积分不足提示
- **代码分割错误处理**: ChunkErrorHandler 处理懒加载失败

## 最佳实践

### 1. 何时使用 Query vs Store

| 场景                     | 推荐方案                   |
| ------------------------ | -------------------------- |
| API 数据                 | TanStack Query             |
| 用户信息                 | TanStack Query             |
| UI 状态 (模态框、侧边栏) | Zustand                    |
| 表单临时数据             | useState / React Hook Form |
| 全局通知                 | Zustand                    |
| 本地偏好设置             | Zustand + persist          |

### 2. 避免重复状态

```tsx
// ❌ 不好：在 Zustand 中复制 Query 数据
const useStore = create((set) => ({
  resources: [], // 与 Query 重复
  setResources: (resources) => set({ resources }),
}));

// ✅ 好：让 Query 管理服务端状态
function Component() {
  const { data: resources } = useQuery({...});
  const selectedId = useUIStore((s) => s.selectedId);

  const selectedResource = resources?.find((r) => r.id === selectedId);
}
```

### 3. 组合 Hooks

```tsx
// hooks/useResourceWithSelection.ts
export function useResourceWithSelection(id: string) {
  const { data: resource, isLoading } = useQuery({
    queryKey: ["resource", id],
    queryFn: () => api.getResource(id),
  });

  const isSelected = useUIStore((s) => s.selectedId === id);
  const select = useUIStore((s) => s.setSelectedId);

  return {
    resource,
    isLoading,
    isSelected,
    select: () => select(id),
  };
}
```

## 参考资源

- [TanStack Query 官方文档](https://tanstack.com/query/latest)
- [Zustand 官方文档](https://zustand-demo.pmnd.rs/)
- [React Query vs Redux](https://tanstack.com/query/latest/docs/react/comparison)
