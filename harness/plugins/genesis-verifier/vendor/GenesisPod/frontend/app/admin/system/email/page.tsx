'use client';

import { Mail } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import EmailSettings from '@/components/admin/settings/EmailSettings';

export default function EmailPage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.email')}
      description={t('admin.tabDescriptions.email')}
      icon={Mail}
      domain="system"
    >
      <EmailSettings />
    </AdminPageLayout>
  );
}
