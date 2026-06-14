import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  UnauthorizedException,
  HttpCode,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BillingContext } from "../../../platform/facade";
import { CollectionsService } from "./collections.service";
import {
  CreateCollectionDto,
  UpdateCollectionDto,
  AddToCollectionDto,
  UpdateNoteDto,
  UpdateCollectionItemDto,
  BatchMoveItemsDto,
  BatchDeleteItemsDto,
  BatchUpdateTagsDto,
  BatchUpdateStatusDto,
} from "./dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../../../../common/guards/optional-jwt-auth.guard";
import type { RequestWithUser } from "../../../../common/types/express-request.types";

/**
 * 收藏系统控制器
 *
 * 安全说明：
 * - 所有修改操作（POST/PATCH/DELETE）需要强制认证
 * - 查询操作根据公开性决定是否需要认证
 */
@ApiTags("Collections")
@Controller("collections")
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  /**
   * 创建收藏集（需要认证）
   */
  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async createCollection(
    @Request() req: RequestWithUser,
    @Body() dto: CreateCollectionDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.createCollection(req.user.id, dto);
  }

  /**
   * 获取用户的所有收藏集（需要认证）
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getUserCollections(@Request() req: RequestWithUser) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.getUserCollections(req.user.id);
  }

  /**
   * 获取单个收藏集详情
   * 公开收藏集可以不登录查看，私有收藏集需要认证且验证权限
   */
  @Get(":id")
  @UseGuards(OptionalJwtAuthGuard)
  async getCollection(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ) {
    const userId = req.user?.id;
    return this.collectionsService.getCollection(id, userId);
  }

  /**
   * 更新收藏集（需要认证）
   */
  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  async updateCollection(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
    @Body() dto: UpdateCollectionDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.updateCollection(id, req.user.id, dto);
  }

  /**
   * 删除收藏集（需要认证）
   */
  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  async deleteCollection(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.deleteCollection(id, req.user.id);
  }

  /**
   * 添加资源到收藏集（需要认证）
   */
  @Post(":id/items")
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async addToCollection(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
    @Body() dto: AddToCollectionDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.addToCollection(id, req.user.id, dto);
  }

  /**
   * 从收藏集移除资源（需要认证）
   */
  @Delete(":id/items/:resourceId")
  @UseGuards(JwtAuthGuard)
  async removeFromCollection(
    @Param("id") id: string,
    @Param("resourceId") resourceId: string,
    @Request() req: RequestWithUser,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.removeFromCollection(
      id,
      resourceId,
      req.user.id,
    );
  }

  /**
   * 更新收藏项笔记（需要认证）
   */
  @Patch(":id/items/:resourceId/note")
  @UseGuards(JwtAuthGuard)
  async updateNote(
    @Param("id") id: string,
    @Param("resourceId") resourceId: string,
    @Request() req: RequestWithUser,
    @Body() dto: UpdateNoteDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.updateCollectionItemNote(
      id,
      resourceId,
      req.user.id,
      dto.note,
    );
  }

  /**
   * 检查资源是否已收藏（需要认证）
   */
  @Get("check/:resourceId")
  @UseGuards(JwtAuthGuard)
  async checkResource(
    @Param("resourceId") resourceId: string,
    @Request() req: RequestWithUser,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.isResourceInUserCollections(
      req.user.id,
      resourceId,
    );
  }

  /**
   * 获取用户的所有标签（需要认证）
   */
  @Get("tags/all")
  @UseGuards(JwtAuthGuard)
  async getUserTags(@Request() req: RequestWithUser) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.getUserTags(req.user.id);
  }

  /**
   * 获取用户收藏统计（需要认证）
   */
  @Get("stats/summary")
  @UseGuards(JwtAuthGuard)
  async getUserStats(@Request() req: RequestWithUser) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.getUserStats(req.user.id);
  }

  /**
   * 分页获取收藏项（需要认证）
   */
  @Get("items/paginated")
  @UseGuards(JwtAuthGuard)
  async getItemsPaginated(
    @Request() req: RequestWithUser,
    @Query("collectionId") collectionId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("status") status?: string,
    @Query("tag") tag?: string,
    @Query("search") search?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.getCollectionItemsPaginated(
      collectionId || null,
      req.user.id,
      {
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        status,
        tag,
        search,
        sortBy,
        sortOrder,
      },
    );
  }

  /**
   * 更新收藏项（标签、阅读状态等）（需要认证）
   */
  @Patch("items/:itemId")
  @UseGuards(JwtAuthGuard)
  async updateItem(
    @Param("itemId") itemId: string,
    @Request() req: RequestWithUser,
    @Body() dto: UpdateCollectionItemDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.updateCollectionItem(
      itemId,
      req.user.id,
      dto,
    );
  }

  /**
   * 批量移动收藏项（需要认证）
   */
  @Post("items/batch/move")
  @UseGuards(JwtAuthGuard)
  async batchMoveItems(
    @Request() req: RequestWithUser,
    @Body() dto: BatchMoveItemsDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.batchMoveItems(req.user.id, dto);
  }

  /**
   * 批量删除收藏项（需要认证）
   */
  @Post("items/batch/delete")
  @UseGuards(JwtAuthGuard)
  async batchDeleteItems(
    @Request() req: RequestWithUser,
    @Body() dto: BatchDeleteItemsDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.batchDeleteItems(req.user.id, dto);
  }

  /**
   * 批量更新标签（需要认证）
   */
  @Post("items/batch/tags")
  @UseGuards(JwtAuthGuard)
  async batchUpdateTags(
    @Request() req: RequestWithUser,
    @Body() dto: BatchUpdateTagsDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.batchUpdateTags(req.user.id, dto);
  }

  /**
   * 批量更新阅读状态（需要认证）
   */
  @Post("items/batch/status")
  @UseGuards(JwtAuthGuard)
  async batchUpdateStatus(
    @Request() req: RequestWithUser,
    @Body() dto: BatchUpdateStatusDto,
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.batchUpdateStatus(req.user.id, dto);
  }

  // ========== AI Organize Endpoints ==========

  /**
   * 获取AI整理统计数据（需要认证）
   */
  @Get("ai/stats")
  @UseGuards(JwtAuthGuard)
  async getAIOrganizeStats(@Request() req: RequestWithUser) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return this.collectionsService.getAIOrganizeStats(req.user.id);
  }

  /**
   * AI批量生成标签（需要认证）
   */
  @Post("ai/batch-tags")
  @UseGuards(JwtAuthGuard)
  async aiBatchTags(
    @Request() req: RequestWithUser,
    @Body() body: { collectionId?: string },
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return BillingContext.run(
      {
        userId: req.user.id,
        moduleType: "collections",
        operationType: "ai-batch-tags",
        description: "AI Batch Generate Tags",
      },
      () =>
        this.collectionsService.aiBatchGenerateTags(
          req.user.id,
          body.collectionId,
        ),
    );
  }

  /**
   * AI智能分类建议（需要认证）
   */
  @Post("ai/smart-classify")
  @UseGuards(JwtAuthGuard)
  async aiSmartClassify(@Request() req: RequestWithUser) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return BillingContext.run(
      {
        userId: req.user.id,
        moduleType: "collections",
        operationType: "ai-smart-classify",
        description: "AI Smart Classify",
      },
      () => this.collectionsService.aiSmartClassify(req.user.id),
    );
  }

  /**
   * AI主题聚类发现（需要认证）
   */
  @Post("ai/theme-cluster")
  @UseGuards(JwtAuthGuard)
  async aiThemeCluster(@Request() req: RequestWithUser) {
    if (!req.user?.id) {
      throw new UnauthorizedException("User authentication required");
    }
    return BillingContext.run(
      {
        userId: req.user.id,
        moduleType: "collections",
        operationType: "ai-theme-cluster",
        description: "AI Theme Cluster",
      },
      () => this.collectionsService.aiThemeCluster(req.user.id),
    );
  }
}
