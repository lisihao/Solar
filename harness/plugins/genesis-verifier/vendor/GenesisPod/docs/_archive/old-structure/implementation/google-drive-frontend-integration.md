# Google Drive 前端集成文档

> 本文档描述 Google Drive 前端集成的 API 封装和 React Hooks

---

## 📁 文件结构

```
frontend/
├── lib/api/
│   └── google-drive.ts          # API 客户端
└── hooks/domain/
    ├── useGoogleDrive.ts         # 连接管理 Hook
    ├── useGoogleDriveFiles.ts    # 文件浏览 Hook
    ├── useGoogleDriveImport.ts   # 文件导入 Hook
    ├── useGoogleDriveExport.ts   # 资源导出 Hook
    ├── index.ts                  # 统一导出
    └── google-drive-hooks-examples.md  # 使用示例
```

---

## 🔧 API 客户端

### 文件：`frontend/lib/api/google-drive.ts`

提供完整的 Google Drive API 封装，包括：

#### 连接管理

- `getConnectUrl()` - 获取 OAuth 授权 URL
- `connectGoogleDrive(code, redirectUri)` - 完成 OAuth 连接
- `disconnectGoogleDrive(connectionId)` - 断开连接
- `getConnections()` - 获取所有连接
- `getConnection(connectionId)` - 获取单个连接详情
- `updateConnection(connectionId, syncConfig)` - 更新连接配置

#### 文件操作

- `listFiles(params)` - 获取文件列表（支持搜索、排序、分页）
- `getFile(fileId)` - 获取文件详情
- `refreshFile(fileId)` - 刷新文件（从 Drive 重新同步）
- `linkToResource(fileId, resourceId)` - 链接文件到资源
- `unlinkFromResource(fileId)` - 取消链接

#### 导入导出

- `importFiles(params)` - 导入文件到资源库
- `getImportProgress(importId)` - 获取导入进度
- `exportResources(params)` - 导出资源到 Google Drive
- `getExportProgress(exportId)` - 获取导出进度

#### 同步

- `triggerSync(connectionId, fullSync)` - 触发同步
- `getSyncStatus(connectionId)` - 获取同步状态
- `getSyncHistory(connectionId, limit)` - 获取同步历史

#### TypeScript 类型定义

完整的类型定义，包括：

- `GoogleDriveConnection` - 连接信息
- `GoogleDriveFile` - 文件信息
- `ImportProgress` / `ExportProgress` - 进度信息
- `SyncStatus` / `SyncHistory` - 同步状态
- 等等...

---

## 🎣 React Hooks

### 1. useGoogleDrive - 连接管理

管理 Google Drive 连接和同步。

**功能：**

- OAuth 连接流程
- 连接状态监控
- 断开连接
- 触发同步
- 自动刷新（可选）

**返回值：**

```typescript
{
  // 连接状态
  connections: GoogleDriveConnection[]
  connection: GoogleDriveConnection | null
  isConnected: boolean
  isConnecting: boolean

  // 加载状态
  loading: boolean
  error: ApiError | null

  // 同步状态
  syncStatus: SyncStatus | null
  isSyncing: boolean

  // 操作方法
  connect: () => Promise<void>
  disconnect: (connectionId: string) => Promise<void>
  refresh: () => Promise<void>
  triggerSync: (connectionId?: string, fullSync?: boolean) => Promise<void>

  // 辅助方法
  getConnectionById: (id: string) => GoogleDriveConnection | undefined
}
```

**使用示例：**

```typescript
const { isConnected, connect, connection } = useGoogleDrive();

if (!isConnected) {
  return <button onClick={connect}>Connect</button>;
}

return <div>Connected as {connection.email}</div>;
```

---

### 2. useGoogleDriveFiles - 文件浏览

浏览 Google Drive 文件和文件夹。

**功能：**

- 文件/文件夹列表
- 导航和面包屑
- 搜索和排序
- 分页加载

**返回值：**

```typescript
{
  // 数据
  files: GoogleDriveFile[]
  folders: GoogleDriveFile[]
  allItems: GoogleDriveFile[]

  // 导航
  currentFolderId: string | null
  folderPath: FolderPathItem[]
  canGoBack: boolean

  // 分页
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean

  // 搜索和排序
  searchQuery: string
  sortBy: 'name' | 'modifiedTime' | 'createdTime' | 'size'
  sortOrder: 'asc' | 'desc'

  // 加载状态
  loading: boolean
  error: ApiError | null

  // 操作方法
  navigateToFolder: (folderId: string | null) => void
  navigateBack: () => void
  navigateToPath: (pathIndex: number) => void
  setSearch: (query: string) => void
  setSorting: (sortBy: string, sortOrder?: 'asc' | 'desc') => void
  setPage: (page: number) => void
  loadMore: () => void
  refresh: () => Promise<void>

  // 辅助方法
  getFileById: (id: string) => GoogleDriveFile | undefined
  isFolder: (file: GoogleDriveFile) => boolean
}
```

