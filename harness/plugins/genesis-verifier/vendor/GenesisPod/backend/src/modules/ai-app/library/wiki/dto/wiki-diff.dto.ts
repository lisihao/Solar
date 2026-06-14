import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";

export class IngestWikiDto {
  @IsArray()
  @IsUUID("4", { each: true })
  documentIds!: string[];
}

export class PatchWikiDiffDto {
  @IsEnum(["apply", "dismiss"])
  action!: "apply" | "dismiss";

  /** For action=apply: optional subset of diff item ids to apply. Omit = apply all. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedItemIds?: string[];

  /**
   * For action=apply: 与其他 PENDING diff 在 slug 上冲突时，自动 DISMISS 冲突
   * 的 PENDING（newer-wins 语义）。前端在拿到 409 后通过 confirm 对话框让
   * 用户重试并带此 flag，避免用户被强制手动清理过时 PENDING。
   */
  @IsOptional()
  supersedeConflictingDiffs?: boolean;
}

export class PatchWikiLintFindingDto {
  @IsEnum(["resolve", "dismiss"])
  action!: "resolve" | "dismiss";
}

/**
 * 批量解决/忽略 lint findings。
 * - ids 显式指定 findingIds（前端勾选用）
 * - 或 filterAll: { type? }（"全部解决"按钮，按当前过滤器作用全集）
 */
export class BatchPatchWikiLintFindingsDto {
  @IsEnum(["resolve", "dismiss"])
  action!: "resolve" | "dismiss";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  /** 配合 type 用：忽略 type 下所有 unresolved findings */
  @IsOptional()
  filterAll?: boolean;

  @IsOptional()
  @IsString()
  type?: string;
}
