'use client';

import { Sparkles } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { ModelRecommendationsManagement } from '@/components/admin/recommendations/ModelRecommendationsManagement';

export default function RecommendationsPage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.recommendations')}
      description="编辑一键 AI 配置所用的推荐矩阵；DB 优先于硬编码默认"
      icon={Sparkles}
      domain="ai"
    >
      <ModelRecommendationsManagement />
    </AdminPageLayout>
  );
}