**使用示例：**

```typescript
const {
  files,
  folders,
  navigateToFolder,
  folderPath,
  setSearch,
} = useGoogleDriveFiles({ connectionId });

// 显示文件夹
{folders.map(folder => (
  <div onClick={() => navigateToFolder(folder.driveFileId)}>
    {folder.name}
  </div>
))}
```

---

### 3. useGoogleDriveImport - 文件导入

将 Google Drive 文件导入到资源库。

**功能：**

- 文件选择管理
- 批量导入
- 进度追踪
- 错误处理

**返回值：**

```typescript
{
  // 选择状态
  selectedFiles: string[]
  selectedCount: number
  isSelected: (fileId: string) => boolean

  // 导入状态
  importing: boolean
  importId: string | null
  progress: ImportProgress | null
  progressPercent: number

  // 错误
  error: ApiError | null

  // 操作方法
  selectFile: (fileId: string) => void
  deselectFile: (fileId: string) => void
  toggleFile: (fileId: string) => void
  selectAll: (fileIds: string[]) => void
  clearSelection: () => void
  importFiles: (options?: Partial<ImportFilesParams['options']>) => Promise<void>
  cancelImport: () => void
  reset: () => void

  // 辅助方法
  canImport: boolean
  isComplete: boolean
  hasFailed: boolean
}
```

**使用示例：**

```typescript
const {
  selectedFiles,
  toggleFile,
  importFiles,
  progress,
  progressPercent,
} = useGoogleDriveImport({
  connectionId,
  onComplete: () => alert('Done!'),
});

// 选择文件
<input
  type="checkbox"
  checked={isSelected(file.id)}
  onChange={() => toggleFile(file.id)}
/>

// 导入
<button onClick={() => importFiles()}>
  Import {selectedFiles.length} files
</button>

// 进度
{progress && (
  <progress value={progressPercent} max={100} />
)}
```

---

### 4. useGoogleDriveExport - 资源导出

将资源库内容导出到 Google Drive。

**功能：**

- 资源导出
- 格式转换（original/pdf/docx/markdown）
- 进度追踪
- 错误处理

**返回值：**

```typescript
{
  // 导出状态
  exporting: boolean
  exportId: string | null
  progress: ExportProgress | null
  progressPercent: number

  // 错误
  error: ApiError | null

  // 操作方法
  exportResources: (
    resourceIds: string[],
    targetFolderId: string,
    format?: 'original' | 'pdf' | 'docx' | 'markdown',
    options?: Partial<ExportParams['options']>
  ) => Promise<void>
  cancelExport: () => void
  reset: () => void

  // 辅助方法
  isComplete: boolean
  hasFailed: boolean
  canExport: boolean
}
```

**使用示例：**

```typescript
const {
  exportResources,
  exporting,
  progress,
} = useGoogleDriveExport({
  connectionId,
  defaultFormat: 'pdf',
});

// 导出
<button onClick={() => exportResources(
  ['resource-1', 'resource-2'],
  'target-folder-id',
  'pdf'
)}>
  Export as PDF
</button>

// 进度
{progress && (
  <div>
    {progress.processedResources} / {progress.totalResources}
  </div>
)}
```

---

## 🎨 设计模式

### 1. 统一的 API 模式

所有 hooks 遵循项目现有模式：

- 使用 `useApiGet` / `useApiPost` 等核心 hooks
- 统一的错误处理（`ApiError`）
- 统一的加载状态管理
- LRU 缓存支持

### 2. 状态管理

- 使用 React 本地状态 (`useState`)
- 派生状态使用 `useMemo`
- 操作方法使用 `useCallback`
- 副作用使用 `useEffect`

### 3. 轮询机制

导入和导出 hooks 自动轮询进度：

- 每 2 秒检查一次
- 完成或失败时自动停止
- 可手动取消

### 4. TypeScript 优先

- 完整的类型定义
- 无 `any` 类型
- 良好的 IDE 智能提示

