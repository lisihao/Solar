# Google Drive Integration Components

Google Drive 集成相关的 UI 组件和 Hooks。

## 组件

### GoogleDriveImportDialog

从 Google Drive 导入文件到 Library。

**Props:**

- `open: boolean` - 是否打开对话框
- `onClose: () => void` - 关闭回调
- `files: GoogleDriveFile[]` - 选中的文件列表
- `onImportSuccess?: () => void` - 导入成功回调

**功能:**

- 显示选中文件列表
- 配置导入选项（提取内容、生成摘要、添加到集合、应用标签）
- 实时显示导入进度
- 每个文件的状态跟踪

**使用示例:**

```tsx
import { GoogleDriveImportDialog } from '@/components/google-drive';

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);

  return (
    <GoogleDriveImportDialog
      open={isOpen}
      onClose={() => setIsOpen(false)}
      files={selectedFiles}
      onImportSuccess={() => {
        console.log('Import completed!');
        refetchResources();
      }}
    />
  );
}
```

---

### GoogleDriveExportDialog

导出 Library 资源到 Google Drive。

**Props:**

- `open: boolean` - 是否打开对话框
- `onClose: () => void` - 关闭回调
- `resources: Resource[]` - 选中的资源列表
- `onExportSuccess?: () => void` - 导出成功回调

**功能:**

- 选择导出格式（PDF、Markdown、HTML、Original）
- 选择目标文件夹（使用 GoogleDriveFolderPicker）
- 配置导出选项（包含 AI 摘要、笔记、元数据）
- 实时显示导出进度

**使用示例:**

```tsx
import { GoogleDriveExportDialog } from '@/components/google-drive';

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedResources, setSelectedResources] = useState([]);

  return (
    <GoogleDriveExportDialog
      open={isOpen}
      onClose={() => setIsOpen(false)}
      resources={selectedResources}
      onExportSuccess={() => {
        console.log('Export completed!');
      }}
    />
  );
}
```

---

### GoogleDriveFolderPicker

Google Drive 文件夹选择器。

**Props:**

- `selectedFolderId?: string` - 当前选中的文件夹 ID
- `onSelectFolder: (folderId: string | undefined, folderName: string) => void` - 选择回调
- `className?: string` - 自定义类名

**功能:**

- 面包屑导航
- 文件夹树结构浏览
- 选择目标文件夹
- 新建文件夹（TODO: 需要后端 API 支持）

**使用示例:**

```tsx
import { GoogleDriveFolderPicker } from '@/components/google-drive';

function MyComponent() {
  const [folderId, setFolderId] = useState<string>();
  const [folderName, setFolderName] = useState('My Drive');

  return (
    <GoogleDriveFolderPicker
      selectedFolderId={folderId}
      onSelectFolder={(id, name) => {
        setFolderId(id);
        setFolderName(name);
      }}
      className="max-h-96"
    />
  );
}
```

---

## Hooks

### useGoogleDriveImport

管理 Google Drive 文件导入。

**返回值:**

```ts
{
  importFromDrive: (files: GoogleDriveFile[], options: ImportOptions) => Promise<ImportResult>
  isImporting: boolean
  progress: ImportProgress[]
  totalProgress: number
  reset: () => void
}
```

**使用示例:**

```tsx
import { useGoogleDriveImport } from '@/hooks/features/useGoogleDriveImport';

function MyComponent() {
  const { importFromDrive, isImporting, progress, totalProgress } =
    useGoogleDriveImport();

  const handleImport = async () => {
    const result = await importFromDrive(selectedFiles, {
      extractContent: true,
      generateSummary: true,
      tags: ['research', 'important'],
    });

    console.log(`Imported ${result.imported} files`);
  };

  return (
    <div>
      {isImporting && <div>Progress: {totalProgress}%</div>}
      <button onClick={handleImport}>Import Files</button>
    </div>
  );
}
```

---

### useGoogleDriveExport

管理 Library 资源导出到 Google Drive。

**返回值:**

