# Google Drive Integration PRD

> **Version**: 1.0
> **Author**: PM Agent
> **Created**: 2025-12-25
> **Status**: Draft

---

## Document Information

| Field          | Value                    |
| -------------- | ------------------------ |
| Module         | google-drive-integration |
| Type           | prd                      |
| Priority       | P1 (High)                |
| Target Release | v1.2.0                   |

---

## 1. Executive Summary

### 1.1 Background

GenesisPod 是一个企业级 AI 驱动的深度研究和内容管理平台。目前平台已集成 Notion 作为外部知识管理工具，用户可以在 Profile 页面连接 Notion 工作区，并在 Library 中访问同步的 Notion 页面。

然而，大量用户的文档和资料存储在 Google Drive 中。为了满足用户需求，提升平台的内容管理能力，需要集成 Google Drive，实现：

1. **连接管理**：用户可在 Profile 页面连接/断开 Google Drive
2. **资源浏览**：在 Library 中添加 Google Drive TAB，浏览和管理云端文件
3. **双向同步**：支持从 Google Drive 导入资源到平台，以及将平台资源导出到 Google Drive

### 1.2 Goals

| Goal         | Description                                 | Success Metric     |
| ------------ | ------------------------------------------- | ------------------ |
| **无缝连接** | 用户可以一键完成 Google Drive OAuth 授权    | OAuth 成功率 > 95% |
| **资源浏览** | 用户可以在 Library 中浏览 Google Drive 文件 | 加载时间 < 2s      |
| **导入资源** | 用户可以将 Google Drive 文件导入到 Library  | 导入成功率 > 98%   |
| **导出资源** | 用户可以将 Library 资源导出到 Google Drive  | 导出成功率 > 98%   |
| **统一体验** | 与现有 Notion 集成保持一致的 UI/UX          | 用户满意度 > 4.0/5 |

### 1.3 Non-Goals

- **实时协作编辑**：不支持在 Genesis 内直接编辑 Google Drive 文档（Phase 2）
- **文件预览**：复杂文件格式（如 .pptx, .xlsx）的完整预览（使用 Google 原生预览链接）
- **Google Workspace 全家桶**：本期仅支持 Google Drive，不包含 Gmail、Calendar 等
- **离线访问**：Google Drive 文件的离线缓存
- **版本历史**：Google Drive 文件版本管理功能

---

## 2. User Stories

### 2.1 Role Definition

| Role         | Description                                  |
| ------------ | -------------------------------------------- |
| **普通用户** | 使用平台进行研究和内容管理的终端用户         |
| **高级用户** | 有大量云端文档需要管理，频繁使用导入导出功能 |

### 2.2 User Story List

| ID     | Role     | Story                                                   | Priority | Acceptance Criteria                                |
| ------ | -------- | ------------------------------------------------------- | -------- | -------------------------------------------------- |
| US-001 | 普通用户 | 作为用户，我想在 Profile 页面连接我的 Google Drive 账号 | P0       | 点击连接按钮后跳转 Google 授权页面，完成后返回平台 |
| US-002 | 普通用户 | 作为用户，我想查看已连接的 Google Drive 账号信息        | P0       | 显示账号邮箱、存储空间、连接时间                   |
| US-003 | 普通用户 | 作为用户，我想断开 Google Drive 连接                    | P0       | 点击断开后确认，成功断开并清理本地数据             |
| US-004 | 普通用户 | 作为用户，我想在 Library 中浏览 Google Drive 文件       | P0       | 可以看到文件夹结构，支持分页加载                   |
| US-005 | 普通用户 | 作为用户，我想搜索 Google Drive 中的文件                | P1       | 支持按文件名、类型搜索                             |
| US-006 | 普通用户 | 作为用户，我想将 Google Drive 文件导入到 Library        | P0       | 选择文件后导入，显示导入进度                       |
| US-007 | 普通用户 | 作为用户，我想将 Library 资源导出到 Google Drive        | P0       | 选择资源后导出，可选目标文件夹                     |
| US-008 | 高级用户 | 作为高级用户，我想批量导入多个文件                      | P1       | 支持多选文件批量导入，显示整体进度                 |
| US-009 | 高级用户 | 作为高级用户，我想批量导出多个资源                      | P1       | 支持多选资源批量导出                               |
| US-010 | 普通用户 | 作为用户，我想在导入时自动生成 AI 摘要                  | P2       | 导入后自动触发 AI 分析（可配置）                   |

---

## 3. Functional Requirements

### 3.1 Feature Overview

```
+-------------------+     +-------------------+     +-------------------+
|   Profile Page    |     |   Library Page    |     |   Backend API     |
+-------------------+     +-------------------+     +-------------------+
|                   |     |                   |     |                   |
| Google Drive      |     | Google Drive TAB  |     | OAuth Service     |
| Connection Card   |<--->| - File Browser    |<--->| - Auth Flow       |
| - Connect/Disconnect    | - Import/Export   |     | - Token Management|
| - Account Info    |     | - Search          |     |                   |
|                   |     |                   |     | Drive Service     |
+-------------------+     +-------------------+     | - File Operations |
                                                    | - Sync Engine     |
                                                    +-------------------+
```

