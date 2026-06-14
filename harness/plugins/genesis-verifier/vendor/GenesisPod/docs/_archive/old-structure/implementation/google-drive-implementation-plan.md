# Google Drive Integration - Implementation Plan

> **Version**: 1.0
> **Created**: 2025-12-25
> **Author**: PM Agent
> **PRD Reference**: docs/prd/google-drive-integration-v1.0.md
> **Status**: Ready for Development

---

## 1. Executive Summary

本文档基于 Google Drive Integration PRD，提供完整的实现计划，包括任务拆分、文件清单、技术规划和验收标准。

### 1.1 Implementation Timeline

| Phase                   | Duration | Milestone                                |
| ----------------------- | -------- | ---------------------------------------- |
| Phase 1: Foundation     | 3 days   | OAuth 完成，用户可连接/断开 Google Drive |
| Phase 2: File Browser   | 3 days   | 文件浏览器完成，可浏览 Google Drive 文件 |
| Phase 3: Import Feature | 3 days   | 导入功能完成，可导入文件到 Library       |
| Phase 4: Export Feature | 2 days   | 导出功能完成，可导出资源到 Google Drive  |
| Phase 5: Polish         | 2 days   | 测试、优化和文档                         |

**Total Estimated Duration**: 13 days

---

## 2. Current State Analysis

### 2.1 Existing Notion Integration Reference

分析现有 Notion 集成实现，作为 Google Drive 集成的参考模式：

**Backend Structure** (`backend/src/modules/integrations/notion/`):

- `notion.module.ts` - 模块定义
- `notion.controller.ts` - API 控制器，包含 OAuth、连接管理、同步、页面管理等端点
- `services/notion-auth.service.ts` - OAuth 认证和 Token 管理
- `services/notion-sync.service.ts` - 同步逻辑
- `services/notion-page.service.ts` - 页面操作
- `dto/notion.dto.ts` - 请求/响应 DTO

**Frontend Structure**:

- `frontend/lib/api/notion.ts` - API 客户端封装
- `frontend/components/notion/NotionTabContent.tsx` - Library TAB 组件
- Profile 页面 Integrations Tab 已有 Notion 连接卡片模式

**Database Schema** (Prisma):

- `NotionConnection` - 连接信息和 OAuth Token
- `NotionPage` - 同步的页面
- `NotionDatabase` - 同步的数据库
- `NotionSyncHistory` - 同步历史
- `NotionBlockVersion` - 版本历史

### 2.2 Current Profile Page Structure

Profile 页面 (`frontend/app/profile/page.tsx`) 已有：

- 四个 Tab: profile, settings, stats, integrations
- Integrations Tab 中已有 Notion 集成卡片
- Google Drive 显示为 "Coming Soon" 状态
- 完整的连接/断开 UI 模式可复用

### 2.3 Current Library Page Structure

Library 页面 (`frontend/app/library/page.tsx`) 已有：

- TAB 导航: bookmarks, notes, images, graph, notion
- 动态导入 NotionTabContent 组件
- URL 参数支持 `?tab=xxx`
- 多选模式和批量操作

---

## 3. Database Schema Design

### 3.1 New Tables

```prisma
// Add to schema.prisma

// ============ Google Drive 集成 ============

enum GoogleDriveConnectionStatus {
  ACTIVE
  ERROR
  EXPIRED
  REVOKED
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
```

### 3.2 User Model Update

```prisma
model User {
  // ... existing fields ...

  // Google Drive Integration (add this relation)
  googleDriveConnection GoogleDriveConnection?
}
```

---

## 4. Environment Variables

### 4.1 Required Variables

```env
# Google OAuth 2.0
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/api/v1/google-drive/callback

# Optional: API Key for public file access
GOOGLE_DRIVE_API_KEY=your-api-key
```

### 4.2 Setup Instructions

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google Drive API
4. Create OAuth 2.0 credentials (Web application type)
5. Add authorized redirect URI: `http://localhost:8080/api/v1/google-drive/callback`
6. For production: Add `https://your-domain.com/api/v1/google-drive/callback`

---

## 5. File Structure

### 5.1 Backend Files

