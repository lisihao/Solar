import { Injectable, Logger } from "@nestjs/common";
import { MCPClientService } from "../../runtime/mcp-client.service";
import { MCPToolResult } from "../../mission/types/platform.types";

// ==================== XHS MCP 类型 ====================

export interface XhsLoginStatus {
  loggedIn: boolean;
  nickname?: string;
  userId?: string;
}

export interface XhsFeed {
  id: string;
  title: string;
  desc?: string;
  type?: string;
  likes?: number;
  comments?: number;
  user?: {
    nickname: string;
    userId: string;
  };
  xsecToken?: string;
  coverUrl?: string;
}

export interface XhsFeedDetail {
  id: string;
  title: string;
  desc: string;
  type?: string;
  likes?: number;
  comments?: number;
  collects?: number;
  shares?: number;
  user?: {
    nickname: string;
    userId: string;
  };
  images?: string[];
  tags?: string[];
  createTime?: string;
  commentList?: Array<{
    id: string;
    content: string;
    user: { nickname: string; userId: string };
    createTime: string;
    likes?: number;
  }>;
}

export interface XhsUserProfile {
  userId: string;
  nickname: string;
  avatar?: string;
  desc?: string;
  gender?: string;
  ipLocation?: string;
  follows?: number;
  fans?: number;
  interaction?: number;
  notes?: XhsFeed[];
}

// ==================== XHS MCP 适配器 ====================

@Injectable()
export class XhsMcpAdapter {
  private readonly logger = new Logger(XhsMcpAdapter.name);
  private readonly MCP_SERVER_ID = "xiaohongshu-mcp";

  constructor(private readonly mcpClient: MCPClientService) {}

  /**
   * 检查 MCP 服务是否可用
   */
  isAvailable(): boolean {
    return this.mcpClient.isServerAvailable(this.MCP_SERVER_ID);
  }

  /**
   * 检查小红书登录状态
   */
  async checkLoginStatus(): Promise<XhsLoginStatus> {
    const result = await this.callMcpTool("check_login_status", {});

    if (!result.success) {
      this.logger.warn(`Login status check failed: ${result.error}`);
      return { loggedIn: false };
    }

    const data = result.data as Record<string, unknown>;
    return {
      loggedIn: Boolean(data?.loggedIn ?? data?.logged_in ?? false),
      nickname: (data?.nickname as string) || undefined,
      userId:
        (data?.userId as string) || (data?.user_id as string) || undefined,
    };
  }

  /**
   * 发布图文内容
   */
  async publishContent(content: {
    title: string;
    content: string;
    images?: string[];
  }): Promise<{ success: boolean; noteId?: string; error?: string }> {
    const result = await this.callMcpTool("publish_content", {
      title: content.title,
      content: content.content,
      images: content.images || [],
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const data = result.data as Record<string, unknown>;
    return {
      success: true,
      noteId:
        (data?.noteId as string) || (data?.note_id as string) || undefined,
    };
  }

  /**
   * 发布视频内容
   */
  async publishVideo(content: {
    title: string;
    content: string;
    videoPath: string;
  }): Promise<{ success: boolean; noteId?: string; error?: string }> {
    const result = await this.callMcpTool("publish_with_video", {
      title: content.title,
      content: content.content,
      video: content.videoPath,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const data = result.data as Record<string, unknown>;
    return {
      success: true,
      noteId:
        (data?.noteId as string) || (data?.note_id as string) || undefined,
    };
  }

  /**
   * 获取首页推荐
   */
  async listFeeds(): Promise<XhsFeed[]> {
    const result = await this.callMcpTool("list_feeds", {});

    if (!result.success) {
      this.logger.warn(`List feeds failed: ${result.error}`);
      return [];
    }

    const data = result.data as Record<string, unknown>;
    return (data?.feeds as XhsFeed[]) || (data as unknown as XhsFeed[]) || [];
  }

  /**
   * 搜索内容
   */
  async searchFeeds(keyword: string): Promise<XhsFeed[]> {
    const result = await this.callMcpTool("search_feeds", { keyword });

    if (!result.success) {
      this.logger.warn(`Search feeds failed: ${result.error}`);
      return [];
    }

    const data = result.data as Record<string, unknown>;
    return (data?.feeds as XhsFeed[]) || (data as unknown as XhsFeed[]) || [];
  }

  /**
   * 获取帖子详情
   */
  async getFeedDetail(
    feedId: string,
    xsecToken: string,
  ): Promise<XhsFeedDetail | null> {
    const result = await this.callMcpTool("get_feed_detail", {
      feed_id: feedId,
      xsec_token: xsecToken,
    });

    if (!result.success) {
      this.logger.warn(`Get feed detail failed: ${result.error}`);
      return null;
    }

    return (result.data as XhsFeedDetail) || null;
  }

  /**
   * 发表评论
   */
  async postComment(
    feedId: string,
    xsecToken: string,
    content: string,
  ): Promise<{ success: boolean; error?: string }> {
    const result = await this.callMcpTool("post_comment_to_feed", {
      feed_id: feedId,
      xsec_token: xsecToken,
      content,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true };
  }

  /**
   * 获取用户主页
   */
  async getUserProfile(
    userId: string,
    xsecToken: string,
  ): Promise<XhsUserProfile | null> {
    const result = await this.callMcpTool("user_profile", {
      user_id: userId,
      xsec_token: xsecToken,
    });

    if (!result.success) {
      this.logger.warn(`Get user profile failed: ${result.error}`);
      return null;
    }

    return (result.data as XhsUserProfile) || null;
  }

  /**
   * 统一 MCP 工具调用
   */
  private async callMcpTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    try {
      return await this.mcpClient.callTool(this.MCP_SERVER_ID, toolName, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `MCP tool call failed [${toolName}]: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { success: false, error: message };
    }
  }
}
