import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  UnauthorizedException,
  HttpCode,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CommentsService } from "./comments.service";
import { CreateCommentDto, UpdateCommentDto } from "./dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { Public } from "../../../../common/decorators/public.decorator";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

/**
 * 评论控制器
 *
 * API端点：
 * - POST /api/v1/comments - 创建评论
 * - GET /api/v1/comments/resource/:resourceId - 获取资源的评论
 * - GET /api/v1/comments/source/:source - 获取 source 的评论 (YouTube等)
 * - GET /api/v1/comments/:id - 获取单个评论
 * - PATCH /api/v1/comments/:id - 更新评论
 * - DELETE /api/v1/comments/:id - 删除评论
 * - POST /api/v1/comments/:id/upvote - 点赞评论
 * - GET /api/v1/comments/resource/:resourceId/stats - 获取评论统计
 * - GET /api/v1/comments/source/:source/stats - 获取 source 评论统计
 */
@ApiTags("Comments")
@Controller("comments")
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  /**
   * 创建评论
   */
  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async createComment(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateCommentDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.commentsService.createComment(userId, dto);
  }

  /**
   * 获取资源的评论（树形结构）- 公开接口
   */
  @Public()
  @Get("resource/:resourceId")
  async getResourceComments(@Param("resourceId") resourceId: string) {
    return this.commentsService.getResourceComments(resourceId);
  }

  /**
   * 获取 source 的评论（树形结构）- 公开接口
   * 用于 YouTube 视频等非 Resource 的评论
   */
  @Public()
  @Get("source/:source")
  async getSourceComments(@Param("source") source: string) {
    return this.commentsService.getSourceComments(source);
  }

  /**
   * 获取 source 的评论统计 - 公开接口
   */
  @Public()
  @Get("source/:source/stats")
  async getSourceCommentStats(@Param("source") source: string) {
    return this.commentsService.getSourceCommentStats(source);
  }

  /**
   * 获取单个评论 - 公开接口
   */
  @Public()
  @Get(":id")
  async getComment(@Param("id") id: string) {
    return this.commentsService.getComment(id);
  }

  /**
   * 更新评论
   */
  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  async updateComment(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
    @Body() dto: UpdateCommentDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.commentsService.updateComment(id, userId, dto);
  }

  /**
   * 删除评论
   */
  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  async deleteComment(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.commentsService.deleteComment(id, userId);
  }

  /**
   * 点赞评论 - 公开接口（可以考虑后续需要登录）
   */
  @Public()
  @Post(":id/upvote")
  async upvoteComment(@Param("id") id: string) {
    return this.commentsService.upvoteComment(id);
  }

  /**
   * 获取评论统计 - 公开接口
   */
  @Public()
  @Get("resource/:resourceId/stats")
  async getCommentStats(@Param("resourceId") resourceId: string) {
    return this.commentsService.getCommentStats(resourceId);
  }
}
