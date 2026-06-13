-- Add new enum values to KnowledgeBaseSourceType for WeChat content
-- WECHAT_ARTICLE: WeChat Official Account articles (mp.weixin.qq.com)
-- WECHAT_VIDEO: WeChat Video Channel videos (channels.weixin.qq.com)

-- Add WECHAT_ARTICLE to KnowledgeBaseSourceType enum
ALTER TYPE "KnowledgeBaseSourceType" ADD VALUE IF NOT EXISTS 'WECHAT_ARTICLE';

-- Add WECHAT_VIDEO to KnowledgeBaseSourceType enum
ALTER TYPE "KnowledgeBaseSourceType" ADD VALUE IF NOT EXISTS 'WECHAT_VIDEO';
