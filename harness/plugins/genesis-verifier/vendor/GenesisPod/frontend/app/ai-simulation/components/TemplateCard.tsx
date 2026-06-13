'use client';

import { Factory, Building2, Users, MapPin } from 'lucide-react';
import { AssetCard } from '@/components/ui/cards/asset-card';
import { ScenarioTemplate } from '../types';
import { useI18n } from '@/lib/i18n';

interface TemplateCardProps {
  template: ScenarioTemplate;
  onClick: () => void;
}

/**
 * 场景模板卡 —— 标准化为 canonical AssetCard（2026-05-20 卡片设计系统统一）。
 * 原为自写 rounded-xl 卡 + 🏭 emoji（违反禁 emoji 规则），现走 AssetCard：
 * icon→Lucide Factory，industry/companies/roles→stats，badge→AssetCard badges。
 */
export function TemplateCard({ template, onClick }: TemplateCardProps) {
  const { t } = useI18n();
  return (
    <AssetCard
      title={template.name}
      description={template.description}
      icon={<Factory className="h-6 w-6 text-white" />}
      gradient="from-indigo-500 to-purple-600"
      badges={
        template.badge
          ? [
              {
                key: 'badge',
                label: template.badge,
                className: 'bg-indigo-100 text-indigo-700',
              },
            ]
          : []
      }
      onClick={onClick}
      stats={[
        {
          key: 'meta',
          icon: <MapPin className="h-3.5 w-3.5" />,
          text: `${template.industry} · ${template.region || 'Global'}`,
        },
        {
          key: 'companies',
          icon: <Building2 className="h-3.5 w-3.5" />,
          text: `${t('aiSimulation.templateCard.companies')} ${template.companies?.length || 0}`,
        },
        {
          key: 'roles',
          icon: <Users className="h-3.5 w-3.5" />,
          text: `${t('aiSimulation.templateCard.roles')} ${template.agents?.length || 0}`,
        },
      ]}
    />
  );
}
