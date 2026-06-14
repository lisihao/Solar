/**
 * R2 key prefix registry — 单一源 (2026-05-09)。
 *
 * 在 common/storage/offload-key-allowlist.ts 的字符串白名单基础上，
 * 增加 prisma-aware 的 (extractId / listLiveIds) 让 StorageOrphanCleanup
 * 能反查 DB 行是否存在 → 删除 cascade 后残留的孤儿 R2 对象。
 *
 * 命名约定（与 topic-reports / research-tasks 既有风格对齐）：
 *   {table}/{id}/{file.ext}    — 对象按 id 分目录便于 lifecycle policy
 *   {table}/{id}.{ext}          — 旧风格（仅 dimension-analyses 单层）
 */

import type { PrismaService } from "../../../../common/prisma/prisma.service";
import { OFFLOAD_KEY_PREFIXES } from "../../../../common/storage/offload-key-allowlist";

export interface OffloadPrefix {
  /** R2 key prefix (含末尾 /) */
  prefix: string;
  /** 从 R2 key 提取行 ID（用于孤儿清理对比 DB） */
  extractId: (key: string) => string | null;
  /** 列出当前 DB 中存在的 ID 集合（孤儿清理时反查） */
  listLiveIds: (
    prisma: PrismaService,
    candidateIds: string[],
  ) => Promise<Set<string>>;
}

/**
 * 通用 ID 提取器：`{prefix}{id}/...` 或 `{prefix}{id}.{ext}` 都支持。
 * 取 prefix 后第一个 `/` 或 `.` 之前的段。
 */
function extractAfterPrefix(prefix: string) {
  return (key: string): string | null => {
    if (!key.startsWith(prefix)) return null;
    const rest = key.slice(prefix.length);
    const cut = Math.min(
      rest.indexOf("/") === -1 ? Number.MAX_SAFE_INTEGER : rest.indexOf("/"),
      rest.indexOf(".") === -1 ? Number.MAX_SAFE_INTEGER : rest.indexOf("."),
    );
    if (cut === Number.MAX_SAFE_INTEGER) return rest || null;
    return rest.slice(0, cut) || null;
  };
}

export const OFFLOAD_PREFIXES: readonly OffloadPrefix[] = [
  // 既有（PR-1 之前已存在）
  {
    prefix: "topic-reports/",
    extractId: extractAfterPrefix("topic-reports/"),
    listLiveIds: async (p, ids) => {
      const rows = await p.topicReport.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  },
  {
    prefix: "dimension-analyses/",
    extractId: extractAfterPrefix("dimension-analyses/"),
    listLiveIds: async (p, ids) => {
      const rows = await p.dimensionAnalysis.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  },
  {
    prefix: "research-tasks/",
    extractId: extractAfterPrefix("research-tasks/"),
    listLiveIds: async (p, ids) => {
      const rows = await p.researchTask.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  },
  // 2026-05-09 新增（PR-1/2/3）
  {
    prefix: "kb-documents/",
    extractId: extractAfterPrefix("kb-documents/"),
    listLiveIds: async (p, ids) => {
      const rows = await p.knowledgeBaseDocument.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  },
  {
    prefix: "wiki-revisions/",
    extractId: extractAfterPrefix("wiki-revisions/"),
    listLiveIds: async (p, ids) => {
      const rows = await p.wikiPageRevision.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  },
  {
    prefix: "wiki-diffs/",
    extractId: extractAfterPrefix("wiki-diffs/"),
    listLiveIds: async (p, ids) => {
      const rows = await p.wikiDiff.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  },
  {
    prefix: "mission-records/",
    extractId: extractAfterPrefix("mission-records/"),
    listLiveIds: async (p, ids) => {
      const rows = await p.agentPlaygroundMission.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  },
  {
    prefix: "report-versions/",
    extractId: extractAfterPrefix("report-versions/"),
    listLiveIds: async (p, ids) => {
      const rows = await p.missionReportVersion.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      return new Set(rows.map((r) => r.id));
    },
  },
];

// 一致性自检（启动期 dev 期发现）：OFFLOAD_PREFIXES 必须覆盖 OFFLOAD_KEY_PREFIXES
// （字符串白名单严格父集），二者顺序无关。
const _registered = new Set(OFFLOAD_PREFIXES.map((p) => p.prefix));
for (const allow of OFFLOAD_KEY_PREFIXES) {
  if (!_registered.has(allow)) {
    throw new Error(
      `[offload-prefixes] allow-listed prefix '${allow}' missing from OFFLOAD_PREFIXES — ` +
        `add extractId/listLiveIds entry`,
    );
  }
}
