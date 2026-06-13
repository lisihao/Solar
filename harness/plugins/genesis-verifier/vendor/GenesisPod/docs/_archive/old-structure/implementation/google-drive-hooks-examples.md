# Google Drive Hooks 使用示例

## 概述

Google Drive 集成提供了 4 个主要 hooks：

1. **useGoogleDrive** - 连接管理和同步
2. **useGoogleDriveFiles** - 文件浏览和导航
3. **useGoogleDriveImport** - 文件导入到资源库
4. **useGoogleDriveExport** - 资源导出到 Google Drive

---

## 1. useGoogleDrive - 连接管理

### 基础使用

```typescript
import { useGoogleDrive } from '@/hooks/domain';

function GoogleDriveConnection() {
  const {
    connections,
    connection,
    isConnected,
    loading,
    connect,
    disconnect,
    triggerSync,
    syncStatus,
    isSyncing,
  } = useGoogleDrive();

  if (loading) return <div>Loading...</div>;

  if (!isConnected) {
    return (
      <button onClick={connect}>
        Connect to Google Drive
      </button>
    );
  }

  return (
    <div>
      <p>Connected as: {connection?.email}</p>
      <p>Files: {connection?.filesCount}</p>
      <button onClick={() => disconnect(connection!.id)}>
        Disconnect
      </button>
      <button onClick={() => triggerSync(connection!.id)}>
        {isSyncing ? 'Syncing...' : 'Sync Now'}
      </button>
    </div>
  );
}
```

### 多连接管理

```typescript
function MultipleConnections() {
  const { connections, disconnect, triggerSync } = useGoogleDrive();

  return (
    <div>
      {connections.map(conn => (
        <div key={conn.id}>
          <h3>{conn.email}</h3>
          <p>Files: {conn.filesCount}</p>
          <button onClick={() => triggerSync(conn.id)}>Sync</button>
          <button onClick={() => disconnect(conn.id)}>Remove</button>
        </div>
      ))}
    </div>
  );
}
```

### 自动刷新

```typescript
function AutoRefreshConnection() {
  const {
    connection,
    syncStatus,
  } = useGoogleDrive({
    immediate: true,
    refreshInterval: 10000, // 每 10 秒刷新
  });

  return (
    <div>
      <p>Last sync: {syncStatus?.lastSyncAt}</p>
      <p>Status: {syncStatus?.status}</p>
    </div>
  );
}
```

---

## 2. useGoogleDriveFiles - 文件浏览

### 基础文件列表