### 3.2 F-001: Google OAuth 2.0 Authentication

#### 3.2.1 Description

实现 Google OAuth 2.0 认证流程，获取用户 Google Drive 的访问权限。

#### 3.2.2 OAuth Flow

```
+--------+     +----------------+     +--------------+     +----------------+
| User   |     | Genesis        |     | Google OAuth |     | Genesis API    |
+--------+     +----------------+     +--------------+     +----------------+
    |                 |                      |                     |
    | Click Connect   |                      |                     |
    |---------------->|                      |                     |
    |                 | GET /google-drive/connect                  |
    |                 |--------------------------------------------->|
    |                 |                      |<--- Auth URL -------|
    |<--- Redirect ---|                      |                     |
    |                 |                      |                     |
    |---------------->| Open Google OAuth    |                     |
    |                 |--------------------->|                     |
    |                 |                      |                     |
    | Grant Access    |                      |                     |
    |---------------->|                      |                     |
    |<--- Redirect ---|------ with code ---->|                     |
    |                 |                      |                     |
    |                 | POST /google-drive/callback (code)         |
    |                 |--------------------------------------------->|
    |                 |                      |<-- Exchange Token ---|
    |                 |                      |--- Access Token ---->|
    |                 |<--- Connection Success -------------------- |
    |<--- Show Success|                      |                     |
```

#### 3.2.3 Required Scopes

| Scope                                              | Purpose                    |
| -------------------------------------------------- | -------------------------- |
| `https://www.googleapis.com/auth/drive.readonly`   | 读取文件列表和内容         |
| `https://www.googleapis.com/auth/drive.file`       | 创建和管理本应用创建的文件 |
| `https://www.googleapis.com/auth/userinfo.email`   | 获取用户邮箱信息           |
| `https://www.googleapis.com/auth/userinfo.profile` | 获取用户基本信息           |

#### 3.2.4 Acceptance Criteria

- [ ] 用户点击连接按钮后跳转到 Google 授权页面
- [ ] 授权成功后自动返回平台并显示连接成功
- [ ] 授权失败时显示明确的错误信息
- [ ] Access Token 自动刷新（使用 Refresh Token）
- [ ] Token 安全存储（加密存储在数据库）

---

### 3.3 F-002: Profile Page - Connection Management

#### 3.3.1 Description

在 Profile 页面的 Integrations Tab 中添加 Google Drive 连接管理卡片。

#### 3.3.2 UI Design

```
+------------------------------------------------------------------+
|  Google Drive Integration                                         |
+------------------------------------------------------------------+
|  [Google Drive Logo]                                              |
|                                                                   |
|  Google Drive                                                     |
|  Connect your Google Drive to import and export resources         |
|                                                                   |
|  +-------------------------------------------------------------+  |
|  |                                                             |  |
|  |  Status: Connected                                          |  |
|  |  Account: user@gmail.com                                    |  |
|  |  Storage: 5.2 GB used of 15 GB                              |  |
|  |  Connected: December 20, 2025                               |  |
|  |  Files Synced: 156 files                                    |  |
|  |                                                             |  |
|  |  [Disconnect]  [Open Library]                               |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
+------------------------------------------------------------------+
```

#### 3.3.3 Connection States

| State         | UI Display                       | Actions           |
| ------------- | -------------------------------- | ----------------- |
| Not Connected | 显示连接引导和 [Connect] 按钮    | Connect           |
| Connecting    | 显示加载状态                     | -                 |
| Connected     | 显示账号信息、存储空间、同步状态 | Disconnect, Sync  |
| Error         | 显示错误信息和 [Retry] 按钮      | Retry, Disconnect |
| Token Expired | 显示"需要重新授权"提示           | Reconnect         |

#### 3.3.4 Acceptance Criteria

- [ ] 未连接状态显示连接引导和按钮
- [ ] 连接成功后显示账号信息
- [ ] 断开连接需要二次确认
- [ ] 显示存储空间使用情况
- [ ] 提供快捷链接到 Library Google Drive TAB

---

### 3.4 F-003: Library - Google Drive TAB

#### 3.4.1 Description

在 Library 页面新增 Google Drive TAB，用户可以浏览和管理 Google Drive 文件。

#### 3.4.2 TAB Navigation

```
+------------------------------------------------------------------+
|  [Bookmarks]  [Notes]  [Images]  [Graph]  [Notion]  [Google Drive]|
+------------------------------------------------------------------+
```

#### 3.4.3 Google Drive TAB Layout

