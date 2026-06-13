/**
 * Knowledge admin controller —— 薄 HTTP，逻辑在 ai-app/library/KnowledgeAdminService。
 * Admin 视角"知识管理"：跨用户 KB / 文档 / Wiki 列表 + 详情（不按 user 过滤，看全量）。
 */
import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { KnowledgeAdminService } from "@/modules/ai-app/library/knowledge-graph/knowledge-admin.service";

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/knowledge")
export class KnowledgeController {
  constructor(private readonly knowledgeAdmin: KnowledgeAdminService) {}

  @Get("kbs")
  listKnowledgeBases(
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("type") type?: string,
    @Query("ownerId") ownerId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.knowledgeAdmin.listKnowledgeBases({
      search,
      status,
      type,
      ownerId,
      page,
      pageSize,
    });
  }

  @Get("kbs/:id")
  getKnowledgeBase(@Param("id") id: string) {
    return this.knowledgeAdmin.getKnowledgeBase(id);
  }

  @Get("documents")
  listDocuments(
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("knowledgeBaseId") knowledgeBaseId?: string,
    @Query("sourceType") sourceType?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.knowledgeAdmin.listDocuments({
      search,
      status,
      knowledgeBaseId,
      sourceType,
      page,
      pageSize,
    });
  }

  @Get("documents/:id")
  getDocument(@Param("id") id: string) {
    return this.knowledgeAdmin.getDocument(id);
  }

  @Get("wiki-pages")
  listWikiPages(
    @Query("search") search?: string,
    @Query("category") category?: string,
    @Query("knowledgeBaseId") knowledgeBaseId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.knowledgeAdmin.listWikiPages({
      search,
      category,
      knowledgeBaseId,
      page,
      pageSize,
    });
  }

  @Get("wiki-pages/:id")
  getWikiPage(@Param("id") id: string) {
    return this.knowledgeAdmin.getWikiPage(id);
  }
}
