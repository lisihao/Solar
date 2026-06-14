/**
 * API 模块导出（精简后）
 *
 * ★ 业务 API 已下沉到 services/<module>/api.ts，本文件只保留平台层
 *   HTTP client（client.ts）的 re-export，避免业务命名空间污染 lib/。
 */

// 统一的 API 客户端（平台能力）
export * from './client';
