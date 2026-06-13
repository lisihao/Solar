/**
 * 小红书 MCP 适配器
 *
 * 使用 xhs-toolkit MCP 实现小红书发布功能
 * 支持完整的图文笔记发布流程
 */

import { Injectable, Logger } from "@nestjs/common";
import { MCPClientService } from "../../runtime/mcp-client.service";
import {
  SessionData,
  PublishResult,
  PublishOptions,
  IPlatformAdapter,
  LoginSession,
  LoginStatusResult,
  SessionValidationResult,
  DraftResult,
  AnalyticsData,
} from "../../mission/types/platform.types";
import { SocialContent, SocialPlatformType } from "../../mission/types";

// xhs-toolkit MCP 工具名称
const XHS_TOOLS = {
  // 认证相关
  GET_QR_CODE: "xhs_get_qr_code",
  CHECK_LOGIN: "xhs_check_login",
  GET_USER_INFO: "xhs_get_user_info",

  // 内容发布
  CREATE_NOTE: "xhs_create_note",
  CREATE_VIDEO_NOTE: "xhs_create_video_note",
  UPLOAD_IMAGE: "xhs_upload_image",
  UPLOAD_VIDEO: "xhs_upload_video",

  // 草稿管理
  SAVE_DRAFT: "xhs_save_draft",
  GET_DRAFTS: "xhs_get_drafts",
  DELETE_DRAFT: "xhs_delete_draft",

  // 笔记管理
  GET_NOTES: "xhs_get_notes",
  DELETE_NOTE: "xhs_delete_note",
  GET_NOTE_STATS: "xhs_get_note_stats",
};

interface XHSNoteContent {
  title: string;
  content: string;
  images: string[]; // 图片 URL 或本地路径
  tags?: string[];
  location?: string;
  atUsers?: string[];
}

@Injectable()
export class XhsMcpAdapter implements IPlatformAdapter {
  private readonly logger = new Logger(XhsMcpAdapter.name);

  readonly platformType = SocialPlatformType.XIAOHONGSHU;
  readonly name = "小红书 (xhs-toolkit MCP)";
  readonly supportsMcp = true;

  private readonly MCP_SERVER_ID = "xhs-toolkit";

  constructor(private readonly mcpClient: MCPClientService) {}

