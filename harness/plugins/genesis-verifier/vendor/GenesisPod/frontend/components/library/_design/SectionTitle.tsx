import type { LucideIcon } from 'lucide-react';

interface SectionTitleProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  count?: number;
  action?: React.ReactNode;
}

/**
 * Library 内部分组标题（用于"我的内容 / 外部连接 / 可添加"等分段）
 */
export default function SectionTitle({
  icon: Icon,
  title,
  description,
  count,
  action,
}: SectionTitleProps) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-gray-500" />}
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
            {title}
          </h3>
          {typeof count === 'number' && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
              {count}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-1 text-xs text-gray-500">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