```
backend/src/modules/integrations/google-drive/
├── google-drive.module.ts                    # NestJS Module
├── google-drive.controller.ts                # API Controller
├── services/
│   ├── google-drive-auth.service.ts          # OAuth and Token management
│   ├── google-drive-file.service.ts          # File listing and operations
│   ├── google-drive-import.service.ts        # Import to Library
│   ├── google-drive-export.service.ts        # Export from Library
│   └── google-drive-sync.service.ts          # Sync status and history
└── dto/
    ├── google-drive.dto.ts                   # Main DTOs
    ├── google-drive-file.dto.ts              # File-related DTOs
    ├── google-drive-import.dto.ts            # Import DTOs
    └── google-drive-export.dto.ts            # Export DTOs
```

### 5.2 Frontend Files

```
frontend/
├── lib/api/
│   └── google-drive.ts                       # API client
├── components/google-drive/
│   ├── GoogleDriveConnectionCard.tsx         # Profile page card
│   ├── GoogleDriveTabContent.tsx             # Library TAB main component
│   ├── GoogleDriveFileBrowser.tsx            # File browser
│   ├── GoogleDriveFileCard.tsx               # File card (grid view)
│   ├── GoogleDriveFileList.tsx               # File list (table view)
│   ├── GoogleDriveBreadcrumb.tsx             # Breadcrumb navigation
│   ├── GoogleDriveFolderPicker.tsx           # Folder picker dialog
│   ├── GoogleDriveImportDialog.tsx           # Import dialog
│   ├── GoogleDriveExportDialog.tsx           # Export dialog
│   ├── GoogleDriveSyncStatus.tsx             # Sync status indicator
│   └── GoogleDriveSearchFilter.tsx           # Search and filter controls
├── hooks/domain/
│   ├── useGoogleDrive.ts                     # Connection management
│   ├── useGoogleDriveFiles.ts                # File browser state
│   ├── useGoogleDriveImport.ts               # Import operations
│   └── useGoogleDriveExport.ts               # Export operations
└── stores/
    └── googleDriveStore.ts                   # Zustand store (optional)
```

---

## 6. API Endpoints Design

### 6.1 Authentication Endpoints

| Method | Endpoint                          | Description                  |
| ------ | --------------------------------- | ---------------------------- |
| GET    | `/api/v1/google-drive/connect`    | Get OAuth authorization URL  |
| GET    | `/api/v1/google-drive/callback`   | OAuth callback handler       |
| DELETE | `/api/v1/google-drive/disconnect` | Disconnect Google Drive      |
| GET    | `/api/v1/google-drive/connection` | Get connection info          |
| GET    | `/api/v1/google-drive/config`     | Check if OAuth is configured |

### 6.2 File Endpoints

| Method | Endpoint                                 | Description          |
| ------ | ---------------------------------------- | -------------------- |
| GET    | `/api/v1/google-drive/files`             | List files in folder |
| GET    | `/api/v1/google-drive/files/:id`         | Get file metadata    |
| GET    | `/api/v1/google-drive/files/:id/content` | Get file content     |
| GET    | `/api/v1/google-drive/search`            | Search files         |

### 6.3 Import/Export Endpoints

| Method | Endpoint                            | Description               |
| ------ | ----------------------------------- | ------------------------- |
| POST   | `/api/v1/google-drive/import`       | Import files to Library   |
| POST   | `/api/v1/google-drive/export`       | Export resources to Drive |
| GET    | `/api/v1/google-drive/sync/status`  | Get sync status           |
| GET    | `/api/v1/google-drive/sync/history` | Get sync history          |

---

## 7. Task Breakdown

### Phase 1: Foundation (3 days)

#### T-001: Database Schema Design and Migration

- **Type**: Backend
- **Duration**: 0.5 day
- **Priority**: P0
- **Dependencies**: None

**Tasks**:

1. Add GoogleDriveConnection model to schema.prisma
2. Add GoogleDriveSyncHistory model
3. Add GoogleDriveImportedFile model
4. Add enums: GoogleDriveConnectionStatus, GoogleDriveSyncAction, GoogleDriveSyncStatus
5. Add relation to User model
6. Create migration: `npx prisma migrate dev --name add_google_drive_tables`
7. Generate Prisma client

