'use client';

import { Sparkles } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import DataQualityManagement from '@/components/admin/data-management/DataQualityManagement';

export default function QualityRulesPage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.quality')}
      description={t('admin.tabDescriptions.quality')}
      icon={Sparkles}
      domain="data"
    >
      <DataQualityManagement />
    </AdminPageLayout>
  );
}
