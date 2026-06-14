-- Add EVENT value to ResearchTopicType enum
-- 事件洞察：基于新闻/线索深挖事件来龙去脉
ALTER TYPE "ResearchTopicType" ADD VALUE IF NOT EXISTS 'EVENT';
