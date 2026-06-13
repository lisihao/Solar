/**
 * SettingsSectionCard
 *
 * 设置/资料/通知偏好等页面的标准 section card：
 *   `<div class="rounded-lg border border-gray-200 bg-white p-6"><h2>title</h2>children</div>`
 *
 * 替换 profile/page.tsx + settings/notifications/page.tsx 等 11+ 处自写。
 * 配套规则 R2-AssetCard-Required（scripts/utils/audit-ui-discipline.ts）。
 */
import type { ElementType, ReactNode } from 'react';

type SettingsSectionCardVariant = 'gray' | 'slate';

export interface SettingsSectionCardProps {
  /** 标题；与 `header` 二选一。若提供 `header` 则忽略 title/description/icon */
  title?: ReactNode;
  /** 副标题（title 下方一行小灰字），允许 ReactNode 以支持 inline 标记 */
  description?: ReactNode;
  /** 标题左侧的图标方块（line 1065 Notion 用法） */
  icon?: ReactNode;
  /** 标题右侧的 action 按钮 */
  action?: ReactNode;
  /** 完全自定义 header（escape hatch；提供后忽略 title/description/icon/action） */
  header?: ReactNode;
  /** 内容 */
  children: ReactNode;
  /** 外层额外 className（如需调整 spacing） */
  className?: string;
  /** 容器标签；默认 'div'。settings/notifications 用 'section' */
  as?: Extract<ElementType, 'div' | 'section'>;
  /** 边框颜色变体；默认 gray-200。notifications 用 slate-200 */
  variant?: SettingsSectionCardVariant;
}

const VARIANT_BORDER: Record<SettingsSectionCardVariant, string> = {
  gray: 'border-gray-200',
  slate: 'border-slate-200',
};

export function SettingsSectionCard({
  title,
  description,
  icon,
  action,
  header,
  children,
  className,
  as: Tag = 'div',
  variant = 'gray',
}: SettingsSectionCardProps) {
  const borderClass = VARIANT_BORDER[variant];
  const containerClass = `rounded-lg border ${borderClass} bg-white p-6${
    className ? ` ${className}` : ''
  }`;

  const renderedHeader =
    header ??
    (title || icon ? (
      <div
        className={`flex ${
          icon ? 'items-center gap-3' : 'items-start justify-between'
        } ${description ? 'mb-6' : 'mb-4'}`}
      >
        {icon ? <div className="shrink-0">{icon}</div> : null}
        <div className={`flex-1${icon ? '' : ' min-w-0'}`}>
          {title ? (
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          ) : null}
          {description ? (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    ) : null);

  return (
    <Tag className={containerClass}>
      {renderedHeader}
      {children}
    </Tag>
  );
}
