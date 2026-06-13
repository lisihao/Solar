'use client';

import { getProviderBrand } from '@/lib/constants/ai-provider-logos';

interface ModelBadgeProps {
  modelId: string;
  displayName?: string;
  /** 样式变体 */
  variant?: 'default' | 'compact' | 'subtle';
  className?: string;
}

/**
 * 模型标识徽章 — 显示 AI 模型图标 + 名称
 * 自动通过 getProviderBrand 解析图标
 */
export function ModelBadge({
  modelId,
  displayName,
  variant = 'default',
  className,
}: ModelBadgeProps) {
  const label = displayName || modelId;
  const brand = getProviderBrand(label);

  const variantStyles = {
    default:
      'inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-600',
    compact:
      'inline-flex items-center gap-1 font-mono text-xs font-medium text-indigo-700',
    subtle:
      'inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500',
  };

  return (
    <span
      className={`${variantStyles[variant]} ${className || ''}`}
      title={displayName ? `${displayName} (${modelId})` : modelId}
    >
      {brand.logo && (
        <img
          src={brand.logo}
          alt={brand.name}
          className={
            variant === 'compact' ? 'h-3.5 w-3.5' : 'h-3 w-3 flex-shrink-0'
          }
        />
      )}
      <span className={variant === 'default' ? 'truncate' : undefined}>
        {label}
      </span>
    </span>
  );
}