  /**
   * 初始化登录（获取二维码）
   */
  async initLogin(): Promise<LoginSession> {
    try {
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.GET_QR_CODE,
        {},
      );

      if (!result.success) {
        return {
          sessionKey: "",
          expiresAt: new Date(),
          status: "expired",
        };
      }

      const data = result.data as { qrCodeUrl: string; sessionKey: string };
      return {
        sessionKey: data.sessionKey,
        qrCodeUrl: data.qrCodeUrl,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
        status: "pending",
      };
    } catch (error) {
      this.logger.error(`Init login failed: ${(error as Error).message}`);
      return {
        sessionKey: "",
        expiresAt: new Date(),
        status: "expired",
      };
    }
  }

  /**
   * 检查登录状态
   */
  async checkLoginStatus(sessionKey: string): Promise<LoginStatusResult> {
    try {
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.CHECK_LOGIN,
        { sessionKey },
      );

      if (!result.success) {
        return {
          loggedIn: false,
        };
      }

      const data = result.data as {
        loggedIn: boolean;
        cookies?: Array<{
          name: string;
          value: string;
          domain: string;
          path: string;
          expires: number;
          httpOnly: boolean;
          secure: boolean;
        }>;
        userInfo?: {
          userId: string;
          nickname: string;
          avatar: string;
        };
      };

      if (data.loggedIn) {
        return {
          loggedIn: true,
          sessionData: data.cookies
            ? {
                cookies: data.cookies,
                localStorage: {},
              }
            : undefined,
          accountName: data.userInfo?.nickname,
          accountId: data.userInfo?.userId,
          avatarUrl: data.userInfo?.avatar,
        };
      }

      return {
        loggedIn: false,
      };
    } catch (error) {
      this.logger.error(`Check login failed: ${(error as Error).message}`);
      return {
        loggedIn: false,
      };
    }
  }

  /**
   * 验证会话有效性
   */
  async validateSession(
    sessionData: SessionData,
  ): Promise<SessionValidationResult> {
    try {
      // 使用 MCP 工具检查登录状态
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.GET_USER_INFO,
        { cookies: sessionData.cookies },
      );

      if (result.success) {
        return { valid: true };
      }

      return {
        valid: false,
        reason: result.error || "会话已过期",
      };
    } catch (error) {
      return {
        valid: false,
        reason: (error as Error).message,
      };
    }
  }

  /**
   * 刷新会话
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async refreshSession(_sessionData: SessionData): Promise<SessionData | null> {
    // 小红书不支持会话刷新，返回 null 表示需要重新登录
    return null;
  }

  /**
   * 发布笔记
   */
  async publish(
    content: SocialContent,
    sessionData: SessionData,
    options: PublishOptions,
  ): Promise<PublishResult> {
    try {
      // 验证会话
      const sessionValid = await this.validateSession(sessionData);
      if (!sessionValid.valid) {
        return {
          success: false,
          type: options.mode === "draft" ? "draft" : "published",
          errorMessage: sessionValid.reason || "会话已过期，请重新登录",
        };
      }

      // 上传图片
      const uploadedImages: string[] = [];
      if (content.images && content.images.length > 0) {
        for (const imageUrl of content.images) {
          const uploadResult = await this.uploadImage(imageUrl, sessionData);
          if (uploadResult.success && uploadResult.imageId) {
            uploadedImages.push(uploadResult.imageId);
          } else {
            this.logger.warn(`Failed to upload image: ${imageUrl}`);
          }
        }
      }

      // 准备笔记内容
      const noteContent: XHSNoteContent = {
        title: content.title,
        content: content.content,
        images: uploadedImages,
        tags: content.tags || undefined,
        location: content.location || undefined,
      };

      // 根据模式选择操作
      if (options.mode === "draft") {
        const draftResult = await this.saveDraft(content, sessionData);
        return {
          success: draftResult.success,
          type: "draft",
          externalId: draftResult.draftId,
          externalUrl: draftResult.draftUrl,
          errorMessage: draftResult.error,
        };
      }

      // 发布笔记
      const result = await this.createNote(noteContent, sessionData);

      return result;
    } catch (error) {
      this.logger.error(`Publish failed: ${(error as Error).message}`);
      return {
        success: false,
        type: options.mode === "draft" ? "draft" : "published",
        errorMessage: (error as Error).message,
      };
    }
  }

  /**
   * 保存草稿
   */
  async saveDraft(
    content: SocialContent,
    sessionData: SessionData,
  ): Promise<DraftResult> {
    try {
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.SAVE_DRAFT,
        {
          title: content.title,
          content: content.content,
          images: content.images || [],
          tags: content.tags || [],
          cookies: sessionData.cookies,
        },
      );

      if (result.success) {
        const data = result.data as { draftId: string };
        return {
          success: true,
          draftId: data.draftId,
        };
      }

      return {
        success: false,
        error: result.error || "保存草稿失败",
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * 上传图片
   */
  private async uploadImage(
    imageUrl: string,
    sessionData: SessionData,
  ): Promise<{ success: boolean; imageId?: string; error?: string }> {
    try {
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.UPLOAD_IMAGE,
        {
          imageUrl,
          cookies: sessionData.cookies,
        },
      );

      if (result.success) {
        const data = result.data as { imageId: string };
        return { success: true, imageId: data.imageId };
      }

      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 创建笔记
   */
  private async createNote(
    content: XHSNoteContent,
    sessionData: SessionData,
  ): Promise<PublishResult> {
    try {
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.CREATE_NOTE,
        {
          title: content.title,
          content: content.content,
          images: content.images,
          tags: content.tags,
          location: content.location,
          atUsers: content.atUsers,
          cookies: sessionData.cookies,
        },
      );

      if (result.success) {
        const data = result.data as { noteId: string; noteUrl: string };
        return {
          success: true,
          type: "published",
          externalId: data.noteId,
          externalUrl: data.noteUrl,
        };
      }

      return {
        success: false,
        type: "published",
        errorMessage: result.error || "发布笔记失败",
      };
    } catch (error) {
      return {
        success: false,
        type: "published",
        errorMessage: (error as Error).message,
      };
    }
  }

  /**
   * 获取数据分析
   */
  async getAnalytics(sessionData: SessionData): Promise<AnalyticsData> {
    try {
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.GET_USER_INFO,
        { cookies: sessionData.cookies },
      );

      if (result.success) {
        const data = result.data as {
          followers?: number;
          likes?: number;
          notes?: number;
        };
        return {
          followers: data.followers,
          likes: data.likes,
          notes: data.notes,
          lastUpdated: new Date(),
        };
      }

      return {};
    } catch {
      return {};
    }
  }

  /**
   * 获取笔记列表
   */
  async getNotes(
    sessionData: SessionData,
    options?: { page?: number; limit?: number },
  ): Promise<{ success: boolean; notes?: unknown[]; error?: string }> {
    try {
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.GET_NOTES,
        {
          cookies: sessionData.cookies,
          page: options?.page || 1,
          limit: options?.limit || 20,
        },
      );

      if (result.success) {
        const data = result.data as { notes: unknown[] };
        return { success: true, notes: data.notes };
      }

      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 获取笔记统计
   */
  async getNoteStats(
    noteId: string,
    sessionData: SessionData,
  ): Promise<{
    success: boolean;
    stats?: { views: number; likes: number; comments: number; shares: number };
    error?: string;
  }> {
    try {
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.GET_NOTE_STATS,
        {
          noteId,
          cookies: sessionData.cookies,
        },
      );

      if (result.success) {
        const data = result.data as {
          views: number;
          likes: number;
          comments: number;
          shares: number;
        };
        return { success: true, stats: data };
      }

      return { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 删除笔记
   */
  async deleteNote(
    noteId: string,
    sessionData: SessionData,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.mcpClient.callTool(
        this.MCP_SERVER_ID,
        XHS_TOOLS.DELETE_NOTE,
        {
          noteId,
          cookies: sessionData.cookies,
        },
      );

      return {
        success: result.success,
        error: result.success ? undefined : result.error,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 检查 MCP 服务器是否可用
   */
  isAvailable(): boolean {
    return this.mcpClient.isServerAvailable(this.MCP_SERVER_ID);
  }
}
