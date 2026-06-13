'use client';

/**
 * BriefingCardConnected —— FC-4 + P1-D 连线版包装
 *
 * 在 BriefingCard 外层挂载：
 *   - useNarrativeThread(signal.narrativeId) → 拉 episodes 注入 narrativeEpisodes
 *   - useFavoriteSignal(signal.id, topicId, initiallyFavorited) → 接 favorite toggle
 *
 * BriefingCard 保持纯展示无业务依赖；本组件做"连线"职责。
 */

import { useNarrativeThread } from '@/hooks/domain/useNarrativeThread';
import { useFavoriteSignal } from '@/hooks/domain/useFavoriteSignal';
import {
  RadarBriefingCard,
  type DailySignalView,
  type RadarBriefingCardProps,
} from './RadarBriefingCard';

interface BriefingCardConnectedProps {
  signal: DailySignalView;
  index: number;
  topicId: string;
  topicName: string;
  detailUrl: string;
  /** 初始收藏状态（从 favoritedIds set 拿） */
  initiallyFavorited?: boolean;
  /** evidence sources（可选，PR-DR2 后端 evidenceItemIds 暂未 join 出完整 source 详情） */
  evidenceSources?: RadarBriefingCardProps['evidenceSources'];
}

export function BriefingCardConnected({
  signal,
  index,
  topicId,
  topicName,
  detailUrl,
  initiallyFavorited,
  evidenceSources,
}: BriefingCardConnectedProps) {
  // Narrative：仅当 signal 有 narrativeId 才拉
  const { data: narrative } = useNarrativeThread(
    signal.narrativeId ? topicId : null,
    signal.narrativeId ?? null
  );

  // Favorite：把已知初始值注入 hook，避免 useEffect 同步把已收藏覆写成未收藏
  const { isFavorited, toggle } = useFavoriteSignal(
    signal.id,
    topicId,
    initiallyFavorited ?? false
  );

  return (
    <RadarBriefingCard
      signal={signal}
      index={index}
      topicId={topicId}
      topicName={topicName}
      detailUrl={detailUrl}
      isFavorited={isFavorited}
      onFavorite={async () => {
        await toggle();
      }}
      narrativeEpisodes={narrative?.episodes}
      narrativeLabel={narrative?.label}
      evidenceSources={evidenceSources}
    />
  );
}
