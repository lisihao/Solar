/**
 * R2 key prefix allow-list — 单一源 (2026-05-09)。
 *
 * common/ 层只导出"前缀字符串"白名单 + 校验函数；prisma-aware 的 ID 提取 / DB
 * 反查逻辑在 platform/storage/governance/offload-prefixes.ts。
 *
 * 本白名单被两处消费：
 *   1. PrismaService.downloadText 校验：uri 必须 startsWith 某个前缀，
 *      防止 object substitution 攻击（恶意 row.uri 指向 bucket 内任意路径）
 *   2. platform StorageOrphanCleanup：扫 R2 对象时按前缀匹配再交给对应 detail 处理
 *
 * 新增 off-load 字段必须同时在两处更新：本文件 + platform/.../offload-prefixes.ts。
 */

export const OFFLOAD_KEY_PREFIXES = [
  // 既有
  "topic-reports/",
  "dimension-analyses/",
  "research-tasks/",
  // 2026-05-09 新增
  "kb-documents/",
  "wiki-revisions/",
  "wiki-diffs/",
  "mission-records/",
  "report-versions/",
] as const;

/** Allow-list 校验：uri 必须以白名单前缀之一开头 */
export function isOffloadKeyAllowed(uri: string): boolean {
  return OFFLOAD_KEY_PREFIXES.some((p) => uri.startsWith(p));
}