**Acceptance Criteria**:

- [ ] All tables created successfully in PostgreSQL
- [ ] Prisma client generated without errors
- [ ] Can create/read/update/delete records in all new tables

**Files to Create/Modify**:

- `backend/prisma/schema.prisma` (modify)

---

#### T-002: Google Drive OAuth Service

- **Type**: Backend
- **Duration**: 1 day
- **Priority**: P0
- **Dependencies**: T-001

**Tasks**:

1. Create `google-drive.module.ts`
2. Create `google-drive-auth.service.ts`:
   - `isConfigured()` - Check if OAuth credentials are configured
   - `getAuthorizationUrl(state)` - Generate Google OAuth URL
   - `exchangeCodeForToken(userId, code)` - Exchange auth code for tokens
   - `refreshToken(connectionId)` - Refresh access token
   - `disconnect(userId)` - Revoke tokens and delete connection
   - `getConnection(userId)` - Get connection info
   - `getGoogleDriveClient(connectionId)` - Get authenticated googleapis client
3. Implement token encryption for storage
4. Handle Google OAuth scopes:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`

**Acceptance Criteria**:

- [ ] Can generate valid Google OAuth URL with correct scopes
- [ ] Can exchange authorization code for access/refresh tokens
- [ ] Tokens are encrypted before storage
- [ ] Can refresh expired access tokens automatically
- [ ] Can disconnect and clean up connection data

**Files to Create**:

- `backend/src/modules/integrations/google-drive/google-drive.module.ts`
- `backend/src/modules/integrations/google-drive/services/google-drive-auth.service.ts`

---

#### T-003: OAuth Callback and Token Management

- **Type**: Backend
- **Duration**: 0.5 day
- **Priority**: P0
- **Dependencies**: T-002

**Tasks**:

1. Create `google-drive.controller.ts` with OAuth endpoints:
   - `GET /google-drive/connect` - Return OAuth URL
   - `GET /google-drive/callback` - Handle OAuth callback
   - `DELETE /google-drive/disconnect` - Disconnect
   - `GET /google-drive/connection` - Get connection info
   - `GET /google-drive/config` - Check configuration status
2. Create DTOs:
   - `GoogleDriveConnectionDto`
   - Response DTOs for all endpoints
3. Add proper error handling and logging
4. Register module in app.module.ts

**Acceptance Criteria**:

- [ ] `/connect` returns valid OAuth URL
- [ ] `/callback` successfully exchanges code and creates connection
- [ ] `/callback` redirects to frontend with success/error query params
- [ ] `/disconnect` properly cleans up connection and tokens
- [ ] All endpoints have proper authentication guards
- [ ] Swagger documentation generated

**Files to Create/Modify**:

- `backend/src/modules/integrations/google-drive/google-drive.controller.ts`
- `backend/src/modules/integrations/google-drive/dto/google-drive.dto.ts`
- `backend/src/app.module.ts` (modify)

---

#### T-004: Profile Page Connection Card

- **Type**: Frontend
- **Duration**: 1 day
- **Priority**: P0
- **Dependencies**: T-003

**Tasks**:

1. Create `GoogleDriveConnectionCard.tsx` component:
   - Disconnected state: Connect button, setup guide
   - Connecting state: Loading spinner
   - Connected state: Account info, storage usage, disconnect button
   - Error state: Error message, retry/reconnect button
2. Create `frontend/lib/api/google-drive.ts`:
   - `getConnectUrl()` - Get OAuth URL
   - `disconnectGoogleDrive()` - Disconnect
   - `getConnection()` - Get connection info
   - `getConfig()` - Check configuration
3. Update Profile page:
   - Replace "Coming Soon" Google Drive card with actual component
   - Add loading and error states
4. Add i18n translations

**Acceptance Criteria**:

- [ ] Can initiate Google OAuth flow by clicking Connect
- [ ] Redirects to Google authorization page
- [ ] Returns to profile page after authorization
- [ ] Shows connected account info (email, storage)
- [ ] Can disconnect with confirmation dialog
- [ ] Error states displayed properly
- [ ] Mobile responsive

**Files to Create/Modify**:

- `frontend/components/google-drive/GoogleDriveConnectionCard.tsx`
- `frontend/lib/api/google-drive.ts`
- `frontend/app/profile/page.tsx` (modify)
- `frontend/lib/i18n/en.ts` (modify)
- `frontend/lib/i18n/zh.ts` (modify)

---

### Phase 2: File Browser (3 days)

#### T-005: Google Drive File Service

- **Type**: Backend
- **Duration**: 1 day
- **Priority**: P0
- **Dependencies**: T-003

**Tasks**:

1. Create `google-drive-file.service.ts`:
   - `listFiles(connectionId, options)` - List files with pagination
   - `getFile(connectionId, fileId)` - Get single file metadata
   - `getFileContent(connectionId, fileId)` - Download file content
   - `searchFiles(connectionId, query, options)` - Search files
   - `getFolderPath(connectionId, folderId)` - Get breadcrumb path
2. Handle file types and MIME types mapping
3. Handle Google Docs export (to PDF/text)
4. Add rate limiting and error handling
5. Create file-related DTOs

**Acceptance Criteria**:

- [ ] Can list files in root folder
- [ ] Can navigate into folders
- [ ] Can get file metadata including size, modified time
- [ ] Can search files by name
- [ ] Can filter by file type
- [ ] Pagination works correctly
- [ ] Returns proper error for rate limits

**Files to Create**:

- `backend/src/modules/integrations/google-drive/services/google-drive-file.service.ts`
- `backend/src/modules/integrations/google-drive/dto/google-drive-file.dto.ts`

---

#### T-006: File Browser Component

- **Type**: Frontend
- **Duration**: 1 day
- **Priority**: P0
- **Dependencies**: T-005

**Tasks**:

1. Create `GoogleDriveFileBrowser.tsx`:
   - Grid/List view toggle
   - File/folder rendering
   - Double-click to open folder
   - Click to select file
   - Multi-select with checkboxes
2. Create `GoogleDriveFileCard.tsx` for grid view
3. Create `GoogleDriveFileList.tsx` for list view
4. Create `useGoogleDriveFiles.ts` hook:
   - File list state
   - Current folder state
   - Loading/error states
   - Navigation methods
5. Add to Library API client

**Acceptance Criteria**:

- [ ] Displays files and folders with icons
- [ ] Can switch between grid and list views
- [ ] Click folder navigates into it
- [ ] Shows file size and modified date
- [ ] Multi-select works correctly
- [ ] Loading state while fetching
- [ ] Empty state for empty folders

**Files to Create/Modify**:

- `frontend/components/google-drive/GoogleDriveFileBrowser.tsx`
- `frontend/components/google-drive/GoogleDriveFileCard.tsx`
- `frontend/components/google-drive/GoogleDriveFileList.tsx`
- `frontend/hooks/domain/useGoogleDriveFiles.ts`
- `frontend/lib/api/google-drive.ts` (modify)

---

#### T-007: Folder Navigation and Breadcrumb

- **Type**: Frontend
- **Duration**: 0.5 day
- **Priority**: P0
- **Dependencies**: T-006

**Tasks**:

1. Create `GoogleDriveBreadcrumb.tsx`:
   - Show path: My Drive > Folder1 > Folder2
   - Click on any segment to navigate
   - Handle long paths (truncation)
2. Implement back button functionality
3. Track folder history for back navigation
4. Update `useGoogleDriveFiles.ts` with navigation methods

**Acceptance Criteria**:

- [ ] Breadcrumb shows current path
- [ ] Click on path segment navigates to that folder
- [ ] Back button works correctly
- [ ] Root shows "My Drive"
- [ ] Path truncation for deeply nested folders

**Files to Create**:

- `frontend/components/google-drive/GoogleDriveBreadcrumb.tsx`

---

#### T-008: Search and Filter

- **Type**: Frontend
- **Duration**: 0.5 day
- **Priority**: P1
- **Dependencies**: T-006

**Tasks**:

1. Create `GoogleDriveSearchFilter.tsx`:
   - Search input with debounce
   - File type filter dropdown
   - Sort options (name, date, size)
   - Sort direction toggle
2. Implement search API call
3. Combine search with current folder context
4. Add clear filters button

**Acceptance Criteria**:

- [ ] Search finds files by name
- [ ] Can filter by file type (documents, images, etc.)
- [ ] Sort by name/date/size works
- [ ] Debounce prevents excessive API calls
- [ ] Clear filters resets to default

**Files to Create**:

- `frontend/components/google-drive/GoogleDriveSearchFilter.tsx`

---

### Phase 3: Import Feature (3 days)

#### T-009: Google Drive Import Service

- **Type**: Backend
- **Duration**: 1.5 days
- **Priority**: P0
- **Dependencies**: T-005

**Tasks**:

1. Create `google-drive-import.service.ts`:
   - `importFiles(userId, fileIds, options)` - Main import method
   - `downloadFileContent(connectionId, fileId)` - Download file
   - `convertGoogleDoc(connectionId, fileId, format)` - Convert Google Docs
   - `createResource(userId, fileData, content)` - Create Library resource
2. Handle different file types:
   - PDF: Store as-is
   - DOCX/DOC: Convert to text for content extraction
   - Google Docs: Export as PDF or text
   - Images: Store with metadata
3. Track import in GoogleDriveSyncHistory
4. Create GoogleDriveImportedFile mapping
5. Support batch import with progress tracking

**Acceptance Criteria**:

- [ ] Can import PDF files
- [ ] Can import DOCX files with text extraction
- [ ] Can import Google Docs (exports as PDF)
- [ ] Can import images
- [ ] Creates proper Resource record
- [ ] Creates GoogleDriveImportedFile mapping
- [ ] Records import in sync history
- [ ] Handles large files properly (streaming)
- [ ] Returns progress for batch imports

**Files to Create**:

- `backend/src/modules/integrations/google-drive/services/google-drive-import.service.ts`
- `backend/src/modules/integrations/google-drive/dto/google-drive-import.dto.ts`

---

#### T-010: Content Extraction

- **Type**: Backend
- **Duration**: 1 day
- **Priority**: P0
- **Dependencies**: T-009

**Tasks**:

1. Install dependencies:
   - `pdf-parse` for PDF text extraction
   - `mammoth` for DOCX text extraction
2. Create content extraction utilities:
   - `extractTextFromPdf(buffer)` - Extract text from PDF
   - `extractTextFromDocx(buffer)` - Extract text from DOCX
   - `extractMetadataFromImage(buffer)` - Get image metadata
3. Integrate with import service
4. Handle extraction errors gracefully (fallback to no content)
5. Optionally trigger AI summary generation

**Acceptance Criteria**:

- [ ] PDF text extraction works
- [ ] DOCX text extraction works
- [ ] Extraction errors don't fail import
- [ ] Large files handled without memory issues
- [ ] Content stored in Resource.content field

**Files to Modify**:

- `backend/src/modules/integrations/google-drive/services/google-drive-import.service.ts`
- `backend/package.json` (add dependencies)

---

#### T-011: Import Dialog Component

- **Type**: Frontend
- **Duration**: 0.5 day
- **Priority**: P0
- **Dependencies**: T-009

**Tasks**:

1. Create `GoogleDriveImportDialog.tsx`:
   - Show selected files list
   - Import options:
     - Extract text content (checkbox)
     - Generate AI summary (checkbox)
     - Add to collection (select)
     - Add tags (input)
   - Progress indicator for batch import
   - Success/failure summary
2. Create `useGoogleDriveImport.ts` hook
3. Add import button to file browser

**Acceptance Criteria**:

- [ ] Dialog shows selected files
- [ ] Can configure import options
- [ ] Progress bar during import
- [ ] Shows success/failure for each file
- [ ] Closes with summary on completion
- [ ] Can cancel import in progress

**Files to Create**:

- `frontend/components/google-drive/GoogleDriveImportDialog.tsx`
- `frontend/hooks/domain/useGoogleDriveImport.ts`

---

### Phase 4: Export Feature (2 days)

#### T-012: Google Drive Export Service

- **Type**: Backend
- **Duration**: 1 day
- **Priority**: P0
- **Dependencies**: T-005

**Tasks**:

1. Create `google-drive-export.service.ts`:
   - `exportResources(userId, resourceIds, options)` - Main export method
   - `convertResourceToFormat(resource, format)` - Format conversion
   - `uploadToGoogleDrive(connectionId, file, folderId)` - Upload file
   - `createFolder(connectionId, name, parentId)` - Create folder if needed
2. Support export formats:
   - PDF
   - Markdown
   - HTML
   - Plain text
   - Original format
3. Include AI summary and notes if requested
4. Track export in GoogleDriveSyncHistory

**Acceptance Criteria**:

- [ ] Can export resource as PDF
- [ ] Can export as Markdown
- [ ] Can export as HTML
- [ ] Can include AI summary in export
- [ ] Can include user notes in export
- [ ] Files uploaded to specified folder
- [ ] Records export in sync history
- [ ] Returns Google Drive file links

**Files to Create**:

- `backend/src/modules/integrations/google-drive/services/google-drive-export.service.ts`
- `backend/src/modules/integrations/google-drive/dto/google-drive-export.dto.ts`

---

#### T-013: Export Dialog and Folder Picker

- **Type**: Frontend
- **Duration**: 1 day
- **Priority**: P0
- **Dependencies**: T-012

**Tasks**:

1. Create `GoogleDriveExportDialog.tsx`:
   - Show selected resources list
   - Format selection (PDF, Markdown, HTML, etc.)
   - Options:
     - Include AI summary
     - Include notes
     - Include metadata
   - Folder picker trigger
2. Create `GoogleDriveFolderPicker.tsx`:
   - Browse folders only
   - Create new folder option
   - Select destination folder
3. Create `useGoogleDriveExport.ts` hook
4. Add export option to Library resource actions

**Acceptance Criteria**:

- [ ] Dialog shows selected resources
- [ ] Can select export format
- [ ] Can browse and select destination folder
- [ ] Can create new folder
- [ ] Progress during export
- [ ] Shows Drive links on success
- [ ] Can open exported files in new tab

**Files to Create**:

- `frontend/components/google-drive/GoogleDriveExportDialog.tsx`
- `frontend/components/google-drive/GoogleDriveFolderPicker.tsx`
- `frontend/hooks/domain/useGoogleDriveExport.ts`

---

### Phase 5: Polish (2 days)

#### T-014: Sync Status and History

- **Type**: Full Stack
- **Duration**: 0.5 day
- **Priority**: P1
- **Dependencies**: T-011, T-013

**Tasks**:

1. Create `google-drive-sync.service.ts`:
   - `getSyncStatus(userId)` - Get current sync status
   - `getSyncHistory(userId, limit)` - Get sync history
2. Add sync endpoints to controller
3. Create `GoogleDriveSyncStatus.tsx` component:
   - Show last sync time
   - Show sync history
   - Manual refresh button
4. Add to file browser header

**Acceptance Criteria**:

- [ ] Shows last sync time
- [ ] Shows sync history with status
- [ ] Can manually refresh
- [ ] Status indicator (synced, error, etc.)

**Files to Create/Modify**:

- `backend/src/modules/integrations/google-drive/services/google-drive-sync.service.ts`
- `frontend/components/google-drive/GoogleDriveSyncStatus.tsx`

---

#### T-015: Error Handling and Retry Logic

- **Type**: Full Stack
- **Duration**: 0.5 day
- **Priority**: P0
- **Dependencies**: T-014

**Tasks**:

1. Implement error categories:
   - Auth errors (token expired)
   - Rate limit errors
   - File errors (not found, permission denied)
   - Network errors
2. Implement automatic token refresh on 401
3. Implement retry with exponential backoff
4. Add user-friendly error messages
5. Add i18n for error messages

**Acceptance Criteria**:

- [ ] Token refresh happens automatically
- [ ] Rate limits handled with retry
- [ ] User sees friendly error messages
- [ ] Can retry failed operations
- [ ] Errors logged for debugging

**Files to Modify**:

- All service files (add error handling)
- `frontend/lib/api/google-drive.ts`

---

#### T-016: Library Google Drive TAB

- **Type**: Frontend
- **Duration**: 0.5 day
- **Priority**: P1
- **Dependencies**: T-006, T-011

**Tasks**:

1. Create `GoogleDriveTabContent.tsx`:
   - Connection check (not connected → show connect prompt)
   - File browser
   - Import dialog integration
   - Search and filter
2. Update Library page:
   - Add "google-drive" to TAB options
   - Add dynamic import for GoogleDriveTabContent
   - Update URL parameter handling
3. Mobile responsive design

**Acceptance Criteria**:

- [ ] TAB shows in Library navigation
- [ ] Shows connect prompt if not connected
- [ ] Shows file browser if connected
- [ ] Can import files from TAB
- [ ] Responsive on mobile

**Files to Create/Modify**:

- `frontend/components/google-drive/GoogleDriveTabContent.tsx`
- `frontend/app/library/page.tsx` (modify)

---

#### T-017: Integration Testing and Documentation

- **Type**: QA
- **Duration**: 0.5 day
- **Priority**: P0
- **Dependencies**: T-016

**Tasks**:

1. Write integration tests:
   - OAuth flow test
   - File listing test
   - Import test
   - Export test
2. Update API documentation (Swagger)
3. Create user guide in docs/
4. Add environment setup guide
5. Review and fix any bugs found

**Acceptance Criteria**:

- [ ] All integration tests pass
- [ ] Swagger documentation complete
- [ ] User guide written
- [ ] Setup guide for developers
- [ ] No critical bugs

**Files to Create**:

- `docs/guides/google-drive-integration.md`
- `backend/src/modules/integrations/google-drive/**/*.spec.ts`

---

## 8. Task Dependencies Diagram

```
                         T-001 (Schema)
                              |
                              v
                         T-002 (OAuth Service)
                              |
                              v
                         T-003 (Controller)
                              |
              +---------------+----------------+
              |                                |
              v                                v
         T-004 (Profile Card)           T-005 (File Service)
                                               |
                                               v
                                        T-006 (File Browser)
                                               |
                              +----------------+----------------+
                              |                |                |
                              v                v                v
                         T-007 (Nav)     T-008 (Search)   T-009 (Import Svc)
                                                               |
                                                               v
                                                        T-010 (Extraction)
                                                               |
                                                               v
                                                        T-011 (Import Dialog)
                                                               |
                              +--------------------------------+
                              |
                              v
                         T-012 (Export Service)
                              |
                              v
                         T-013 (Export Dialog)
                              |
              +---------------+----------------+
              |               |                |
              v               v                v
         T-014 (Sync)   T-015 (Error)   T-016 (Library TAB)
              |               |                |
              +---------------+----------------+
                              |
                              v
                         T-017 (Testing)