```
+------------------------------------------------------------------+
|  Google Drive                                         [Refresh]   |
+------------------------------------------------------------------+
|  Path: My Drive / Research / AI Papers                            |
|  [<- Back]  [New Folder]  [Upload]                                |
+------------------------------------------------------------------+
|  Search: [________________________] [Type v] [Sort v]             |
+------------------------------------------------------------------+
|                                                                   |
|  +-----+  +-----+  +-----+  +-----+  +-----+  +-----+             |
|  |     |  |     |  |     |  |     |  |     |  |     |             |
|  | [F] |  | [F] |  | [D] |  | [D] |  | [P] |  | [P] |             |
|  |     |  |     |  |     |  |     |  |     |  |     |             |
|  +-----+  +-----+  +-----+  +-----+  +-----+  +-----+             |
|  Projects ML Papers Paper1   Paper2  Slides  Report               |
|  Folder   Folder   .pdf     .pdf    .pptx   .docx                |
|                                                                   |
|  [Import Selected (3)]                                            |
+------------------------------------------------------------------+
|  Selected: 3 files | 2.5 MB total                                 |
+------------------------------------------------------------------+
```

#### 3.4.4 Supported File Types

| Category          | Extensions                         | Preview | Import |
| ----------------- | ---------------------------------- | ------- | ------ |
| **Documents**     | .pdf, .docx, .doc, .txt, .md, .rtf | Yes     | Yes    |
| **Spreadsheets**  | .xlsx, .xls, .csv                  | Link    | Yes    |
| **Presentations** | .pptx, .ppt                        | Link    | Yes    |
| **Images**        | .jpg, .jpeg, .png, .gif, .webp     | Yes     | Yes    |
| **Google Docs**   | Google Doc, Sheet, Slides          | Link    | Yes\*  |

\*Google Docs 导入时会自动转换为 PDF 或纯文本格式

#### 3.4.5 File List Display

| Column   | Description            |
| -------- | ---------------------- |
| Icon     | 文件类型图标           |
| Name     | 文件名（支持重命名）   |
| Type     | 文件类型               |
| Size     | 文件大小               |
| Modified | 最后修改时间           |
| Actions  | 预览、导入、删除等操作 |

#### 3.4.6 Acceptance Criteria

- [ ] 显示用户 Google Drive 根目录内容
- [ ] 支持文件夹导航（进入/返回）
- [ ] 显示面包屑路径
- [ ] 支持文件搜索（名称、类型）
- [ ] 支持多种排序方式（名称、修改时间、大小）
- [ ] 支持多选文件
- [ ] 分页加载（每页 50 个文件）
- [ ] 显示加载状态和错误状态

---

### 3.5 F-004: Import from Google Drive

#### 3.5.1 Description

用户可以将 Google Drive 中的文件导入到 Genesis Library 作为资源。

#### 3.5.2 Import Flow

```
+--------+     +----------------+     +----------------+     +----------------+
| User   |     | Frontend       |     | Backend API    |     | Google Drive   |
+--------+     +----------------+     +----------------+     +----------------+
    |                 |                      |                     |
    | Select Files    |                      |                     |
    |---------------->|                      |                     |
    | Click Import    |                      |                     |
    |---------------->|                      |                     |
    |                 | POST /google-drive/import                  |
    |                 |--------------------->|                     |
    |                 |                      | Fetch File Content  |
    |                 |                      |-------------------->|
    |                 |                      |<--- File Data ------|
    |                 |                      |                     |
    |                 |                      | Create Resource     |
    |                 |                      | (Extract Content,   |
    |                 |                      |  Generate Metadata) |
    |                 |                      |                     |
    |                 |<-- Import Progress --|                     |
    |<-- Show Progress|                      |                     |
    |                 |                      |                     |
    |                 |<-- Import Complete --|                     |
    |<-- Show Success |                      |                     |
```

#### 3.5.3 Import Options Dialog

```
+------------------------------------------------------------------+
|  Import to Library                                         [X]    |
+------------------------------------------------------------------+
|                                                                   |
|  Selected Files (3):                                              |
|  - AI_Research_Paper.pdf (2.5 MB)                                 |
|  - Meeting_Notes.docx (156 KB)                                    |
|  - Data_Analysis.xlsx (1.2 MB)                                    |
|                                                                   |
|  Import Options:                                                  |
|  +-------------------------------------------------------------+  |
|  | [x] Extract text content                                    |  |
|  | [x] Generate AI summary                                     |  |
|  | [ ] Add to collection: [Select Collection v]                |  |
|  | [ ] Apply tags: [_______________]                           |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  [Cancel]                              [Import 3 Files]           |
+------------------------------------------------------------------+
```

#### 3.5.4 Content Extraction

| File Type   | Extraction Method                 |
| ----------- | --------------------------------- |
| PDF         | PDF.js 或 Apache PDFBox 提取文本  |
| DOCX/DOC    | Mammoth.js 或 Apache POI 提取文本 |
| TXT/MD      | 直接读取                          |
| XLSX/CSV    | 提取为结构化数据（表格格式）      |
| Images      | OCR（可选）或仅保存元数据         |
| Google Docs | 使用 Google API 导出为 PDF/TXT    |

#### 3.5.5 Acceptance Criteria

