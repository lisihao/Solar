# AI Social SWR 缓存集成

> **完成时间**: 2026-01-25
> **功能**: 为 AI Social 模块实现 SWR 缓存策略，优化数据获取性能

---

## 概述

为 AI Social 模块实现了基于 SWR (Stale-While-Revalidate) 的数据缓存策略，显著提升了数据加载性能和用户体验。

## 实现内容

### 1. 依赖安装

```bash
npm install swr
```

**版本**: `swr@latest`

### 2. 文件结构

```
frontend/
├── lib/swr/
│   └── social-config.ts          # SWR 全局配置和缓存键生成
├── hooks/swr/
│   ├── index.ts                  # 导出文件
│   ├── useSocialSWR.ts           # SWR hooks 实现
│   ├── useSocialSWR.test.ts      # 单元测试
│   └── README.md                 # 使用文档
└── components/ai-social/
    ├── ConnectionsTab.tsx        # 已集成 SWR
    └── ContentsTab.tsx           # 已集成 SWR
```

### 3. 核心功能

#### 3.1 SWR Hooks

**`useSocialConnectionsSWR`** - 平台连接列表

- 5分钟缓存
- 窗口聚焦时刷新
- 网络重连时刷新
- 自动去重

**`useSocialContentsSWR`** - 内容列表

- 1分钟缓存
- 支持状态过滤
- 自动重新验证
- 乐观更新支持

**`useSocialContentSWR`** - 单个内容详情

- 按需获取
- 禁用自动刷新（编辑场景）
- 手动刷新控制

**`useSocialPublishLogsSWR`** - 发布日志

- 30秒缓存
- 高频刷新（发布时）

#### 3.2 缓存策略

| 数据类型 | 刷新间隔 | 聚焦刷新 | 重连刷新 | 场景     |
| -------- | -------- | -------- | -------- | -------- |
| 连接列表 | 5分钟    | ✅       | ✅       | 不常变化 |
| 内容列表 | 1分钟    | ✅       | ✅       | 频繁更新 |
| 内容详情 | 手动     | ❌       | ✅       | 编辑中   |
| 发布日志 | 30秒     | ✅       | ✅       | 实时状态 |

#### 3.3 缓存键管理

```typescript
// 自动生成规范化的缓存键
"/api/ai-social/connections";
"/api/ai-social/connections/:id";
"/api/ai-social/connections/platform/:type";
"/api/ai-social/contents";
"/api/ai-social/contents?status=DRAFT";
"/api/ai-social/contents/:id";
"/api/ai-social/contents/:id/logs";
```

### 4. 组件集成

#### Before (Legacy)

```typescript
const { connections, loading, fetchConnections } = useSocialConnections();

useEffect(() => {
  fetchConnections();
}, [fetchConnections]);
```

#### After (SWR)

```typescript
const { connections, isLoading, isValidating, refresh } =
  useSocialConnectionsSWR();

// No useEffect needed - SWR handles initial fetch
```

### 5. 缓存状态指示

在 UI 中显示数据来源和状态：

```typescript
{!loading && isValidating && (
  <div className="text-blue-600">
    <Database className="animate-pulse" />
    <span>Refreshing...</span>
  </div>
)}

{!loading && !isValidating && data.length > 0 && (
  <div className="text-green-600" title="From cache">
    <Database />
    <span>Cached</span>
  </div>
)}
```

### 6. 乐观更新

支持即时 UI 更新：

```typescript
import { mutateConnections } from "@/hooks/swr/useSocialSWR";

const { mutate } = useSocialConnectionsSWR();

// 乐观更新
await mutateConnections(mutate, (current) =>
  current.map((conn) =>
    conn.id === id ? { ...conn, isActive: !conn.isActive } : conn,
  ),
);

// 然后同步服务器
await toggleConnection(id);
```

---

## 性能优化

### 1. 减少 API 调用

- **去重**: 2秒内相同请求自动合并
- **缓存**: 避免重复获取已有数据
- **条件获取**: 按需启用/禁用数据获取

### 2. 用户体验提升

- **即时响应**: 显示缓存数据，后台刷新
- **状态指示**: 清晰显示加载/刷新/缓存状态
- **自动刷新**: 窗口聚焦时自动更新数据

### 3. 网络优化

- **后台重新验证**: 不阻塞 UI
- **错误重试**: 自动重试失败请求（3次）
- **智能刷新**: 根据数据特性配置刷新策略

---

## 测试

### 运行测试

```bash
npm test -- useSocialSWR
```

### 测试覆盖

- ✅ 基本数据获取
- ✅ 错误处理
- ✅ 手动刷新
- ✅ 条件获取
- ✅ 状态过滤

**结果**: 3 tests passed

---

## 向后兼容

### Legacy Hooks 保留

原有的 `useSocialConnections` 和 `useSocialContents` hooks 保留用于：

- 数据变更操作 (create, update, delete)
- 需要控制请求时机的场景

### 混合使用模式

```typescript
// SWR 用于读取
const { connections, refresh } = useSocialConnectionsSWR();

// Legacy hook 用于变更
const { removeConnection } = useSocialConnections();

const handleDelete = async (id: string) => {
  await removeConnection(id);
  refresh(); // 刷新 SWR 缓存
};
```

---

## 配置

### 全局配置

在 `lib/swr/social-config.ts` 中配置：

```typescript
export const socialSWRConfig: SWRConfiguration = {
  errorRetryCount: 3,
  errorRetryInterval: 5000,
  dedupingInterval: 2000,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
};
```

### 自定义配置

```typescript
const { connections } = useSocialConnectionsSWR({
  refreshInterval: 10000, // 10秒刷新
  revalidateOnFocus: false, // 禁用聚焦刷新
});
```

---

## 监控和调试

### 开发环境日志

SWR 在开发环境自动记录：

- 数据获取成功
- 数据获取失败
- 慢速加载警告（>3秒）

### 生产环境

- 错误自动记录到控制台
- 可集成到错误追踪系统（如 Sentry）

---

## 后续优化

### 计划改进

1. **全局缓存管理**
   - 实现跨组件缓存共享
   - 添加缓存失效策略

2. **离线支持**
   - 集成 Service Worker
   - 本地存储持久化

3. **性能监控**
   - 添加缓存命中率统计
   - 监控数据刷新频率

4. **更多模块集成**
   - AI Research
   - AI Writing
   - Resource Library

---

## 相关文档

- [SWR 官方文档](https://swr.vercel.app/)
- [使用指南](../../frontend/hooks/swr/README.md)
- [API 文档](../../frontend/lib/api/ai-social/README.md)
- [Legacy Hooks](../../frontend/hooks/domain/useAISocial.ts)

---

## 变更日志

### 2026-01-25

- ✅ 安装 SWR 依赖
- ✅ 创建 SWR 配置文件
- ✅ 实现 SWR hooks
- ✅ 集成到 ConnectionsTab
- ✅ 集成到 ContentsTab
- ✅ 添加缓存状态指示
- ✅ 编写单元测试
- ✅ 类型检查通过
- ✅ 测试通过
- ✅ 文档完善

---

**维护者**: AI Development Team
**状态**: ✅ 完成并测试通过
