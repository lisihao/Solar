/**
 * ReportArtifactZodSchema —— ReportArtifact 运行期校验
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §7.2
 *
 * 用途：
 *   1. ctx-hydrator 从 mission.report_full（JSONB）读出后必须 zod parse，
 *      防止历史污染数据 / mission_event payload 注入 / 字段类型漂移导致 cascade 崩溃
 *   2. backfill 脚本（c195035f 救活）从 S8 event payload 读 artifact 后，
 *      用本 schema 校验后才 markIntermediateState 写 mission.report_full
 *
 * 安全约束（v1.1 类别 E1 BLOCKER + v1.2 类别 E.metadata.refine）：
 *   - 每字段含 max length（防超大数据攻击）
 *   - sections.length 上限 100（防超大 sections 数组）
 *   - metadata 用 .and(z.record(...).refine(keys.length<=50)) 双重约束防 DoS 投毒
 *   - 不用 .passthrough()（v1.0 漏洞）
 *
 * stateless：纯函数 / schema 常量，无副作用，可 Promise.all 并发使用。
 */

import { z } from "zod";

// ═════════════════════════════════════════════════════════════════════
// 字段级 Zod schema（与 report-artifact.dto.ts 类型一致）
// ═════════════════════════════════════════════════════════════════════

const SectionTypeEnum = z.enum([
  "executive_summary",
  "preface",
  "dimension",
  "cross_dimension",
  "risk_assessment",
  "recommendations",
  "outlook",
  "conclusion",
  "appendix",
]);

const SectionLevelEnum = z.union([z.literal(2), z.literal(3)]);

export const ArtifactSectionZodSchema = z.object({
  id: z.string().min(1).max(64),
  type: SectionTypeEnum,
  level: SectionLevelEnum,
  title: z.string().min(1).max(200),
  anchor: z.string().min(1).max(200),
  startOffset: z.number().int().min(0).max(2_000_000),
  endOffset: z.number().int().min(0).max(2_000_000),
  wordCount: z.number().int().min(0).max(1_000_000),
  readingTimeMinutes: z.number().int().min(0).max(10_000),
  citations: z.array(z.number().int()).max(1000),
  figureIds: z.array(z.string().max(64)).max(100),
  factIds: z.array(z.string().max(64)).max(1000),
  sourceDimensionId: z.string().max(64).optional(),
});

const ArtifactCitationZodSchema = z
  .object({
    index: z.number().int().min(0),
    uuid: z.string().max(64),
    title: z.string().max(500),
    // PR-R0 security 收尾：url 加 .url() 格式校验（防后续抓取被注入非法 URL）
    url: z.string().url().max(2000),
    domain: z.string().max(200),
    accessedAt: z.string().max(40),
    sourceType: z.string().max(40),
    credibilityScore: z.number().min(0).max(100),
    occurrences: z
      .array(
        z.object({
          sectionId: z.string().max(64),
          paragraphIndex: z.number().int().min(0),
          characterOffset: z.number().int().min(0),
        }),
      )
      .max(1000),
  })
  // citations 已界定 occurrences 等内部字段；passthrough 残留扩展字段不进 cascade 关键路径（reviewer 注释完善）
  .passthrough();

const ArtifactMetadataInnerZodSchema = z.object({
  topic: z.string().min(1).max(500),
  generatedAt: z.string().max(40),
  generationTimeMs: z.number().int().min(0).max(86_400_000), // ≤ 24h
  version: z.number().int().min(1).max(100),
  isIncremental: z.boolean(),
  dimensionCount: z.number().int().min(0).max(100),
  sourceCount: z.number().int().min(0).max(10_000),
  factCount: z.number().int().min(0).max(100_000),
  figureCount: z.number().int().min(0).max(1_000),
  wordCount: z.number().int().min(0).max(1_000_000),
  readingTimeMinutes: z.number().int().min(0).max(10_000),
  styleProfile: z.string().max(40),
  lengthProfile: z.string().max(40),
  audienceProfile: z.string().max(40),
  language: z.string().max(20),
  totalTokens: z.object({
    prompt: z.number().int().min(0).max(100_000_000),
    completion: z.number().int().min(0).max(100_000_000),
    total: z.number().int().min(0).max(100_000_000),
  }),
  costCents: z.number().int().min(0).max(1_000_000),
  modelTrail: z.array(z.string().max(120)).max(50),
  templateId: z.string().max(100).optional(),
  sanitizerVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .max(40)
    .optional(),
  sectionCountMismatch: z
    .object({
      expected: z.number().int(),
      actual: z.number().int(),
    })
    .optional(),
});

