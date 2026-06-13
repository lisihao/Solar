# Next.js 14 + React 18 核心原理

## 概述

GenesisPod 使用 Next.js 14 作为前端框架，结合 React 18 构建高性能的服务端渲染应用。

## Next.js 14 核心特性

### 1. App Router (应用路由器)

Next.js 14 使用基于文件系统的 App Router，提供更强大的路由能力。

```
frontend/app/
├── layout.tsx          # 根布局
├── page.tsx            # 首页
├── providers.tsx       # 全局 Provider
├── explore/
│   ├── page.tsx        # 探索页面
│   └── resource/
│       └── [id]/
│           └── page.tsx # 动态资源页
├── ai-simulation/
│   └── page.tsx        # AI 模拟页面
└── api/                # API 路由
```

**核心原理：**

- 每个文件夹代表一个路由段
- `page.tsx` 定义该路由的 UI
- `layout.tsx` 提供共享布局
- `[id]` 支持动态路由参数

### 2. 服务端组件 (Server Components)

Next.js 14 默认使用 React Server Components (RSC)。

```tsx
// 服务端组件 (默认)
async function ResourcePage({ params }: { params: { id: string } }) {
  // 可以直接在组件中进行数据获取
  const resource = await fetchResource(params.id);

  return (
    <div>
      <h1>{resource.title}</h1>
      <ClientInteractive resource={resource} />
    </div>
  );
}
```

**核心原理：**

- 组件在服务端渲染，减少客户端 JavaScript
- 可以直接访问后端资源
- 自动代码分割
- 零客户端 JavaScript 的组件

### 3. 客户端组件 (Client Components)

需要交互性的组件使用 `"use client"` 指令。

```tsx
"use client";

import { useState } from "react";

function InteractiveComponent() {
  const [count, setCount] = useState(0);

  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
```

**使用场景：**

- 需要 useState/useEffect
- 浏览器 API (localStorage, window)
- 事件监听器
- 第三方客户端库

### 4. 数据获取模式

#### 服务端数据获取

```tsx
// 在服务端组件中直接 fetch
async function Page() {
  const data = await fetch("https://api.example.com/data", {
    cache: "no-store", // 动态数据
    // cache: 'force-cache',  // 静态数据
    // next: { revalidate: 60 } // ISR
  });

  return <Component data={data} />;
}
```

#### 客户端数据获取 (TanStack Query)

```tsx
"use client";

function ClientComponent() {
  const { data, isLoading } = useQuery({
    queryKey: ["resources"],
    queryFn: () => api.getResources(),
  });

  if (isLoading) return <Skeleton />;
  return <ResourceList data={data} />;
}
```

## React 18 核心特性

### 1. Concurrent Rendering (并发渲染)

React 18 引入了并发渲染，允许 React 同时准备多个版本的 UI。

```tsx
import { useTransition, useDeferredValue } from "react";

function SearchResults({ query }) {
  const [isPending, startTransition] = useTransition();
  const [results, setResults] = useState([]);

  function handleSearch(input) {
    // 紧急更新：输入框
    setInput(input);

    // 非紧急更新：搜索结果
    startTransition(() => {
      setResults(searchResults(input));
    });
  }

  return (
    <>
      <SearchInput onChange={handleSearch} />
      {isPending ? <Spinner /> : <Results data={results} />}
    </>
  );
}
```

**核心原理：**

- `useTransition`: 标记非紧急状态更新
- `useDeferredValue`: 延迟更新低优先级值
- React 可以中断渲染以响应更重要的更新

### 2. Suspense for Data Fetching

```tsx
import { Suspense } from "react";

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AsyncComponent />
    </Suspense>
  );
}

// 配合 React Query 的 suspense 模式
function AsyncComponent() {
  const { data } = useSuspenseQuery({
    queryKey: ["data"],
    queryFn: fetchData,
  });

  return <DataDisplay data={data} />;
}
```

### 3. Automatic Batching (自动批处理)

React 18 自动批处理所有状态更新。

```tsx
function handleClick() {
  // React 18 之前：触发两次重渲染
  // React 18：自动批处理为一次重渲染
  setCount((c) => c + 1);
  setFlag((f) => !f);
}

// 即使在异步函数中也会批处理
async function handleAsyncClick() {
  await someAsyncOperation();
  setCount((c) => c + 1); // 这两个更新
  setFlag((f) => !f); // 会被批处理
}
```

## TypeScript 集成

### 严格类型配置

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### 组件类型定义

```tsx
// Props 类型
interface ResourceCardProps {
  resource: Resource;
  onSelect?: (id: string) => void;
  className?: string;
}

// 带泛型的组件
function List<T extends { id: string }>({
  items,
  renderItem,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}
```

## Tailwind CSS 集成

### 原子化 CSS 原理

```tsx
// 传统 CSS
// .button { padding: 8px 16px; background: blue; color: white; }

// Tailwind 原子化
<button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
  Click me
</button>
```

### 配置自定义主题

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#f0f9ff",
          500: "#3b82f6",
          900: "#1e3a8a",
        },
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
    },
  },
};
```

### 使用 clsx + tailwind-merge

```tsx
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// 工具函数
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 使用
<div
  className={cn(
    "base-styles",
    isActive && "active-styles",
    className, // 允许覆盖
  )}
/>;
```

## 性能优化

### 1. 图片优化

```tsx
import Image from "next/image";

<Image
  src="/hero.jpg"
  alt="Hero"
  width={1200}
  height={600}
  priority // LCP 图片
  placeholder="blur"
  blurDataURL={blurDataUrl}
/>;
```

### 2. 代码分割

```tsx
import dynamic from "next/dynamic";

// 动态导入重型组件
const HeavyChart = dynamic(() => import("@/components/HeavyChart"), {
  loading: () => <ChartSkeleton />,
  ssr: false, // 禁用服务端渲染
});
```

### 3. 路由预取

```tsx
import Link from 'next/link';

// 默认预取可见链接
<Link href="/dashboard">Dashboard</Link>

// 禁用预取
<Link href="/settings" prefetch={false}>Settings</Link>
```

## 项目结构最佳实践

```
frontend/
├── app/                    # App Router 页面
│   ├── (auth)/            # 路由组 (认证相关)
│   │   ├── login/
│   │   └── register/
│   └── (main)/            # 路由组 (主应用)
│       ├── dashboard/
│       └── settings/
├── components/
│   ├── ui/                # 基础 UI 组件
│   │   ├── button.tsx
│   │   └── input.tsx
│   ├── shared/            # 共享组件
│   └── features/          # 功能组件
├── lib/
│   ├── api.ts             # API 客户端
│   ├── utils.ts           # 工具函数
│   └── hooks/             # 自定义 Hooks
├── stores/                # Zustand 状态
└── types/                 # TypeScript 类型
```

## 参考资源

- [Next.js 14 官方文档](https://nextjs.org/docs)
- [React 18 新特性](https://react.dev/blog/2022/03/29/react-v18)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
