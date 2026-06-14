/**
 * Typography 设计令牌
 *
 * 全站字号统一标尺。废弃 text-[10px] / text-[11px]（< 12px 无障碍不达标），
 * Tailwind 标准 6 档：xs(12) / sm(14) / base(16) / lg(18) / xl(20) / 2xl(24)。
 *
 * 使用语义 token（type.h1 / type.body）而非裸 text-sm，方便后续整体微调。
 *
 * ─────────────────────────────────────────────────────────────
 *  语义          class                           px        场景
 * ─────────────────────────────────────────────────────────────
 *  type.h1       text-xl md:text-2xl font-semibold   20→24   页面主标题
 *  type.h2       text-base font-semibold             16      卡片 / section 标题
 *  type.h3       text-sm font-semibold               14      子卡 / 小标题
 *  type.body     text-sm                             14      DEFAULT 正文 / 列表项
 *  type.bodySm   text-xs                             12      元信息 / dl-value / 辅助
 *  type.button   text-sm font-medium                 14      按钮文字
 *  type.link     text-sm                             14      链接（与 body 对齐）
 *  type.linkSm   text-xs                             12      次级链接 / 面包屑
 *  type.caption  text-xs text-gray-500               12      说明 / hint
 *  type.code     text-xs font-mono                   12      代码 / identifier
 * ─────────────────────────────────────────────────────────────
 *
 * 禁用规则（项目硬约束）：
 *   - text-[9px] / text-[10px] / text-[11px] —— 太小，违 WCAG SC 1.4.4
 *   - text-[7-15px] 等任意 px —— 不走 token 不通过 review
 *   - 用 text-xs 替代任何 < 12px 的需求
 */

export const type = {
  h1: 'text-xl font-semibold md:text-2xl',
  h2: 'text-base font-semibold',
  h3: 'text-sm font-semibold',
  body: 'text-sm',
  bodySm: 'text-xs',
  button: 'text-sm font-medium',
  link: 'text-sm',
  linkSm: 'text-xs',
  caption: 'text-xs text-gray-500',
  code: 'text-xs font-mono',
} as const;

export type TypeToken = keyof typeof type;