- [ ] 可以单选或多选文件进行导入
- [ ] 显示导入进度（百分比）
- [ ] 导入完成后创建对应的 Resource 记录
- [ ] 自动提取文本内容（支持的格式）
- [ ] 可选生成 AI 摘要
- [ ] 可选添加到指定收藏集
- [ ] 导入失败时显示详细错误信息
- [ ] 支持取消正在进行的导入

---

### 3.6 F-005: Export to Google Drive

#### 3.6.1 Description

用户可以将 Library 中的资源导出到 Google Drive。

#### 3.6.2 Export Flow

```
+--------+     +----------------+     +----------------+     +----------------+
| User   |     | Frontend       |     | Backend API    |     | Google Drive   |
+--------+     +----------------+     +----------------+     +----------------+
    |                 |                      |                     |
    | Select Resources|                      |                     |
    |---------------->|                      |                     |
    | Click Export    |                      |                     |
    |---------------->|                      |                     |
    |                 | Show Folder Picker   |                     |
    |<----------------|                      |                     |
    | Select Folder   |                      |                     |
    |---------------->|                      |                     |
    |                 | POST /google-drive/export                  |
    |                 |--------------------->|                     |
    |                 |                      | Get Resource Data   |
    |                 |                      | Generate Export     |
    |                 |                      |                     |
    |                 |                      | Upload to Drive     |
    |                 |                      |-------------------->|
    |                 |                      |<--- Upload Success--|
    |                 |<-- Export Complete --|                     |
    |<-- Show Success |                      |                     |
```

#### 3.6.3 Export Options Dialog

```
+------------------------------------------------------------------+
|  Export to Google Drive                                    [X]    |
+------------------------------------------------------------------+
|                                                                   |
|  Selected Resources (2):                                          |
|  - Deep Learning Survey (Paper)                                   |
|  - AI Trends 2025 (Blog)                                          |
|                                                                   |
|  Export Format:                                                   |
|  +-------------------------------------------------------------+  |
|  | ( ) PDF - Best for sharing and printing                     |  |
|  | (x) Markdown - Best for further editing                     |  |
|  | ( ) HTML - Best for web viewing                             |  |
|  | ( ) Original Format - Keep original file format             |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  Destination Folder:                                              |
|  +-------------------------------------------------------------+  |
|  | My Drive / Genesis Exports / [Select Folder]               |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  Export Options:                                                  |
|  +-------------------------------------------------------------+  |
|  | [x] Include AI summary                                      |  |
|  | [x] Include my notes                                        |  |
|  | [ ] Include metadata                                        |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  [Cancel]                              [Export 2 Resources]       |
+------------------------------------------------------------------+
```

#### 3.6.4 Export Formats

| Source Type   | Available Export Formats           |
| ------------- | ---------------------------------- |
| Paper/Article | PDF, Markdown, HTML, TXT           |
| YouTube Video | Markdown (transcript + notes), PDF |
| Report        | PDF, Markdown, HTML, DOCX          |
| Note          | Markdown, TXT, PDF                 |
| Image         | Original format                    |

#### 3.6.5 Acceptance Criteria

- [ ] 可以单选或多选资源进行导出
- [ ] 提供多种导出格式选项
- [ ] 可以选择目标文件夹
- [ ] 显示导出进度
- [ ] 导出成功后提供 Google Drive 链接
- [ ] 可选包含 AI 摘要和用户笔记
- [ ] 导出失败时显示详细错误信息

---

### 3.7 F-006: Sync Status and History

#### 3.7.1 Description

显示 Google Drive 同步状态和历史记录。

#### 3.7.2 Sync Status Indicators

| Status       | Icon           | Color  | Description         |
| ------------ | -------------- | ------ | ------------------- |
| Synced       | Check Circle   | Green  | 所有文件已同步      |
| Syncing      | Refresh Spin   | Blue   | 正在同步中          |
| Pending      | Clock          | Yellow | 有待同步的更改      |
| Error        | Alert Triangle | Red    | 同步失败            |
| Disconnected | Cloud Off      | Gray   | 未连接 Google Drive |

#### 3.7.3 Acceptance Criteria

- [ ] 在 Library Google Drive TAB 显示同步状态
- [ ] 可以手动触发同步
- [ ] 记录导入/导出历史
- [ ] 显示最后同步时间

---

## 4. Technical Design

### 4.1 System Architecture