/**
 * v1.2 类别 E（metadata DoS 防护）：metadata 既要满足 typed schema，又要满足
 * "总 key 数量 ≤ 50 + 单 key 长度 ≤ 64" 约束，防止注入超量字段或超长 key。
 *
 * 用 .and 而非 .passthrough() —— passthrough 在 v1.0 是漏洞（任意 key 可注入）。
 */
const MetadataKeyLimitSchema = z
  .record(z.string().max(64), z.unknown())
  .refine((obj) => Object.keys(obj).length <= 50, {
    message: "metadata fields > 50 (DoS 防护)",
  });

const ArtifactMetadataZodSchema = ArtifactMetadataInnerZodSchema.and(
  MetadataKeyLimitSchema,
);

// quality / quickView / figures / factTable 都做相对宽松的字段级校验（保留 passthrough 兼容性，
// 但强制顶层字段类型）—— 因这些不是 v1.7 装配核心，attacker surface 较小。

const ArtifactQualityZodSchema = z
  .object({
    overall: z.number().min(0).max(100),
    dimensions: z.record(z.string().max(64), z.number().min(0).max(100)),
    hardGateViolations: z.array(z.unknown()).max(100),
    warnings: z.array(z.unknown()).max(1000),
    qualityTrace: z.array(z.unknown()).max(1000),
    finalVerdict: z.string().max(40),
  })
  .passthrough();

const ArtifactQuickViewZodSchema = z
  .object({
    executiveSummary: z.object({
      markdown: z.string().max(50_000),
      wordCount: z.number().int().min(0).max(100_000),
    }),
    estimatedReadingTime: z.number().int().min(0).max(10_000),
  })
  .passthrough();

// ═════════════════════════════════════════════════════════════════════
// 顶层 ReportArtifact schema
// ═════════════════════════════════════════════════════════════════════

export const ReportArtifactZodSchema = z.object({
  content: z.object({
    fullMarkdown: z.string().max(2_000_000), // 与 sanitizer maxInputBytes 一致（2MB）
    fullReportSize: z.number().int().min(0).max(2_000_000),
  }),
  sections: z.array(ArtifactSectionZodSchema).max(100),
  citations: z.array(ArtifactCitationZodSchema).max(1000),
  figures: z.array(z.unknown()).max(100),
  factTable: z.array(z.unknown()).max(1000),
  quickView: ArtifactQuickViewZodSchema,
  metadata: ArtifactMetadataZodSchema,
  quality: ArtifactQualityZodSchema,
});

export type ValidatedReportArtifact = z.infer<typeof ReportArtifactZodSchema>;

// ═════════════════════════════════════════════════════════════════════
// helper：safeParse + 友好错误（caller 不需要解 ZodError 结构）
// ═════════════════════════════════════════════════════════════════════

export interface ParseReportArtifactResult {
  ok: boolean;
  data?: ValidatedReportArtifact;
  errorMessage?: string;
  /** issues 用于 log/debug，不暴露给 client（防泄露内部结构）*/
  issues?: ReadonlyArray<{ path: string; message: string }>;
}

/**
 * 主入口：ctx-hydrator / backfill 脚本调用此函数校验 reportArtifact。
 * 失败时返回结构化错误（caller decide throw 或 fallback），不直接 throw。
 */
export function parseReportArtifact(raw: unknown): ParseReportArtifactResult {
  // 入口快速 size 守卫（v1.1 类别 E5 — payload 大小限制）
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch (err) {
    return {
      ok: false,
      errorMessage: `report artifact JSON.stringify failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (serialized.length > 2_000_000) {
    return {
      ok: false,
      errorMessage: `report artifact size ${serialized.length} > 2MB limit (DoS 防护)`,
    };
  }

  const result = ReportArtifactZodSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    errorMessage: `report artifact zod validation failed: ${result.error.issues.length} issue(s)`,
    issues: result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}
