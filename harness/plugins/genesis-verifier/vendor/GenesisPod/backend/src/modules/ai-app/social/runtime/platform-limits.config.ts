/**
 * 平台内容限制配置
 *
 * 定义各社交平台的标题、摘要、正文字数限制
 * 用于内容版本生成时的适配
 */

import { SocialPlatformType } from "../mission/types";

export interface PlatformLimits {
  maxTitle: number; // 标题最大字数
  maxDigest: number; // 摘要最大字数（0 表示不支持摘要）
  maxContent: number; // 正文最大字数（0 表示无限制）
}

/**
 * 各平台的内容字数限制
 */
export const PLATFORM_LIMITS: Record<SocialPlatformType, PlatformLimits> = {
  /**
   * 微信公众号
   * - 标题：64字节 ≈ 32汉字，保守取30
   * - 摘要：120字
   * - 正文：无明确限制
   */
  WECHAT_MP: {
    maxTitle: 30,
    maxDigest: 120,
    maxContent: 0, // 无限制
  },

  /**
   * 小红书
   * - 标题：20字
   * - 摘要：不支持
   * - 正文：1000字
   */
  XIAOHONGSHU: {
    maxTitle: 20,
    maxDigest: 0, // 不支持摘要
    maxContent: 1000,
  },
};

/**
 * 获取平台限制配置
 */
export function getPlatformLimits(
  platformType: SocialPlatformType,
): PlatformLimits {
  return PLATFORM_LIMITS[platformType];
}

/**
 * 检查内容是否超出平台限制
 */
export function checkContentLimits(
  platformType: SocialPlatformType,
  content: { title?: string; digest?: string; content?: string },
): {
  valid: boolean;
  errors: string[];
} {
  const limits = getPlatformLimits(platformType);
  const errors: string[] = [];

  if (content.title && content.title.length > limits.maxTitle) {
    errors.push(`标题超出限制：${content.title.length}/${limits.maxTitle} 字`);
  }

  if (limits.maxDigest > 0 && content.digest) {
    if (content.digest.length > limits.maxDigest) {
      errors.push(
        `摘要超出限制：${content.digest.length}/${limits.maxDigest} 字`,
      );
    }
  }

  if (limits.maxContent > 0 && content.content) {
    if (content.content.length > limits.maxContent) {
      errors.push(
        `正文超出限制：${content.content.length}/${limits.maxContent} 字`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
