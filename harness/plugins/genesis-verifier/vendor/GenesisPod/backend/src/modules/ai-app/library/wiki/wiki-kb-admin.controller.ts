import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { WikiKbAdminService } from "./wiki-kb-admin.service";
import {
  ToggleWikiEnabledDto,
  WikiPageSearchQueryDto,
} from "./dto/wiki-query.dto";

/**
 * WikiKbAdminController — v1.5.3 P3b backend support.
 *
 * Three endpoints (per v1.5.3 §6 + §11 v1.5.x security rules):
 *  - GET /library/wiki/kbs                        VIEWER+ (per row)
 *  - PATCH /library/kbs/:kbId/wiki-enabled        ADMIN/OWNER
 *  - GET /library/wiki/kbs/:kbId/pages/search     VIEWER+
 *
 * The wiki-enabled toggle lives under /library/kbs/ (not /library/wiki/)
 * because it is a KB-level feature flag, not a wiki sub-resource. The
 * KB selector listing and wiki search live under /library/wiki/ since
 * they are wiki-scoped reads.
 */
@ApiTags("LibraryWikiAdmin")
@Controller("library")
export class WikiKbAdminController {
  constructor(private readonly admin: WikiKbAdminService) {}

  @Get("wiki/kbs")
  @UseGuards(JwtAuthGuard)
  async listKbs(@Request() req: RequestWithUser) {
    const items = await this.admin.listWikiEnabledKbs(req.user.id);
    return { items };
  }

  @Patch("kbs/:kbId/wiki-enabled")
  @UseGuards(JwtAuthGuard)
  async toggleWikiEnabled(
    @Request() req: RequestWithUser,
    @Param("kbId") kbId: string,
    @Body() dto: ToggleWikiEnabledDto,
  ) {
    return this.admin.toggleWikiEnabled(req.user.id, kbId, dto.enabled);
  }

  @Get("wiki/kbs/:kbId/pages/search")
  @UseGuards(JwtAuthGuard)
  async searchPages(
    @Request() req: RequestWithUser,
    @Param("kbId") kbId: string,
    @Query() query: WikiPageSearchQueryDto,
  ) {
    const limit = query.limit ? Number.parseInt(query.limit, 10) : 20;
    const items = await this.admin.searchPages(
      req.user.id,
      kbId,
      query.q,
      limit,
    );
    return { items };
  }

  @Get("wiki/:kbId/operations")
  @UseGuards(JwtAuthGuard)
  async listOperations(
    @Request() req: RequestWithUser,
    @Param("kbId") kbId: string,
    @Query("limit") rawLimit?: string,
  ) {
    const parsed = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
    const limit = Number.isFinite(parsed) ? parsed : 50;
    const items = await this.admin.listOperations(req.user.id, kbId, limit);
    return { items };
  }

  /**
   * W5 v2.0 rebuild (2026-05-12): destructive hard-delete of all wiki
   * data for the KB. Sets wikiEnabled=false on the underlying KB row;
   * does NOT delete the KB or its raw documents. OWNER role required
   * (service layer enforces).
   *
   * Returns the counts of each table cleared so the UI can show the
   * user exactly what got wiped before the confirmation dialog closes.
   */
  @Delete("wiki/:kbId/destroy")
  @UseGuards(JwtAuthGuard)
  async destroyWikiData(
    @Request() req: RequestWithUser,
    @Param("kbId") kbId: string,
  ) {
    return this.admin.destroyWikiData(req.user.id, kbId);
  }

  /**
   * 2026-05-14 P0-B: translate a single-locale KB's pages into the missing
   * locale. Body: `{ targetLocale: 'en' | 'zh' }`. OWNER-only at the
   * service layer.
   */
  @Post("wiki/:kbId/translate")
  @UseGuards(JwtAuthGuard)
  async translateKb(
    @Request() req: RequestWithUser,
    @Param("kbId") kbId: string,
    @Body() body: { targetLocale?: string },
  ) {
    const target = body?.targetLocale;
    if (target !== "zh" && target !== "en") {
      throw new BadRequestException("targetLocale must be 'zh' or 'en'");
    }
    return this.admin.translateKbToLocale(req.user.id, kbId, target);
  }
}
