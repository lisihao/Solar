'use client';

import { Database } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { BrokenResourcesCard } from '@/components/admin/data-management';

export default function ResourceAdminPage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.resourceManagement')}
      description="AI 探索的资源内容管理——无效 URL 清理、重复清理、采集源配置"
      icon={Database}
      domain="data"
      maxWidth="7xl"
    >
      <div className="space-y-6">
        <BrokenResourcesCard />
      </div>
    </AdminPageLayout>
  );
}