---

## 📊 数据流

```
┌─────────────────┐
│  React 组件     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Domain Hooks   │  (useGoogleDrive, useGoogleDriveFiles, etc.)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Core Hooks     │  (useApiGet, useApiPost, etc.)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  API Client     │  (lib/api/google-drive.ts)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend API    │  (/api/google-drive/*)
└─────────────────┘
```

---

## 🔍 缓存策略

### 连接信息

- 缓存键：`google-drive-connections`
- TTL：1 分钟
- 手动刷新：`refresh()`

### 同步状态

- 缓存键：`google-drive-sync-status` 或 `google-drive-sync-status-{connectionId}`
- TTL：30 秒
- 自动刷新：可配置

### 文件列表

- 无缓存（参数变化频繁）
- 依赖变化时自动重新获取

---

## ⚡ 性能优化

### 1. 按需加载

```typescript
// 只在需要时加载
const { files } = useGoogleDriveFiles({
  connectionId,
  immediate: false, // 不立即加载
});
```

### 2. 分页加载

```typescript
// 支持分页，避免一次加载太多数据
const { files, loadMore } = useGoogleDriveFiles({
  pageSize: 50,
});
```

### 3. 缓存利用

```typescript
// 自动使用缓存，减少 API 请求
const { connections } = useGoogleDrive({
  immediate: true,
  // 使用 1 分钟缓存
});
```

### 4. 请求去重

```typescript
// useApiGet 内部使用 AbortController
// 自动取消重复请求
```

---

## 🐛 错误处理

所有 hooks 返回统一的 `error` 对象（`ApiError` 类型）：

```typescript
interface ApiError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}
```

**使用示例：**

```typescript
const { error } = useGoogleDrive();

if (error) {
  return (
    <ErrorDisplay
      title="Failed to load Google Drive"
      message={error.message}
      code={error.code}
    />
  );
}
```

---

## 📝 使用建议

### 1. 连接检查

始终先检查连接状态：

```typescript
const { isConnected, connect } = useGoogleDrive();

if (!isConnected) {
  return <ConnectButton onClick={connect} />;
}
```

### 2. 加载状态

提供良好的加载反馈：

```typescript
const { loading, files } = useGoogleDriveFiles({ connectionId });

if (loading) return <Spinner />;
```

### 3. 进度显示

导入/导出时显示进度：

```typescript
const { progress, progressPercent } = useGoogleDriveImport({ connectionId });

{progress && (
  <ProgressBar value={progressPercent} />
)}
```

### 4. 错误恢复

提供错误恢复机制：

```typescript
const { error, refresh } = useGoogleDrive();

if (error) {
  return (
    <div>
      <p>Error: {error.message}</p>
      <button onClick={refresh}>Retry</button>
    </div>
  );
}
```

---

## 🧪 测试

### 单元测试

建议为每个 hook 编写测试：

```typescript
import { renderHook, waitFor } from "@testing-library/react";
import { useGoogleDrive } from "./useGoogleDrive";

test("should connect to Google Drive", async () => {
  const { result } = renderHook(() => useGoogleDrive());

  await waitFor(() => {
    expect(result.current.isConnected).toBe(true);
  });
});
```

### 集成测试

测试完整的工作流：

```typescript
test("should import files from Google Drive", async () => {
  const { result: drive } = renderHook(() => useGoogleDrive());
  const { result: files } = renderHook(() =>
    useGoogleDriveFiles({
      connectionId: drive.current.connection?.id,
    }),
  );
  const { result: importer } = renderHook(() =>
    useGoogleDriveImport({
      connectionId: drive.current.connection?.id,
    }),
  );

  // 选择文件
  act(() => {
    importer.current.selectFile("file-1");
  });

  // 导入
  await act(async () => {
    await importer.current.importFiles();
  });

  // 验证
  await waitFor(() => {
    expect(importer.current.isComplete).toBe(true);
  });
});
```

---

## 📚 参考资料

- [使用示例](./frontend/hooks/domain/google-drive-hooks-examples.md)
- [Google Drive API 文档](../backend/src/modules/integrations/google-drive/README.md)
- [项目代码规范](../.claude/CLAUDE.md)

---

## 📅 更新日志

### v1.0.0 (2024-12-25)

- 初始版本
- 实现 4 个核心 hooks
- 完整的 TypeScript 类型定义
- API 客户端封装
- 使用文档和示例

---

**维护者：** Claude Code
**最后更新：** 2024-12-25
