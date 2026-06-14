/**
 * Feishu Data Source Controller
 * API endpoints for managing Feishu synced items
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Logger,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { FeishuDataSourceService } from "./feishu-data-source.service";
import { FeishuAuthService } from "./feishu-auth.service";
import { FeishuItemType } from "@prisma/client";

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@ApiTags("Feishu Data Source")
@Controller("feishu-data-source")
@ApiBearerAuth()
export class FeishuDataSourceController {
  private readonly logger = new Logger(FeishuDataSourceController.name);

  constructor(
    private readonly feishuDataSourceService: FeishuDataSourceService,
    private readonly feishuAuthService: FeishuAuthService,
  ) {}

  private getUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
    }
    return userId;
  }

  /**
   * Get Feishu data source status and stats
   */
  @Get("status")
  @ApiOperation({ summary: "Get Feishu data source status and statistics" })
  @ApiResponse({
    status: 200,
    description: "Returns Feishu data source status",
  })
  async getStatus(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    const isConfigured = this.feishuAuthService.isConfigured();
    const stats = await this.feishuDataSourceService.getStats(userId);

    return {
      isConnected: isConfigured,
      appId: isConfigured ? this.feishuAuthService.getMaskedAppId() : null,
      stats,
    };
  }

  /**
   * List Feishu items
   */
  @Get("items")
  @ApiOperation({ summary: "List Feishu items" })
  @ApiQuery({
    name: "type",
    required: false,
    enum: ["WIKI_NODE", "DOC", "SHEET", "BITABLE", "EXTERNAL"],
  })
  @ApiQuery({ name: "syncedToRag", required: false, type: Boolean })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "offset", required: false, type: Number })
  @ApiResponse({ status: 200, description: "Returns list of Feishu items" })
  async listItems(
    @Req() req: AuthenticatedRequest,
    @Query("type") type?: string,
    @Query("syncedToRag") syncedToRag?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const userId = this.getUserId(req);

    const options: {
      type?: FeishuItemType;
      syncedToRag?: boolean;
      limit?: number;
      offset?: number;
    } = {};

    if (
      type &&
      ["WIKI_NODE", "DOC", "SHEET", "BITABLE", "EXTERNAL"].includes(type)
    ) {
      options.type = type as FeishuItemType;
    }

    if (syncedToRag !== undefined) {
      options.syncedToRag = syncedToRag === "true";
    }

    if (limit) {
      options.limit = parseInt(limit, 10);
    }

    if (offset) {
      options.offset = parseInt(offset, 10);
    }

    const result = await this.feishuDataSourceService.getItems(userId, options);

    return {
      items: result.items,
      total: result.total,
      limit: options.limit || 50,
      offset: options.offset || 0,
    };
  }

  /**
   * Get a single Feishu item
   */
  @Get("items/:id")
  @ApiOperation({ summary: "Get a single Feishu item" })
  @ApiResponse({ status: 200, description: "Returns the Feishu item" })
  @ApiResponse({ status: 404, description: "Item not found" })
  async getItem(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const userId = this.getUserId(req);
    return this.feishuDataSourceService.getItem(userId, id);
  }

  /**
   * Delete a Feishu item
   */
  @Delete("items/:id")
  @ApiOperation({ summary: "Delete a Feishu item" })
  @ApiResponse({ status: 200, description: "Item deleted successfully" })
  @ApiResponse({ status: 404, description: "Item not found" })
  async deleteItem(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const userId = this.getUserId(req);
    await this.feishuDataSourceService.deleteItem(userId, id);
    return { message: "Item deleted successfully" };
  }

  /**
   * Batch delete Feishu items
   */
  @Post("items/batch-delete")
  @ApiOperation({ summary: "Batch delete Feishu items" })
  @ApiResponse({ status: 200, description: "Items deleted successfully" })
  async batchDeleteItems(
    @Req() req: AuthenticatedRequest,
    @Body() body: { ids: string[] },
  ) {
    const userId = this.getUserId(req);

    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      throw new HttpException("Invalid item IDs", HttpStatus.BAD_REQUEST);
    }

    const count = await this.feishuDataSourceService.deleteItems(
      userId,
      body.ids,
    );
    return { deletedCount: count };
  }

  /**
   * Manually add a URL
   */
  @Post("items")
  @ApiOperation({ summary: "Manually add a URL to Feishu data source" })
  @ApiResponse({ status: 201, description: "Item created successfully" })
  @ApiResponse({ status: 400, description: "Invalid URL or duplicate" })
  async addItem(
    @Req() req: AuthenticatedRequest,
    @Body() body: { url: string; title?: string; description?: string },
  ) {
    const userId = this.getUserId(req);

    if (!body.url) {
      throw new HttpException("URL is required", HttpStatus.BAD_REQUEST);
    }

    try {
      new URL(body.url);
    } catch {
      throw new HttpException("Invalid URL format", HttpStatus.BAD_REQUEST);
    }

    const exists = await this.feishuDataSourceService.urlExists(
      userId,
      body.url,
    );
    if (exists) {
      throw new HttpException("URL already exists", HttpStatus.CONFLICT);
    }

    try {
      const item = await this.feishuDataSourceService.createItem({
        userId,
        type: "EXTERNAL",
        title: body.title || body.url,
        sourceUrl: body.url,
        description: body.description,
        syncSource: "manual",
      });

      return item;
    } catch (error) {
      this.logger.error(`Failed to create item: ${error}`);
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to create item",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Sync item to RAG knowledge base
   */
  @Post("items/:id/sync-to-rag")
  @ApiOperation({ summary: "Sync a Feishu item to RAG knowledge base" })
  @ApiResponse({ status: 200, description: "Item synced to RAG" })
  async syncItemToRag(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() _body: { knowledgeBaseId?: string },
  ) {
    const userId = this.getUserId(req);
    const item = await this.feishuDataSourceService.getItem(userId, id);

    if (item.syncedToRag) {
      throw new HttpException(
        "Item is already synced to RAG",
        HttpStatus.BAD_REQUEST,
      );
    }

    // TODO: Implement actual RAG sync via FeishuImportService
    return {
      message: "Sync to RAG not yet implemented",
      item,
    };
  }

  // =========================================================================
  // Feishu Binding Endpoints
  // =========================================================================

  /**
   * Get current Feishu binding status
   */
  @Get("binding")
  @ApiOperation({ summary: "Get Feishu binding status" })
  @ApiResponse({ status: 200, description: "Returns binding status" })
  async getBinding(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    return this.feishuDataSourceService.getFeishuBinding(userId);
  }

  /**
   * Bind Feishu Open ID
   */
  @Patch("binding")
  @ApiOperation({ summary: "Bind Feishu Open ID" })
  @ApiResponse({ status: 200, description: "Binding successful" })
  @ApiResponse({ status: 400, description: "Invalid Feishu Open ID" })
  async bindFeishu(
    @Req() req: AuthenticatedRequest,
    @Body() body: { feishuOpenId: string },
  ) {
    const userId = this.getUserId(req);

    if (!body.feishuOpenId || body.feishuOpenId.trim() === "") {
      throw new HttpException(
        "Feishu Open ID is required",
        HttpStatus.BAD_REQUEST,
      );
    }

    const feishuOpenId = body.feishuOpenId.trim();

    try {
      const result = await this.feishuDataSourceService.bindFeishuOpenId(
        userId,
        feishuOpenId,
      );

      return {
        message: "Feishu account bound successfully",
        feishuOpenId: result.feishuOpenId,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("already bound to another")
      ) {
        throw new HttpException(error.message, HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  /**
   * Unbind Feishu Open ID
   */
  @Delete("binding")
  @ApiOperation({ summary: "Unbind Feishu Open ID" })
  @ApiResponse({ status: 200, description: "Unbinding successful" })
  async unbindFeishu(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    await this.feishuDataSourceService.unbindFeishuOpenId(userId);

    return { message: "Feishu account unbound successfully" };
  }
}
