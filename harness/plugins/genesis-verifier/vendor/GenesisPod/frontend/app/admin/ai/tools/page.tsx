'use client';

import { Wrench } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import ToolsManagement from '@/components/admin/ToolsManagement';

export default function ToolsManagementPage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.tools')}
      description={t('admin.tools.description')}
      icon={Wrench}
      domain="ai"
    >
      <ToolsManagement />
    </AdminPageLayout>
  );
}
