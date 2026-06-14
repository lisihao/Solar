'use client';

import { Shield } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import WhitelistManagement from '@/components/admin/WhitelistManagement';

export default function WhitelistsPage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.whitelists')}
      description={t('admin.tabDescriptions.whitelists')}
      icon={Shield}
      domain="data"
    >
      <WhitelistManagement />
    </AdminPageLayout>
  );
}