```
+------------------------------------------------------------------+
|                         Frontend (Next.js)                        |
+------------------------------------------------------------------+
|  Profile Page         |  Library Page                             |
|  +-----------------+  |  +--------------------------------------+ |
|  | GoogleDrive     |  |  | GoogleDriveTab                       | |
|  | ConnectionCard  |  |  | +----------------------------------+ | |
|  +-----------------+  |  | | GoogleDriveFileBrowser           | | |
|                       |  | +----------------------------------+ | |
|                       |  | | ImportDialog | ExportDialog      | | |
|                       |  | +----------------------------------+ | |
|                       |  +--------------------------------------+ |
+------------------------------------------------------------------+
                              |
                              | REST API
                              v
+------------------------------------------------------------------+
|                      Backend (NestJS)                             |
+------------------------------------------------------------------+
|  GoogleDriveModule                                                |
|  +--------------------------------------------------------------+ |
|  | GoogleDriveController                                        | |
|  | - GET  /google-drive/connect     (Get OAuth URL)             | |
|  | - GET  /google-drive/callback    (OAuth Callback)            | |
|  | - DELETE /google-drive/disconnect                            | |
|  | - GET  /google-drive/connection  (Get Connection Info)       | |
|  | - GET  /google-drive/files       (List Files)                | |
|  | - GET  /google-drive/files/:id   (Get File)                  | |
|  | - POST /google-drive/import      (Import Files)              | |
|  | - POST /google-drive/export      (Export Resources)          | |
|  +--------------------------------------------------------------+ |
|  | GoogleDriveAuthService           | GoogleDriveFileService    | |
|  | - OAuth2 Flow                    | - List Files              | |
|  | - Token Management               | - Download File           | |
|  | - Refresh Token                  | - Upload File             | |
|  +--------------------------------------------------------------+ |
|  | GoogleDriveSyncService           | GoogleDriveImportService  | |
|  | - Sync Status                    | - Import to Resource      | |
|  | - Sync History                   | - Content Extraction      | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|                      Database (PostgreSQL)                        |
+------------------------------------------------------------------+
|  GoogleDriveConnection  |  GoogleDriveSyncHistory                 |
|  - userId               |  - connectionId                         |
|  - accessToken          |  - action (import/export)               |
|  - refreshToken         |  - fileId                               |
|  - email                |  - resourceId                           |
|  - storageQuota         |  - status                               |
|  - status               |  - error                                |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|                      Google Drive API                             |
+------------------------------------------------------------------+
|  - OAuth 2.0                                                      |
|  - Drive API v3                                                   |
|    - files.list                                                   |
|    - files.get                                                    |
|    - files.create                                                 |
|    - files.export                                                 |
+------------------------------------------------------------------+
```

### 4.2 Frontend Component Design

#### 4.2.1 Component Structure

```
frontend/
  components/
    google-drive/
      GoogleDriveConnectionCard.tsx   # Profile 页面连接卡片
      GoogleDriveTabContent.tsx       # Library TAB 主组件
      GoogleDriveFileBrowser.tsx      # 文件浏览器
      GoogleDriveFileCard.tsx         # 文件卡片
      GoogleDriveFileList.tsx         # 文件列表视图
      GoogleDriveFolderPicker.tsx     # 文件夹选择器
      GoogleDriveImportDialog.tsx     # 导入对话框
      GoogleDriveExportDialog.tsx     # 导出对话框
      GoogleDriveSyncStatus.tsx       # 同步状态组件

  lib/
    api/
      google-drive.ts                 # API 调用封装

  hooks/
    domain/
      useGoogleDrive.ts               # Google Drive 状态和操作
      useGoogleDriveFiles.ts          # 文件列表和导航
      useGoogleDriveImport.ts         # 导入逻辑
      useGoogleDriveExport.ts         # 导出逻辑
```

#### 4.2.2 State Management

```typescript
// stores/googleDriveStore.ts
interface GoogleDriveStore {
  // Connection State
  connection: GoogleDriveConnection | null;
  isConnecting: boolean;
  connectionError: string | null;

  // File Browser State
  currentFolderId: string | null;
  folderPath: FolderPathItem[];
  files: GoogleDriveFile[];
  isLoadingFiles: boolean;
  filesError: string | null;

  // Selection State
  selectedFileIds: string[];

  // Import/Export State
  importProgress: ImportProgress | null;
  exportProgress: ExportProgress | null;

  // Actions
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  navigateToFolder: (folderId: string) => void;
  navigateBack: () => void;
  selectFile: (fileId: string) => void;
  deselectFile: (fileId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  importSelected: (options: ImportOptions) => Promise<void>;
  exportResources: (
    resourceIds: string[],
    options: ExportOptions,
  ) => Promise<void>;
}
```

### 4.3 Backend API Design

#### 4.3.1 Module Structure

```
backend/
  src/
    modules/
      integrations/
        google-drive/
          google-drive.module.ts
          google-drive.controller.ts
          services/
            google-drive-auth.service.ts
            google-drive-file.service.ts
            google-drive-import.service.ts
            google-drive-export.service.ts
            google-drive-sync.service.ts
          dto/
            google-drive.dto.ts
```

#### 4.3.2 API Endpoints

