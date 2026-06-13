/**
 * 平台配置
 */

import { SocialPlatformType } from "../mission/types";
import {
  RateLimitConfig,
  MCPServerConfig,
} from "../mission/types/platform.types";

// ==================== 平台基础配置 ====================

export interface PlatformConfig {
  type: SocialPlatformType;
  name: string;
  loginUrl: string;
  homeUrl: string;
  editorUrl?: string;
  loginSuccessIndicators: string[];
  needClickLogin: boolean;
  supportsMcp: boolean;
  mcpServerId?: string;
}

export const PLATFORM_CONFIGS: Record<SocialPlatformType, PlatformConfig> = {
  [SocialPlatformType.WECHAT_MP]: {
    type: SocialPlatformType.WECHAT_MP,
    name: "微信公众号",
    loginUrl: "https://mp.weixin.qq.com/",
    homeUrl: "https://mp.weixin.qq.com/cgi-bin/home",
    editorUrl:
      "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit",
    loginSuccessIndicators: [
      ".weui-desktop-account__nickname",
      ".weui-desktop-account__info",
      ".new-creation",
    ],
    needClickLogin: false,
    supportsMcp: false, // 微信暂不使用 MCP，使用 Playwright
  },
  [SocialPlatformType.XIAOHONGSHU]: {
    type: SocialPlatformType.XIAOHONGSHU,
    name: "小红书",
    loginUrl: "https://creator.xiaohongshu.com/login",
    homeUrl: "https://creator.xiaohongshu.com/creator/home",
    editorUrl: "https://creator.xiaohongshu.com/publish/publish",
    loginSuccessIndicators: [
      ".user-info",
      ".user-name",
      ".creator-header",
      '[class*="avatar"]',
    ],
    needClickLogin: true,
    supportsMcp: true,
    mcpServerId: "xiaohongshu-mcp",
  },
};

// ==================== 频率限制配置 ====================

export const RATE_LIMIT_CONFIGS: Record<SocialPlatformType, RateLimitConfig> = {
  [SocialPlatformType.WECHAT_MP]: {
    maxPerDay: 1, // 订阅号每天1次群发
    maxPerHour: 1,
    minIntervalMinutes: 0,
    cooldownAfterFailure: 30,
  },
  [SocialPlatformType.XIAOHONGSHU]: {
    maxPerDay: 3, // 建议每天不超过3篇
    maxPerHour: 1,
    minIntervalMinutes: 240, // 间隔4小时
    cooldownAfterFailure: 60,
  },
};

// ==================== MCP 服务器配置 ====================

export const MCP_SERVER_CONFIGS: MCPServerConfig[] = [
  // Only register xiaohongshu MCP when XHS_MCP_URL is explicitly set
  ...(process.env.XHS_MCP_URL
    ? [
        {
          id: "xiaohongshu-mcp",
          name: "小红书 MCP (xpzouying/xiaohongshu-mcp)",
          transport: "http" as const,
          url: process.env.XHS_MCP_URL,
          autoReconnect: true,
          timeout: 30000,
          healthCheckInterval: 60000,
          restartOnFailure: false,
        },
      ]
    : []),
];

// ==================== Cookie 配置 ====================

export const WECHAT_REQUIRED_COOKIES = [
  "slave_user",
  "slave_sid",
  "bizuin",
  "data_bizuin",
  "data_ticket",
];

// ==================== 超时配置 ====================

export const TIMEOUT_CONFIG = {
  loginWait: 300000, // 5分钟等待扫码
  pageLoad: 30000, // 30秒页面加载
  elementWait: 10000, // 10秒元素等待
  apiResponse: 15000, // 15秒 API 响应
  publishComplete: 60000, // 60秒发布完成
};

// ==================== 重试配置 ====================

export const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelay: 5000, // 5秒
  maxDelay: 60000, // 60秒
  backoffMultiplier: 2,
};
