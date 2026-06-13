/**
 * XhsMcpFacadeService — 小红书 MCP 功能瘦门面
 *
 * 拆自 AiSocialService（god class 减重 phase 2.A.2，2026-05-27）。
 * 6 个方法全是对 XhsMcpAdapter 的薄包装：登录状态 / Feed 列表 / 搜索 / 详情 /
 * 评论 / 用户档案。原始数据通路保留，便于 controller 与 facade-level rate limit、
 * tracing 之后增强。连接管理类方法（init/verify）留在 SocialConnectionsService。
 */

import { Injectable } from "@nestjs/common";
import { XhsMcpAdapter } from "../../integrations/xiaohongshu/xiaohongshu.adapter";
import type {
  XhsFeed,
  XhsFeedDetail,
  XhsUserProfile,
} from "../../integrations/xiaohongshu/xiaohongshu.adapter";

@Injectable()
export class XhsMcpFacadeService {
  constructor(private readonly xhsMcpAdapter: XhsMcpAdapter) {}

  async getLoginStatus() {
    return this.xhsMcpAdapter.checkLoginStatus();
  }

  async listFeeds(): Promise<XhsFeed[]> {
    return this.xhsMcpAdapter.listFeeds();
  }

  async searchFeeds(keyword: string): Promise<XhsFeed[]> {
    return this.xhsMcpAdapter.searchFeeds(keyword);
  }

  async getFeedDetail(
    feedId: string,
    xsecToken: string,
  ): Promise<XhsFeedDetail | null> {
    return this.xhsMcpAdapter.getFeedDetail(feedId, xsecToken);
  }

  async postComment(
    feedId: string,
    xsecToken: string,
    content: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.xhsMcpAdapter.postComment(feedId, xsecToken, content);
  }

  async getUserProfile(
    userId: string,
    xsecToken: string,
  ): Promise<XhsUserProfile | null> {
    return this.xhsMcpAdapter.getUserProfile(userId, xsecToken);
  }
}
