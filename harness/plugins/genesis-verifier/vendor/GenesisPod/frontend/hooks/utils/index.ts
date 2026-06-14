/**
 * Utility Hooks - 工具类 hooks
 *
 * 这些 hooks 提供通用的 UI 工具功能：
 * - useMultiSelect: 多选管理
 * - useUrlDetection: URL 检测
 * - useThumbnailGenerator: 缩略图生成（客户端版本）
 * - useSimpleThumbnailGenerator: 简单缩略图生成
 * - useSimulationPerspective: 模拟视角
 * - useWorkspaceSync: 工作区同步
 * - useYoutubeSubtitleExport: YouTube 字幕导出
 * - useAutoSave: 自动保存草稿
 */

export * from './useMultiSelect';
export * from './useUrlDetection';
// 重命名简单版本避免命名冲突
export { useThumbnailGenerator as useSimpleThumbnailGenerator } from './useThumbnailGenerator';
// 客户端完整版本作为主要导出
export * from './useThumbnailGeneratorClient';
export * from './useSimulationPerspective';
export * from './useReportWorkspace';
export * from './useWorkspaceSync';
export * from './useYoutubeSubtitleExport';
export * from './useAutoSave';
export * from './useAssetForm';
