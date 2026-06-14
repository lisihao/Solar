'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  ChevronRight,
  Home,
  RefreshCw,
  ArrowUpDown,
  Folder,
  Database,
  Sparkles,
  X,
} from 'lucide-react';
import { useGoogleDriveFiles } from '@/hooks/domain';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { GoogleDriveFileCard } from './GoogleDriveFileCard';
import { GoogleDriveFileRow } from './GoogleDriveFileRow';
import { useMultiSelect } from '@/hooks';
import AddToKnowledgeBaseDialog, {
  type ResourceToAdd,
} from '@/components/common/dialogs/AddToKnowledgeBaseDialog';
import {
  ViewToggle,
  type ViewMode,
} from '@/components/common/switchers/ViewToggle';
import { AiOrganizeButton } from '@/components/common/ai-organizer/AiOrganizeButton';
import { AiOrganizePanel } from '@/components/common/ai-organizer/AiOrganizePanel';
import type { FileInfo } from '@/services/ai-organizer/api';
import { SideDrawer } from '@/components/common/drawers/SideDrawer';

interface GoogleDriveFileBrowserProps {
  connectionId: string;
  onImport?: (fileIds: string[]) => void;
  /** Show add to knowledge base option */
  showAddToKB?: boolean;
}

/**
 * Google Drive 文件浏览器组件
 * 支持文件夹导航、搜索、排序和多选
 */
