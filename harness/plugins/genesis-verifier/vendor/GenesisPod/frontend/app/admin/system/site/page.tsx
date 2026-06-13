'use client';

import { Globe } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import SystemSettings from '@/components/admin/settings/SystemSettings';

export default function SitePage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.site')}
      description={t('admin.tabDescriptions.site')}
      icon={Globe}
      domain="system"
    >
      <SystemSettings />
    </AdminPageLayout>
  );
}