```

---

## 9. NPM Dependencies

### 9.1 Backend

```json
{
  "dependencies": {
    "googleapis": "^131.0.0",
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.6.0"
  },
  "devDependencies": {
    "@types/pdf-parse": "^1.1.1"
  }
}
```

### 9.2 Frontend

No additional frontend dependencies required. Uses existing UI components.

---

## 10. Security Checklist

- [ ] OAuth tokens encrypted before storage
- [ ] HTTPS only for OAuth callbacks in production
- [ ] State parameter for CSRF protection
- [ ] Rate limiting on API endpoints
- [ ] Input validation on all endpoints
- [ ] Proper error handling (no sensitive data in errors)
- [ ] Token refresh handled securely
- [ ] User can only access their own connection

---

## 11. Testing Checklist

### 11.1 Unit Tests

- [ ] OAuth service methods
- [ ] File service methods
- [ ] Import service methods
- [ ] Export service methods
- [ ] DTOs validation

### 11.2 Integration Tests

- [ ] Full OAuth flow
- [ ] File listing with pagination
- [ ] PDF import
- [ ] DOCX import
- [ ] Export to Drive

### 11.3 E2E Tests

- [ ] Connect Google Drive
- [ ] Browse files
- [ ] Import file to Library
- [ ] Export resource to Drive
- [ ] Disconnect

---

## 12. Rollout Plan

### Phase 1: Internal Testing

- Deploy to staging environment
- Team testing for 2 days
- Fix critical bugs

### Phase 2: Beta Release

- Enable for 10% of users
- Monitor error rates
- Collect feedback

### Phase 3: General Availability

- Enable for all users
- Monitor performance
- Address issues as needed

---

## 13. Monitoring and Metrics

### 13.1 Key Metrics

- OAuth success rate (target: >95%)
- API response times (target: <500ms for file list)
- Import success rate (target: >98%)
- Export success rate (target: >98%)
- Error rates by type

### 13.2 Alerts

- OAuth failure rate >5%
- API latency P95 >2s
- Import failure rate >5%

---

## 14. Change Log

| Version | Date       | Changes                     | Author   |
| ------- | ---------- | --------------------------- | -------- |
| 1.0     | 2025-12-25 | Initial implementation plan | PM Agent |

---

## Appendix A: Type Definitions

```typescript
// Frontend types