| Endpoint                                 | Method | Description             | Auth Required |
| ---------------------------------------- | ------ | ----------------------- | ------------- |
| `/api/v1/google-drive/connect`           | GET    | 获取 OAuth 授权 URL     | Yes           |
| `/api/v1/google-drive/callback`          | GET    | OAuth 回调处理          | No\*          |
| `/api/v1/google-drive/disconnect`        | DELETE | 断开连接                | Yes           |
| `/api/v1/google-drive/connection`        | GET    | 获取连接信息            | Yes           |
| `/api/v1/google-drive/files`             | GET    | 获取文件列表            | Yes           |
| `/api/v1/google-drive/files/:id`         | GET    | 获取单个文件信息        | Yes           |
| `/api/v1/google-drive/files/:id/content` | GET    | 获取文件内容            | Yes           |
| `/api/v1/google-drive/import`            | POST   | 导入文件到 Library      | Yes           |
| `/api/v1/google-drive/export`            | POST   | 导出资源到 Google Drive | Yes           |
| `/api/v1/google-drive/sync/status`       | GET    | 获取同步状态            | Yes           |
| `/api/v1/google-drive/sync/history`      | GET    | 获取同步历史            | Yes           |

\*OAuth 回调通过 state 参数验证用户

#### 4.3.3 Request/Response DTOs

```typescript
// Connect Response
interface GetConnectUrlResponse {
  url: string;
}

// Connection Info Response
interface GoogleDriveConnectionResponse {
  id: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  storageQuota: {
    limit: number;
    usage: number;
    usageInDrive: number;
  };
  status: "ACTIVE" | "ERROR" | "EXPIRED";
  lastSyncAt?: string;
  connectedAt: string;
}

// File List Request
interface ListFilesDto {
  folderId?: string; // null = root
  pageToken?: string;
  pageSize?: number; // default: 50
  query?: string; // search query
  mimeTypes?: string[]; // filter by type
  orderBy?: "name" | "modifiedTime" | "size";
  orderDirection?: "asc" | "desc";
}

// File List Response
interface ListFilesResponse {
  files: GoogleDriveFileDto[];
  nextPageToken?: string;
  folderPath: FolderPathItem[];
}

interface GoogleDriveFileDto {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime: string;
  createdTime: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink: string;
  webContentLink?: string;
  parents?: string[];
  isFolder: boolean;
}

// Import Request
interface ImportFilesDto {
  fileIds: string[];
  options: {
    extractContent: boolean;
    generateAISummary: boolean;
    collectionId?: string;
    tags?: string[];
  };
}

// Import Response
interface ImportFilesResponse {
  imported: {
    fileId: string;
    resourceId: string;
    status: "success" | "failed";
    error?: string;
  }[];
  totalSuccess: number;
  totalFailed: number;
}

// Export Request
interface ExportResourcesDto {
  resourceIds: string[];
  folderId: string; // target folder
  format: "pdf" | "markdown" | "html" | "txt" | "original";
  options: {
    includeAISummary: boolean;
    includeNotes: boolean;
    includeMetadata: boolean;
  };
}

// Export Response
interface ExportResourcesResponse {
  exported: {
    resourceId: string;
    fileId: string;
    fileName: string;
    webViewLink: string;
    status: "success" | "failed";
    error?: string;
  }[];
  totalSuccess: number;
  totalFailed: number;
}
```

### 4.4 Database Schema

#### 4.4.1 New Tables

```prisma
// Add to schema.prisma

// Google Drive 连接
model GoogleDriveConnection {
  id            String   @id @default(uuid())
  userId        String   @unique @map("user_id")

  // OAuth Tokens (encrypted)
  accessToken   String   @map("access_token") @db.Text
  refreshToken  String   @map("refresh_token") @db.Text
  tokenExpiry   DateTime @map("token_expiry")

  // Google Account Info
  googleId      String   @unique @map("google_id")
  email         String
  displayName   String?  @map("display_name")
  photoUrl      String?  @map("photo_url") @db.Text

  // Storage Info
  storageLimit  BigInt?  @map("storage_limit")
  storageUsage  BigInt?  @map("storage_usage")

  // Status
  status        GoogleDriveConnectionStatus @default(ACTIVE)
  lastError     String?  @map("last_error") @db.Text

  // Timestamps
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  lastSyncAt    DateTime? @map("last_sync_at")

  // Relations
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  syncHistory   GoogleDriveSyncHistory[]
  importedFiles GoogleDriveImportedFile[]

  @@map("google_drive_connections")
}

enum GoogleDriveConnectionStatus {
  ACTIVE
  ERROR
  EXPIRED
  REVOKED
}

// Google Drive 同步历史
model GoogleDriveSyncHistory {
  id            String   @id @default(uuid())
  connectionId  String   @map("connection_id")

  action        GoogleDriveSyncAction
  status        GoogleDriveSyncStatus @default(PENDING)

  // For imports
  googleFileId  String?  @map("google_file_id")
  googleFileName String? @map("google_file_name")
  resourceId    String?  @map("resource_id")

  // For exports
  exportFormat  String?  @map("export_format")
  targetFolderId String? @map("target_folder_id")

  // Result
  error         String?  @db.Text
  metadata      Json?

  // Timestamps
  startedAt     DateTime @default(now()) @map("started_at")
  completedAt   DateTime? @map("completed_at")

  // Relations
  connection    GoogleDriveConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@index([connectionId])
  @@index([action])
  @@index([startedAt(sort: Desc)])
  @@map("google_drive_sync_history")
}

enum GoogleDriveSyncAction {
  IMPORT
  EXPORT
  SYNC
}

enum GoogleDriveSyncStatus {
  PENDING
  IN_PROGRESS
  SUCCESS
  FAILED
}

// Google Drive 导入文件映射
model GoogleDriveImportedFile {
  id            String   @id @default(uuid())
  connectionId  String   @map("connection_id")

  googleFileId  String   @map("google_file_id")
  googleFileName String  @map("google_file_name")
  mimeType      String   @map("mime_type")

  resourceId    String   @unique @map("resource_id")

  // Sync tracking
  googleModifiedTime DateTime @map("google_modified_time")
  lastSyncedAt  DateTime @default(now()) @map("last_synced_at")

  // Relations
  connection    GoogleDriveConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, googleFileId])
  @@index([connectionId])
  @@index([resourceId])
  @@map("google_drive_imported_files")
}

// Update User model to add relation
model User {
  // ... existing fields ...

  // Google Drive Integration
  googleDriveConnection GoogleDriveConnection?
}
```

