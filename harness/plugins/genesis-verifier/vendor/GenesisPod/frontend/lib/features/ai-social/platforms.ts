/**
 * AI Social Platform Configuration
 *
 * Shared configuration for social media platforms
 * Used across all AI Social components for consistency
 */

import { LucideIcon } from 'lucide-react';

// Platform types matching backend
export type SocialPlatformType = 'WECHAT_MP' | 'XIAOHONGSHU';

// Content types matching backend
export type SocialContentType = 'WECHAT_ARTICLE' | 'XIAOHONGSHU_NOTE';

/**
 * Platform visual configuration
 */
export interface PlatformConfig {
  name: string;
  i18nKey: string;
  color: string;
  bgColor: string;
  gradient: string;
  bgGradient: string;
  icon?: string;
  letter: string;
}

/**
 * Platform configurations
 */
export const PLATFORM_CONFIGS: Record<SocialPlatformType, PlatformConfig> = {
  WECHAT_MP: {
    name: 'WeChat MP',
    i18nKey: 'aiSocial.platforms.wechat_mp',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    gradient: 'from-green-500 to-emerald-600',
    bgGradient: 'from-green-50 to-emerald-50',
    icon: '/icons/wechat.svg',
    letter: 'W',
  },
  XIAOHONGSHU: {
    name: 'Xiaohongshu',
    i18nKey: 'aiSocial.platforms.xiaohongshu',
    color: 'text-red-500',
    bgColor: 'bg-red-50',
    gradient: 'from-red-500 to-rose-600',
    bgGradient: 'from-red-50 to-rose-50',
    icon: '/icons/xiaohongshu.svg',
    letter: 'X',
  },
};

/**
 * Content type to platform mapping
 */
export const CONTENT_TYPE_TO_PLATFORM: Record<
  SocialContentType,
  SocialPlatformType
> = {
  WECHAT_ARTICLE: 'WECHAT_MP',
  XIAOHONGSHU_NOTE: 'XIAOHONGSHU',
};

/**
 * Platform to content type mapping
 */
export const PLATFORM_TO_CONTENT_TYPE: Record<
  SocialPlatformType,
  SocialContentType
> = {
  WECHAT_MP: 'WECHAT_ARTICLE',
  XIAOHONGSHU: 'XIAOHONGSHU_NOTE',
};

/**
 * Content type configuration for editor
 */
export interface ContentTypeConfig {
  showDigest: boolean;
  maxTitleLength: number;
  maxDigestLength: number;
  gradient: string;
  bgGradient: string;
}

/**
 * Content type configurations for editor
 */
export const CONTENT_TYPE_CONFIGS: Record<
  SocialContentType,
  ContentTypeConfig
> = {
  WECHAT_ARTICLE: {
    showDigest: true,
    maxTitleLength: 64,
    maxDigestLength: 120,
    gradient: 'from-green-500 to-emerald-600',
    bgGradient: 'from-green-50 to-emerald-50',
  },
  XIAOHONGSHU_NOTE: {
    showDigest: false,
    maxTitleLength: 20,
    maxDigestLength: 0,
    gradient: 'from-red-500 to-rose-600',
    bgGradient: 'from-red-50 to-rose-50',
  },
};

/**
 * Get platform config by type
 */
export function getPlatformConfig(
  platformType: SocialPlatformType
): PlatformConfig {
  return PLATFORM_CONFIGS[platformType];
}

/**
 * Get content type config by type
 */
export function getContentTypeConfig(
  contentType: SocialContentType
): ContentTypeConfig {
  return CONTENT_TYPE_CONFIGS[contentType];
}

/**
 * Get platform from content type
 */
export function getPlatformFromContentType(
  contentType: SocialContentType
): SocialPlatformType {
  return CONTENT_TYPE_TO_PLATFORM[contentType];
}

/**
 * Get content type from platform
 */
export function getContentTypeFromPlatform(
  platformType: SocialPlatformType
): SocialContentType {
  return PLATFORM_TO_CONTENT_TYPE[platformType];
}
