/**
 * WebhooksController - Webhook 订阅管理 API
 *
 * 提供 Webhook 订阅的 CRUD 接口
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";
import { WebhooksService } from "./webhooks.service";
import { CreateWebhookDto, UpdateWebhookDto } from "./dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import {
  RateLimit,
  RateLimitGuard,
} from "../../../../common/guards/rate-limit.guard";

interface AuthenticatedRequest {
  user: {
    id: string;
    email: string;
  };
}

@ApiTags("webhooks")
@ApiBearerAuth("access-token")
@Controller("webhooks")
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * 创建 Webhook 订阅
   */
  @Post()
  @UseGuards(RateLimitGuard)
  @RateLimit({
    maxRequests: 10,
    windowSeconds: 60,
    message: "创建请求过于频繁",
  })
  @ApiOperation({
    summary: "创建 Webhook 订阅",
    description:
      "创建新的 Webhook 订阅，返回包含 secret 的完整信息（仅此次返回）",
  })
  @ApiBody({ type: CreateWebhookDto })
  @ApiResponse({
    status: 201,
    description: "订阅创建成功",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", example: "clxyz123..." },
        name: { type: "string", example: "My Webhook" },
        url: { type: "string", example: "https://example.com/webhook" },
        secret: { type: "string", example: "whsec_abc123..." },
        events: {
          type: "array",
          items: { type: "string" },
          example: ["TOPIC_CREATED", "MESSAGE_CREATED"],
        },
        isActive: { type: "boolean", example: true },
        createdAt: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({ status: 400, description: "请求参数无效" })
  @ApiResponse({ status: 429, description: "请求过于频繁" })
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateWebhookDto,
  ) {
    return this.webhooksService.create(req.user.id, dto);
  }

  /**
   * 获取所有订阅
   */
  @Get()
  @ApiOperation({
    summary: "获取所有 Webhook 订阅",
    description: "获取当前用户的所有 Webhook 订阅列表",
  })
  @ApiResponse({
    status: 200,
    description: "订阅列表",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          url: { type: "string" },
          events: { type: "array", items: { type: "string" } },
          isActive: { type: "boolean" },
          failureCount: { type: "number" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
  })
  async findAll(@Request() req: AuthenticatedRequest) {
    return this.webhooksService.findAll(req.user.id);
  }

  /**
   * 获取单个订阅详情
   */
  @Get(":id")
  @ApiOperation({
    summary: "获取 Webhook 详情",
    description: "获取指定 Webhook 订阅的详细信息",
  })
  @ApiParam({ name: "id", description: "Webhook 订阅 ID" })
  @ApiResponse({ status: 200, description: "订阅详情" })
  @ApiResponse({ status: 404, description: "订阅不存在" })
  @ApiResponse({ status: 403, description: "无权访问" })
  async findOne(@Request() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.webhooksService.findOne(req.user.id, id);
  }

  /**
   * 更新订阅
   */
  @Put(":id")
  @ApiOperation({
    summary: "更新 Webhook 订阅",
    description: "更新指定 Webhook 订阅的配置",
  })
  @ApiParam({ name: "id", description: "Webhook 订阅 ID" })
  @ApiBody({ type: UpdateWebhookDto })
  @ApiResponse({ status: 200, description: "更新成功" })
  @ApiResponse({ status: 404, description: "订阅不存在" })
  @ApiResponse({ status: 403, description: "无权修改" })
  async update(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(req.user.id, id, dto);
  }

  /**
   * 删除订阅
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "删除 Webhook 订阅",
    description: "永久删除指定的 Webhook 订阅",
  })
  @ApiParam({ name: "id", description: "Webhook 订阅 ID" })
  @ApiResponse({
    status: 200,
    description: "删除成功",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
      },
    },
  })
  @ApiResponse({ status: 404, description: "订阅不存在" })
  @ApiResponse({ status: 403, description: "无权删除" })
  async delete(@Request() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.webhooksService.delete(req.user.id, id);
  }

  /**
   * 重新生成 Secret
   */
  @Post(":id/regenerate-secret")
  @UseGuards(RateLimitGuard)
  @RateLimit({ maxRequests: 5, windowSeconds: 60, message: "操作过于频繁" })
  @ApiOperation({
    summary: "重新生成 Secret",
    description: "重新生成 Webhook 签名密钥，旧密钥将立即失效",
  })
  @ApiParam({ name: "id", description: "Webhook 订阅 ID" })
  @ApiResponse({
    status: 200,
    description: "新 Secret",
    schema: {
      type: "object",
      properties: {
        secret: { type: "string", example: "whsec_newkey123..." },
      },
    },
  })
  @ApiResponse({ status: 404, description: "订阅不存在" })
  @ApiResponse({ status: 429, description: "操作过于频繁" })
  async regenerateSecret(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.webhooksService.regenerateSecret(req.user.id, id);
  }

  /**
   * 获取投递历史
   */
  @Get(":id/deliveries")
  @ApiOperation({
    summary: "获取投递历史",
    description: "获取 Webhook 的投递历史记录，支持分页",
  })
  @ApiParam({ name: "id", description: "Webhook 订阅 ID" })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "每页数量",
    example: 50,
  })
  @ApiQuery({ name: "cursor", required: false, description: "分页游标" })
  @ApiResponse({
    status: 200,
    description: "投递历史",
    schema: {
      type: "object",
      properties: {
        deliveries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              eventType: { type: "string" },
              status: {
                type: "string",
                enum: ["PENDING", "SUCCESS", "FAILED", "RETRYING"],
              },
              attemptCount: { type: "number" },
              responseStatus: { type: "number" },
              createdAt: { type: "string", format: "date-time" },
            },
          },
        },
        nextCursor: { type: "string", nullable: true },
      },
    },
  })
  @ApiResponse({ status: 404, description: "订阅不存在" })
  async getDeliveries(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.webhooksService.getDeliveries(req.user.id, id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  /**
   * 测试 Webhook
   */
  @Post(":id/test")
  @UseGuards(RateLimitGuard)
  @RateLimit({ maxRequests: 5, windowSeconds: 60, message: "测试请求过于频繁" })
  @ApiOperation({
    summary: "测试 Webhook",
    description: "向 Webhook 端点发送测试事件，验证连通性",
  })
  @ApiParam({ name: "id", description: "Webhook 订阅 ID" })
  @ApiResponse({
    status: 200,
    description: "测试结果",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        status: { type: "number", example: 200 },
        responseTime: { type: "number", example: 150 },
        responseBody: { type: "string" },
        error: { type: "string", nullable: true },
      },
    },
  })
  @ApiResponse({ status: 404, description: "订阅不存在" })
  @ApiResponse({ status: 429, description: "测试过于频繁" })
  async testWebhook(
    @Request() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.webhooksService.testWebhook(req.user.id, id);
  }
}
