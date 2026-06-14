/**
 * Topic Card Component
 *
 * 显示研究专题的卡片。
 * 自 2026-04-25 起改为基于 `AssetCard` 平台组件实现，
 * 本文件只负责将 Topic 业务数据映射成 AssetCard props。
 */

import type { ReactNode } from 'react';
import { FileText, Globe, Link2, Lock, Users } from 'lucide-react';
import {
  AssetCard,
  type AssetCardBadge,
  type AssetVisibility,
  type AssetVisibilityOption,
} from '@/components/ui/cards/asset-card';
import type { ResearchTopic } from '@/lib/types/topic-insights';
import { ResearchTopicType, DimensionStatus } from '@/lib/types/topic-insights';
import { useTranslation } from '@/lib/i18n';
import { ApplicationButton } from './ApplicationButton';

interface TopicCardProps {
  topic: ResearchTopic;
  currentUserId?: string;
  onClick: () => void;
  onDelete: () => void;
  onShare?: () => void;
  onShareToSocial?: () => void;
  onEdit?: () => void;
  onVisibilityChange?: (visibility: AssetVisibility) => void;
  onCopyLink?: () => void;
}

function getVisibilityOptions(
  t: (key: string) => string
): Record<AssetVisibility, AssetVisibilityOption> {
  return {
    PRIVATE: {
      value: 'PRIVATE',
      label: t('topicResearch.visibility.private'),
      icon: <Lock className="h-3 w-3" />,
      className: 'bg-gray-100 text-gray-600',
    },
    SHARED: {
      value: 'SHARED',
      label: t('topicResearch.visibility.team'),
      icon: <Users className="h-3 w-3" />,
      className: 'bg-blue-100 text-blue-600',
    },
    PUBLIC: {
      value: 'PUBLIC',
      label: t('topicResearch.visibility.public'),
      icon: <Globe className="h-3 w-3" />,
      className: 'bg-green-100 text-green-600',
    },
  };
}

function getTopicTypeConfig(
  t: (key: string) => string
): Record<
  ResearchTopicType,
  { icon: ReactNode; gradient: string; label: string }
> {
  return {
    [ResearchTopicType.MACRO]: {
      icon: (
        <svg
          className="h-6 w-6 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
      gradient: 'from-blue-500 to-cyan-600',
      label: t('topicResearch.researchTypes.macro'),
    },
    [ResearchTopicType.TECHNOLOGY]: {
      icon: (
        <svg
          className="h-6 w-6 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      ),
      gradient: 'from-purple-500 to-pink-600',
      label: t('topicResearch.researchTypes.technology'),
    },
    [ResearchTopicType.COMPANY]: {
      icon: (
        <svg
          className="h-6 w-6 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
      ),
      gradient: 'from-emerald-500 to-teal-600',
      label: t('topicResearch.researchTypes.company'),
    },
    [ResearchTopicType.EVENT]: {
      icon: (
        <svg
          className="h-6 w-6 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
          />
        </svg>
      ),
      gradient: 'from-orange-500 to-red-500',
      label: t('topicResearch.researchTypes.event'),
    },
  };
}

export function TopicCard({
  topic,
  currentUserId,
  onClick,
  onDelete,
  onShare,
  onShareToSocial,
  onEdit,
  onVisibilityChange,
}: TopicCardProps) {
  const { t } = useTranslation();
  const visibilityOptions = getVisibilityOptions(t);
  const typeConfig = getTopicTypeConfig(t)[topic.type];

  const isOwnTopic = Boolean(currentUserId && topic.userId === currentUserId);
  const canApply = !isOwnTopic && topic.visibility === 'SHARED';

  // 优先使用 Mission 数据（与详情页保持一致）
  const hasMissionData =
    topic.missionTotalTasks !== undefined && topic.missionTotalTasks > 0;
  const completedDimensions = hasMissionData
    ? (topic.missionCompletedTasks ?? 0)
    : (topic.dimensions?.filter((d) => d.status === DimensionStatus.COMPLETED)
        .length ?? 0);
  const totalDimensions = hasMissionData
    ? (topic.missionTotalTasks ?? 0)
    : (topic.dimensions?.length ?? 0);

  const badges: AssetCardBadge[] = [
    {
      key: 'type',
      label: typeConfig.label,
      className: 'bg-gray-100 text-gray-600',
    },
  ];

  return (
    <AssetCard
      title={topic.name}
      description={topic.description}
      icon={typeConfig.icon}
      gradient={typeConfig.gradient}
      badges={badges}
      visibility={topic.visibility as AssetVisibility | undefined}
      visibilityOptions={visibilityOptions}
      onVisibilityClick={isOwnTopic ? onShare : undefined}
      onVisibilityToggle={
        isOwnTopic && onVisibilityChange ? onVisibilityChange : undefined
      }
      visibilityToggleCycle={['PRIVATE', 'PUBLIC']}
      isOwner={isOwnTopic}
      onEdit={onEdit}
      onDelete={onDelete}
      onShareToSocial={onShareToSocial}
      onClick={onClick}
      stats={[
        {
          key: 'reports',
          icon: <FileText className="h-3.5 w-3.5" />,
          text: t('topicResearch.topicCard.reports', {
            count: topic.totalReports,
          }),
        },
        {
          key: 'sources',
          icon: <Link2 className="h-3.5 w-3.5" />,
          text: t('topicResearch.topicCard.sources', {
            count: topic.totalSources,
          }),
        },
      ]}
      progress={
        totalDimensions > 0
          ? { current: completedDimensions, total: totalDimensions }
          : undefined
      }
      timestampLabel={t('topicResearch.topicCard.lastRefresh')}
      timestamp={topic.lastRefreshAt}
      footerExtra={canApply ? <ApplicationButton topicId={topic.id} /> : null}
      labels={{
        setPrivate: t('topicResearch.topicCard.clickToSetPrivate'),
        setPublic: t('topicResearch.topicCard.clickToSetPublic'),
        shareToSocial: t('topicResearch.topicCard.shareToSocial'),
        edit: t('topicResearch.topicCard.editTopic'),
        delete: t('topicResearch.topicCard.deleteTopic'),
        clickVisibility: t('topicResearch.topicCard.clickToShare'),
      }}
    />
  );
}