```typescript
import { useGoogleDriveFiles } from '@/hooks/domain';

function FileExplorer({ connectionId }: { connectionId: string }) {
  const {
    files,
    folders,
    loading,
    navigateToFolder,
    folderPath,
    navigateBack,
    canGoBack,
  } = useGoogleDriveFiles({
    connectionId,
    pageSize: 20,
  });

  if (loading) return <div>Loading files...</div>;

  return (
    <div>
      {/* 面包屑导航 */}
      <nav>
        <button onClick={navigateBack} disabled={!canGoBack}>
          Back
        </button>
        {folderPath.map((folder, index) => (
          <span key={folder.id}>
            / <a onClick={() => navigateToPath(index)}>{folder.name}</a>
          </span>
        ))}
      </nav>

      {/* 文件夹列表 */}
      <div>
        <h3>Folders</h3>
        {folders.map(folder => (
          <div key={folder.id} onClick={() => navigateToFolder(folder.driveFileId)}>
            📁 {folder.name}
          </div>
        ))}
      </div>

      {/* 文件列表 */}
      <div>
        <h3>Files</h3>
        {files.map(file => (
          <div key={file.id}>
            📄 {file.name} ({file.size} bytes)
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 搜索和排序

```typescript
function SearchableFileList({ connectionId }: { connectionId: string }) {
  const {
    files,
    loading,
    searchQuery,
    setSearch,
    sortBy,
    sortOrder,
    setSorting,
  } = useGoogleDriveFiles({
    connectionId,
    defaultSortBy: 'modifiedTime',
    defaultSortOrder: 'desc',
  });

  return (
    <div>
      {/* 搜索 */}
      <input
        type="text"
        placeholder="Search files..."
        value={searchQuery}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* 排序 */}
      <select onChange={(e) => setSorting(e.target.value)}>
        <option value="name">Name</option>
        <option value="modifiedTime">Modified</option>
        <option value="size">Size</option>
      </select>

      {/* 文件列表 */}
      {loading ? (
        <div>Searching...</div>
      ) : (
        <div>
          {files.map(file => (
            <div key={file.id}>{file.name}</div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 分页加载

```typescript
function PaginatedFileList({ connectionId }: { connectionId: string }) {
  const {
    files,
    page,
    totalPages,
    hasMore,
    loading,
    setPage,
    loadMore,
  } = useGoogleDriveFiles({
    connectionId,
    pageSize: 50,
  });

  return (
    <div>
      <div>
        {files.map(file => (
          <div key={file.id}>{file.name}</div>
        ))}
      </div>

      {/* 分页 */}
      <div>
        <button onClick={() => setPage(page - 1)} disabled={page === 1}>
          Previous
        </button>
        <span>Page {page} of {totalPages}</span>
        <button onClick={() => setPage(page + 1)} disabled={!hasMore}>
          Next
        </button>
      </div>

      {/* 或使用无限滚动 */}
      {hasMore && (
        <button onClick={loadMore} disabled={loading}>
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
```

---

## 3. useGoogleDriveImport - 导入文件

### 基础导入

```typescript
import { useGoogleDriveImport } from '@/hooks/domain';

function FileImporter({ connectionId }: { connectionId: string }) {
  const {
    selectedFiles,
    isSelected,
    toggleFile,
    clearSelection,
    importFiles,
    importing,
    progress,
    progressPercent,
    canImport,
  } = useGoogleDriveImport({
    connectionId,
    onComplete: (progress) => {
      console.log('Import completed!', progress.resourceIds);
      alert(`Successfully imported ${progress.successCount} files`);
    },
    onError: (error) => {
      alert(`Import failed: ${error.message}`);
    },
  });

  return (
    <div>
      {/* 文件选择器 */}
      <FileSelector
        onSelect={toggleFile}
        isSelected={isSelected}
      />

      {/* 选择信息 */}
      <div>
        Selected: {selectedFiles.length} files
        <button onClick={clearSelection}>Clear</button>
      </div>

      {/* 导入按钮 */}
      <button
        onClick={() => importFiles()}
        disabled={!canImport}
      >
        {importing ? 'Importing...' : 'Import to Library'}
      </button>

      {/* 进度显示 */}
      {progress && (
        <div>
          <progress value={progressPercent} max={100} />
          <p>
            {progress.processedFiles} / {progress.totalFiles} files
          </p>
          {progress.errors.length > 0 && (
            <div>
              <h4>Errors:</h4>
              {progress.errors.map((err, i) => (
                <p key={i}>{err.fileName}: {err.error}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### 批量导入

```typescript
function BatchImporter({ connectionId }: { connectionId: string }) {
  const [fileIds, setFileIds] = useState<string[]>([]);
  const {
    selectAll,
    importFiles,
    importing,
    progress,
  } = useGoogleDriveImport({
    connectionId,
  });

  const handleImportAll = async () => {
    // 选择所有文件
    selectAll(fileIds);

    // 执行导入，自定义选项
    await importFiles({
      includeMetadata: true,
      generateSummary: true,
      extractText: true,
    });
  };

  return (
    <button onClick={handleImportAll} disabled={importing}>
      Import All ({fileIds.length} files)
    </button>
  );
}
```

---

## 4. useGoogleDriveExport - 导出资源

### 基础导出

```typescript
import { useGoogleDriveExport } from '@/hooks/domain';

function ResourceExporter({ connectionId }: { connectionId: string }) {
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [targetFolderId, setTargetFolderId] = useState('');

  const {
    exportResources,
    exporting,
    progress,
    progressPercent,
    canExport,
  } = useGoogleDriveExport({
    connectionId,
    defaultFormat: 'pdf',
    onComplete: (progress) => {
      alert(`Exported ${progress.successCount} resources`);
    },
  });

  const handleExport = async () => {
    await exportResources(
      resourceIds,
      targetFolderId,
      'pdf',
      {
        includeMetadata: true,
        createFolder: true,
        folderName: 'DeepDive Export',
      }
    );
  };

  return (
    <div>
      <button onClick={handleExport} disabled={!canExport || exporting}>
        {exporting ? 'Exporting...' : 'Export to Google Drive'}
      </button>

      {progress && (
        <div>
          <progress value={progressPercent} max={100} />
          <p>
            {progress.processedResources} / {progress.totalResources}
          </p>
        </div>
      )}
    </div>
  );
}
```

### 多格式导出

```typescript
function MultiFormatExporter({ connectionId }: { connectionId: string }) {
  const { exportResources, exporting } = useGoogleDriveExport({
    connectionId,
  });

  const handleExport = async (format: 'original' | 'pdf' | 'docx' | 'markdown') => {
    await exportResources(
      ['resource-1', 'resource-2'],
      'target-folder-id',
      format
    );
  };

  return (
    <div>
      <button onClick={() => handleExport('original')}>Export Original</button>
      <button onClick={() => handleExport('pdf')}>Export as PDF</button>
      <button onClick={() => handleExport('docx')}>Export as DOCX</button>
      <button onClick={() => handleExport('markdown')}>Export as Markdown</button>
    </div>
  );
}
```

---

## 完整示例：Google Drive 文件管理器

```typescript
import {
  useGoogleDrive,
  useGoogleDriveFiles,
  useGoogleDriveImport,
} from '@/hooks/domain';

function GoogleDriveManager() {
  // 连接管理
  const {
    connection,
    isConnected,
    connect,
    disconnect,
  } = useGoogleDrive();

  // 文件浏览
  const {
    files,
    folders,
    navigateToFolder,
    folderPath,
    navigateBack,
    setSearch,
  } = useGoogleDriveFiles({
    connectionId: connection?.id,
    immediate: isConnected,
  });

  // 文件导入
  const {
    selectedFiles,
    toggleFile,
    importFiles,
    importing,
    progress,
  } = useGoogleDriveImport({
    connectionId: connection?.id || '',
    onComplete: () => {
      alert('Import completed!');
    },
  });

  // 未连接状态
  if (!isConnected) {
    return (
      <div>
        <h2>Connect to Google Drive</h2>
        <button onClick={connect}>Connect</button>
      </div>
    );
  }

  // 已连接状态
  return (
    <div>
      {/* 头部 */}
      <header>
        <h2>Google Drive - {connection.email}</h2>
        <button onClick={() => disconnect(connection.id)}>
          Disconnect
        </button>
      </header>

      {/* 搜索 */}
      <input
        type="text"
        placeholder="Search files..."
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* 面包屑 */}
      <nav>
        <button onClick={navigateBack}>⬅ Back</button>
        {folderPath.map(folder => (
          <span key={folder.id}> / {folder.name}</span>
        ))}
      </nav>

      {/* 文件夹 */}
      <section>
        <h3>Folders</h3>
        {folders.map(folder => (
          <div
            key={folder.id}
            onClick={() => navigateToFolder(folder.driveFileId)}
          >
            📁 {folder.name}
          </div>
        ))}
      </section>

      {/* 文件 */}
      <section>
        <h3>Files</h3>
        {files.map(file => (
          <div key={file.id}>
            <input
              type="checkbox"
              checked={selectedFiles.includes(file.id)}
              onChange={() => toggleFile(file.id)}
            />
            📄 {file.name}
          </div>
        ))}
      </section>

      {/* 导入 */}
      {selectedFiles.length > 0 && (
        <footer>
          <button onClick={() => importFiles()} disabled={importing}>
            Import {selectedFiles.length} files
          </button>
          {progress && (
            <div>
              Importing: {progress.processedFiles} / {progress.totalFiles}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}
```

---

## 注意事项

### 错误处理

所有 hooks 都返回 `error` 状态，应该正确处理：

```typescript
const { error, loading } = useGoogleDrive();

if (error) {
  return <ErrorDisplay error={error} />;
}
```

### 轮询和性能

导入和导出 hooks 会自动轮询进度（每 2 秒），完成后自动停止。

### 缓存

`useGoogleDrive` 和 `useGoogleDriveFiles` 使用了 API 缓存，默认：

- 连接信息：1 分钟
- 同步状态：30 秒

可以手动调用 `refresh()` 刷新数据。

### TypeScript 支持

所有 hooks 都提供完整的 TypeScript 类型定义，IDE 会提供智能提示。