export function GoogleDriveFileBrowser({
  connectionId,
  onImport,
  showAddToKB = true,
}: GoogleDriveFileBrowserProps) {
  const [localSearch, setLocalSearch] = useState('');
  const [showKBDialog, setShowKBDialog] = useState(false);
  const [showAiOrganize, setShowAiOrganize] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const {
    files,
    allItems,
    currentFolderId,
    folderPath,
    canGoBack,
    page,
    totalPages,
    total,
    hasMore,
    searchQuery,
    sortBy,
    sortOrder,
    loading,
    error,
    navigateToFolder,
    navigateBack,
    navigateToPath,
    setSearch,
    setSorting,
    setPage,
    refresh,
  } = useGoogleDriveFiles({
    connectionId,
    pageSize: 50,
    immediate: true,
  });

  const {
    selectedIds,
    selectedCount,
    toggleSelect,
    selectAll,
    clearAll,
    isSelected,
  } = useMultiSelect(1000);

  // 处理搜索（带防抖）
  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
  };

  const handleSearchSubmit = () => {
    setSearch(localSearch);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearchSubmit();
    }
  };

  // 清除搜索
  const clearSearch = () => {
    setLocalSearch('');
    setSearch('');
  };

  // 排序选项
  const sortOptions = [
    { value: 'name', label: 'Name' },
    { value: 'modifiedTime', label: 'Modified' },
    { value: 'createdTime', label: 'Created' },
    { value: 'size', label: 'Size' },
  ];

  // 处理导入
  const handleImportSelected = () => {
    if (selectedCount === 0 || !onImport) return;
    onImport(Array.from(selectedIds));
    clearAll();
  };

  // Get selected files as resources for KB dialog
  // IMPORTANT: Use driveFileId (Google Drive native ID) not id (database ID)
  const getSelectedResources = (): ResourceToAdd[] => {
    return files
      .filter((f) => !f.isFolder && isSelected(f.id))
      .map((f) => ({
        id: f.driveFileId, // Use Google Drive native file ID for API calls
        name: f.name,
        type: 'google_drive' as const,
        mimeType: f.mimeType,
        url: f.webViewLink,
      }));
  };

  // Handle add to KB success
  const handleKBAddSuccess = (kbId: string, count: number) => {
    clearAll();
  };

  // Get selected files for AI organization
  const getSelectedFilesForAi = (): FileInfo[] => {
    return files
      .filter((f) => !f.isFolder && isSelected(f.id))
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        description: f.description || undefined,
        size: f.size,
        createdAt: f.driveCreatedAt,
        modifiedAt: f.driveModifiedAt,
        source: 'google_drive' as const,
      }));
  };

  // Handle AI organize applied
  const handleAiOrganizeApplied = (fileId: string) => {
    // Optionally deselect the file after applying
    // toggleSelect(fileId);
  };

  // 全选当前页面
  const handleSelectAllVisible = () => {
    if (selectedCount > 0) {
      clearAll();
    } else {
      files.forEach((file) => {
        if (!file.isFolder) {
          toggleSelect(file.id);
        }
      });
    }
  };

  const fileCount = useMemo(
    () => files.filter((f) => !f.isFolder).length,
    [files]
  );
  const folderCount = useMemo(
    () => files.filter((f) => f.isFolder).length,
    [files]
  );

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-red-200 bg-red-50 py-12">
        <svg
          className="h-12 w-12 text-red-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="mt-4 text-sm font-medium text-red-800">
          Failed to load files
        </p>
        <p className="mt-1 text-xs text-red-600">
          {error.message || 'Unknown error'}
        </p>
        <button
          onClick={refresh}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* 搜索框 */}
        <div className="relative flex-1 sm:max-w-md">
          <input
            type="text"
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search files and folders..."
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 pl-11 text-sm transition-colors placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/5"
          />
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          {localSearch && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2">
          {/* AI Organize button */}
          <AiOrganizeButton
            selectedCount={selectedCount}
            onClick={() => setShowAiOrganize(true)}
            variant="compact"
          />

          {/* 视图切换 */}
          <ViewToggle viewMode={viewMode} onChange={setViewMode} />

          {/* 排序选择 */}
          <select
            value={sortBy}
            onChange={(e) => setSorting(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/5"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {/* 排序方向 */}
          <button
            onClick={() =>
              setSorting(sortBy, sortOrder === 'asc' ? 'desc' : 'asc')
            }
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
            title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
          >
            <ArrowUpDown className="h-4 w-4" />
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>

          {/* 刷新按钮 */}
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 面包屑导航 */}
      <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-gray-200 bg-white px-4 py-2.5">
        <button
          onClick={() => navigateToFolder(null)}
          className={`flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium transition-colors ${
            !currentFolderId
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          <Home className="h-4 w-4" />
          My Drive
        </button>

        {folderPath.map((folder, index) => (
          <div key={folder.id} className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
            <button
              onClick={() => navigateToPath(index)}
              className={`whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium transition-colors ${
                index === folderPath.length - 1
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {folder.name}
            </button>
          </div>
        ))}
      </div>

      {/* 文件统计和多选操作 */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            {folderCount > 0 && (
              <>
                <strong className="font-semibold text-gray-900">
                  {folderCount}
                </strong>{' '}
                folders
              </>
            )}
            {folderCount > 0 && fileCount > 0 && (
              <span className="mx-1">·</span>
            )}
            {fileCount > 0 && (
              <>
                <strong className="font-semibold text-gray-900">
                  {fileCount}
                </strong>{' '}
                files
              </>
            )}
            {total > files.length && (
              <>
                <span className="mx-1">·</span>
                <span className="text-xs">
                  ({files.length} of {total})
                </span>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <>
              <span className="text-sm font-medium text-gray-700">
                {selectedCount} selected
              </span>
              <button
                onClick={clearAll}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Clear
              </button>
            </>
          )}
          {fileCount > 0 && (
            <button
              onClick={handleSelectAllVisible}
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              {selectedCount > 0 ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>
      </div>

      {/* 文件网格 */}
      {loading && files.length === 0 ? (
        <LoadingState size="sm" />
      ) : files.length === 0 ? (
        <EmptyState
          icon={<Folder className="h-12 w-12" />}
          title={
            searchQuery
              ? 'No files found matching your search.'
              : 'This folder is empty.'
          }
          action={
            searchQuery ? (
              <button
                onClick={clearSearch}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Clear search
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {viewMode === 'grid' ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {files.map((file) => (
                <GoogleDriveFileCard
                  key={file.id}
                  file={file}
                  isSelected={isSelected(file.id)}
                  onSelect={toggleSelect}
                  onNavigate={file.isFolder ? navigateToFolder : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {/* 列表表头 */}
              <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                <div className="w-4" /> {/* checkbox 占位 */}
                <div className="w-8" /> {/* icon 占位 */}
                <div className="flex-1">Name</div>
                <div className="hidden w-24 sm:block">Type</div>
                <div className="hidden w-20 text-right md:block">Size</div>
                <div className="hidden w-28 text-right lg:block">Modified</div>
                <div className="w-8" /> {/* actions 占位 */}
              </div>
              {/* 列表内容 */}
              {files.map((file) => (
                <GoogleDriveFileRow
                  key={file.id}
                  file={file}
                  isSelected={isSelected(file.id)}
                  onSelect={toggleSelect}
                  onNavigate={file.isFolder ? navigateToFolder : undefined}
                />
              ))}
            </div>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
              <div className="text-sm text-gray-600">
                Page <span className="font-medium">{page}</span> of{' '}
                <span className="font-medium">{totalPages}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1 || loading}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={!hasMore || loading}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 底部操作栏 */}
      {selectedCount > 0 && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-blue-900">
            {selectedCount} file{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            {/* AI Organize button */}
            <button
              onClick={() => setShowAiOrganize(true)}
              className="flex items-center gap-2 rounded-lg border border-purple-300 bg-white px-4 py-2 text-sm font-medium text-purple-700 transition-colors hover:bg-purple-50"
            >
              <Sparkles className="h-4 w-4" />
              AI Organize
            </button>
            {/* Add to Knowledge Base button */}
            {showAddToKB && (
              <button
                onClick={() => setShowKBDialog(true)}
                className="flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
              >
                <Database className="h-4 w-4" />
                Add to KB
              </button>
            )}
            {/* Import button */}
            {onImport && (
              <button
                onClick={handleImportSelected}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Import Selected
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add to Knowledge Base Dialog */}
      {showKBDialog && (
        <AddToKnowledgeBaseDialog
          resources={getSelectedResources()}
          sourceType="GOOGLE_DRIVE"
          onClose={() => setShowKBDialog(false)}
          onSuccess={handleKBAddSuccess}
        />
      )}

      {/* AI Organize Panel (Slide-in) */}
      <SideDrawer
        open={showAiOrganize}
        onClose={() => setShowAiOrganize(false)}
        title="AI File Organization"
        widthPx={448}
      >
        <AiOrganizePanel
          files={getSelectedFilesForAi()}
          onClose={() => setShowAiOrganize(false)}
          onApplied={handleAiOrganizeApplied}
          title="AI File Organization"
        />
      </SideDrawer>
    </div>
  );
}
