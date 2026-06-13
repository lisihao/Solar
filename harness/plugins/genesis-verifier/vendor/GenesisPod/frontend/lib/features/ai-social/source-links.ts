/**
 * social 参考来源 → 中文类型标签 + 站内跳转路由。
 *
 * 参考文献 tab 用：内部来源（AI_EXPLORE / 话题洞察 / 研究 / 写作 / 实验场）能拼出
 * 站内详情链接；外部来源走 source.url 外链。两者都没有时不渲染链接。
 *
 * 路由均为已存在的动态路由段（见 frontend/app/**），新增来源类型时在此补映射，
 * 不要在 feature 代码里散落硬编码路径。
 */

/** 来源类型 → 中文标签（参考文献按类型聚合展示，不露 UUID / 大写枚举）*/
export const SOURCE_TYPE_LABEL: Record<string, string> = {
  // 通用 / 外部
  BOOKMARK: '书签',
  NOTE: '笔记',
  RESOURCE: '资源',
  WECHAT_ARTICLE: '微信文章',
  YOUTUBE: 'YouTube',
  URL: '外部链接',
  EXTERNAL: '外部链接',
  // 站内 AI 模块来源
  AI_EXPLORE: 'AI 探索',
  AI_LIBRARY: '知识库',
  AI_TOPIC_INSIGHTS: '话题洞察',
  AI_RESEARCH: 'AI 研究',
  AI_WRITING: 'AI 写作',
  AI_OFFICE: 'AI 文档',
  AGENT_PLAYGROUND: 'Agent 实验场',
};

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_TYPE_LABEL[sourceType] ?? sourceType;
}

/** 部分来源 id 带前缀（如 AI_LIBRARY 的 note::{id} / kbdoc::{id}）——拆出真实 id */
function stripIdPrefix(sourceId: string): { kind?: string; id: string } {
  const i = sourceId.indexOf('::');
  if (i >= 0) return { kind: sourceId.slice(0, i), id: sourceId.slice(i + 2) };
  return { id: sourceId };
}

/**
 * 由来源类型 + id 推导站内详情路由；无对应站内页时返回 null（调用方再退回外链）。
 */
export function internalSourceRoute(
  sourceType: string,
  sourceId: string
): string | null {
  const { id } = stripIdPrefix(sourceId);
  if (!id) return null;
  switch (sourceType) {
    case 'AI_EXPLORE':
      return `/explore/resource/${id}`;
    case 'AI_TOPIC_INSIGHTS':
      return `/ai-insights/topic/${id}`;
    case 'AI_RESEARCH':
      return `/ai-research/${id}`;
    case 'AI_WRITING':
      return `/ai-writing/${id}`;
    case 'AGENT_PLAYGROUND':
      return `/agent-playground/team/${id}`;
    default:
      return null;
  }
}
