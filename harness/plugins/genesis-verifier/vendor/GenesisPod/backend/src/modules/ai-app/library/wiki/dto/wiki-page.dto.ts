import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";
import { WikiPageCategory } from "@prisma/client";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/;
const SLUG_MESSAGE =
  "slug must be kebab-case (a-z, 0-9, hyphens), 2-200 chars, no leading/trailing hyphens";

export class CreateWikiPageDto {
  @IsString()
  @Matches(SLUG_REGEX, { message: SLUG_MESSAGE })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @IsEnum(WikiPageCategory)
  category!: WikiPageCategory;

  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  body!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(280)
  oneLiner!: string;
}

export class UpdateWikiPageDto {
  /** Patch action: 'edit' (default) or 'revert'. */
  @IsOptional()
  @IsString()
  action?: "edit" | "revert";

  /** For action=edit: new body / title / oneLiner / category (any subset). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsEnum(WikiPageCategory)
  category?: WikiPageCategory;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  body?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(280)
  oneLiner?: string;

  /** For action=revert: target revision id. service layer enforces revision.pageId === currentPage.id (404 on mismatch per v1.5.3 §6 IDOR). */
  @IsOptional()
  @IsString()
  toRevisionId?: string;
}

export class ListWikiPagesQueryDto {
  @IsOptional()
  @IsEnum(WikiPageCategory)
  category?: WikiPageCategory;

  // @Type forces string "200" -> 200 so @IsInt passes (query strings are
  // always strings; ValidationPipe transform alone doesn't infer number).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 100;

  /**
   * W3-P0 v2.0 rebuild gap #2 (2026-05-12): explicit page-list locale for
   * bilingual KBs. Undefined = list all locales (single-locale KBs see no
   * change). Whitelist `zh` / `en` mirrors WikiKnowledgeBaseConfig.
   */
  @IsOptional()
  @IsIn(["zh", "en"])
  locale?: "zh" | "en";
}

export class WikiPageGetQueryDto {
  /**
   * W3-P0 gap #2: optional locale for slug-based page fetch. Defaults to
   * 'zh' service-side for backward compat with legacy single-locale clients.
   */
  @IsOptional()
  @IsIn(["zh", "en"])
  locale?: "zh" | "en";
}

export class WikiPageSlugParamDto {
  @IsString()
  @Matches(SLUG_REGEX, { message: SLUG_MESSAGE })
  slug!: string;
}