### 4.5 External Dependencies

#### 4.5.1 NPM Packages

```json
{
  "dependencies": {
    // Backend
    "googleapis": "^131.0.0",
    "@google-cloud/local-auth": "^3.0.0",

    // Content Extraction
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.6.0",

    // Frontend
    "@react-oauth/google": "^0.12.1"
  }
}
```

#### 4.5.2 Environment Variables

```env
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/api/v1/google-drive/callback

# Optional
GOOGLE_DRIVE_API_KEY=your-api-key
```

---

## 5. Security Considerations

### 5.1 OAuth Security

| Concern           | Mitigation                             |
| ----------------- | -------------------------------------- |
| Token Exposure    | Access Token 和 Refresh Token 加密存储 |
| CSRF Attack       | 使用 state 参数验证 OAuth 回调         |
| Token Theft       | 仅请求必要的 scope                     |
| Session Hijacking | Refresh Token 仅存储在后端             |

### 5.2 Data Security

| Concern         | Mitigation                              |
| --------------- | --------------------------------------- |
| Sensitive Files | 用户明确选择导入的文件，不自动扫描      |
| Data Retention  | 断开连接时清理所有本地缓存的文件数据    |
| Access Control  | 每个用户只能访问自己连接的 Google Drive |

### 5.3 API Security

| Concern          | Mitigation                              |
| ---------------- | --------------------------------------- |
| Rate Limiting    | 实现 API 调用限流，遵循 Google API 配额 |
| Error Handling   | 不在错误信息中暴露敏感数据              |
| Input Validation | 严格验证所有输入参数                    |

---

## 6. Error Handling

### 6.1 Error Categories

| Category          | Examples                              | User Message                              |
| ----------------- | ------------------------------------- | ----------------------------------------- |
| **Auth Errors**   | Token expired, Access denied          | "Please reconnect your Google Drive"      |
| **API Errors**    | Rate limit, Server error              | "Google Drive is temporarily unavailable" |
| **File Errors**   | File not found, Permission denied     | "Cannot access this file"                 |
| **Import Errors** | Unsupported format, Extraction failed | "Failed to import: [filename]"            |
| **Export Errors** | Upload failed, Folder not found       | "Failed to export to Google Drive"        |

### 6.2 Error Recovery

| Error Type            | Recovery Action                   |
| --------------------- | --------------------------------- |
| Token Expired         | 自动使用 Refresh Token 刷新       |
| Refresh Token Invalid | 提示用户重新连接                  |
| Rate Limited          | 指数退避重试（最多 3 次）         |
| Network Error         | 显示离线提示，允许重试            |
| Partial Failure       | 显示成功/失败列表，允许重试失败项 |

---

## 7. Task Breakdown

### Phase 1: Foundation (3 days)

| ID    | Task                                | Type     | Est. | Priority | Dependencies |
| ----- | ----------------------------------- | -------- | ---- | -------- | ------------ |
| T-001 | 设计和创建数据库 Schema             | Backend  | 0.5d | P0       | -            |
| T-002 | 实现 Google OAuth 2.0 服务          | Backend  | 1d   | P0       | T-001        |
| T-003 | 实现 OAuth 回调和 Token 管理        | Backend  | 0.5d | P0       | T-002        |
| T-004 | 创建 GoogleDriveConnectionCard 组件 | Frontend | 1d   | P0       | T-003        |

### Phase 2: File Browser (3 days)

| ID    | Task                             | Type     | Est. | Priority | Dependencies |
| ----- | -------------------------------- | -------- | ---- | -------- | ------------ |
| T-005 | 实现 Google Drive File Service   | Backend  | 1d   | P0       | T-003        |
| T-006 | 创建 GoogleDriveFileBrowser 组件 | Frontend | 1d   | P0       | T-005        |
| T-007 | 实现文件夹导航和面包屑           | Frontend | 0.5d | P0       | T-006        |
| T-008 | 实现文件搜索和过滤               | Frontend | 0.5d | P1       | T-006        |

### Phase 3: Import Feature (3 days)

