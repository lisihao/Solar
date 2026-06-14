'use client';

/**
 * MissionReferencesTab — mission 详情「参考文献 / 来源」canonical tab 内容（标准 21 P1.5）
 *
 * 所有 agent-team mission feature（research / insights / teams / social…）的参考文献 tab
 * 统一用此组件，复用 canonical `CitationListItem` + `EmptyState`，feature 只需把自己的
 * 引用映射成 `MissionReference[]`（数据适配），不再各写一套来源行。
 */

import { cn } from '@/lib/utils/common';
import { EmptyState } from '@/components/ui/states';
import { CitationListItem } from '@/components/common/citations';

export interface MissionReference {
  id?: string;
  title: string;
  url?: string;
  description?: string;
  domain?: string;
  sourceType?: string;
  publishedAt?: string;
}

export interface MissionReferencesTabProps {
  /** 结构化引用（feature 从 view-model 适配） */
  references?: MissionReference[];
  /** 仅有纯 URL 列表时的降级来源 */
  fallbackUrls?: string[];
  /** hover 强调色（业务主题色，默认中性灰；如 'hover:border-violet-300'） */
  accentClass?: string;
  /** 空态提示文案 */
  emptyHint?: string;
  className?: string;
}

function refMeta(ref: MissionReference) {
  const parts = [ref.sourceType, ref.domain, ref.publishedAt].filter(Boolean);
  if (parts.length === 0) return undefined;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </>
  );
}

export function MissionReferencesTab({
  references,
  fallbackUrls,
  accentClass,
  emptyHint = '本次任务暂无参考来源',
  className,
}: MissionReferencesTabProps) {
  const items: MissionReference[] =
    references && references.length > 0
      ? references
      : (fallbackUrls ?? []).map((url) => {
          let domain = url;
          try {
            domain = new URL(url).hostname;
          } catch {
            /* 非法 URL → 原样当标题 */
          }
          return { url, title: domain };
        });

  if (items.length === 0) {
    return <EmptyState title="暂无参考文献" description={emptyHint} />;
  }

  return (
    <div className={cn('space-y-2', className)}>
      {items.map((ref, i) => (
        <CitationListItem
          key={ref.id ?? ref.url ?? i}
          index={i + 1}
          title={ref.title}
          href={ref.url}
          description={ref.description}
          meta={refMeta(ref)}
          accentClass={accentClass}
        />
      ))}
    </div>
  );
}