```ts
{
  exportToDrive: (resources: Resource[], options: ExportOptions) => Promise<ExportResult>
  isExporting: boolean
  progress: ExportProgress[]
  totalProgress: number
  reset: () => void
}
```

**使用示例:**

```tsx
import { useGoogleDriveExport } from '@/hooks/features/useGoogleDriveExport';

function MyComponent() {
  const { exportToDrive, isExporting, progress, totalProgress } =
    useGoogleDriveExport();

  const handleExport = async () => {
    const result = await exportToDrive(selectedResources, {
      format: 'pdf',
      folderId: 'target-folder-id',
      includeAISummary: true,
    });

    console.log(`Exported ${result.exported} resources`);
  };

  return (
    <div>
      {isExporting && <div>Progress: {totalProgress}%</div>}
      <button onClick={handleExport}>Export Resources</button>
    </div>
  );
}
```

---

### useGoogleDriveFiles

获取和管理 Google Drive 文件列表。

**参数:**

```ts
{
  folderId?: string
  pageSize?: number
  query?: string
  orderBy?: string
}
```

**返回值:**

```ts
{
  files: GoogleDriveFile[]
  isLoading: boolean
  error: Error | null
  currentFolderId?: string
  folderStack: Array<{ id: string; name: string }>
  breadcrumbs: Array<{ id: string; name: string }>
  hasMore: boolean
  enterFolder: (folder: GoogleDriveFile) => void
  goBack: () => void
  navigateToFolder: (index: number) => void
  loadMore: () => void
  refresh: () => void
}
```

**使用示例:**

```tsx
import { useGoogleDriveFiles } from '@/hooks/features/useGoogleDriveFiles';

function MyComponent() {
  const {
    files,
    isLoading,
    breadcrumbs,
    enterFolder,
    goBack,
    loadMore,
    hasMore,
  } = useGoogleDriveFiles({
    pageSize: 20,
    orderBy: 'modifiedTime desc',
  });

  return (
    <div>
      {/* 面包屑 */}
      <div>
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.id}>{crumb.name}</span>
        ))}
      </div>

      {/* 文件列表 */}
      <ul>
        {files.map((file) => (
          <li key={file.id} onClick={() => file.isFolder && enterFolder(file)}>
            {file.name}
          </li>
        ))}
      </ul>

      {/* 加载更多 */}
      {hasMore && <button onClick={loadMore}>Load More</button>}
    </div>
  );
}
```

---

## 类型定义

### GoogleDriveFile

```ts
interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  thumbnailLink?: string;
  isFolder?: boolean;
  parents?: string[];
}
```

### ImportOptions

```ts
interface ImportOptions {
  extractContent?: boolean;
  generateSummary?: boolean;
  collectionId?: string;
  tags?: string[];
}
```

### ExportOptions

```ts
interface ExportOptions {
  format?: 'original' | 'pdf' | 'markdown' | 'html' | 'docx' | 'txt';
  folderId?: string;
  createFolders?: boolean;
  fileNamePrefix?: string;
  includeAISummary?: boolean;
  includeNotes?: boolean;
  includeMetadata?: boolean;
}
```

### Resource

```ts
interface Resource {
  id: string;
  title: string;
  type?: string;
}
```

---

## API 端点

组件使用以下后端 API 端点：

- `GET /api/v1/google-drive/files` - 获取文件列表
- `GET /api/v1/google-drive/files/:id` - 获取单个文件
- `POST /api/v1/google-drive/import` - 导入文件
- `POST /api/v1/google-drive/export` - 导出资源

详细 API 文档请参考后端文档。

---

## 待实现功能

- [ ] GoogleDriveFolderPicker 的创建文件夹功能（需要后端 API 支持）
- [ ] 集合列表从 API 动态加载（ImportDialog）
- [ ] 更细粒度的错误处理和重试机制
- [ ] 批量操作的取消功能
- [ ] 导出时的文件预览

---

## 注意事项

1. 所有组件都需要用户已经连接 Google Drive
2. 导入和导出操作都是异步的，可能需要一些时间
3. 大文件导入/导出时建议显示进度条
4. 建议在操作完成后刷新相关数据列表