| ID    | Task                             | Type     | Est. | Priority | Dependencies |
| ----- | -------------------------------- | -------- | ---- | -------- | ------------ |
| T-009 | 实现 Google Drive Import Service | Backend  | 1.5d | P0       | T-005        |
| T-010 | 实现内容提取（PDF, DOCX）        | Backend  | 1d   | P0       | T-009        |
| T-011 | 创建 ImportDialog 组件           | Frontend | 0.5d | P0       | T-009        |

### Phase 4: Export Feature (2 days)

| ID    | Task                              | Type     | Est. | Priority | Dependencies |
| ----- | --------------------------------- | -------- | ---- | -------- | ------------ |
| T-012 | 实现 Google Drive Export Service  | Backend  | 1d   | P0       | T-005        |
| T-013 | 创建 ExportDialog 和 FolderPicker | Frontend | 1d   | P0       | T-012        |

### Phase 5: Polish (2 days)

| ID    | Task                   | Type     | Est. | Priority | Dependencies |
| ----- | ---------------------- | -------- | ---- | -------- | ------------ |
| T-014 | 实现同步状态和历史记录 | Full     | 0.5d | P1       | T-011, T-013 |
| T-015 | 错误处理和重试逻辑     | Full     | 0.5d | P0       | T-014        |
| T-016 | UI 优化和响应式设计    | Frontend | 0.5d | P1       | T-015        |
| T-017 | 集成测试和文档         | QA       | 0.5d | P0       | T-016        |

---

## 8. Milestones

| Milestone                 | Target Date | Deliverables                    |
| ------------------------- | ----------- | ------------------------------- |
| M1: OAuth Complete        | Day 3       | 用户可以连接/断开 Google Drive  |
| M2: File Browser Complete | Day 6       | 用户可以浏览 Google Drive 文件  |
| M3: Import Complete       | Day 9       | 用户可以导入文件到 Library      |
| M4: Export Complete       | Day 11      | 用户可以导出资源到 Google Drive |
| M5: Production Ready      | Day 13      | 完成测试，准备发布              |

---

## 9. Testing Requirements

### 9.1 Unit Tests

| Test Area      | Coverage Target |
| -------------- | --------------- |
| OAuth Service  | > 90%           |
| File Service   | > 85%           |
| Import Service | > 85%           |
| Export Service | > 85%           |

### 9.2 Integration Tests

| Test Case | Description      |
| --------- | ---------------- |
| IT-001    | 完整 OAuth 流程  |
| IT-002    | 文件列表分页加载 |
| IT-003    | 导入 PDF 文件    |
| IT-004    | 导入 DOCX 文件   |
| IT-005    | 导出资源为 PDF   |
| IT-006    | 批量导入多个文件 |
| IT-007    | Token 自动刷新   |

### 9.3 E2E Tests

| Test Case | Description              |
| --------- | ------------------------ |
| E2E-001   | 从连接到导入完整流程     |
| E2E-002   | 从选择资源到导出完整流程 |
| E2E-003   | 断开连接后重新连接       |

---

## 10. Risks and Mitigations

| Risk                | Impact | Probability | Mitigation                 |
| ------------------- | ------ | ----------- | -------------------------- |
| Google API 配额限制 | High   | Medium      | 实现缓存和限流             |
| 大文件处理超时      | Medium | Medium      | 异步处理 + 进度回调        |
| Token 刷新失败      | High   | Low         | 明确提示用户重新授权       |
| 内容提取失败        | Medium | Medium      | 优雅降级，保存原始文件引用 |
| Google API 变更     | Medium | Low         | 使用官方 SDK，关注更新日志 |

---

## 11. Future Enhancements (Phase 2)

| Feature                | Description                          |
| ---------------------- | ------------------------------------ |
| Google Docs 在线编辑   | 在 Genesis 内嵌入 Google Docs 编辑器 |
| 自动同步               | 定时自动同步选定文件夹               |
| 双向同步               | 检测本地和云端变更，自动合并         |
| Google Sheets 数据分析 | 直接分析 Google Sheets 数据          |
| Google Slides 预览     | 在 Genesis 内预览 Google Slides      |

---

## 12. References

### 12.1 Google API Documentation

- [Google Drive API v3](https://developers.google.com/drive/api/v3/reference)
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [Google Picker API](https://developers.google.com/picker/docs)

### 12.2 Related Internal Documents

- Notion Integration PRD: `docs/prd/notes-notion-integration.md`
- Library Page Implementation: `frontend/app/library/page.tsx`
- Profile Page Implementation: `frontend/app/profile/page.tsx`

### 12.3 Related Code Files

- `backend/src/modules/integrations/notion/` - Notion 集成参考实现
- `frontend/components/notion/` - Notion 前端组件参考
- `frontend/lib/api/notion.ts` - Notion API 封装参考

---

## Change Log

| Version | Date       | Changes     | Author   |
| ------- | ---------- | ----------- | -------- |
| 1.0     | 2025-12-25 | Initial PRD | PM Agent |