interface GoogleDriveConnection {
  id: string;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  storageQuota: {
    limit: number;
    usage: number;
    usageInDrive: number;
  };
  status: "ACTIVE" | "ERROR" | "EXPIRED" | "REVOKED";
  lastSyncAt: string | null;
  connectedAt: string;
}

interface GoogleDriveFile {
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

interface ListFilesOptions {
  folderId?: string;
  pageToken?: string;
  pageSize?: number;
  query?: string;
  mimeTypes?: string[];
  orderBy?: "name" | "modifiedTime" | "size";
  orderDirection?: "asc" | "desc";
}

interface ListFilesResponse {
  files: GoogleDriveFile[];
  nextPageToken?: string;
  folderPath: Array<{
    id: string;
    name: string;
  }>;
}

interface ImportOptions {
  extractContent: boolean;
  generateAISummary: boolean;
  collectionId?: string;
  tags?: string[];
}

interface ImportResult {
  imported: Array<{
    fileId: string;
    resourceId: string;
    status: "success" | "failed";
    error?: string;
  }>;
  totalSuccess: number;
  totalFailed: number;
}

interface ExportOptions {
  format: "pdf" | "markdown" | "html" | "txt" | "original";
  folderId: string;
  includeAISummary: boolean;
  includeNotes: boolean;
  includeMetadata: boolean;
}

interface ExportResult {
  exported: Array<{
    resourceId: string;
    fileId: string;
    fileName: string;
    webViewLink: string;
    status: "success" | "failed";
    error?: string;
  }>;
  totalSuccess: number;
  totalFailed: number;
}
```

---

## Appendix B: i18n Keys

```json
{
  "googleDrive": {
    "title": "Google Drive",
    "description": "Connect your Google Drive to import and export resources",
    "connect": "Connect Google Drive",
    "disconnect": "Disconnect",
    "reconnect": "Reconnect",
    "connecting": "Connecting...",
    "connected": "Connected",
    "notConnected": "Not Connected",
    "connectionError": "Connection Error",
    "tokenExpired": "Authorization Expired",
    "storageUsage": "{used} of {total} used",
    "lastSync": "Last synced: {time}",
    "files": "Files",
    "folders": "Folders",
    "import": "Import",
    "export": "Export",
    "refresh": "Refresh",
    "search": "Search files...",
    "noFiles": "No files found",
    "selectFiles": "Select files to import",
    "importOptions": "Import Options",
    "extractContent": "Extract text content",
    "generateSummary": "Generate AI summary",
    "addToCollection": "Add to collection",
    "addTags": "Add tags",
    "importProgress": "Importing {current} of {total}...",
    "importSuccess": "Successfully imported {count} files",
    "importFailed": "Failed to import {count} files",
    "exportFormat": "Export Format",
    "selectFolder": "Select destination folder",
    "includeSummary": "Include AI summary",
    "includeNotes": "Include my notes",
    "exportProgress": "Exporting {current} of {total}...",
    "exportSuccess": "Successfully exported {count} resources",
    "viewInDrive": "View in Google Drive",
    "errors": {
      "notConnected": "Please connect your Google Drive first",
      "authFailed": "Authentication failed. Please try again.",
      "rateLimited": "Too many requests. Please wait a moment.",
      "fileNotFound": "File not found",
      "permissionDenied": "You don't have permission to access this file",
      "importFailed": "Failed to import file: {name}",
      "exportFailed": "Failed to export: {name}"
    }
  }
}
```
